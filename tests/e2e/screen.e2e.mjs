// input: playwright-core (PLAYWRIGHT_CORE path), local Chrome, server.py at BASE_URL
// output: end-to-end checks that the star screen lights more stars as a separate tablet checks in, and that check-in survives a dead relay
// pos: E2E tests, run with tests/e2e/run.sh
// Once I am updated, update my header comments and my folder's md doc.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROSTER = '张三,ACME\n李四,ACME\n王五,ACME\n赵六,ACME';
const BASE_LIT = 40;

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); }
  catch (err) { results.push(['FAIL', name, err.message.replace(/\n/g, ' ')]); }
}

async function hold(page, selector, ms) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function typeKeys(page, letters) {
  for (const ch of letters) await page.locator('.key', { hasText: new RegExp(`^${ch}$`) }).click();
}

async function checkIn(page, letters, name) {
  await page.click('.key-clear');
  await typeKeys(page, letters);
  await page.locator('.result', { hasText: name }).click();
  await hold(page, '#hold-target', 1300);
  assert.equal(await page.isVisible('#screen-success'), true);
  await page.waitForTimeout(900);
  await page.click('#screen-success');
}

const lit = (page) => page.$eval('#sky', (c) => Number(c.dataset.lit || -1));

async function waitLit(page, predicate, label) {
  for (let i = 0; i < 40; i += 1) {
    const n = await lit(page);
    if (predicate(n)) return n;
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for ${label}, lit=${await lit(page)}`);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const padCtx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
const screenCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const pad = await padCtx.newPage();
const screen = await screenCtx.newPage();
const errors = [];
[pad, screen].forEach((p) => p.on('pageerror', (e) => errors.push(`[${p.url()}] ${e.message}`)));
pad.on('dialog', (d) => d.accept());

await step('tablet imports roster', async () => {
  await pad.goto(`${BASE}/admin.html`);
  await pad.evaluate(() => { localStorage.clear(); sessionStorage.setItem('ck.admin.unlocked', '1'); });
  await pad.reload();
  await pad.fill('#import-text', ROSTER);
  await pad.click('#import-preview');
  await pad.click('#import-apply');
  await pad.goto(`${BASE}/index.html`);
});

await step('screen starts with only the base block lit and shows the title', async () => {
  await screen.goto(`${BASE}/screen.html`);
  await waitLit(screen, (n) => n === BASE_LIT, 'base block');
  assert.match(await screen.textContent('#screen-event'), /分享会/);
  assert.equal(await screen.isVisible('#screen-status'), false);
});

let afterOne = 0;
await step('one check-in on the tablet lights more stars on the screen', async () => {
  await checkIn(pad, 'ZS', '张三');
  afterOne = await waitLit(screen, (n) => n > BASE_LIT, 'first check-in');
});

await step('second check-in lights even more', async () => {
  await checkIn(pad, 'LS', '李四');
  await waitLit(screen, (n) => n > afterOne, 'second check-in');
});

await step('screen never writes check-in data', async () => {
  const keys = await screen.evaluate(() => Object.keys(localStorage));
  assert.deepEqual(keys, []);
});

await step('admin shows the screen link status', async () => {
  const admin = await padCtx.newPage();
  await admin.addInitScript(() => sessionStorage.setItem('ck.admin.unlocked', '1'));
  await admin.goto(`${BASE}/admin.html`);
  await admin.waitForSelector('#sky-link:not([hidden])', { timeout: 8000 });
  assert.match(await admin.textContent('#sky-link'), /大屏已连接/);
  await admin.route('**/api/sky', (route) => route.abort());
  await admin.waitForFunction(() => /未连接/.test(document.getElementById('sky-link').textContent), null, { timeout: 8000 });
  await admin.close();
});

await step('check-in still works when the relay is down', async () => {
  await pad.route('**/api/sky', (route) => route.abort());
  await checkIn(pad, 'WW', '王五');
  assert.match(await pad.textContent('#progress-count'), /3 \/ 4/);
  await pad.unroute('**/api/sky');
  await waitLit(screen, (n) => n === 40 + Math.round(3 * (260 - 40) / 4), 'catch-up after relay recovers');
});

await step('screen keeps its stars and shows a small dot when the relay is unreachable', async () => {
  const before = await lit(screen);
  await screen.route('**/api/sky', (route) => route.abort());
  await screen.waitForSelector('#screen-status:not([hidden])', { timeout: 6000 });
  assert.equal(await lit(screen), before);
  await screen.unroute('**/api/sky');
});

assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
await browser.close();

results.forEach(([status, name, msg]) => process.stdout.write(`${status.padEnd(4)} ${name}${msg ? ` — ${msg}` : ''}\n`));
const failed = results.filter((r) => r[0] === 'FAIL').length;
process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
