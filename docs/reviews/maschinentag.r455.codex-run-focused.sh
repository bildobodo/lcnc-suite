#!/bin/bash
set +e
cd /tmp/r455/tree/lcnc-webui
node node_modules/vitest/vitest.mjs run src/viewer/toolpathController.test.ts src/viewer/fatPaths.test.ts > /tmp/r455/unit.txt 2>&1
unit=$?
node node_modules/vite/bin/vite.js build > /tmp/r455/build.txt 2>&1
build=$?
browser=99
if [ "$build" = 0 ]; then
 CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r455-focused LCNC_E2E_SELECTION=/tmp/r455/selection.json npm exec -- playwright test -c playwright.select.config.ts --reporter=json > /tmp/r455/browser.json 2> /tmp/r455/browser-console.txt
 browser=$?
fi
python3 - "$unit" "$build" "$browser" <<'PY2'
import json, sys
from pathlib import Path
result=dict(zip(['unit','build','browser'], map(int,sys.argv[1:])))
Path('/tmp/r455/exits.json').write_text(json.dumps(result,indent=2)+'\n')
print(result)
PY2
