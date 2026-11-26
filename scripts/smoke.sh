#!/usr/bin/env bash
# Post-deploy smoke test: every important route must answer 200 with the expected shape. Exit 1 on the first failure.
BASE="${1:-https://torah-world.yosefrosner39.workers.dev}"; fail=0
check() { # name url python-expression-on-d (optional)
  local name="$1" url="$2" expr="${3:-True}"; local body code
  body=$(curl -s -m 30 -w '\n%{http_code}' "$BASE$url"); code=$(echo "$body" | tail -1); body=$(echo "$body" | sed '$d')
  if [ "$code" != "200" ]; then echo "FAIL $name: HTTP $code ($url)"; fail=1; return; fi
  if [ -n "$expr" ] && [ "$expr" != "True" ]; then echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if ($expr) else 1)" 2>/dev/null || { echo "FAIL $name: unexpected content ($url)"; fail=1; return; }; fi
  echo "ok   $name"
}
check home "/" ""
check catalog "/api/catalog" "len(d['books'])>=6"
check section-gemara "/api/section?work=bavli-berakhot&sec=2a" "len(d['segments'])>5 and len(d['comments'])>20"
check section-chumash "/api/section?work=tanakh-exodus&sec=3" "len(d['segments'])>10"
check section-mishnah "/api/section?work=mishnah-peah&sec=1" "len(d['segments'])>3"
check links "/api/links?work=bavli-berakhot&sec=2a" "'links' in d and 'incoming' in d"
check layouts "/api/layouts?work=bavli-berakhot" "isinstance(d,dict)"
check search "/api/search?q=%D7%A9%D7%9E%D7%A2" "'text' in d and 'notes' in d"
check notes "/api/notes?work=tanakh-exodus&sec=3" "'notes' in d"
check me "/api/me" "'user' in d"
check chavrusa "/api/chavrusa" "'posts' in d"
check app-js "/app.js" ""
check styles "/styles.css" ""
check fonts "/fonts/frank-ruhl-hebrew-400.woff2" ""
exit $fail
