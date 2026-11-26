# RUNBOOK

Plain-language guide for running, deploying and restoring Torah World. Nothing here needs the original author.

## Accounts and secrets (never commit these)
- Cloudflare account id: your own (shown in the Cloudflare dashboard; set it as `CLOUDFLARE_ACCOUNT_ID`, never commit tokens). Worker `torah-world`, D1 database `torah-world` (id in `wrangler.toml`).
- A Cloudflare API token with: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Account Settings Read. Put it in GitHub -> Settings -> Secrets as `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`). Delete/rotate tokens when finished.
- Optional: `ANTHROPIC_API_KEY` as a Worker secret enables AI topic tagging (`npx wrangler secret put ANTHROPIC_API_KEY`).

## Deploy
```bash
npm install
python3 scripts/embed.py        # embeds public/ into worker/assets.js (needed: static-asset upload is not used)
npx wrangler deploy
```
Environment for CLI: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Database
- Schema: `schema.sql`. Apply: `npx wrangler d1 execute torah-world --remote --file schema.sql`.
- Text import (current prototype): `python3 scripts/fetch.py` (reads Sefaria) then `python3 scripts/build_sql.py` and run each `data/sql/*.sql` with `wrangler d1 execute --remote --file`. The planned replacement uses Sefaria's official bulk export and R2 files (see PROJECT_STATE.md). D1 free plan allows ~100k row writes/day; do not re-import the same day.
- Backup: `npx wrangler d1 export torah-world --remote --output backup.sql`. Keep copies outside Cloudflare.

## Restore
1. Create a new D1 database, put its id in `wrangler.toml`.
2. `wrangler d1 execute <db> --remote --file backup.sql`.
3. `python3 scripts/embed.py && npx wrangler deploy`.

## Local test
`npx wrangler dev --local` (needs a local copy of the data loaded with `--local`).

## Legal rules
Non-commercial only; credit Sefaria; per-text licenses are recorded and respected; no ArtScroll/Oz Vehadar/Steinsaltz material; only openly licensed fonts.
