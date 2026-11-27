#!/usr/bin/env python3
"""Offline full-text index for Torah World (see docs/SEARCH_DESIGN.md).

Subcommands
  plan     list books that still need a partial index   (python3 scripts/build_search_index.py plan [--force] [--extra])
  partial  build the partial index of ONE book from section files on disk
             python3 scripts/build_search_index.py partial --sections out/sections --book bavli-berakhot --out sidx
  fetch-r2 download the section files of a non-Sefaria book from R2 (throttled), for `partial`
  merge    merge all partial indexes into versioned shard files + manifest
             python3 scripts/build_search_index.py merge --partials sidx_partials --out sidx_out
  selftest quick check of normalisation / encoding

Normalisation (MUST stay identical to worker/search.js): strip tags -> remove nikud/cantillation/quotes/geresh ->
fold final letters -> every non Hebrew letter is a word separator.
"""
import argparse, array, collections, gzip, json, os, re, sys, time, urllib.parse

HEB = 'אבגדהוזחטיכלמנסעפצקרשת'           # 22 letters, finals folded; code = index+1
CODE = {c: i + 1 for i, c in enumerate(HEB)}
FINAL = {'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ'}
PREFIX = set('ובהכלמש')                     # ו ב ה כ ל מ ש
REMOVE = set(range(0x591, 0x5BE)) | {0x5BF, 0x5C1, 0x5C2, 0x5C4, 0x5C5, 0x5C7, 0x200D, 0x22, 0x27, 0x5F3, 0x5F4}
TR = {}
for c in range(0x5D0, 0x5EB): TR[c] = FINAL.get(chr(c), chr(c))
for c in REMOVE: TR[c] = None
class _T(dict):
    def __missing__(self, k): return ' '
TRT = _T(TR)
TAG = re.compile(r'<[^>]*>')
BR = re.compile(r'<br\s*/?>', re.I)      # <br> separates words; any other tag (e.g. <big>ב</big>ראשית) is removed without splitting the word
MINLEN, MAXLEN, BLOCK = 2, 24, 128

def words(s):
    return TRT_translate(TAG.sub('', BR.sub(' ', s))).split()
def TRT_translate(s): return s.translate(TRT)

def keys_of(w):
    """prefix-expanded keys of a word: itself, minus 1 prefix letter, minus 2 prefix letters (remainder >= 2 letters)"""
    out = [w]
    for _ in range(2):
        if len(w) >= 3 and w[0] in PREFIX: w = w[1:]; out.append(w)
        else: break
    return out

def natkey(s): return [(0, int(p)) if p.isdigit() else (1, p) for p in re.findall(r'\d+|\D+', s)]

def vint(n, out):
    while n >= 128: out.append((n & 127) | 128); n >>= 7
    out.append(n)

def enc_list(vals, out):
    """vals ascending unique ints -> varint block format (see docs)"""
    n = len(vals); vint(n, out)
    if n <= BLOCK:
        vint(vals[0], out)
        for i in range(1, n): vint(vals[i] - vals[i - 1], out)
        return
    blocks = []
    for b in range(0, n, BLOCK):
        part = vals[b:b + BLOCK]; buf = bytearray()
        for i in range(1, len(part)): vint(part[i] - part[i - 1], buf)
        blocks.append((part[0], buf))
    prev = 0
    for first, buf in blocks: vint(first - prev, out); vint(len(buf), out); prev = first
    for _, buf in blocks: out.extend(buf)

def term_bytes(t): return bytes(CODE[c] for c in t)
def key_of(t, split):
    k = ''.join(chr(96 + CODE[c]) for c in t[:2])
    if k in split: k = ''.join(chr(96 + CODE[c]) for c in t[:3]) if len(t) >= 3 else k + '_'
    return k

