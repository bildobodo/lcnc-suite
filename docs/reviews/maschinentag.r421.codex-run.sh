#!/bin/bash
set -eu
cd /tmp/codex-r421/lcnc-webui
npm run build > /tmp/r421/build.txt 2>&1
npx vitest run src/releaseClick.test.ts > /tmp/r421/unit.txt 2>&1
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r421 LCNC_E2E_EVENTS=/tmp/r421/events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r421/replay LCNC_E2E_HTTP_DIR=/tmp/r421/http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r421/browser.json
npx playwright test e2e/press-release.spec.ts e2e/r420-codex.spec.ts e2e/r420-more.spec.ts e2e/r420-cancel.spec.ts e2e/r421-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r421/browser.txt 2>&1
