#!/usr/bin/env python3
"""Per-section placement files: re-seat comments of misaligned commentators onto the base segment(s) Sefaria's links say,
or (no link) onto the unique segment whose text contains the dibur hamatchil; anything else goes to 'page' (whole page, idx 0).
Format (R2 placement/<book>/<sec>.json):
 {"schema":1,"work":..,"sec":..,"moves":{who:{"<ourSeg>:<commentIdx>":[correctSegs]}},"page":{who:["<ourSeg>:<commentIdx>",...]}}
Commentators judged ok by validate.py (Rashi, Tosafot, ...) are never touched."""
import collections, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import *
import validate as V

def build(book, cache, report, place=None):
    place = place if place is not None else V.load_links(cache, book)
    bad = {w for w, c in report['commentators'].items() if c['verdict'] != 'ok'}
    out = {}
    for sec, d in load_book(cache, book).items():
        segs = d['text']['segments']; vocab = {i + 1: V.seg_vocab(s) for i, s in enumerate(segs)}
        moves = collections.defaultdict(dict); page = collections.defaultdict(list)
        for c in d['commentary']:
            who = c['who']
            if who not in bad: continue
            for k, comments in c['seg'].items():
                k = int(k)
                for j, txt in enumerate(comments, 1):
                    key = f'{k}:{j}'
                    B = place.get((who, sec, k, j)) or place.get((who, sec, k, None))
                    if B:
                        if B != {k}: moves[who][key] = sorted(B)
                        continue
                    dh = V.dibur(txt)
                    if dh and len(dh) >= 2:
                        sc = {n: V.score(dh, v) for n, v in vocab.items()}; top = max(sc.values(), default=0); cand = [n for n, x in sc.items() if x == top]
                        if top >= 0.75 and len(cand) == 1:
                            if cand[0] != k: moves[who][key] = cand
                            continue
                    page[who].append(key)
        if moves or page:
            out[sec] = {'schema': 1, 'work': book, 'sec': sec, 'moves': dict(moves), 'page': dict(page)}
    return out