def write_shard(path, items):
    """items: [(term, [values])] sorted by term bytes"""
    items.sort(key=lambda x: term_bytes(x[0]))
    dict_b = bytearray(); offs = []; post = bytearray()
    for t, vals in items:
        dict_b += term_bytes(t) + b'\0'; offs.append(len(post)); enc_list(vals, post)
    offs.append(len(post))
    head = b'TWS1' + len(items).to_bytes(4, 'little') + len(dict_b).to_bytes(4, 'little')
    data = head + bytes(dict_b) + b''.join(o.to_bytes(4, 'little') for o in offs) + bytes(post)
    os.makedirs(os.path.dirname(path), exist_ok=True); open(path, 'wb').write(data)
    return len(data)

# ---------------------------------------------------------------- partial
def cmd_partial(a):
    book = a.book; cat, rest = book.split('-', 1)
    d = os.path.join(a.sections, cat, rest)
    secs = sorted((f[:-5] for f in os.listdir(d) if f.endswith('.json')), key=natkey)
    secinfo = []; lid = 0; base = collections.defaultdict(list); comm = collections.defaultdict(list); who = []; whoid = {}
    docs_title = None
    for sec in secs:
        doc = json.load(open(os.path.join(d, sec + '.json'), encoding='utf-8'))
        segs = doc['text']['segments']; secinfo.append([sec, len(segs)]); docs_title = docs_title or doc.get('book')
        for i, s in enumerate(segs):
            for w in {w for w in words(s) if MINLEN <= len(w) <= MAXLEN}: base[w].append(lid + i)
        for c in doc.get('commentary', []):
            if c['who'] not in whoid: whoid[c['who']] = len(who); who.append({'who': c['who'], 'title': c.get('title'), 'he': c.get('he_title')})
            wi = whoid[c['who']]
            for k, comments in c['seg'].items():
                i = int(k) - 1
                if not 0 <= i < len(segs): continue
                ws = set()
                for t in comments: ws.update(w for w in words(t) if MINLEN <= len(w) <= MAXLEN)
                for w in ws: comm[w].append(((lid + i) << 10) | wi)
        lid += len(segs)
    def delta(l):
        l = sorted(set(l)); return [l[0]] + [l[i] - l[i - 1] for i in range(1, len(l))]
    out = {'schema': 1, 'book': book, 'title': docs_title, 'secs': secinfo, 'who': who,
           'base': {w: delta(v) for w, v in base.items()}, 'comm': {w: delta(v) for w, v in comm.items()}}
    os.makedirs(a.out, exist_ok=True)
    p = os.path.join(a.out, book + '.json.gz')
    with gzip.open(p, 'wt', encoding='utf-8', compresslevel=6) as f: json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{book}: {len(secs)} sections, {lid} segments, {len(base)} base terms, {len(comm)} comm terms, {len(who)} commentators -> {os.path.getsize(p)} bytes')

# ---------------------------------------------------------------- merge
def undelta(l):
    out = array.array('Q'); s = 0
    for x in l: s += x; out.append(s)
    return out

