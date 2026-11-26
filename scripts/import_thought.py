#!/usr/bin/env python3
"""Generic importer for Musar / Chasidut / Kabbalah / Jewish Thought / Liturgy works from Sefaria's official export (content session A).

One book per table-of-contents leaf, id = <prefix>-<slug(title)>. Only Hebrew versions with an allowed per-version license (same rule as import_export.py).
Structure -> sections (paragraph per segment, catalog type 'mishnah'):
  list depth 1 : chunks of 40 segments           sec "1","2",...
  list depth >=2: section i = top-level item i; segments = its second-level items (deeper levels joined)
  dict (complex schema): each node in order -> sections "<node#>.<i>" (labels use the node key)
Commentaries ("<X> on <title>") are attached only for list-shaped works and only when aligned (see import_more.place); otherwise skipped & logged.

Usage:
  python3 scripts/import_thought.py --plan musar|chasidut|kabbalah|jewishthought|liturgy [--chunk 8]   # JSON list of comma-joined id chunks
  python3 scripts/import_thought.py --books id1,id2 --out out
  python3 scripts/import_thought.py --build-catalog musar --out cat      # needs CLOUDFLARE_API_TOKEN
"""
import argparse, collections, datetime, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_export import BOOKS_URL, TOC_URL, clean, fetch, flat, norm_license, slug
from import_more import heb_num, place, r2_get

FAMILIES = {'musar': ('Musar', 'Musar'), 'chasidut': ('Chasidut', 'Chasidut'), 'kabbalah': ('Kabbalah', 'Kabbalah'),
            'jewishthought': ('Jewish Thought', 'Jewish Thought'), 'liturgy': ('Liturgy', 'Liturgy')}
CHUNK = 40

def plan(fam):
    toc_cat, cat = FAMILIES[fam]; out = []
    top = next(t for t in fetch(TOC_URL) if t['category'] == toc_cat)
    def walk(n, path):
        for c in n.get('contents', []):
            if 'contents' in c: walk(c, path + (c.get('category'),))
            else:
                out.append(dict(id=f'{fam}-{slug(c["title"])}', title=c['title'], he=c.get('heTitle'), cat=cat, group=' / '.join(path[:2]) if path else 'Other',
                                order=len(out), fam=fam))
    walk(top, ())
    ids = collections.Counter(p['id'] for p in out)
    return [p for p in out if ids[p['id']] == 1 or True]

def depth(x):
    if isinstance(x, list): return 1 + max((depth(y) for y in x), default=0)
    return 0

def sections_of(text):
    """-> list of (sec, label, segments, source_path) ; source_path = (index,...) into text when list-shaped, else None"""
    out = []
    def from_list(lst, prefix, label0, path):
        d = depth(lst)
        if d <= 1:
            segs = [clean(x) for x in lst if isinstance(x, str)]
            for k in range(0, len(segs), CHUNK):
                n = k // CHUNK + 1
                out.append((f'{prefix}{n}', f'{label0}{heb_num(n)}' if label0 else str(n), segs[k:k + CHUNK], path if len(segs) <= CHUNK else None))
        else:
            for i, item in enumerate(lst):
                if isinstance(item, str): item = [item]
                if not isinstance(item, list): continue
                segs = [clean(' '.join(flat(x))) if isinstance(x, list) else clean(x or '') for x in item]
                if any(segs): out.append((f'{prefix}{i + 1}', f'{label0}{i + 1}' if label0 else str(i + 1), segs, path + (i,) if path is not None else None))
    if isinstance(text, list): from_list(text, '', '', ())
    elif isinstance(text, dict):
        k = 0
        def walk(d, pre, names):
            nonlocal k
            for key, v in d.items():
                if isinstance(v, dict): walk(v, pre, names + [key]); continue
                if not isinstance(v, list): continue
                k += 1; nm = ' / '.join(names + [key]) if key else (' / '.join(names) or 'Text')
                from_list(v, f'{k}.', (nm + ' ') if (key or names) else '', None)
        walk(text, '', [])
    return out

def pick(entries, log):
    best = None
    for e in entries:
        d = fetch(e['json_url']); lic, rank = norm_license(d.get('license'))
        if lic is None:
            log.append({'title': e['title'], 'version': e['versionTitle'], 'reason': f"license not allowed: {d.get('license')!r}"}); continue
        txt = d.get('text')
        if not isinstance(txt, (list, dict)) or not txt:
            log.append({'title': e['title'], 'version': e['versionTitle'], 'reason': 'empty/unsupported text shape'}); continue
        score = (rank, -len(json.dumps(txt)))
        if best is None or score < best[0]: best = (score, dict(version=d.get('versionTitle'), license=lic, source=d.get('versionSource'), text=txt, he_title=d.get('heTitle')))
    return best[1] if best else None

def get(d, path):
    for i in path:
        if not isinstance(d, list) or i >= len(d): return None
        d = d[i]
    return d

