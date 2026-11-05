"""R286 counterexamples, entirely offline in an archive of 5c6fa9b9.

These assertions document CURRENT wrong acceptance; they are reproduction
probes, not proposed correctness guards. No systemd/LCNC/WS access, no machine
commands. All writes target pytest's temporary directories.
"""
import json
import hashlib
import os
import shutil
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path('/tmp/codex-r286')
sys.path.insert(0, str(ROOT / 'scripts'))
import native_run as nr
import test_native_stage as existing
from test_support import restore_lan as rl, live_target as lt, native_cases as nc
from test_support.system_host import clients_since

OBS = {}

@pytest.fixture(scope='session', autouse=True)
def output():
    yield
    (ROOT / 'r286-probes.json').write_text(json.dumps(OBS, indent=2) + '\n')

def test_path_the_launcher_actually_builds(tmp_path):
    bin_ = tmp_path / 'run/bin'
    bin_.mkdir(parents=True)
    for name, rel in nr.HELPERS.items():
        (bin_ / name).symlink_to(ROOT / rel)
    intended = f'{bin_}:/usr/local/bin:/usr/bin:/bin'
    # The exact installed launcher's rule; read only, never execute LinuxCNC.
    launcher = Path('/usr/bin/linuxcnc').read_text()
    assert 'if [[ "$PATH" != *".local/bin"* ]]; then' in launcher
    assert 'PATH=$HOME/.local/bin:$PATH' in launcher
    assert 'PATH=$LINUXCNC_BIN_DIR:$PATH' in launcher
    actual = intended
    if (Path.home()/'.local/bin').is_dir() and '.local/bin' not in actual:
        actual = f'{Path.home()}/.local/bin:{actual}'
    actual = '/usr/bin:' + actual
    resolutions = {n: {'preflight': str(Path(shutil.which(n, path=intended)).resolve()),
                       'launch': str(Path(shutil.which(n, path=actual)).resolve())}
                   for n in ['hal_reader.py', 'hal_watchdog.py', 'compensation.py']}
    assert all(v['preflight'].startswith(str(ROOT)) and v['launch'].startswith('/home/cnc/lcnc-suite/')
               for v in resolutions.values())
    OBS['launcher_PATH'] = {'resolutions': resolutions, 'installed_linuxcnc_sha256': hashlib.sha256(Path('/usr/bin/linuxcnc').read_bytes()).hexdigest(), 'rule_lines': [line for line in launcher.splitlines() if 'PATH=' in line or '.local/bin' in line]}

def test_kill_after_test_unit_start_leaves_it_running(tmp_path):
    class OccupiedHost(existing.FakeHost):
        def __init__(self):
            super().__init__()
            self.native_running = False
            self.stopped = []
        def stop(self, n):
            self.stopped.append(n)
            if n == nr.UNIT:
                self.native_running = False
            else:
                super().stop(n)
        def start(self, n, spec):
            if n == 'lcnc-sim-gates' and self.native_running:
                raise RuntimeError('LinuxCNC already occupied by native-sim')
            super().start(n, spec)
    h = OccupiedHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.native_running = True  # independent systemd-run --unit=native-sim
    # A SIGKILL removes nr.run's finally. ExecStopPost invokes THIS CLI.
    nr.write_json(tmp_path/'pre.json', pre)
    rc = rl.main(['--from', str(tmp_path/'pre.json'), '--out', str(tmp_path/'out.json')], host_factory=lambda p: h)
    out = json.loads((tmp_path/'out.json').read_text())
    assert rc == 1 and h.native_running and nr.UNIT not in h.stopped
    OBS['kill_after_start'] = {'restore': out, 'native_running': h.native_running, 'stopped': h.stopped,
                               'pre_keys': sorted(pre)}

def test_mutable_hardlink_is_accepted(tmp_path, monkeypatch):
    run, cfg = existing._install_copy(tmp_path, monkeypatch)
    tree = run/'tree'
    (tree/'lcnc-gateway').mkdir(parents=True)
    ini = cfg/'lcnc_suite_sim_3axis_xyz.ini'
    variable = cfg/lt.ini_values(ini.read_text())[('RS274NGC', 'PARAMETER_FILE')][-1]
    original = tmp_path/'operator.var'
    original.write_bytes(variable.read_bytes())
    variable.unlink()
    variable.hardlink_to(original)
    issues = lt.confinement_problems(ini, run, tree)
    assert issues == []
    variable.write_text('R286 sentinel: write through accepted target\n')
    assert original.read_text() == variable.read_text()
    OBS['mutable_hardlink'] = {'issues': issues, 'same_inode': original.stat().st_ino == variable.stat().st_ino,
                               'outside_file_changed': True, 'outside_is_only_test_fixture': True}

