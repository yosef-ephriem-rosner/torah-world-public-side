#!/usr/bin/env python3
"""Stream Sefaria's official links CSVs (public GCS bucket gs://sefaria-export/links/links0..12.csv) and keep only rows that touch our books.
Output: <cache>/links_filtered.csv (resumable per-file via <cache>/links_parts/linksN.csv). Never stores the whole dataset."""
import csv, io, os, re, sys, urllib.request
BASE = 'https://storage.googleapis.com/sefaria-export/links/links%d.csv'
BOOKS = ['Berakhot', 'Mishnah Berakhot', 'Shabbat', 'Mishnah Peah', 'Genesis', 'Exodus']
PAT = re.compile(r'(^|\bon )(' + '|'.join(BOOKS) + r')( \d|$)')
def keep(row):
    return any(PAT.search(row[i]) for i in (0, 1))
def main(cache):
    parts = os.path.join(cache, 'links_parts'); os.makedirs(parts, exist_ok=True)
    for n in range(13):
        fn = os.path.join(parts, f'links{n}.csv')
        if os.path.exists(fn): continue
        tmp = fn + '.tmp'; kept = tot = 0
        for attempt in range(4):
            try:
                with urllib.request.urlopen(BASE % n, timeout=300) as r, open(tmp, 'w', newline='') as out:
                    w = csv.writer(out); kept = tot = 0
                    rd = csv.reader(io.TextIOWrapper(r, encoding='utf-8', newline=''))
                    next(rd)
                    for row in rd:
                        tot += 1
                        if len(row) >= 7 and keep(row): w.writerow(row); kept += 1
                os.replace(tmp, fn); break
            except Exception as e:
                print('retry', n, e, file=sys.stderr)
        print(f'links{n}: kept {kept}/{tot}', flush=True)
    with open(os.path.join(cache, 'links_filtered.csv'), 'w', newline='') as out:
        w = csv.writer(out); w.writerow(['Citation 1','Citation 2','Conection Type','Text 1','Text 2','Category 1','Category 2'])
        for n in range(13):
            out.write(open(os.path.join(parts, f'links{n}.csv'), newline='').read())
if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'cache')
