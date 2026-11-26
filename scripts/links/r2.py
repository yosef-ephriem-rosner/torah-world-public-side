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
    for _ in range(3):
        r = _run(['put', f'{BUCKET}/{key}', '--remote', '--file', path, '--content-type', ctype])
        if r.returncode == 0: return True
    return False
def get_many(keys, cache='cache', workers=8):
    with cf.ThreadPoolExecutor(workers) as ex: return dict(zip(keys, ex.map(lambda k: get(k, cache), keys)))
def put_many(items, workers=8):
    with cf.ThreadPoolExecutor(workers) as ex: return list(ex.map(lambda kv: put(*kv), items))
