#!/usr/bin/env bash
# Upload out/sections/** and out/manifest/** to the R2 bucket (key = path relative to out/).
# Needs CLOUDFLARE_API_TOKEN (and optionally CLOUDFLARE_ACCOUNT_ID, otherwise looked up from the token).
set -euo pipefail
OUT="${1:-out}"; BUCKET="${R2_BUCKET:-torah-world-data}"
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(curl -s -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:?token missing}" https://api.cloudflare.com/client/v4/accounts | python3 -c "import json,sys;print(json.load(sys.stdin)['result'][0]['id'])")
  export CLOUDFLARE_ACCOUNT_ID
fi
cd "$OUT"
count=$(find sections manifest -type f -name '*.json' | wc -l); echo "uploading $count files to r2://$BUCKET"
find sections manifest -type f -name '*.json' | sort | \
  xargs -P 6 -I{} sh -c 'for i in 1 2 3; do npx --yes wrangler@4 r2 object put "'"$BUCKET"'/{}" --file "{}" --content-type "application/json; charset=utf-8" --remote >/dev/null 2>&1 && exit 0; sleep 3; done; echo "FAILED {}"; exit 1'
echo "done: $count files uploaded"
