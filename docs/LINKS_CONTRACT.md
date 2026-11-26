# Links data contract (links session <-> main session)

The **links session** produces connection data; the **main session** owns the UI, Worker, importer and deploys. Neither edits the other's files.

## Ownership
- Links session: `scripts/links/**`, `docs/reports/**`, R2 keys `links/**` and `reports/**`.
- Main session: everything else (`public/**`, `worker/**`, `scripts/import_export.py`, workflows, D1).
- Work on branch `links-work` (never push the links session's work straight to `main`; the main session merges).

## Book ids (same as the site)
`tanakh-genesis`, `tanakh-exodus`, `mishnah-berakhot`, `mishnah-peah`, `bavli-berakhot`, `bavli-shabbat` (more will follow). Section ids: chapter number (`"3"`) or amud (`"17b"`). Segment `idx` is 1-based (same as `sections/<work>/<sec>.json`). Word indexes are 0-based positions in the segment's text after removing HTML tags and splitting on whitespace.

## File: `links/<work>/<sec>.json` in R2 (bucket `torah-world-data`)
```json
{ "schema": 1, "work": "bavli-berakhot", "sec": "2a", "generated": "2026-11-27T00:00:00Z",
  "links": [
    { "from": { "idx": 3, "ws": 4, "we": 6 },
      "to":   { "work": "tanakh-genesis", "sec": "1", "idx": 5 },
      "type": "quotation",
      "source": "string-match",
      "confidence": 0.93,
      "note": "quotes Gen 1:5 (6 matching words)",
      "review": "unreviewed" } ] }
```
- `from.ws/we` optional (omit for a whole segment). `to` is a site passage (`work`/`sec`/`idx`) or `{ "sefaria": "Genesis 1:5" }` when the target book is not on the site yet.
- `type`: `commentary` | `quotation` | `parallel` | `midrash` | `halakhah` | `suggested`.
- `source`: `sefaria-links` (official links file) | `string-match` (deterministic text matching) | `model` (AI suggestion).
- `confidence`: 0-1. Anything below 0.6 is not shown by default. AI suggestions must use `source: "model"`, `review: "unreviewed"`, and show as "suggested" in the UI.
- Links are two-way by design: the main session derives the reverse direction.

## Validation reports
`reports/links/<work>.json` in R2 and a short `docs/reports/<work>.md` in the repo: for each commentator, how many comments sit on a base segment that really contains the words they quote (match rate), plus a list of suspicious placements.

## Rules
- Legal: only use data from Sefaria's official export (public GCS bucket), never scrape; keep each source's license; non-commercial; no copyrighted material (no ArtScroll/Oz Vehadar/Steinsaltz prints).
- Be usage-light: run heavy jobs as scripts or GitHub Actions, keep chat output short.
- Report progress by updating `PROJECT_STATE.md` (append only) and by `send_message` to the parent session when a milestone is done or help is needed.

## Extra files (added by the links session)
All keys use the catalog book id (`bavli-berakhot`); section ids as in `sections/<work>/<sec>.json`.

### `placement/<book>/<sec>.json` (only sections that have something to fix)
```json
{ "schema": 1, "work": "bavli-berakhot", "sec": "3a",
  "moves": { "Ritva": { "2:1": [11], "5:3": [4, 5] } },
  "page":  { "Rosh":  [ "1:1", "1:2", "7:1" ] } }
```
- Keys are `"<ourSeg>:<commentIdx>"`: the segment key and 1-based comment index inside it, exactly as in `sections/<work>/<sec>.json` (`commentary[who].seg[ourSeg][commentIdx-1]`).
- `moves[who][key]` = correct base segment(s) (1-based). Source: Sefaria's official commentary links; if there is none, the unique segment containing the dibur hamatchil (>= 75% of its words).
- `page[who]` = comments that could not be placed (the commentator is keyed by chapter/siman or by its own order and has no usable link): show them at whole-page level (idx 0). NOTE: the list holds `"seg:idx"` strings, not bare numbers (a bare comment index is ambiguous across segments).
- Commentators judged correct (`verdict: ok` in `reports/links/<book>.json`, e.g. Rashi, Tosafot, Steinsaltz) never appear. Not produced for Tanakh books yet.

### `linksin/<book>/<sec>.json` (incoming links)
Same shape as `links/`; every entry is the inverse of a link whose `to` is a passage of this book: `from` = the other passage `{work, sec, idx, ws?, we?}`, `to` = `{work, sec, idx}` in this section. Links whose other side is not on the site stay only in the other direction's file, they are not repeated here.

### Link packs (links, linksin, placement)
`linkpacks/<book-id>/<kind>.index.json` (kind = `links` | `linksin` | `placement`) = `{"v":1,"files":["<name>",...],"secs":{"<sec>":[fileIdx,offset,length]}}`; the `files` are keys under `linkpacks/<book-id>/` (`<kind>-<stamp>-<k>.bin`, versioned, never overwritten, index uploaded last). Each `secs` entry is the exact bytes of the per-file JSON. Per-file objects (`links/`, `linksin/`, `placement/`) are still written; the Worker tries the pack first. Placement packs exist only for books rebuilt by the run that wrote them.
