#!/usr/bin/env python3
"""Build catalog.json (the list of books on the site) from the per-book manifests.

Usage:
  python3 scripts/build_catalog.py --out out [--manifests DIR]
Reads manifest/<work-id>.json (written by import_export.py --book ...) for every base book Sefaria lists in Tanakh / Mishnah / Bavli,
skips books that have no manifest yet, and writes <out>/catalog.json. Upload it with scripts/upload_r2.sh (key: catalog.json).
In the GitHub workflow the manifests are first downloaded from R2 into --manifests.
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from import_export import catalog

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default='out'); ap.add_argument('--manifests', default=None)
    a = ap.parse_args(); mdir = a.manifests or os.path.join(a.out, 'manifest')
    books = []
    for c in catalog():
        wid = c['work'].replace('/', '-'); fn = os.path.join(mdir, wid + '.json')
        if not os.path.exists(fn): continue
        m = json.load(open(fn))
        if not m.get('secs'): continue
        books.append({'id': wid, 'title': c['title'], 'he': c['he_title'] or c['title'], 'cat': c['cat'], 'group': c['group'], 'order': c['order'],
                      'type': {'tanakh': 'chumash', 'mishnah': 'mishnah', 'talmud': 'daf'}[c['kind']], 'secs': m['secs'],
                      'commentaries': len(m.get('commentaries', [])), 'base_license': m['base']['license'], 'generated': m['generated']})
    os.makedirs(a.out, exist_ok=True)
    json.dump({'schema': 1, 'books': books}, open(os.path.join(a.out, 'catalog.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print('catalog:', len(books), 'books')

if __name__ == '__main__':
    main()
