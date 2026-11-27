// Full-text search over the static index in R2 (search/manifest.json + search/<v>/<family>/<key>.bin). Built by scripts/build_search_index.py, see docs/SEARCH_DESIGN.md.
// searchText(env, url) -> { text:[{work,sec,idx,he,kind,who}], more, next, meta } | null (null = no index yet -> caller falls back to D1 LIKE search)
const CODE = {}; 'אבגדהוזחטיכלמנסעפצקרשת'.split('').forEach((c, i) => { CODE[c] = i + 1; });
const FINAL = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const PREFIX = 'ובהכלמש';
const REMOVE = /[֑-ׇֽֿׁׂׅׄ‍"'׳״]/g;
const TOKEN = /[֑-ׇֽֿׁׂׅׄא-ת‍"'׳״]+/g;
const TAGS = /<[^>]*>/g;
const BLOCK = 128, MAX_SECS = 14, MAX_CAND = 4000;
const fold = w => w.replace(REMOVE, '').replace(/[ךםןףץ]/g, c => FINAL[c]);
export const words = s => s.replace(TAGS, ' ').replace(REMOVE, '').replace(/[ךםןףץ]/g, c => FINAL[c]).replace(/[^א-ת]+/g, ' ').trim().split(' ').filter(Boolean);
const keysOf = w => { const o = [w]; for (let i = 0; i < 2 && w.length >= 3 && PREFIX.includes(w[0]); i++) { w = w.slice(1); o.push(w); } return o; };
const keyOf = (t, split) => { let k = ''; for (let i = 0; i < 2; i++) k += String.fromCharCode(96 + CODE[t[i]]); if (split && split.includes(k)) k = t.length >= 3 ? k + String.fromCharCode(96 + CODE[t[2]]) : k + '_'; return k; };

// ---- manifest (cached per isolate)
let MAN = null, MAN_AT = 0, MAN_P = null;
async function manifest(env) {
  if (MAN && Date.now() - MAN_AT < 300000) return MAN;
  if (!MAN_P) MAN_P = (async () => {
    const o = await env.R2.get('search/manifest.json'); if (!o) return null;
    const m = await o.json(); const secStart = [], secBook = [], secName = [], secN = [], bookIx = {};
    m.books.forEach((b, bi) => { bookIx[b.id] = bi; let s = b.lo; b.secs.forEach((sec, i) => { secStart.push(s); secBook.push(bi); secName.push(sec); secN.push(b.n[i]); s += b.n[i]; }); });
    m.secStart = secStart; m.secBook = secBook; m.secName = secName; m.secN = secN; m.bookIx = bookIx;
    m.whoById = {}; m.whoByName = {}; m.who.forEach(w => { m.whoById[w.id] = w; m.whoByName[w.name] = w; });
    return m;
  })().finally(() => { MAN_P = null; });
  const m = await MAN_P; if (m) { MAN = m; MAN_AT = Date.now(); } return m || MAN;
}
function locate(m, gid) {            // global segment id -> {book, sec, idx(1-based)}
  let lo = 0, hi = m.secStart.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (m.secStart[mid] <= gid) lo = mid; else hi = mid - 1; }
  return { book: m.books[m.secBook[lo]].id, sec: m.secName[lo], idx: gid - m.secStart[lo] + 1 };
}

// ---- shard access (R2 + small isolate cache)
const CACHE = new Map(); let CACHE_BYTES = 0;
const LOCS = new Map();
async function locs(env, m, fam) {      // shard key -> [pack, offset, length] (packs of ~16 MB, read with R2 range requests)
  const k = m.v + '/' + fam;
  if (!LOCS.has(k)) LOCS.set(k, env.R2.get('search/' + k + '.loc.json').then(o => o ? o.json() : {}).catch(e => { LOCS.delete(k); throw e; }));
  return LOCS.get(k);
}
async function shard(env, m, fam, key) {
  const k = m.v + '/' + fam + '/' + key;
  if (CACHE.has(k)) { const v = CACHE.get(k); CACHE.delete(k); CACHE.set(k, v); return v; }
  const l = (await locs(env, m, fam))[key]; let u8 = null;
  if (l) { const o = await env.R2.get('search/' + m.v + '/' + fam + '/p' + l[0] + '.bin', { range: { offset: l[1], length: l[2] } }); if (o) u8 = new Uint8Array(await o.arrayBuffer()); }
  CACHE.set(k, u8); CACHE_BYTES += u8 ? u8.length : 0;
  while (CACHE_BYTES > 48e6 && CACHE.size > 1) { const f = CACHE.keys().next().value; CACHE_BYTES -= CACHE.get(f)?.length || 0; CACHE.delete(f); }
  return u8;
}
function varint(u8, p) { let x = 0, mul = 1, b; do { b = u8[p.i++]; x += (b & 127) * mul; mul *= 128; } while (b & 128); return x; }
// find a term in a shard -> list cursor (or null)
function openTerm(u8, term) {
  if (!u8) return null;
  const n = u8[4] | u8[5] << 8 | u8[6] << 16 | u8[7] << 24, dlen = u8[8] | u8[9] << 8 | u8[10] << 16 | u8[11] << 24;
  const t = new Uint8Array(term.length); for (let i = 0; i < term.length; i++) t[i] = CODE[term[i]];
  let p = 12, idx = -1; const end = 12 + dlen;
  for (let ti = 0; p < end; ti++) {   // linear scan of the dictionary (NUL separated, sorted)
    let j = 0; while (j < t.length && u8[p + j] === t[j]) j++;
    if (j === t.length && u8[p + j] === 0) { idx = ti; break; }
    while (u8[p] !== 0) p++; p++;
  }
  if (idx < 0) return null;
  const offBase = end, postBase = end + 4 * (n + 1);
  const rd = o => u8[offBase + 4 * o] | u8[offBase + 4 * o + 1] << 8 | u8[offBase + 4 * o + 2] << 16 | u8[offBase + 4 * o + 3] * 16777216;
  return listCursor(u8, postBase + rd(idx), postBase + rd(idx + 1));
}
function listCursor(u8, start, endp) {
  const q = { i: start }; const count = varint(u8, q); const c = { count, first: [], bstart: [], blen: [] };
  if (count <= BLOCK) { c.first.push(varint(u8, q)); c.bstart.push(q.i); c.blen.push(count - 1); c.small = true; }
  else {
    const nb = Math.ceil(count / BLOCK); let prev = 0; const lens = [];
    for (let b = 0; b < nb; b++) { prev += varint(u8, q); c.first.push(prev); lens.push(varint(u8, q)); }
    let s = q.i; for (let b = 0; b < nb; b++) { c.bstart.push(s); s += lens[b]; }
  }
  c.u8 = u8; c.bi = -1; c.vals = null; c.pos = 0; return c;
}
function loadBlock(c, b) {
  if (c.bi === b) return; const vals = [c.first[b]]; const q = { i: c.bstart[b] };
  const n = c.small ? c.blen[0] : (b === c.first.length - 1 ? c.count - b * BLOCK - 1 : BLOCK - 1);
  let v = c.first[b]; for (let k = 0; k < n; k++) { v += varint(c.u8, q); vals.push(v); }
  c.bi = b; c.vals = vals; c.pos = 0;
}
// smallest value >= target, or Infinity
function seek(c, target) {
  let lo = 0, hi = c.first.length - 1;
  if (c.bi >= 0) lo = c.bi;
  if (c.first[lo] > target) lo = 0;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c.first[mid] <= target) lo = mid; else hi = mid - 1; }
  loadBlock(c, lo); const v = c.vals;
  if (v[c.pos] > target) c.pos = 0;
  while (c.pos < v.length && v[c.pos] < target) c.pos++;
  if (c.pos < v.length) return v[c.pos];
  if (lo + 1 < c.first.length) { loadBlock(c, lo + 1); return c.vals[0]; }
  return Infinity;
}

