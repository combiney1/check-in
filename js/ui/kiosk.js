// input: CK.app, CK.matcher, CK.dom, CK.hold; DOM from index.html
// output: kiosk flow — search → confirm (hold 1s, logo dark→bright) → success → back to search
// pos: UI page controller for the guest-facing check-in screen
// Once I am updated, update my header comments and my folder's md doc.
(function (root) {
  'use strict';

  const { app, matcher, dom, hold } = root.CK;
  const { h, $, clear, hhmm } = dom;
  const HOLD_MS = 1000;
  const CONFIRM_IDLE_MS = 30000;
  const SEARCH_IDLE_MS = 60000;
  const SUCCESS_MS = 3500;
  const SUCCESS_TAP_GUARD_MS = 800;
  const RESULT_LIMIT = 8;
  const ADMIN_TAPS = 5;
  const ADMIN_TAP_WINDOW_MS = 2500;
  const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  const RING_LEN = 2 * Math.PI * 46;

  const el = {
    title: $('#event-title'),
    progress: $('#progress-count'),
    input: $('#search-input'),
    results: $('#results'),
    keypad: $('#keypad'),
    screens: { search: $('#screen-search'), confirm: $('#screen-confirm'), success: $('#screen-success') },
    confirmName: $('#confirm-name'),
    confirmCompany: $('#confirm-company'),
    holdTarget: $('#hold-target'),
    holdLogo: $('#hold-logo'),
    holdRing: $('#hold-ring-bar'),
    holdHint: $('#hold-hint'),
    back: $('#confirm-back'),
    successName: $('#success-name'),
    successTime: $('#success-time'),
    successLogo: $('#success-logo'),
    adminCorner: $('#admin-corner'),
    banner: $('#banner'),
  };

  let selectedId = null;
  let idleTimer = null;
  let successTimer = null;
  let successShownAt = 0;

  function show(name) {
    Object.entries(el.screens).forEach(([key, node]) => node.classList.toggle('active', key === name));
  }

  function armIdle(ms, fn) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(fn, ms);
  }

  function renderHeader() {
    const state = app.get();
    el.title.textContent = state.settings.eventTitle;
    const s = app.roster.stats(state);
    el.progress.textContent = `已签到 ${s.checked} / ${s.total}`;
    document.title = `签到 · ${state.settings.eventTitle}`;
  }

  function renderBanner() {
    const messages = [];
    if (app.recovered === 'snapshot') messages.push('数据已从自动备份恢复，请工作人员到管理页核对');
    if (app.recovered === 'reset') messages.push('本地数据损坏且无备份，请工作人员到管理页恢复');
    if (app.saveError()) messages.push('保存失败：请工作人员检查浏览器存储（勿用无痕模式）');
    if (app.get().guests.length === 0) messages.push('尚未导入来宾名单，请工作人员到管理页导入');
    el.banner.textContent = messages.join('；');
    el.banner.hidden = messages.length === 0;
  }

  function resultRow(guest) {
    const checked = Boolean(guest.checkedInAt);
    return h('button', {
      class: `result${checked ? ' checked' : ''}`,
      type: 'button',
      dataset: { id: guest.id },
      onclick: () => choose(guest.id),
    }, [
      h('span', { class: 'result-name' }, guest.name),
      guest.company ? h('span', { class: 'result-company' }, guest.company) : null,
      checked ? h('span', { class: 'result-badge' }, `已签到 ${hhmm(guest.checkedInAt)}`) : null,
    ]);
  }

  function renderResults() {
    const query = el.input.value;
    clear(el.results);
    if (!query.trim()) {
      el.results.appendChild(h('p', { class: 'results-hint' }, '输入姓名拼音首字母，例如 张三 → ZS'));
      return;
    }
    const state = app.get();
    const hits = matcher.search(query, app.entries(), RESULT_LIMIT)
      .map((r) => app.roster.findGuest(state, r.id))
      .filter(Boolean);
    if (hits.length === 0) {
      el.results.appendChild(h('p', { class: 'results-empty' }, [
        '没有找到匹配的名字',
        h('br'),
        h('small', {}, '可以试试全拼或直接输入中文；仍找不到请联系工作人员'),
      ]));
      return;
    }
    hits.forEach((g) => el.results.appendChild(resultRow(g)));
  }

  function setQuery(value) {
    el.input.value = value;
    renderResults();
    armIdle(SEARCH_IDLE_MS, () => setQuery(''));
  }

  function buildKeypad() {
    KEY_ROWS.forEach((row, i) => {
      const keys = [...row].map((k) => h('button', { class: 'key', type: 'button', onclick: () => setQuery(el.input.value + k) }, k));
      if (i === KEY_ROWS.length - 1) {
        keys.push(h('button', { class: 'key key-wide', type: 'button', 'aria-label': '删除', onclick: () => setQuery(el.input.value.slice(0, -1)) }, '⌫'));
      }
      el.keypad.appendChild(h('div', { class: 'key-row' }, keys));
    });
    el.keypad.appendChild(h('div', { class: 'key-row' }, [
      h('button', { class: 'key key-clear', type: 'button', onclick: () => setQuery('') }, '清空'),
    ]));
  }

  // Switch between the on-screen letter pad and the system keyboard (for Chinese input).
  function toggleSystemKeyboard(event) {
    const useSystem = el.input.getAttribute('inputmode') === 'none';
    el.input.setAttribute('inputmode', useSystem ? 'text' : 'none');
    el.keypad.hidden = useSystem;
    event.currentTarget.textContent = useSystem ? '字母键盘' : '中文输入';
    if (useSystem) el.input.focus();
    else el.input.blur();
  }

  function setHoldProgress(p) {
    const eased = p * p * (3 - 2 * p);
    el.holdLogo.style.opacity = String(0.12 + 0.88 * eased);
    el.holdLogo.style.filter = `brightness(${0.25 + 0.95 * eased}) saturate(${0.3 + 0.9 * eased}) drop-shadow(0 0 ${Math.round(40 * eased)}px rgba(124,243,255,${0.7 * eased}))`;
    el.holdLogo.style.transform = `scale(${0.92 + 0.08 * eased})`;
    el.holdRing.style.strokeDashoffset = String(RING_LEN * (1 - p));
    el.holdTarget.classList.toggle('pressing', p > 0 && p < 1);
  }

  const holdCtl = hold.attach(el.holdTarget, {
    durationMs: HOLD_MS,
    onProgress: setHoldProgress,
    onStart: () => { el.holdHint.textContent = '保持按住…'; armIdle(CONFIRM_IDLE_MS, backToSearch); },
    onComplete: completeCheckIn,
  });

  function choose(id) {
    const guest = app.roster.findGuest(app.get(), id);
    if (!guest) { renderResults(); return; }
    if (guest.checkedInAt) {
      app.toast(`${guest.name} 已于 ${hhmm(guest.checkedInAt)} 签到，无需重复签到`, 'warn');
      return;
    }
    selectedId = id;
    el.confirmName.textContent = guest.name;
    el.confirmCompany.textContent = guest.company || '';
    el.holdHint.textContent = '长按名字 1 秒完成签到';
    holdCtl.reset();
    show('confirm');
    armIdle(CONFIRM_IDLE_MS, backToSearch);
  }

  function backToSearch() {
    clearTimeout(successTimer);
    selectedId = null;
    holdCtl.reset();
    show('search');
    setQuery('');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function completeCheckIn() {
    const res = app.roster.checkIn(app.get(), selectedId, app.now(), 'kiosk');
    if (!res.ok) {
      const msg = res.reason === 'already' ? `已于 ${hhmm(res.guest.checkedInAt)} 签到过了` : '名单已变更，请重新搜索';
      app.toast(msg, 'warn');
      backToSearch();
      return;
    }
    const saved = app.commit(res.state);
    if (!saved.ok) app.toast('签到已记录，但保存失败，请通知工作人员', 'error');
    if (root.navigator.vibrate) root.navigator.vibrate([60, 40, 120]);
    el.successName.textContent = res.guest.name;
    el.successTime.textContent = `签到时间 ${hhmm(res.guest.checkedInAt)}`;
    show('success');
    successShownAt = Date.now();
    clearTimeout(idleTimer);
    successTimer = setTimeout(backToSearch, SUCCESS_MS);
  }

  function applyLogo() {
    const url = app.logoUrl();
    el.holdLogo.src = url;
    el.successLogo.src = url;
  }

  let taps = [];
  // Five quick taps on the top-left corner opens the PIN prompt for staff.
  function onCornerTap() {
    const now = Date.now();
    taps = [...taps.filter((t) => now - t < ADMIN_TAP_WINDOW_MS), now];
    if (taps.length < ADMIN_TAPS) return;
    taps = [];
    const pin = root.prompt('工作人员 PIN');
    if (pin === null) return;
    if (app.checkPin(pin)) root.location.href = root.CK_ADMIN_URL || 'admin.html';
    else app.toast('PIN 错误', 'error');
  }

  function init() {
    buildKeypad();
    applyLogo();
    renderHeader();
    renderBanner();
    renderResults();
    el.input.addEventListener('input', () => setQuery(el.input.value));
    el.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = el.results.querySelector('.result:not(.checked)');
      if (first) choose(first.dataset.id);
    });
    $('#system-kbd').addEventListener('click', toggleSystemKeyboard);
    el.back.addEventListener('click', backToSearch);
    el.screens.success.addEventListener('click', () => { if (Date.now() - successShownAt > SUCCESS_TAP_GUARD_MS) backToSearch(); });
    el.adminCorner.addEventListener('click', onCornerTap);
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
    app.onChange((_state, source) => {
      if (source === 'logo') { applyLogo(); return; }
      renderHeader();
      renderBanner();
      if (el.screens.search.classList.contains('active')) renderResults();
      if (selectedId && !app.roster.findGuest(app.get(), selectedId) && el.screens.confirm.classList.contains('active')) backToSearch();
    });
  }

  init();
})(self);
