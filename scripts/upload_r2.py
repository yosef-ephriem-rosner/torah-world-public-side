#!/usr/bin/env python3
"""Upload out/** (sections/, manifest/, ...) to the R2 bucket through Cloudflare's REST API, with retries and rate-limit backoff.

Usage: CLOUDFLARE_API_TOKEN=... python3 scripts/upload_r2.py out [--bucket torah-world-data] [--threads 3]
The key of each object is its path relative to the given directory. The account id is read from CLOUDFLARE_ACCOUNT_ID or looked up from the token.
Exit code 1 if any file could not be uploaded after all retries.
"""
import argparse, json, os, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

API = 'https://api.cloudflare.com/client/v4'
TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')

def call(method, url, data=None, ctype=None, tries=7):
    err = None
    for i in range(tries):
        req = urllib.request.Request(url, data=data, method=method, headers={'Authorization': 'Bearer ' + TOKEN, **({'Content-Type': ctype} if ctype else {})})
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read()
        except urllib.error.HTTPError as e:
            err = f'HTTP {e.code} {e.read()[:200]!r}'
            if e.code not in (429, 500, 502, 503, 504): break
            wait = float(e.headers.get('Retry-After') or 0) or min(60, 2 ** (i + 1))
        except Exception as e:
            err = repr(e); wait = min(60, 2 ** (i + 1))
        time.sleep(wait + (i * 0.3))
    raise RuntimeError(err)

def account():
    a = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    if a: return a
    st, body = call('GET', API + '/accounts'); return json.loads(body)['result'][0]['id']

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('dir'); ap.add_argument('--bucket', default=os.environ.get('R2_BUCKET', 'torah-world-data')); ap.add_argument('--threads', type=int, default=3)
    a = ap.parse_args()
    if not TOKEN: sys.exit('CLOUDFLARE_API_TOKEN missing')
    acct = account(); base = f'{API}/accounts/{acct}/r2/buckets/{a.bucket}/objects/'
    files = []
    for root, _, names in os.walk(a.dir):
        for n in names:
            if n.endswith('.json'): files.append(os.path.join(root, n))
    files.sort(); failed = []; done = [0]
    def up(path):
        key = os.path.relpath(path, a.dir).replace(os.sep, '/')
        try:
            call('PUT', base + urllib.parse.quote(key, safe='/'), open(path, 'rb').read(), 'application/json; charset=utf-8')
        except Exception as e:
            failed.append((key, str(e))); return
        done[0] += 1
        if done[0] % 100 == 0: print(f'  {done[0]}/{len(files)} uploaded', flush=True)
    print(f'uploading {len(files)} files to r2://{a.bucket}')
    with ThreadPoolExecutor(a.threads) as ex: list(ex.map(up, files))
    print(f'done: {done[0]} uploaded, {len(failed)} failed')
    for k, e in failed[:10]: print('FAILED', k, e)
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
