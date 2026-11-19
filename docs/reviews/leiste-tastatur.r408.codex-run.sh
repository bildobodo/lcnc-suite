#!/bin/bash
set -eu
cd /tmp/codex-r408/lcnc-webui
npm run build > /tmp/r408-build.txt 2>&1
npx vitest run src/e2eJsonLines.test.ts --allowOnly=false --retry=0 --reporter=verbose --reporter=json --outputFile.json=/tmp/r408-unit.json > /tmp/r408-unit.txt 2>&1
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r408-s LCNC_E2E_EVENTS=/tmp/r408-s-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r408-s-replay LCNC_E2E_HTTP_DIR=/tmp/r408-s-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r408-s-browser.json
npx playwright test e2e/strip-fit.spec.ts e2e/replay-origin.spec.ts --workers=1 --reporter=line,json > /tmp/r408-s-browser.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r408-s-ff LCNC_E2E_EVENTS=/tmp/r408-s-ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r408-s-ff-replay LCNC_E2E_HTTP_DIR=/tmp/r408-s-ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r408-s-ff.json
npx playwright test -c playwright.firefox.config.ts e2e/strip-fit.spec.ts --workers=1 --reporter=line,json > /tmp/r408-s-ff.txt 2>&1
export LCNC_E2E_RUN=codex-r408-probe LCNC_E2E_EVENTS=/tmp/r408-probe-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r408-probe-replay LCNC_E2E_HTTP_DIR=/tmp/r408-probe-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r408-probe.json
set +e
npx playwright test e2e/r408-codex.spec.ts --grep '3axis-xyz @ touch-fullhd — no overflow|the unbroken 372 error note over a loaded tool|approved wrapped type' --workers=1 --reporter=line,json > /tmp/r408-probe.txt 2>&1
result=$?
set -e
printf '%s\n' "$result" > /tmp/r408-probe.exit