// ---- matching helpers
function tokens(text) {
  const plain = text.replace(TAGS, ' '), out = []; let m; TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(plain))) { const w = fold(m[0]); if (w) out.push({ w, a: m.index, b: m.index + m[0].length }); }
  return { plain, out };
}
function matchTok(t, qw, pref) { return t === qw || (pref && keysOf(t).includes(qw)); }
function findMatch(text, qw, phrase, pref) {      // -> {plain, marks:[[a,b]...]} or null
  const { plain, out } = tokens(text);
  if (phrase) {
    for (let i = 0; i + qw.length <= out.length; i++) {
      let ok = true; for (let j = 0; j < qw.length; j++) if (!matchTok(out[i + j].w, qw[j], pref)) { ok = false; break; }
      if (ok) return { plain, marks: out.slice(i, i + qw.length).map(t => [t.a, t.b]), first: out[i].a };
    }
    return null;
  }
  const marks = []; const seen = new Set();
  for (const t of out) for (const w of qw) if (matchTok(t.w, w, pref)) { marks.push([t.a, t.b]); seen.add(w); break; }
  return seen.size === new Set(qw).size ? { plain, marks, first: marks[0][0] } : null;
}
const escH = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function snippet(mt, span = 110) {
  const { plain, marks } = mt; let a = Math.max(0, mt.first - span), b = Math.min(plain.length, mt.first + span * 2);
  if (a > 0) { const s = plain.indexOf(' ', a); if (s >= 0 && s < mt.first) a = s + 1; }
  if (b < plain.length) { const s = plain.lastIndexOf(' ', b); if (s > mt.first) b = s; }
  let out = a > 0 ? '… ' : '', p = a;
  for (const [x, y] of marks) { if (y <= a || x >= b) continue; const xs = Math.max(x, a), ys = Math.min(y, b); out += escH(plain.slice(p, xs)) + '<mark>' + escH(plain.slice(xs, ys)) + '</mark>'; p = ys; }
  return out + escH(plain.slice(p, b)) + (b < plain.length ? ' …' : '');
}

