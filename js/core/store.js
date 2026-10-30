// input: a Storage-like object (localStorage), CK.roster.validateState
// output: CK.store — createStore(storage, clock, {namespace}) with load() / save() / snapshots() / restoreSnapshot()
// pos: persistence layer; main copy + rolling snapshots so a corrupt write never loses the list
// Once I am updated, update my header comments and my folder's md doc.
(function (root, factory) {
  const roster = typeof module === 'object' && module.exports ? require('./roster.js') : root.CK.roster;
  const api = factory(roster);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CK = Object.assign(root.CK || {}, { store: api });
})(typeof self !== 'undefined' ? self : this, function (roster) {
  'use strict';

  const MAIN_KEY = 'ck.state.v1';
  const SNAP_PREFIX = 'ck.snap.v1.';
  const SNAP_COUNT = 5;
  const SNAP_INTERVAL_MS = 60 * 1000;

  function parse(raw) {
    if (!raw) return null;
    try {
      return roster.validateState(JSON.parse(raw));
    } catch (_err) {
      return null;
    }
  }

  // Store bound to one Storage; `clock` is injectable for tests, `namespace` isolates exported demos.
  function createStore(storage, clock = () => Date.now(), { namespace = '' } = {}) {
    const mainKey = `${namespace}${MAIN_KEY}`;
    const snapPrefix = `${namespace}${SNAP_PREFIX}`;
    let lastSnapAt = 0;

    function snapKeys() {
      const keys = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k && k.startsWith(snapPrefix)) keys.push(k);
      }
      return keys.sort();
    }

    function snapshots() {
      return snapKeys().reverse().map((key) => {
        const state = parse(storage.getItem(key));
        const at = Number(key.slice(snapPrefix.length));
        return state ? { key, at, stats: roster.stats(state) } : null;
      }).filter(Boolean);
    }

    function writeSnapshot(raw) {
      const now = clock();
      if (now - lastSnapAt < SNAP_INTERVAL_MS) return;
      storage.setItem(`${snapPrefix}${String(now).padStart(15, '0')}`, raw);
      lastSnapAt = now;
      const keys = snapKeys();
      keys.slice(0, Math.max(0, keys.length - SNAP_COUNT)).forEach((k) => storage.removeItem(k));
    }

    // Load main copy; falls back to newest valid snapshot. `recovered` tells the UI which path was used.
    function load() {
      const main = parse(storage.getItem(mainKey));
      if (main) return { state: main, recovered: false };
      const hadMain = storage.getItem(mainKey) !== null;
      const snap = snapKeys().reverse().map((k) => parse(storage.getItem(k))).find(Boolean);
      if (snap) return { state: snap, recovered: hadMain ? 'snapshot' : false };
      return { state: roster.emptyState(), recovered: hadMain ? 'reset' : false };
    }

    // Persist state; returns {ok:false, error} instead of throwing (quota, private mode).
    function save(state) {
      try {
        const raw = JSON.stringify(state);
        storage.setItem(mainKey, raw);
        try { writeSnapshot(raw); } catch (_snapErr) { /* snapshot is best-effort */ }
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    }

    function restoreSnapshot(key) {
      const state = parse(storage.getItem(key));
      return state ? { ok: true, state } : { ok: false };
    }

    return { load, save, snapshots, restoreSnapshot, mainKey };
  }

  return { createStore, MAIN_KEY, SNAP_PREFIX };
});
