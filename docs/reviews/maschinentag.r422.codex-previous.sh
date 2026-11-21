#!/bin/bash
set -eu
cd /tmp/codex-r421/lcnc-webui
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r422-previous LCNC_E2E_EVENTS=/tmp/r422/previous-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r422/previous-replay LCNC_E2E_HTTP_DIR=/tmp/r422/previous-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r422/previous.json
npx playwright test e2e/r422-codex.spec.ts --grep 'scroll owners leave' --workers=1 --reporter=line,json > /tmp/r422/previous.txt 2>&1
