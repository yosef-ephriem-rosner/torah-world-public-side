#!/usr/bin/env python3
"""Download the Hebrew + Latin subsets of two SIL-OFL fonts from Google Fonts and write public/fonts + public/fonts.css.
Fonts: Frank Ruhl Libre (OFL), Noto Rashi Hebrew (OFL). Self-hosting keeps the fixed daf layout identical on every device."""
import os, re, urllib.request
ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'public', 'fonts'); os.makedirs(OUT, exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
FAMS = [('Frank Ruhl Libre', 'frank-ruhl', 'wght@400;700'), ('Noto Rashi Hebrew', 'noto-rashi', 'wght@400')]
css_out = ['/* self-hosted SIL OFL fonts (Frank Ruhl Libre, Noto Rashi Hebrew) */']
for fam, slug, spec in FAMS:
    url = 'https://fonts.googleapis.com/css2?family=' + fam.replace(' ', '+') + ':' + spec + '&display=block'
    css = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA})).read().decode()
    for m in re.finditer(r'/\* ([a-z-]+) \*/\s*@font-face \{(.*?)\}', css, re.S):
        subset, body = m.group(1), m.group(2)
        if subset not in ('hebrew', 'latin'): continue
        src = re.search(r'url\((https://[^)]+)\)', body).group(1)
        weight = re.search(r'font-weight:\s*([^;]+);', body).group(1).strip()
        rng = re.search(r'unicode-range:\s*([^;]+);', body).group(1).strip()
        fn = f'{slug}-{subset}-{weight.replace(" ", "-")}.woff2'
        path = os.path.join(OUT, fn)
        if not os.path.exists(path):
            open(path, 'wb').write(urllib.request.urlopen(urllib.request.Request(src, headers={'User-Agent': UA})).read())
        css_out.append(f"@font-face{{font-family:'{fam}';font-style:normal;font-weight:{weight};font-display:block;src:url(/fonts/{fn}) format('woff2');unicode-range:{rng}}}")
open(os.path.join(ROOT, 'public', 'fonts.css'), 'w').write('\n'.join(css_out) + '\n')
print('\n'.join(css_out)); print(sorted(os.listdir(OUT)), sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) // 1024, 'KB')
