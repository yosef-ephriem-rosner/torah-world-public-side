#!/usr/bin/env python3
"""Content session B importer: Midrash + Halakhah from Sefaria's official export (complex schemas).

One site "book" per base title (e.g. one Hilchot of Mishneh Torah, one chelek of Shulchan Arukh, one Midrash Rabbah).
Walks the version `text` (nested dicts = schema nodes, lists = jagged arrays) generically.
Only Public Domain / CC0 / CC-BY / CC-BY-SA / CC-BY-NC(-SA) versions are used; the rest is logged in the manifest `skipped`.
Does NOT touch scripts/import_export.py (only imports helpers from it). Output layout = docs/CONTENT_CONTRACT.md.

  python3 scripts/import_more_b.py --list mishneh-torah          # JSON list of base titles of a family
  python3 scripts/import_more_b.py --title "Mishneh Torah, Sabbath" --out out
  python3 scripts/import_more_b.py --build-catalog manifests_dir --out out   # writes out/catalog/<cat>.json (merges with R2 copy if token set)
"""
import argparse, collections, datetime, glob, json, os, re, sys, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_export import BOOKS_URL, TOC_URL, clean, flat, fetch, norm_license, slug

SCHEMA_URL = 'https://storage.googleapis.com/sefaria-export/schemas/%s.json'
TAN = ['Mekhilta DeRabbi Yishmael', 'Mekhilta DeRabbi Shimon Ben Yochai', 'Sifra', 'Sifrei Bamidbar', 'Sifrei Devarim', 'Sifrei Zuta']
SA = ['Shulchan Arukh, Orach Chayim', "Shulchan Arukh, Yoreh De'ah", 'Shulchan Arukh, Even HaEzer', 'Shulchan Arukh, Choshen Mishpat']

# family -> (site category, catalog cat, group label, secWord he, secWord en, base-version name preferences, title selector)
def _is(cats, *p): return list(cats[:len(p)]) == list(p)
FAMILIES = {
    'mishneh-torah': dict(cat='halakhah', cat_en='Halakhah', group='Mishneh Torah', sw=('פרק', 'Chapter'), pref=['Torat Emet', 'Wikisource'],
                          sel=lambda t, c: t.startswith('Mishneh Torah,') and _is(c, 'Halakhah', 'Mishneh Torah') and 'Commentary' not in c),
    'shulchan-arukh': dict(cat='halakhah', cat_en='Halakhah', group='Shulchan Arukh', sw=('סימן', 'Siman'), pref=['Torat Emet 363', 'Maginei Eretz'],
                           sel=lambda t, c: t in SA),
    'tur': dict(cat='halakhah', cat_en='Halakhah', group='Tur', sw=('סימן', 'Siman'), pref=['Vilna', 'Torat Emet'],
                sel=lambda t, c: t.startswith('Tur,') and _is(c, 'Halakhah', 'Tur') and 'Commentary' not in c),
    'chinukh': dict(cat='halakhah', cat_en='Halakhah', group='Sefer HaChinukh', sw=('מצווה', 'Mitzvah'), pref=['Torat Emet', 'Vocalized', 'Minchat'],
                    sel=lambda t, c: t == 'Sefer HaChinukh'),
    'rabbah': dict(cat='midrash', cat_en='Midrash', group='Midrash Rabbah', sw=('פרשה', 'Parasha'), pref=['Midrash Rabbah', 'Wikisource'],
                   sel=lambda t, c: _is(c, 'Midrash', 'Aggadah', 'Midrash Rabbah') and 'Commentary' not in c and ' on ' not in t),
    'tannaitic': dict(cat='midrash', cat_en='Midrash', group='Midrash Halakhah', sw=('פרשה', 'Section'), pref=[],
                      sel=lambda t, c: t in TAN),
    'aggadah': dict(cat='midrash', cat_en='Midrash', group='Midrash Aggadah', sw=('פרק', 'Chapter'), pref=['Torat Emet', 'Wikisource'],
                    sel=lambda t, c: t in ('Yalkut Shimoni on Torah', 'Yalkut Shimoni on Nach', 'Avot DeRabbi Natan', 'Avot DeRabbi Natan, Recension B') or (_is(c, 'Midrash', 'Aggadah') and 'Commentary' not in c and 'Midrash Rabbah' not in c and ' on ' not in t and not t.startswith('Learning'))),
}

