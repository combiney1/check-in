// input: js/core/sky.js
// output: node:test cases for star layout and lit-count mapping
// pos: unit tests, run with `node --test tests/`
// Once I am updated, update my header comments and my folder's md doc.
const test = require('node:test');
const assert = require('node:assert/strict');
const sky = require('../js/core/sky.js');

const dist = (s, o) => Math.hypot((s.x - o.x) * sky.ASPECT, s.y - o.y);

test('layout is deterministic and has the requested size', () => {
  const a = sky.layout({ count: 120 });
  const b = sky.layout({ count: 120 });
  assert.equal(a.length, 120);
  assert.deepEqual(a, b);
  assert.notDeepEqual(sky.layout({ count: 120, seed: 7 }), a);
});

test('layout keeps stars on screen and out of the title zone', () => {
  sky.layout().forEach((s) => {
    assert.ok(s.x > 0 && s.x < 1 && s.y > 0 && s.y < 1);
    assert.equal(sky.inTitleZone(s.x, s.y), false);
  });
});

test('layout grows outward from the origin', () => {
  const stars = sky.layout();
  const head = stars.slice(0, 40).reduce((sum, s) => sum + dist(s, sky.ORIGIN), 0) / 40;
  const tail = stars.slice(-40).reduce((sum, s) => sum + dist(s, sky.ORIGIN), 0) / 40;
  assert.ok(head < tail / 2, `head ${head} should be much closer than tail ${tail}`);
});

test('litCount starts at the base block with nobody checked in', () => {
  assert.equal(sky.litCount(0, 100), sky.DEFAULTS.base);
  assert.equal(sky.litCount(0, 0), sky.DEFAULTS.base);
});

test('litCount lights at least one new star per check-in and never exceeds the slots', () => {
  const opts = { slots: 100, base: 20 };
  let prev = sky.litCount(0, 300, opts);
  for (let c = 1; c <= 80; c += 1) {
    const now = sky.litCount(c, 300, opts);
    assert.ok(now > prev, `check-in ${c} should light a new star`);
    prev = now;
  }
  assert.equal(sky.litCount(500, 300, opts), 100);
});

test('litCount spreads the free slots over the roster size', () => {
  const opts = { slots: 260, base: 40 };
  assert.equal(sky.litCount(50, 100, opts), 150);
  assert.equal(sky.litCount(100, 100, opts), 260);
  assert.equal(sky.litCount(3, 0, opts), 43);
});

test('litCount ignores invalid input', () => {
  assert.equal(sky.litCount(-5, 100), sky.DEFAULTS.base);
  assert.equal(sky.litCount('x', NaN), sky.DEFAULTS.base);
});

test('dust is deterministic', () => {
  assert.deepEqual(sky.dust({ count: 30 }), sky.dust({ count: 30 }));
  assert.equal(sky.dust({ count: 30 }).length, 30);
});
