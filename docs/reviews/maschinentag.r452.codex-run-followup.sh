#!/bin/bash
set +e
cd /tmp/r452/tree/lcnc-gateway
/home/cnc/lcnc-suite-p2bf/lcnc-gateway/.venv/bin/python -B -m pytest -p no:cacheprovider -o addopts= -q test_codex_r452_import.py > /tmp/r452/import-probe.txt 2>&1
printf 'import observation exit=%s\n' "$?"
cd /tmp/r452/tree/lcnc-webui
node node_modules/vitest/vitest.mjs run src/previewWorker.codexR452.test.ts > /tmp/r452/worker-probe.txt 2>&1
printf 'worker test exit=%s\n' "$?"
cd /tmp/r452/tree
python3 - <<'PY'
import json, subprocess
r=json.load(open('/tmp/r452/browser.json'))['config']['metadata']['run']
subprocess.run(['/home/cnc/lcnc-suite-p2bf/lcnc-gateway/.venv/bin/python','scripts/test_select/replay.py','--dir','lcnc-webui/test-results/replay','--events','lcnc-webui/test-results/mock-events.jsonl','--http','lcnc-webui/test-results/http','--run',r,'--out','/tmp/r452/replay.json'],check=True)
PY
