#!/usr/bin/env python3
"""Build clauses/<book>/<sec>.json for books of the R2 catalog and upload clausepacks/<book>/clauses.* (+ per-file clauses/ for small books).
Usage: python3 scripts/clauses/build.py --books tanakh-genesis,... | --group Tanakh|Mishnah  [--out out] [--cache cache] [--no-upload] [--kind tanakh|prose]"""
import argparse, json, os, sys, time, random, collections, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'links'))
import r2
from concurrent.futures import ThreadPoolExecutor
SMALL_FILES = 60   # books with <= this many sections also get per-file objects

def load_sec(cache, book, sec):
    d = book.replace('-', '/', 1); fn = os.path.join(cache, 'sections', d, sec + '.json')
    if os.path.exists(fn) and os.path.getsize(fn): return json.load(open(fn, encoding='utf-8'))
    try: b = r2.rest_get(f'sections/{d}/{sec}.json')
    except Exception as e: print('missing', book, sec, str(e)[:60], flush=True); return None
    os.makedirs(os.path.dirname(fn), exist_ok=True); open(fn, 'wb').write(b); return json.loads(b)

def process(d, kind):
    segs = d['text']['segments']; out_segs = {}; flats = {}
    for i, t in enumerate(segs, 1):
        cuts = core.tanakh_cuts(t) if kind == 'tanakh' else core.prose_cuts(t)
        out_segs[str(i)] = dict(cuts=cuts); flats[i] = (core.seg_norm(t), cuts, len(core.text_words(t)))
    comments = {}; tot = ok = 0; per = collections.defaultdict(lambda: [0, 0]); samples = []
    for c in d['commentary']:
        who = c['who']; m = {}
        for k, lst in c['seg'].items():
            try: k = int(k)
            except ValueError: continue
            if k not in flats: continue
            (flat, ridx), cuts, nw = flats[k]
            for j, txt in enumerate(lst, 1):
                tot += 1; per[who][0] += 1
                if len(cuts) < 2: continue
                dh = core.dh_words(txt)
                poss = core.match_pos(dh, flat) if dh else None
                cl = core.assign(poss, ridx, cuts) if poss else None
                if cl is None: continue
                m[f'{k}:{j}'] = cl; ok += 1; per[who][1] += 1
                samples.append((k, who, j, cl, dh))
        if m: comments[who] = m
    return dict(schema=1, work=d['work'], sec=d['sec'], generated=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), segs=out_segs, comments=comments), tot, ok, per, samples, segs

