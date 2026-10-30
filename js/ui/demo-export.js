// input: CK.app, the app's own source files fetched over http (index.html, admin.html, css, js, vendor, assets)
// output: CK.demoExport.build({clearCheckins}) — one self-contained HTML string with kiosk + admin and the current roster embedded
// pos: UI tooling layer used by the admin page to produce a shareable demo file that opens via file://
// Once I am updated, update my header comments and my folder's md doc.
(function (root) {
  'use strict';

  const { app } = root.CK;
  const STYLES = ['css/base.css', 'css/kiosk.css', 'css/admin.css'];
  const SCRIPTS = [
    'vendor/pinyin-pro.js', 'js/core/pinyin-keys.js', 'js/core/matcher.js', 'js/core/roster.js', 'js/core/store.js',
    'js/ui/dom.js', 'js/ui/app-state.js', 'js/ui/hold.js', 'js/ui/kiosk.js', 'js/ui/admin-io.js', 'js/ui/admin.js',
  ];
  const DEFAULT_LOGO_PATH = 'assets/logo.png';
  const ROUTER = `(function(){function r(){var a=location.hash==='#admin';document.body.className=a?'admin':'kiosk';`
    + `document.querySelector('[data-page=kiosk]').hidden=a;document.querySelector('[data-page=admin]').hidden=!a;}`
    + `addEventListener('hashchange',r);r();})();`;
  const PAGE_CSS = '[data-page]{display:contents}[data-page][hidden]{display:none}';

  async function fetchText(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`读取 ${path} 失败（${res.status}）`);
    return res.text();
  }

  // Make arbitrary text safe inside an inline <script> or <style> block.
  function inlineSafe(text) {
    return text.replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  }

  function jsonForScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  async function fetchDataUrl(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`读取 ${path} 失败（${res.status}）`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`读取 ${path} 失败`));
      reader.readAsDataURL(blob);
    });
  }

  // Body markup of a page without its <script> tags; page links rewritten to hash routes.
  function pageBody(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script').forEach((s) => s.remove());
    doc.querySelectorAll('a[href="index.html"]').forEach((a) => a.setAttribute('href', '#'));
    doc.querySelectorAll('a[href="admin.html"]').forEach((a) => a.setAttribute('href', '#admin'));
    return doc.body.innerHTML.trim();
  }

  function seedState(clearCheckins) {
    const state = app.get();
    if (!clearCheckins) return state;
    return { ...state, guests: state.guests.map((g) => ({ ...g, checkedInAt: null })), log: [] };
  }

  function newSeedId() {
    const rand = root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : `${Date.now()}${Math.random()}`;
    return rand.replace(/[^\w-]/g, '').slice(0, 24);
  }

  // Assemble the standalone HTML document.
  async function build({ clearCheckins = false } = {}) {
    if (root.location.protocol === 'file:') throw new Error('请通过 http 打开管理页再导出（例如 python3 -m http.server）');
    const [defaultLogo, kioskHtml, adminHtml, ...rest] = await Promise.all([
      fetchDataUrl(DEFAULT_LOGO_PATH),
      ...['index.html', 'admin.html', ...STYLES, ...SCRIPTS].map(fetchText),
    ]);
    const css = rest.slice(0, STYLES.length);
    const js = rest.slice(STYLES.length);
    const state = seedState(clearCheckins);
    const seed = { id: newSeedId(), exportedAt: app.now(), state, logo: app.customLogo() };
    const title = state.settings.eventTitle;
    const titleEl = new DOMParser().parseFromString('<title></title>', 'text/html').querySelector('title');
    titleEl.textContent = `签到 · ${title}`;
    return [
      '<!doctype html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      titleEl.outerHTML,
      `<style>${inlineSafe([...css, PAGE_CSS].join('\n'))}</style>`,
      '</head>',
      '<body class="kiosk">',
      `<div data-page="kiosk">${pageBody(kioskHtml)}</div>`,
      `<div data-page="admin" hidden>${pageBody(adminHtml)}</div>`,
      `<script>${ROUTER}</script>`,
      `<script>self.CK_SEED=${jsonForScript(seed)};self.CK_DEFAULT_LOGO=${jsonForScript(defaultLogo)};self.CK_ADMIN_URL='#admin';</script>`,
      ...js.map((code) => `<script>${inlineSafe(code)}</script>`),
      '</body>',
      '</html>',
      '',
    ].join('\n');
  }

  root.CK.demoExport = { build };
})(self);
