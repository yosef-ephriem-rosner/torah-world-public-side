#!/usr/bin/env python3
"""Links for ALL catalog books (R2 catalog.json + catalog/<family>.json) in one streaming pass over the links CSVs.
 1. catalogs from R2          2. partition.py: one pass over links0..12.csv -> spool/<book>.csv
 3. per book (with --resume skipping those already done): validate -> placement (Tanakh/Talmud/Mishnah), Sefaria links + string-match -> links/
 4. linksin = inverse of every link whose target is a site passage (reads links of books not built in this run from R2 link packs)
 5. upload (links/ per file unless --packs-only), reports/, placement/, and the link packs (linkpacks/<book>/<kind>.*)
Usage: python3 scripts/links/links_all.py --group <Category[,Category..]|Tanakh|Mishnah|Talmud|new|all> [--cache cache --out out] [--resume] [--books a,b]
         [--no-upload] [--placement-only] [--packs-only] [--skip-linksin] [--linksin-only]
 Parallel family runs: use --skip-linksin for each, then ONE final run with --linksin-only (rebuilds linksin for every book from the packs)."""
import argparse, collections, datetime, json, os, resource, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
import common
from common import *
import r2, partition, sefaria_links, stringmatch, placement
from pipeline import merge
CORE = ('Tanakh', 'Mishnah', 'Talmud')

def load_catalog(cache):
    fn = r2.get('catalog.json', cache)
    if not fn:
        print('no catalog.json in R2 yet: using the 6 first-run books', file=sys.stderr); return None, {}
    cat = json.load(open(fn, encoding='utf-8'))
    try:
        for k in r2.rest_list('catalog/'):
            if k.endswith('.json'):
                ids = {b['id'] for b in cat['books']}
                cat['books'] += [b for b in json.loads(r2.rest_get(k)).get('books', []) if b['id'] not in ids]
    except Exception as e: print('warn: could not read catalog/*.json:', str(e)[:100], file=sys.stderr)
    books = catalog_books(cat); order = {b['id']: b for b in cat['books']}
    return books, {i: order[i]['cat'] for i in books}

def pack(bs, kinds):
    if ARGS.no_upload or not bs: return
    import pack_links
    print('packing', kinds, len(bs), 'books ...', flush=True)
    if not pack_links.pack({b: BOOKS[b]['secs'] for b in bs}, ARGS.out, ARGS.cache, kinds=kinds): sys.exit('some packs failed (re-run: safe)')

def fetch_sections(book, cache):
    """sections of one book into cache: pack first (few big objects), else per-file"""
    got = r2.get_pack_files('packs', None, book, cache)
    if len(got) >= len(BOOKS[book]['secs']) * 0.9: return len(got)
    got2 = r2.get_many([section_key(book, s) for s in BOOKS[book]['secs'] if s not in got], cache, workers=8)
    return len(got) + sum(1 for v in got2.values() if v)

