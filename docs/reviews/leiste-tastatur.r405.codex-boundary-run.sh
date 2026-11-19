#!/bin/bash
set -eu
cd /tmp/codex-r405/lcnc-webui
CI=1 LCNC_E2E_WORKERS=1 npx playwright test e2e/r405-boundary.spec.ts --workers=1 --reporter=line > /tmp/r405-boundary-browser.txt 2>&1
