"""R519 isolated counterguards, actual gateway code, fake NML only.
Run from an archived review head using pytest -p conftest. Expected red at 4ef4d9f1.
"""
import asyncio
from contextlib import contextmanager
from copy import deepcopy
import inspect
import json
from pathlib import Path
import tempfile
from unittest.mock import patch
import conftest  # host isolation before gateway
import test_coord_gateway as fixtures
import gateway
from coord_fixture import with_poller
from test_command_dispatch import _payload
import pytest

@contextmanager
def setup(kind=fixtures.TestStart):
    fx=kind(); fx.setUp()
    try: yield fx
    finally: fx.doCleanups()

def show(case, **values):
    print('R519 '+json.dumps({'case':case, **values},sort_keys=True,default=str))

@pytest.mark.parametrize('file_kind', ['absent','unchanged','partial','fresh-control'])
def test_wcs_readback_never_stamps_stale_cache(file_kind):
    with setup(fixtures.TestTouchoff) as fx, tempfile.TemporaryDirectory() as d:
        saved=deepcopy(gateway._wcs_cache)
        def restore():
            for i,row in enumerate(saved): gateway._wcs_cache[i]=row
        fx.addCleanup(restore)
        gateway._wcs_cache[0]['x']=3.0
        gateway._wcs_cache[0]['y']=4.0
        p=Path(d)/'linuxcnc.var'
        if file_kind in ('unchanged','fresh-control'):
            p.write_text(''.join(f'{5221+i} {3.0 if i==0 else 0.0}\n' for i in range(10)))
        elif file_kind=='partial':
            p.write_text('5222 0.0\n')  # required X absent; stale cache must not supply it
        if file_kind=='fresh-control':
            original_synch=fx.ctl.conn.cmd.task_plan_synch
            def synch():
                original_synch()
                replacement=p.with_suffix('.new')
                replacement.write_text(''.join(f'{5221+i} {7.0 if i==0 else 0.0}\n' for i in range(10)))
                replacement.replace(p)
            fx.ctl.conn.cmd.task_plan_synch=synch
        old_answer=fx.ctl._answer
        def answer(line):
            if line.startswith('G10 L2 P1 X7'):
                fx.ctl.interp.update(origin_offset_x=7.0,current_x=3.0)
                fx.ctl.interp['params[5221]']=7.0
                fx.ctl.conn.stat.g5x_offset=(7.0,)+(0.0,)*8
            old_answer(line)
        fx.ctl._answer=answer
        stamps=[]
        async def stamp(*args,**kw): stamps.append((args,kw)); return {}
        gateway._shared_status=_payload(g5x_index=1,task_mode=gateway.linuxcnc.MODE_MDI)
        async def send(): return await gateway.handle_command({'cmd':'set_wcs','target':'G54','x':7},True)
        with patch.object(gateway._status_runtime,'resolve_var_file_path',lambda:str(p)), patch.object(gateway,'_stamp_wcs_provenance',stamp):
            reply=fixtures._run(with_poller(fx.ctl,send()))
        show('wcs-'+file_kind,ok=reply['ok'],cache_x=gateway._wcs_cache[0]['x'],
             interpreter_x=fx.ctl.interp['params[5221]'],stamps=stamps,read=gateway._coord_last,
             file_exists=p.exists())
        if file_kind=='fresh-control':
            assert reply['ok'] and gateway._wcs_cache[0]['x']==7.0
            assert stamps[0][0][1][1][0]==7.0
        else:
            assert not reply['ok'] or (gateway._wcs_cache[0]['x']==7.0 and stamps[0][0][1][1][0]==7.0), \
                'neither the returned table nor its stamp may claim stale cache values as the new effect'
            if not reply['ok']: assert stamps==[]


def test_a_read_poll_exception_revokes_the_old_confirmation():
    with setup() as fx:
        assert fx.read()[0]
        assert gateway._coord_basis_unconfirmed() is None
        old_id=fx.snap().values.read_id
        orig=fx.ctl.conn.stat.poll
        count=[0]
        def poll():
            if inspect.currentframe().f_back.f_code.co_name=='_own_done':
                count[0]+=1
                raise RuntimeError('R519 read completion poll failed')
            return orig()
        fx.ctl.conn.stat.poll=poll
        async def go(): return await gateway._coord_read_safe(fx.link,(1,),True,'R519')
        reply=fixtures._run(with_poller(fx.ctl,go()))
        reason=gateway._coord_basis_unconfirmed()
        show('read-poll-exception',reply=reply,start_reason=reason,state=gateway._coord_basis_status()['state'],
             old_read=old_id,current_read=fx.snap().values.read_id,failed_polls=count[0])
        assert reply[0] is False and count[0]>0
        assert reason is not None


def test_a_cancelled_read_does_not_keep_old_confirmation():
    with setup() as fx:
        assert fx.read()[0]
        assert gateway._coord_basis_unconfirmed() is None
        async def go():
            entered=asyncio.Event()
            async def pause_before_empty(conn):
                entered.set()
                await asyncio.Event().wait()
            with patch.object(gateway,'_coord_drain',pause_before_empty):
                task=asyncio.create_task(gateway._coord_read_safe(fx.link,(1,),True,'R519'))
                await entered.wait()
                task.cancel()
                with pytest.raises(asyncio.CancelledError): await task
        fixtures._run(with_poller(fx.ctl,go()))
        reason=gateway._coord_basis_unconfirmed()
        show('read-cancel-before-empty',start_reason=reason,state=gateway._coord_basis_status()['state'],
             remaining_reads=len(gateway._coord_reads),remaining_jobs=len(gateway._coord_jobs))
        assert reason is not None

def test_timeout_does_not_claim_the_write_did_not_happen():
    with setup(fixtures.TestTouchoff) as fx:
        old_answer=fx.ctl._answer
        def answer(line):
            if line.startswith('G10 L2 P1 X7'):
                fx.ctl.interp['params[5221]']=7.0
                fx.ctl.force_rc=-1  # applied, but no observed completion before the deadline
            old_answer(line)
        fx.ctl._answer=answer
        gateway._shared_status=_payload(g5x_index=1,task_mode=gateway.linuxcnc.MODE_MDI)
        async def send(): return await gateway.handle_command({'cmd':'set_wcs','target':'G54','x':7},True)
        reply=fixtures._run(with_poller(fx.ctl,send()))
        show('wcs-timeout-after-effect',reply=reply,interpreter_x=fx.ctl.interp['params[5221]'])
        assert not reply['ok']
        assert 'not written' not in reply.get('error',''), 'timeout proves no completion, not no effect'
