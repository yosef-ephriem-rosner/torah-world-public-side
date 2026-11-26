#!/usr/bin/env python3
"""Fetch Shemos, Mishnah Berakhot, Gemara Berakhot (Hebrew) + commentaries + link graph from Sefaria."""
import json, os, sys, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw')
BASE = 'https://www.sefaria.org'

def get(path, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(BASE + path, timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            time.sleep(1.5 * (i + 1))
        except Exception:
            time.sleep(1.5 * (i + 1))
    return None

def v3(title):
    r = get('/api/v3/texts/' + urllib.parse.quote(title) + '?version=hebrew')
    if not r or not r.get('versions'): return None
    v = r['versions'][0]
    return {'text': v['text'], 'license': v.get('license'), 'version': v.get('versionTitle')}

def sections():
    s = [('shemos', 'Exodus', str(n)) for n in range(1, 41)]
    s += [('mishnah', 'Mishnah Berakhot', str(n)) for n in range(1, 10)]
    for n in range(2, 65):
        for a in 'ab':
            if n == 64 and a == 'b': continue
            s.append(('gemara', 'Berakhot', f'{n}{a}'))
    return s

COMM = {
  'shemos': [('Rashi','Rashi on Exodus.{s}'),('Ibn Ezra','Ibn Ezra on Exodus.{s}'),('Ramban','Ramban on Exodus.{s}'),
             ('Sforno','Sforno on Exodus.{s}'),('Or HaChaim','Or HaChaim on Exodus.{s}'),('Rashbam','Rashbam on Exodus.{s}'),
             ('Onkelos','Onkelos Exodus.{s}')],
  'mishnah': [('Bartenura','Bartenura on Mishnah Berakhot.{s}'),('Rambam','Rambam on Mishnah Berakhot.{s}'),
              ('Tosafot Yom Tov','Tosafot Yom Tov on Mishnah Berakhot.{s}'),('Ikar Tosafot Yom Tov','Ikar Tosafot Yom Tov on Mishnah Berakhot.{s}')],
  'gemara': [('Rashi','Rashi on Berakhot.{s}'),('Tosafot','Tosafot on Berakhot.{s}'),('Rashba','Rashba on Berakhot.{s}'),
             ('Ritva','Ritva on Berakhot.{s}'),('Meiri','Meiri on Berakhot.{s}'),('Rosh','Rosh on Berakhot.{s}')],
}

def one(sec):
    work, book, s = sec
    fn = os.path.join(OUT, f'{work}_{s}.json')
    if os.path.exists(fn): return fn
    ref = f'{book}.{s}'.replace(' ', '_')
    d = {'work': work, 'sec': s, 'book': book}
    d['text'] = v3(ref)
    d['links'] = get('/api/links/' + urllib.parse.quote(ref) + '?with_text=0') or []
    d['links'] = [{'a': l['anchorRef'], 'r': l['ref'], 'c': l['category'], 't': (l.get('collectiveTitle') or {}).get('en'),
                   'th': (l.get('collectiveTitle') or {}).get('he')} for l in d['links']]
    d['comm'] = {}
    for name, pat in COMM[work]:
        t = v3(pat.format(s=s))
        if t: d['comm'][name] = t
    json.dump(d, open(fn, 'w'), ensure_ascii=False)
    return fn

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    secs = sections()
    t = time.time(); done = 0
    with ThreadPoolExecutor(6) as ex:
        for fn in ex.map(one, secs):
            done += 1
            if done % 20 == 0: print(done, len(secs), round(time.time() - t), 's', flush=True)
    print('done', done)
