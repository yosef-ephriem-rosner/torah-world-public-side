"""Pack per-section links/linksin/placement JSON files into a few big objects per book (see docs/LINKS_CONTRACT.md "link packs").
 linkpacks/<book>/<kind>.index.json = {"v":1,"files":[...],"secs":{"<sec>":[fileIdx,offset,length]}}, kind in links|linksin|placement
 linkpacks/<book>/<kind>-<stamp>-<k>.bin = concatenated per-section JSON documents (versioned names, never overwritten; index uploaded LAST).
Section files are taken from out/<kind>/<book>/<sec>.json, else from cache/ (files downloaded from R2 earlier)."""
import json, os, sys, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from upload_r2 import call, account, API
LIMIT = 8 * 1024 * 1024
def pack(books, out, cache, kinds=('links', 'linksin', 'placement'), threads=2, bucket='torah-world-data'):
    base = f'{API}/accounts/{account()}/r2/buckets/{bucket}/objects/'
    put = lambda key, data, ctype: call('PUT', base + urllib.parse.quote(key, safe='/'), data, ctype)
    stamp = time.strftime('%Y%m%d%H%M%S', time.gmtime()); failed = []
    def one(job):
        book, kind, secs = job
        try:
            files, idx, cur, k = [], {}, bytearray(), 0
            def flush():
                nonlocal cur, k
                if not cur: return
                name = f'{kind}-{stamp}-{k}.bin'; put(f'linkpacks/{book}/{name}', bytes(cur), 'application/octet-stream'); files.append(name); k += 1; cur = bytearray()
            for sec in secs:
                for root in (out, cache):
                    fn = os.path.join(root, kind, book, sec + '.json')
                    if os.path.exists(fn) and os.path.getsize(fn): break
                else: continue
                data = open(fn, 'rb').read()
                if cur and len(cur) + len(data) > LIMIT: flush()
                idx[sec] = [len(files), len(cur), len(data)]; cur += data
            flush()
            if idx: put(f'linkpacks/{book}/{kind}.index.json', json.dumps({'v': 1, 'files': files, 'secs': idx}, separators=(',', ':')).encode(), 'application/json; charset=utf-8')
            print(f'  pack {book}/{kind}: {len(idx)} sections, {len(files)} file(s)', flush=True)
        except Exception as e: failed.append((book, kind, str(e)))
    jobs = [(b, kd, list(secs)) for b, secs in books.items() for kd in kinds]
    with ThreadPoolExecutor(threads) as ex: list(ex.map(one, jobs))
    for f in failed[:10]: print('PACK FAILED', f, flush=True)
    return not failed
