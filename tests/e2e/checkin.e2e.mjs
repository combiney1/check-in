// input: playwright-core (PLAYWRIGHT_CORE path), local Chrome, a static server at BASE_URL
// output: end-to-end checks for import → search → hold check-in → admin undo / walk-in / recovery
// pos: E2E tests, run with tests/e2e/run.sh
// Once I am updated, update my header comments and my folder's md doc.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROSTER = '姓名,公司,别名\n张三,ACME,\n张珊珊,WorkBuddy,\n曾小贤,爱情公寓,\n吕布,三国,\nTom Hanks,Pixar,\n李乐,AGI Lab,Leo';

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); }
  catch (err) { results.push(['FAIL', name, err.message.split('\n')[0]]); }
}

async function hold(page, selector, ms) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function typeKeys(page, letters) {
  for (const k of letters) await page.locator('.key', { hasText: new RegExp(`^${k}$`) }).click();
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: false });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '0000' : undefined));

await step('admin requires PIN and imports roster', async () => {
  await page.goto(`${BASE}/admin.html`);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.fill('#lock-pin', '1234');
  await page.click('#lock-form button');
  assert.equal(await page.isVisible('#admin-app'), false);
  await page.fill('#lock-pin', '0000');
  await page.click('#lock-form button');
  await page.fill('#import-text', ROSTER);
  await page.click('#import-preview');
  assert.match(await page.textContent('#import-result'), /识别到 6 人/);
  await page.click('#import-apply');
  assert.equal(await page.locator('#guest-rows tr').count(), 6);
});

await step('kiosk shows empty hint, then initials match', async () => {
  await page.goto(`${BASE}/index.html`);
  assert.match(await page.textContent('#progress-count'), /0 \/ 6/);
  await typeKeys(page, 'ZS');
  const names = await page.locator('.result-name').allTextContents();
  assert.deepEqual(names, ['张三', '张珊珊']);
});

await step('polyphone surname and ü readings both work', async () => {
  await page.click('.key-clear');
  await typeKeys(page, 'CXX');
  assert.deepEqual(await page.locator('.result-name').allTextContents(), ['曾小贤']);
  await page.click('.key-clear');
  await typeKeys(page, 'LUBU');
  assert.deepEqual(await page.locator('.result-name').allTextContents(), ['吕布']);
});

await step('no match shows helpful message', async () => {
  await page.click('.key-clear');
  await typeKeys(page, 'QQQ');
  assert.match(await page.textContent('#results'), /没有找到/);
});

await step('single tap opens confirm; short hold does not check in and logo drains back', async () => {
  await page.click('.key-clear');
  await typeKeys(page, 'ZS');
  await page.locator('.result', { hasText: '张三' }).click();
  assert.equal(await page.isVisible('#screen-confirm'), true);
  assert.equal(await page.textContent('#confirm-name'), '张三');
  await hold(page, '#hold-target', 450);
  const mid = Number(await page.$eval('#hold-logo', (e) => e.style.opacity));
  assert.ok(mid > 0.3, `logo should brighten while held, got ${mid}`);
  await page.waitForTimeout(1200);
  const after = Number(await page.$eval('#hold-logo', (e) => e.style.opacity));
  assert.ok(after < 0.15, `logo should drain back after release, got ${after}`);
  assert.equal(await page.isVisible('#screen-confirm'), true);
});

await step('1s hold checks in and shows success, then returns to search', async () => {
  await hold(page, '#hold-target', 1300);
  assert.equal(await page.isVisible('#screen-success'), true);
  assert.equal(await page.textContent('#success-name'), '张三');
  assert.match(await page.textContent('#progress-count'), /1 \/ 6/);
  await page.waitForTimeout(3800);
  assert.equal(await page.isVisible('#screen-search'), true);
  assert.equal(await page.inputValue('#search-input'), '');
});

await step('already checked-in guest is marked and cannot check in again', async () => {
  await typeKeys(page, 'ZS');
  const row = page.locator('.result', { hasText: '张三' });
  assert.match(await row.textContent(), /已签到/);
  await row.click();
  assert.equal(await page.isVisible('#screen-search'), true);
  assert.match(await page.textContent('#toast'), /无需重复签到/);
});

await step('check-in survives reload', async () => {
  await page.reload();
  assert.match(await page.textContent('#progress-count'), /1 \/ 6/);
});

await step('"不是我" goes back without check-in', async () => {
  await page.click('.key-clear');
  await typeKeys(page, 'TH');
  await page.locator('.result').first().click();
  await page.click('#confirm-back');
  assert.equal(await page.isVisible('#screen-search'), true);
  assert.match(await page.textContent('#progress-count'), /1 \/ 6/);
});

await step('admin sees check-in, can undo it, add walk-in, edit alias', async () => {
  await page.goto(`${BASE}/admin.html`);
  assert.match(await page.textContent('#stats'), /已签 1/);
  await page.locator('#guest-rows tr', { hasText: '张三' }).locator('button', { hasText: '撤销签到' }).click();
  assert.match(await page.textContent('#stats'), /已签 0/);
  await page.fill('#walkin-form [name=name]', '王临时');
  await page.fill('#walkin-form [name=company]', '现场');
  await page.click('#walkin-form button[type=submit]');
  assert.match(await page.textContent('#stats'), /总数 7/);
  assert.match(await page.textContent('#stats'), /已签 1/);
  await page.locator('#guest-rows tr', { hasText: '吕布' }).locator('button', { hasText: '编辑' }).click();
  await page.fill('tr.editing [name=aliases]', 'Lyu Bu');
  await page.locator('tr.editing button', { hasText: '保存' }).click();
  assert.match(await page.textContent('#guest-rows'), /Lyu Bu/);
  assert.match(await page.textContent('#log'), /撤销签到 张三/);
});

await step('kiosk tab updates live when admin changes data in another tab', async () => {
  const kiosk = await context.newPage();
  await kiosk.goto(`${BASE}/index.html`);
  assert.match(await kiosk.textContent('#progress-count'), /1 \/ 7/);
  await page.locator('#guest-rows tr', { hasText: 'Tom Hanks' }).locator('button', { hasText: '代签到' }).click();
  await kiosk.waitForFunction(() => /2 \/ 7/.test(document.querySelector('#progress-count').textContent));
  await kiosk.close();
});

await step('guest names are rendered as text, not HTML', async () => {
  await page.fill('#walkin-form [name=name]', '<img src=x onerror=alert(1)>');
  await page.click('#walkin-form button[type=submit]');
  assert.equal(await page.locator('#guest-rows img').count(), 0);
});

await step('CSV export downloads', async () => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  assert.match(download.suggestedFilename(), /^签到表_\d+\.csv$/);
});

await step('corrupted main data recovers from snapshot', async () => {
  await page.evaluate(() => localStorage.setItem('ck.state.v1', '{broken'));
  await page.goto(`${BASE}/index.html`);
  assert.match(await page.textContent('#banner'), /自动备份恢复/);
  assert.match(await page.textContent('#progress-count'), /\/ [67]/);
});

await step('long-press does not open context menu / select text', async () => {
  const sel = await page.$eval('body', (b) => getComputedStyle(b).userSelect);
  assert.equal(sel, 'none');
});

assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
await browser.close();

results.forEach(([status, name, msg]) => process.stdout.write(`${status.padEnd(4)} ${name}${msg ? ` — ${msg}` : ''}\n`));
const failed = results.filter((r) => r[0] === 'FAIL').length;
process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
