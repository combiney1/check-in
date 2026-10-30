// input: CK.store, CK.roster, CK.pinyinKeys, window.pinyinPro, localStorage, optional self.CK_SEED (exported demo)
// output: CK.app — shared state holder: get(), commit(), onChange(), entries(), logo + PIN helpers, demo reset, toast()
// pos: UI glue layer shared by kiosk and admin pages; syncs tabs via the storage event
// Once I am updated, update my header comments and my folder's md doc.
(function (root) {
  'use strict';

  const { store: storeLib, roster, pinyinKeys } = root.CK;
  const MAX_LOGO_BYTES = 600 * 1024;
  const DEFAULT_PIN = '0000';
  const seed = readSeed(root.CK_SEED);
  const namespace = seed ? `ck.demo.${seed.id}.` : '';
  const LOGO_KEY = `${namespace}ck.logo.v1`;
  const DEFAULT_LOGO = (seed && seed.logo) || root.CK_DEFAULT_LOGO || 'assets/logo.png';

  const storage = safeStorage();
  const store = storeLib.createStore(storage, undefined, { namespace });
  const listeners = new Set();
  const loaded = initialLoad();
  let state = loaded.state;
  let index = buildIndex(state);
  let lastSaveError = null;

  // Validate the seed embedded in an exported demo file.
  function readSeed(raw) {
    if (!raw || typeof raw !== 'object' || !/^[\w-]{4,64}$/.test(String(raw.id || ''))) return null;
    const seedState = roster.validateState(raw.state);
    if (!seedState) return null;
    const logo = typeof raw.logo === 'string' && raw.logo.startsWith('data:image/') ? raw.logo : null;
    return { id: raw.id, state: seedState, logo };
  }

  // localStorage, or an in-memory stand-in when the browser blocks it (some file:// setups).
  function safeStorage() {
    try {
      const ls = root.localStorage;
      const probe = '__ck_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    } catch (_err) {
      const map = new Map();
      return {
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
      };
    }
  }

  function initialLoad() {
    if (seed && storage.getItem(store.mainKey) === null) {
      store.save(seed.state);
      return { state: seed.state, recovered: false };
    }
    return store.load();
  }

  function buildIndex(s) {
    return s.guests.map((g) => pinyinKeys.buildEntry(g, root.pinyinPro.pinyin));
  }

  function notify(source) {
    listeners.forEach((fn) => fn(state, source));
  }

  // Replace state, persist, rebuild search index; returns save result.
  function commit(next) {
    const guestsChanged = next.guests !== state.guests;
    state = next;
    if (guestsChanged) index = buildIndex(state);
    const res = store.save(state);
    lastSaveError = res.ok ? null : res.error;
    notify('local');
    return res;
  }

  root.addEventListener('storage', (event) => {
    if (event.key === store.mainKey) {
      state = store.load().state;
      index = buildIndex(state);
      notify('remote');
    }
    if (event.key === LOGO_KEY) notify('logo');
  });

  function newId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  function logoUrl() {
    const custom = storage.getItem(LOGO_KEY);
    return custom && custom.startsWith('data:image/') ? custom : DEFAULT_LOGO;
  }

  // Store an uploaded logo as data URL; rejects non-images and oversize files.
  function setLogo(file) {
    return new Promise((resolve) => {
      if (!file || !/^image\//.test(file.type)) { resolve({ ok: false, reason: '请选择图片文件' }); return; }
      if (file.size > MAX_LOGO_BYTES) { resolve({ ok: false, reason: '图片需小于 600KB' }); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          storage.setItem(LOGO_KEY, String(reader.result));
          notify('logo');
          resolve({ ok: true });
        } catch (_err) {
          resolve({ ok: false, reason: '存储空间不足' });
        }
      };
      reader.onerror = () => resolve({ ok: false, reason: '读取图片失败' });
      reader.readAsDataURL(file);
    });
  }

  function resetLogo() {
    storage.removeItem(LOGO_KEY);
    notify('logo');
  }

  function checkPin(pin) {
    return String(pin) === String(state.settings.adminPin || DEFAULT_PIN);
  }

  // Demo files only: put the roster back to how it was exported.
  function resetDemo() {
    if (!seed) return { ok: false };
    return commit(seed.state);
  }

  // Custom logo as data URL, or null when the default is in use.
  function customLogo() {
    const custom = storage.getItem(LOGO_KEY);
    return custom && custom.startsWith('data:image/') ? custom : null;
  }

  let toastTimer = null;
  // Short message at the bottom of the screen.
  function toast(message, kind = 'info') {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
  }

  root.CK.app = {
    get: () => state,
    entries: () => index,
    commit,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    recovered: loaded.recovered,
    saveError: () => lastSaveError,
    snapshots: () => store.snapshots(),
    restoreSnapshot: (key) => store.restoreSnapshot(key),
    newId,
    now: () => Date.now(),
    logoUrl,
    setLogo,
    resetLogo,
    customLogo,
    checkPin,
    isDemo: Boolean(seed),
    resetDemo,
    toast,
    roster,
  };
})(self);
