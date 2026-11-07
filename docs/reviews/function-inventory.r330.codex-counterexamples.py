#!/usr/bin/env python3
"""R330 pure counterexamples, no services, controller or live files touched."""
from pathlib import Path
import sys, json, tempfile, subprocess
from unittest.mock import patch

ROOT = Path(sys.argv[1]).resolve()
sys.path[:0] = [str(ROOT / 'scripts'), str(ROOT / 'scripts/test_select')]
import round_gate as rg
from test_support import install_cases as ic, restore_lan as rl
import native_run
from test_support.heavy_lock import heavy_lock

out = []
with tempfile.TemporaryDirectory(prefix='r330-cases-') as td:
    d = Path(td)
    logs = d / 'repeat.logs'
    run = logs / 'install-probe'
    run.mkdir(parents=True)
    old = {'commit': 'OLD_HEAD', 'started': 1, 'ended': 2, 'verdict': 'PASS',
           'rows': [{'case': 'install-run', 'status': 'PASS'}],
           'restore': {'outcome': 'complete', 'isolation': []}}
    (run / 'report.json').write_text(json.dumps(old))
    (run / 'restore-post.json').write_text(json.dumps({'outcome': 'complete', 'isolation': []}))
    calls, launch_failure = [], []
    def fake(cmd, **kw):
        calls.append(cmd)
        if cmd[0] == 'systemd-run':
            try:
                native_run.run(object(), [], run)
            except FileExistsError as e:
                launch_failure.append(type(e).__name__)
            return subprocess.CompletedProcess(cmd, 0, '', '')
        if cmd[:3] == ['systemctl', '--user', 'show']:
            return subprocess.CompletedProcess(cmd, 0, 'ActiveState=failed\nLoadState=loaded\nExecMainStatus=1', '')
        return subprocess.CompletedProcess(cmd, 0, '', '')
    with patch.object(rg.subprocess, 'run', fake), patch.object(rg.time, 'sleep', lambda _: None):
        result = rg.install_probe(logs, unit='own-test-only')
    out.append({'case':'prior_PASS_after_current_FileExistsError', 'current_launch':launch_failure,
                'gate_result':result,'old_report_unchanged':json.loads((run/'report.json').read_text()) == old})

    calls = []
    def interrupted(cmd, **kw):
        calls.append(cmd)
        if cmd[:3] == ['systemctl', '--user', 'show']:
            raise KeyboardInterrupt('gate operator interrupted while probe unit still active')
        return subprocess.CompletedProcess(cmd, 0, '', '')
    with patch.object(rg.subprocess, 'run', interrupted):
        try:
            with heavy_lock('own R330 gate', path=d/'own-heavy.lock'):
                rg.install_probe(d/'interrupted.logs', unit='own-active-probe')
        except KeyboardInterrupt:
            pass
    with heavy_lock('own R330 next gate', wait=0, path=d/'own-heavy.lock'):
        next_gate_acquired = True
    out.append({'case':'gate_interrupt_leaves_probe_unit_unattended', 'calls':calls,
                'stop_called':any(c[:3] == ['systemctl','--user','stop'] for c in calls),
                'next_gate_acquired_same_lock':next_gate_acquired})

    run2 = d/'partial-clone'; src = run2/'src'; src.mkdir(parents=True)
    class Host(ic.InstallProbeHost):
        def unit_status(self, unit): return {'load':'not-found', 'active':'inactive', 'pids':[], 'invocation':None}
        def process_alive(self, *args): return False
    state = {'tree':str(src), 'tree_of':str(ROOT)}
    err=rl.end_test_resources(Host(run=run2),state)
    out.append({'case':'clone_aborted_before_git_directory', 'cleanup_errors':err,'test_ended':state.get('test_ended')})

print(json.dumps(out, indent=2))
