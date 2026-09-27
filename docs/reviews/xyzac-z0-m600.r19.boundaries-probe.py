"""R19: extra boundary observations, real handlers/runtime with fake_linuxcnc.
No live access. Rejected program_open is an NML/task rejection: its Python
send returns normally while task.file stays unchanged (the R18 live result).
No product or older evidence is edited; all generated state lives in /tmp.
"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
scratch = tempfile.TemporaryDirectory(prefix='codex-r19-boundaries-')
os.environ['LCNC_LOG_DIR'] = scratch.name + '/logs'
sys.path.insert(0, str(ROOT/'lcnc-gateway'))
import test_command_dispatch as dispatch
from status_runtime import StatusRuntime
from gateway_util import read_load_record, program_source

g, lcnc = dispatch.gateway, dispatch.linuxcnc
out = {'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'cases':[]}

def add(name, **data):
    out['cases'].append({'name':name,**data})
    print(json.dumps(out['cases'][-1]), flush=True)

def runtime(record):
    return StatusRuntime(get_stat=lambda:None,get_err=lambda:None,reader_get=lambda _:None,
        get_tool_tbl_path=lambda:None,load_tool_library=lambda:{},get_fb_scale=lambda:1,
        get_instance=lambda:(123,456),load_record_path=str(record))

def rejected_open(initial_unconfirmed=False, different_path=False):
    h=dispatch.TestHandlerExecution(); h.setUp(); cmd=h._rcs()
    label='different_path' if different_path else 'same_path'
    if initial_unconfirmed: label += '_initially_unconfirmed'
    p=Path(scratch.name)/'A.ngc'; p.write_text('T5 M600\nG0 X10\nM2\n')
    target=Path(scratch.name)/'B.ngc' if different_path else p
    if different_path: target.write_text('T8 M600\nG0 X80\nM2\n')
    rec=Path(scratch.name)/(label+'.json')
    rt=runtime(rec)
    rt.program_tick(None,True,0)
    rt.program.request_load(str(p),.1); rt.program_tick(str(p),True,.2)
    if initial_unconfirmed:
        assert rt.begin_program_change()
        rt.program.abandon_change(); rt.end_program_change()
        rt.program_tick(str(p),True,.3)
        assert rt.program.loaded is None and rt.program.unconfirmed==str(p)
    g.STAT.file=str(p)
    errors_before=g._errors_total
    def refused(path):
        cmd.calls.append(('program_open',(path,),{}))
        # Task rejected the file: no change to STAT.file. The async NML
        # error channel reports an error, not a Python exception from send.
        g._errors_total += 1
    cmd.program_open=refused
    spawned=[]
    def capture(*args,**kwargs): spawned.append([args,kwargs])
    with patch.object(g,'_status_runtime',rt), \
         patch.object(g,'get_nc_files_dir',return_value=scratch.name), \
         patch.object(g._bulk,'preview_version',7), \
         patch.object(g._bulk,'published_source',program_source(p)), \
         patch.object(g,'_rfl_start',capture):
        reply=h._send({'cmd':'load_file','path':str(target)})
        pending_before=rt.program.change_pending
        record_before=read_load_record(rec,(123,456))
        now=time.monotonic()
        rt.program_tick(g.STAT.file,True,now)
        after_first={'loaded':rt.program.loaded,'unconfirmed':rt.program.unconfirmed,
            'pending':rt.program.change_pending,'record':read_load_record(rec,(123,456))}
        rt.program_tick(g.STAT.file,True,now+6)
        after_window={'loaded':rt.program.loaded,'unconfirmed':rt.program.unconfirmed,
            'pending':rt.program.change_pending,'record':read_load_record(rec,(123,456))}
        cmd.calls.clear()
        run=h._send({'cmd':'auto_run','line':2,'file':str(p),'version':7,
            'source':program_source(p),'safe_z':True})
        again=runtime(rec); restored=again.program_tick(g.STAT.file,True,0)
        add('rejected_open_'+label, load_reply=reply, task_rejected=True,
            reported_errors=g._errors_total-errors_before, requested=str(target), raw_file=g.STAT.file,
            pending_before_first_tick=pending_before, record_before_first_tick=record_before,
            after_first_tick=after_first, after_window=after_window,
            auto_run_reply=run, spawned=spawned, restored=restored,
            restart_unconfirmed=again.program.unconfirmed)
    h.doCleanups()

def start_guards():
    for name,msg in [('cycle_start',{'cmd':'cycle_start'}),
                     ('auto_step',{'cmd':'auto_step'}),
                     ('mdi',{'cmd':'mdi','text':'T5 M600'}),
                     ('tool_change',{'cmd':'tool_change','tool_number':5})]:
        for failed in (False, True):
            h=dispatch.TestHandlerExecution(); h.setUp(); cmd=h._rcs(rc=3 if failed else 1)
            g._skip_flag_unknown=True
            reply=h._send(msg)
            calls=[(n,a) for n,a,_ in cmd.calls if n in ('mdi','auto')]
            add('unknown_flag_'+name+('_clear_refused' if failed else '_clear_accepted'),
                reply=reply,calls=calls,unknown=g._skip_flag_unknown)
            assert calls[0]==('mdi',('#3116=0.000000',))
            if failed:
                assert not reply['ok'] and len(calls)==1 and g._skip_flag_unknown
            else:
                assert reply['ok'] and len(calls)>1 and not g._skip_flag_unknown
            h.doCleanups()

try:
    rejected_open()
    rejected_open(initial_unconfirmed=True)
    rejected_open(different_path=True)
    start_guards()
except BaseException as exc:
    out['harness_error']=repr(exc)
    raise
finally:
    Path(__file__).with_suffix('.json').write_text(json.dumps(out,indent=2)+'\n')
    scratch.cleanup()
