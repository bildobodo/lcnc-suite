#!/bin/bash
set -eu
cd /tmp/codex-r405/lcnc-webui
npm run build > /tmp/r405-build.txt 2>&1
CI=1 LCNC_E2E_WORKERS=1 npx playwright test e2e/r405-plan.spec.ts --workers=1 --reporter=line > /tmp/r405-browser.txt 2>&1
