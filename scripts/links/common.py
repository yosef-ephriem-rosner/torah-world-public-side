"""Shared helpers for the links pipeline (Hebrew normalisation, book table, section loading, ref parsing)."""
import json, os, re, glob
# site work id -> (R2 section dir, Sefaria book title, kind, list of sections)
def amudim(first, last):
    def key(s): return (int(s[:-1]), s[-1])
    out = []; n, side = key(first)
    while (n, side) <= key(last):
        out.append(f'{n}{side}'); n, side = (n, 'b') if side == 'a' else (n + 1, 'a')
    return out
BOOKS = {
    'bavli-berakhot':    dict(dir='bavli/berakhot',     title='Berakhot',          kind='talmud', secs=amudim('2a', '64a')),
    'bavli-shabbat':     dict(dir='bavli/shabbat',      title='Shabbat',           kind='talmud', secs=amudim('2a', '51b')),
    'mishnah-berakhot':  dict(dir='mishnah/berakhot',   title='Mishnah Berakhot',  kind='mishnah', secs=[str(i) for i in range(1, 10)]),
    'mishnah-peah':      dict(dir='mishnah/peah',       title='Mishnah Peah',      kind='mishnah', secs=[str(i) for i in range(1, 9)]),
    'tanakh-genesis':    dict(dir='tanakh/genesis',     title='Genesis',           kind='tanakh', secs=[str(i) for i in range(32, 51)]),
    'tanakh-exodus':     dict(dir='tanakh/exodus',      title='Exodus',            kind='tanakh', secs=[str(i) for i in range(1, 41)]),
}
def section_key(book, sec): return f"sections/{BOOKS[book]['dir']}/{sec}.json"
def load_section(cache, book, sec):
    fn = os.path.join(cache, section_key(book, sec))
    return json.load(open(fn, encoding='utf-8')) if os.path.exists(fn) else None
def load_book(cache, book):
    return {s: d for s in BOOKS[book]['secs'] if (d := load_section(cache, book, s))}

NIKUD = re.compile(r'[֑-ׇ]')
TAGS = re.compile(r'<[^>]+>')
FINAL = str.maketrans('ךםןףץ', 'כמנפצ')
def strip_tags(s): return TAGS.sub('', s)
def norm(s):
    """no tags, no nikud, no punctuation (incl. geresh/gershayim), final letters unified, Hebrew letters + single spaces"""
    s = NIKUD.sub('', TAGS.sub(' ', s).replace('\u05BE', ' '))
    s = re.sub(r'[\'"׳״’”“]', '', s)
    s = re.sub(r'[^א-ת ]', ' ', s).translate(FINAL)
    return re.sub(r' +', ' ', s).strip()
def words(s): return norm(s).split()
def text_words(s):
    """0-based word positions as in the contract: tags removed, split on whitespace"""
    return strip_tags(s).split()

def ref_re(title):
    return re.compile(r'^(?P<who>.+?) on ' + re.escape(title) + r' (?P<sec>\w+):(?P<seg>\d+)(?:-(?P<seg2>\d+))?(?::(?P<idx>\d+))?$')
def base_re(title):
    return re.compile(r'^' + re.escape(title) + r' (?P<sec>\w+):(?P<a>\d+)(?:-(?P<b>\d+))?$')

# ---- generic ref parsing: Sefaria ref -> site passage (work, sec, idx) when the book is on the site ----
_TITLES = sorted(((v['title'], k) for k, v in BOOKS.items()), key=lambda t: -len(t[0]))
_REF = re.compile(r'^(?P<title>.+?) (?P<sec>\d+[ab]?)(?::(?P<a>\d+))?(?:-(?P<b>[\w:]+))?$')
def parse_site_ref(ref):
    """'Berakhot 10a:3-5' -> ('bavli-berakhot','10a',3). None if not a (in-scope) passage of one of our books.
    Whole-section refs map to idx 1. Cross-section ranges use the start."""
    for title, book in _TITLES:
        if ref.startswith(title + ' '):
            m = _REF.match(ref)
            if not m or m['title'] != title: return None
            sec = m['sec']
            if sec not in BOOKS[book]['secs']: return None
            return book, sec, int(m['a'] or 1)
    return None
def pick_from(c1, c2):
    """returns (own, other) where own is the site-side ref (Citation 1 preferred), or None"""
    a = parse_site_ref(c1)
    if a: return a, c2
    b = parse_site_ref(c2)
    return (b, c1) if b else None

SEFARIA_TYPE = {'commentary': 'commentary', 'quotation': 'quotation', 'quotation_auto': 'quotation', 'quotation_auto_tanakh': 'quotation', 'allusion': 'quotation',
                'midrash': 'midrash', 'ein mishpat / ner mitsvah': 'halakhah', 'ein mishpat': 'halakhah', 'sifrei mitzvot': 'halakhah', 'halakhah': 'halakhah'}
