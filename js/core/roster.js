// input: pasted / CSV roster text, current app state, an id generator and timestamps
// output: CK.roster — parseRoster(), emptyState(), state transitions (import/check-in/undo/add/edit/remove), toCsv()
// pos: core layer, pure immutable state logic; every function returns a new state
// Once I am updated, update my header comments and my folder's md doc.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CK = Object.assign(root.CK || {}, { roster: api });
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const MAX_NAME_LEN = 40;
  const MAX_FIELD_LEN = 80;
  const MAX_LOG = 2000;
  const HEADER_ALIASES = {
    name: ['姓名', '名字', 'name', '来宾', '嘉宾'],
    company: ['公司', '单位', '部门', 'company', 'org', 'organization'],
    aliases: ['别名', '英文名', '拼音', 'alias', 'aliases', 'nickname'],
  };

  // Split one CSV / TSV line, honoring double quotes.
  function splitLine(line, delimiter) {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"' && cur.trim() === '') { quoted = true; cur = ''; }
      else if (ch === delimiter) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  }

  function detectDelimiter(lines) {
    const sample = lines.slice(0, 5).join('\n');
    if (sample.includes('\t')) return '\t';
    if (sample.includes(',')) return ',';
    if (sample.includes('，')) return '，';
    return null;
  }

  // Map header row to column indexes, or null when the first row is data.
  function headerMap(cells) {
    const lower = cells.map((c) => c.toLowerCase());
    const find = (names) => lower.findIndex((c) => names.includes(c));
    const map = { name: find(HEADER_ALIASES.name), company: find(HEADER_ALIASES.company), aliases: find(HEADER_ALIASES.aliases) };
    return map.name >= 0 ? map : null;
  }

  function cleanField(value, maxLen) {
    return String(value || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  }

  // Parse roster text into rows {name, company, aliases}; reports skipped lines in errors.
  function parseRoster(text) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return { rows: [], errors: [] };
    const delimiter = detectDelimiter(lines);
    const table = lines.map((l) => (delimiter ? splitLine(l, delimiter) : [l.trim()]));
    const header = headerMap(table[0]);
    const cols = header || { name: 0, company: 1, aliases: 2 };
    const body = header ? table.slice(1) : table;
    const firstLine = header ? 2 : 1;
    const rows = [];
    const errors = [];
    body.forEach((cells, i) => {
      const name = cleanField(cells[cols.name], MAX_FIELD_LEN);
      if (!name) { errors.push({ line: firstLine + i, reason: '姓名为空' }); return; }
      if (name.length > MAX_NAME_LEN) { errors.push({ line: firstLine + i, reason: '姓名过长' }); return; }
      rows.push({
        name,
        company: cols.company >= 0 ? cleanField(cells[cols.company], MAX_FIELD_LEN) : '',
        aliases: cols.aliases >= 0 ? cleanField(cells[cols.aliases], MAX_FIELD_LEN) : '',
      });
    });
    return { rows, errors };
  }

  function emptyState() {
    return { version: SCHEMA_VERSION, guests: [], log: [], settings: { eventTitle: 'AGI + WorkBuddy 分享会' } };
  }

  function guestKey(g) {
    return `${g.name}|${g.company || ''}`.toLowerCase();
  }

  function appendLog(state, entry) {
    const log = [...state.log, entry];
    return log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log;
  }

  function makeGuest(row, source, newId, now) {
    return {
      id: newId(),
      name: cleanField(row.name, MAX_NAME_LEN),
      company: cleanField(row.company, MAX_FIELD_LEN),
      aliases: cleanField(row.aliases, MAX_FIELD_LEN),
      source,
      createdAt: now,
      checkedInAt: null,
    };
  }

  // Add rows to the roster; exact duplicates (same name + company) are skipped.
  function importRows(state, rows, newId, now) {
    const seen = new Set(state.guests.map(guestKey));
    const added = [];
    const skipped = [];
    rows.forEach((row) => {
      const key = guestKey(row);
      if (seen.has(key)) { skipped.push(row); return; }
      seen.add(key);
      added.push(makeGuest(row, 'import', newId, now));
    });
    const next = {
      ...state,
      guests: [...state.guests, ...added],
      log: appendLog(state, { t: now, type: 'import', count: added.length }),
    };
    return { state: next, added, skipped };
  }

  function findGuest(state, id) {
    return state.guests.find((g) => g.id === id) || null;
  }

  function replaceGuest(state, id, patch) {
    return state.guests.map((g) => (g.id === id ? { ...g, ...patch } : g));
  }

  // Check in a guest; returns {ok:false, reason} when unknown or already checked in.
  function checkIn(state, id, now, via = 'kiosk') {
    const guest = findGuest(state, id);
    if (!guest) return { ok: false, reason: 'not_found', state };
    if (guest.checkedInAt) return { ok: false, reason: 'already', state, guest };
    const next = {
      ...state,
      guests: replaceGuest(state, id, { checkedInAt: now }),
      log: appendLog(state, { t: now, type: 'checkin', id, name: guest.name, via }),
    };
    return { ok: true, state: next, guest: findGuest(next, id) };
  }

  function undoCheckIn(state, id, now) {
    const guest = findGuest(state, id);
    if (!guest || !guest.checkedInAt) return { ok: false, state };
    const next = {
      ...state,
      guests: replaceGuest(state, id, { checkedInAt: null }),
      log: appendLog(state, { t: now, type: 'undo', id, name: guest.name }),
    };
    return { ok: true, state: next };
  }

  // Add a walk-in guest; optionally checks them in immediately.
  function addGuest(state, row, newId, now, { checkInNow = false } = {}) {
    const name = cleanField(row.name, MAX_NAME_LEN);
    if (!name) return { ok: false, reason: 'empty_name', state };
    if (state.guests.some((g) => guestKey(g) === guestKey({ ...row, name }))) return { ok: false, reason: 'duplicate', state };
    const guest = { ...makeGuest({ ...row, name }, 'walkin', newId, now), checkedInAt: checkInNow ? now : null };
    const next = {
      ...state,
      guests: [...state.guests, guest],
      log: appendLog(state, { t: now, type: 'add', id: guest.id, name, checkedIn: checkInNow }),
    };
    return { ok: true, state: next, guest };
  }

  function updateGuest(state, id, patch, now) {
    const guest = findGuest(state, id);
    if (!guest) return { ok: false, reason: 'not_found', state };
    const clean = {
      name: cleanField(patch.name ?? guest.name, MAX_NAME_LEN),
      company: cleanField(patch.company ?? guest.company, MAX_FIELD_LEN),
      aliases: cleanField(patch.aliases ?? guest.aliases, MAX_FIELD_LEN),
    };
    if (!clean.name) return { ok: false, reason: 'empty_name', state };
    const next = {
      ...state,
      guests: replaceGuest(state, id, clean),
      log: appendLog(state, { t: now, type: 'edit', id, name: clean.name }),
    };
    return { ok: true, state: next };
  }

  function removeGuest(state, id, now) {
    const guest = findGuest(state, id);
    if (!guest) return { ok: false, state };
    const next = {
      ...state,
      guests: state.guests.filter((g) => g.id !== id),
      log: appendLog(state, { t: now, type: 'remove', id, name: guest.name }),
    };
    return { ok: true, state: next };
  }

  function updateSettings(state, patch) {
    return { ...state, settings: { ...state.settings, ...patch } };
  }

  function stats(state) {
    const total = state.guests.length;
    const checked = state.guests.filter((g) => g.checkedInAt).length;
    const walkins = state.guests.filter((g) => g.source === 'walkin').length;
    return { total, checked, pending: total - checked, walkins };
  }

  // Guard against CSV formula injection when opened in Excel.
  function csvCell(value) {
    const text = String(value ?? '');
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }

  function formatTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // CSV with BOM so Excel opens Chinese correctly.
  function toCsv(state) {
    const header = ['姓名', '公司', '别名', '是否签到', '签到时间', '来源'];
    const lines = state.guests.map((g) => [
      g.name, g.company, g.aliases, g.checkedInAt ? '是' : '否', formatTime(g.checkedInAt), g.source === 'walkin' ? '现场添加' : '名单导入',
    ].map(csvCell).join(','));
    return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`;
  }

  function isGuest(g) {
    return g && typeof g.id === 'string' && typeof g.name === 'string' && g.name.trim() !== ''
      && (g.checkedInAt === null || typeof g.checkedInAt === 'number');
  }

  // Validate untrusted data (localStorage / backup file); returns a clean state or null.
  function validateState(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.guests)) return null;
    if (!data.guests.every(isGuest)) return null;
    const base = emptyState();
    return {
      version: SCHEMA_VERSION,
      guests: data.guests.map((g) => ({
        id: g.id,
        name: cleanField(g.name, MAX_NAME_LEN),
        company: cleanField(g.company, MAX_FIELD_LEN),
        aliases: cleanField(g.aliases, MAX_FIELD_LEN),
        source: g.source === 'walkin' ? 'walkin' : 'import',
        createdAt: typeof g.createdAt === 'number' ? g.createdAt : 0,
        checkedInAt: g.checkedInAt,
      })),
      log: Array.isArray(data.log) ? data.log.slice(-MAX_LOG) : [],
      settings: { ...base.settings, ...(data.settings && typeof data.settings === 'object' ? data.settings : {}) },
    };
  }

  return {
    SCHEMA_VERSION, parseRoster, emptyState, importRows, checkIn, undoCheckIn, addGuest,
    updateGuest, removeGuest, updateSettings, findGuest, stats, toCsv, formatTime, validateState,
  };
});
