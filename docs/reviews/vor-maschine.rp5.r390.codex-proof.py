#!/usr/bin/env python3
"""R390 plan probe: reproduce a skipped perf_matrix report without a live driver.

Only four functions are compiled from the archive's AST. Every external
operation of run() is replaced, and kill is forbidden. No source module is
imported, no socket opened, no machine command sent. Temporary files only.
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
    ap.add_argument('--dryrun', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    a = ap.parse_args()
    source = a.root / 'scripts/perf_matrix.py'
    content = source.read_bytes()
    committed = subprocess.check_output(['git', '-C', str(a.review_root), 'show',
                                         'cd23f813:scripts/perf_matrix.py'])
    assert content == committed
    commit = subprocess.check_output(['git', '-C', str(a.review_root), 'rev-parse',
                                     'cd23f813']).decode().strip()
    tree = ast.parse(content)
    names = {'sc_trip', 'scenario_failure', 'trace_failure', 'run'}
    defs = [copy.deepcopy(n) for n in tree.body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
    assert len(defs) == 4
    locations = {n.name: n.lineno for n in defs}
    for n in defs:
        n.decorator_list = []
    callbacks = []

    async def sleep(_):
        pass

    async def trace_mark(name, edge):
        callbacks.append(['fake_trace_mark', name, edge])
        return 'ok'

    def forbidden(*args, **kwargs):
        raise AssertionError('Forbidden external operation')

    with tempfile.TemporaryDirectory(prefix='r390-perf-skip-') as tmp:
        ns = dict(asyncio=SimpleNamespace(sleep=sleep),
                  subprocess=SimpleNamespace(run=lambda *args, **kwargs:
                                             SimpleNamespace(stdout=commit[:8])),
                  os=SimpleNamespace(path=os.path, makedirs=os.makedirs, kill=forbidden),
                  REPO=tmp, TRACE='no-live-trace', RUN_ID='r390-synthetic-skip',
                  datetime=datetime, timezone=timezone, time=time, json=json,
                  gateway_pid=lambda: 123456, gateway_rss_kb=lambda pid: 0,
                  trace_mark=trace_mark, trace_window=forbidden, TRACE_PAD_S=0,
                  LIVENESS_FAILED=False, DELIVERY_FAILED=False, SCENARIO_FAILURES={})
        exec(compile(ast.Module(body=defs, type_ignores=[]), str(source), 'exec'), ns)
        ns['SCENARIOS'] = {'sigstop_trip': ns['sc_trip']}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            rc = asyncio.run(ns['run'](SimpleNamespace(scenarios=['sigstop_trip'], allow_trip=False)))
        reports = list((Path(tmp) / 'runlogs/perf-matrix').glob('*.json'))
        assert len(reports) == 1
        report = json.loads(reports[0].read_text())
        entry = report['scenarios']['sigstop_trip']
        assert rc == 0 and 'skipped' in entry['direct'] and 'FAIL' not in entry
        # The plan's only proposed writer additions: known matching full
        # commit and a clean source tree. These are synthetic metadata, NOT
        # a claim that this probe ran a native test at that commit.
        projected = {'commit': commit, 'dirty': False, 'scenarios': report['scenarios']}
        rule_passes = (projected['commit'] == commit and projected['dirty'] is False
                       and 'sigstop_trip' in projected['scenarios']
                       and 'FAIL' not in projected['scenarios']['sigstop_trip'])
        dryrun = json.loads(a.dryrun.read_text())
        original_dryrun = json.loads((a.review_root / 'docs/reviews/vor-maschine.rp5.r390.live-drivers-dryrun.json').read_text())
        assert dryrun == original_dryrun
        result = {
            'review': 'R390', 'document_commit': '5841b60f', 'source_commit': commit,
            'source_sha256': hashlib.sha256(content).hexdigest(), 'functions_from_source': locations,
            'scope': 'AST-extracted runner in an isolated namespace; no native run',
            'external_operations': 'all substituted; kill and trace reading forbidden',
            'callbacks': callbacks, 'driver_exit_code': rc,
            'driver_stdout': output.getvalue().splitlines(), 'scenario_entry_written': entry,
            'R390_metadata_added_only_to_fixture': {'commit': commit, 'dirty': False},
            'R390_without_FAIL_rule_counts_as_passed': rule_passes,
            'required_coverage_class': 'SKIP, not a passed behavioral assertion',
            'static_adapter_rerun': {'identical_to_submitted': dryrun == original_dryrun,
                                    'bindings': dryrun['bindings'], 'resolved': dryrun['resolved'],
                                    'red': dryrun['red'], 'files': dryrun['files']},
        }
        assert rule_passes
        a.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'static_bindings_resolved': dryrun['resolved'],
                          'driver_exit': rc, 'direct': entry['direct'],
                          'FAIL_key_present': 'FAIL' in entry,
                          'plan_counts_as_passed': rule_passes}, ensure_ascii=False))


if __name__ == '__main__':
    main()
