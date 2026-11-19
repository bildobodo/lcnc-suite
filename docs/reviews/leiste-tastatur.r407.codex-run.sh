#!/bin/bash
set -eu
cd /tmp/codex-r407-s/lcnc-webui
npm run build > /tmp/r407-s-build.txt 2>&1
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r407-s LCNC_E2E_EVENTS=/tmp/r407-s-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r407-s-replay LCNC_E2E_HTTP_DIR=/tmp/r407-s-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r407-s-browser.json
npx playwright test e2e/strip-fit.spec.ts e2e/r407-codex.spec.ts e2e/replay-origin.spec.ts e2e/safety-during-edit.spec.ts --grep 'strip fit:|codex R407|every connection a test opens|a first touch that holds Home X' --workers=1 --reporter=line,json > /tmp/r407-s-browser.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r407-s-ff LCNC_E2E_EVENTS=/tmp/r407-s-ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r407-s-ff-replay LCNC_E2E_HTTP_DIR=/tmp/r407-s-ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r407-s-ff.json
npx playwright test -c playwright.firefox.config.ts e2e/strip-fit.spec.ts --workers=1 --reporter=line,json > /tmp/r407-s-ff.txt 2>&1
cd /tmp/codex-r407-k/lcnc-webui
npm run build > /tmp/r407-k-build.txt 2>&1
export LCNC_E2E_RUN=codex-r407-k LCNC_E2E_EVENTS=/tmp/r407-k-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r407-k-replay LCNC_E2E_HTTP_DIR=/tmp/r407-k-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r407-k-browser.json
npx playwright test e2e/input-session.spec.ts e2e/macros.spec.ts e2e/safety-during-edit.spec.ts --grep 'D7, touch|the macro bar is dense|the helper whole in the viewport' --workers=1 --reporter=line,json > /tmp/r407-k-browser.txt 2>&1
