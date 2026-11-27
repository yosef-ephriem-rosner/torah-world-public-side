#!/usr/bin/env python3
"""docs/reports/clauses-<family>.md from out/reports/clauses/<book>.json.  Usage: report.py <out-dir> <family> <book-id-prefix>"""
import json, sys, glob, os
out, fam, pre = sys.argv[1:4]
reps = [json.load(open(f)) for f in sorted(glob.glob(f'{out}/reports/clauses/{pre}-*.json'))]
T = lambda k: sum(r[k] for r in reps)
L = [f'# Clauses report: {fam}', '', f'{len(reps)} books, {T("sections")} sections, {T("segs")} segments ({T("split")} split into >=2 clauses), {T("clauses")} clauses, avg {T("words")/max(1,T("clauses")):.1f} words/clause.',
     f'Comments assigned to a clause: {T("assigned")}/{T("comments")} ({100*T("assigned")/max(1,T("comments")):.1f}%). Unassigned comments (no dibur hamatchil, DH not found, or ambiguous) apply to the whole segment.', '',
     '| book | segs split | words/clause | comments assigned % |', '|---|---|---|---|']
for r in reps: L.append(f'| {r["work"]} | {r["split"]}/{r["segs"]} | {r["avg_clause_words"]} | {r["pct_comments_assigned"]} |')
L += ['', '## 20 random spot-checks (comment dibur hamatchil -> clause it was assigned to)', '']
import random; rnd = random.Random(7); allsp = [dict(s, book=r['work']) for r in reps for s in r['spot_checks']]
for s in rnd.sample(allsp, min(20, len(allsp))): L.append(f'- {s["book"]} {s["sec"]}:{s["seg"]} {s["who"]} #{s["n"]}  DH "{s["dh"]}"  ->  "{s["clause"]}"')
open(f'docs/reports/clauses-{fam}.md', 'w').write('\n'.join(L) + '\n')