// ---- main
export async function searchText(env, url) {
  const t0 = Date.now(); const P = url.searchParams;
  const m = await manifest(env); if (!m) return null;
  let q = (P.get('q') || '').trim(), phrase = P.get('phrase') === '1';
  if (/^["“„].*["”]$/.test(q)) { phrase = true; q = q.slice(1, -1); }
  const pref = P.get('pref') === '1';
  const qw = words(q).slice(0, 12), lookup = [...new Set(qw.filter(w => w.length >= 2 && w.length <= 24))];
  if (!lookup.length) return { text: [], more: false, meta: { note: 'query too short' } };
  const limit = Math.min(30, Math.max(1, +P.get('limit') || 10));
  let layer = P.get('layer') || 'all'; if (!['base', 'comm', 'all'].includes(layer)) layer = 'all';
  // restrict by book / category
  const bs = (P.get('book') || '').split(',').filter(Boolean), cs = (P.get('cat') || '').split(',').filter(Boolean);
  let ranges = null;
  if (bs.length || cs.length) {
    ranges = m.books.filter(b => bs.includes(b.id) || cs.some(c => b.id.startsWith(c + '-'))).map(b => [b.lo, b.hi]);
    ranges.sort((x, y) => x[0] - y[0]); const mg = [];
    for (const r of ranges) { if (mg.length && mg[mg.length - 1][1] === r[0]) mg[mg.length - 1][1] = r[1]; else mg.push([...r]); } ranges = mg;
    if (!ranges.length) return { text: [], more: false, meta: { note: 'no such book' } };
  }
  const whoSet = (P.get('who') || '').split(',').filter(Boolean).map(w => m.whoByName[w]?.id).filter(Boolean);
  if ((P.get('who') || '') && !whoSet.length) return { text: [], more: false, meta: { note: 'no such commentator' } };
  const after = P.get('after') || '', aKind = after.startsWith('c:') ? 'comm' : 'base', aVal = +after.slice(2) || 0;
  const layers = layer === 'all' ? (aKind === 'comm' ? ['comm'] : ['base', 'comm']) : [layer];
  const out = []; let more = false, next = '', fetched = 0, cand = 0;
  for (const L of layers) {
    const r = await runLayer(env, m, L, lookup, qw, phrase, pref, ranges, whoSet, after && L === aKind ? aVal : 0, limit - out.length, MAX_SECS - fetched);
    fetched += r.fetched; cand += r.cand; out.push(...r.hits);
    if (r.more) { more = true; next = (L === 'comm' ? 'c:' : 'b:') + r.next; break; }
  }
  return { text: out, more, next, meta: { v: m.v, ms: Date.now() - t0, cand, secs: fetched, words: qw.length } };
}

