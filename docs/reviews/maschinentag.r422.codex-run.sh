#!/bin/bash
set -eu
cd /tmp/codex-r422/lcnc-webui
npm run build > /tmp/r422/build.txt 2>&1
npx vitest run src/releaseClick.test.ts > /tmp/r422/unit.txt 2>&1
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r422 LCNC_E2E_EVENTS=/tmp/r422/events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r422/replay LCNC_E2E_HTTP_DIR=/tmp/r422/http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r422/browser.json
npx playwright test e2e/press-release.spec.ts e2e/r420-codex.spec.ts e2e/r420-more.spec.ts e2e/r420-cancel.spec.ts e2e/r421-codex.spec.ts e2e/r422-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r422/browser.txt 2>&1
