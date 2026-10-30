// input: CK.app, CK.dom, CK.demoExport (optional); import / backup controls in admin.html
// output: CK.adminIo.init() — roster import with preview, CSV / JSON / single-file demo export, backup + snapshot restore, bulk resets
// pos: UI page controller (data in / out half of the admin page)
// Once I am updated, update my header comments and my folder's md doc.
(function (root) {
  'use strict';

  const { app, dom } = root.CK;
  const { h, $, clear } = dom;
  const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

  let pendingRows = [];

  function stamp() {
    return app.roster.formatTime(app.now()).replace(/[-: ]/g, '').slice(0, 12);
  }

  // Trigger a file download from a string.
  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function readText(file) {
    return new Promise((resolve, reject) => {
      if (file.size > MAX_IMPORT_BYTES) { reject(new Error('文件超过 2MB')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file, 'utf-8');
    });
  }

  function previewImport() {
    const { rows, errors } = app.roster.parseRoster($('#import-text').value);
    pendingRows = rows;
    const out = clear($('#import-result'));
    out.appendChild(h('p', {}, `识别到 ${rows.length} 人${errors.length ? `，跳过 ${errors.length} 行` : ''}。`));
    if (rows.length) {
      const sample = rows.slice(0, 5).map((r) => [r.name, r.company, r.aliases].filter(Boolean).join(' · '));
      out.appendChild(h('ul', {}, sample.map((s) => h('li', {}, s))));
      if (rows.length > 5) out.appendChild(h('p', {}, `…还有 ${rows.length - 5} 人`));
    }
    errors.slice(0, 5).forEach((e) => out.appendChild(h('p', { class: 'warn' }, `第 ${e.line} 行：${e.reason}`)));
    $('#import-apply').disabled = rows.length === 0;
  }

  function applyImport() {
    if (pendingRows.length === 0) return;
    const res = app.roster.importRows(app.get(), pendingRows, app.newId, app.now());
    app.commit(res.state);
    pendingRows = [];
    $('#import-apply').disabled = true;
    $('#import-text').value = '';
    clear($('#import-result')).appendChild(h('p', {}, `已导入 ${res.added.length} 人${res.skipped.length ? `，${res.skipped.length} 人已存在被跳过` : ''}。`));
    app.toast(`已导入 ${res.added.length} 人`, 'ok');
  }

  async function loadImportFile(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      $('#import-text').value = await readText(file);
      previewImport();
    } catch (err) {
      app.toast(err.message, 'error');
    }
  }

  async function restoreBackup(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = app.roster.validateState(JSON.parse(await readText(file)));
      if (!data) throw new Error('备份文件格式不正确');
      const s = app.roster.stats(data);
      if (!root.confirm(`用备份覆盖当前数据？\n备份内容：${s.total} 人，已签到 ${s.checked} 人`)) return;
      app.commit(data);
      app.toast('已从备份恢复', 'ok');
    } catch (err) {
      app.toast(err instanceof SyntaxError ? '备份文件不是有效 JSON' : err.message, 'error');
    }
  }

  function renderSnapshots() {
    const box = clear($('#snapshots'));
    const snaps = app.snapshots();
    if (snaps.length === 0) { box.appendChild(h('p', { class: 'muted' }, '暂无自动快照')); return; }
    box.appendChild(h('ul', { class: 'snap-list' }, snaps.map((snap) => h('li', {}, [
      h('span', {}, `${app.roster.formatTime(snap.at)} · ${snap.stats.total} 人 / 已签 ${snap.stats.checked}`),
      h('button', { type: 'button', onclick: () => restoreSnapshot(snap) }, '恢复'),
    ]))));
  }

  function restoreSnapshot(snap) {
    if (!root.confirm(`恢复到 ${app.roster.formatTime(snap.at)} 的快照？当前数据会被覆盖。`)) return;
    const res = app.restoreSnapshot(snap.key);
    if (!res.ok) { app.toast('快照已损坏，无法恢复', 'error'); return; }
    app.commit(res.state);
    app.toast('已恢复快照', 'ok');
  }

  function resetCheckins() {
    const { checked } = app.roster.stats(app.get());
    if (checked === 0) { app.toast('当前没有签到记录'); return; }
    if (root.prompt(`将清空 ${checked} 条签到记录（名单保留）。输入「清空」确认`) !== '清空') return;
    download(`签到表_清空前_${stamp()}.csv`, app.roster.toCsv(app.get()), 'text/csv;charset=utf-8');
    const state = app.get();
    app.commit({ ...state, guests: state.guests.map((g) => ({ ...g, checkedInAt: null })), log: [...state.log, { t: app.now(), type: 'reset', count: checked }] });
    app.toast('已清空签到记录，并自动下载了清空前的签到表', 'ok');
  }

  function clearAll() {
    const { total } = app.roster.stats(app.get());
    if (total === 0) return;
    if (root.prompt(`将删除全部 ${total} 位来宾及签到记录。输入「删除」确认`) !== '删除') return;
    download(`签到备份_删除前_${stamp()}.json`, JSON.stringify(app.get(), null, 2), 'application/json');
    const state = app.get();
    app.commit({ ...state, guests: [], log: [...state.log, { t: app.now(), type: 'clear', count: total }] });
    app.toast('已删除全部名单，并自动下载了删除前的备份', 'ok');
  }

  async function exportDemo(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const html = await root.CK.demoExport.build({ clearCheckins: $('#export-demo-clear').checked });
      download(`签到Demo_${stamp()}.html`, html, 'text/html;charset=utf-8');
      app.toast('已导出单文件 Demo，双击即可打开', 'ok');
    } catch (err) {
      app.toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function resetDemo() {
    if (root.prompt('将清空本 Demo 中的所有改动，恢复为导出时的名单。输入「重置」确认') !== '重置') return;
    app.resetDemo();
    app.toast('已重置为初始名单', 'ok');
  }

  function setupDemo() {
    $('#demo-export-row').hidden = app.isDemo || !root.CK.demoExport;
    $('#demo-reset-row').hidden = !app.isDemo;
    $('#export-demo').addEventListener('click', exportDemo);
    $('#demo-reset').addEventListener('click', resetDemo);
  }

  function init() {
    setupDemo();
    $('#import-preview').addEventListener('click', previewImport);
    $('#import-apply').addEventListener('click', applyImport);
    $('#import-file').addEventListener('change', loadImportFile);
    $('#export-csv').addEventListener('click', () => download(`签到表_${stamp()}.csv`, app.roster.toCsv(app.get()), 'text/csv;charset=utf-8'));
    $('#export-json').addEventListener('click', () => download(`签到备份_${stamp()}.json`, JSON.stringify(app.get(), null, 2), 'application/json'));
    $('#restore-json').addEventListener('change', restoreBackup);
    $('#reset-checkins').addEventListener('click', resetCheckins);
    $('#clear-all').addEventListener('click', clearAll);
    renderSnapshots();
    app.onChange(renderSnapshots);
  }

  root.CK.adminIo = { init };
})(self);