async function runLayer(env, m, L, lookup, qw, phrase, pref, ranges, whoSet, from, want, secBudget) {
  const comm = L === 'comm'; const fam = (comm ? 'c' : 'b') + (pref ? 'x' : ''); const mult = comm ? m.cm : 1;
  const split = m.split[fam] || [];
  const shards = await Promise.all(lookup.map(w => shard(env, m, fam, keyOf(w, split))));
  const curs = lookup.map((w, i) => openTerm(shards[i], w));
  if (curs.some(c => !c)) return { hits: [], more: false, fetched: 0, cand: 0 };
  curs.sort((a, b) => a.count - b.count);
  const rs = ranges ? ranges.map(([lo, hi]) => [lo * mult, hi * mult]) : [[0, Infinity]];
  const hits = []; const docs = new Map(); let fetched = 0, cand = 0, last = from, moreFlag = false;
  const bits = comm ? Math.log2(m.cm) : 0, whoOk = whoSet.length && comm ? new Set(whoSet) : null;
  const get = async key => { if (!docs.has(key)) { docs.set(key, env.R2.get(key).then(o => o ? o.json() : null)); fetched++; } return docs.get(key); };
  let ri = 0, v = Math.max(from > 0 ? from + 1 : 0, rs[0][0]);
  const verify = async list => {
    const infos = list.map(val => { const gid = comm ? Math.floor(val / mult) : val; const loc = locate(m, gid); return { val, loc, cid: comm ? val % mult : 0 }; });
    const keys = [...new Set(infos.map(i => { const [c, r] = i.loc.book.split(/-(.*)/s); return `sections/${c}/${r}/${i.loc.sec}.json`; }))];
    keys.forEach(get); const res = [];
    for (const i of infos) {
      const [c, r] = i.loc.book.split(/-(.*)/s); const doc = await get(`sections/${c}/${r}/${i.loc.sec}.json`); if (!doc) continue;
      if (!comm) { const txt = doc.text.segments[i.loc.idx - 1]; const mt = txt && findMatch(txt, qw, phrase, pref); if (mt) res.push({ val: i.val, work: i.loc.book, sec: i.loc.sec, idx: i.loc.idx, kind: 'base', he: snippet(mt) }); }
      else {
        const w = m.whoById[i.cid]; if (!w) continue;
        for (const cm of doc.commentary || []) { if (cm.who !== w.name) continue; for (const t of cm.seg[String(i.loc.idx)] || []) { const mt = findMatch(t, qw, phrase, pref); if (mt) { res.push({ val: i.val, work: i.loc.book, sec: i.loc.sec, idx: i.loc.idx, kind: 'comm', who: w.name, he: snippet(mt) }); break; } } }
      }
    }
    return res;
  };
  // leapfrog intersection over the lists (rarest first), in value order, restricted to ranges
  const lead = curs[0]; let queue = [];
  scan: while (ri < rs.length) {
    const [lo, hi] = rs[ri]; v = Math.max(v, lo);
    for (;;) {
      let x = seek(lead, v); if (x >= hi) { ri++; break; }
      let ok = true;
      for (let k = 1; k < curs.length; k++) { const y = seek(curs[k], x); if (y !== x) { v = y === Infinity ? Infinity : y; ok = false; break; } }
      if (v === Infinity) { ri = rs.length; break; }
      if (!ok) continue;
      v = x + 1;
      if (whoOk && !whoOk.has(x % mult)) continue;
      queue.push(x); cand++;
      if (queue.length >= Math.max(want * 2, 8)) {
        const res = await verify(queue); queue = [];
        for (const r of res) { if (hits.length < want) hits.push(r); }
        if (hits.length >= want) { last = hits[hits.length - 1].val; moreFlag = true; break scan; }
        last = v - 1;
        if (fetched >= secBudget || cand >= MAX_CAND) { moreFlag = true; break scan; }
      }
    }
  }
  if (!moreFlag && queue.length) {
    const res = await verify(queue);
    for (const r of res) { if (hits.length < want) hits.push(r); else { moreFlag = true; break; } }
    if (moreFlag) last = hits[hits.length - 1].val;
  }
  hits.forEach(h => { delete h.val; });
  return { hits, more: moreFlag, next: last, fetched, cand };
}
