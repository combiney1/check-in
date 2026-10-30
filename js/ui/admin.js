// input: CK.app, CK.matcher, CK.pinyinKeys, CK.dom, CK.adminIo; DOM from admin.html
// output: admin page — PIN lock, guest table (manual check-in / undo / edit / delete), walk-ins, settings, log, star-screen link pill
// pos: UI page controller (staff-facing half of the admin page)
// Once I am updated, update my header comments and my folder's md doc.
(function (root) {
  'use strict';

  const { app, matcher, pinyinKeys, dom, adminIo } = root.CK;
  const { h, $, clear, hhmm } = dom;
  const SESSION_KEY = 'ck.admin.unlocked';
  const LOG_SHOWN = 50;
  const LOG_LABEL = { checkin: '签到', undo: '撤销签到', add: '现场添加', edit: '修改', remove: '删除', import: '导入', reset: '清空签到', clear: '删除全部' };

  let editingId = null;

  function unlock() {
    root.sessionStorage.setItem(SESSION_KEY, '1');
    $('#lock').hidden = true;
    $('#admin-app').hidden = false;
    start();
  }

  function setupLock() {
    if (root.sessionStorage.getItem(SESSION_KEY) === '1') { unlock(); return; }
    $('#lock-pin').focus();
    $('#lock-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (app.checkPin($('#lock-pin').value)) unlock();
      else { app.toast('PIN 错误', 'error'); $('#lock-pin').value = ''; }
    });
  }

  function renderStats() {
    const s = app.roster.stats(app.get());
    const pct = s.total ? Math.round((s.checked / s.total) * 100) : 0;
    clear($('#stats')).append(
      h('span', { class: 'pill' }, `总数 ${s.total}`),
      h('span', { class: 'pill ok' }, `已签 ${s.checked}（${pct}%）`),
      h('span', { class: 'pill' }, `未签 ${s.pending}`),
      h('span', { class: 'pill' }, `现场添加 ${s.walkins}`),
    );
  }

  function renderBanner() {
    const msgs = [];
    if (app.recovered === 'snapshot') msgs.push('主数据损坏，已自动从最近快照恢复，请核对最后几位签到记录');
    if (app.recovered === 'reset') msgs.push('主数据损坏且无可用快照，请用「恢复备份」导入之前下载的备份');
    if (app.saveError()) msgs.push('最近一次保存失败，请确认不是无痕模式，并立即下载完整备份');
    $('#admin-banner').textContent = msgs.join('；');
    $('#admin-banner').hidden = msgs.length === 0;
  }

  function visibleGuests() {
    const state = app.get();
    const status = $('#filter-status').value;
    const query = $('#filter').value.trim();
    const byStatus = (g) => status === 'all'
      || (status === 'checked' && g.checkedInAt) || (status === 'pending' && !g.checkedInAt) || (status === 'walkin' && g.source === 'walkin');
    if (!query) return state.guests.filter(byStatus);
    const nameHits = new Set(matcher.search(query, app.entries(), state.guests.length).map((r) => r.id));
    const q = query.toLowerCase();
    return state.guests.filter((g) => byStatus(g) && (nameHits.has(g.id) || (g.company || '').toLowerCase().includes(q)));
  }

  function act(result, okMsg) {
    if (!result.ok) { app.toast(result.reason === 'duplicate' ? '已存在同名同公司的来宾' : '操作失败', 'error'); return false; }
    const saved = app.commit(result.state);
    app.toast(saved.ok ? okMsg : '已更新，但保存失败', saved.ok ? 'ok' : 'error');
    return true;
  }

  function actionCell(g) {
    const btn = (label, fn, cls) => h('button', { type: 'button', class: cls, onclick: fn }, label);
    return h('td', { class: 'actions' }, [
      g.checkedInAt
        ? btn('撤销签到', () => root.confirm(`撤销 ${g.name} 的签到？`) && act(app.roster.undoCheckIn(app.get(), g.id, app.now()), '已撤销'))
        : btn('代签到', () => act(app.roster.checkIn(app.get(), g.id, app.now(), 'admin'), `${g.name} 已签到`), 'primary'),
      btn('编辑', () => { editingId = g.id; renderTable(); }),
      btn('删除', () => root.confirm(`从名单中删除 ${g.name}？`) && act(app.roster.removeGuest(app.get(), g.id, app.now()), '已删除'), 'danger'),
    ]);
  }

  function editRow(g) {
    const field = (name, value, max) => h('input', { name, value, maxlength: max });
    const inputs = [field('name', g.name, 40), field('company', g.company, 80), field('aliases', g.aliases, 80)];
    const save = () => {
      const [name, company, aliases] = inputs.map((i) => i.value);
      const res = app.roster.updateGuest(app.get(), g.id, { name, company, aliases }, app.now());
      if (res.ok) editingId = null;
      act(res, '已保存');
    };
    return h('tr', { class: 'editing' }, [
      ...inputs.map((i) => h('td', {}, i)),
      h('td', { class: 'muted', colspan: 2 }, '别名里可填正确读音，如「曾」读 zeng 时可填 zeng xiao xian'),
      h('td', { class: 'actions' }, [
        h('button', { type: 'button', class: 'primary', onclick: save }, '保存'),
        h('button', { type: 'button', onclick: () => { editingId = null; renderTable(); } }, '取消'),
      ]),
    ]);
  }

  function guestRow(g, entry) {
    if (g.id === editingId) return editRow(g);
    return h('tr', { class: g.checkedInAt ? 'is-checked' : '' }, [
      h('td', {}, [g.name, g.source === 'walkin' ? h('span', { class: 'tag' }, '现场') : null]),
      h('td', {}, g.company),
      h('td', {}, g.aliases),
      h('td', { class: 'mono' }, entry ? pinyinKeys.describe(entry) : ''),
      h('td', {}, g.checkedInAt ? `✓ ${hhmm(g.checkedInAt)}` : '—'),
      actionCell(g),
    ]);
  }

  function renderTable() {
    const entryById = new Map(app.entries().map((e) => [e.id, e]));
    const rows = visibleGuests();
    const body = clear($('#guest-rows'));
    if (rows.length === 0) {
      body.appendChild(h('tr', {}, h('td', { colspan: 6, class: 'muted center' }, app.get().guests.length ? '没有符合条件的来宾' : '名单为空，请先在下方导入')));
      return;
    }
    rows.forEach((g) => body.appendChild(guestRow(g, entryById.get(g.id))));
  }

  function renderLog() {
    const items = app.get().log.slice(-LOG_SHOWN).reverse();
    clear($('#log')).append(...items.map((e) => h('li', {}, [
      h('span', { class: 'mono' }, app.roster.formatTime(e.t).slice(11)),
      ` ${LOG_LABEL[e.type] || e.type} `,
      e.name ? e.name : e.count !== undefined ? `${e.count} 人` : '',
      e.via === 'admin' ? '（工作人员）' : '',
    ])));
  }

  function setupWalkin() {
    const form = $('#walkin-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const row = { name: data.get('name'), company: data.get('company'), aliases: data.get('aliases') };
      const res = app.roster.addGuest(app.get(), row, app.newId, app.now(), { checkInNow: data.get('checkInNow') === 'on' });
      if (act(res, `已添加 ${row.name}`)) { form.reset(); form.elements.checkInNow.checked = true; }
    });
  }

  function setupSettings() {
    const form = $('#settings-form');
    const fill = () => { form.elements.eventTitle.value = app.get().settings.eventTitle; $('#logo-preview').src = app.logoUrl(); };
    fill();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = form.elements.eventTitle.value.trim();
      const pin = form.elements.adminPin.value.trim();
      if (pin && !/^\d{4,12}$/.test(pin)) { app.toast('PIN 需为 4–12 位数字', 'error'); return; }
      const patch = { ...(title ? { eventTitle: title } : {}), ...(pin ? { adminPin: pin } : {}) };
      app.commit(app.roster.updateSettings(app.get(), patch));
      form.elements.adminPin.value = '';
      app.toast('设置已保存', 'ok');
    });
    $('#logo-file').addEventListener('change', async (e) => {
      const res = await app.setLogo(e.target.files[0]);
      e.target.value = '';
      app.toast(res.ok ? 'logo 已更新' : res.reason, res.ok ? 'ok' : 'error');
    });
    $('#logo-reset').addEventListener('click', app.resetLogo);
    app.onChange((_s, source) => { if (source === 'logo') $('#logo-preview').src = app.logoUrl(); });
  }

  function renderAll() {
    renderStats();
    renderBanner();
    renderTable();
    renderLog();
  }

  function start() {
    $('#filter').addEventListener('input', renderTable);
    $('#filter-status').addEventListener('change', renderTable);
    setupWalkin();
    setupSettings();
    adminIo.init();
    renderAll();
    app.onChange((_s, source) => { if (source !== 'logo') renderAll(); });
    document.addEventListener('ck:sky', (e) => renderSkyLink(e.detail.ok));
  }

  function renderSkyLink(ok) {
    const pill = $('#sky-link');
    pill.hidden = false;
    pill.className = ok ? 'pill ok' : 'pill warn';
    pill.textContent = ok ? '大屏已连接' : '大屏未连接（不影响签到）';
  }

  setupLock();
})(self);
