// input: js/core/roster.js, js/core/store.js
// output: node:test cases for roster parsing, state transitions, CSV export and persistence
// pos: unit tests, run with `node --test tests/`
// Once I am updated, update my header comments and my folder's md doc.
const test = require('node:test');
const assert = require('node:assert/strict');
const roster = require('../js/core/roster.js');
const { createStore, MAIN_KEY } = require('../js/core/store.js');

let seq = 0;
const newId = () => `id${(seq += 1)}`;

function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function seeded() {
  const { rows } = roster.parseRoster('张三,ACME\n李四,Foo\n王五');
  return roster.importRows(roster.emptyState(), rows, newId, 1000).state;
}

test('parse one name per line', () => {
  const { rows, errors } = roster.parseRoster('张三\n\n 李四 \n');
  assert.deepEqual(rows.map((r) => r.name), ['张三', '李四']);
  assert.equal(errors.length, 0);
});

test('parse CSV with header in any column order and BOM', () => {
  const { rows } = roster.parseRoster('﻿公司,姓名,英文名\nACME,张三,Leo\n"Foo, Inc",李四,');
  assert.deepEqual(rows[0], { name: '张三', company: 'ACME', aliases: 'Leo' });
  assert.equal(rows[1].company, 'Foo, Inc');
});

test('parse TSV pasted from Excel', () => {
  const { rows } = roster.parseRoster('姓名\t公司\n张三\tACME');
  assert.deepEqual(rows[0], { name: '张三', company: 'ACME', aliases: '' });
});

test('parse reports empty names with line numbers', () => {
  const { rows, errors } = roster.parseRoster('姓名,公司\n,ACME\n张三,B');
  assert.equal(rows.length, 1);
  assert.deepEqual(errors, [{ line: 2, reason: '姓名为空' }]);
});

test('import skips exact duplicates, keeps same name at different company', () => {
  const s = seeded();
  const { rows } = roster.parseRoster('张三,ACME\n张三,Other');
  const res = roster.importRows(s, rows, newId, 2000);
  assert.equal(res.added.length, 1);
  assert.equal(res.skipped.length, 1);
  assert.equal(res.state.guests.length, 4);
});

test('state functions do not mutate input', () => {
  const s = seeded();
  const frozen = JSON.stringify(s);
  roster.checkIn(s, s.guests[0].id, 5000);
  roster.addGuest(s, { name: '赵六' }, newId, 5000);
  roster.removeGuest(s, s.guests[0].id, 5000);
  assert.equal(JSON.stringify(s), frozen);
});

test('check-in is once only and logged', () => {
  const s = seeded();
  const id = s.guests[0].id;
  const first = roster.checkIn(s, id, 5000);
  assert.ok(first.ok);
  assert.equal(first.guest.checkedInAt, 5000);
  const again = roster.checkIn(first.state, id, 6000);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already');
  assert.equal(again.guest.checkedInAt, 5000);
  assert.equal(first.state.log.at(-1).type, 'checkin');
});

test('check-in of unknown id fails', () => {
  assert.equal(roster.checkIn(seeded(), 'nope', 1).reason, 'not_found');
});

test('undo clears check-in', () => {
  const s = seeded();
  const id = s.guests[1].id;
  const done = roster.checkIn(s, id, 5000).state;
  const undone = roster.undoCheckIn(done, id, 6000);
  assert.ok(undone.ok);
  assert.equal(roster.findGuest(undone.state, id).checkedInAt, null);
  assert.equal(roster.undoCheckIn(undone.state, id, 7000).ok, false);
});

test('walk-in guest can be added and checked in at once', () => {
  const res = roster.addGuest(seeded(), { name: ' 赵六 ', company: 'X' }, newId, 9000, { checkInNow: true });
  assert.ok(res.ok);
  assert.equal(res.guest.name, '赵六');
  assert.equal(res.guest.source, 'walkin');
  assert.equal(res.guest.checkedInAt, 9000);
  assert.equal(roster.stats(res.state).walkins, 1);
});

test('walk-in rejects empty name and duplicates', () => {
  assert.equal(roster.addGuest(seeded(), { name: '  ' }, newId, 1).reason, 'empty_name');
  assert.equal(roster.addGuest(seeded(), { name: '张三', company: 'ACME' }, newId, 1).reason, 'duplicate');
});

test('update and remove guest', () => {
  const s = seeded();
  const id = s.guests[2].id;
  const up = roster.updateGuest(s, id, { aliases: 'Wang' }, 1);
  assert.equal(roster.findGuest(up.state, id).aliases, 'Wang');
  assert.equal(roster.updateGuest(s, id, { name: '' }, 1).ok, false);
  const rm = roster.removeGuest(up.state, id, 2);
  assert.equal(rm.state.guests.length, 2);
});

test('stats counts', () => {
  const s = seeded();
  const done = roster.checkIn(s, s.guests[0].id, 1).state;
  assert.deepEqual(roster.stats(done), { total: 3, checked: 1, pending: 2, walkins: 0 });
});

test('CSV export has BOM, quotes commas, blocks formula injection', () => {
  const s = roster.addGuest(roster.emptyState(), { name: '=HYPERLINK("x")', company: 'A, B' }, newId, 1).state;
  const csv = roster.toCsv(s);
  assert.ok(csv.startsWith('﻿姓名,'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"A, B"'));
});

test('validateState rejects garbage and keeps settings defaults', () => {
  assert.equal(roster.validateState(null), null);
  assert.equal(roster.validateState({ guests: [{ id: 1 }] }), null);
  const ok = roster.validateState({ guests: [{ id: 'a', name: '张三', checkedInAt: null }] });
  assert.equal(ok.guests[0].source, 'import');
  assert.ok(ok.settings.eventTitle);
});

test('store round-trips state', () => {
  const store = createStore(memoryStorage());
  const s = seeded();
  assert.ok(store.save(s).ok);
  assert.deepEqual(store.load().state, s);
});

test('store recovers from corrupted main copy via snapshot', () => {
  const storage = memoryStorage();
  const store = createStore(storage, () => 100000);
  store.save(seeded());
  storage.setItem(MAIN_KEY, '{broken');
  const res = store.load();
  assert.equal(res.recovered, 'snapshot');
  assert.equal(res.state.guests.length, 3);
});

test('store keeps at most 5 snapshots', () => {
  const storage = memoryStorage();
  let now = 0;
  const store = createStore(storage, () => (now += 61000));
  for (let i = 0; i < 9; i += 1) store.save(seeded());
  assert.equal(store.snapshots().length, 5);
});

test('store save reports quota errors instead of throwing', () => {
  const storage = { ...memoryStorage(), setItem: () => { throw new Error('QuotaExceeded'); } };
  const res = createStore(storage).save(seeded());
  assert.equal(res.ok, false);
});

test('empty storage loads an empty state without recovery flag', () => {
  const res = createStore(memoryStorage()).load();
  assert.equal(res.recovered, false);
  assert.equal(res.state.guests.length, 0);
});
