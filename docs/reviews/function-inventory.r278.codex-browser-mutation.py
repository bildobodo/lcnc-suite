"""R278 sensitivity check. Only run against a /tmp archive of 59ae81e8.
Requires copied node_modules, the r278.codex.spec.ts probe and isolated
playwright.r278.config.ts (own mock port 4591, workers 1, no live server).
Builds deliberate mutations, runs the cited and independent checks, restores
the original App.vue even on failure. The dist folder retains the mutant.
"""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
if not str(root).startswith('/tmp/'):
    raise SystemExit('isolated /tmp archive required')
web = root / 'lcnc-webui'
source = web / 'src/App.vue'
original = source.read_bytes()
changes = [
    ('value: !optionalStopOn.value', 'value: true'),
    ('value: !blockDeleteOn.value', 'value: false'),
    ('function spindleReverse(speed: number) {\n  fire({ cmd: "spindle_reverse", speed }',
     'function spindleReverse(_speed: number) {\n  fire({ cmd: "spindle_reverse", speed: 1000 }'),
]
out = {'target': '59ae81e8', 'mutations': changes, 'source_sha_before': hashlib.sha256(original).hexdigest()}
def run(args, name, env=None):
    p = subprocess.run(args, cwd=web, text=True, capture_output=True, env=env)
    (root / (name + '.txt')).write_text(p.stdout + '\n' + p.stderr)
    return p.returncode
try:
    text = original.decode()
    for old, new in changes:
        if text.count(old) != 1: raise RuntimeError('mutation anchor: ' + old)
        text = text.replace(old, new)
    source.write_text(text)
    out['build_exit'] = run(['npm', 'run', 'build'], 'mutation-build')
    if out['build_exit'] != 0: raise RuntimeError('mutant build failed')
    env = {**os.environ, 'LCNC_E2E_RUN': 'codex-r278-mutated',
           'LCNC_E2E_EVENTS': str(root / 'events-mutated.jsonl'),
           'R278_REPORT': str(root / 'browser-mutated.json')}
    out['browser_exit'] = run(['node', 'node_modules/@playwright/test/cli.js', 'test',
         '-c', 'playwright.r278.config.ts', 'strip-actions.spec.ts:85',
         'strip-actions.spec.ts:107', 'r278.codex.spec.ts'], 'browser-mutated', env)
    report = json.loads((root / 'browser-mutated.json').read_text())
    out['stats'] = report['stats']
    def collect(suites):
        rows = []
        for suite in suites:
            for spec in suite.get('specs', []):
                rows.append({'title': spec['title'], 'ok': spec['ok'],
                             'statuses': [r['status'] for t in spec['tests'] for r in t['results']]})
            rows += collect(suite.get('suites', []))
        return rows
    out['tests'] = collect(report['suites'])
finally:
    source.write_bytes(original)
    out['source_sha_after'] = hashlib.sha256(source.read_bytes()).hexdigest()
    (root / 'mutation.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(out, ensure_ascii=False, indent=2))