def test_install_temporary_target_is_not_confined(tmp_path, monkeypatch):
    import install_examples as installer
    monkeypatch.setattr(installer, 'assert_stopped', lambda: None)
    monkeypatch.setattr(installer.Path, 'home', lambda: tmp_path/'home')
    run, cfg = tmp_path/'run', tmp_path/'run/configs/sim'
    cfg.mkdir(parents=True)
    outside = tmp_path/'operator-sentinel'
    outside.write_text('do not change\n')
    temporary = cfg/'lcnc_suite_sim_3axis_xyz.ini.install-tmp'
    temporary.symlink_to(outside)
    installer.install(ROOT, cfg, run/'config-backups/sim', nc_files='nc_files', macro_dir='macros', confine=run)
    assert outside.read_text() != 'do not change\n'
    OBS['installer_temp_escape'] = {'outside_changed': True, 'bytes_written':outside.stat().st_size,
                                    'confine':str(run), 'only_tmp_fixture':True}

def test_restore_accepts_old_instance(tmp_path):
    h = existing.FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    old = h.instance
    original = h.start
    def start(n, spec):
        original(n, spec)
        h.instance = old   # no new controller proved
    h.start = start
    out = rl.restore(h, pre)
    assert out['outcome'] == 'complete' and out['instance'] == pre['instance']
    OBS['old_instance'] = out

def test_second_restore_loses_failed_isolation():
    h = existing.FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.hashes['config'] = 'operator config changed'
    first = rl.restore(h, pre)
    second = rl.restore(h, pre)
    accepted = nr.verdict({'rows': [{'status':'PASS'}], 'restore':second})
    assert first['isolation'] == ['config changed']
    assert second['isolation'] is None and accepted == 'PASS'
    OBS['isolation_lost_on_repeat'] = {'first':first, 'second':second, 'run_verdict_using_second':accepted}

def test_any_client_counts_as_keepalive():
    event = {'tag':'loop.tick', 'pid':42, 'clients':1, 't_wall_ns':2_000_000_000}
    assert clients_since([json.dumps(event)], 42, 1)
    OBS['any_client_counts'] = {'event':event, 'contains_keepalive_or_heartbeat_identity':False, 'accepted':True}

def test_home_timeout_becomes_pass(monkeypatch):
    class Client:
        status = {'homed_joints':[False,False,False], 'inpos':False}
        error = None
        def request(self, command, **kw):
            self.status = {'homed_joints': ([False]*3 if command=='unhome_all' else
                         ([True]*3 if command=='home_all' else [i==kw['joint'] for i in range(3)])),
                          'inpos':False}
    c = Client()
    failed = []
    def wait(client, pred, timeout, what):
        if what.startswith('home-'):
            assert not pred(client.status)
            failed.append(what)
            raise RuntimeError('completion not reached: no inpos')
        if what == 'homed for the jogs':
            client.status['inpos'] = True
        assert pred(client.status)
        return dict(client.status)
    monkeypatch.setattr(nr, '_wait', wait)
    rows = nr.home_cases(3)[1]({'client':c})
    assert len(failed) == 4 and all(r['status'] == 'PASS' for r in rows)
    OBS['home_timeouts'] = {'failed_completion_waits':failed, 'rows':rows}

def test_jog_unknown_velocity_becomes_a_measured_stop(monkeypatch):
    now = [100.0]
    frames = []
    class Client:
        error = None
        status = {}
        def request(self, cmd, **kw):
            if cmd == 'mdi':
                self.status = {'joint_pos':list(nr.JOG_START), 'inpos':True, 'interp_state':1}
            if cmd == 'jog_cont':
                self.status['joint_pos'][kw['axis']] += 15 * (1 if kw['vel'] > 0 else -1)
            if cmd == 'jog_stop':
                self.status['current_vel'] = None
    c = Client()
    def sleep(seconds):
        if seconds == 1.0:
            frames.append((now[0]+0.01, dict(c.status)))
        now[0] += seconds
    # nr.time is the stdlib module: context restores it before pytest continues.
    with patch.object(nr.time, 'monotonic', lambda:now[0]), patch.object(nr.time, 'sleep', sleep):
        rows = nr.jog_cases(1)[1]({'client':c, 'frames':frames})
    assert all(r['status'] == 'PASS' for r in rows)
    OBS['jog_unknown_velocity'] = {'velocity': None, 'rows':rows}

def test_nonstatus_reply_replays_old_values_as_a_new_sample():
    from test_support.live_session import SimulatorClient
    events=[]
    c = SimulatorClient('', auto_confirm=False, on_status=lambda t,s:events.append(s))
    c.stop.set()  # no spurious end-of-fake-wire error
    c.ws = [json.dumps({'type':'status', 'data':{'joint_pos':[315,300,-50], 'current_vel':0}}),
            json.dumps({'ok':True, 'cmd':'some_read', 'data':{'value':'unrelated'}})]
    c.receive()
    assert len(events) == 2 and events[1]['current_vel'] == 0
    OBS['nonstatus_sample'] = events

def test_jog_nan_distance_accepted():
    row = nc.eval_jog('jog-x+', 0, 1, 300, float('nan'), [(0.01,float('nan'),0)])
    assert row['status'] == 'PASS'
    OBS['jog_nan'] = {**row, 'travel':str(row['travel']), 'brake_mm':str(row['brake_mm'])}
