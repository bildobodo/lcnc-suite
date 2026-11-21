set -eu
cd /tmp/codex-r423/lcnc-webui
npm run build > /tmp/r423/build.txt 2>&1
unit_rc=0
npx vitest run src/releaseClick.test.ts src/r423-dragLifecycle.test.ts > /tmp/r423/unit.txt 2>&1 || unit_rc=$?
printf 'unit exit %s\n' "$unit_rc"
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r423
export LCNC_E2E_EVENTS=/tmp/r423/events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r423/replay LCNC_E2E_HTTP_DIR=/tmp/r423/http
export PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r423/browser.json
npx playwright test e2e/press-release.spec.ts e2e/r420-codex.spec.ts e2e/r420-more.spec.ts e2e/r420-cancel.spec.ts e2e/r421-codex.spec.ts e2e/r422-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r423/browser.txt 2>&1
