"""R291 isolated probes. Positive reruns plus focused boundary checks; no live access.
Run from an archive of a249b7c8. Never invokes systemd, LinuxCNC or sockets.
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
    monkeypatch.setattr(hl, 'LOCK', tmp_path / 'r291-heavy.lock')


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
    run = tmp_path / 'r291-start-gap'
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
    run = tmp_path / 'r291-return-gap'
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
    source = (ROOT / 'r291-keepalive-source.py').read_text()
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
    assert out['first_after_mm'] > nc.brake_bound(0)
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
    run = tmp_path / 'r291-repeat'
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
    (ROOT / 'r291-probes.json').write_text(json.dumps(RESULTS, indent=2) + '\n')




def actual_unit_reader(tmp_path, monkeypatch, h, unit):
    """Real SystemHost.unit_status, fake systemctl + real temp cgroup files.
    The special cgroup Path only is redirected; no /proc or live service read.
    """
    from types import SimpleNamespace
    from test_support import system_host as sh
    import subprocess
    cg = tmp_path / 'cgroup'
    cg.mkdir()
    (cg/'child').mkdir()
    (cg/'cgroup.procs').write_text('900\n')
    (cg/'child/cgroup.procs').write_text('901\n')
    controls = {'load': 'loaded', 'phase': 'active', 'error': False}
    def show(argv, **kw):
        assert argv[:4] == ['systemctl','--user','show',unit], argv
        if controls['error']:
            raise subprocess.CalledProcessError(1, argv, stderr='query failed')
        spec = h.units[unit]
        cmd = ' '.join(spec['ExecStart'])
        output = '\n'.join([
            'LoadState='+controls['load'], 'ActiveState='+controls['phase'], 'InvocationID=inv-crash',
            'ControlGroup=/r291-own.service', 'WorkingDirectory='+spec['WorkingDirectory'],
            'ExecStart={ path=/usr/bin/linuxcnc ; argv[]='+cmd+' ; }'])
        return SimpleNamespace(returncode=0, stdout=output, stderr='')
    monkeypatch.setattr(sh.subprocess,'run',show)
    monkeypatch.setattr(sh,'Path',lambda p: cg if str(p)=='/sys/fs/cgroup/r291-own.service' else Path(p))
    actual = sh.SystemHost()
    monkeypatch.setattr(h,'unit_status',actual.unit_status)
    return controls, cg


def prepare_owned(tmp_path):
    run = tmp_path/'r291-owned'
    h, pre = stopped_host(run)
    unit = 'native-sim-r291-owned'
    state = {'test_unit_intent':unit, 'test_unit':unit, 'test_unit_invocation':'inv-crash',
             'test_unit_wd':str(run/'config'), 'test_ini':str(run/'config/test.ini'),
             'tree':str(run/'tree'), 'tree_of':'/source'}
    h.run_test_unit(unit,state['test_unit_wd'],state['test_ini'])
    nr.write_json(run/'state.json',state)
    return run,h,unit,state


@pytest.mark.parametrize('phase', ['activating','deactivating','reloading','failed'])
def test_positive_actual_unit_reader_keeps_nonempty_transitions_closed(tmp_path,monkeypatch,phase):
    run,h,unit,state = prepare_owned(tmp_path)
    controls,cg = actual_unit_reader(tmp_path,monkeypatch,h,unit)
    controls['phase'] = phase
    assert sorted(h.unit_status(unit)['pids']) == [900,901]
    monkeypatch.setattr(rl,'TEST_END_S',0)
    monkeypatch.setattr(h,'stop',lambda name: None)  # the unit's stop has not finished
    assert restore_cli(run,h,'out.json') == 1
    out=json.loads((run/'out.json').read_text())
    assert out['outcome']=='not_returned' and out['cleanup']
    assert h.removed==[] and h.started==[]
    RESULTS.append({'case':'R289 transitional/nonempty unit closed','phase':phase,'out':out})


def test_positive_actual_query_failure_blocks(tmp_path,monkeypatch):
    run,h,unit,state = prepare_owned(tmp_path)
    controls,cg = actual_unit_reader(tmp_path,monkeypatch,h,unit)
    controls['error']=True
    assert restore_cli(run,h,'out.json')==1
    out=json.loads((run/'out.json').read_text())
    assert any('not read' in x for x in out['cleanup'])
    assert h.removed==[] and h.started==[]
    RESULTS.append({'case':'R289 query failure closed','out':out})


def test_positive_kill_during_stop_then_new_cli_blocks_then_completes(tmp_path,monkeypatch):
    run,h,unit,state = prepare_owned(tmp_path)
    controls,cg = actual_unit_reader(tmp_path,monkeypatch,h,unit)
    def stop_then_disappear(name):
        assert name==unit
        controls['phase']='deactivating'
        raise Interrupted()
    monkeypatch.setattr(h,'stop',stop_then_disappear)
    with pytest.raises(Interrupted):
        restore_cli(run,h,'first.json')
    on_disk=json.loads((run/'state.json').read_text())
    assert on_disk['test_instance']==[900,9000]
    monkeypatch.setattr(h,'stop',lambda name: None)
    monkeypatch.setattr(rl,'TEST_END_S',0)
    assert restore_cli(run,h,'second.json')==1
    assert h.removed==[] and h.started==[]
    controls['phase']='inactive'
    (cg/'cgroup.procs').write_text('')
    (cg/'child/cgroup.procs').write_text('')
    h.test_instance=None
    h.active[unit]=False
    assert restore_cli(run,h,'third.json')==0
    assert h.removed==[state['tree']]
    assert restore_cli(run,h,'fourth.json')==0
    assert h.removed==[state['tree']]
    RESULTS.append({'case':'R289 kill during stop closed','on_disk_at_kill':on_disk,
                    'while_stopping':json.loads((run/'second.json').read_text()),
                    'after_end':json.loads((run/'third.json').read_text()),'tree_removals':len(h.removed)})


@pytest.mark.parametrize('sign',[1,-1])
def test_positive_r289_reverse_and_restart_are_rejected(sign):
    p=lambda x:300+sign*(x-300)
    reverse=nc.eval_jog('reverse',0,sign,300,(-.005,p(315)),[(.06,p(316.65),5),(.2,p(314.5),0)])
    restart=nc.eval_jog('restart',0,sign,300,(-.005,p(315)),[(.01,p(315.4),0),(.2,p(325),50),(.8,p(355),50)])
    assert reverse['status']=='FAIL' and restart['status']=='FAIL'
    RESULTS.append({'case':'R289 reverse and restart closed','sign':sign,'reverse':reverse,'restart':restart})


@pytest.mark.parametrize('sign',[1,-1])
@pytest.mark.parametrize('unknown',['speed','position'])
def test_positive_partial_frame_preserves_known_contradiction(sign,unknown):
    p=lambda d:300+sign*d
    bad=(.20,p(25),None) if unknown=='speed' else (.20,None,50)
    out=nc.eval_jog('partial-frame',0,sign,300,(-.005,p(15)),[(.01,p(15.4),0),bad,(.80,p(15.4),0)])
    assert out['status']=='FAIL'
    RESULTS.append({'case':'R290 partial frame rest closed','sign':sign,
                    'unknown':unknown,'discarded_sample':bad,'out':out})


@pytest.mark.parametrize('sign',[1,-1])
def test_positive_accumulated_backward_drift_fails(sign):
    p=lambda d:300+sign*d
    samples=[(.01,p(17.04),5)]+[(.01+.033*i,p(17.04-.009*i),5 if i<9 else 0) for i in range(1,10)]
    out=nc.eval_jog('backward-drift',0,sign,300,(-.005,p(15)),samples)
    assert out['status']=='FAIL'
    observed_path=2.04+.009*9
    assert observed_path>nc.brake_bound(0)
    RESULTS.append({'case':'R290 accumulated drift rest closed','sign':sign,
                    'step_mm':-.009,'steps':9,'total_reversal_mm':.081,
                    'observed_path_from_before_mm':observed_path,'out':out})


def test_positive_bounded_noise_and_clean_stop_pass():
    samples=[(.01,316.5,1),(.043,316.496,1),(.076,316.501,1),(.109,316.5,0),(.3,316.504,0)]
    out=nc.eval_jog('noise',0,1,300,(-.005,315),samples)
    assert out['status']=='PASS'
    assert 'brake_lower_mm' not in out
    RESULTS.append({'case':'bounded noise positive control','out':out})


@pytest.mark.parametrize('shown,wanted',[('!/home/cnc','-/home/cnc'),('/plain','/plain'),('','/')])
def test_positive_systemhost_start_converts_working_directory(tmp_path,monkeypatch,shown,wanted):
    from types import SimpleNamespace
    from test_support import system_host as sh
    calls=[]
    def fake_run(argv,**kw):
        calls.append(argv)
        return SimpleNamespace(returncode=0,stdout='',stderr='')
    monkeypatch.setattr(sh.subprocess,'run',fake_run)
    h=sh.SystemHost()
    monkeypatch.setattr(h,'is_active',lambda name: True)
    h.start('r291-readback',{'WorkingDirectory':shown,'ExecStart':['/py','keeper.py'],'Environment':[]})
    assert f'WorkingDirectory={wanted}' in calls[1]
    RESULTS.append({'case':'working directory start wiring','shown':shown,'passed':wanted,'command':calls[1]})


@pytest.mark.parametrize('sign',[1,-1])
def test_positive_upper_bound_uses_peak_even_when_final_point_would_fit(sign):
    p=lambda d:300+sign*d
    out=nc.eval_jog('peak',0,sign,300,(-.005,p(15)),[(.02,p(17.070),3),(.06,p(17.062),0)])
    assert out['status']=='incomplete'
    assert out['brake_upper_mm']==2.07
    RESULTS.append({'case':'upper bound by peak, not final position','sign':sign,'out':out})


@pytest.mark.parametrize('sign',[1,-1])
def test_positive_missing_position_before_stop_prevents_pass(sign):
    p=lambda d:300+sign*d
    out=nc.eval_jog('missing-position',0,sign,300,(-.005,p(15)),[(.03,float('nan'),30),(.1,p(16.5),0)])
    assert out['status']=='incomplete' and 'unknown' in out['detail']
    RESULTS.append({'case':'NaN position before stop is incomplete','sign':sign,'out':out})


@pytest.mark.parametrize('sign',[1,-1])
def test_positive_known_position_contradicts_stop_despite_nonfinite_velocity(sign):
    p=lambda d:300+sign*d
    out=nc.eval_jog('known-position',0,sign,300,(-.005,p(15)),
                    [(.01,p(15.4),0),(.20,p(25),float('inf')),(.80,p(15.4),0)])
    assert out['status']=='FAIL'
    assert 'after its standstill at +0.010 s' in out['detail'] and 'at +0.200 s' in out['detail']
    RESULTS.append({'case':'finite position survives infinite velocity; first contradiction named','sign':sign,'out':out})


@pytest.mark.parametrize('sign',[1,-1])
def test_positive_unknown_time_keeps_known_speed_contradiction(sign):
    p=lambda d:300+sign*d
    out=nc.eval_jog('known-speed',0,sign,300,(-.005,p(15)),[(.01,p(15.4),0),(float('nan'),None,50)])
    assert out['status']=='FAIL' and 'unknown time' in out['detail']
    RESULTS.append({'case':'finite speed survives unknown position and timestamp','sign':sign,'out':out})


def test_positive_no_samples_never_prove_standstill():
    out=nc.eval_jog('empty',0,1,300,(-.005,315),[])
    assert out['status']=='incomplete'
    RESULTS.append({'case':'empty sample set remains incomplete','out':out})