def cmd_merge(a):
    files = sorted(f for f in os.listdir(a.partials) if f.endswith('.json.gz'))
    parts = []
    def load(f):
        with gzip.open(os.path.join(a.partials, f), 'rt', encoding='utf-8') as fh: return json.load(fh)
    for f in files:                                           # pass 1: metadata only (keeps memory low with ~800 books)
        d = load(f); parts.append({k: d.get(k) for k in ('book', 'title', 'secs', 'who')}); parts[-1]['_file'] = f; del d
    CAT_ORDER = ['tanakh', 'mishnah', 'bavli', 'yerushalmi', 'tosefta', 'midrash', 'halakhah', 'responsa', 'kabbalah', 'chasidut', 'musar', 'jewishthought', 'liturgy', 'secondtemple']   # results come in this order (base texts first)
    parts.sort(key=lambda p: (CAT_ORDER.index(p['book'].split('-')[0]) if p['book'].split('-')[0] in CAT_ORDER else 99, p['book']))   # categories stay contiguous gid ranges
    whos = {}                                                 # global commentator ids start at 1
    for p in parts:
        for w in p['who']: whos.setdefault(w['who'], {'id': len(whos) + 1, 'name': w['who'], 'he': w.get('he')})
    cm = 1
    while cm < len(whos) + 1: cm <<= 1
    cm = max(cm, 64); bits = cm.bit_length() - 1
    off = 0; books = []
    for p in parts:
        n = sum(c for _, c in p['secs'])
        books.append({'id': p['book'], 'title': p.get('title'), 'lo': off, 'hi': off + n, 'secs': [s for s, _ in p['secs']], 'n': [c for _, c in p['secs']]})
        p['_off'] = off; off += n
    ver = a.version or time.strftime('%Y%m%d%H%M%S', time.gmtime())
    outdir = os.path.join(a.out, 'search', 'v' + ver)
    stats = {}
    for fam in ('b', 'c'):
        ex = collections.defaultdict(lambda: array.array('Q')); xp = collections.defaultdict(lambda: array.array('Q'))
        for p in parts:
            d = load(p['_file']); o = p['_off']; src = d['base'] if fam == 'b' else d['comm']; del d
            wmap = [whos[w['who']]['id'] for w in p['who']]
            for t, dl in src.items():
                vals = undelta(dl)
                if fam == 'b': vals = array.array('Q', ((o + v) for v in vals))
                else: vals = array.array('Q', ((((o + (v >> 10)) << bits) | wmap[v & 1023]) for v in vals))
                ex[t].extend(vals)
                for k in keys_of(t)[1:]: xp[k].extend(vals)
        # expanded index also contains the exact words themselves
        for t, v in ex.items(): xp[t].extend(v)
        for name, idx in ((fam, ex), (fam + 'x', xp)):
            stats[name] = write_family(outdir, name, idx)
        del ex, xp
    manifest = {'schema': 1, 'v': 'v' + ver, 'built': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'cm': cm, 'segments': off,
                'who': sorted(whos.values(), key=lambda w: w['id']), 'books': books, 'split': {k: v['split'] for k, v in stats.items()}}
    json.dump(manifest, open(os.path.join(a.out, 'search', 'manifest.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    tot = sum(v['bytes'] for v in stats.values())
    print(json.dumps({k: {'files': v['files'], 'bytes': v['bytes'], 'terms': v['terms'], 'max': v['max']} for k, v in stats.items()}))
    print(f'books={len(books)} segments={off} commentators={len(whos)} cm={cm} total={tot / 1e6:.1f} MB manifest={os.path.getsize(os.path.join(a.out, "search", "manifest.json")) / 1e3:.0f} KB')

PACK = 16_000_000
def write_family(outdir, fam, idx, limit=300_000):
    """shards are packed into ~16 MB files (few R2 objects: the REST upload limit is requests, not bytes); <fam>.loc.json maps shard key -> [pack, offset, length]"""
    est = collections.Counter()
    for t, v in idx.items(): est[''.join(chr(96 + CODE[c]) for c in t[:2])] += len(v) * 2 + len(t) + 8
    split = {k for k, b in est.items() if b > limit}
    groups = collections.defaultdict(list)
    for t, v in idx.items(): groups[key_of(t, split)].append((t, sorted(set(v))))
    os.makedirs(os.path.join(outdir, fam), exist_ok=True)
    loc = {}; pack = 0; cur = bytearray(); total = 0; mx = 0; nterms = 0; tmp = os.path.join(outdir, fam, '_tmp.bin')
    def flush():
        nonlocal pack, cur
        if cur: open(os.path.join(outdir, fam, f'p{pack}.bin'), 'wb').write(cur); pack += 1; cur = bytearray()
    for k in sorted(groups):
        n = write_shard(tmp, groups[k]); data = open(tmp, 'rb').read()
        if cur and len(cur) + n > PACK: flush()
        loc[k] = [pack, len(cur), n]; cur += data; total += n; mx = max(mx, n); nterms += len(groups[k])
    flush(); os.remove(tmp)
    json.dump(loc, open(os.path.join(outdir, fam + '.loc.json'), 'w'), separators=(',', ':'))
    return {'files': len(groups), 'bytes': total, 'terms': nterms, 'max': mx, 'split': sorted(split), 'packs': pack}

# ---------------------------------------------------------------- plan / r2
def r2_api():
    sys.path.insert(0, os.path.dirname(__file__))
    import upload_r2
    acct = upload_r2.account()
    return upload_r2, f'{upload_r2.API}/accounts/{acct}/r2/buckets/torah-world-data/objects'

def r2_list(prefix):
    u, base = r2_api(); out = []; cursor = None
    while True:
        url = f'{base}?prefix={urllib.parse.quote(prefix)}&per_page=1000' + (f'&cursor={cursor}' if cursor else '')
        _, body = u.call('GET', url); j = json.loads(body)
        out += [o['key'] for o in j.get('result', [])]
        info = j.get('result_info') or {}
        if not info.get('is_truncated'): return out
        cursor = info.get('cursor')

def r2_get(key):
    u, base = r2_api(); return u.call('GET', base + '/' + urllib.parse.quote(key, safe='/'))[1]

def cmd_plan(a):
    sys.path.insert(0, os.path.dirname(__file__))
    from import_export import catalog
    have = set() if a.force else {k.split('/')[-1][:-8] for k in r2_list('search/_partial/') if k.endswith('.json.gz')}
    items = [{'kind': 'export', 'title': c['title'], 'id': c['work'].replace('/', '-')} for c in catalog()]
    if a.extra:                                               # books added by other sessions (catalog/*.json in R2)
        core = {i['id'] for i in items}
        for k in r2_list('catalog/'):
            if k.endswith('.json'):
                for b in json.loads(r2_get(k)).get('books', []):
                    if b['id'] not in core: items.append({'kind': 'r2', 'title': b['id'], 'id': b['id'], 'secs': b['secs']}); core.add(b['id'])
    items = [i for i in items if i['id'] not in have]
    if a.only: only = set(a.only.split(',')); items = [i for i in items if i['id'] in only or i['title'] in only]
    ex = [i for i in items if i['kind'] == 'r2']; items = [i for i in items if i['kind'] != 'r2']
    for k in range(0, len(ex), a.batch):        # GitHub matrices are limited to 256 jobs: several books per job
        ids = [i['id'] for i in ex[k:k + a.batch]]; items.append({'kind': 'r2batch', 'title': f'batch-{k // a.batch}', 'id': f'batch-{k // a.batch}', 'ids': ','.join(ids)})
    print(json.dumps(items, ensure_ascii=False, separators=(',', ':')))

def fetch_book(book, out, secs=''):
    """write the section files of one non-Sefaria book under <out>/<cat>/<rest>/: from packs/<book>/index.json (few big GETs) or one GET per section"""
    cat, rest = book.split('-', 1); d = os.path.join(out, cat, rest); os.makedirs(d, exist_ok=True)
    try: idx = json.loads(r2_get(f'packs/{book}/index.json'))
    except Exception: idx = None
    if idx and idx.get('secs'):
        blobs = {}
        for sec, (fi, off, ln) in idx['secs'].items():
            if fi not in blobs: blobs[fi] = r2_get(f"packs/{book}/{idx['files'][fi]}")
            open(os.path.join(d, sec + '.json'), 'wb').write(blobs[fi][off:off + ln])
        return len(idx['secs'])
    names = secs.split(',') if secs else [k.rsplit('/', 1)[1][:-5] for k in r2_list(f'sections/{cat}/{rest}/') if k.endswith('.json')]
    for sname in names:
        try: open(os.path.join(d, sname + '.json'), 'wb').write(r2_get(f'sections/{cat}/{rest}/{sname}.json'))
        except Exception as e: print('missing', sname, e)
        time.sleep(0.35)                                      # ~3 req/s: the REST API allows ~1200 per 5 min for the whole account
    return len(names)

def cmd_fetch_r2(a):
    print(f'{a.book}: fetched {fetch_book(a.book, a.out, a.secs)} sections')

def cmd_batch(a):
    """fetch + partial for several non-Sefaria books (one CI job)"""
    import shutil
    for book in a.ids.split(','):
        tmp = os.path.join(a.work, 'sections')
        try:
            if os.path.isdir(tmp): shutil.rmtree(tmp)
            n = fetch_book(book, tmp)
            if not n: print('no sections for', book); continue
            cmd_partial(argparse.Namespace(sections=tmp, book=book, out=a.out))
        except Exception as e: print('FAILED', book, str(e)[:200])

def cmd_fetch_partials(a):
    from concurrent.futures import ThreadPoolExecutor
    os.makedirs(a.out, exist_ok=True)
    keys = [k for k in r2_list('search/_partial/') if k.endswith('.json.gz')]
    def one(k):
        fn = os.path.join(a.out, k.split('/')[-1])
        if os.path.exists(fn) and os.path.getsize(fn) > 0: return 0          # resumable
        try: data = r2_get(k)
        except Exception as e: print('FAILED', k, str(e)[:100], flush=True); return 1
        open(fn + '.part', 'wb').write(data); os.replace(fn + '.part', fn); return 0
    with ThreadPoolExecutor(a.threads) as ex: failed = sum(ex.map(one, keys))
    print(f'{len(keys)} partials, {failed} failed')
    if failed: sys.exit(1)

def selftest():
    assert words('בְּרֵאשִׁ֖ית בָּרָ֣א <b>אֱלֹהִ֑ים</b> רמב"ם ר״ן וכו\' על־כן') == ['בראשית', 'ברא', 'אלהימ', 'רמבמ', 'רנ', 'וכו', 'על', 'כנ'], words('בְּרֵאשִׁ֖ית בָּרָ֣א <b>אֱלֹהִ֑ים</b> רמב"ם ר״ן וכו\' על־כן')
    assert keys_of('ובשמים') == ['ובשמים', 'בשמים', 'שמים'] and keys_of('שמ') == ['שמ']
    b = bytearray(); enc_list(list(range(5, 5000, 7)), b); assert len(b) > 0
    print('ok')

def main():
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest='cmd', required=True)
    p = sp.add_parser('plan'); p.add_argument('--force', action='store_true'); p.add_argument('--extra', action='store_true'); p.add_argument('--only', default=''); p.add_argument('--batch', type=int, default=30)
    p = sp.add_parser('partial'); p.add_argument('--sections', required=True); p.add_argument('--book', required=True); p.add_argument('--out', required=True)
    p = sp.add_parser('fetch-r2'); p.add_argument('--book', required=True); p.add_argument('--out', required=True); p.add_argument('--secs', default='')
    p = sp.add_parser('batch'); p.add_argument('--ids', required=True); p.add_argument('--work', default='work'); p.add_argument('--out', required=True)
    p = sp.add_parser('fetch-partials'); p.add_argument('--out', required=True); p.add_argument('--threads', type=int, default=6)
    p = sp.add_parser('merge'); p.add_argument('--partials', required=True); p.add_argument('--out', required=True); p.add_argument('--version', default='')
    sp.add_parser('selftest')
    a = ap.parse_args()
    {'plan': cmd_plan, 'partial': cmd_partial, 'fetch-r2': cmd_fetch_r2, 'batch': cmd_batch, 'fetch-partials': cmd_fetch_partials, 'merge': cmd_merge, 'selftest': lambda _: selftest()}[a.cmd](a)

if __name__ == '__main__':
    main()
