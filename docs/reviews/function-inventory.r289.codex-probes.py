"""R289 isolated probes. Reproductions assert current faults, not acceptance.
Run from an archive of 1f9e8289. Never invokes systemd, LinuxCNC or sockets.
"""
import ast
import json
import os
from pathlib import Path
import sys
import time

import msgspec
import pytest

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'scripts'))
from test_native_stage import FakeHost
from test_support import restore_lan as rl, native_cases as nc, heavy_lock as hl
import native_run as nr

RESULTS = []


class Interrupted(BaseException):
    """The process disappears: no normal error handling or post-call save."""


@pytest.fixture(autouse=True)
def isolated_lock(tmp_path, monkeypatch):
    monkeypatch.setattr(hl, 'LOCK', tmp_path / 'r289-heavy.lock')


def stopped_host(run):
    run.mkdir()
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    nr.write_json(run / 'pre.json', pre)
    return h, pre


def restore_cli(run, h, name):
    return rl.main(['--from', str(run / 'pre.json'), '--out', str(run / name)], host_factory=lambda pre: h)


def test_positive_creation_ack_gap_is_recovered(tmp_path, monkeypatch):
    run = tmp_path / 'r289-start-gap'
    h, pre = stopped_host(run)
    tree = run / 'tree'
    state = {'tree': str(tree), 'tree_of': '/source'}
    nr.write_json(run / 'state.json', state)
    ctx = {'run': run, 'ini': run / 'config/sim.ini', 'config': run / 'config',
           'path': '/usr/bin', 'tree': tree, 'state': state}
    def start_then_disappear(argv, **kwargs):
        assert argv[0] == 'systemd-run'
        unit = next(x.removeprefix('--unit=') for x in argv if x.startswith('--unit='))
        h.run_test_unit(unit, ctx['config'], ctx['ini'])
        raise Interrupted()
    monkeypatch.setattr(nr.subprocess, 'run', start_then_disappear)
    with pytest.raises(Interrupted):
        nr.start_copy()[1](ctx)
    persisted = json.loads((run / 'state.json').read_text())
    assert 'test_unit_intent' in persisted and 'test_unit' not in persisted
    assert restore_cli(run, h, 'out.json') == 0
    out = json.loads((run / 'out.json').read_text())
    assert h.test_instance is None
    assert not h.active[persisted['test_unit_intent']]
    assert str(tree) in h.removed
    assert out['isolation'] == []
    RESULTS.append({'case': 'R288 creation gap closed for active unit', 'restore': out})


def test_positive_restore_phase_persisted_before_lan_start(tmp_path, monkeypatch):
    run = tmp_path / 'r289-return-gap'
    h, pre = stopped_host(run)
    nr.write_json(run / 'state.json', {})
    start = h.start
    disk_at_effect = []
    def start_then_disappear(name, spec):
        start(name, spec)
        if name == 'lcnc-sim-gates':
            disk_at_effect.append(json.loads((run / 'state.json').read_text()))
            h.hashes['config'] = 'LAN wrote its own state'
            raise Interrupted()
    monkeypatch.setattr(h, 'start', start_then_disappear)
    with pytest.raises(Interrupted):
        restore_cli(run, h, 'out-first.json')
    assert disk_at_effect == [{'test_ended': True, 'isolation': []}]
    assert not (run / 'restore.json').exists()
    monkeypatch.setattr(h, 'start', start)
    assert restore_cli(run, h, 'out-second.json') == 0
    second = json.loads((run / 'out-second.json').read_text())
    assert second['outcome'] == 'complete'
    assert second['isolation'] == []
    assert nr.verdict({'rows': [{'status': 'PASS'}], 'restore': second}) == 'PASS'
    RESULTS.append({'case': 'R288 restore phase durability closed', 'disk_at_lan_start': disk_at_effect[0],
                    'resume': second, 'run_pass': True})


def keeper_function(beat, frames):
    # Only the function AST is executed; imports and connect()/infinite heartbeat loop are NEVER run.
    source = (ROOT / 'r289-keepalive-source.py').read_text()
    module = ast.parse(source)
    fn = next(n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == 'drain')
    scope = {'ws': iter(frames), 'BEAT': beat, 'PORT': 54321, 'json': json, 'os': os, 'time': time, 'msgspec': msgspec}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), 'keeper-drain-only', 'exec'), scope)
    scope['drain']()


