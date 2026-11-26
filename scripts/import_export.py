#!/usr/bin/env python3
"""Build per-section JSON files (text + all licensed mefarshim) from Sefaria's official bulk export.

Source: https://github.com/Sefaria/Sefaria-Export (public GCS bucket, no scraping of the website/API).
Rules (legal): every text keeps its own license, read from the *version* file's `license` field.
Only Public Domain / CC0 / CC-BY / CC-BY-SA / CC-BY-NC(-SA) texts are used (site is non-commercial, credits sources).
Anything else (unknown, copyrighted, empty) is skipped and logged in the manifest.

Usage: python3 scripts/import_export.py --scope peah --out out
Scopes: see SCOPES below. Output: out/sections/<work>/<sec>.json and out/manifest/<scope>.json
"""
import argparse, collections, datetime, json, os, re, sys, time, urllib.request

BOOKS_URL = 'https://raw.githubusercontent.com/Sefaria/Sefaria-Export/master/books.json'
LICENSE_RANK = {'public domain': 0, 'pd': 0, 'cc0': 0, 'cc-by': 1, 'cc-by-sa': 2, 'cc-by-nc': 3, 'cc-by-nc-sa': 4}
NORMAL_LICENSE = {'pd': 'Public Domain', 'public domain': 'Public Domain', 'cc0': 'CC0', 'cc-by': 'CC-BY', 'cc-by-sa': 'CC-BY-SA',
                  'cc-by-nc': 'CC-BY-NC', 'cc-by-nc-sa': 'CC-BY-NC-SA'}

def amudim(first, last):
    """'2a'..'51b' -> list of amud names"""
    def key(s): return (int(s[:-1]), s[-1])
    out = []; n, side = key(first)
    while (n, side) <= key(last):
        out.append(f'{n}{side}'); n, side = (n, 'b') if side == 'a' else (n + 1, 'a')
    return out

SCOPES = {
    'peah':       dict(work='mishnah/peah', kind='mishnah', book='Mishnah Peah', cat='Mishnah', secs=[str(i) for i in range(1, 9)], base_pref=['Torat Emet 357']),
    'berakhot':   dict(work='bavli/berakhot', kind='talmud', book='Berakhot', cat='Talmud', secs=amudim('2a', '64a'), base_pref=['William Davidson Edition - Vocalized Aramaic']),
    'shabbat1':   dict(work='bavli/shabbat', kind='talmud', book='Shabbat', cat='Talmud', secs=amudim('2a', '51b'), base_pref=['William Davidson Edition - Vocalized Aramaic']),  # through end of Perek 4 (Shabbat 51b:6)
    'bereishis2': dict(work='tanakh/genesis', kind='tanakh', book='Genesis', cat='Tanakh', secs=[str(i) for i in range(32, 51)], base_pref=['Miqra according to the Masorah']),  # Vayishlach (32:4) to end
    'shemos':     dict(work='tanakh/exodus', kind='tanakh', book='Exodus', cat='Tanakh', secs=[str(i) for i in range(1, 41)], base_pref=['Miqra according to the Masorah']),
}

