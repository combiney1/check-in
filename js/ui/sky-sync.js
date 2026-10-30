// input: CK.app (state + onChange), POST /api/sky on server.py
// output: best-effort push of this device's check-in counts to the star screen; dispatches 'ck:sky' {ok} on document; never blocks or alters check-in
// pos: optional UI add-on loaded last on index.html / admin.html; silent when no server is reachable
// Once I am updated, update my header comments and my folder's md doc.
(function (root) {
  'use strict';

  const ENDPOINT = 'api/sky';
  const DEVICE_KEY = 'ck.device.v1';
  const HEARTBEAT_MS = 5000;
  const TIMEOUT_MS = 3000;
  const DEBOUNCE_MS = 200;

  if (!/^https?:$/.test(root.location.protocol) || !root.fetch || !root.CK || !root.CK.app) return;
  const { app } = root.CK;

  function deviceId() {
    try {
      const saved = root.localStorage.getItem(DEVICE_KEY);
      if (saved && /^[\w-]{4,64}$/.test(saved)) return saved;
      const id = app.newId().replace(/[^\w-]/g, '').slice(0, 64);
      root.localStorage.setItem(DEVICE_KEY, id);
      return id;
    } catch (_err) {
      return `tmp-${Math.random().toString(36).slice(2, 12)}`;
    }
  }

  const device = deviceId();
  let inFlight = false;
  let timer = null;

  function payload() {
    const state = app.get();
    const { total, checked } = app.roster.stats(state);
    return JSON.stringify({ device, checked, total, title: String(state.settings.eventTitle || '') });
  }

  // Send current counts; failures are ignored, the next heartbeat retries.
  function push() {
    if (inFlight) return;
    inFlight = true;
    const ctrl = root.AbortController ? new root.AbortController() : null;
    const abort = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    let body;
    try { body = payload(); } catch (_err) { inFlight = false; return; }
    root.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
      keepalive: true,
      signal: ctrl ? ctrl.signal : undefined,
    }).then((res) => report(res.ok), () => report(false)).finally(() => { inFlight = false; clearTimeout(abort); });
  }

  function report(ok) {
    try { document.dispatchEvent(new root.CustomEvent('ck:sky', { detail: { ok } })); } catch (_err) { /* status is cosmetic */ }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(push, DEBOUNCE_MS);
  }

  app.onChange((_state, source) => { if (source !== 'logo') schedule(); });
  setInterval(push, HEARTBEAT_MS);
  schedule();
})(self);
