// input: playwright-core (PLAYWRIGHT_CORE path), local Chrome, a static server at BASE_URL
// output: end-to-end checks that the exported single-file demo works from file:// with the embedded roster
// pos: E2E tests, run with tests/e2e/run.sh
// Once I am updated, update my header comments and my folder's md doc.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROSTER = '姓名,公司\n张三,ACME\n曾小贤,爱情公寓\n</script><b>x</b>,注入测试';

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

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[main ${page.url()}] ${e.message}`));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (/重置/.test(d.message()) ? '重置' : '0000') : undefined));
const outDir = mkdtempSync(join(tmpdir(), 'ck-demo-'));
let demoPath = '';

await step('export demo from admin page', async () => {
  await page.goto(`${BASE}/admin.html`);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.setItem('ck.admin.unlocked', '1'); });
  await page.reload();
  await page.fill('#import-text', ROSTER);
  await page.click('#import-preview');
  await page.click('#import-apply');
  await page.locator('#guest-rows tr', { hasText: '曾小贤' }).locator('button', { hasText: '代签到' }).click();
  await page.uncheck('#export-demo-clear');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-demo')]);
  assert.match(download.suggestedFilename(), /^签到Demo_\d+\.html$/);
  demoPath = join(outDir, 'demo.html');
  await download.saveAs(demoPath);
  const html = readFileSync(demoPath, 'utf8');
  assert.equal((html.match(/<script src=/g) || []).length, 0, 'no external scripts');
  assert.equal((html.match(/<link /g) || []).length, 0, 'no external stylesheets');
});

const demo = await context.newPage();
demo.on('pageerror', (e) => errors.push(`[demo] ${e.message}`));
demo.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (/重置/.test(d.message()) ? '重置' : '0000') : undefined));

await step('demo opens from file:// with embedded roster and check-in state', async () => {
  await demo.goto(pathToFileURL(demoPath).href);
  assert.match(await demo.textContent('#progress-count'), /已签到 1 \/ 3/);
  assert.equal(await demo.isVisible('#screen-search'), true);
  assert.equal(await demo.isVisible('#lock'), false);
});

await step('injected name renders as text and did not break the page', async () => {
  await demo.fill('#search-input', '注');
  await demo.locator('#system-kbd').click();
  await demo.fill('#search-input', 'script');
  await demo.dispatchEvent('#search-input', 'input');
  assert.match(await demo.textContent('#results'), /<\/script><b>x<\/b>/);
  assert.equal(await demo.locator('#results b').count(), 0);
  await demo.locator('#system-kbd').click();
});

await step('full check-in works inside demo', async () => {
  await demo.click('.key-clear');
  for (const k of 'ZS') await demo.locator('.key', { hasText: new RegExp(`^${k}$`) }).click();
  await demo.locator('.result', { hasText: '张三' }).click();
  await hold(demo, '#hold-target', 1300);
  assert.equal(await demo.isVisible('#screen-success'), true);
  assert.match(await demo.textContent('#progress-count'), /2 \/ 3/);
  const logoSrc = await demo.$eval('#success-logo', (i) => i.src);
  assert.ok(logoSrc.startsWith('data:image/'), 'logo embedded');
  assert.ok(await demo.$eval('#success-logo', (i) => i.naturalWidth > 0), 'logo renders');
});

await step('demo state persists across reload', async () => {
  await demo.reload();
  assert.match(await demo.textContent('#progress-count'), /2 \/ 3/);
});

await step('5 taps + PIN opens admin inside the same file', async () => {
  for (let i = 0; i < 5; i += 1) await demo.click('#admin-corner');
  await demo.waitForFunction(() => document.body.className === 'admin');
  assert.equal(await demo.isVisible('#lock'), true);
  await demo.fill('#lock-pin', '0000');
  await demo.click('#lock-form button');
  assert.match(await demo.textContent('#stats'), /已签 2/);
  assert.equal(await demo.isVisible('#demo-reset-row'), true);
  assert.equal(await demo.isVisible('#demo-export-row'), false);
});

await step('reset restores exported roster', async () => {
  await demo.click('#demo-reset');
  assert.match(await demo.textContent('#stats'), /已签 1/);
  await demo.click('.admin-header a.primary');
  await demo.waitForFunction(() => document.body.className === 'kiosk');
  assert.equal(await demo.isVisible('#screen-search'), true);
});

await step('demo data is isolated from the main app storage', async () => {
  await page.reload();
  assert.match(await page.textContent('#stats'), /总数 3/);
  assert.match(await page.textContent('#stats'), /已签 1/);
});

await step('export without check-ins starts at 0', async () => {
  await page.check('#export-demo-clear');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-demo')]);
  const clean = join(outDir, 'clean.html');
  await download.saveAs(clean);
  const fresh = await context.newPage();
  await fresh.goto(pathToFileURL(clean).href);
  assert.match(await fresh.textContent('#progress-count'), /已签到 0 \/ 3/);
  await fresh.close();
});

assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
await browser.close();

results.forEach(([status, name, msg]) => process.stdout.write(`${status.padEnd(4)} ${name}${msg ? ` — ${msg}` : ''}\n`));
const failed = results.filter((r) => r[0] === 'FAIL').length;
process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