def main():
    try: resource.setrlimit(resource.RLIMIT_NOFILE, (resource.getrlimit(resource.RLIMIT_NOFILE)[1],) * 2)
    except Exception: pass
    ap = argparse.ArgumentParser(); ap.add_argument('--group', default='all'); ap.add_argument('--books', default='')
    ap.add_argument('--cache', default='cache'); ap.add_argument('--out', default='out'); ap.add_argument('--resume', action='store_true'); ap.add_argument('--no-upload', action='store_true')
    ap.add_argument('--placement-only', action='store_true', help='only validate + placement (+ placement packs) for the books in scope; links are left untouched')
    ap.add_argument('--packs-only', action='store_true', help='do not write per-file links/ and linksin/ objects, only packs (+summary, reports, placement)')
    ap.add_argument('--skip-linksin', action='store_true'); ap.add_argument('--linksin-only', action='store_true')
    a = ARGS = ap.parse_args()
    globals()['ARGS'] = a
    books, cats = load_catalog(a.cache)
    if books: common.set_books(books)
    else: cats = {b: {'tanakh': 'Tanakh', 'mishnah': 'Mishnah', 'talmud': 'Talmud'}[v['kind']] for b, v in BOOKS.items()}
    groups = set(a.group.split(','))
    inscope = lambda b: 'all' in groups or cats.get(b) in groups or ('new' in groups and cats.get(b) not in CORE)
    todo = [] if a.linksin_only else [b for b in BOOKS if inscope(b) and (not a.books or b in a.books.split(','))]
    print('books in scope:', len(todo), 'of', len(BOOKS), flush=True)
    # sections: the string-match corpora (Talmud + Mishnah) when something is built, plus the books we build
    need = [] if (a.linksin_only or a.placement_only) else [b for b in BOOKS if BOOKS[b]['kind'] in ('talmud', 'mishnah') and b not in todo]
    n = 0
    for b in need + todo: n += fetch_sections(b, a.cache)
    print('section files:', n, flush=True)
    todo = [b for b in todo if os.path.exists(os.path.join(a.cache, section_key(b, BOOKS[b]['secs'][0]))) or any(os.path.exists(os.path.join(a.cache, section_key(b, s))) for s in BOOKS[b]['secs'][:5])]
    if todo: print('2/5 one pass over links CSVs ...', flush=True); partition.partition(a.cache)
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'); allout = {}; ups = []; placed = []; built = []
    done_before = set()
    if a.resume and not a.placement_only:
        have = set(r2.rest_list('links/')) if todo else set()
        done_before = {b for b in todo if f'links/{b}.summary.json' in have}
    for book in todo:
        if book in done_before: print('skip (done):', book); continue
        if not os.path.exists(links_csv(a.cache, book)) or 'spool' not in links_csv(a.cache, book):
            os.makedirs(os.path.join(a.cache, 'spool'), exist_ok=True); open(os.path.join(a.cache, 'spool', book + '.csv'), 'a').close()
        if a.placement_only and BOOKS[book]['kind'] == 'other': continue
        print('==', book, flush=True)
        if BOOKS[book]['kind'] in ('talmud', 'mishnah') or (a.placement_only and BOOKS[book]['kind'] == 'tanakh'):
            subprocess.run([sys.executable, '-I', os.path.join(here, 'validate.py'), '--book', book, '--cache', a.cache, '--out', a.out, '--catalog'], check=True, stdout=subprocess.DEVNULL)
            rep = json.load(open(os.path.join(a.out, f'reports/links/{book}.json')))
            for sec, doc in placement.build(book, a.cache, rep).items():
                fn = os.path.join(a.out, 'placement', book, sec + '.json'); os.makedirs(os.path.dirname(fn), exist_ok=True)
                json.dump(doc, open(fn, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':')); ups.append((f'placement/{book}/{sec}.json', fn))
            for f in (f'reports/links/{book}.json', f'reports/links/{book}.placement.json'): ups.append((f, os.path.join(a.out, f)))
        if a.placement_only:
            if not a.no_upload:
                ok = r2.put_many(ups); ups = [u for u, k in zip(ups, ok) if not k]
            placed.append(book); continue
        sl, _ = sefaria_links.build(book, a.cache); sm, _ = stringmatch.build(book, a.cache)
        total = collections.Counter(); allout[book] = {}
        for sec in sorted(set(sl) | set(sm)):
            links = merge(sl.get(sec, []), sm.get(sec, [])); allout[book][sec] = links
            fn = os.path.join(a.out, 'links', book, sec + '.json'); os.makedirs(os.path.dirname(fn), exist_ok=True)
            json.dump({'schema': 1, 'work': book, 'sec': sec, 'generated': now, 'links': links}, open(fn, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
            if not a.packs_only: ups.append((f'links/{book}/{sec}.json', fn))
            for l in links: total[l['source'] + '/' + l['type']] += 1
        fn = os.path.join(a.out, 'links', book + '.summary.json')
        json.dump(dict(book=book, sections=len(allout[book]), links=sum(total.values()), by_source_type=dict(total), generated=now), open(fn, 'w'), indent=1); ups.append((f'links/{book}.summary.json', fn))
        built.append(book); print('   ', sum(total.values()), 'links', flush=True)
        if not a.no_upload and len(built) % 5 == 0:   # packs, then files + summary (= done marker), in batches: resumable if the job dies later
            pack(built[-5:], ('links',))
            ok = r2.put_many(ups); ups = [u for u, k in zip(ups, ok) if not k]
            if ups: print('   upload failures (will retry at the end):', len(ups))
    if a.placement_only:
        if ups: sys.exit(f'{len(ups)} placement uploads failed (re-run: safe)')
        pack(placed, ('placement',)); return
    if built[len(built) // 5 * 5:]: pack(built[len(built) // 5 * 5:], ('links',))   # the last partial batch
    if not a.no_upload and ups:
        ok = r2.put_many(ups); ups = [u for u, k in zip(ups, ok) if not k]
        if ups: sys.exit(f'{len(ups)} uploads failed (re-run with --resume: safe)')
    if a.skip_linksin: return
    # incoming links, including links of books not built in this run (read from their link packs in R2)
    for b in BOOKS:
        if b in allout: continue
        got = r2.get_pack_files('linkpacks', 'links', b, a.cache)
        if not got and r2.get(f'links/{b}.summary.json', os.path.join(a.cache, 'r2state')):   # no pack (yet): per-file
            got = {s: fn for s, fn in ((s, r2.get(f'links/{b}/{s}.json', a.cache)) for s in BOOKS[b]['secs']) if fn}
        if got: allout[b] = {sec: json.load(open(fn, encoding='utf-8'))['links'] for sec, fn in got.items()}
    inc = collections.defaultdict(lambda: collections.defaultdict(list))
    for book, secs in allout.items():
        for sec, links in secs.items():
            for l in links:
                t = l['to']
                if 'work' not in t or t['work'] not in BOOKS: continue
                inc[t['work']][t['sec']].append({'from': dict(work=book, sec=sec, **l['from']), 'to': {'work': t['work'], 'sec': t['sec'], 'idx': t['idx']}, 'type': l['type'], 'source': l['source'], 'confidence': l['confidence'], 'note': l['note'], 'review': l['review']})
    ups = []
    for tb, secs in inc.items():
        for sec, links in secs.items():
            links.sort(key=lambda l: (l['to']['idx'], -l['confidence']))
            fn = os.path.join(a.out, 'linksin', tb, sec + '.json'); os.makedirs(os.path.dirname(fn), exist_ok=True)
            json.dump({'schema': 1, 'work': tb, 'sec': sec, 'generated': now, 'links': links}, open(fn, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
            if not a.packs_only: ups.append((f'linksin/{tb}/{sec}.json', fn))
    print('linksin:', sum(len(s) for s in inc.values()), 'sections in', len(inc), 'books; per-file uploads:', len(ups), flush=True)
    if not a.no_upload and ups:
        ok = r2.put_many(ups)
        if not all(ok): sys.exit('some uploads failed (re-run: safe)')
    pack(list(inc), ('linksin',))
if __name__ == '__main__': main()
