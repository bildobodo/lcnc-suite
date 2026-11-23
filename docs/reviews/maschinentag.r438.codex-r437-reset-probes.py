import asyncio
from unittest.mock import patch
import fake_linuxcnc
linuxcnc=fake_linuxcnc.install()
import gateway
import pytest


def run_records(records):
    conn=object();clock=[100.0];seq=[0]
    async def sleep(_):
        if seq[0] >= len(records):
            clock[0]+=2
            return
        at,state=records[seq[0]];seq[0]+=1;clock[0]=at
        gateway._poll_record=(seq[0],at,conn,7,state)
    with patch.object(gateway,'_poll_record',None),patch.object(gateway.time,'monotonic',lambda:clock[0]),patch.object(gateway.asyncio,'sleep',sleep):
        return asyncio.run(gateway._estop_reset_outcome(conn,{'serial':7,'t':100.0}))


def test_control_poll_within_settle_and_late_window():
    assert run_records([(100.02,linuxcnc.STATE_ESTOP),(100.55,linuxcnc.STATE_ESTOP_RESET)])['confirmed'] is True


@pytest.mark.parametrize('state',[linuxcnc.STATE_ESTOP,linuxcnc.STATE_ESTOP_RESET])
def test_deciding_poll_after_declared_late_window_is_unknown(state):
    r=run_records([(100.02,linuxcnc.STATE_ESTOP),(102.1,state)])
    assert r['confirmed'] is None,r


def test_first_echo_after_echo_deadline_is_unknown():
    r=run_records([(101.2,linuxcnc.STATE_ESTOP),(101.8,linuxcnc.STATE_ESTOP_RESET)])
    assert r['confirmed'] is None,r
