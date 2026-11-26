#!/usr/bin/env python3
"""Links for ALL catalog books in one streaming pass over the links CSVs.
 1. catalog.json from R2 (fallback: the 6 books of the first run)      2. partition.py: one pass over links0..12.csv -> spool/<book>.csv
 3. per book (skipping books without sections in R2, and with --resume those already done): validate -> placement, Sefaria links + string-match -> links/
 4. linksin/ = inverse of every link whose target is a site passage (also includes links/ of books not rebuilt in this run, read from R2)
 5. upload links/, linksin/, placement/, reports/links/ to R2
Usage: python3 scripts/links/links_all.py --group Tanakh|Mishnah|Talmud|all [--cache cache --out out] [--resume] [--books a,b] [--no-upload]"""
import argparse, collections, datetime, json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
import common
from common import *
import r2, partition, sefaria_links, stringmatch, placement
from pipeline import merge

def load_catalog(cache):
    fn = r2.get('catalog.json', cache)
    if fn:
        cat = json.load(open(fn, encoding='utf-8')); books = catalog_books(cat)
        order = {b['id']: b for b in cat['books']}
        return books, {i: order[i]['cat'] for i in books}
    print('no catalog.json in R2 yet: using the 6 first-run books', file=sys.stderr)
    return None, {}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--group', default='all', choices=['Tanakh', 'Mishnah', 'Talmud', 'all']); ap.add_argument('--books', default='')
    ap.add_argument('--cache', default='cache'); ap.add_argument('--out', default='out'); ap.add_argument('--resume', action='store_true'); ap.add_argument('--no-upload', action='store_true')
    a = ap.parse_args()
    books, cats = load_catalog(a.cache)
    if books: common.set_books(books)
    else: cats = {b: {'tanakh': 'Tanakh', 'mishnah': 'Mishnah', 'talmud': 'Talmud'}[v['kind']] for b, v in BOOKS.items()}
    # which books have sections in R2 (the catalog only lists imported books; first-run fallback checks the files)
    todo = [b for b in BOOKS if (a.group == 'all' or cats.get(b) == a.group) and (not a.books or b in a.books.split(','))]
    print('books in scope:', len(todo), flush=True)
    # sections: all talmud/mishnah (string-match corpora) + the books we build
    keys = [section_key(b, s) for b, v in BOOKS.items() if v['kind'] != 'tanakh' or b in todo for s in v['secs']]
    got = r2.get_many(keys, a.cache, workers=16); print('section files:', sum(1 for v in got.values() if v), '/', len(keys), flush=True)
    present = {b for b in BOOKS if any(got.get(section_key(b, s)) for s in BOOKS[b]['secs'][:3])} if books is None else set(BOOKS)
    todo = [b for b in todo if b in present or BOOKS[b]['kind'] == 'tanakh' and os.path.exists(os.path.join(a.cache, section_key(b, BOOKS[b]['secs'][0])))]
    print('2/5 one pass over links CSVs ...', flush=True); partition.partition(a.cache)
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'); allout = {}; ups = []
    done_before = set()
    if a.resume:
        for b in todo:
            if r2.get(f'links/{b}.summary.json', os.path.join(a.cache, 'r2state')): done_before.add(b)
    for book in todo:
        if book in done_before: print('skip (done):', book); continue
        if not os.path.exists(links_csv(a.cache, book)) or 'spool' not in links_csv(a.cache, book):
            print('no links rows for', book); open(os.path.join(a.cache, 'spool', book + '.csv'), 'a').close()
        print('==', book, flush=True)
        if BOOKS[book]['kind'] != 'tanakh':
            subprocess.run([sys.executable, '-I', os.path.join(here, 'validate.py'), '--book', book, '--cache', a.cache, '--out', a.out, '--catalog'] , check=True, stdout=subprocess.DEVNULL)
            rep = json.load(open(os.path.join(a.out, f'reports/links/{book}.json')))
            for sec, doc in placement.build(book, a.cache, rep).items():
                fn = os.path.join(a.out, 'placement', book, sec + '.json'); os.makedirs(os.path.dirname(fn), exist_ok=True)
                json.dump(doc, open(fn, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':')); ups.append((f'placement/{book}/{sec}.json', fn))
            for f in (f'reports/links/{book}.json', f'reports/links/{book}.placement.json'): ups.append((f, os.path.join(a.out, f)))
        sl, _ = sefaria_links.build(book, a.cache); sm, _ = stringmatch.build(book, a.cache)
        total = collections.Counter(); allout[book] = {}
        for sec in sorted(set(sl) | set(sm)):
            links = merge(sl.get(sec, []), sm.get(sec, [])); allout[book][sec] = links
            fn = os.path.join(a.out, 'links', book, sec + '.json'); os.makedirs(os.path.dirname(fn), exist_ok=True)
            json.dump({'schema': 1, 'work': book, 'sec': sec, 'generated': now, 'links': links}, open(fn, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
            ups.append((f'links/{book}/{sec}.json', fn))
            for l in links: total[l['source'] + '/' + l['type']] += 1
        fn = os.path.join(a.out, 'links', book + '.summary.json')
        json.dump(dict(book=book, sections=len(allout[book]), links=sum(total.values()), by_source_type=dict(total), generated=now), open(fn, 'w'), indent=1); ups.append((f'links/{book}.summary.json', fn))
        print('   ', sum(total.values()), 'links', flush=True)
        if not a.no_upload:   # upload per book: resumable if the job dies later
            ok = r2.put_many(ups); ups = [u for u, k in zip(ups, ok) if not k]
            if ups: print('   upload failures (will retry at the end):', len(ups))
    # incoming links, including links of books not rebuilt in this run (read from R2)
    for b in BOOKS:
        if b in allout: continue
        if r2.get(f'links/{b}.summary.json', os.path.join(a.cache, 'r2state')):
            allout[b] = {}
            for sec, fn in r2.get_many([f'links/{b}/{s}.json' for s in BOOKS[b]['secs']], a.cache, workers=16).items():
                if fn: allout[b][sec.split('/')[-1][:-5]] = json.load(open(fn, encoding='utf-8'))['links']
    inc = collections.defaultdict(lambda: collections.defaultdict(list))
    for book, secs in allout.items():
        for sec, links in secs.items():
            for l in links:
                t = l['to']
                if 'work' not in t or t['work'] not in BOOKS: continue
                inc[t['work']][t['sec']].append({'from': dict(work=book, sec=sec, **l['from']), 'to': {'work': t['work'], 'sec': t['sec'], 'idx': t['idx']}, 'type': l['type'], 'source': l['source'], 'confidence': l['confidence'], 'note': l['note'], 'review': l['review']})
    for tb, secs in inc.items():
        for sec, links in secs.items():
            links.sort(key=lambda l: (l['to']['idx'], -l['confidence']))
            fn = os.path.join(a.out, 'linksin', tb, sec + '.json'); os.makedirs(os.path.dirname(fn), exist_ok=True)
            json.dump({'schema': 1, 'work': tb, 'sec': sec, 'generated': now, 'links': links}, open(fn, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
            ups.append((f'linksin/{tb}/{sec}.json', fn))
    print('final upload:', len(ups), 'files', flush=True)
    if not a.no_upload:
        ok = r2.put_many(ups, workers=16)
        if not all(ok): sys.exit('some uploads failed (re-run with --resume: safe)')
        print('packing ...', flush=True)
        import pack_links
        if not pack_links.pack({b: v['secs'] for b, v in BOOKS.items()}, a.out, a.cache): sys.exit('some packs failed (re-run: safe)')
if __name__ == '__main__': main()
