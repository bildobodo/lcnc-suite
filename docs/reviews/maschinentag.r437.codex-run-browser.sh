#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r437/logs
py=/home/cnc/lcnc-suite-p4ui/lcnc-gateway/.venv/bin/python
"$py" /tmp/r437/error-probe.py > /tmp/r437/error-probe.json
printf 'error-line probe exit=%s\n' "$?"
cd /tmp/r437/head/lcnc-webui
node node_modules/vite/bin/vite.js build > /tmp/r437/build.txt 2>&1 || exit 1
CI=1 node node_modules/@playwright/test/cli.js test -c playwright.r437.config.ts e2e/r437-g30.codex.spec.ts e2e/r437-pocket.codex.spec.ts e2e/g30.spec.ts e2e/tool-edit.spec.ts e2e/tool-preview.spec.ts e2e/probe-click.spec.ts e2e/setup-gates.spec.ts --workers=1 > /tmp/r437/browser.txt 2>&1
printf 'browser exit=%s\n' "$?"
