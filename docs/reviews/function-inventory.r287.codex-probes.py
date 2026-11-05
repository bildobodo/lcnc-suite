"""R287 review: isolated regression checks and counterexamples.

No LinuxCNC/systemd/network access. FakeHost is the implementation's own
host double. Assertions for counterexamples intentionally describe the
current erroneous result; their PASS is reproduction, not acceptance.
"""
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path('/tmp/codex-r287')
sys.path.insert(0, str(ROOT/'scripts'))
import native_run as nr
import test_native_stage as existing
from test_support import restore_lan as rl, native_cases as nc, live_target as lt, heavy_lock as hl

OBS = {}

@pytest.fixture(autouse=True)
def own_lock(tmp_path, monkeypatch):
    monkeypatch.setattr(hl, 'LOCK', tmp_path/'heavy.lock')
    monkeypatch.setattr(rl, 'TEST_END_S', 0)

@pytest.fixture(scope='session', autouse=True)
def evidence():
    yield
    (ROOT/'r287-probes.json').write_text(json.dumps(OBS, indent=2)+'\n')

def test_normal_finally_then_execstoppost(tmp_path):
    h = existing.FakeHost()
    run = tmp_path/'run'
    def start_fake(ctx):
        h.active['native-sim'] = True
        h.test_instance = ('linuxcncsvr', 900, 9000)
        ctx['state'].update(test_unit='native-sim', tree=str(run/'tree'), tree_of='/archive')
        nr.save_state(ctx)
        return [{'case':'fake-success', 'status':'PASS'}]
    report = nr.run(h, [('fake-start',start_fake)], run)
    assert report['restore']['outcome'] == 'complete'
    rc = rl.main(['--from',str(run/'pre.json'),'--out',str(run/'post.json')], host_factory=lambda _:h)
    second = json.loads((run/'post.json').read_text())
    assert rc == 1 and second['outcome'] == 'not_returned'
    assert 'still runs' in second['cleanup'][0]
    OBS['second_close_rejects_restored_LAN'] = {'first':report['restore'], 'second':second,
                                               'LAN_active':h.active['lcnc-sim-gates']}

def test_partial_restore_cannot_finish_keepalive(tmp_path):
    h = existing.FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h,pre)
    state = {'test_unit':'native-sim','tree':'/fake/tree','tree_of':'/fake/repo'}
    h.active['native-sim'] = True
    h.test_instance = ('linuxcncsvr',900,9000)
    h.fail_start.add('bg-keepalive')
    first = tmp_path/'restore.json'
    a = rl.restore(h,pre,state,first)
    assert a['outcome']=='not_returned' and h.active['lcnc-sim-gates']
    h.fail_start.clear()
    b = rl.restore(h,pre,state,first)
    assert b['outcome']=='not_returned' and not h.active['bg-keepalive']
    OBS['partial_restore'] = {'first':a,'second':b,'keepalive_active':h.active['bg-keepalive']}

def test_tree_is_removed_even_with_a_test_process_still_running():
    h=existing.FakeHost()
    pre=rl.record(h)
    rl.stop_lan(h,pre)
    h.test_instance=('linuxcncsvr',900,9000) # unit inactive, process still alive
    state={'test_unit':'native-sim','tree':'/fake/tree','tree_of':'/fake/repo'}
    out=rl.restore(h,pre,state)
    assert out['outcome']=='not_returned' and h.test_instance and h.removed==['/fake/tree']
    OBS['tree_removed_with_live_process']={'restore':out,'removed':h.removed}

def test_failed_unit_creation_stops_a_foreign_same_name(tmp_path, monkeypatch):
    class Host(existing.FakeHost):
        def __init__(self):
            super().__init__()
            self.stopped=[]
        def stop(self,n):
            self.stopped.append(n)
            super().stop(n)
    h=Host()
    pre=rl.record(h)
    rl.stop_lan(h,pre)
    h.active['native-sim']=True
    h.test_instance=('linuxcncsvr',777,7777) # not created by this run
    h.units['native-sim']={'ExecStart':['/foreign/tree/linuxcnc','foreign.ini']}
    ctx={'run':tmp_path,'ini':tmp_path/'test.ini','config':tmp_path,'path':'/usr/bin','state':{}}
    def command(args,**kwargs):
        if args[0]=='systemd-run':
            raise subprocess.CalledProcessError(1,args,stderr='Unit native-sim.service already exists')
        assert args[:3]==['systemctl','--user','reset-failed']
        return subprocess.CompletedProcess(args,0)
    monkeypatch.setattr(nr.subprocess,'run',command)
    with pytest.raises(subprocess.CalledProcessError):
        nr.start_copy()[1](ctx)
    result=rl.restore(h,pre,ctx['state'])
    assert 'native-sim' in h.stopped and h.test_instance is None
    OBS['foreign_unit_stopped_after_failed_creation']={'state':ctx['state'],'stopped':h.stopped,'restore':result}

