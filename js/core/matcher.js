// input: index entries from pinyin-keys.buildEntry(), a raw query string
// output: CK.matcher — matchSyllables(), scoreEntry(), search() returning ranked guest ids
// pos: core layer, pure search logic (initials / full pinyin / mixed / Han / alias)
// Once I am updated, update my header comments and my folder's md doc.
(function (root, factory) {
  const keys = typeof module === 'object' && module.exports ? require('./pinyin-keys.js') : root.CK.pinyinKeys;
  const api = factory(keys);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CK = Object.assign(root.CK || {}, { matcher: api });
})(typeof self !== 'undefined' ? self : this, function (keys) {
  'use strict';

  const HAN_RE = /[㐀-鿿]/;
  const SCORE = { hanExact: 120, hanPrefix: 110, fromStart: 100, alias: 90, hanContains: 70, fromMiddle: 60 };
  const DEFAULT_LIMIT = 8;

  // True if the query can be split into consecutive syllable prefixes starting at syllable `start`.
  function matchFrom(query, syllables, qi, si) {
    if (qi === query.length) return true;
    if (si === syllables.length) return false;
    const syl = syllables[si];
    const maxLen = Math.min(syl.length, query.length - qi);
    for (let k = maxLen; k >= 1; k -= 1) {
      if (query.startsWith(syl.slice(0, k), qi) && matchFrom(query, syllables, qi + k, si + 1)) return true;
    }
    return false;
  }

  // Lowest syllable index where the query matches, or -1. "zs" / "zhangs" / "zhangsan" all match 张三 at 0.
  function matchSyllables(query, syllables) {
    for (let start = 0; start < syllables.length; start += 1) {
      if (matchFrom(query, syllables, 0, start)) return start;
    }
    return -1;
  }

  function bestSetMatch(query, sets) {
    return sets.reduce((best, set) => {
      const at = matchSyllables(query, set);
      return at >= 0 && (best < 0 || at < best) ? at : best;
    }, -1);
  }

  // Score for one entry, 0 when it does not match.
  function scoreEntry(query, entry) {
    if (!query) return 0;
    if (HAN_RE.test(query)) {
      if (entry.nameNorm === query) return SCORE.hanExact;
      if (entry.nameNorm.startsWith(query)) return SCORE.hanPrefix;
      return entry.nameNorm.includes(query) ? SCORE.hanContains : 0;
    }
    const at = bestSetMatch(query, entry.sets);
    if (at === 0) return SCORE.fromStart;
    if (bestSetMatch(query, entry.aliasSets) >= 0) return SCORE.alias;
    return at > 0 ? SCORE.fromMiddle : 0;
  }

  // Ranked matches: [{id, score}], higher score first, then shorter name, then list order.
  function search(rawQuery, entries, limit = DEFAULT_LIMIT) {
    const query = keys.normalize(rawQuery);
    if (!query) return [];
    return entries
      .map((entry, order) => ({ id: entry.id, score: scoreEntry(query, entry), len: entry.nameNorm.length, order }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.len - b.len || a.order - b.order)
      .slice(0, limit)
      .map(({ id, score }) => ({ id, score }));
  }

  return { matchSyllables, scoreEntry, search, SCORE };
});
