"""R373: offline mutations of a COPY of the supplied full-run artifacts.

Usage: python3 r373_artifact_probe.py REPO GATE_LOGS OUT_JSON
No browser, socket, gateway or controller is started.
"""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile

repo, source, out = map(Path, sys.argv[1:])
sys.path.insert(0, str(repo / 'scripts/test_select'))
import replay
import proof

events_path = source / 'mock-events.jsonl'
report = json.loads((source / 'playwright.json').read_text())
events = [json.loads(s) for s in events_path.read_text().splitlines() if s]
run = report['config']['metadata']['run']
logs = {p.name: [json.loads(s) for s in p.read_text().splitlines() if s]
        for p in (source / 'replay').glob(f'{run}-*.jsonl')}
names = sorted(logs)

def valid_open(rows):
    return next(i for i, r in enumerate(rows) if r['kind'] == 'open'
                and isinstance(r.get('origin'), dict) and r['origin'].get('run') == run)

def missing_enable(data):
    rows = data[names[0]]
    i = valid_open(rows)
    rows.insert(i + 1, {'kind': 'frame', 't': rows[i]['t'], 'conn': rows[i]['conn'],
                        'msg': {'cmd': 'timing_log'}})

def wrong_project(data):
    rows = data[names[0]]
    rows[valid_open(rows)]['origin']['project'] = 'not-the-project-of-this-attempt'

def wrong_worker(data):
    src, dst = data[names[0]], data[names[1]]
    opened = src[valid_open(src)]
    conn = max(r.get('conn', 0) for r in dst) + 1
    dst[-1:-1] = [{'kind': 'open', 't': opened['t'], 'conn': conn, 'origin': opened['origin']},
                  {'kind': 'frame', 't': opened['t'], 'conn': conn,
                   'msg': {'cmd': 'machine_off'}}]

def orphan(data):
    rows = data[names[0]]
    rows.insert(-1, {'kind': 'frame', 't': rows[-1]['t'], 'conn': 9999999,
                     'raw': 'not JSON, no open, silently lost'})

def no_cookie_extra(data):
    for rows in data.values():
        conn = next((r['conn'] for r in rows if r['kind'] == 'open' and r.get('origin') is None), None)
        if conn is not None:
            r = next(r for r in rows if r['kind'] == 'frame' and r['conn'] == conn)
            r['msg']['resume_armed'] = 'not a boolean'
            r['msg']['unreviewed_field'] = True
            return
    raise AssertionError('No named no-cookie connection found')

cases = [('baseline', None), ('missing enable', missing_enable), ('wrong project', wrong_project),
         ('wrong mock instance', wrong_worker), ('frame without open', orphan),
         ('no-cookie exception with malformed payload', no_cookie_extra)]
results = []
for name, change in cases:
    data = copy.deepcopy(logs)
    if change:
        change(data)
    with tempfile.TemporaryDirectory(prefix='r373-artifact-') as tmp:
        d = Path(tmp)
        for fname, rows in data.items():
            (d / fname).write_text(''.join(json.dumps(r) + '\n' for r in rows))
        result = replay.check(d, events_path, run, [])
    results.append({'case': name, 'required_verdict': 'FAIL' if change else 'PASS',
                    'actual_verdict': result['verdict'], 'findings': result['findings'],
                    'frames': result['frames'], 'attempts': result['attempts'],
                    'per_attempt_count': len(result['per_attempt'])})

files = [events_path, source / 'playwright.json', *(source / 'replay').glob(f'{run}-*.jsonl')]
answer = {'reviewed_head': '1fe5e274f423f32ae15ec7b7469cd109cdbef549', 'source': str(source),
          'run': run, 'worker_proof_findings': proof.check_workers(report, events, run),
          'mutations_only_to_temporary_copies_of_replay': True,
          'input_sha256': {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
          'cases': results}
out.write_text(json.dumps(answer, indent=2) + '\n')
print(json.dumps({k: v for k, v in answer.items() if k != 'input_sha256'}, indent=2))