def test_repeat_does_not_recheck_head_and_unit_spec(tmp_path):
    h=existing.FakeHost()
    pre=rl.record(h)
    rl.stop_lan(h,pre)
    first=tmp_path/'restore.json'
    a=rl.restore(h,pre,{},first)
    assert a['outcome']=='complete'
    h.head='another-code-revision'
    h.units['bg-keepalive']={'ExecStart':['/foreign/client'],'WorkingDirectory':'/foreign'}
    b=rl.restore(h,pre,{},first)
    assert b['outcome']=='complete'
    OBS['repeat_skips_proofs']={'second':b,'recorded_head':pre['head'],'current_head':h.head,
                               'current_keepalive':h.units['bg-keepalive']}

def test_tcp_socket_and_another_client_do_not_prove_a_keepalive_heartbeat(tmp_path, monkeypatch):
    from test_support import system_host as sh
    logs=tmp_path/'runlogs'; logs.mkdir()
    event={'tag':'loop.tick','pid':88,'clients':1,'t_wall_ns':2_000_000_000}
    (logs/'trace.ndjson').write_text(json.dumps(event)+'\n')
    def command(args,**kwargs):
        if args[0]=='systemctl':
            return subprocess.CompletedProcess(args,0,stdout='77\n')
        assert args[0]=='ss'
        return subprocess.CompletedProcess(args,0,stdout='0 0 127.0.0.1:12345 127.0.0.1:8000 users:(("python3",pid=77,fd=3))\n')
    monkeypatch.setattr(sh.subprocess,'run',command)
    monkeypatch.setattr(sh,'read_procs',lambda:[{'pid':88,'cmdline':['python3','gateway:app']}])
    host=sh.SystemHost({'tree':str(tmp_path)}) # constructor only; all external operations replaced above
    accepted=host.keepalive_connected_since(1)
    assert accepted
    OBS['keepalive_without_heartbeat']={'accepted':accepted,'gateway_event':event,
      'scenario':'PID 77 has TCP connected but sends no WS hello or heartbeat; the counted client is a different browser',
      'all_external_calls_stubbed':True}

def good_procs(tree,config):
    py='/usr/bin/python3'
    return [
      {'cmdline':['bash',str(tree/'lcnc-suite'),'-ini',str(config/'sim.ini')], 'exe':'/usr/bin/bash','cwd':str(config)},
      {'cmdline':['python3','-m','uvicorn','gateway:app','--app-dir',str(tree/'lcnc-gateway')],'exe':py,'cwd':str(tree)},
      *[{'cmdline':['python3',str(tree/rel)],'exe':py,'cwd':str(config)} for rel in lt.SUITE_HELPERS],
      {'cmdline':['python3',str(tree/'sim_toolsetter_feed.py')],'exe':py,'cwd':str(config)},
    ]

def test_unknown_interpreter_still_passes_process_proof(tmp_path):
    tree,config=tmp_path/'tree',tmp_path/'config'
    procs=good_procs(tree,config)
    for p in procs: p['exe']=None
    out=lt.process_problems(procs,tree,config/'sim.ini')
    assert out==[]
    OBS['unknown_interpreters_accepted']={'problems':out,'exe_values':[p['exe'] for p in procs]}

