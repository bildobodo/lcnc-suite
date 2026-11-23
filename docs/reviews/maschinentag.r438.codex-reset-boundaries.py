import asyncio
from unittest.mock import patch
import fake_linuxcnc
linuxcnc=fake_linuxcnc.install()
import gateway
import pytest

def outcome(records):
    conn=object();clock=[100.0];seq=[0]
    async def sleep(_):
        if seq[0] >= len(records):
            clock[0]+=2
            return
        began,delivered,state=records[seq[0]];seq[0]+=1;clock[0]=delivered
        gateway._poll_record=(seq[0],began,conn,7,state)
    with patch.object(gateway,'_poll_record',None),patch.object(gateway.time,'monotonic',lambda:clock[0]),patch.object(gateway.asyncio,'sleep',sleep):
        return asyncio.run(gateway._estop_reset_outcome(conn,{'serial':7,'t':100.0}))

@pytest.mark.parametrize('state,expected',[(linuxcnc.STATE_ESTOP,False),(linuxcnc.STATE_ESTOP_RESET,True)])
def test_timely_observation_processed_late_still_decides(state,expected):
    assert outcome([(100.02,100.02,1),(100.55,110.0,state)])['confirmed'] is expected

@pytest.mark.parametrize('state,expected',[(linuxcnc.STATE_ESTOP,False),(linuxcnc.STATE_ESTOP_RESET,True)])
def test_final_deadline_inclusive(state,expected):
    assert outcome([(100.02,100.02,1),(101.52,101.52,state)])['confirmed'] is expected

@pytest.mark.parametrize('state',[linuxcnc.STATE_ESTOP,linuxcnc.STATE_ESTOP_RESET])
def test_immediately_after_final_deadline_cannot_decide(state):
    assert outcome([(100.02,100.02,1),(101.52001,101.52001,state)])['confirmed'] is None

def test_echo_deadline_inclusive():
    assert outcome([(101,101,1),(101.5,101.5,2)])['confirmed'] is True

def test_immediately_after_echo_deadline_cannot_open():
    assert outcome([(101.00001,101.00001,1),(101.5,101.5,2)])['confirmed'] is None
