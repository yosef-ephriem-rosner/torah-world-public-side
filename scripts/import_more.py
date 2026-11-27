#!/usr/bin/env python3
"""Importer for Jerusalem Talmud (Yerushalmi) and Tosefta from Sefaria's official export (content session A).

Same rules as import_export.py (per-version license check, schema-1 section files); reuses its helpers.
Book ids: yerushalmi-<slug>, tosefta-<slug>; catalog type 'mishnah' (one paragraph per segment).
  Yerushalmi: sec = "<chapter>.<halakhah>", segments = the segments of that halakhah (Guggenheimer text, CC-BY).
  Tosefta:    sec = chapter, segments = halakhot. Base = Lieberman edition (CC-BY) when it exists, else Vilna/Mamre (Public Domain).
Commentary placement (conservative): a commentary is put on base segment i only when its node for that section is a list with exactly
as many entries as the base has segments AND those entries are themselves lists/empty (Sefaria's keyed form). Everything else is kept
at section level in the commentary entry's `unplaced` list and counted in the manifest (`unplaced`).

Usage:
  python3 scripts/import_more.py --list-books Yerushalmi|Tosefta|all     # JSON list of book ids
  python3 scripts/import_more.py --book yerushalmi-berakhot --out out
  python3 scripts/import_more.py --build-catalog yerushalmi|tosefta --out cat   # needs CLOUDFLARE_API_TOKEN; reads manifests from R2
"""
import argparse, collections, datetime, json, os, re, sys, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_export import BOOKS_URL, TOC_URL, clean, fetch, flat, pick_version, slug

HEB = {1: 'א', 2: 'ב', 3: 'ג', 4: 'ד', 5: 'ה', 6: 'ו', 7: 'ז', 8: 'ח', 9: 'ט', 10: 'י', 20: 'כ', 30: 'ל', 40: 'מ', 50: 'נ', 60: 'ס', 70: 'ע', 80: 'פ', 90: 'צ',
       100: 'ק', 200: 'ר', 300: 'ש', 400: 'ת'}
def heb_num(n):
    out = ''
    for v in (400, 300, 200, 100):
        while n >= v: out += HEB[v]; n -= v
    if n in (15, 16): return out + ('טו' if n == 15 else 'טז')
    for v in (90, 80, 70, 60, 50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1):
        if n >= v: out += HEB[v]; n -= v
    return out

CATS = {'Yerushalmi': dict(prefix='yerushalmi', cat='Yerushalmi', order0=1000), 'Tosefta': dict(prefix='tosefta', cat='Tosefta', order0=2000)}

def plan():
    """all books we know how to build, from Sefaria's table of contents: list of dicts"""
    toc = fetch(TOC_URL); out = []
    for top in toc:
        if top.get('category') == 'Talmud':
            for b in top['contents']:
                if b.get('category') != 'Yerushalmi': continue
                for g in b['contents']:
                    if not str(g.get('category', '')).startswith('Seder '): continue
                    for l in g['contents']:
                        if 'contents' in l: continue
                        name = re.sub(r'^Jerusalem Talmud ', '', l['title'])
                        out.append(dict(id='yerushalmi-' + slug(name), cat='Yerushalmi', group=g['category'], name=name, title=l['title'], he=l['heTitle'],
                                        base_titles=[l['title']], comm_suffix=' on ' + l['title'], order=1000 + len(out)))
        elif top.get('category') == 'Tosefta':
            groups = {}   # name -> dict
            def walk(n, path):
                for c in n.get('contents', []):
                    if 'contents' in c: walk(c, path + (c.get('category'),))
                    elif 'Commentary' not in path:
                        ed = path[0]; group = next((p for p in path if str(p).startswith('Seder ')), None)
                        name = re.sub(r'^Tosefta ', '', re.sub(r' \(Lieberman\)$', '', c['title']))
                        d = groups.setdefault(name, dict(id='tosefta-' + slug(name), cat='Tosefta', group=group, name=name, title='Tosefta ' + name, he=None, base_titles=[], order=None))
                        he = re.sub(r'\s*\(ליברמן\)$', '', c['heTitle'])
                        if ed.startswith('Lieberman'): d['base_titles'].insert(0, c['title']); d['comm_suffix'] = ' on ' + name; d['he'] = he; d['group'] = group
                        else:
                            d['base_titles'].append(c['title']); d['he'] = d['he'] or he; d['group'] = d['group'] or group
            walk(top, ())
            for d in groups.values(): d['order'] = 2000 + len(out); d.setdefault('comm_suffix', None); out.append(d)
    return out