def hebrew_books():
    return [b for b in fetch(BOOKS_URL)['books'] if b['language'] == 'Hebrew' and b['versionTitle'] != 'merged' and b['categories'][0] in ('Midrash', 'Halakhah')]

def toc_order():
    out = {}
    def go(n):
        for c in n.get('contents', []):
            if 'contents' in c: go(c)
            elif c.get('title'): out[c['title']] = (len(out), c.get('heTitle'))
    go({'contents': fetch(TOC_URL)}); return out

def family_titles(fam, books):
    f = FAMILIES[fam]; seen = {}
    for b in books:
        if f['sel'](b['title'], b['categories']): seen[b['title']] = b['categories']
    return sorted(seen)

# ---------- text walking ----------
def leaves(text, path=()):
    if isinstance(text, dict):
        for k, v in text.items(): yield from leaves(v, path + (k,))
    elif isinstance(text, list): yield path, text

def descend(text, path):
    for k in path:
        if not isinstance(text, dict) or k not in text: return None
        text = text[k]
    return text

def seg_text(x):
    return clean(' '.join(flat(x))) if isinstance(x, list) else (clean(x) if isinstance(x, str) else '')

def leaf_sections(lst):
    """-> list of (index or None, [raw segment items]); None = whole leaf is one section"""
    if all(isinstance(x, str) or x is None for x in lst): return [(None, [x or '' for x in lst])]
    return [(i + 1, x if isinstance(x, list) else ([x] if isinstance(x, str) else [])) for i, x in enumerate(lst)]

def he_titles(title):
    """schema node English title -> Hebrew title"""
    try: sch = fetch(SCHEMA_URL % urllib.parse.quote(title), tries=2)
    except Exception: return {}
    m = {}
    def go(n):
        if n.get('title'): m[n['title']] = n.get('heTitle')
        for c in n.get('nodes', []): go(c)
    go(sch.get('schema', {})); return m

def segments_of(part):
    if part is None: return []
    if isinstance(part, str): return [[part]]
    return [[x for x in flat(s)] if isinstance(s, list) else ([s] if isinstance(s, str) else []) for s in part]

def build_sections(text, hemap):
    """-> list of dict(id, label, path, idx, segs[raw]); ids natural if single leaf else sequential"""
    lv = [(p, l) for p, l in leaves(text)]
    out = []
    single = len(lv) == 1
    for path, lst in lv:
        secs = leaf_sections(lst)
        title = ' · '.join(hemap.get(k) or k for k in path if k)
        for idx, raw in secs:
            segs = [seg_text(x) for x in raw]
            if not any(segs): continue
            if single: sid = str(idx or 1); label = None
            else:
                sid = str(len(out) + 1)
                label = title + (f' {idx}' if idx and len(secs) > 1 else '')
            out.append(dict(id=sid, label=label, path=path, idx=idx, segs=segs))
    return out

# ---------- versions ----------
def load_versions(entries, log, min_text=True):
    """download all versions of one title; return allowed ones (list of dict) ; log skipped"""
    out = []
    for e in entries:
        d = fetch(e['json_url']); lic, rank = norm_license(d.get('license'))
        if lic is None:
            log.append({'title': e['title'], 'version': e['versionTitle'], 'reason': f"license not allowed: {d.get('license')!r}"}); continue
        txt = d.get('text')
        if not isinstance(txt, (list, dict)) or not any(True for _ in leaves(txt)):
            log.append({'title': e['title'], 'version': e['versionTitle'], 'reason': 'no usable text structure'}); continue
        out.append(dict(title=e['title'], version=d.get('versionTitle'), license=lic, rank=rank, source=d.get('versionSource'), text=txt, he_title=d.get('heTitle'),
                        size=len(json.dumps(txt, ensure_ascii=False))))
    return out

