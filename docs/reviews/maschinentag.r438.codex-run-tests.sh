#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r438/logs
py=/home/cnc/lcnc-suite-p4ui/lcnc-gateway/.venv/bin/python
cd /tmp/r438/head/lcnc-gateway
"$py" -m pytest -p no:cacheprovider -o addopts='--ignore=test_viewer_init.py' -v test_estop_reset_outcome.py test_error_line_golden.py test_r437_codex_reset.py test_r437_codex_error_line.py > /tmp/r438/backend.txt 2>&1
printf 'backend exit=%s\n' "$?"
cd /tmp/r438/head/lcnc-webui
node node_modules/vite/bin/vite.js build > /tmp/r438/build.txt 2>&1 || exit 1
CI=1 node node_modules/@playwright/test/cli.js test -c playwright.r438.config.ts e2e/r437-g30.codex.spec.ts e2e/r437-pocket.codex.spec.ts e2e/g30.spec.ts e2e/probe-visual.spec.ts --workers=1 > /tmp/r438/browser.txt 2>&1
printf 'browser exit=%s\n' "$?"
