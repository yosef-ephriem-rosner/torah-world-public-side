#!/usr/bin/env python3
"""Convert Sefaria's official links (filtered CSV) into contract links for one book. source=sefaria-links."""
import csv, collections, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import *

CAT_TYPE = {'Halakhah': 'halakhah', 'Responsa': 'halakhah', 'Midrash': 'midrash', 'Tanakh': 'quotation', 'Commentary': 'commentary'}
def build(book, cache):
    own_title = BOOKS[book]['title']; stats = collections.Counter(); out = collections.defaultdict(dict)
    comm_on_site = re.compile(r' on (' + '|'.join(re.escape(b['title']) for b in BOOKS.values()) + r') \d')
    for r in csv.reader(open(os.path.join(cache, 'links_filtered.csv'), encoding='utf-8')):
        c1, c2, ctype, cat1, cat2 = r[0], r[1], r[2], r[5], r[6]
        pf = pick_from(c1, c2)
        if not pf: continue
        (b, sec, idx), other = pf; own_is_first = parse_site_ref(c1) is not None
        if b != book: continue
        if comm_on_site.search(other): stats['skipped_commentary_on_our_books'] += 1; continue   # placed by the importer, not a link
        tgt = parse_site_ref(other)
        to = dict(work=tgt[0], sec=tgt[1], idx=tgt[2]) if tgt else {'sefaria': other}
        if tgt and (tgt[0], tgt[1], tgt[2]) == (b, sec, idx): continue
        cat_other = cat2 if own_is_first else cat1
        t = SEFARIA_TYPE.get(ctype)
        if not t: t = CAT_TYPE.get(cat_other, 'parallel')
        conf = 0.7 if ctype.startswith('quotation_auto') else 0.9
        note = f"Sefaria link{' (' + ctype + ')' if ctype else ''} [{cat_other}]: {other}"
        key = (idx, json_key(to), t)
        out[sec][key] = {'from': {'idx': idx}, 'to': to, 'type': t, 'source': 'sefaria-links', 'confidence': conf, 'note': note, 'review': 'unreviewed'}
        stats[t] += 1
    return {s: list(v.values()) for s, v in out.items()}, stats
def json_key(to): return tuple(sorted(to.items()))
if __name__ == '__main__':
    res, st = build(sys.argv[1], sys.argv[2]); print(sum(len(v) for v in res.values()), dict(st))
