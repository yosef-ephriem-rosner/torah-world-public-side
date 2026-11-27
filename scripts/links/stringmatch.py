#!/usr/bin/env python3
"""Deterministic connections by normalised n-gram matching (no nikud, no punctuation, no tags). source=string-match.
 * Tanakh verses quoted in Gemara/Mishnah segments   (type quotation)
 * Mishnah text inside Gemara segments / Gemara quoting Mishnah (type quotation)
 * Gemara <-> Gemara parallels (long shared runs)    (type parallel)
Tanakh text: Sefaria export 'Miqra according to the Masorah' (license read from the version file, must be allowed).
Usage as module: build(book, cache) -> {sec: [links]}, stats"""
import collections, json, os, re, sys, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
from common import *

BOOKS_URL = 'https://raw.githubusercontent.com/Sefaria/Sefaria-Export/master/books.json'
OK_LIC = {'public domain', 'pd', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa'}
def fetch_json(url):
    for i in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as r: return json.load(r)
        except Exception as e: err = e
    raise RuntimeError(f'download failed {url}: {err}')

def tanakh_corpus(cache):
    """-> list of (ref 'Genesis 1:5', tokens, site passage or None)"""
    fn = os.path.join(cache, 'tanakh_corpus.json')
    if os.path.exists(fn): return json.load(open(fn, encoding='utf-8'))
    books = fetch_json(BOOKS_URL)['books']; out = []; lic = {}
    for b in books:
        if b['language'] == 'Hebrew' and b['versionTitle'] == 'Miqra according to the Masorah' and b['categories'][0] == 'Tanakh':
            d = fetch_json(b['json_url']); l = (d.get('license') or '').lower(); lic[b['title']] = d.get('license')
            if l not in OK_LIC: continue
            for ci, ch in enumerate(d['text'], 1):
                for vi, v in enumerate(ch, 1):
                    if isinstance(v, list): v = ' '.join(x for x in v if isinstance(x, str))
                    v = re.sub(r'<sup[^>]*>.*?</sup>|<i class="footnote">.*?</i>', '', v or '', flags=re.S)
                    out.append([f"{b['title']} {ci}:{vi}", tokens_of(v)])
    json.dump(out, open(fn, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    json.dump(lic, open(os.path.join(cache, 'tanakh_licenses.json'), 'w'))
    return out

def tokens_of(s):
    s = norm(s).replace('יהוה', 'ה').replace('אלקים', 'אלהים')
    return s.split()
def seg_tokens(text):
    """tokens plus map token -> original whitespace-word index"""
    toks, pos = [], []
    for wi, w in enumerate(text_words(text)):
        for t in tokens_of(w): toks.append(t); pos.append(wi)
    return toks, pos

class Index:
    """n-gram -> set of unit ids; units hold token lists"""
    def __init__(self, n): self.n = n; self.post = collections.defaultdict(set); self.units = []
    def add(self, uid, toks):
        self.units.append((uid, toks))
        for i in range(len(toks) - self.n + 1): self.post[tuple(toks[i:i + self.n])].add(len(self.units) - 1)
    def df_min(self, toks):
        n = self.n; return min((len(self.post.get(tuple(toks[i:i + n]), ())) for i in range(len(toks) - n + 1)), default=999)
    def query(self, toks, max_df, min_run, skip=None):
        """-> list of (unit index, query start, query end(excl), unit start, run length) best run per unit"""
        n = self.n; hits = collections.defaultdict(list)
        for i in range(len(toks) - n + 1):
            p = self.post.get(tuple(toks[i:i + n]))
            if p and len(p) <= max_df:
                for u in p: hits[u].append(i)
        out = []
        for u, starts in hits.items():
            if skip and skip(self.units[u][0]): continue
            ut = self.units[u][1]; best = None
            for qs in starts:   # extend each seed to a maximal common run (exact contiguous)
                for us in range(len(ut) - n + 1):
                    if ut[us:us + n] == toks[qs:qs + n]:
                        a = qs; b = us
                        while a > 0 and b > 0 and toks[a - 1] == ut[b - 1]: a -= 1; b -= 1
                        e = qs + n; f = us + n
                        while e < len(toks) and f < len(ut) and toks[e] == ut[f]: e += 1; f += 1
                        if best is None or e - a > best[4]: best = (u, a, e, b, e - a)
            if best and best[4] >= min_run: out.append(best)
        return out

def conf_for(run, unit_len, kind):
    if kind == 'tanakh':
        c = {3: 0.5, 4: 0.6, 5: 0.68, 6: 0.76, 7: 0.84, 8: 0.9}.get(run, 0.95 if run > 8 else 0.5)
        if run >= 0.9 * unit_len and unit_len >= 5: c = min(0.97, c + 0.08)       # whole verse quoted
        return round(c, 2)
    if kind == 'mishnah': return round(min(0.95, 0.5 + 0.04 * run), 2)
    return round(min(0.92, 0.45 + 0.035 * run), 2)

def site_tanakh_target(ref):
    m = re.match(r'^(Genesis|Exodus) (\d+):(\d+)$', ref)
    if m:
        b = 'tanakh-genesis' if m[1] == 'Genesis' else 'tanakh-exodus'
        if m[2] in BOOKS[b]['secs']: return dict(work=b, sec=m[2], idx=int(m[3]))
    return {'sefaria': ref}

_CTX = {}; _COMMON = {}
def context(cache):
    """Tanakh / Mishnah / Gemara indexes over everything cached (built once per process)"""
    if cache in _CTX: return _CTX[cache]
    ti = Index(3)
    for ref, toks in tanakh_corpus(cache): ti.add(ref, toks)
    gi = Index(6); mi = Index(5)
    for b in BOOKS:
        if BOOKS[b]['kind'] not in ('talmud', 'mishnah'): continue
        for s, d in load_book(cache, b).items():
            for i, seg in enumerate(d['text']['segments'], 1):
                toks, _ = seg_tokens(seg)
                (gi if BOOKS[b]['kind'] == 'talmud' else mi).add((b, s, i), toks)
    _CTX[cache] = (ti, gi, mi); return _CTX[cache]

def build(book, cache, tanakh_min=3, tanakh_df=6, mishnah_min=6, gem_min=10, gem_df=12):
    ti, gi, mi = context(cache)
    kind = BOOKS[book]['kind']; secs = load_book(cache, book); out = collections.defaultdict(list); stats = collections.Counter()
    if cache not in _COMMON:
        freq = collections.Counter()
        for _, ts in gi.units: freq.update(set(ts))
        _COMMON[cache] = {w for w, _ in freq.most_common(250)}   # formula / attribution words are not evidence of a parallel
    common = _COMMON[cache]
    def content(toks): return sum(1 for w in toks if w not in common)
    for sec, d in secs.items():
        for i, seg in enumerate(d['text']['segments'], 1):
            toks, pos = seg_tokens(seg)
            if len(toks) < 4: continue
            def emit(qs, qe, to, typ, conf, note):
                out[sec].append({'from': {'idx': i, 'ws': pos[qs], 'we': pos[qe - 1]}, 'to': to, 'type': typ, 'source': 'string-match', 'confidence': conf, 'note': note, 'review': 'unreviewed'})
                stats[typ + ':' + ('tanakh' if 'sefaria' in to or to.get('work', '').startswith('tanakh') else to['work'])] += 1
            if kind in ('talmud', 'mishnah', 'other'):
                best = {}
                for u, a, e, b2, run in ti.query(toks, tanakh_df, tanakh_min):
                    ref, ut = ti.units[u]
                    if run >= 5 or (run >= 3 and (len(ut) <= run + 2 or run >= 0.7 * len(ut))) or (run == 4 and ti.df_min(toks[a:e]) <= 3):
                        best[(ref)] = (a, e, run, len(ut))
                # drop overlapping hits in the same span of words: keep the longest run per span
                same = collections.Counter((a, e) for a, e, run, ul in best.values())
                for ref, (a, e, run, ul) in sorted(best.items(), key=lambda kv: -kv[1][2]):
                    k = same[(a, e)]   # identical wording in several verses: the right one is ambiguous -> lower confidence
                    emit(a, e, site_tanakh_target(ref), 'quotation', round(max(0.3, conf_for(run, ul, 'tanakh') - (0.1 if k > 1 else 0)), 2),
                         f'quotes {ref} ({run} matching words)' + (f'; same words occur in {k} verses' if k > 1 else ''))
            if kind == 'talmud':
                for u, a, e, b2, run in mi.query(toks, 8, mishnah_min):
                    if content(toks[a:e]) < 3: continue
                    (mb, ms, mi_idx), mt = mi.units[u]
                    emit(a, e, dict(work=mb, sec=ms, idx=mi_idx), 'quotation', conf_for(run, len(mt), 'mishnah'), f'contains Mishnah text ({run} matching words)')
                me = (book, sec, i)
                for u, a, e, b2, run in gi.query(toks, gem_df, gem_min, skip=lambda uid: uid == me or (uid[0] == book and uid[1] == sec)):
                    if content(toks[a:e]) < 5: continue
                    (gb, gs, gi_idx), gt = gi.units[u]
                    emit(a, e, dict(work=gb, sec=gs, idx=gi_idx), 'parallel', conf_for(run, len(gt), 'gemara'), f'shares {run} consecutive words with {BOOKS[gb]["title"]} {gs}:{gi_idx}')
            elif kind == 'mishnah':
                for u, a, e, b2, run in mi.query(toks, 8, 8, skip=lambda uid: uid == (book, sec, i)):
                    (mb, ms, mi_idx), mt = mi.units[u]
                    emit(a, e, dict(work=mb, sec=ms, idx=mi_idx), 'parallel', conf_for(run, len(mt), 'gemara'), f'shares {run} consecutive words with {BOOKS[mb]["title"]} {ms}:{mi_idx}')
    return dict(out), stats
if __name__ == '__main__':
    res, st = build(sys.argv[1], sys.argv[2]); print(sum(len(v) for v in res.values()), dict(st))