def build(info, bytitle, out):
    log = []; base = pick(bytitle.get(info['title'], []), log)
    if not base: return f"{info['id']}: SKIP no allowed Hebrew text ({len(log)} versions logged)", None
    secs = sections_of(base['text'])
    if not secs: return f"{info['id']}: SKIP no sections", None
    comms = []
    if isinstance(base['text'], list):
        suf = ' on ' + info['title']
        for t in sorted(t for t in bytitle if t.endswith(suf) and bytitle[t][0]['categories'][:1] == bytitle[info['title']][0]['categories'][:1]):
            v = pick(bytitle[t], log)
            if v and isinstance(v['text'], list): v['full'] = t; v['short'] = t[:-len(suf)]; comms.append(v)
    work = info['id'].replace('-', '/', 1); wdir = os.path.join(out, 'sections', work); os.makedirs(wdir, exist_ok=True); os.makedirs(os.path.join(out, 'manifest'), exist_ok=True)
    stats = collections.Counter(); unpl = collections.Counter(); labels = {}; names = []; seen = set()
    for sec, label, segs, path in secs:
        if sec in seen or len(sec) > 30 or not any(segs): continue
        seen.add(sec); oc = []
        if path is not None and len(segs) and comms:
            for c in comms:
                seg, up = place(get(c['text'], path), len(segs), False)
                if seg or up:
                    e = {'who': c['short'], 'title': c['full'], 'he_title': c['he_title'], 'version': c['version'], 'license': c['license'], 'source': c['source'], 'seg': seg}
                    if up: e['unplaced'] = up
                    oc.append(e); stats[c['short']] += sum(len(v) for v in seg.values()); unpl[c['short']] += len(up)
        json.dump({'schema': 1, 'work': work, 'sec': sec, 'book': info['title'], 'kind': 'mishnah',
                   'text': {'version': base['version'], 'license': base['license'], 'source': base['source'], 'segments': segs}, 'commentary': oc},
                  open(os.path.join(wdir, sec + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
        names.append(sec); labels[sec] = label
    used = [{'who': c['short'], 'title': c['full'], 'version': c['version'], 'license': c['license'], 'source': c['source'], 'placed_comments': stats[c['short']], 'unplaced_comments': unpl[c['short']]} for c in comms if stats[c['short']] or unpl[c['short']]]
    man = {'scope': info['id'], 'work': work, 'id': info['id'], 'book': info['title'], 'he_title': info['he'] or base.get('he_title'), 'category': info['cat'], 'group': info['group'], 'order': info['order'],
           'kind': 'mishnah', 'secs': names, 'secLabels': labels, 'sections': len(names), 'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'base': {'title': info['title'], 'version': base['version'], 'license': base['license'], 'source': base['source']}, 'commentaries': used, 'skipped': log,
           'unplaced': {u['who']: u['unplaced_comments'] for u in used if u['unplaced_comments']},
           'note': 'Texts come from Sefaria (https://www.sefaria.org); each keeps its own license. Non-commercial use, attribution required.'}
    json.dump(man, open(os.path.join(out, 'manifest', info['id'] + '.json'), 'w'), ensure_ascii=False, indent=1)
    return f"{info['id']}: {len(names)} sections, {base['license']}, commentaries={len(used)}", man

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--plan'); ap.add_argument('--chunk', type=int, default=8); ap.add_argument('--books'); ap.add_argument('--build-catalog'); ap.add_argument('--out', default='out')
    a = ap.parse_args()
    if a.plan:
        ids = [p['id'] for p in plan(a.plan)]; print(json.dumps([','.join(ids[i:i + a.chunk]) for i in range(0, len(ids), a.chunk)])); return
    if a.build_catalog:
        fam = a.build_catalog; entries = []
        for p in plan(fam):
            m = r2_get(f"manifest/{p['id']}.json")
            if not m or not m.get('secs'): continue
            entries.append({'id': p['id'], 'title': p['title'], 'he': m.get('he_title') or p['he'] or p['title'], 'cat': p['cat'], 'group': p['group'], 'order': p['order'], 'type': 'mishnah', 'secs': m['secs'],
                            'secWord': 'פרק', 'secWordEn': 'Section', 'secLabels': m.get('secLabels', {}), 'commentaries': len(m.get('commentaries', [])), 'base_license': m['base']['license'], 'generated': m['generated']})
        os.makedirs(os.path.join(a.out, 'catalog'), exist_ok=True)
        json.dump({'schema': 1, 'books': entries}, open(os.path.join(a.out, 'catalog', fam + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
        print('catalog', fam, len(entries), 'books'); return
    want = [x for x in (a.books or '').split(',') if x]
    fams = {w.split('-')[0] for w in want}
    infos = {p['id']: p for f in fams for p in plan(f)}
    books = fetch(BOOKS_URL)['books']; bytitle = collections.defaultdict(list)
    for b in books:
        if b['language'] == 'Hebrew' and b['versionTitle'] != 'merged': bytitle[b['title']].append(b)
    for w in want:
        if w not in infos: print('unknown', w); continue
        try: print(build(infos[w], bytitle, a.out)[0], flush=True)
        except Exception as e: print(f'{w}: ERROR {e!r}', flush=True)

if __name__ == '__main__':
    main()