def place(base_secs, cv):
    """align one commentary version to base sections -> {sec_id: (seg_map, unplaced)}; counts"""
    res = {}; placed = unpl = 0
    for s in base_secs:
        ct = descend(cv['text'], s['path'])
        if ct is None: continue
        if s['idx'] is None: segsc = segments_of(ct if isinstance(ct, list) else None)
        else:
            if not isinstance(ct, list) or s['idx'] - 1 >= len(ct): continue
            segsc = segments_of(ct[s['idx'] - 1])
        seg_map = {}; un = []
        for i, cs in enumerate(segsc):
            cs = [clean(x) for x in cs if x and clean(x)]
            if not cs: continue
            if i < len(s['segs']): seg_map[str(i + 1)] = cs; placed += len(cs)
            else: un.extend(cs); unpl += len(cs)
        if seg_map or un: res[s['id']] = (seg_map, un)
    return res, placed, unpl

def main_title(a):
    books = hebrew_books(); fam = a.family
    f = FAMILIES[fam]; title = a.title
    toc = toc_order()
    by = collections.defaultdict(list)
    for b in books: by[b['title']].append(b)
    log = []
    cands = load_versions(by[title], log)
    if not cands:  # nothing licensed: log it and finish cleanly (no catalog entry)
        os.makedirs(os.path.join(a.out, 'manifest'), exist_ok=True)
        json.dump({'id': f['cat'] + '-' + slug(title), 'book': title, 'skipped': log, 'note': 'no allowed license, not imported'}, open(os.path.join(a.out, 'manifest', 'skipped-' + slug(title) + '.json'), 'w'), ensure_ascii=False, indent=1)
        print('skipped (license):', title); return
    # commentaries
    ctitles = sorted(t for t in by if t.endswith(' on ' + title))
    comm = {}
    for t in ctitles:
        vs = load_versions(by[t], log)
        if vs: comm[t] = vs
    biggest = max(c['size'] for c in cands)
    best = None
    hemap = he_titles(title)
    for c in cands:
        if c['size'] < 0.6 * biggest: continue
        secs = build_sections(c['text'], hemap)
        if not secs: continue
        pl = sum(place(secs, v)[1] for vs in comm.values() for v in vs)
        pref = next((i for i, p in enumerate(f['pref']) if p in (c['version'] or '')), 99)
        score = (-pl, pref, c['rank'], -c['size'])
        if best is None or score < best[0]: best = (score, c, secs)
    _, base, secs = best
    for c in cands:
        if c is not base: log.append({'title': title, 'version': c['version'], 'reason': 'allowed but not chosen as base (fewer commentaries align / smaller)'})
    # commentaries: per title, versions in rank order; a later version only fills sections not yet covered; mismatching ones are skipped
    sec_comm = collections.defaultdict(list); used = []
    for t, vs in comm.items():
        who = t[:-len(' on ' + title)]; covered = set(); n_placed = n_un = 0; vers = []
        for v in sorted(vs, key=lambda v: (v['rank'], -v['size'])):
            res, placed, unpl = place(secs, v)
            if placed + unpl == 0: continue
            if unpl > 0.25 * (placed + unpl) and placed < 20:
                log.append({'title': t, 'version': v['version'], 'reason': f'structure does not align with base ({unpl} of {placed + unpl} comments out of range)'}); continue
            took = 0
            for sid, (seg_map, un) in res.items():
                if sid in covered: continue
                covered.add(sid); took += 1
                e = {'who': who, 'title': t, 'he_title': v['he_title'], 'version': v['version'], 'license': v['license'], 'source': v['source'], 'seg': seg_map}
                if un: e['unplaced'] = un
                sec_comm[sid].append(e); n_placed += sum(len(x) for x in seg_map.values()); n_un += len(un)
            if took: vers.append({'version': v['version'], 'license': v['license'], 'source': v['source']})
        if vers: used.append({'title': t, 'who': who, 'versions': vers, 'sections': len(covered), 'comments_placed': n_placed, 'unplaced': n_un})
    # write
    bid = f['cat'] + '-' + slug(title); work = f['cat'] + '/' + slug(title)
    odir = os.path.join(a.out, 'sections', work); os.makedirs(odir, exist_ok=True); os.makedirs(os.path.join(a.out, 'manifest'), exist_ok=True)
    labels = {}
    for s in secs:
        doc = {'schema': 1, 'work': work, 'sec': s['id'], 'book': title, 'kind': 'mishnah',
               'text': {'version': base['version'], 'license': base['license'], 'source': base['source'], 'segments': s['segs']},
               'commentary': sec_comm.get(s['id'], [])}
        json.dump(doc, open(os.path.join(odir, s['id'] + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
        if s['label']: labels[s['id']] = s['label']
    order = toc.get(title, (9999, None))
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    entry = {'id': bid, 'title': title, 'he': base['he_title'] or toc.get(title, (0, None))[1] or title, 'cat': f['cat_en'], 'group': f['group'], 'order': order[0], 'type': 'mishnah',
             'secs': [s['id'] for s in secs], 'secWord': f['sw'][0], 'secWordEn': f['sw'][1], 'commentaries': len(used), 'base_license': base['license'], 'generated': now}
    if labels: entry['secLabels'] = labels
    man = {'id': bid, 'work': work, 'family': a.family, 'book': title, 'catalog_entry': entry, 'sections': len(secs),
           'base': {k: base[k] for k in ('version', 'license', 'source')}, 'commentaries': used, 'skipped': log, 'generated': now,
           'note': 'Texts come from Sefaria (https://www.sefaria.org); each keeps its own license. Non-commercial use, attribution required.'}
    json.dump(man, open(os.path.join(a.out, 'manifest', bid + '.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'{bid}: {len(secs)} sections, base={base["version"]!r} ({base["license"]}), commentaries={len(used)}, skipped={len(log)}')

# ---------- catalog ----------
def r2_get(key):
    tok = os.environ.get('CLOUDFLARE_API_TOKEN'); acct = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    if not tok: return None
    try:
        h = {'Authorization': 'Bearer ' + tok}
        if not acct:
            acct = json.load(urllib.request.urlopen(urllib.request.Request('https://api.cloudflare.com/client/v4/accounts', headers=h)))['result'][0]['id']
        url = f'https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/torah-world-data/objects/' + urllib.parse.quote(key, safe='/')
        return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=h)))
    except Exception as e:
        print('no existing', key, '->', e); return None

def build_catalog(d, out):
    new = collections.defaultdict(dict)
    for fn in sorted(glob.glob(os.path.join(d, '**', '*.json'), recursive=True)):
        m = json.load(open(fn)); e = m.get('catalog_entry')
        if e: new[e['cat'].lower()][e['id']] = e
    os.makedirs(os.path.join(out, 'catalog'), exist_ok=True)
    for cat, entries in new.items():
        old = r2_get(f'catalog/{cat}.json') or {'books': []}
        merged = {b['id']: b for b in old.get('books', [])}; merged.update(entries)
        books = sorted(merged.values(), key=lambda b: (b.get('group', ''), b.get('order', 0)))
        json.dump({'schema': 1, 'books': books}, open(os.path.join(out, 'catalog', cat + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
        print(f'catalog/{cat}.json: {len(books)} books ({len(entries)} new/updated)')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--list', choices=sorted(FAMILIES) + ['all-halakhah', 'all-midrash', 'all'])
    ap.add_argument('--family', choices=sorted(FAMILIES)); ap.add_argument('--title'); ap.add_argument('--out', default='out'); ap.add_argument('--build-catalog')
    a = ap.parse_args()
    if a.list:
        books = hebrew_books()
        fams = [a.list] if a.list in FAMILIES else [k for k, v in FAMILIES.items() if a.list == 'all' or a.list == 'all-' + v['cat']]
        # output entries "family|title" would complicate matrices; titles are unique across families
        print(json.dumps([t for fam in fams for t in family_titles(fam, books)], ensure_ascii=False)); return
    if a.build_catalog: build_catalog(a.build_catalog, a.out); return
    if not a.title: sys.exit('give --title')
    if not a.family:
        books = hebrew_books()
        a.family = next((k for k in FAMILIES if a.title in family_titles(k, books)), None)
        if not a.family: sys.exit('title not in any family: ' + a.title)
    main_title(a)

if __name__ == '__main__':
    main()
