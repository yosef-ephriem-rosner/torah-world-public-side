#!/usr/bin/env python3
"""Embed public/ files into worker/assets.js so the Worker deploys as a single script (static-asset upload is blocked behind the sandbox proxy)."""
import json, os, base64
root = os.path.join(os.path.dirname(__file__), '..')
types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json; charset=utf-8'}
files = {}
def walk(d, prefix):
    for f in sorted(os.listdir(d)):
        p = os.path.join(d, f)
        if os.path.isdir(p): walk(p, prefix + f + '/'); continue
        ext = os.path.splitext(f)[1]
        if ext not in types: continue
        if ext in ('.woff2', '.png'): files['/' + prefix + f] = {'type': types[ext], 'b64': base64.b64encode(open(p, 'rb').read()).decode()}
        else: files['/' + prefix + f] = {'type': types[ext], 'body': open(p, encoding='utf-8').read()}
walk(os.path.join(root, 'public'), '')
open(os.path.join(root, 'worker', 'assets.js'), 'w', encoding='utf-8').write('export default ' + json.dumps(files, ensure_ascii=False) + ';\n')
print('embedded', len(files), 'files,', sum(len(v.get('body', '')) + len(v.get('b64', '')) for v in files.values()) // 1024, 'KB')
