"""R433: observation across trace generations, offline only."""
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import pytest
import native_run as nr
from test_support import native_cases as nc
from test_r431_codex import Clock


def raw(events):
    return b"".join((json.dumps(dict(proc="gateway",pid=101,**e))+"\n").encode() for e in events)


def observation(new_time, with_loss):
    older = [{"tag":"toolsetter.basis", "origin":"applied", "version":10, "t_wall_ns":200}]
    newer = [{"tag":"toolsetter.basis", "origin":"assumed", "version":11, "t_wall_ns":new_time}]
    if with_loss:
        newer += [{"tag":"trace.write_lost", "count":1, "since_ns":new_time,
                   "t_wall_ns":new_time+1, "why":{"lock_busy":1}}]
    return [("trace.ndjson",42,raw(newer)), ("trace.ndjson.1",41,raw(older))], []


@pytest.mark.parametrize("with_loss", [False, True])
def test_a_wall_step_at_rotation_keeps_the_new_generation_after_the_anchor(with_loss):
    with patch.object(nr, "_trace_files", return_value=observation(150,with_loss)):
        sl=nr._gateway_events_since({"gateway_pid":101,"run":Path("/unused")},199)
    assert nc.pb_owed(sl), {"events":list(sl),"problems":sl.problems}
    assert [e["version"] for e in sl if e["tag"]=="toolsetter.basis"] == [10,11]
    if with_loss:
        assert any("lost" in p for p in sl.problems), sl.problems


def test_the_same_rotation_without_a_wall_step_is_recognized():
    with patch.object(nr, "_trace_files", return_value=observation(210,True)):
        sl=nr._gateway_events_since({"gateway_pid":101,"run":Path("/unused")},199)
    assert nc.pb_owed(sl) and any("lost" in p for p in sl.problems)


def test_the_rotated_loss_does_not_release_the_live_wait():
    clock,calls=Clock(),[]
    def files(_path):
        calls.append(round(clock.t,3))
        return observation(150,True)
    with patch.object(nr,"time",clock),patch.object(nr,"_trace_files",files):
        try:
            waited=nr._pb_quiet(SimpleNamespace(status={"preview_refresh":None}),"pb",
                owed=lambda:nc.pb_owed(nr._gateway_events_since({"gateway_pid":101,"run":Path("/unused")},199)))
        except nr.Refused:
            return
    pytest.fail(f"an unconfirmed/lossy observation ended the wait: waited={waited}, reads_at={calls}")