def place(node, nbase, str_ok=False):
    """node = commentary text for one section (list per base segment). returns (seg_map, unplaced list)"""
    if node is None: return {}, []
    if isinstance(node, str): return {}, [clean(node)] if clean(node) else []
    if not isinstance(node, list): return {}, []
    keyed = len(node) == nbase and all(isinstance(e, list) or e in ('', None) or (str_ok and isinstance(e, str)) for e in node)
    if keyed:
        seg = {}
        for i, e in enumerate(node):
            cs = [clean(x) for x in flat(e)]; cs = [x for x in cs if x]
            if cs: seg[str(i + 1)] = cs
        return seg, []
    return {}, [c for c in (clean(x) for x in flat(node)) if c]

def get(d, *idx):
    for i in idx:
        if not isinstance(d, list) or i >= len(d): return None
        d = d[i]
    return d

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--list-books'); ap.add_argument('--book'); ap.add_argument('--build-catalog'); ap.add_argument('--out', default='out')
    a = ap.parse_args()
    P = plan()
    if a.list_books:
        print(json.dumps([p['id'] for p in P if a.list_books == 'all' or p['cat'] == a.list_books])); return
    if a.build_catalog: return build_catalog(a, P)
    info = next((p for p in P if p['id'] == a.book), None)
    if not info: sys.exit('unknown book id ' + str(a.book))
    yer = info['cat'] == 'Yerushalmi'
    books = fetch(BOOKS_URL)['books']; bytitle = collections.defaultdict(list)
    for b in books:
        if b['language'] == 'Hebrew' and b['versionTitle'] != 'merged': bytitle[b['title']].append(b)
    log = []; base = None; base_title = None
    for t in info['base_titles']:
        base = pick_version(bytitle[t], [], log, 'base')
        if base: base_title = t; break
    if not base: sys.exit('no allowed base text found: ' + json.dumps(log))
    lieberman = '(Lieberman)' in (base_title or '')
    # commentaries
    comm_titles = []
    if info.get('comm_suffix') and (yer or lieberman):
        suf = info['comm_suffix']; comm_titles = sorted(t for t in bytitle if t.endswith(suf) and ('Yerushalmi' in bytitle[t][0]['categories'] or 'Talmud' in bytitle[t][0]['categories'] or 'Tosefta' in bytitle[t][0]['categories']) and (yer or 'Tosefta' in bytitle[t][0]['categories']))
        if yer: comm_titles = [t for t in comm_titles if t != info['title']]
    comms = []
    for t in comm_titles:
        v = pick_version(bytitle[t], [], log, t)
        if v: v['full'] = t; v['short'] = t[:-len(info['comm_suffix'])]; comms.append(v)
    btext = base['text']
    # a commentary whose per-section nodes are plain strings is segment-keyed only if (almost) every one has exactly as many entries as the base segments
    for c in comms:
        n = ok = 0
        for ci, ch in enumerate(btext):
            if not isinstance(ch, list): continue
            for node, nb in (((get(c['text'], ci, hi), len(hal) if isinstance(hal, list) else 1) for hi, hal in enumerate(ch)) if yer else [(get(c['text'], ci), len(ch))]):
                if isinstance(node, list) and node and all(isinstance(e, str) for e in node): n += 1; ok += (len(node) == nb)
        c['str_ok'] = n >= 3 and ok >= 0.9 * n
    work = info['id'].replace('-', '/', 1); wdir = os.path.join(a.out, 'sections', work)
    os.makedirs(wdir, exist_ok=True); os.makedirs(os.path.join(a.out, 'manifest'), exist_ok=True)
    secs = []; labels = {}; stats = collections.Counter(); unpl = collections.Counter(); nsec = 0
    def emit(sec, label, base_segs, node_of):
        nonlocal nsec
        out_comm = []
        for c in comms:
            seg, up = place(node_of(c['text']), len(base_segs), c['str_ok'])
            if seg or up:
                e = {'who': c['short'], 'title': c['full'], 'he_title': c['he_title'], 'version': c['version'], 'license': c['license'], 'source': c['source'], 'seg': seg}
                if up: e['unplaced'] = up
                out_comm.append(e); stats[c['short']] += sum(len(v) for v in seg.values()); unpl[c['short']] += len(up)
        doc = {'schema': 1, 'work': work, 'sec': sec, 'book': info['title'], 'kind': 'mishnah',
               'text': {'version': base['version'], 'license': base['license'], 'source': base['source'], 'segments': base_segs}, 'commentary': out_comm}
        json.dump(doc, open(os.path.join(wdir, sec + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
        secs.append(sec); labels[sec] = label; nsec += 1
    for ci, ch in enumerate(btext):
        if not isinstance(ch, list): continue
        if yer:
            for hi, hal in enumerate(ch):
                segs = [clean(' '.join(flat(x))) if isinstance(x, list) else clean(x or '') for x in (hal if isinstance(hal, list) else [hal])]
                if not any(segs): continue
                emit(f'{ci + 1}.{hi + 1}', f'פרק {heb_num(ci + 1)} הלכה {heb_num(hi + 1)}', segs, lambda t, ci=ci, hi=hi: get(t, ci, hi))
        else:
            segs = [clean(' '.join(flat(x))) if isinstance(x, list) else clean(x or '') for x in ch]
            if not any(segs): continue
            emit(str(ci + 1), f'פרק {heb_num(ci + 1)}', segs, lambda t, ci=ci: get(t, ci))
    used = [{'title': c['full'], 'who': c['short'], 'version': c['version'], 'license': c['license'], 'source': c['source'], 'placed_comments': stats[c['short']], 'unplaced_comments': unpl[c['short']]} for c in comms if stats[c['short']] or unpl[c['short']]]
    man = {'scope': info['id'], 'work': work, 'id': info['id'], 'book': info['title'], 'he_title': info['he'] or base.get('he_title'), 'category': info['cat'], 'group': info['group'], 'order': info['order'], 'kind': 'mishnah',
           'secs': secs, 'secLabels': labels, 'sections': nsec, 'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'base': {'title': base_title, 'version': base['version'], 'license': base['license'], 'source': base['source']}, 'commentaries': used, 'skipped': log,
           'unplaced': {u['who']: u['unplaced_comments'] for u in used if u['unplaced_comments']},
           'note': 'Texts come from Sefaria (https://www.sefaria.org); each keeps its own license. Non-commercial use, attribution required. `unplaced` = commentary kept at section level because it could not be verified against a base segment.'}
    json.dump(man, open(os.path.join(a.out, 'manifest', info['id'] + '.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"{info['id']}: {nsec} sections, base='{base['version']}' ({base['license']}), commentaries={len(used)}, unplaced={sum(unpl.values())}, skipped={len(log)}")

def r2_get(key):
    tok = os.environ['CLOUDFLARE_API_TOKEN']; acct = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    if not acct:
        r = urllib.request.Request('https://api.cloudflare.com/client/v4/accounts', headers={'Authorization': 'Bearer ' + tok})
        acct = json.load(urllib.request.urlopen(r, timeout=60))['result'][0]['id']
    url = f'https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/torah-world-data/objects/' + urllib.parse.quote(key, safe='/')
    import time
    for i in range(8):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok}), timeout=60))
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            if e.code not in (429, 500, 502, 503, 504) or i == 7: raise
            time.sleep(min(60, 2 ** (i + 1)))

def build_catalog(a, P):
    cat = a.build_catalog.capitalize(); entries = []
    for p in P:
        if p['cat'] != cat: continue
        m = r2_get(f"manifest/{p['id']}.json")
        if not m or not m.get('secs'): print('no manifest:', p['id']); continue
        entries.append({'id': p['id'], 'title': p['title'], 'he': m.get('he_title') or p['he'], 'cat': cat, 'group': p['group'], 'order': p['order'], 'type': 'mishnah', 'secs': m['secs'],
                        'secWord': 'הלכה' if cat == 'Yerushalmi' else 'פרק', 'secWordEn': 'Halakhah' if cat == 'Yerushalmi' else 'Chapter', 'secLabels': m.get('secLabels', {}),
                        'commentaries': len(m.get('commentaries', [])), 'base_license': m['base']['license'], 'generated': m['generated']})
    os.makedirs(os.path.join(a.out, 'catalog'), exist_ok=True)
    json.dump({'schema': 1, 'books': entries}, open(os.path.join(a.out, 'catalog', cat.lower() + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print('catalog', cat, len(entries), 'books')

if __name__ == '__main__':
    main()
