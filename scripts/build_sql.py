#!/usr/bin/env python3
import json, glob, os, re, collections
ROOT = os.path.join(os.path.dirname(__file__), '..')
RAW = os.path.join(ROOT, 'data', 'raw'); OUT = os.path.join(ROOT, 'data', 'sql')
os.makedirs(OUT, exist_ok=True)
for f in glob.glob(OUT + '/*.sql'): os.remove(f)
HAVE = {'Rashi','Ibn Ezra','Ramban','Sforno','Or HaChaim','Rashbam','Onkelos','Bartenura','Rambam','Tosafot Yom Tov',
        'Ikar Tosafot Yom Tov','Tosafot','Rashba','Ritva','Meiri'}
ALLOW = {'b','i','small','big','br','strong','em'}
def clean(s):
    s = re.sub(r'<sup[^>]*>.*?</sup>', '', s, flags=re.S)
    s = re.sub(r'<i class="footnote">.*?</i>', '', s, flags=re.S)
    def tag(m):
        name = m.group(2).lower()
        if name not in ALLOW: return ''
        return ('</' if m.group(1) else '<') + name + ('/>' if name == 'br' else '>')
    s = re.sub(r'<(/?)([a-zA-Z0-9]+)[^>]*>', tag, s)
    s = s.replace('&nbsp;', ' ').replace('&thinsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    return re.sub(r'[ \t\r\n]+', ' ', s).strip()
def plain(s):
    s = re.sub(r'<[^>]+>', ' ', s)
    s = re.sub(r'[֑-ׇ]', '', s).replace('־', ' ')
    return re.sub(r'\s+', ' ', s).strip()
def q(v):
    if v is None: return 'NULL'
    if isinstance(v, int): return str(v)
    return "'" + str(v).replace("'", "''") + "'"
def flat(x):
    if isinstance(x, list):
        for y in x: yield from flat(y)
    elif isinstance(x, str): yield x
rows = {'segments': [], 'comments': [], 'xrefs': []}
def seg_idx(a):
    if ':' not in a: return 0
    m = re.match(r'(\d+)', a.rsplit(':', 1)[1])
    return int(m.group(1)) if m else 0
for f in sorted(glob.glob(RAW + '/*.json')):
    d = json.load(open(f)); w, s = d['work'], d['sec']
    texts = d['text']['text']
    if not isinstance(texts, list): texts = [texts]
    for i, t in enumerate(texts):
        he = clean(' '.join(flat(t))) if t else ''
        if he: rows['segments'].append((w, s, i + 1, he, plain(he)))
    for who, v in d['comm'].items():
        if who == 'Rosh': continue
        for i, seg in enumerate(v['text']):
            cs = [seg] if isinstance(seg, str) else list(flat(seg))
            for j, c in enumerate(cs):
                c = clean(c)
                if c: rows['comments'].append((w, s, i + 1, who, j + 1, c))
    grp = collections.defaultdict(dict)
    for l in d['links']:
        if l['c'] in ('Reference', 'Quoting Commentary') or l['t'] in HAVE or not l['t']: continue
        k = (seg_idx(l['a']), l['c'])
        e = grp[k].setdefault(l['t'], {'t': l['t'], 'h': l['th'], 'r': l['r'], 'n': 0}); e['n'] += 1
    for (idx, cat), items in grp.items():
        lst = sorted(items.values(), key=lambda e: -e['n'])[:40]
        rows['xrefs'].append((w, s, idx, cat, json.dumps(lst, ensure_ascii=False, separators=(',', ':'))))
cols = {'segments': 'work,sec,idx,he,plain', 'comments': 'work,sec,idx,who,n,he', 'xrefs': 'work,sec,idx,cat,items'}
n = 0
STMT, FILE = 60_000, 600_000
for tbl, rs in rows.items():
    stmts = []; cur = []; cs = 0
    for r in rs:
        v = '(' + ','.join(q(x) for x in r) + ')'; b = len(v.encode())
        if cur and cs + b > STMT:
            stmts.append(f'INSERT INTO {tbl}({cols[tbl]}) VALUES\n' + ',\n'.join(cur) + ';'); cur = []; cs = 0
        cur.append(v); cs += b
    if cur: stmts.append(f'INSERT INTO {tbl}({cols[tbl]}) VALUES\n' + ',\n'.join(cur) + ';')
    buf = []; size = 0
    for s_ in stmts + [None]:
        if s_ is None or (buf and size + len(s_) > FILE):
            if buf:
                n += 1; open(f'{OUT}/{n:03d}_{tbl}.sql', 'w').write('\n'.join(buf) + '\n'); buf = []; size = 0
        if s_ is not None: buf.append(s_); size += len(s_.encode())
print({k: len(v) for k, v in rows.items()}, 'files', n)