def test_positive_binary_pongs_write_keepalive_proof(tmp_path):
    beat = tmp_path / 'keeper.beat.json'
    keeper_function(beat, [msgspec.msgpack.encode({'type': 'pong'})] * 3)
    assert json.loads(beat.read_text())['pongs'] == 3
    RESULTS.append({'case': 'R288 binary pong proof closed', 'received_pongs': 3, 'beat_exists': True})


def test_positive_text_pongs_write_keepalive_proof(tmp_path):
    beat = tmp_path / 'keeper.beat.json'
    keeper_function(beat, [json.dumps({'type': 'pong'})] * 3)
    assert json.loads(beat.read_text())['pongs'] == 3
    RESULTS.append({'case': 'keeper JSON control', 'pongs': 3})


@pytest.mark.parametrize('sign', [1, -1])
def test_positive_delayed_pre_reply_status_gives_no_false_failure(sign):
    # The positions are controller samples. Receipts are on the client's clock.
    # At t=0 (stop reply) p=315, v=50. Then a=750 -> rest at 316+2/3 after 1/15 s.
    # A sample taken 33ms BEFORE t=0 is delivered 5ms AFTER it, retaining wire order.
    origin = 300.0
    pos = lambda p: origin + sign * (p - origin)
    before = (-0.005, pos(315 - 50 * .066))
    samples = [(0.005, pos(315 - 50 * .033), 50), (.080, pos(315 + 50**2 / (2*750)), 0)]
    out = nc.eval_jog('delayed', 0, sign, origin, before, samples)
    actual = 50**2 / (2*750)
    assert actual < nc.brake_bound(0)
    assert out['status'] == 'incomplete'
    assert out['brake_lower_mm'] > nc.brake_bound(0)
    RESULTS.append({'case': 'R288 delayed status closed', 'sign': sign,
                    'actual_brake_from_reply_mm': actual, 'true_limit_mm': nc.brake_bound(0),
                    'post_receipt_sample_source_time_s': -.033, 'out': out})


@pytest.mark.parametrize('sign', [1, -1])
def test_positive_r287_five_mm_brake_is_no_longer_pass(sign):
    out = nc.eval_jog('r287', 0, sign, 300, (-.001, 300 + sign*15),
                      [(.09, 300 + sign*18.4875, 27.5), (.2, 300 + sign*20, 0)])
    assert out['status'] == 'incomplete'
    RESULTS.append({'case': 'R287 analytic brake closed', 'sign': sign, 'out': out})


def test_positive_repeat_proves_current_head_and_command(tmp_path):
    run = tmp_path / 'r289-repeat'
    h, pre = stopped_host(run)
    nr.write_json(run / 'state.json', {})
    assert restore_cli(run, h, 'out-first.json') == 0
    h.head = 'changed'
    h.units['bg-keepalive'] = {'ExecStart': ['/other-keeper'], 'WorkingDirectory': '/'}
    assert restore_cli(run, h, 'out-second.json') == 1
    out = json.loads((run / 'out-second.json').read_text())
    assert any('HEAD' in r for r in out['reasons'])
    assert any('command' in r for r in out['reasons'])
    RESULTS.append({'case': 'current proofs repeated', 'out': out})


def teardown_module():
    (ROOT / 'r289-probes.json').write_text(json.dumps(RESULTS, indent=2) + '\n')


@pytest.mark.parametrize('phase, rc', [('activating', 3), ('deactivating', 3), ('query failed', 1)])
def test_reproduction_unit_not_active_is_not_proof_of_absence(tmp_path, monkeypatch, phase, rc):
    from types import SimpleNamespace
    from test_support import system_host as sh
    run = tmp_path / 'r289-transition'
    h, pre = stopped_host(run)
    unit = 'native-sim-r289-transition'
    state = {'test_unit_intent': unit, 'test_unit_wd': str(run/'config'), 'test_ini': str(run/'config/test.ini'),
             'tree': str(run/'tree'), 'tree_of': '/source'}
    nr.write_json(run/'state.json', state)
    # Real new unit_if_exists + its real is_active, only systemctl replaced.
    # A loaded unit with a live process remains present during these phases.
    h.run_test_unit(unit, state['test_unit_wd'], state['test_ini'])
    actual = sh.SystemHost(pre)
    def fake_run(argv, **kw):
        assert argv[:4] == ['systemctl', '--user', 'is-active', '-q'], argv
        assert argv[-1] == unit
        return SimpleNamespace(returncode=rc, stdout='', stderr='')
    monkeypatch.setattr(sh.subprocess, 'run', fake_run)
    monkeypatch.setattr(h, 'unit_if_exists', actual.unit_if_exists)
    # Give unit() its factual properties if the implementation asks for them.
    monkeypatch.setattr(actual, 'unit', h.unit)
    h.ready = False
    restore_cli(run, h, 'out.json')
    out = json.loads((run/'out.json').read_text())
    assert h.test_instance is not None
    assert h.active[unit]
    assert h.removed == [state['tree']]
    assert h.started == ['lcnc-sim-gates', 'bg-keepalive']
    RESULTS.append({'case': 'FI-I19 non-active interpreted as nonexistent', 'phase': phase,
                    'is_active_returncode': rc, 'live_process': h.test_instance, 'removed': h.removed,
                    'lan_starts': h.started, 'restore': out})


