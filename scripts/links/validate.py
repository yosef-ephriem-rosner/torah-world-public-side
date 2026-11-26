#!/usr/bin/env python3
"""Validate placement of every commentator's comments on base segments.
Two independent checks per commentator:
  (A) text: the dibur hamatchil (first bold words) occurs in the base segment (exact), a neighbour (+-1), elsewhere in the amud, or nowhere.
  (B) links: Sefaria's official links CSV says which base segment each comment belongs to; compare with the segment our importer used.
Output: <out>/reports/links/<book>.json, <out>/reports/links/<book>.placement.json (suggested corrections), docs/reports/<book>.md
Usage: python3 scripts/links/validate.py --book bavli-berakhot --cache cache --out out"""
import argparse, collections, csv, datetime, json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import *

SKIP = {'גמ', 'גמרא', 'בגמרא', 'בגמ', 'מתני', 'מתניתין', 'משנה', 'במשנה', 'דה', 'בדה', 'תוס', 'שם', 'וכו', 'כו', 'וגו', 'רשי', 'בתוס', 'תד', 'בד', 'תוספות', 'ועיין', 'עיין', 'עי', 'עיי', 'וכ', 'כו'}
PREF = 'והבלמכדש'
def variants(w):
    v = {w}
    for k in (1, 2):
        if len(w) > 2 + k and all(c in PREF for c in w[:k]): v.add(w[k:])
    return v
def seg_vocab(text):
    v = set()
    for w in words(text): v |= variants(w)
    return v
BOLD = re.compile(r'<(?:b|strong)>(.*?)</(?:b|strong)>', re.S)
DASH = re.compile(r'\s[\-\u2013\u2014]\s|\.\s|:\s')
def dibur(comment):
    m = BOLD.search(comment)
    if m and comment.find(m.group(0)) <= 12: raw = m.group(1)      # bold DH opening the comment
    else:                                                            # unbolded: text before first dash / period (<= 8 words)
        head = DASH.split(strip_tags(comment), 1)[0]
        if len(head.split()) > 8 or head == strip_tags(comment): return None
        raw = head
    ws = [w for w in words(raw) if w not in SKIP]
    return ws[:5] or None
def score(dh, vocab):
    hit = sum(1 for w in dh if variants(w) & vocab)
    return hit / len(dh)
def is_match(dh, vocab):
    s = score(dh, vocab)
    return s >= 0.75 if len(dh) >= 3 else s == 1.0 and (len(dh) >= 2 or len(dh[0]) >= 3)

def load_links(cache, book):
    t = BOOKS[book]['title']; rr, br = ref_re(t), base_re(t)
    place = collections.defaultdict(set)   # (who, sec, seg, idx|None) -> base segs per Sefaria
    for r in csv.reader(open(links_csv(cache, book), encoding='utf-8')):
        for a, b in ((r[0], r[1]), (r[1], r[0])):
            m = rr.match(a); n = br.match(b)
            if m and n and m['sec'] == n['sec'] and r[2] in ('commentary', ''):
                if r[2] == '' and 'Category' in r[5]: pass
                lo, hi = int(n['a']), int(n['b'] or n['a'])
                idx = int(m['idx']) if m['idx'] else None
                place[(m['who'], m['sec'], int(m['seg']), idx)].update(range(lo, hi + 1))
    return place

