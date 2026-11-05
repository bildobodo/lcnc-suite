"""R286: read-only source/merge and stored gate audit. No test servers."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path('/tmp/codex-r286')
LIVE = Path('/home/cnc/lcnc-suite')
sys.path.insert(0, str(ROOT / 'scripts'))
from test_select import proof
from test_select.rules import HEAVY_UNIT

out = {'reviewed': {'A': '838c3381', 'B': '5c6fa9b9'}, 'gates': {}}
for label, name, log in [
    ('A', 'browser-gaps.merge-gate.run2.json', 'integ2.merge-gate.run2.logs'),
    ('B', 'native-stage.step1.gate-round.json', 'native.step1.gate-round.run1.logs'),
]:
    report = json.loads((LIVE / 'docs/reviews' / name).read_text())
    folder = Path('/home/cnc/claude-work/teststrat/measure') / log
    result = {k: report.get(k) for k in ['head', 'kind', 'verdict', 'omitted', 'pending']}
    for unit in ['unit-light'] + (['unit-heavy'] if label == 'A' else []):
        listed = json.loads((folder / (unit + '.list.json')).read_text())
        ran = json.loads((folder / (unit + '.json')).read_text())
        result[unit] = {'listed': len(listed), 'ran': ran['numTotalTests'], 'passed': ran['numPassedTests'],
                        'issues': proof.check_unit_executed(listed, ran)}
    listed = json.loads((folder / 'list-run.json').read_text())
    ran = json.loads((folder / 'playwright.json').read_text())
    events = [json.loads(s) for s in (folder / 'mock-events.jsonl').read_text().splitlines()]
    result['browser'] = {'stats': ran['stats'], 'execution_issues': proof.check_executed(listed, ran),
                         'worker_issues': proof.check_workers(ran, events, proof.report_run(ran))}
    result['sha256'] = {n: hashlib.sha256((folder / n).read_bytes()).hexdigest()
                        for n in ['playwright.json', 'list-run.json', 'mock-events.jsonl', 'unit-light.json']}
    if label == 'A':
        result['all_heavy_selected'] = set(report['selection']['unit']['heavy']) == set(HEAVY_UNIT)
    out['gates'][label] = result

def blob(commit, path):
    return subprocess.check_output(['git', '-C', str(LIVE), 'show', f'{commit}:{path}'])

path = 'scripts/inventory/functions.json'
base, left, right, merged = [json.loads(blob(c, path)) for c in ['b588eaea', '916a7317', '4c021765', '838c3381']]
maps = [{f['id']: f for f in d['functions']} for d in [base, left, right, merged]]
b, l, r, m = maps
both = [k for k in m if l.get(k) != b.get(k) and r.get(k) != b.get(k)]
bad = [k for k in m if m[k] != (r[k] if r.get(k) != b.get(k) else l[k])]
out['merge'] = {'both_changed': both, 'wrong_merge': bad, 'function_count': len(m),
                'statements': sum(len(f.get('statements', [])) for f in merged['functions']),
                'shared_metadata_equal': all(base[k] == left[k] == right[k] == merged[k]
                                            for k in ['areas', 'excludedAtoms'])}
files = ['scripts/native_run.py', 'scripts/test_support/live_target.py', 'scripts/test_support/native_cases.py',
         'scripts/test_support/system_host.py', 'scripts/test_support/restore_lan.py',
         'scripts/test_support/live_session.py', 'scripts/install_examples.py', 'scripts/test_native_stage.py',
         'scripts/inventory/functions.py', 'lcnc-webui/e2e/bake-hold.viewer.spec.ts']
out['source_hashes'] = {p: {'sha256': hashlib.sha256((ROOT/p).read_bytes()).hexdigest(),
                           'matches_5c6fa9b9': (ROOT/p).read_bytes() == blob('5c6fa9b9', p)} for p in files}
(ROOT / 'r286-audit.json').write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps({k:v for k,v in out.items() if k != 'source_hashes'}, indent=2))
