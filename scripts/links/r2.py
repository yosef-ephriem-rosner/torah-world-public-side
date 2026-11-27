"""R2 helpers via wrangler (token from env CLOUDFLARE_API_TOKEN; never printed). Local cache dir keeps runs resumable."""
import os, subprocess, json, concurrent.futures as cf
BUCKET = 'torah-world-data'
def _run(args):
    return subprocess.run(['npx', 'wrangler', 'r2', 'object'] + args, capture_output=True)
def get(key, cache='cache'):
    fn = os.path.join(cache, key)
    if os.path.exists(fn) and os.path.getsize(fn): return fn
    os.makedirs(os.path.dirname(fn), exist_ok=True)
    for _ in range(3):
        r = _run(['get', f'{BUCKET}/{key}', '--remote', '--file', fn])
        if r.returncode == 0 and os.path.exists(fn) and os.path.getsize(fn): return fn
        if os.path.exists(fn) and not os.path.getsize(fn): os.remove(fn)
    return None
def put(key, path, ctype='application/json'):
    """REST upload with 429/5xx backoff (same helper as scripts/upload_r2.py)"""
    import sys, urllib.parse
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    from upload_r2 import call, account, API
    global _BASE
    if '_BASE' not in globals(): _BASE = f'{API}/accounts/{account()}/r2/buckets/{BUCKET}/objects/'
    try: call('PUT', _BASE + urllib.parse.quote(key, safe='/'), open(path, 'rb').read(), ctype + ('; charset=utf-8' if ctype == 'application/json' else '')); return True
    except Exception as e: print('put failed', key, str(e)[:120], flush=True); return False
def get_many(keys, cache='cache', workers=8):
    with cf.ThreadPoolExecutor(workers) as ex: return dict(zip(keys, ex.map(lambda k: get(k, cache), keys)))
def put_many(items, workers=3):
    with cf.ThreadPoolExecutor(min(workers, 3)) as ex: return list(ex.map(lambda kv: put(*kv), items))

def _rest():
    import sys, urllib.parse
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    import upload_r2
    return upload_r2, f'{upload_r2.API}/accounts/{upload_r2.account()}/r2/buckets/{BUCKET}/objects'
def rest_list(prefix):
    import urllib.parse
    u, base = _rest(); out = []; cursor = None
    while True:
        _, body = u.call('GET', f'{base}?prefix={urllib.parse.quote(prefix)}&per_page=1000' + (f'&cursor={cursor}' if cursor else '')); j = json.loads(body)
        out += [o['key'] for o in j.get('result', [])]; info = j.get('result_info') or {}
        if not info.get('is_truncated'): return out
        cursor = info.get('cursor')
def rest_get(key):
    import urllib.parse
    u, base = _rest(); return u.call('GET', base + '/' + urllib.parse.quote(key, safe='/'))[1]
def get_pack_files(root, kind, book, cache):
    """read linkpacks/<book>/<kind>.* (or packs/<book>/ for sections when root='packs') into cache as per-section files; returns {sec: path}. {} if no pack"""
    ix = 'index.json' if root == 'packs' else f'{kind}.index.json'
    try: idx = json.loads(rest_get(f'{root}/{book}/{ix}'))
    except Exception: return {}
    blobs = {}; got = {}
    for sec, (fi, off, ln) in idx['secs'].items():
        if fi not in blobs: blobs[fi] = rest_get(f'{root}/{book}/{idx["files"][fi]}')
        fn = os.path.join(cache, *( ['sections', book.replace('-', '/', 1)] if root == 'packs' else [kind, book] ), sec + '.json')
        os.makedirs(os.path.dirname(fn), exist_ok=True); open(fn, 'wb').write(blobs[fi][off:off + ln]); got[sec] = fn
    return got