def pct(a, b): return round(100 * a / b, 1) if b else None

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--book', required=True); ap.add_argument('--cache', default='cache'); ap.add_argument('--out', default='out'); ap.add_argument('--catalog', action='store_true')
    a = ap.parse_args(); book = a.book
    if a.catalog:
        import r2, common; fn = r2.get('catalog.json', a.cache)
        if fn: common.set_books(common.catalog_books(json.load(open(fn))))
    secs = load_book(a.cache, book); place = load_links(a.cache, book)
    st = collections.defaultdict(lambda: dict(comments=0, with_dh=0, exact=0, neighbor=0, elsewhere=0, none=0, linked=0, sef_dh=0, sef_dh_ok=0, aligned=0, misaligned=0, unlinked=0, susp=[], lic=None))
    corr = collections.defaultdict(dict); infer = collections.defaultdict(dict)
    for sec, d in secs.items():
        segs = d['text']['segments']; vocab = {i + 1: seg_vocab(s) for i, s in enumerate(segs)}; allv = set().union(*vocab.values()) if vocab else set()
        for c in d['commentary']:
            S = st[c['who']]; S['lic'] = c['license']
            for k, comments in c['seg'].items():
                k = int(k)
                for j, txt in enumerate(comments, 1):
                    S['comments'] += 1
                    # (B) links
                    B = place.get((c['who'], sec, k, j)) or place.get((c['who'], sec, k, None))
                    linked = bool(B)
                    if linked:
                        S['linked'] += 1
                        if k in B: S['aligned'] += 1
                        else:
                            S['misaligned'] += 1; corr[c['who']][f'{sec}:{k}:{j}'] = sorted(B)
                    else: S['unlinked'] += 1
                    # (A) text
                    dh = dibur(txt)
                    if not dh: continue
                    S['with_dh'] += 1
                    if k in vocab and is_match(dh, vocab[k]): res = 'exact'
                    elif any(n in vocab and is_match(dh, vocab[n]) for n in (k - 1, k + 1)): res = 'neighbor'
                    elif is_match(dh, allv): res = 'elsewhere'
                    else: res = 'none'
                    S[res] += 1
                    if linked and k not in B:
                        S['sef_dh'] += 1; S['sef_dh_ok'] += any(n in vocab and is_match(dh, vocab[n]) for n in B)
                    if not linked and res != 'exact':
                        sc = {n: score(dh, v) for n, v in vocab.items()}; top = max(sc.values(), default=0)
                        cand = [n for n, x in sc.items() if x == top]
                        if top >= 0.75 and len(cand) == 1 and len(dh) >= 2: infer[c['who']][f'{sec}:{k}:{j}'] = cand
                    if res in ('elsewhere', 'none') and len(S['susp']) < 25 and (res == 'none' or not linked or k not in B):
                        best = max(vocab, key=lambda n: score(dh, vocab[n])) if vocab else None
                        S['susp'].append(dict(sec=sec, seg=k, idx=j, dh=' '.join(dh), result=res, best_seg=best if res == 'elsewhere' else None, sefaria_seg=sorted(B) if linked else None))
    comm = {}
    for who, S in sorted(st.items()):
        within1 = S['exact'] + S['neighbor']
        comm[who] = dict(license=S['lic'], comments=S['comments'],
            text_check=dict(with_dh=S['with_dh'], exact=S['exact'], neighbor=S['neighbor'], elsewhere_in_amud=S['elsewhere'], not_found=S['none'],
                            rate_exact_pct=pct(S['exact'], S['with_dh']), rate_within1_pct=pct(within1, S['with_dh'])),
            links_check=dict(sefaria_seg_has_dh_pct=pct(S['sef_dh_ok'], S['sef_dh']), linked=S['linked'], aligned=S['aligned'], misaligned=S['misaligned'], no_sefaria_link=S['unlinked'], rate_aligned_pct=pct(S['aligned'], S['linked'])),
            suspicious_sample=S['susp'])
        tc, lc = comm[who]['text_check'], comm[who]['links_check']
        if lc['linked'] >= 10:      # Sefaria links are the authority whenever they exist for the commentator
            v = 'ok' if lc['rate_aligned_pct'] >= 85 else 'MISALIGNED'; basis = 'links'
        elif tc['with_dh'] >= 20 and tc['with_dh'] >= 0.5 * S['comments']:  # otherwise the dibur hamatchil text check
            v = 'ok' if tc['rate_within1_pct'] >= 50 else 'MISALIGNED'; basis = 'text'
        else: v, basis = 'unverifiable', 'too few links/dibur hamatchil (keyed by chapter/siman or no DH)'
        comm[who]['verdict'] = v; comm[who]['verdict_basis'] = basis
    rep = dict(schema=1, work=book, generated=datetime.datetime.now(datetime.timezone.utc).isoformat(), sections=len(secs),
               method='text: bold dibur hamatchil found in base segment / neighbour (+-1) / amud; links: Sefaria links CSV (commentary links) vs importer segment',
               commentators=comm, misaligned=[w for w, c in comm.items() if c['verdict'] == 'MISALIGNED'])
    os.makedirs(os.path.join(a.out, 'reports/links'), exist_ok=True); os.makedirs('docs/reports', exist_ok=True)
    json.dump(rep, open(os.path.join(a.out, f'reports/links/{book}.json'), 'w'), ensure_ascii=False, indent=1)
    pl = {w: dict(method='sefaria-links', map=corr[w]) for w in corr if w in rep['misaligned']}
    for w in infer:
        if w in rep['misaligned'] and w not in pl and infer[w]: pl[w] = dict(method='text-dh-match (unique best segment, >=75% of DH words)', map=infer[w])
    json.dump(pl, open(os.path.join(a.out, f'reports/links/{book}.placement.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    L = [f'# Placement validation: {book}', '', f'Generated {rep["generated"][:10]} from Sefaria export data ({len(secs)} sections). Text check = bold dibur hamatchil found in the base segment (exact), +-1 segment, elsewhere in the amud. Links check = Sefaria official commentary links say the comment belongs to the segment we used.', '',
         '| Commentator | comments | DH found exact % | within +-1 % | links aligned % (linked) | verdict (basis) |', '|---|---|---|---|---|---|']
    for w, c in sorted(comm.items(), key=lambda kv: -kv[1]['comments']):
        t, l = c['text_check'], c['links_check']
        L.append(f"| {w} | {c['comments']} | {t['rate_exact_pct']} ({t['with_dh']}) | {t['rate_within1_pct']} | {l['rate_aligned_pct']} ({l['linked']}) | {c['verdict']} ({c['verdict_basis'][:5]}) |")
    L += ['', f"**Systematically misaligned:** {', '.join(rep['misaligned']) or 'none'}", '', 'Suggested correct placements for misaligned commentators: R2 `reports/links/%s.placement.json` (`{who: {method, map: {"sec:ourSeg:commentIdx": [correctSegs]}}}`). Suspicious samples per commentator: R2 `reports/links/%s.json`.' % (book, book)]
    open(f'docs/reports/{book}.md', 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L[4:]))
if __name__ == '__main__': main()
