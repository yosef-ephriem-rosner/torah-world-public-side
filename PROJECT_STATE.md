# PROJECT_STATE (updated 2026-11-26)

## Goal
Torah-learning site: real text + mefarshim, notes/Q&A anchored to exact words, fixed "tzuras hadaf" for Gemara, bookshelf of mefarshim, chavrusa board. Non-commercial, legal, sources credited.

## Live now
- https://torah-world.yosefrosner39.workers.dev (Cloudflare Worker + D1).
- Data in D1: Shemos (Hebrew + Rashi, Onkelos, Ibn Ezra, Ramban, Rashbam, Sforno, Or HaChaim), Mishnah Berakhos (Bartenura, Rambam, Tosafot Yom Tov, Ikar Tosafot Yom Tov), Gemara Berakhos (Rashi, Tosafot, Rashba, Ritva, Meiri), plus grouped Sefaria cross-reference lists.
- Features working: reader (flowing Chumash/Mishnah; live Vilna-style daf via daf-renderer; Onkelos interlinear toggle at verse level), word-anchored notes, questions/answers/comments, votes, visibility (private/public/professionals/group), filters, search, chavrusa board with Jitsi links, accounts (self-declared levels).

## Decisions (settled)
- Hosting: Cloudflare (reviewed vs VPS; stay unless search/joins become a problem).
- Text and commentary: per-section files in R2; D1 only for users/notes/votes/search/link indexes. Notes store ref + word range + quoted words, so they survive text file updates.
- Imports: GitHub Actions (public repo, no data/secrets in code), resumable with checkpoints, from Sefaria's official bulk export (verify format/license first, no scraping).
- Fixed tzuras hadaf is the default: open-source daf-renderer shapes, layout precomputed once offline at a fixed width with self-hosted OFL fonts, stored with the section files and embedded as backup; no nikud by default with a nikud toggle (precompute both variants); live renderer as secondary view; original-scan view later, only from verified public-domain sources.
- Dibur hamatchil in bold first (use existing bold where present, else detect and validate against base words), then word-level commentary links. Ein Mishpat etc. later.
- Legal: respect each text's license, non-commercial, credit Sefaria, skip restricted texts and log them.

## First-run scope
Chumash: Bereishis from Vayishlach (Gen 32:4) to end + all Shemos. Gemara: Berakhos + Shabbos from 2a through end of Perek 4 (exact boundaries from Sefaria index). Mishnayos: Peah. Full depth/breadth of mefarshim, license permitting.

## Next steps
1. R2 bucket + token. 2. Bold DH, fixed daf, nikud toggle on existing Berakhos/Shemos. 3. Pipeline + import of the scope above. 4. Bookshelf, search index, word-level links. 5. Wider scope (see sizing in chat: core ~0.6-0.8 GB; all mefarshim several GB).

## Known issues / notes
- D1 free-plan write limit (100k/day) was mostly used by the first import.
- Static-asset upload via wrangler fails behind the sandbox proxy, so site files are embedded in the Worker (`scripts/embed.py`).
- daf-renderer needs a CORS-enabled font stylesheet (`crossorigin="anonymous"`) or it throws when reading CSS rules.

## Status log
- 2026-11-26: Cloudflare R2 bucket `torah-world-data` created (empty). GitHub repo creation is blocked from the cloud session (sandbox is bound to existing repos): the user must create an empty public repo `torah-world`; then attach + push (local git history already exists).
- 2026-11-26: Phase 1 done and deployed: (a) bold dibur hamatchil for Rashi/Tosafot/Rashbam/etc. - validated against base-text words (most Tanach/Mishnah commentary already has bold from the source); (b) fixed "Page view" tzuras hadaf is the default for Gemara: layout numbers precomputed once per amud and nikud variant at design width 1000px (`scripts/precompute_layouts.js` -> `layouts.json` + `public/layouts.js`), rendered proportionally to the screen (CSS transform/zoom break word selection in Chrome, so proportional sizes are used; minimum scale 0.62 then horizontal scroll); (c) nikud toggle (off by default); (d) Live layout kept as a secondary view; (e) fonts self-hosted (Frank Ruhl Libre, Noto Rashi Hebrew, SIL OFL) via `scripts/fonts.py`; (f) daf-renderer patched with `options.preSpacers` (skips measuring).
- Layouts exist for Gemara Berakhos 2a-64a (125 amudim x 2 variants). Re-run `precompute_layouts.js` after importing more Gemara (script lists amudim at the top).
- Not done yet: original-scan view; Ein Mishpat etc.; R2 files; official bulk export pipeline; GitHub Actions; word-level commentary links; bookshelf; Shabbos/Peah/Bereishis imports.
- 2026-11-26 (research): Sefaria's official bulk export = public GCS bucket `gs://sefaria-export/` (~26 GB, ~85k files, no auth; index `books.json` in github.com/Sefaria/Sefaria-Export; formats json/txt/cltk; links as CSV `links/links0..12.csv`). License is per text, in each *version* JSON `license` field (merged files do not carry it, so the pipeline must read per-version files and record the license; Public Domain/CC0/CC-BY/CC-BY-SA/CC-BY-NC are expected). Downloads from storage.googleapis.com work from the sandbox.
- First-run scope in the export: Genesis, Exodus, Berakhot, Shabbat, Mishnah Peah = 357 Hebrew version files (~192 MB raw, includes duplicate "merged" copies and parts outside the scope), roughly 140 distinct commentary works. Listed in `docs/scope_files.json`.
- Shabbat Perek 4 (BaMeh Tomnin) = Shabbat 47b:8-51b:6, so "part 1" = amudim 2a through 51b (51b begins Perek 5 at :7, include the whole amud). Genesis Vayishlach starts Gen 32:4. Texts with CC-BY-NC (e.g. William Davidson/Steinsaltz digital edition) are allowed only because the license says so: non-commercial + attribution.
