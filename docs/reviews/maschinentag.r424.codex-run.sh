set -eu
cd /tmp/codex-r424/lcnc-webui
npm run build > /tmp/r424/build.txt 2>&1
npx vitest run src/releaseClick.test.ts src/dragScroll.test.ts src/r423-dragLifecycle.test.ts > /tmp/r424/unit.txt 2>&1
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r424
export LCNC_E2E_EVENTS=/tmp/r424/events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r424/replay LCNC_E2E_HTTP_DIR=/tmp/r424/http
export PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r424/browser.json
npx playwright test e2e/press-release.spec.ts e2e/run-hold.spec.ts e2e/r420-codex.spec.ts e2e/r420-more.spec.ts e2e/r420-cancel.spec.ts e2e/r421-codex.spec.ts e2e/r422-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r424/browser.txt 2>&1
