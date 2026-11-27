# Clauses contract (clauses session <-> main session)

Goal: split long base-text segments (verses, mishnayot, long gemara/midrash segments) into SHORT clauses, and assign every commentary comment to the clause it comments on, so the reader shows only the relevant mefarshim for the clause the user taps/selects.

## Ownership
- Clauses session: `scripts/clauses/**`, `docs/reports/clauses-*.md`, R2 keys `clauses/**`, `clausepacks/**`. Branch `clauses-work` (never push to main; main session merges).
- Main session: everything else (public/**, worker/**, workflows other than yours).
- Legal/usage rules as in docs/LINKS_CONTRACT.md. Only use data already in R2 (sections/packs). Keep chat output short; heavy work in scripts + GitHub Actions (<=3 concurrent upload jobs; links/search jobs share the Cloudflare API limit).

## Order of work
1. Tanakh (Torah first, then Nevi'im, Ketuvim) and Mishnah (all 63) - these get the Vilna-style layout first.
2. Then Midrash/Halakhah books with commentary, then Bavli/Yerushalmi long segments, then the rest.

## Splitting rules
- Tanakh: split at the major cantillation breaks present in the text (etnachta, zakef, revia, tipcha-sof-pasuk, etc.) when the clause stays >= 3 words; keep each clause roughly 3-12 words. If a verse has no taamim in the data (some versions), split on punctuation/meaning markers, else leave the verse whole.
- Mishnah / prose: split at ':' '.' '—' and at natural connectors (e.g. 'ר' X אומר', 'אבל', 'ואם', 'כיצד', ... ) when both sides are >= 3 words; target 4-14 words.
- Never change the text. Clause boundaries are word indexes (0-based position in the segment text after removing HTML tags and splitting on whitespace; same indexing as the links contract).

## File: `clauses/<book>/<sec>.json`
```json
{ "schema": 1, "work": "mishnah-berakhot", "sec": "1", "generated": "...",
  "segs": { "1": { "cuts": [0, 5, 11] } },
  "comments": { "Bartenura": { "1:2": 1 }, "Tosafot Yom Tov": { "1:1": 0 } } }
```
- `segs[idx].cuts` = start word index of each clause (first is 0), so clause k = words cuts[k]..cuts[k+1]-1.
- `comments[who]["<seg>:<n>"]` = 0-based clause index inside that segment, for the n-th (1-based) comment by `who` in `sections/<book>/<sec>.json` (`commentary[who].seg[seg][n-1]`) ; omit (or null) when not determinable (then it applies to the whole segment). Assignment method: match the dibur hamatchil (words before the first ' - ', '.', ':' of the comment) against the segment words (reuse the DH matching in scripts/links); if no dh, assign by the position order of comments (nth of m comments -> proportional clause) only when the commentator is known to be sequential and mark it low-confidence by omitting it. Accuracy matters more than coverage.
- Packs like links: `clausepacks/<book>/clauses.index.json` = `{"v":1,"files":[...],"secs":{"<sec>":[fileIdx,offset,length]}}` with versioned `.bin` files; uploaded index last. Also write per-file objects for small books.
- Report: `reports/clauses/<book>.json` and short `docs/reports/clauses-<family>.md`: counts of segments split, avg clause length, % comments assigned to a clause, 20 random spot-checks printed with clause + dh (verify they really match).

## Reporting
Append to PROJECT_STATE.md (append only) and send_message the parent ("@parent") when Tanakh+Mishnah are live in R2 (milestone 1), and again at each later family. The parent will integrate the Worker/UI.
