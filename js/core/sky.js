// input: check-in count and roster size
// output: CK.sky — layout(), dust(), litCount(), inTitleZone(), ORIGIN, ASPECT, DEFAULTS for the star screen
// pos: core layer, pure deterministic star-field geometry; no DOM
// Once I am updated, update my header comments and my folder's md doc.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CK = Object.assign(root.CK || {}, { sky: api });
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ASPECT = 16 / 9;
  const ORIGIN = Object.freeze({ x: 0.5, y: 0.82 });
  const DEFAULTS = Object.freeze({ slots: 260, base: 40, seed: 20261030 });
  const MIN_GAP = 0.03;
  const MARGIN = 0.03;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function inTitleZone(x, y) {
    return y < 0.42 && Math.abs(x - 0.5) < 0.3;
  }

  function distance(ax, ay, bx, by) {
    return Math.hypot((ax - bx) * ASPECT, ay - by);
  }

  // Star slots sorted by the order they light up: a block near ORIGIN first, then outward.
  function layout({ count = DEFAULTS.slots, seed = DEFAULTS.seed, origin = ORIGIN } = {}) {
    const rand = mulberry32(seed);
    const picked = [];
    for (let tries = 0; picked.length < count && tries < count * 200; tries += 1) {
      const x = MARGIN + rand() * (1 - 2 * MARGIN);
      const y = MARGIN + rand() * (1 - 2 * MARGIN);
      if (inTitleZone(x, y) || picked.some((s) => distance(s.x, s.y, x, y) < MIN_GAP)) continue;
      picked.push({
        x,
        y,
        r: 1.2 + rand() * 1.6,
        phase: rand() * Math.PI * 2,
        speed: 0.6 + rand() * 1.2,
        tone: Math.floor(rand() * 3),
        rank: distance(x, y, origin.x, origin.y) * (0.75 + rand() * 0.5),
      });
    }
    return picked.sort((a, b) => a.rank - b.rank).map(({ rank, ...star }) => star);
  }

  // Faint background stars that never change.
  function dust({ count = 420, seed = DEFAULTS.seed + 1 } = {}) {
    const rand = mulberry32(seed);
    return Array.from({ length: count }, () => ({
      x: rand(),
      y: rand(),
      r: 0.4 + rand() * 0.8,
      alpha: 0.08 + rand() * 0.25,
      phase: rand() * Math.PI * 2,
    }));
  }

  function toCount(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // Number of lit slots: the base block plus the free slots spread over the roster, at least one per check-in.
  function litCount(checked, total, { slots = DEFAULTS.slots, base = DEFAULTS.base } = {}) {
    const c = toCount(checked);
    const t = toCount(total);
    if (c === 0) return base;
    const perGuest = t > 0 ? (slots - base) / t : 1;
    return Math.min(slots, base + Math.max(c, Math.round(c * perGuest)));
  }

  return { layout, dust, litCount, inTitleZone, ORIGIN, ASPECT, DEFAULTS };
});
