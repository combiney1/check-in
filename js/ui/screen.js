// input: CK.sky, GET /api/sky from server.py (or this browser's localStorage when no server)
// output: animated star field on screen.html; more stars light up as check-ins grow
// pos: UI layer for the optional big screen; read-only, never writes check-in data
// Once I am updated, update my header comments and my folder's md doc.
(function (root) {
  'use strict';

  const { sky } = root.CK;
  const POLL_MS = 2000;
  const TIMEOUT_MS = 2500;
  const STALE_SEC = 30;
  const FADE_PER_SEC = 0.6;
  const IGNITE_MS = 1800;
  const IGNITE_STAGGER_MS = 260;
  const IGNITE_SPAN_MS = 6000;
  const LINK_DIST = 0.09;
  const TONES = [[124, 243, 255], [176, 107, 255], [230, 236, 255]];

  const canvas = document.getElementById('sky');
  const ctx = canvas.getContext('2d');
  const titleEl = document.getElementById('screen-event');
  const statusEl = document.getElementById('screen-status');
  const tipEl = document.getElementById('screen-tip');
  const logoEl = document.getElementById('screen-logo');

  const stars = sky.layout().map((s) => ({ ...s, glow: 0, igniteAt: 0 }));
  const dust = sky.dust();
  const links = stars.flatMap((a, i) => {
    const j = stars.slice(0, i).findIndex((b) => Math.hypot((a.x - b.x) * sky.ASPECT, a.y - b.y) < LINK_DIST);
    return j >= 0 ? [[i, j]] : [];
  });
  let target = sky.DEFAULTS.base;
  let shown = -1;
  let width = 0;
  let height = 0;
  let lastFrame = 0;

  function resize() {
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    width = root.innerWidth;
    height = root.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Apply a new lit count: first paint is instant, later increases ignite one by one.
  function setLit(next) {
    const now = performance.now();
    if (shown < 0) {
      stars.forEach((s, i) => { s.glow = i < next ? 1 : 0; });
    } else {
      const gap = Math.min(IGNITE_STAGGER_MS, IGNITE_SPAN_MS / Math.max(1, next - shown));
      stars.slice(shown, next).forEach((s, k) => { s.igniteAt = now + k * gap; });
    }
    shown = next;
    target = next;
    canvas.dataset.lit = String(next);
  }

  function starAlpha(s, i, t, now) {
    if (i >= target) return s.glow;
    if (s.igniteAt > now) return s.glow;
    const twinkle = 0.82 + 0.18 * Math.sin(t * s.speed + s.phase);
    return Math.min(1, s.glow) * twinkle;
  }

  function drawDust(t) {
    dust.forEach((d) => {
      const a = d.alpha * (0.7 + 0.3 * Math.sin(t * 0.8 + d.phase));
      ctx.fillStyle = `rgba(200,210,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(d.x * width, d.y * height, d.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawLinks(alphas) {
    ctx.lineWidth = 0.6;
    links.forEach(([i, j]) => {
      if (i >= target) return;
      const alpha = Math.min(alphas[i], alphas[j]) * 0.16;
      if (alpha < 0.01) return;
      ctx.strokeStyle = `rgba(150,190,255,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(stars[i].x * width, stars[i].y * height);
      ctx.lineTo(stars[j].x * width, stars[j].y * height);
      ctx.stroke();
    });
  }

  function drawStar(s, alpha, now) {
    const x = s.x * width;
    const y = s.y * height;
    const [r, g, b] = TONES[s.tone];
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.arc(x, y, 0.8, 0, Math.PI * 2);
    ctx.fill();
    if (alpha < 0.01) return;
    const halo = s.r * 7;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, halo);
    grad.addColorStop(0, `rgba(${r},${g},${b},${(alpha * 0.55).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, halo, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
    const age = now - s.igniteAt;
    if (s.igniteAt && age > 0 && age < IGNITE_MS) drawFlare(x, y, s, age / IGNITE_MS, [r, g, b]);
  }

  function drawFlare(x, y, s, p, [r, g, b]) {
    const fade = 1 - p;
    ctx.strokeStyle = `rgba(${r},${g},${b},${(fade * 0.8).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, s.r * 4 + p * 60, 0, Math.PI * 2);
    ctx.stroke();
    const len = s.r * 10 * fade + s.r * 2;
    ctx.strokeStyle = `rgba(255,255,255,${(fade * 0.9).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - len, y); ctx.lineTo(x + len, y);
    ctx.moveTo(x, y - len); ctx.lineTo(x, y + len);
    ctx.stroke();
  }

  function step(dt, now) {
    stars.forEach((s, i) => {
      const goal = i < target && s.igniteAt <= now ? 1 : 0;
      const delta = FADE_PER_SEC * dt * (goal > s.glow ? 3 : 1);
      s.glow = goal > s.glow ? Math.min(goal, s.glow + delta) : Math.max(goal, s.glow - delta);
    });
  }

  function frame(ms) {
    const dt = lastFrame ? Math.min(0.1, (ms - lastFrame) / 1000) : 0;
    lastFrame = ms;
    step(dt, ms);
    const t = ms / 1000;
    ctx.clearRect(0, 0, width, height);
    drawDust(t);
    const alphas = stars.map((s, i) => starAlpha(s, i, t, ms));
    drawLinks(alphas);
    stars.forEach((s, i) => drawStar(s, alphas[i], ms));
    root.requestAnimationFrame(frame);
  }

  function readLocal() {
    try {
      const state = JSON.parse(root.localStorage.getItem('ck.state.v1') || 'null');
      if (!state || !Array.isArray(state.guests)) return null;
      const title = state.settings && typeof state.settings.eventTitle === 'string' ? state.settings.eventTitle : '';
      return { checked: state.guests.filter((g) => g && g.checkedInAt).length, total: state.guests.length, title };
    } catch (_err) {
      return null;
    }
  }

  async function readServer() {
    if (!/^https?:$/.test(root.location.protocol)) return null;
    const ctrl = new AbortController();
    const abort = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await root.fetch('api/sky', { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) return null;
      const data = await res.json();
      return Number.isFinite(data.checked) && Number.isFinite(data.total) ? data : null;
    } catch (_err) {
      return null;
    } finally {
      clearTimeout(abort);
    }
  }

  function apply(data, online) {
    statusEl.hidden = online;
    if (!data) { if (shown < 0) setLit(sky.DEFAULTS.base); return; }
    if (data.title) titleEl.textContent = data.title;
    const next = sky.litCount(data.checked, data.total, { slots: stars.length });
    if (next !== shown) setLit(next);
  }

  async function poll() {
    const remote = await readServer();
    const fresh = remote && remote.devices > 0 && remote.ageSec !== null && remote.ageSec < STALE_SEC;
    const local = readLocal();
    if (remote && remote.devices > 0) apply(remote, fresh);
    else apply(local, Boolean(remote) || Boolean(local && local.total > 0));
    root.setTimeout(poll, POLL_MS);
  }

  function goFullscreen() {
    tipEl.classList.add('gone');
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => null);
  }

  function init() {
    try {
      const custom = root.localStorage.getItem('ck.logo.v1');
      if (custom && custom.startsWith('data:image/')) logoEl.src = custom;
    } catch (_err) { /* default logo stays */ }
    logoEl.addEventListener('error', () => { logoEl.hidden = true; });
    resize();
    root.addEventListener('resize', resize);
    document.addEventListener('click', goFullscreen);
    root.setTimeout(() => tipEl.classList.add('gone'), 8000);
    poll();
    root.requestAnimationFrame(frame);
  }

  init();
})(self);
