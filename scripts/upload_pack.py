#!/usr/bin/env python3
"""Upload section files as a few big "pack" files instead of thousands of tiny objects (the Cloudflare REST API is rate limited, ~1 request/second per upload job).

Usage:  CLOUDFLARE_API_TOKEN=... python3 scripts/upload_pack.py <out-dir> [--pack-mb 8] [--threads 2]
Reads   <out>/sections/<category>/<slug>/<sec>.json   (what import_export.py / import_more*.py / import_thought.py write)
Writes  packs/<book-id>/<stamp>-<k>.bin   concatenated section JSON documents (about --pack-mb MB each)
        packs/<book-id>/index.json        {"v":1,"files":[...],"secs":{"<sec>":[fileIdx,offset,length]}}
and also uploads the plain files under <out>/manifest, <out>/catalog and any other <out>/<dir>/**.json as normal objects (few of them).
The Worker reads a section with an R2 range request using the index (falls back to sections/<cat>/<slug>/<sec>.json for books without packs).
The index is uploaded LAST for each book, so readers never see a half-written book. Book id = "<category>-<slug>" (first path part + '-' + rest, joined with '-').
"""
import argparse, json, os, sys, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
from upload_r2 import call, account, API  # same REST helper with retries/backoff

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('dir'); ap.add_argument('--bucket', default=os.environ.get('R2_BUCKET', 'torah-world-data')); ap.add_argument('--pack-mb', type=float, default=8); ap.add_argument('--threads', type=int, default=2)
    a = ap.parse_args()
    if not os.environ.get('CLOUDFLARE_API_TOKEN'): sys.exit('CLOUDFLARE_API_TOKEN missing')
    base = f'{API}/accounts/{account()}/r2/buckets/{a.bucket}/objects/'
    put = lambda key, data, ctype: call('PUT', base + urllib.parse.quote(key, safe='/'), data, ctype)
    stamp = time.strftime('%Y%m%d%H%M%S', time.gmtime()); limit = int(a.pack_mb * 1024 * 1024); failed = []; n_obj = [0]
    # 1) packs for every book under sections/
    sroot = os.path.join(a.dir, 'sections'); books = []
    if os.path.isdir(sroot):
        for cat in sorted(os.listdir(sroot)):
            for slug in sorted(os.listdir(os.path.join(sroot, cat))):
                d = os.path.join(sroot, cat, slug)
                if os.path.isdir(d): books.append((f'{cat}-{slug}', d))
    def do_book(item):
        bid, d = item; files, secs = [], {}; cur = bytearray(); k = 0
        def flush():
            nonlocal cur, k
            if not cur: return
            name = f'{stamp}-{k}.bin'; put(f'packs/{bid}/{name}', bytes(cur), 'application/octet-stream'); n_obj[0] += 1; files.append(name); k += 1; cur = bytearray()
        for fn in sorted(os.listdir(d)):
            if not fn.endswith('.json'): continue
            data = open(os.path.join(d, fn), 'rb').read()
            if cur and len(cur) + len(data) > limit: flush()
            secs[fn[:-5]] = [len(files), len(cur), len(data)]; cur += data
        flush()
        put(f'packs/{bid}/index.json', json.dumps({'v': 1, 'files': files, 'secs': secs}, separators=(',', ':')).encode(), 'application/json; charset=utf-8'); n_obj[0] += 1
        print(f'  {bid}: {len(secs)} sections in {len(files)} pack file(s)', flush=True)
    def safe(item):
        try: do_book(item)
        except Exception as e: failed.append((item[0], str(e)))
    print(f'packing {len(books)} book(s)')
    with ThreadPoolExecutor(a.threads) as ex: list(ex.map(safe, books))
    # 2) everything else (manifest/, catalog/, ...) as normal objects
    others = []
    for root, _, names in os.walk(a.dir):
        rel = os.path.relpath(root, a.dir).replace(os.sep, '/')
        if rel == 'sections' or rel.startswith('sections/'): continue
        for n in names:
            if n.endswith('.json'): others.append(os.path.join(root, n))
    def up(path):
        key = os.path.relpath(path, a.dir).replace(os.sep, '/')
        try: put(key, open(path, 'rb').read(), 'application/json; charset=utf-8'); n_obj[0] += 1
        except Exception as e: failed.append((key, str(e)))
    with ThreadPoolExecutor(a.threads) as ex: list(ex.map(up, others))
    print(f'done: {n_obj[0]} objects uploaded, {len(failed)} failed')
    for k, e in failed[:10]: print('FAILED', k, e)
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
