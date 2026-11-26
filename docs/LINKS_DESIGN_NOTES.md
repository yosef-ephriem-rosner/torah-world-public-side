# Links pipeline: how it works, and design for linking user Q&A notes

## Pipeline (`scripts/links/`, workflow `Build links`)
`pipeline.py --book <id>`: (1) section files from R2, cached; (2) Sefaria `links0..12.csv` streamed and filtered to our books (never stored whole); (3) `validate.py` placement report; (4) `sefaria_links.py` official links (confidence 0.9, quotation_auto 0.7) + `stringmatch.py` deterministic matches, merged per section; (5) upload `links/<book>/<sec>.json`, `reports/links/<book>.json`, `reports/links/<book>.placement.json`. Re-run is safe (cache + overwrite).
String-match = normalised tokens (no tags/nikud/punctuation, maqaf split, final letters unified, YHWH/Elokim spellings unified); verses: shared 3-6+ consecutive words (whole short verse, rare 3-grams, or >=5 words); Mishnah-in-Gemara >=6 words; Gemara<->Gemara >=10 words with >=5 non-formula words (attribution chains are not evidence). Identical wording in several verses lowers confidence by 0.1.

## Model pass (not built)
Would run only on segments with no deterministic link, source=`model`, review=`unreviewed`, UI label "suggested". Needs an API key (none in this environment). Precision must be measured on a 50-link sample before showing anything.

## Design: linking user Q&A notes to related passages (same files)
- A note is anchored to (work, sec, idx, ws, we) already. Treat it as just another `from` passage: store note-side links in D1/R2 as `links/notes/<noteId>.json` using the same link objects (`from` = the note's anchor, `to` = passage, `source: "string-match"|"model"`, `review`).
- Step 1 (free, deterministic): run the same n-gram matcher on the note's quoted words and body text against Tanakh/Mishnah/Gemara corpora -> verse/mishnah/sugya links.
- Step 2 (reverse lookup, cheap): for any passage, show notes whose anchor or derived links point to it, by joining the `links/**` reverse index with notes in D1 (no new files).
- Step 3 (optional, opt-in per note): model suggestions with `source: "model"`, shown only to the author until they confirm; confirmed ones become `review: "confirmed"` and are visible to others per the note's visibility setting (private notes never leak into public link lists).
- Never auto-publish links derived from a private note.
