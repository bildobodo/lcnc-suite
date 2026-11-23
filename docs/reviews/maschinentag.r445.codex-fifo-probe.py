"""R445: a queued extra renewal must be caught by the final FIFO recount.

Run only in an isolated /tmp archive, under scripts/test_support/heavy_lock.py:
  python3 -I fifo-probe.py /tmp/r445/tree /tmp/r445/fifo

The worker saves a duplicate of renewal 5 and flushes it immediately BEFORE
the next start on the same socket. The unchanged spec must fail at its final
count (6 vs 5); deleting only the two final counts is the sensitivity control.
No live gateway is used. Source files are restored byte-identical.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
assert root.is_relative_to(Path('/tmp')), 'Only an isolated /tmp tree is allowed'
out = Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=False)
web = root / 'lcnc-webui'
worker = web / 'src/wsWorker.ts'
spec = web / 'e2e/jog-lease.spec.ts'
original_worker = worker.read_bytes()
original_spec = spec.read_bytes()
title = 'a held jog button names its lease, the page renews it, its release ends exactly that lease'

def change_once(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new)

mutated = change_once(original_worker.decode(),
    'let hbTimer: ReturnType<typeof setInterval> | null = null;',
    'let hbTimer: ReturnType<typeof setInterval> | null = null;\n'
    'let r445RenewCount = 0;\nlet r445Queued: string | null = null;')
mutated = change_once(mutated,
    '    case "send":\n      if (ws && ws.readyState === WebSocket.OPEN) {\n        try {\n          ws.send(msg.payload);',
    '    case "send":\n      if (ws && ws.readyState === WebSocket.OPEN) {\n        try {\n'
    '          const r445Frame = JSON.parse(msg.payload);\n'
    '          if (r445Frame.cmd === "jog_renew" && ++r445RenewCount === 5) r445Queued = msg.payload;\n'
    '          if (r445Frame.cmd === "jog_cont" && r445Queued !== null) {\n'
    '            ws.send(r445Queued); r445Queued = null;\n'
    '          }\n'
    '          ws.send(msg.payload);')

def build(label):
    with (out / (label + '-build.log')).open('w') as log:
        result = subprocess.run(['npm', 'run', 'build'], cwd=web,
                                stdout=log, stderr=subprocess.STDOUT, timeout=180)
    assert result.returncode == 0, label + ' build failed'

def run(label):
    env = dict(os.environ, CI='1', LCNC_E2E_RUN='codex-r445-' + label,
               LCNC_E2E_EVENTS=str(out / (label + '-events.jsonl')),
               LCNC_E2E_REPLAY_DIR=str(out / (label + '-replay')),
               LCNC_E2E_HTTP_DIR=str(out / (label + '-http')),
               PLAYWRIGHT_JSON_OUTPUT_NAME=str(out / (label + '-report.json')))
    with (out / (label + '-browser.log')).open('w') as log:
        result = subprocess.run(['npx', '--no-install', 'playwright', 'test',
            'e2e/jog-lease.spec.ts', '-g', title, '--workers=1', '--retries=0',
            '--forbid-only', '--reporter=line,json'], cwd=web, env=env,
            stdout=log, stderr=subprocess.STDOUT, timeout=120)
    report = json.loads((out / (label + '-report.json')).read_text())
    messages = []
    statuses = []
    def walk(suite):
        for child in suite.get('suites', []): walk(child)
        for test_spec in suite.get('specs', []):
            for test in test_spec.get('tests', []):
                for attempt in test.get('results', []):
                    statuses.append(attempt['status'])
                    messages.extend(e.get('message', '') for e in attempt.get('errors', []))
    for suite in report['suites']: walk(suite)
    return {'label': label, 'exit': result.returncode, 'stats': report['stats'],
            'statuses': statuses, 'messages': messages}

results = []
try:
    worker.write_text(mutated)
    build('queued-renewal')
    red = run('queued-renewal')
    results.append(red)
    assert red['exit'] != 0 and red['statuses'] == ['failed'], red
    assert any('exactly the 5 renewals of L, none after its end' in m for m in red['messages']), red
    control = original_spec.decode()
    for assertion in [
        '    expect(all.filter((r) => r.ids.includes(L)).length, "exactly the 5 renewals of L, none after its end").toBe(5);',
        '    expect(all.length, "no renewal beyond the 5 steps").toBe(5);',
    ]:
        control = change_once(control, assertion, '    // R445 sensitivity control: final count removed.')
    spec.write_text(control)
    green = run('no-final-count')
    results.append(green)
    assert green['exit'] == 0 and green['statuses'] == ['passed'], green
finally:
    worker.write_bytes(original_worker)
    spec.write_bytes(original_spec)
    (out / 'results.json').write_text(json.dumps({
        'round': 'R445', 'results': results,
        'restored': worker.read_bytes() == original_worker and spec.read_bytes() == original_spec,
        'original_worker_sha256': hashlib.sha256(original_worker).hexdigest(),
        'original_spec_sha256': hashlib.sha256(original_spec).hexdigest(),
    }, indent=2) + '\n')
    build('restored')
print(json.dumps({'red_at_final_count': True, 'control_without_count_passed': True,
                  'sources_and_build_restored': True}))
