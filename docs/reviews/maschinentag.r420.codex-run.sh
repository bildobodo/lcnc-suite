#!/bin/bash
set -eu
cd /tmp/codex-r420/lcnc-webui
npm run build > /tmp/r420/build.txt 2>&1
npx vitest run src/releaseClick.test.ts > /tmp/r420/unit.txt 2>&1
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r420 LCNC_E2E_EVENTS=/tmp/r420/events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r420/replay LCNC_E2E_HTTP_DIR=/tmp/r420/http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r420/browser.json
npx playwright test e2e/press-release.spec.ts e2e/r420-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r420/browser.txt 2>&1
