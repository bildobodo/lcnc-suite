"""R20: reload success, timeout and cancelled result; real gateway handler,
_cmd_blocking, program_tick and durable records with fake_linuxcnc. /tmp only.
No controller access. A missing reply is held for the real five-second wait.
"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
scratch = tempfile.TemporaryDirectory(prefix='codex-r20-open-')
os.environ['LCNC_LOG_DIR'] = scratch.name+'/logs'
sys.path.insert(0, str(ROOT/'lcnc-gateway'))
import test_command_dispatch as dispatch
from status_runtime import StatusRuntime
from gateway_util import read_load_record
g, lcnc = dispatch.gateway, dispatch.linuxcnc
out={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'cases':[]}

def runtime(path):
    return StatusRuntime(get_stat=lambda:None,get_err=lambda:None,reader_get=lambda _:None,
        get_tool_tbl_path=lambda:None,load_tool_library=lambda:{},get_fb_scale=lambda:1,
        get_instance=lambda:(123,456),load_record_path=str(path))

def state(rt, rec):
    return dict(loaded=rt.program.loaded,unconfirmed=rt.program.unconfirmed,
                pending=rt.program.change_pending,record=read_load_record(rec,(123,456)))

async def run(name, mode, initially_unconfirmed=False):
    h=dispatch.TestHandlerExecution();h.setUp();cmd=h._rcs()
    g._cmd_lock=None;g._shared_status=dispatch._payload()
    a=str(Path(scratch.name)/(name+'.ngc'));Path(a).write_text('G0 X10\nM2\n')
    rec=Path(scratch.name)/(name+'.json');rt=runtime(rec)
    rt.program_tick(None,True,0);rt.program.request_load(a,.1);rt.program_tick(a,True,.2)
    if initially_unconfirmed:
        assert rt.begin_program_change()
        rt.program.abandon_change();rt.end_program_change();rt.program_tick(a,True,.3)
    g.STAT.file=a
    entered,release=threading.Event(),threading.Event()
    def opening(path):
        cmd.calls.append(('program_open',(path,),{}));entered.set()
        if mode=='cancel' and not release.wait(3):raise RuntimeError('probe release missing')
    def reply(timeout):
        if mode=='timeout' and entered.is_set():
            time.sleep(timeout)
            return -1
        return 1
    cmd.program_open=opening;cmd.wait_complete=reply
    task=None
    try:
        with patch.object(g,'_status_runtime',rt),patch.object(g,'get_nc_files_dir',return_value=scratch.name):
            started=time.monotonic()
            task=asyncio.create_task(g.handle_command({'cmd':'load_file','path':a},True))
            interim=None
            if mode in ('timeout','cancel'):
                for _ in range(300):
                    if entered.is_set():break
                    await asyncio.sleep(.005)
                assert entered.is_set()
                rt.program_tick(a,True,time.monotonic())
                interim=state(rt,rec)
                assert interim['pending'] and interim['record']=='unsettled'
            if mode=='cancel':
                task.cancel();await asyncio.sleep(0);release.set()
            try:result=await task
            except asyncio.CancelledError:result={'cancelled':True}
            elapsed=time.monotonic()-started
            rt.program_tick(a,True,time.monotonic())
            after=state(rt,rec)
            rt.program_tick(a,True,time.monotonic()+6)
            expired=state(rt,rec)
            again=runtime(rec);restored=again.program_tick(a,True,0)
            if mode=='done':
                assert result['ok'] and after['loaded']==a and not after['pending']
                assert after['unconfirmed'] is None and after['record']==(a,) and restored==a
            else:
                assert expired['loaded'] is None and expired['unconfirmed']==a
                assert expired['pending'] and expired['record']=='unsettled'
                assert restored is None and again.program.unconfirmed==a
            row=dict(name=name,mode=mode,initially_unconfirmed=initially_unconfirmed,
                     reply=result,elapsed_seconds=round(elapsed,3),during_open=interim,
                     after_handler=after,after_window=expired,restored=restored,
                     restart_unconfirmed=again.program.unconfirmed,cmd_calls=cmd.calls)
            out['cases'].append(row);print(json.dumps(row),flush=True)
    finally:
        release.set()
        if task is not None:
            if not task.done():task.cancel()
            await asyncio.gather(task,return_exceptions=True)
        h.doCleanups();g._cmd_lock=None

try:
    for args in [('confirmed_same_path','done',False),('recover_unconfirmed_same_path','done',True),
                 ('same_path_no_result','timeout',False),('same_path_cancelled_result','cancel',False)]:
        asyncio.run(run(*args))
except BaseException as exc:
    out['harness_error']=repr(exc)
    raise
finally:
    Path(__file__).with_suffix('.json').write_text(json.dumps(out,indent=2)+'\n')
    scratch.cleanup()
