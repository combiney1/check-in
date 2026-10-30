// input: js/core/pinyin-keys.js, js/core/matcher.js, vendor/pinyin-pro.js
// output: node:test cases for pinyin indexing and search ranking
// pos: unit tests, run with `node --test tests/`
// Once I am updated, update my header comments and my folder's md doc.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pinyin } = require('../vendor/pinyin-pro.js');
const keys = require('../js/core/pinyin-keys.js');
const matcher = require('../js/core/matcher.js');

const guests = [
  { id: 'a', name: '张三', aliases: '' },
  { id: 'b', name: '张珊珊', aliases: '' },
  { id: 'c', name: '曾小贤', aliases: '' },
  { id: 'd', name: '单田芳', aliases: '' },
  { id: 'e', name: '吕布', aliases: '' },
  { id: 'f', name: 'Tom Hanks', aliases: '' },
  { id: 'g', name: '李乐', aliases: 'Leo' },
  { id: 'h', name: '欧阳娜娜', aliases: '' },
];
const entries = guests.map((g) => keys.buildEntry(g, pinyin));
const ids = (q) => matcher.search(q, entries).map((r) => r.id);

test('normalize strips spaces, punctuation and maps ü to v', () => {
  assert.equal(keys.normalize(' Z S '), 'zs');
  assert.equal(keys.normalize('lǚ'), 'lv');
  assert.equal(keys.normalize('张-三'), '张三');
});

test('initials match', () => {
  assert.deepEqual(ids('zs'), ['a', 'b']);
  assert.deepEqual(ids('ZXX'), ['c']);
});

test('initial prefix returns all candidates, shorter names first', () => {
  assert.deepEqual(ids('z').slice(0, 3), ['a', 'b', 'c']);
});

test('full pinyin and mixed input match', () => {
  assert.deepEqual(ids('zhangsan'), ['a']);
  assert.deepEqual(ids('zhangs'), ['a', 'b']);
  assert.deepEqual(ids('zhangsa'), ['a']);
  assert.deepEqual(ids('zhang shan'), ['b']);
});

test('polyphone surnames match both readings', () => {
  assert.ok(ids('zxx').includes('c'));
  assert.ok(ids('cxx').includes('c'));
  assert.ok(ids('stf').includes('d'));
  assert.ok(ids('dtf').includes('d'));
});

test('ü matches both v and u', () => {
  assert.ok(ids('lb').includes('e'));
  assert.ok(ids('lvbu').includes('e'));
  assert.ok(ids('lubu').includes('e'));
});

test('Han input matches by substring', () => {
  assert.deepEqual(ids('张三'), ['a']);
  assert.deepEqual(ids('小贤'), ['c']);
});

test('English names match initials and words', () => {
  assert.deepEqual(ids('th'), ['f']);
  assert.deepEqual(ids('tom'), ['f']);
  assert.deepEqual(ids('hanks'), ['f']);
});

test('aliases are searchable', () => {
  assert.deepEqual(ids('leo'), ['g']);
});

test('compound surnames work', () => {
  assert.deepEqual(ids('oynn'), ['h']);
});

test('empty and junk queries return nothing', () => {
  assert.deepEqual(ids(''), []);
  assert.deepEqual(ids('   '), []);
  assert.deepEqual(ids('qqqq'), []);
});

test('matches at name start rank above matches in the middle', () => {
  const extra = [...entries, keys.buildEntry({ id: 'x', name: '三木', aliases: '' }, pinyin)];
  const res = matcher.search('s', extra).map((r) => r.id);
  assert.ok(res.indexOf('x') < res.indexOf('a'));
});

test('describe gives readable pinyin', () => {
  assert.equal(keys.describe(entries[0]), 'zhang san / ZS');
});

test('search over 100 guests stays fast', () => {
  const many = Array.from({ length: 300 }, (_, i) => keys.buildEntry({ id: `m${i}`, name: `王${'晓明亮'[i % 3]}${i}` }, pinyin));
  const t0 = performance.now();
  for (let i = 0; i < 50; i += 1) matcher.search('wxm', many);
  assert.ok((performance.now() - t0) / 50 < 20);
});
