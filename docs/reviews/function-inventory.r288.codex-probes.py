"""R288 isolated probes. Reproductions assert current faults, not acceptance.
Run from an archive of b4caee79. Never invokes systemd, LinuxCNC or sockets.
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
    monkeypatch.setattr(hl, 'LOCK', tmp_path / 'r288-heavy.lock')


def stopped_host(run):
    run.mkdir()
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    nr.write_json(run / 'pre.json', pre)
    return h, pre


def restore_cli(run, h, name):
    return rl.main(['--from', str(run / 'pre.json'), '--out', str(run / name)], host_factory=lambda pre: h)


def test_reproduction_creation_ack_gap_removes_tree_while_own_unit_runs(tmp_path, monkeypatch):
    run = tmp_path / 'r288-start-gap'
    h, pre = stopped_host(run)
    tree = run / 'tree'
    state = {'tree': str(tree), 'tree_of': '/source'}
    nr.write_json(run / 'state.json', state)
    ctx = {'run': run, 'ini': run / 'config/sim.ini', 'config': run / 'config',
           'path': '/usr/bin', 'tree': tree, 'state': state}
    def start_then_disappear(argv, **kwargs):
        assert argv[0] == 'systemd-run'
        unit = next(x.removeprefix('--unit=') for x in argv if x.startswith('--unit='))
        h.active[unit] = True
        h.invocations[unit] = 'our-new-invocation'
        h.test_instance = ('linuxcncsvr', 777, 9000)
        raise Interrupted()
    monkeypatch.setattr(nr.subprocess, 'run', start_then_disappear)
    with pytest.raises(Interrupted):
        nr.start_copy()[1](ctx)
    persisted = json.loads((run / 'state.json').read_text())
    assert 'test_unit_intent' in persisted and 'test_unit' not in persisted
    h.ready = False  # the old LAN unit cannot take the VM's occupied instance
    restore_cli(run, h, 'out.json')
    out = json.loads((run / 'out.json').read_text())
    assert h.test_instance == ('linuxcncsvr', 777, 9000)
    assert h.active[persisted['test_unit_intent']]
    assert str(tree) in h.removed
    assert 'lcnc-sim-gates' in h.started
    RESULTS.append({'case': 'FI-I19 creation acknowledgment gap', 'disk_before_restore': persisted,
                    'own_test_still_running': True, 'tree_removed': True, 'lan_start_attempted': True,
                    'restore': out})


def test_reproduction_restore_phase_not_persisted_before_lan_start(tmp_path, monkeypatch):
    run = tmp_path / 'r288-return-gap'
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
    assert disk_at_effect == [{}]
    assert not (run / 'restore.json').exists()
    monkeypatch.setattr(h, 'start', start)
    assert restore_cli(run, h, 'out-second.json') == 0
    second = json.loads((run / 'out-second.json').read_text())
    assert second['outcome'] == 'complete'
    assert second['isolation'] is None
    assert nr.verdict({'rows': [{'status': 'PASS'}], 'restore': second}) != 'PASS'
    RESULTS.append({'case': 'FI-I19 restore phase durability', 'disk_at_lan_start': disk_at_effect[0],
                    'resume': second, 'run_pass': False})


def keeper_function(beat, frames):
    # Only the function AST is executed; imports and connect()/infinite heartbeat loop are NEVER run.
    source = (ROOT / 'r288-keepalive-source.py').read_text()
    module = ast.parse(source)
    fn = next(n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == 'drain')
    scope = {'ws': iter(frames), 'BEAT': beat, 'PORT': 54321, 'json': json, 'os': os, 'time': time}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), 'keeper-drain-only', 'exec'), scope)
    scope['drain']()


def test_reproduction_binary_pongs_leave_no_keepalive_proof(tmp_path):
    beat = tmp_path / 'keeper.beat.json'
    keeper_function(beat, [msgspec.msgpack.encode({'type': 'pong'})] * 3)
    assert not beat.exists()
    RESULTS.append({'case': 'FI-I21 default MessagePack pongs', 'received_pongs': 3, 'beat_exists': False})


def test_positive_text_pongs_write_keepalive_proof(tmp_path):
    beat = tmp_path / 'keeper.beat.json'
    keeper_function(beat, [json.dumps({'type': 'pong'})] * 3)
    assert json.loads(beat.read_text())['pongs'] == 3
    RESULTS.append({'case': 'keeper JSON control', 'pongs': 3})


@pytest.mark.parametrize('sign', [1, -1])
def test_reproduction_delayed_pre_reply_status_is_not_a_post_reply_position(sign):
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
    assert out['status'] == 'FAIL'
    assert out['brake_lower_mm'] > nc.brake_bound(0)
    RESULTS.append({'case': 'FI-I23 receipt is not sample time', 'sign': sign,
                    'actual_brake_from_reply_mm': actual, 'true_limit_mm': nc.brake_bound(0),
                    'post_receipt_sample_source_time_s': -.033, 'out': out})


@pytest.mark.parametrize('sign', [1, -1])
def test_positive_r287_five_mm_brake_is_no_longer_pass(sign):
    out = nc.eval_jog('r287', 0, sign, 300, (-.001, 300 + sign*15),
                      [(.09, 300 + sign*18.4875, 27.5), (.2, 300 + sign*20, 0)])
    assert out['status'] == 'incomplete'
    RESULTS.append({'case': 'R287 analytic brake closed', 'sign': sign, 'out': out})


def test_positive_repeat_proves_current_head_and_command(tmp_path):
    run = tmp_path / 'r288-repeat'
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
    (ROOT / 'r288-probes.json').write_text(json.dumps(RESULTS, indent=2) + '\n')