def test_jog_loses_the_first_90_ms_of_braking(monkeypatch):
    # A deliberately faulty deceleration: 50 mm/s -> 0 at 250 mm/s².
    # At reply p=315; first frame at 90 ms p=318.4875; rest at 200 ms p=320.
    # Actual brake = 5 mm > agreed 2.067 mm. Remaining brake from frame = 1.5125.
    now=[100.0]
    frames=[]
    class Client:
        error=None
        status={}
        def request(self,cmd,**kw):
            if cmd=='mdi': self.status={'joint_pos':list(nr.JOG_START),'inpos':True,'interp_state':1}
            if cmd=='jog_cont':
                self.sign=1 if kw['vel']>0 else -1
                self.status['joint_pos'][0]+=15*self.sign
    c=Client()
    def sleep(s):
        if s==1.0:
            p=c.status['joint_pos'][0]
            frames.extend([(now[0]+.09,{'joint_pos':[p+c.sign*3.4875,300,-50],'current_vel':27.5}),
                           (now[0]+.2,{'joint_pos':[p+c.sign*5,300,-50],'current_vel':0})])
        now[0]+=s
    with patch.object(nr.time,'monotonic',lambda:now[0]),patch.object(nr.time,'sleep',sleep):
        rows=nr.jog_cases(1)[1]({'client':c,'frames':frames})
    assert all(r['status']=='PASS' and r['brake_mm']==1.5125 for r in rows)
    OBS['braking_undercount']={'actual_brake_mm':5,'deceleration_mm_s2':250,'rows':rows}

def test_session_loss_after_last_jog_still_returns_pass():
    now=[100.0]; frames=[]
    class Client:
        error=None
        status={}
        jogs=0
        def request(self,cmd,**kw):
            if self.error: raise RuntimeError(self.error)
            if cmd=='mdi': self.status={'joint_pos':list(nr.JOG_START),'inpos':True,'interp_state':1}
            if cmd=='jog_cont':
                self.jogs+=1
                self.status['joint_pos'][0]+=15*(1 if kw['vel']>0 else -1)
    c=Client()
    def sleep(s):
        if s==1.0:
            frames.append((now[0]+.01,{'joint_pos':list(c.status['joint_pos']),'current_vel':0}))
            if c.jogs==2: c.error='Simulator WebSocket closed during the gate'
        now[0]+=s
    with patch.object(nr.time,'monotonic',lambda:now[0]),patch.object(nr.time,'sleep',sleep):
        rows=nr.jog_cases(1)[1]({'client':c,'frames':frames})
    assert all(r['status']=='PASS' for r in rows) and c.error
    OBS['lost_session_after_last_jog']={'error':c.error,'rows':rows}

def test_prior_installer_and_hardlink_countercases_closed(tmp_path,monkeypatch):
    import install_examples as installer
    monkeypatch.setattr(installer,'assert_stopped',lambda:None)
    monkeypatch.setattr(installer.Path,'home',lambda:tmp_path/'home')
    run=tmp_path/'run'; cfg=run/'configs/sim'; cfg.mkdir(parents=True)
    outside=tmp_path/'operator-sentinel'; outside.write_text('unchanged\n')
    (cfg/'lcnc_suite_sim_3axis_xyz.ini.install-tmp').symlink_to(outside)
    installer.install(ROOT,cfg,run/'backup',nc_files='nc_files',macro_dir='macros',confine=run)
    assert outside.read_text()=='unchanged\n'
    tree=run/'tree'; (tree/'lcnc-gateway').mkdir(parents=True)
    variable=cfg/'xyz3/sim.var'; variable.unlink(); variable.hardlink_to(outside)
    issues=lt.confinement_problems(cfg/'lcnc_suite_sim_3axis_xyz.ini',run,tree)
    assert any('PARAMETER_FILE' in s and 'inode' in s for s in issues)
    OBS['FI_I20_regressions_closed']={'outside_unchanged':True,'hardlink_issues':issues}

def test_prior_home_timeout_flow_is_now_fail(monkeypatch):
    class Client:
        error=None
        status={}
        def request(self,cmd,**kw):
            self.status={'homed_joints':([False]*3 if cmd=='unhome_all' else
              [True]*3 if cmd=='home_all' else [i==kw['joint'] for i in range(3)]),'inpos':False}
    c=Client()
    def wait(client,pred,timeout,what):
        if what.startswith('home-'): raise RuntimeError('no completion')
        if what=='homed for the jogs': client.status['inpos']=True
        assert pred(client.status)
        return dict(client.status)
    monkeypatch.setattr(nr,'_wait',wait)
    rows=nr.home_cases(3)[1]({'client':c})
    assert len(rows)==4 and all(r['status']=='FAIL' for r in rows)
    OBS['FI_I22_regression_closed']=rows
