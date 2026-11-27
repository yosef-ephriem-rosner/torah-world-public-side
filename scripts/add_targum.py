#!/usr/bin/env python3
"""Add Targum commentaries (Onkelos on Torah, Targum Jonathan on Prophets, Aramaic Targum on Writings) to the existing tanakh section files in R2.

For one tanakh book: download every existing section file (REST, from R2: sections/tanakh/<slug>/<sec>.json), add/replace one commentary entry
(one comment per verse, key = verse index), write the merged files to --out/sections/... and an updated --out/manifest/<id>.json.
Original files are copied to --orig first (backup). Upload with scripts/upload_pack.py <out>. Aborts without writing if any section cannot be read.
Licenses: only the allowed per-version list (import_export.pick_version).
Usage: add_targum.py --list | --book tanakh-genesis --out out --orig orig
"""
import argparse, collections, json, os, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_export import BOOKS_URL, catalog, clean, fetch, flat, pick_version

def targets():
    out = {}
    for c in catalog():
        if c['cat'] != 'Tanakh': continue
        t, g = c['title'], c['group']
        if g == 'Torah': cands, who = [f'Onkelos {t}'], 'Onkelos'
        elif g == 'Prophets': cands, who = [f'Targum Jonathan on {t}'], 'Targum Jonathan'
        else: cands, who = [f'Aramaic Targum to {t}', f'Targum of {t}'], 'Targum'
        out[c['work'].replace('/', '-')] = dict(work=c['work'], title=t, cands=cands, who=who)
    return out

def r2_get(key, tries=8):
    tok = os.environ['CLOUDFLARE_API_TOKEN']; acct = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    if not acct:
        acct = json.load(urllib.request.urlopen(urllib.request.Request('https://api.cloudflare.com/client/v4/accounts', headers={'Authorization': 'Bearer ' + tok}), timeout=60))['result'][0]['id']
    url = f'https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/torah-world-data/objects/' + urllib.parse.quote(key, safe='/')
    for i in range(tries):
        try: return urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok}), timeout=120).read()
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            if e.code not in (429, 500, 502, 503, 504) or i == tries - 1: raise
            time.sleep(min(60, 2 ** (i + 1)))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--list', action='store_true'); ap.add_argument('--book'); ap.add_argument('--out', default='out'); ap.add_argument('--orig', default='orig')
    a = ap.parse_args(); T = targets()
    if a.list:
        bt = collections.defaultdict(list)
        for b in fetch(BOOKS_URL)['books']:
            if b['language'] == 'Hebrew' and b['versionTitle'] != 'merged': bt[b['title']].append(b)
        print(json.dumps([k for k, v in T.items() if any(c in bt for c in v['cands'])])); return
    t = T[a.book]; bt = collections.defaultdict(list)
    for b in fetch(BOOKS_URL)['books']:
        if b['language'] == 'Hebrew' and b['versionTitle'] != 'merged': bt[b['title']].append(b)
    log = []; src = None
    for c in t['cands']:
        if c in bt: src = pick_version(bt[c], [], log, c); title = c
        if src: break
    if not src or not isinstance(src['text'], list): sys.exit(f'{a.book}: no allowed Targum text: {json.dumps(log)}')
    man_raw = r2_get(f'manifest/{a.book}.json'); man = json.loads(man_raw); secs = man['secs']
    docs = {}
    for sec in secs:
        raw = r2_get(f"sections/{t['work']}/{sec}.json")
        if raw is None: sys.exit(f'{a.book}: missing existing section {sec}, aborting without changes')
        docs[sec] = (raw, json.loads(raw))
    placed = skipped = 0
    for sec, (raw, d) in docs.items():
        node = src['text'][int(sec) - 1] if sec.isdigit() and int(sec) - 1 < len(src['text']) else None
        seg = {}
        for i, v in enumerate(node or []):
            s = clean(' '.join(flat(v)) if isinstance(v, list) else (v or ''))
            if not s: continue
            if i < len(d['text']['segments']): seg[str(i + 1)] = [s]; placed += 1
            else: skipped += 1
        d['commentary'] = [c for c in d['commentary'] if c['who'] != t['who']]
        if seg: d['commentary'].append({'who': t['who'], 'title': title, 'he_title': src.get('he_title'), 'version': src['version'], 'license': src['license'], 'source': src['source'], 'seg': seg})
    # all read ok -> write backup + merged
    for sec, (raw, d) in docs.items():
        for root, data in ((a.orig, raw), (a.out, json.dumps(d, ensure_ascii=False, separators=(',', ':')).encode())):
            fn = os.path.join(root, 'sections', t['work'], sec + '.json'); os.makedirs(os.path.dirname(fn), exist_ok=True); open(fn, 'wb').write(data)
    man['commentaries'] = [c for c in man.get('commentaries', []) if c.get('who') != t['who']] + [{'title': title, 'who': t['who'], 'version': src['version'], 'license': src['license'], 'source': src['source'], 'comments_in_scope': placed}]
    os.makedirs(os.path.join(a.out, 'manifest'), exist_ok=True); json.dump(man, open(os.path.join(a.out, 'manifest', a.book + '.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"{a.book}: who={t['who']} ({src['license']}), placed {placed} verses, skipped {skipped} (beyond base verse count), sections {len(docs)}")

if __name__ == '__main__':
    main()
