set -eu
for version in r421 r422; do
  cd /tmp/codex-$version/lcnc-webui
  export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r422-refined-$version
  export LCNC_E2E_EVENTS=/tmp/r422/refined-$version-events.jsonl
  export LCNC_E2E_REPLAY_DIR=/tmp/r422/refined-$version-replay
  export LCNC_E2E_HTTP_DIR=/tmp/r422/refined-$version-http
  export PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r422/refined-$version.json
  result=0
  npx playwright test e2e/r422-codex.spec.ts --grep 'Settings cycles' --workers=1 --reporter=line,json > /tmp/r422/refined-$version.txt 2>&1 || result=$?
  printf '%s exit %s\n' "$version" "$result"
done
