// input: pinyin function from vendor/pinyin-pro.js, guest {id, name, aliases}
// output: CK.pinyinKeys — normalize(), nameSyllableSets(), buildEntry() for search indexing
// pos: core layer, turns names into pinyin syllable sequences (handles polyphones and ü)
// Once I am updated, update my header comments and my folder's md doc.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CK = Object.assign(root.CK || {}, { pinyinKeys: api });
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_COMBOS = 32;
  const MAX_READINGS = 4;
  const TOKEN_RE = /[㐀-鿿]|[a-z0-9]+/gi;
  const HAN_RE = /[㐀-鿿]/;
  const ALIAS_SPLIT_RE = /[,，、;；|]+/;

  // Lowercase, map ü to v, drop everything except letters, digits and Han characters.
  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[üǖǘǚǜ]/g, 'v')
      .replace(/[^a-z0-9㐀-鿿]/g, '');
  }

  function unique(list) {
    return [...new Set(list)];
  }

  // Readings for one Han character: contextual reading first, then other polyphone readings.
  function charReadings(ch, contextual, pinyinFn) {
    const all = pinyinFn(ch, { multiple: true, type: 'array', toneType: 'none', v: true });
    const base = unique([contextual, ...all].filter(Boolean).map((s) => s.toLowerCase()));
    const withU = base.flatMap((s) => (s.includes('v') ? [s, s.replace(/v/g, 'u')] : [s]));
    return unique(withU).slice(0, MAX_READINGS);
  }

  // Cartesian product of per-token options, capped to keep the index small.
  function cartesian(options, cap) {
    return options.reduce((acc, opts) => {
      const next = [];
      for (const prefix of acc) {
        for (const opt of opts) {
          if (next.length >= cap) return next;
          next.push([...prefix, opt]);
        }
      }
      return next;
    }, [[]]);
  }

  // All plausible syllable sequences for a name, e.g. 曾小贤 → [[zeng,xiao,xian],[ceng,xiao,xian],...].
  function nameSyllableSets(name, pinyinFn) {
    const tokens = String(name || '').match(TOKEN_RE) || [];
    if (tokens.length === 0) return [];
    const hanText = tokens.filter((t) => HAN_RE.test(t)).join('');
    const contextual = hanText
      ? pinyinFn(hanText, { type: 'array', toneType: 'none', v: true, surname: 'head' })
      : [];
    let hanIndex = 0;
    const options = tokens.map((t) =>
      HAN_RE.test(t) ? charReadings(t, contextual[hanIndex++], pinyinFn) : [t.toLowerCase()]
    );
    return cartesian(options, MAX_COMBOS);
  }

  // Alias syllable sets: Han aliases go through pinyin, latin aliases split on spaces.
  function aliasSyllableSets(aliases, pinyinFn) {
    return String(aliases || '')
      .split(ALIAS_SPLIT_RE)
      .map((a) => a.trim())
      .filter(Boolean)
      .flatMap((alias) => {
        if (HAN_RE.test(alias)) return nameSyllableSets(alias, pinyinFn);
        const parts = alias.toLowerCase().split(/\s+/).map(normalize).filter(Boolean);
        return parts.length ? [parts] : [];
      });
  }

  // Search index entry for one guest.
  function buildEntry(guest, pinyinFn) {
    return {
      id: guest.id,
      nameNorm: normalize(guest.name),
      sets: nameSyllableSets(guest.name, pinyinFn),
      aliasSets: aliasSyllableSets(guest.aliases, pinyinFn),
    };
  }

  // Short pinyin label for staff to verify readings, e.g. "zeng xiao xian / ZXX".
  function describe(entry) {
    const first = entry.sets[0];
    if (!first) return '';
    return `${first.join(' ')} / ${first.map((s) => s[0]).join('').toUpperCase()}`;
  }

  return { normalize, nameSyllableSets, aliasSyllableSets, buildEntry, describe };
});
