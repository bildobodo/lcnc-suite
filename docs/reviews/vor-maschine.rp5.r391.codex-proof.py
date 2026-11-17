#!/usr/bin/env python3
"""R391: a regular early-error report from the existing perf runner.

Compile four functions from source, never import the driver. Every external
operation is replaced. The first fake pid read admits the runner; the second
returns None, so sc_trip exits before any signal or machine operation.
"""
import argparse
import ast
import asyncio
import contextlib
import copy
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from types import SimpleNamespace


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', type=Path, required=True)
    ap.add_argument('--review-root', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    a = ap.parse_args()
    source = a.root / 'scripts/perf_matrix.py'
    content = source.read_bytes()
    assert content == subprocess.check_output(['git', '-C', str(a.review_root), 'show',
                                               'cd23f813:scripts/perf_matrix.py'])
    commit = subprocess.check_output(['git', '-C', str(a.review_root), 'rev-parse',
                                      'cd23f813']).decode().strip()
    wanted = {'sc_trip', 'scenario_failure', 'trace_failure', 'run'}
    defs = [copy.deepcopy(n) for n in ast.parse(content).body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in wanted]
    assert len(defs) == 4
    for n in defs:
        n.decorator_list = []
    pid_answers = iter([123456, None])
    pid_reads = []

    def pid():
        value = next(pid_answers)
        pid_reads.append(value)
        return value

    async def sleep(_):
        pass

    async def trace_mark(*_):
        return 'ok'

    def forbidden(*args, **kwargs):
        raise AssertionError('No machine or external operation permitted')

    with tempfile.TemporaryDirectory(prefix='r391-perf-error-') as tmp:
        ns = dict(asyncio=SimpleNamespace(sleep=sleep),
                  subprocess=SimpleNamespace(run=lambda *args, **kwargs:
                                             SimpleNamespace(stdout=commit[:8])),
                  os=SimpleNamespace(path=os.path, makedirs=os.makedirs, kill=forbidden),
                  REPO=tmp, TRACE='no-live-trace', RUN_ID='r391-synthetic-early-error',
                  datetime=datetime, timezone=timezone, time=time, json=json,
                  gateway_pid=pid, gateway_rss_kb=lambda _: 0,
                  trace_mark=trace_mark,
                  trace_window=lambda *_: {'marks': ['start', 'end'], 'mark_pids': [123456]},
                  TRACE_PAD_S=0, LIVENESS_FAILED=False, DELIVERY_FAILED=False,
                  SCENARIO_FAILURES={}, halcmd_getp=forbidden)
        exec(compile(ast.Module(body=defs, type_ignores=[]), str(source), 'exec'), ns)
        ns['SCENARIOS'] = {'sigstop_trip': ns['sc_trip']}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            rc = asyncio.run(ns['run'](SimpleNamespace(scenarios=['sigstop_trip'], allow_trip=True)))
        reports = list((Path(tmp) / 'runlogs/perf-matrix').glob('*.json'))
        assert len(reports) == 1
        report = json.loads(reports[0].read_text())
        entry = report['scenarios']['sigstop_trip']
        missing = [k for k in ('sticky_ok', 'recovered_ok') if k not in entry['direct']]
        assert rc == 1 and entry['direct'] == {'error': 'no gateway pid'}
        assert entry['FAIL'] == 'error: no gateway pid' and len(missing) == 2
        result = {
            'review': 'R391', 'document_commit': '6bfa5213', 'source_commit': commit,
            'source_sha256': hashlib.sha256(content).hexdigest(),
            'scope': 'AST-extracted real runner with fake dependencies; NOT a native run',
            'machine_operations': 'forbidden; none executed', 'fake_pid_reads': pid_reads,
            'driver_exit_code': rc, 'driver_stdout': output.getvalue().splitlines(),
            'scenario_entry_written': entry,
            'matching_metadata_for_plan_case_only': {'commit': commit, 'dirty': False},
            'R391_failed_branch_matches': 'FAIL' in entry or 'error' in entry['direct'],
            'R391_missing_without_skip_branch_matches': bool(missing) and 'skipped' not in entry['direct'],
            'missing_success_properties': missing,
            'required_classification': 'valid failed scenario attempt, not a damaged report',
        }
        a.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'exit': rc, 'direct': entry['direct'], 'FAIL': entry['FAIL'],
                          'missing': missing, 'both_plan_branches_match': True}))


if __name__ == '__main__':
    main()
