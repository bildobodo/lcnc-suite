import json
import os
import subprocess
from pathlib import Path

root = Path('/tmp/r468/tree/lcnc-webui')
Path('/tmp/r468/selection.json').write_text(json.dumps(['tool-table-read']))
env = dict(os.environ, LCNC_E2E_SELECTION='/tmp/r468/selection.json',
           LCNC_E2E_WORKERS='1', LCNC_E2E_RUN='codex-r468',
           LCNC_E2E_EVENTS='/tmp/r468/events.jsonl',
           LCNC_E2E_REPLAY_DIR='/tmp/r468/replay', LCNC_E2E_HTTP_DIR='/tmp/r468/http')
commands = [
    ['npm', 'run', 'test', '--', 'src/toolTableRead.test.ts'],
    ['npm', 'run', 'build'],
    ['npx', '--no-install', 'playwright', 'test', '-c', 'playwright.select.config.ts', '--reporter=list'],
]
for n, cmd in enumerate(commands):
    with open(f'/tmp/r468/frontend-{n}.txt', 'w') as f:
        r = subprocess.run(cmd, cwd=root, env=env, stdout=f, stderr=subprocess.STDOUT)
    print(json.dumps({'command': cmd, 'exit': r.returncode}), flush=True)
    if r.returncode:
        raise SystemExit(r.returncode)