def pack_book(book, secs_data, stamp):
    LIMIT = 8 * 1024 * 1024; files, idx, cur, k, objs = [], {}, bytearray(), 0, []
    def flush():
        nonlocal cur, k
        if not cur: return
        name = f'clauses-{stamp}-{k}.bin'; objs.append((f'clausepacks/{book}/{name}', bytes(cur), 'application/octet-stream')); files.append(name); k += 1; cur = bytearray()
    for sec, data in secs_data.items():
        if cur and len(cur) + len(data) > LIMIT: flush()
        idx[sec] = [len(files), len(cur), len(data)]; cur += data
    flush()
    objs.append((f'clausepacks/{book}/clauses.index.json', json.dumps({'v': 1, 'files': files, 'secs': idx}, separators=(',', ':')).encode(), 'application/json; charset=utf-8'))
    return objs   # index is last

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--books', default=''); ap.add_argument('--group', default=''); ap.add_argument('--out', default='out'); ap.add_argument('--cache', default='cache')
    ap.add_argument('--no-upload', action='store_true'); ap.add_argument('--threads', type=int, default=4)
    a = ap.parse_args()
    cat = json.loads(r2.rest_get('catalog.json'))['books']
    sel = [b for b in cat if b['id'] in a.books.split(',')] if a.books else [b for b in cat if b.get('cat') in a.group.split(',')]
    from upload_r2 import call, account, API
    base = f'{API}/accounts/{account()}/r2/buckets/{r2.BUCKET}/objects/'
    import urllib.parse
    put = lambda key, data, ct: call('PUT', base + urllib.parse.quote(key, safe='/'), data, ct)
    stamp = time.strftime('%Y%m%d%H%M%S', time.gmtime()); fails = []
    for b in sel:
        book = b['id']; kind = 'tanakh' if b.get('cat') == 'Tanakh' else 'prose'
        t0 = time.time()
        datas = list(ThreadPoolExecutor(a.threads).map(lambda s: load_sec(a.cache, book, s), b['secs']))
        res = {}; agg = dict(segs=0, split=0, clauses=0, words=0, comments=0, assigned=0); per = collections.defaultdict(lambda: [0, 0]); samples = []
        for sec, d in zip(b['secs'], datas):
            if not d: continue
            o, tot, ok, pr, sm, segs = process(d, kind); res[sec] = o
            for s, v in o['segs'].items():
                agg['segs'] += 1; n = len(v['cuts']); agg['clauses'] += n; agg['split'] += n > 1
            agg['words'] += sum(len(core.text_words(t)) for t in segs); agg['comments'] += tot; agg['assigned'] += ok
            for w, (x, y) in pr.items(): per[w][0] += x; per[w][1] += y
            samples += [(sec,) + s + (segs[s[0] - 1],) for s in sm]
        rnd = random.Random(1); spot = []
        for sec, k, who, j, cl, dh, txt in rnd.sample(samples, min(20, len(samples))):
            cuts = res[sec]['segs'][str(k)]['cuts']; w = core.text_words(txt); e = cuts[cl + 1] if cl + 1 < len(cuts) else len(w)
            spot.append(dict(sec=sec, seg=k, who=who, n=j, dh=' '.join(dh), clause=' '.join(w[cuts[cl]:e])))
        rep = dict(schema=1, work=book, generated=datetime.datetime.now(datetime.timezone.utc).isoformat(), sections=len(res), **agg,
                   avg_clause_words=round(agg['words'] / max(1, agg['clauses']), 2), pct_comments_assigned=round(100 * agg['assigned'] / max(1, agg['comments']), 1),
                   per_commentator={w: dict(comments=x, assigned=y, pct=round(100 * y / x, 1)) for w, (x, y) in sorted(per.items(), key=lambda kv: -kv[1][0])}, spot_checks=spot)
        os.makedirs(f'{a.out}/reports/clauses', exist_ok=True); json.dump(rep, open(f'{a.out}/reports/clauses/{book}.json', 'w'), ensure_ascii=False, indent=1)
        blobs = {sec: json.dumps(o, ensure_ascii=False, separators=(',', ':')).encode() for sec, o in res.items()}
        for sec, bl in blobs.items():
            fn = f'{a.out}/clauses/{book.replace("-", "/", 1)}/{sec}.json'; os.makedirs(os.path.dirname(fn), exist_ok=True); open(fn, 'wb').write(bl)
        objs = pack_book(book, blobs, stamp)
        if len(blobs) <= SMALL_FILES: objs = [(f'clauses/{book.replace("-", "/", 1)}/{s}.json', bl, 'application/json; charset=utf-8') for s, bl in blobs.items()] + objs
        objs.append((f'reports/clauses/{book}.json', open(f'{a.out}/reports/clauses/{book}.json', 'rb').read(), 'application/json; charset=utf-8'))
        if not a.no_upload:
            # packs first, index last, then per-file + report (pack index is objs[-?]: keep order, report after)
            idx_i = next(i for i, o in enumerate(objs) if o[0].endswith('clauses.index.json')); idx_obj = objs.pop(idx_i)
            try:
                for key, data, ct in objs: put(key, data, ct)
                put(*idx_obj)
            except Exception as e: fails.append((book, str(e)[:100]))
        print(f'{book}: {len(res)} secs, {agg["split"]}/{agg["segs"]} segs split, avg {rep["avg_clause_words"]} words/clause, {rep["pct_comments_assigned"]}% comments assigned ({time.time()-t0:.0f}s)', flush=True)
    if fails: print('FAILED', fails); sys.exit(1)
if __name__ == '__main__': main()
