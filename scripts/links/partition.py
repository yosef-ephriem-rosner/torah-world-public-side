#!/usr/bin/env python3
"""ONE streaming pass over Sefaria's links0..12.csv: every row that touches a catalog book (as base passage or as 'X on <book> ...' commentary)
is appended to spool/<book>.csv. Resumable per CSV part (cache/spool_parts/<n>/ + .done marker). The 13 files are never stored."""
import collections, csv, io, os, re, shutil, sys, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from common import *
BASE = 'https://storage.googleapis.com/sefaria-export/links/links%d.csv'
_ON = re.compile(r'^.+? on (.+) (\d+[ab]?)(?::|-|$)')
def books_of(cite):
    p = parse_site_ref(cite)
    if p: return p[0]
    if ' on ' in cite:
        m = _ON.match(cite)
        if m:
            b = _T2B_get(m[1])
            if b: return b
    return None
def _T2B_get(title):
    import common; return common._T2B.get(title)

def partition(cache):
    done_all = os.path.join(cache, 'spool', '.done')
    if os.path.exists(done_all): return
    for n in range(13):
        pd = os.path.join(cache, 'spool_parts', str(n))
        if os.path.exists(os.path.join(pd, '.done')): continue
        shutil.rmtree(pd, ignore_errors=True); os.makedirs(pd)
        for attempt in range(4):
            files = {}; tot = kept = 0
            try:
                with urllib.request.urlopen(BASE % n, timeout=300) as r:
                    rd = csv.reader(io.TextIOWrapper(r, encoding='utf-8', newline='')); next(rd)
                    for row in rd:
                        tot += 1
                        if len(row) < 7: continue
                        bs = {b for b in (books_of(row[0]), books_of(row[1])) if b}
                        for b in bs:
                            if b not in files: files[b] = csv.writer(open(os.path.join(pd, b + '.csv'), 'a', newline='', encoding='utf-8'))
                            files[b].writerow(row)
                        kept += bool(bs)
                open(os.path.join(pd, '.done'), 'w').close(); break
            except Exception as e:
                print('retry part', n, e, file=sys.stderr); shutil.rmtree(pd, ignore_errors=True); os.makedirs(pd)
        else: sys.exit(f'links{n} failed')
        print(f'links{n}: kept {kept}/{tot}', flush=True)
    sp = os.path.join(cache, 'spool'); shutil.rmtree(sp, ignore_errors=True); os.makedirs(sp)
    for n in range(13):
        pd = os.path.join(cache, 'spool_parts', str(n))
        for f in os.listdir(pd):
            if f.endswith('.csv'):
                with open(os.path.join(sp, f), 'ab') as out, open(os.path.join(pd, f), 'rb') as src: shutil.copyfileobj(src, out)
    open(done_all, 'w').close()
