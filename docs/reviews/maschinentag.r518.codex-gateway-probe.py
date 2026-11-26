"""R518 counterguards. Run only in an isolated 43ba83b2 archive, -p conftest.
Fake controller; no native command or live connection. Desired assertions are red.
"""
import asyncio
from contextlib import contextmanager
from copy import deepcopy
from unittest.mock import patch
import json
import re
import conftest  # install fake and isolate host BEFORE gateway
import test_coord_gateway as fixtures
_run = fixtures._run
import gateway
import coord_basis as cb
from coord_fixture import with_poller
from test_command_dispatch import _payload

@contextmanager
def setup(kind=fixtures.TestStart):
    fx=kind()
    fx.setUp()
    try:
        yield fx
    finally:
        fx.doCleanups()

def show(case, **data):
    print('R518 '+json.dumps({'case':case, **data}, sort_keys=True, default=str))

def test_remapped_feed_and_speed_open_the_basis():
    result={}
    for word in ('F','S','T'):
        code=word+'100'
        result[word]=sorted(cb.mdi_effect(code, frozenset({word})))
    show('remap', effect=result, ordinary_F=sorted(cb.mdi_effect('F100')))
    assert cb.mdi_effect('F100') == cb.NOTHING
    assert all(set(e)==cb.ALL for e in result.values())

def test_start_waits_for_the_error_channel_end():
    with setup() as fx:
        async def go():
            stop=asyncio.Event()
            last_part_seen=asyncio.Event()
            async def partial_poller():
                while not stop.is_set():
                    gateway._poll_cycle += 1
                    msgs=list(fx.ctl.errors); fx.ctl.errors.clear()
                    final=any((m:=re.search(r' (\d+)/(\d+) ',t)) and m[1]==m[2] for k,t in msgs)
                    gateway._coord_status_cycle(fx.link,msgs,'packet bound' if final else None)
                    if final:
                        # A further error record is behind the bound; no completed
                        # drain has read it. Its later delivery is kept separate.
                        last_part_seen.set()
                        await stop.wait()
                    await asyncio.sleep(.003)
            task=asyncio.create_task(partial_poller())
            try:
                reason=await gateway._coord_start_read('R518')
                before=gateway._coord_basis_unconfirmed()
                complete=last_part_seen.is_set()
            finally:
                stop.set(); await task
            gateway._poll_cycle += 1
            gateway._coord_status_cycle(fx.link, [(11,'controller error behind the drain bound')],None)
            return reason,before,complete,gateway._coord_basis_unconfirmed()
        reason,before,complete,after=_run(go())
        show('bounded-drain', read_reason=reason, start_reason_before_error=before,
             last_part_seen=complete, start_reason_after_error=after)
        assert complete
        assert before is not None, 'a complete reply is not an EMPTY error-channel drain'

def test_latched_unknown_path_does_not_keep_old_confirmation():
    with setup() as fx:
        assert fx.read()[0]
        assert gateway._coord_basis_unconfirmed() is None
        with open(fx.inst['record']['ini'],'ab') as f:
            f.write(b'# edited after the read\n')
        read=fx.read(deliberate=True)
        reason=gateway._coord_basis_unconfirmed()
        show('unknown-after-confirmed', read=read, path=gateway._coord_path(False),
             start_reason=reason, state=gateway._coord_basis_status()['state'])
        assert read[0] is False
        assert reason is not None

def test_link_change_does_not_claim_the_old_finding():
    with setup() as fx:
        fx.ctl.interp.update(origin_offset_x=5.0,current_x=5.0)
        assert fx.read()[0]
        old=fx.snap()
        assert cb.classify(old,cb.need_display(),fx.link.seq)==cb.INCONSISTENT
        gateway._coord_ledger.link(fx.link.seq+1)
        new=fx.snap()
        result=cb.classify(new,cb.need_display(),fx.link.seq+1)
        show('link-change', old_link=old.link_seq,new_link=new.link_seq,
             values_link=new.values.link_seq, state=result, findings=new.inconsistent)
        assert result==cb.UNCONFIRMED

async def stamp(*a,**k):
    return {}

async def dispatch(msg):
    return await gateway.handle_command(msg, True)

import pytest
@pytest.mark.parametrize('msg,initial,wanted',[
    ({'cmd':'set_wcs','target':'G54','x':7},3.0,7.0),
    ({'cmd':'clear_wcs','target':'G54'},3.0,0.0),
])
def test_wcs_error_never_successfully_updates_the_cache(msg,initial,wanted):
    with setup(fixtures.TestTouchoff) as fx:
        old=deepcopy(gateway._wcs_cache)
        fx.addCleanup(setattr,gateway,'_wcs_cache',old)
        gateway._wcs_cache[0]['x']=initial
        gateway._shared_status=_payload(g5x_index=1,task_mode=gateway.linuxcnc.MODE_MDI)
        fx.ctl.force_rc=gateway.linuxcnc.RCS_ERROR
        with patch.object(gateway,'_stamp_wcs_provenance',stamp):
            reply=_run(with_poller(fx.ctl,dispatch(msg)))
        x=gateway._wcs_cache[0]['x']
        show(msg['cmd']+'-error',reply=reply['ok'],cache_x=x,initial=initial,
             mdi=[args[0] for name,args in fx.ctl.calls if name=='mdi'])
        assert reply['ok'] is False and x==initial

def test_failed_reread_does_not_keep_old_confirmation():
    with setup() as fx:
        assert fx.read()[0]
        assert gateway._coord_basis_unconfirmed() is None
        fx.ctl.drop_reply = True
        read=fx.read(deliberate=True)
        reason=gateway._coord_basis_unconfirmed()
        show('failed-after-confirmed', read=read, capability=gateway._coord_instance()['cap'],
             start_reason=reason, state=gateway._coord_basis_status()['state'])
        assert read[0] is False
        assert reason is not None
