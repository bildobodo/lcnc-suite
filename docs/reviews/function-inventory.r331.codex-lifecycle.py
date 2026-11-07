#!/usr/bin/env python3
"""R331: isolated lifecycle probes. No systemd, network, machine or live files.
Usage: python3 this.py /tmp/own-archive
The two child processes exist solely for a private heavy.lock demonstration.
"""
from pathlib import Path
import sys, os, json, tempfile, subprocess, time, select
from unittest.mock import patch
ROOT=Path(sys.argv[1]).resolve()
sys.path[:0]=[str(ROOT/'scripts'),str(ROOT/'scripts/test_select')]
import install_probe as ip
from test_support import install_cases as ic,restore_lan as rl,heavy_lock as hl
import round_gate as rg
out=[]
with tempfile.TemporaryDirectory(prefix='r331-cases-') as tmp:
    d=Path(tmp)
    # Clone create -> state publication: interrupt immediately before the
    # second durable write, after mkdir but before tree_id is on disk.
    run=d/'partial';run.mkdir()
    ctx={'run':run,'state':{},'report':{}}
    real_save=ip.save_state
    def die_before_identity(c):
        if 'tree_id' in c['state']:
            raise SystemExit('interrupted before durable tree_id')
        real_save(c)
    try:
        with patch.object(ip,'save_state',die_before_identity):
            ip.clone('anything')[1](ctx)
    except SystemExit as e:
        interrupted=str(e)
    state=json.loads((run/'state.json').read_text())
    cleanup=rl.end_test_resources(ic.InstallProbeHost(run=run),state)
    out.append({'case':'clone_made_before_identity_published','interrupted':interrupted,
                'persisted_state':state,'folder_exists':(run/'src').is_dir(),
                'cleanup':cleanup,'test_ended':state.get('test_ended')})

    # Contrast: the published identity makes the previous early-clone case pass.
    real_save(ctx)
    state=json.loads((run/'state.json').read_text())
    cleanup=rl.end_test_resources(ic.InstallProbeHost(run=run),state)
    out.append({'case':'clone_identity_published','cleanup':cleanup,
                'test_ended':state.get('test_ended'),'folder_exists':(run/'src').exists()})

    # Record whether the actual status-read subprocess has a finite timeout.
    read_calls=[]
    def read(cmd,**kw):
        read_calls.append({'cmd':cmd,'timeout':kw.get('timeout')})
        return subprocess.CompletedProcess(cmd,0,'LoadState=loaded\nActiveState=active\nExecMainStatus=0','')
    with patch.object(rg.subprocess,'run',read):
        rg._unit_state('own-unit-name-never-sent-to-systemd')
    out.append({'case':'unit_read_timeout_argument','calls':read_calls})

    # A parent-gate death no longer loses the probe's lock. But stopping the
    # probe itself releases that lock before ExecStopPost starts. A gate
    # already waiting can enter, so the restore's finite wait can expire.
    env={**os.environ,'PYTHONPATH':str(ROOT/'scripts'),'LCNC_HEAVY_LOCK':str(d/'heavy.lock')}
    probe_code='''
from pathlib import Path
import subprocess,time
from unittest.mock import patch
import install_probe as ip

def run(host,steps,path):
    print("PROBE_LOCKED",flush=True)
    while True: time.sleep(1)
with patch.object(ip,"in_probe_unit",lambda:True), patch.object(ip,"run",run), patch.object(ip.subprocess,"run",lambda *a,**k:subprocess.CompletedProcess(a,0,"7270888c\\n","")):
    ip.main(["--run-dir", "NEVER_CREATED", "--commit", "7270888c"])
'''
    gate_code='''
import time
from test_support.heavy_lock import heavy_lock
with heavy_lock("own waiting gate"):
    print("SECOND_GATE_LOCKED",flush=True)
    time.sleep(15)
'''
    children=[]
    def get_until(p,wanted):
        end=time.monotonic()+5
        while time.monotonic()<end:
            ready,_,_=select.select([p.stdout],[],[],.1)
            if ready:
                line=p.stdout.readline().strip()
                if wanted in line:return line
                if not line:raise RuntimeError(p.stderr.read())
        raise RuntimeError('timed out waiting for '+wanted)
    try:
        probe=subprocess.Popen([sys.executable,'-B','-c',probe_code],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        children.append(probe);get_until(probe,'PROBE_LOCKED')
        gate=subprocess.Popen([sys.executable,'-B','-c',gate_code],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        children.append(gate);get_until(gate,'waiting for the heavy lock')
        probe.terminate();probe.wait(timeout=5)
        acquired=get_until(gate,'SECOND_GATE_LOCKED')
        pre=d/'pre.json';pre.write_text(json.dumps({'units':{},'ini':None,'head':None,'tree':None,'instance':[],'hashes':{}}))
        restore_calls=[]; real_lock=hl.heavy_lock
        # Same production restore call, scaled wait and private lock only.
        def scaled_lock(who,wait=None,path=None):
            return real_lock(who,wait=.03,path=d/'heavy.lock')
        try:
            with patch.object(hl,'heavy_lock',scaled_lock), patch.object(rl,'restore',lambda *a,**k:restore_calls.append(1) or {'outcome':'complete'}):
                rl.main(['--from',str(pre),'--out',str(d/'post.json')],host_factory=lambda p:object())
        except TimeoutError as e:
            restore_error=str(e)
        else:restore_error=None
        out.append({'case':'probe_stop_before_exec_stop_post_lock','probe_exit':probe.returncode,
                    'second_gate':acquired,'restore_error':restore_error,'restore_calls':restore_calls,
                    'production_wait_s':600,'scaled_wait_s':.03})
    finally:
        for p in children:
            if p.poll() is None:p.terminate()
            p.wait(timeout=5)
print(json.dumps(out,indent=2))
