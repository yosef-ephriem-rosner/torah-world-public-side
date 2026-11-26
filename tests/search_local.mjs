// Local test of worker/search.js against a locally built index: node tests/search_local.mjs <idxdir> <sectionsdir>
import fs from 'node:fs'; import { searchText } from '../worker/search.js';
const [idx, sec] = process.argv.slice(2);
const env = { R2: { async get(k) { const f = k.startsWith('search/') ? idx + '/' + k : sec + '/../' + k; if (!fs.existsSync(f)) return null; const b = fs.readFileSync(f); return { json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; } } };
const CASES = [ // [query params, expected first hit prefix (work/sec/idx) or null]
  ['q=מאימתי קורין את שמע בערבין&phrase=1&layer=base', 'bavli-berakhot/2a/1'],
  ['q=מאימתי קורין את שמע&layer=base', 'bavli-berakhot/2a/1'],
  ['q=מאימתי קורין את שמע&layer=base&pref=1', 'mishnah-berakhot/1/1'],
  ['q=ואלה שמות בני ישראל הבאים מצרימה&phrase=1&layer=base', 'tanakh-exodus/1/1'],
  ['q=שמות בני ישראל&layer=base&book=tanakh-exodus', 'tanakh-exodus/1/1'],
  ['q=הבאימ מצרימה&layer=base&pref=1', 'tanakh-exodus/1/1'],
  ['q=בני&layer=comm&who=Rashi&book=tanakh-exodus', null],
  ['q=אין עומדין להתפלל&phrase=1', null],
  ['q=ששש קקק', 'EMPTY'],
];
for (const [qs, exp] of CASES) {
  const t = performance.now(); const r = await searchText(env, new URL('http://x/api/search?' + qs));
  const h = r.text[0]; const got = h ? `${h.work}/${h.sec}/${h.idx}` : 'EMPTY';
  console.log((exp && got !== exp && !got.startsWith(exp) ? 'FAIL' : 'ok  '), qs, '->', r.text.length, 'hits first:', got, h?.kind, h?.who || '', 'more=' + r.more, JSON.stringify(r.meta), (performance.now() - t).toFixed(1) + 'ms');
  if (h) console.log('     ', h.he.slice(0, 160));
}