@pytest.mark.parametrize('sign', [1, -1])
def test_reproduction_observed_reversal_is_still_a_pass(sign):
    # The pre-reply travel is correct. The subsequent sampled track visibly
    # reverses, so absolute endpoint displacement is not an upper bound on path.
    p = lambda distance: 300 + sign * distance
    samples = [(.06, p(16.65), 5), (.20, p(14.5), 0)]
    out = nc.eval_jog('reversal', 0, sign, 300, (-.005, p(15)), samples)
    observed_path = abs(p(16.65)-p(15)) + abs(p(14.5)-p(16.65))
    assert observed_path > nc.brake_bound(0)
    assert out['status'] == 'PASS'
    assert out['brake_upper_mm'] == .5
    RESULTS.append({'case': 'FI-I23 observed reversal accepted', 'sign': sign,
                    'observed_path_from_before_mm': observed_path, 'out': out})


def test_reproduction_motion_after_first_zero_does_not_revoke_pass():
    samples = [(.01, 315.4, 0), (.20, 325, 50), (.45, 337.5, 50), (.80, 355, 50)]
    out = nc.eval_jog('moving-again', 0, 1, 300, (-.005, 315), samples)
    assert out['status'] == 'PASS'
    RESULTS.append({'case': 'FI-I23 motion after first zero accepted', 'samples': samples, 'out': out})


def test_reproduction_kill_during_stop_loses_instance_before_deactivating_resume(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from test_support import system_host as sh
    run = tmp_path / 'r289-killed-stop'
    h, pre = stopped_host(run)
    unit = 'native-sim-r289-killed-stop'
    # Valid disk state just after start_copy saves InvocationID, before ready:
    state = {'test_unit_intent': unit, 'test_unit': unit, 'test_unit_invocation': 'inv-crash',
             'test_unit_wd': str(run/'config'), 'test_ini': str(run/'config/test.ini'),
             'tree': str(run/'tree'), 'tree_of': '/source'}
    nr.write_json(run/'state.json', state)
    h.run_test_unit(unit, state['test_unit_wd'], state['test_ini'])
    actual = sh.SystemHost(pre)
    phase = ['active']
    def fake_run(argv, **kw):
        if argv == ['systemctl', '--user', 'is-active', '-q', unit]:
            return SimpleNamespace(returncode=0 if phase[0]=='active' else 3, stdout='', stderr='')
        assert argv == ['systemctl','--user','show',unit,'-p','InvocationID','--value'], argv
        return SimpleNamespace(returncode=0, stdout='inv-crash\n', stderr='')
    monkeypatch.setattr(sh.subprocess, 'run', fake_run)
    monkeypatch.setattr(h, 'invocation', actual.invocation)
    stop = h.stop
    def stop_then_disappear(name):
        assert name == unit
        phase[0] = 'deactivating'  # the unit is terminating, its process has not exited
        raise Interrupted()
    monkeypatch.setattr(h, 'stop', stop_then_disappear)
    with pytest.raises(Interrupted):
        restore_cli(run, h, 'out-first.json')
    persisted = json.loads((run/'state.json').read_text())
    assert 'test_instance' not in persisted
    monkeypatch.setattr(h, 'stop', stop)
    h.ready = False
    restore_cli(run, h, 'out-second.json')
    out = json.loads((run/'out-second.json').read_text())
    assert h.test_instance == ('linuxcncsvr', 900, 9000)
    assert h.removed == [state['tree']]
    assert h.started == ['lcnc-sim-gates', 'bg-keepalive']
    RESULTS.append({'case': 'FI-I19 kill during stop and fresh CLI', 'state_at_kill': persisted,
                    'resume_phase': phase[0], 'live_process': h.test_instance,
                    'removed': h.removed, 'lan_starts': h.started, 'restore': out})