ALLOW_TAGS = {'b', 'i', 'small', 'big', 'br', 'strong', 'em'}
def clean(s):
    s = re.sub(r'<sup[^>]*>.*?</sup>', '', s, flags=re.S)
    s = re.sub(r'<i class="footnote">.*?</i>', '', s, flags=re.S)
    def tag(m):
        name = m.group(2).lower()
        return '' if name not in ALLOW_TAGS else ('</' if m.group(1) else '<') + name + ('/>' if name == 'br' else '>')
    s = re.sub(r'<(/?)([a-zA-Z0-9]+)[^>]*>', tag, s)
    s = s.replace('&nbsp;', ' ').replace('&thinsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    return re.sub(r'[ \t\r\n]+', ' ', s).strip()

def flat(x):
    if isinstance(x, list):
        for y in x: yield from flat(y)
    elif isinstance(x, str): yield x

def fetch(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r: return json.load(r)
        except Exception as e:
            err = e; time.sleep(2 * (i + 1))
    raise RuntimeError(f'download failed {url}: {err}')

def norm_license(v):
    k = (v or '').strip().lower()
    return NORMAL_LICENSE.get(k), LICENSE_RANK.get(k)

def amud_name(i):  # Talmud arrays: index 0 = 1a, 1 = 1b, 2 = 2a ...
    return f'{i // 2 + 1}{"a" if i % 2 == 0 else "b"}'

def section_of(kind, data, sec):
    """return the part of a nested-list text that belongs to one section (or None)"""
    if not isinstance(data, list): return None
    if kind == 'talmud':
        names = {amud_name(i): i for i in range(len(data))}
        i = names.get(sec)
    else:
        i = int(sec) - 1
    return data[i] if i is not None and 0 <= i < len(data) else None

def segments_of(part):
    """section -> list of segments, each a list of comment strings"""
    if part is None: return []
    if isinstance(part, str): return [[part]]
    out = []
    for seg in part:
        out.append([x for x in flat(seg)] if isinstance(seg, list) else ([seg] if isinstance(seg, str) else []))
    return out

def pick_version(entries, base_pref, log, label):
    """download candidate versions of one title, return best allowed (dict) or None"""
    best = None
    for e in entries:
        d = fetch(e['json_url']); lic, rank = norm_license(d.get('license'))
        if lic is None:
            log.append({'title': e['title'], 'version': e['versionTitle'], 'reason': f"license not allowed: {d.get('license')!r}"}); continue
        txt = d.get('text')
        if isinstance(txt, dict):  # complex schema: the main body is the default (unnamed) node; introductions etc. are skipped
            txt = txt.get('') if isinstance(txt.get(''), list) else next((v for v in txt.values() if isinstance(v, list)), None)
        if not isinstance(txt, list):
            log.append({'title': e['title'], 'version': e['versionTitle'], 'reason': 'complex schema (no section-aligned body found), not supported yet'}); continue
        d['text'] = txt
        pref = 0 if any(p in e['versionTitle'] for p in base_pref) else 1
        score = (pref, rank, -len(json.dumps(d['text'])))
        if best is None or score < best[0]:
            best = (score, dict(version=d.get('versionTitle'), license=lic, source=d.get('versionSource'), text=d['text'], he_title=d.get('heTitle'), title=d.get('title')))
    return best[1] if best else None

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--scope', required=True, choices=sorted(SCOPES)); ap.add_argument('--out', default='out')
    ap.add_argument('--only-commentary', default='', help='comma list of titles to restrict (testing)')
    a = ap.parse_args(); sc = SCOPES[a.scope]
    books = fetch(BOOKS_URL)['books']
    heb = [b for b in books if b['language'] == 'Hebrew' and b['versionTitle'] != 'merged']
    bytitle = collections.defaultdict(list)
    for b in heb: bytitle[b['title']].append(b)
    log = []
    base = pick_version(bytitle[sc['book']], sc['base_pref'], log, 'base')
    if not base: sys.exit('no allowed base text found: ' + json.dumps(log))
    # commentaries: "<X> on <book>" (or "on Mishnah <name>") whose categories include the right category
    suffixes = (' on ' + sc['book'],) if sc['kind'] != 'mishnah' else (' on ' + sc['book'],)
    comm_titles = sorted(t for t in bytitle if t.endswith(suffixes) and sc['cat'] in bytitle[t][0]['categories'] and (sc['kind'] != 'talmud' or 'Bavli' in bytitle[t][0]['categories']))
    only = {x for x in a.only_commentary.split(',') if x}
    if only: comm_titles = [t for t in comm_titles if t in only]
    comms = []
    for t in comm_titles:
        v = pick_version(bytitle[t], [], log, t)
        if v: v['short'] = t[:-len(' on ' + sc['book'])]; v['full'] = t; comms.append(v)
    os.makedirs(os.path.join(a.out, 'sections', sc['work']), exist_ok=True); os.makedirs(os.path.join(a.out, 'manifest'), exist_ok=True)
    nsec = 0; stats = collections.Counter()
    for sec in sc['secs']:
        part = section_of(sc['kind'], base['text'], sec)
        segs = [clean(s) for s in (flat(x) if isinstance(x, list) else [x] for x in (part or []))] if False else None
        base_segs = []
        for x in (part or []):
            base_segs.append(clean(' '.join(flat(x))) if isinstance(x, list) else clean(x or ''))
        if not any(base_segs): continue
        out_comm = []
        for c in comms:
            segs_c = segments_of(section_of(sc['kind'], c['text'], sec))
            seg_map = {}
            for i, cs in enumerate(segs_c):
                cs = [clean(x) for x in cs if x and clean(x)]
                if cs: seg_map[str(i + 1)] = cs
            if seg_map:
                out_comm.append({'who': c['short'], 'title': c['full'], 'he_title': c['he_title'], 'version': c['version'], 'license': c['license'], 'source': c['source'], 'seg': seg_map})
                stats[c['short']] += sum(len(v) for v in seg_map.values())
        doc = {'schema': 1, 'work': sc['work'], 'sec': sec, 'book': sc['book'], 'kind': sc['kind'],
               'text': {'version': base['version'], 'license': base['license'], 'source': base['source'], 'segments': base_segs},
               'commentary': out_comm}
        fn = os.path.join(a.out, 'sections', sc['work'], sec + '.json'); os.makedirs(os.path.dirname(fn), exist_ok=True)
        json.dump(doc, open(fn, 'w'), ensure_ascii=False, separators=(',', ':')); nsec += 1
    used = [{'title': c['full'], 'who': c['short'], 'version': c['version'], 'license': c['license'], 'source': c['source'], 'comments_in_scope': stats[c['short']]} for c in comms if stats[c['short']]]
    manifest = {'scope': a.scope, 'work': sc['work'], 'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sections': nsec,
                'base': {k: base[k] for k in ('title', 'version', 'license', 'source')}, 'commentaries': used, 'skipped': log,
                'note': 'Texts come from Sefaria (https://www.sefaria.org); each keeps its own license. Non-commercial use, attribution required.'}
    json.dump(manifest, open(os.path.join(a.out, 'manifest', a.scope + '.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"{a.scope}: {nsec} sections, base='{base['version']}' ({base['license']}), commentaries used={len(used)}, skipped={len(log)}")

if __name__ == '__main__':
    main()
