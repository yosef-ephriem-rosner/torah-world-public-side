#!/usr/bin/env python3
"""Upload search index files (.bin shards, .json.gz partials, manifest.json) to R2 with the same REST client as upload_r2.py (retries, 429 backoff).
Usage: python3 scripts/upload_search.py <dir> [--threads 2] [--skip-manifest]   (key = path relative to <dir>; the manifest is uploaded LAST so the switch to a new version is atomic)"""
import argparse, os, sys, urllib.parse
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
import upload_r2

CT = {'.bin': 'application/octet-stream', '.gz': 'application/gzip', '.json': 'application/json; charset=utf-8'}
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('dir'); ap.add_argument('--bucket', default='torah-world-data'); ap.add_argument('--threads', type=int, default=2); a = ap.parse_args()
    acct = upload_r2.account(); base = f'{upload_r2.API}/accounts/{acct}/r2/buckets/{a.bucket}/objects/'
    files = [os.path.join(r, n) for r, _, ns in os.walk(a.dir) for n in ns]
    man = [f for f in files if f.endswith('manifest.json')]; files = sorted(f for f in files if f not in man)
    failed = []; done = [0]
    def up(path):
        key = os.path.relpath(path, a.dir).replace(os.sep, '/')
        try: upload_r2.call('PUT', base + urllib.parse.quote(key, safe='/'), open(path, 'rb').read(), CT.get(os.path.splitext(path)[1], 'application/octet-stream'))
        except Exception as e: failed.append((key, str(e))); return
        done[0] += 1
        if done[0] % 100 == 0: print(f'  {done[0]}/{len(files)}', flush=True)
    print(f'uploading {len(files)} files (+{len(man)} manifest)')
    with ThreadPoolExecutor(a.threads) as ex: list(ex.map(up, files))
    if not failed:
        for m in man: up(m)
    print(f'done: {done[0]} uploaded, {len(failed)} failed')
    for k, e in failed[:10]: print('FAILED', k, e)
    sys.exit(1 if failed else 0)
main()
