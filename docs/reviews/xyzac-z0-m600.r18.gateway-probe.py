"""R18 independent review observations. Only fake_linuxcnc and /tmp files.
Run with lcnc-gateway/.venv/bin/python. No live controller access.
Actual handlers, program_tick and sequence; injected NML/status boundaries
are explicitly identified. Prior review evidence and product code unchanged.
"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
scratch = tempfile.TemporaryDirectory(prefix='codex-r18-gateway-')
os.environ['LCNC_LOG_DIR'] = scratch.name + '/logs'
sys.path.insert(0, str(ROOT / 'lcnc-gateway'))
import test_command_dispatch as dispatch
import test_rfl_guard as rfl
import status_runtime
from status_runtime import StatusRuntime
from gateway_util import LoadedProgram, read_load_record, program_source, LOAD_WINDOW_S

gateway, lcnc = dispatch.gateway, dispatch.linuxcnc
result = {'head': subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip(), 'cases': []}

def add(name, **data):
    row = {'name': name, **data}
    result['cases'].append(row)
    print(json.dumps(row), flush=True)

def runtime(path):
    return StatusRuntime(get_stat=lambda: None, get_err=lambda: None, reader_get=lambda _: None,
        get_tool_tbl_path=lambda: None, load_tool_library=lambda: {}, get_fb_scale=lambda: 1,
        get_instance=lambda: (321, 654), load_record_path=str(path))

def seed(path, a):
    rt = runtime(path)
    rt.program_tick(None, True, 0)
    rt.program.request_load(a, .1)
    rt.program_tick(a, True, .2)
    return rt

def record(path):
    return read_load_record(str(path), (321, 654))

def text_binding():
    h = dispatch.TestHandlerExecution(); h.setUp(); cmd = h._rcs()
    p = Path(scratch.name) / 'same-path.ngc'
    a = '(program A)\nT5 M600\nG0 X10 Y20\nG1 X11\nM2\n'
    b = '(program B)\nT8 M600\nG0 X80 Y90\nG1 X81\nM2\n'
    p.write_text(a); stamp = p.stat(); source_a = program_source(p)
    prog = LoadedProgram(); prog.update(None, True, 0)
    prog.request_load(str(p), 0); prog.update(str(p), True, .1)
    spawned = []
    def capture(*args, **kwargs): spawned.append({'args': args, 'kwargs': kwargs})
    msg = {'cmd':'auto_run', 'line':4, 'file':str(p), 'version':7, 'source':source_a,
           'pre_tool':5, 'probe_vars':{'3100':0, '3102':-300}, 'entry_x':10, 'entry_y':20}
    with patch.object(gateway._status_runtime, 'program', prog), \
         patch.object(gateway._bulk, 'preview_version', 7), \
         patch.object(gateway._bulk, 'published_source', source_a), \
         patch.object(gateway._bulk, 'refresh_running', None), \
         patch.object(gateway._bulk, 'reparse_pending', False), \
         patch.object(gateway, '_rfl_start', capture):
        p.write_text(b); os.utime(p, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        reply = h._send(msg)
        add('changed_bytes_same_size_and_mtime', reply=reply, cmd_calls=cmd.calls[:], spawned=spawned[:],
            same_size=p.stat().st_size == stamp.st_size, same_mtime=p.stat().st_mtime_ns == stamp.st_mtime_ns,
            reparse_requested=gateway._bulk.reparse_pending)
        assert not reply['ok'] and not cmd.calls and not spawned and gateway._bulk.reparse_pending
        source_b = program_source(p)
        msg['source'] = source_b
        reply = h._send(msg)
        add('served_B_but_preview_still_A', reply=reply, cmd_calls=cmd.calls[:], spawned=spawned[:])
        assert not reply['ok'] and not cmd.calls and not spawned
        gateway._bulk.published_source = source_b
        msg.update(pre_tool=8, entry_x=80, entry_y=90)
        reply = h._send(msg)
        add('confirmed_and_published_B', reply=reply, cmd_calls=cmd.calls[:], spawned=spawned[:])
        assert reply['ok'] and len(spawned) == 1

def transaction_controls():
    path = Path(scratch.name) / 'record-controls.json'
    a, b = '/nc/A.ngc', '/nc/B.ngc'
    rt = seed(path, a)
    control = runtime(path)
    restored = control.program_tick('/nc/sub.ngc', False, 0)
    add('valid_record_restores_main_during_subroutine', restored=restored)
    assert restored == a
    assert rt.begin_program_change()
    rt.program.request_load(b, 1); rt.end_program_change()
    before = record(path)
    again = runtime(path)
    active = again.program_tick(b, True, 1.1)
    add('restart_before_observation', record=before, restored=active, unconfirmed=again.program.unconfirmed)
    assert active is None and again.program.unconfirmed == b
    # The restart is a separate hypothetical branch; restore the pending marker
    # before testing the original process's observation/write failure.
    assert rt.begin_program_change(); rt.end_program_change()
    with patch.object(status_runtime, 'write_load_record', side_effect=OSError('injected disk full')):
        rt.program_tick(b, True, 1.2)
    before = record(path)
    rt.program_tick(b, True, 1.3)
    add('failed_write_retried_on_next_tick', after_failure=before, after_retry=record(path))
    assert before == 'unsettled' and record(path) == (b,)
    # A delayed observation: nothing authorizes restoring A as the actual B.
    rt = seed(path, a)
    assert rt.begin_program_change(); rt.program.request_load(b, 10); rt.end_program_change()
    active = rt.program_tick(b, True, 10 + LOAD_WINDOW_S + .1)
    before = record(path)
    again = runtime(path); restored = again.program_tick(b, True, 20)
    add('observation_after_load_window', raw_file=b, active=active, record=before,
        restored=restored, unconfirmed=again.program.unconfirmed)

async def cancelled_real_load():
    """Real load_file and _cmd_blocking. Fake program_open has already
    changed STAT.file when the handler is cancelled (e.g. stop/disconnect).
    Shield-and-wait completes this NML call before CancelledError propagates.
    """
    h = dispatch.TestHandlerExecution(); h.setUp(); cmd = h._rcs()
    gateway._cmd_lock = None; gateway._shared_status = dispatch._payload()
    a, b = (str(Path(scratch.name) / n) for n in ('A.ngc','B.ngc'))
    Path(a).write_text('G0 X10\nM2\n'); Path(b).write_text('G0 X80\nM2\n')
    path = Path(scratch.name) / 'record-cancel.json'
    rt = seed(path, a); gateway.STAT.file = a
    entered, release = threading.Event(), threading.Event()
    def program_open(p):
        cmd.calls.append(('program_open', (p,), {}))
        gateway.STAT.file = p
        entered.set()
        if not release.wait(3): raise RuntimeError('probe release missing')
    cmd.program_open = program_open
    with patch.object(gateway, '_status_runtime', rt), \
         patch.object(gateway, 'get_nc_files_dir', return_value=scratch.name):
        task = asyncio.create_task(gateway.handle_command({'cmd':'load_file','path':b}, True))
        try:
            for _ in range(300):
                if entered.is_set(): break
                await asyncio.sleep(.005)
            assert entered.is_set()
            during = record(path)
            task.cancel(); await asyncio.sleep(0); release.set()
            try: await task
            except asyncio.CancelledError: pass
            rt.program_tick(gateway.STAT.file, True, 1)
            before = record(path)
            after = runtime(path); restored = after.program_tick(gateway.STAT.file, True, 1.1)
            add('cancel_after_program_open_sent_before_status_observation', cancelled=task.cancelled(),
                cmd_calls=cmd.calls, during=during, raw_file=gateway.STAT.file,
                active=rt.program.loaded, record_after_tick=before, restored=restored,
                unconfirmed=after.program.unconfirmed)
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
    gateway._cmd_lock = None

async def lifecycle(prestart=False, during_flag=False, double_abort=False, start_during_clear=False):
    h = rfl._SeqHarness(); h.setUp()
    gateway.STAT.tool_in_spindle = 5
    gateway.STAT.tool_offset = (0,0,45.7,0,0,0,0,0,0)
    gateway.STAT.position = (0,0,-100)
    reached, cleanup, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
    flag = 0; calls = []
    auto_calls = []
    gateway.CMD.auto = lambda *args: auto_calls.append(args)
    # Use the actual _rfl_mdi_step: NML assignment/send plus completion wait.
    gateway._rfl_mdi_step = h._orig['_rfl_mdi_step']
    def mdi(text):
        nonlocal flag
        calls.append(text)
        if text.startswith('#3116='): flag = int(text.split('=')[1])
    gateway.CMD.mdi = mdi
    async def blocking(fn, *args, **kwargs):
        fn(*args)
        return 0
    gateway._cmd_blocking = blocking
    async def completion(timeout_s):
        text = calls[-1]
        if text == '#3116=5' and during_flag:
            reached.set(); await release.wait()
        if text == 'G53 G0 Z0':
            reached.set(); await release.wait()
        if text == '#3116=0':
            cleanup.set(); await release.wait()
        return True, ''
    try:
        with patch.object(gateway, '_rfl_wait_interp_idle', completion):
            task = gateway._rfl_start(4, 5, True, None, 0)
            if not prestart: await asyncio.wait_for(reached.wait(), 2)
            gateway._preempt_inflight('abort', 99)
            await asyncio.gather(task, return_exceptions=True)
            if start_during_clear:
                # The move has stopped, interpreter idle; the cleanup is in
                # its 300 ms idle-stabilization window, with #3116 still set.
                before = {'busy':gateway._rfl_busy(), 'flag':flag,
                          'reason':gateway._rfl_busy_reason()}
                with patch.object(gateway, 'lcnc_connected', True), \
                     patch.object(gateway, '_shared_status', dispatch._payload()):
                    reply = await gateway.handle_command({'cmd':'cycle_start'}, True)
                add('cycle_start_during_flag_cleanup', before=before, reply=reply,
                    auto_calls=auto_calls, mdi_at_start=calls[:], flag_at_start=flag)
                release.set()
                await asyncio.wait_for(gateway._rfl_flag_task, 2)
            elif double_abort:
                await asyncio.wait_for(cleanup.wait(), 2)
                gateway._preempt_inflight('abort', 99)
                busy_while_clearing = gateway._rfl_busy()
                reason = gateway._rfl_busy_reason()
                release.set()
                await asyncio.wait_for(gateway._rfl_flag_task, 2)
                add('second_abort_during_clear', mdi=calls, flag=flag,
                    busy_while_clearing=busy_while_clearing, busy_reason=reason,
                    busy_after=gateway._rfl_busy(), phase=gateway._rfl_status)
                assert busy_while_clearing and not gateway._rfl_busy() and flag == 0
            else:
                await asyncio.sleep(.4)
                cycle = None
                if during_flag:
                    with patch.object(gateway, 'lcnc_connected', True), \
                         patch.object(gateway, '_shared_status', dispatch._payload()):
                        cycle = await gateway.handle_command({'cmd':'cycle_start'}, True)
                add('abort_during_flag_completion' if during_flag else 'abort_before_first_step',
                    mdi=calls, flag=flag, cleanup_scheduled=gateway._rfl_flag_task is not None,
                    busy_after=gateway._rfl_busy(), phase=gateway._rfl_status,
                    subsequent_cycle_start=cycle, auto_calls=auto_calls)
                if prestart: assert not calls and not gateway._rfl_busy()
    finally:
        release.set()
        for t in (gateway._rfl_task, gateway._rfl_flag_task):
            if t is not None: await asyncio.gather(t, return_exceptions=True)
        h.tearDown()

try:
    text_binding()
    transaction_controls()
    asyncio.run(cancelled_real_load())
    asyncio.run(lifecycle(prestart=True))
    asyncio.run(lifecycle(double_abort=True))
    asyncio.run(lifecycle(during_flag=True))
    asyncio.run(lifecycle(start_during_clear=True))
except BaseException as exc:
    result['harness_error'] = repr(exc)
    raise
finally:
    Path(__file__).with_suffix('.json').write_text(json.dumps(result, indent=2) + '\n')
    scratch.cleanup()
