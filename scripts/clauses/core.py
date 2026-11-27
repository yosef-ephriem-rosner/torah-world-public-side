"""Clause splitting + comment->clause assignment (see docs/CLAUSES_CONTRACT.md). Pure functions, no network."""
import re, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'links'))
from common import text_words, norm, strip_tags
import validate as V   # dibur(), variants(), SKIP (DH extraction shared with the links pipeline)

# ---- Tanakh cantillation ranks (lower = stronger disjunctive) ----
RANK = {}
for c, r in {'֑': 1,                       # etnachta
             '֔': 2, '֕': 2,          # zakef katan/gadol
             '֗': 2, '֘': 2, '֒': 2, '֓': 2,  # revia, zarqa, segol, shalshelet
             '֫': 2,                       # ole (poetic books)
             '֙': 3, '֛': 3, '֜': 3, '֝': 3, '֞': 3, '֠': 3, '֡': 3, '֖': 3, '֚': 3, '֮': 3}.items():
    RANK[c] = r
def word_rank(w):
    best = 9
    for ch in w:
        r = RANK.get(ch)
        if r and r < best: best = r
    return best

MIN_T, MAX_T = 3, 12
def split_ranked(ranks, lo, hi, maxlen):
    """ranks[i] = break strength after word i (9 = none). Cuts at rank<=2 where both sides >= lo words; then split clauses longer than maxlen at the
    strongest/most central remaining break (rank <= hi). Returns start indexes."""
    n = len(ranks); cuts = [0]
    # 1) strong breaks, left to right, keep each clause >= lo (the remainder is checked below)
    for i in range(n - 1):
        if ranks[i] <= 2 and i + 1 - cuts[-1] >= lo and n - (i + 1) >= lo: cuts.append(i + 1)
    # 2) split long clauses at weaker breaks, nearest to the middle (stronger first)
    changed = True
    while changed:
        changed = False
        for k, a in enumerate(cuts):
            b = cuts[k + 1] if k + 1 < len(cuts) else n
            if b - a > maxlen:
                cand = [i for i in range(a + lo - 1, b - lo) if ranks[i] <= hi]
                if cand:
                    mid = (a + b) / 2; j = min(cand, key=lambda i: (ranks[i], abs(i + 1 - mid))); cuts.insert(k + 1, j + 1); changed = True; break
    return cuts

def tanakh_cuts(text):
    ws = text_words(text); ws2 = [w for w in ws]
    ranks = [word_rank(w) for w in ws2]
    if all(r == 9 for r in ranks[:-1]) and len(ws2) > MAX_T:      # no taamim in this version
        return punct_cuts(text)
    return split_ranked(ranks, MIN_T, 3, MAX_T)

# ---- prose (Mishnah, midrash, gemara) ----
STRONG = re.compile(r'[.:;—–]$|—$|\s-$')
COMMA = re.compile(r'[,،]$')
CONNECT = {'אבל', 'ואם', 'אם', 'כיצד', 'ואלו', 'אלו', 'ואלא', 'אלא', 'וחכמים', 'והחכמים', 'שאם', 'ואף', 'אף', 'ואין', 'ואי', 'וכן', 'לפיכך', 'מפני', 'ומודים', 'ובית', 'בית', 'הרי', 'וזה', 'זה', 'היה', 'והיה', 'וכל', 'ושאר', 'אחד', 'אחר'}
STRICT_CONNECT = {'אבל', 'ואם', 'כיצד', 'וחכמים', 'והחכמים', 'לפיכך', 'ומודים', 'ובית', 'אלא', 'ואלא', 'ואף', 'אף', 'וכן', 'ואלו'}
RABBI = {'רבי', 'ר', 'רבן', 'רבא', 'רב', 'אבא'}
def prose_ranks(ws):
    n = len(ws); r = [9] * n; nw = [norm(w) for w in ws]
    for i, w in enumerate(ws):
        t = strip_tags(w).strip()
        t = re.sub(r'[֑-ׇ]', '', t)
        if STRONG.search(t) or t in ('—', '–'): r[i] = 2
        elif COMMA.search(t): r[i] = 4
        if i + 1 < n:
            nx = nw[i + 1]
            if nx in STRICT_CONNECT: r[i] = min(r[i], 5)
            elif nx in RABBI and (r[i] <= 4 or nw[i] in ('אומר', 'אומרים', 'מתיר', 'אוסר', 'פוטר', 'מחייב', 'מטמא', 'מטהר')): r[i] = min(r[i], 3)
            if nw[i] in ('אומר', 'אומרים') and r[i] > 4: r[i] = 4
    return r
def punct_cuts(text, lo=3, maxlen=14):
    ws = text_words(text); n = len(ws)
    if n < 2 * lo: return [0]
    r = prose_ranks(ws)
    return split_ranked(r, lo, 5, maxlen)
def prose_cuts(text): return punct_cuts(text, 3, 14)

# ---- word mapping for DH matching ----
def seg_norm(text):
    """returns (flat normalized words, raw-index of each)"""
    flat, ridx = [], []
    for i, w in enumerate(text_words(text)):
        for x in norm(w).split(): flat.append(x); ridx.append(i)
    return flat, ridx

def dh_words(comment, maxw=6):
    ws = V.dibur(comment)           # up to 5 words, skip list applied
    if not ws: return None
    # longer window when the DH is bolded: reuse validate's bold logic via a second call is not possible; 5 words are plenty
    return ws[:maxw]

def match_pos(dh, flat):
    """best in-order match of dh words inside flat. Returns (start flat idx, ambiguous_positions list) or None. Accuracy first."""
    if not dh or not flat: return None
    n = len(dh); best = 0; poss = []
    dv = [V.variants(w) for w in dh]
    for i in range(len(flat)):
        # greedy ordered alignment inside a window
        j = i; hit = 0; first = None
        for k in range(n):
            for t in range(j, min(len(flat), j + 3)):
                if dv[k] & V.variants(flat[t]): hit += 1; j = t + 1; first = t if first is None else first; break
        if first != i: continue            # window must start on a matched word
        if hit > best: best, poss = hit, [i]
        elif hit == best and hit: poss.append(i)
    need = n if n <= 2 else int(0.75 * n + 0.999)
    if best < need: return None
    if n == 1 and len(dh[0]) < 3: return None
    return poss

def assign(poss, ridx, cuts):
    """clause index of the matches; None if matches fall in different clauses"""
    import bisect
    ks = {bisect.bisect_right(cuts, ridx[p]) - 1 for p in poss}
    return ks.pop() if len(ks) == 1 else None
