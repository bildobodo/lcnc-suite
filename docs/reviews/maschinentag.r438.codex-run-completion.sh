#!/bin/bash
cd /tmp/r438/head/lcnc-webui
CI=1 node node_modules/@playwright/test/cli.js test -c playwright.r438-extra.config.ts e2e/r438-g30.codex.spec.ts --workers=1 > /tmp/r438/g30-completion.txt 2>&1
