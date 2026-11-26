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
