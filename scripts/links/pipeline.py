#!/usr/bin/env python3
"""Links pipeline for one book (re-runnable; downloads are cached in --cache, uploads overwrite).
  1. fetch section files from R2 (cache)        2. stream Sefaria links CSVs, filter to our books (cache)
  3. validate commentary placement -> reports   4. Sefaria links + string-match connections -> links/<book>/<sec>.json
  5. upload links/** and reports/** to R2 (unless --no-upload)
Usage: python3 scripts/links/pipeline.py --book bavli-berakhot [--cache cache] [--out out] [--no-upload]"""
import argparse, collections, datetime, json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
from common import *
import r2, fetch_links, sefaria_links, stringmatch

def merge(a, b):
    """a = sefaria links, b = string-match links: same (idx,to) -> keep official link, add word range from the match"""
    key = lambda l: (l['from']['idx'], json.dumps(l['to'], sort_keys=True))
    out = {key(l): l for l in a}
    for l in b:
        k = key(l)
        if k in out:
            o = out[k]; o['note'] += '; also found by text match'; o['confidence'] = max(o['confidence'], l['confidence'])
            if 'ws' not in o['from']: o['from'].update(ws=l['from']['ws'], we=l['from']['we'])
        else: out[k] = l
    return sorted(out.values(), key=lambda l: (l['from']['idx'], l['from'].get('ws', -1), -l['confidence']))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--book', required=True, choices=sorted(BOOKS)); ap.add_argument('--cache', default='cache'); ap.add_argument('--out', default='out')
    ap.add_argument('--no-upload', action='store_true'); ap.add_argument('--skip-validate', action='store_true'); a = ap.parse_args()
    print('1/5 section files from R2 ...', flush=True)
    keys = [section_key(b, s) for b, v in BOOKS.items() if v['kind'] != 'tanakh' for s in v['secs']]
    got = r2.get_many(keys, a.cache); print('   ', sum(1 for v in got.values() if v), '/', len(keys))
    print('2/5 Sefaria links CSV (filtered) ...', flush=True)
    if not os.path.exists(os.path.join(a.cache, 'links_filtered.csv')): fetch_links.main(a.cache)
    if BOOKS[a.book]['kind'] != 'tanakh' and not a.skip_validate:
        print('3/5 validation ...', flush=True)
        subprocess.run([sys.executable, '-I', os.path.join(here, 'validate.py'), '--book', a.book, '--cache', a.cache, '--out', a.out], check=True, stdout=subprocess.DEVNULL)
    print('4/5 building links ...', flush=True)
    sl, st1 = sefaria_links.build(a.book, a.cache); sm, st2 = stringmatch.build(a.book, a.cache)
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'); total = collections.Counter(); uploads = []
    for sec in sorted(set(sl) | set(sm)):
        links = merge(sl.get(sec, []), sm.get(sec, []))
        fn = os.path.join(a.out, 'links', a.book, sec + '.json'); os.makedirs(os.path.dirname(fn), exist_ok=True)
        json.dump({'schema': 1, 'work': a.book, 'sec': sec, 'generated': now, 'links': links}, open(fn, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        uploads.append((f'links/{a.book}/{sec}.json', fn))
        for l in links: total[l['source'] + '/' + l['type']] += 1
    summary = dict(book=a.book, sections=len(uploads), links=sum(total.values()), by_source_type=dict(total), generated=now)
    json.dump(summary, open(os.path.join(a.out, 'links', a.book + '.summary.json'), 'w'), indent=1)
    uploads.append((f'links/{a.book}.summary.json', os.path.join(a.out, 'links', a.book + '.summary.json')))
    for f in (f'reports/links/{a.book}.json', f'reports/links/{a.book}.placement.json'):
        if os.path.exists(os.path.join(a.out, f)): uploads.append((f, os.path.join(a.out, f)))
    print('   ', summary['links'], 'links in', summary['sections'], 'sections', dict(total))
    if a.no_upload: return
    print('5/5 upload', len(uploads), 'files ...', flush=True)
    ok = r2.put_many(uploads); print('    uploaded', sum(ok), '/', len(ok))
    if not all(ok): sys.exit('some uploads failed (re-run: safe)')
if __name__ == '__main__': main()
