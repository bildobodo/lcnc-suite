"""R17: real gateway handlers/sequence with fake_linuxcnc; only /tmp files.
Run with lcnc-gateway/.venv/bin/python. No live LinuxCNC access or commands.
The exact calls and states are observations, not assertions that bugs are desired.
"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
scratch = tempfile.TemporaryDirectory(prefix='codex-r17-gateway-')
os.environ['LCNC_LOG_DIR'] = scratch.name + '/logs'
sys.path.insert(0,str(ROOT/'lcnc-gateway'))
import test_command_dispatch as dispatch
import test_rfl_guard as rfl
from status_runtime import StatusRuntime
import status_runtime
from gateway_util import LoadedProgram, read_load_record
gateway, lcnc = dispatch.gateway, dispatch.linuxcnc
result={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'cases':[]}

def add(name, **data):
    row={'name':name,**data};result['cases'].append(row);print(json.dumps(row))

def stale_published_text():
    h=dispatch.TestHandlerExecution();h.setUp();cmd=h._rcs()
    p=Path(scratch.name)/'same-path.ngc'
    a='(program A)\nT5 M600\nG0 X10 Y20\nG1 X11\nM2\n'
    b='(program B)\nT8 M600\nG0 X80 Y90\nG1 X81\nM2\n'
    p.write_text(a); old_stamp=p.stat()
    program=LoadedProgram();program.update(None,True,0)
    program.request_load(str(p),0);program.update(str(p),True,.1)
    # An external edit between publication and dispatch, before republishing.
    p.write_text(b)
    os.utime(p,ns=(old_stamp.st_atime_ns,old_stamp.st_mtime_ns+1_000_000_000))
    spawned=[]
    async def capture(*args,**kwargs): spawned.append({'args':args,'kwargs':kwargs})
    msg={'cmd':'auto_run','line':4,'file':str(p),'version':7,
         'pre_tool':5,'probe_vars':{'3100':0,'3102':-300},'entry_x':10,'entry_y':20}
    with patch.object(gateway._status_runtime,'program',program), \
         patch.object(gateway._bulk,'preview_version',7), \
         patch.object(gateway._bulk,'preview_pending',{'file':str(p)}), \
         patch.object(gateway._bulk,'last_file',str(p)), \
         patch.object(gateway._bulk,'last_mtime',old_stamp.st_mtime), \
         patch.object(gateway,'_rfl_sequence',capture):
        gateway._rfl_active=False
        reply=h._send(msg)
        add('file_changed_since_publication_before_dispatch',confirmed_text=a,current_text=b,
            published_version=7,published_mtime=old_stamp.st_mtime,current_mtime=p.stat().st_mtime,
            command=msg,reply=reply,cmd_calls=cmd.calls,spawned=spawned)
        gateway._rfl_active=False
    h.doCleanups()

async def double_abort_cleanup():
    h=rfl._SeqHarness();h.setUp()
    gateway.STAT.tool_in_spindle=5;gateway.STAT.tool_offset=(0,0,45.7,0,0,0,0,0,0)
    gateway.STAT.position=(0,0,-100)
    reached_move,reached_cleanup=asyncio.Event(),asyncio.Event()
    hold=asyncio.Event()
    calls=[]
    async def step(text,timeout_s):
        calls.append(text)
        if text=='G53 G0 Z0': reached_move.set();await hold.wait()
        if text=='#3116=0': reached_cleanup.set();await hold.wait()
        return True,''
    gateway._rfl_mdi_step=step
    task=asyncio.create_task(gateway._rfl_sequence(4,5,True,None,0))
    gateway._rfl_task=task
    try:
        await asyncio.wait_for(reached_move.wait(),2)
        gateway._preempt_inflight('abort',99)
        await asyncio.wait_for(reached_cleanup.wait(),2)
        gateway._preempt_inflight('abort',99)
        try: await task
        except asyncio.CancelledError: pass
        add('second_abort_during_flag_cleanup',mdi_calls=calls,task_done=task.done(),
            task_cancelled=task.cancelled(),rfl_active=gateway._rfl_active,
            task_reference_retained=gateway._rfl_task is task,status=gateway._rfl_status,
            auto_run_calls=h.auto_run_calls)
    finally:
        hold.set()
        if not task.done(): task.cancel()
        await asyncio.gather(task,return_exceptions=True)
        gateway._rfl_task=None
        h.tearDown()

async def abort_before_first_task_step():
    h=rfl._SeqHarness();h.setUp()
    gateway._rfl_phase('queued')
    task=asyncio.create_task(gateway._rfl_sequence(4,5,True,None,0))
    gateway._rfl_task=task
    # Same turn as scheduling: the background coroutine has not entered try/finally.
    gateway._preempt_inflight('abort',99)
    try:
        await task
    except asyncio.CancelledError:
        pass
    add('abort_before_background_task_starts',task_done=task.done(),task_cancelled=task.cancelled(),
        rfl_active=gateway._rfl_active,task_reference_retained=gateway._rfl_task is task,
        status=gateway._rfl_status,mdi_calls=h.mdi_calls,auto_run_calls=h.auto_run_calls)
    gateway._rfl_task=None
    h.tearDown()

def load_record_before_observation():
    path=str(Path(scratch.name)/'record.json');instance=(321,654)
    def runtime():
        return StatusRuntime(get_stat=lambda:None,get_err=lambda:None,reader_get=lambda _k:None,
            get_tool_tbl_path=lambda:None,load_tool_library=lambda:{},get_fb_scale=lambda:1,
            get_instance=lambda:instance,load_record_path=path)
    a,b=[str(Path(scratch.name)/n) for n in ('record-A.ngc','record-B.ngc')]
    Path(a).write_text('G0 X10\nM2\n');Path(b).write_text('G0 X80\nM2\n')
    rt=runtime();rt.program_tick(None,True,0)
    rt.program.request_load(a,.1);rt.program_tick(a,True,.2)
    h=dispatch.TestHandlerExecution();h.setUp();cmd=h._rcs();gateway.STAT.file=a
    def program_open(p):
        cmd.calls.append(('program_open',(p,),{}));gateway.STAT.file=p
    cmd.program_open=program_open
    # REAL load_file handler + fake NML side effect. A restart before the next
    # program_tick observes B leaves the old persisted record untouched.
    with patch.object(gateway,'_status_runtime',rt), \
         patch.object(gateway,'get_nc_files_dir',return_value=scratch.name):
        reply=h._send({'cmd':'load_file','path':b})
    record=read_load_record(path,instance)
    restarted=runtime();active=restarted.program_tick(gateway.STAT.file,True,.4)
    add('restart_after_program_open_before_observation',record_before_restart=record,
        load_reply=reply,cmd_calls=cmd.calls,actual_loaded=gateway.STAT.file,
        restored_active=active,unconfirmed=restarted.program.unconfirmed)
    # Positive control: no new load, MDI visits a subroutine, same instance.
    control=runtime();active=control.program_tick('/nc/sub.ngc',False,.5)
    add('restart_during_subroutine_with_valid_record',restored_active=active,
        unconfirmed=control.program.unconfirmed)
    with patch.object(status_runtime,'write_load_record',side_effect=OSError('injected write failure')):
        rt.program_tick(b,True,1)
    before=read_load_record(path,instance)
    after=runtime();restored=after.program_tick(b,True,1.1)
    add('restart_after_load_record_write_failure',active_before_restart=rt.program.loaded,
        stale_record=before,restored_active=restored,unconfirmed=after.program.unconfirmed)
    h.doCleanups()

try:
    stale_published_text()
    asyncio.run(double_abort_cleanup())
    asyncio.run(abort_before_first_task_step())
    load_record_before_observation()
finally:
    Path(__file__).with_suffix('.json').write_text(json.dumps(result,indent=2)+'\n')
    scratch.cleanup()
