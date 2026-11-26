# Content contract (adding more books to Torah World)

Several sessions add content in parallel. This is how to do it without colliding. The **main session** owns `public/**`, `worker/**`, `scripts/import_export.py`, `scripts/build_catalog.py`, the existing workflows and D1. Other sessions work on their own branch and in their own new files, and message the main session to merge.

## Book ids and R2 keys
- Book id = `<category>-<slug>`, all lowercase, e.g. `yerushalmi-berakhot`, `tosefta-berakhot`, `midrash-bereishit-rabbah`, `halakhah-mishneh-torah-shabbat`. The category is one of: `tanakh`, `mishnah`, `bavli` (core, already done), `yerushalmi`, `tosefta`, `midrash`, `halakhah`, `kabbalah`, `chasidut`, `musar`, `liturgy`.
- Sections: `sections/<category>/<rest-of-id>/<sec>.json` (the id with its FIRST dash replaced by `/`), e.g. `sections/yerushalmi/berakhot/3.json`. `<sec>` = `[0-9A-Za-z.:_-]{1,30}` (chapter, siman, parasha number, amud ...).
- Manifest: `manifest/<book-id>.json`. Links/placement/reports use the dashed book id (`links/<book-id>/<sec>.json`), see LINKS_CONTRACT.md.
- Section file format = what `scripts/import_export.py` writes (schema 1): `{schema, work, sec, book, kind, text:{version,license,source,segments[]}, commentary:[{who,title,he_title,version,license,source,seg:{"<segIdx>":[comment,...]}}]}`. Segment index is 1-based. HTML is limited to `b i small big br strong em`.

## Catalog (how books appear on the site)
Each session writes ITS OWN catalog file `catalog/<group>.json` (e.g. `catalog/yerushalmi.json`) = `{"schema":1,"books":[...]}`; the Worker merges `catalog.json` + every `catalog/*.json`. Never edit `catalog.json` (core books). A book entry:
```json
{ "id": "yerushalmi-berakhot", "title": "Jerusalem Talmud Berakhot", "he": "תלמוד ירושלמי ברכות", "cat": "Yerushalmi", "group": "Seder Zeraim", "order": 100,
  "type": "mishnah", "secs": ["1","2","3"], "secWord": "פרק", "secWordEn": "Chapter", "secLabels": { "1": "הלכה א" },
  "commentaries": 5, "base_license": "CC-BY-NC", "generated": "2026-11-27T00:00:00Z" }
```
- `type`: `chumash` (flowing verses with numbers), `mishnah` (one paragraph per segment: use this for every non-verse, non-daf text: Yerushalmi, Tosefta, Midrash, Halakhah), `daf` (Vilna-style page, Bavli only).
- `cat` is the section heading on the home page / menu, `group` the sub-heading, `order` sorts inside the group. `secLabels` (optional) maps sec -> Hebrew label; `secWord`/`secWordEn` name the unit (פרק/סימן/הלכה/פרשה).

## Upload and rate limits (IMPORTANT)
Cloudflare's API allows only about 1200 requests per 5 minutes for ALL tokens of the account together, and several workflows run at once. Use `scripts/upload_r2.py <dir> --threads 2` (REST with backoff), keep matrix `max-parallel` at 2 or lower per workflow, never start many wrangler processes. If you see HTTP 429, back off. (An R2 S3-style credential may be added later for speed; the main session will announce it.)

## Legal rules (all sessions)
Only Sefaria's official export (public GCS bucket, index books.json, per-version `license` field). Use only Public Domain / CC0 / CC-BY / CC-BY-SA / CC-BY-NC(-SA) versions; skip and log everything else (unknown/None/copyrighted). Non-commercial, keep attribution (the site shows it per page from the section file). No scraping of sefaria.org, no ArtScroll/Oz Vehadar/Steinsaltz prints. Never commit data files or secrets.

## Working rules
- Branch `<topic>-work`; never push to `main`. Message the main session (`send_message` to the parent) when something is ready to merge or you need help; keep messages short (the user is usage-limited).
- Re-runnable, resumable scripts; heavy work in GitHub Actions (public repo = free minutes, 6 h per job).
- Append progress to `PROJECT_STATE.md` (append only).
