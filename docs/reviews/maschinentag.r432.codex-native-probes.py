"""R432 counterexamples: offline readers only, no controller access."""
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import pytest
import native_run as nr
from test_support import native_cases as nc
from test_r431_codex import Clock, ops


def data(events):
    return b"".join((json.dumps(dict(proc="gateway", pid=101, **e)) + "\n").encode() for e in events)


def test_a_gateway_loss_cannot_settle_the_live_owed_wait():
    clock, calls = Clock(), []
    def files(_path):
        calls.append(round(clock.t, 3))
        # The last op applied one input; its subsequent assumed booking
        # was lost, which the very same gateway explicitly reported.
        ev = [{"tag": "toolsetter.basis", "origin": "applied", "version": 10,
               "keys": [3014], "t_wall_ns": 100},
              {"tag": "trace.write_lost", "count": 1, "since_ns": 101,
               "t_wall_ns": 102, "why": {"lock_busy": 1}}]
        if clock.t >= 5:
            ev += [{"tag": "toolsetter.basis", "origin": "read", "version": 12,
                    "keys": [3014], "t_wall_ns": 105},
                   {"tag": "toolsetter.read_back_outcome", "attempt_version": 11,
                    "outcome": "confirmed", "t_wall_ns": 106}]
        return [("trace.ndjson", 42, data(ev))], []
    with patch.object(nr, "time", clock), patch.object(nr, "_trace_files", files):
        try:
            waited = nr._pb_quiet(SimpleNamespace(status={"preview_refresh": None}), "pb",
                owed=lambda: nc.pb_owed(nr._gateway_events_since(
                    {"gateway_pid": 101, "run": Path("/unused")}, 99)))
        except nr.Refused:
            return
    assert waited >= 5 + nr.PB_QUIET_S, {"waited": waited, "reads_at": calls}


@pytest.mark.parametrize("clock_step", ["back_at_end", "back_before_report"])
def test_a_loss_physically_inside_the_frame_is_not_excluded_by_wall_time(clock_step):
    ev = [{"tag": "client.diag", "native_mark": "pb", "edge": "start", "t_wall_ns": 100}]
    ev += [dict(t_wall_ns=110, **e) for e in ops()]
    loss = {"tag": "trace.write_lost", "count": 2, "why": {"lock_busy": 2}}
    if clock_step == "back_at_end":
        loss.update(since_ns=250, t_wall_ns=300)
    else:
        loss.update(since_ns=110, t_wall_ns=90)
    ev += [loss, {"tag": "client.diag", "native_mark": "pb", "edge": "end", "t_wall_ns": 200}]
    window = nc.frame_window([("trace.ndjson", 42, data(ev))], "pb", 101)
    assert window["framed"], window
    basis, nice = nc.eval_parse_basis("pb", window, 3), nc.eval_parse_nice("nice", window)
    assert (basis["status"], nice["status"]) == ("incomplete", "incomplete"), {
        "losses": window["losses"], "basis": basis, "nice": nice}


def test_the_real_trace_writer_can_put_a_loss_inside_the_frame_across_a_wall_step(tmp_path):
    import importlib.util
    import os
    import sys
    sys.path.insert(0, str(Path(nr.__file__).parents[1] / "lcnc-gateway"))
    spec = importlib.util.spec_from_file_location("r432_trace", Path(nr.__file__).parents[1] / "lcnc-gateway/lcnc_trace.py")
    tr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tr)
    tr._proc_name = "gateway"
    now = SimpleNamespace(wall=1000000000, mono=1.0)
    clock = SimpleNamespace(time_ns=lambda: now.wall, monotonic=lambda: now.mono)
    path = tmp_path / "trace.ndjson"
    h = tr.CoordinatedFileHandler(str(path), str(tmp_path / "trace.lock"),
        max_bytes=100000, backups=2, report_prefix="trace")
    def emit(e):
        rec = dict(proc="gateway", pid=os.getpid(), t_wall_ns=now.wall,
                   t_mono_ms=now.mono*1000, **e)
        return h.append((json.dumps(rec)+"\n").encode())
    with patch.object(tr, "time", clock):
        assert emit(dict(tag="client.diag", native_mark="real", edge="start"))
        now.wall, now.mono = 1100000000, 1.1
        for e in ops():
            assert emit(e)
        now.wall, now.mono = 1250000000, 1.25
        with patch.object(h, "_lock", return_value="lock_busy"):
            assert not emit(dict(tag="gcode.spawn_start", reason="toolsetter", nice=19))
        now.wall, now.mono = 1300000000, 1.3
        assert emit(dict(tag="diagnostic.after_loss"))
        now.wall, now.mono = 1200000000, 1.4  # wall stepped back, monotonic kept advancing
        assert emit(dict(tag="client.diag", native_mark="real", edge="end"))
        h.close()
    raw = path.read_bytes()
    Path("/tmp/r432/producer-trace.ndjson").write_bytes(raw)
    w = nc.frame_window([(path.name, path.stat().st_ino, raw)], "real", os.getpid())
    assert b'"trace.write_lost"' in raw and w["framed"]
    assert nc.eval_parse_basis("pb", w, 3)["status"] == "incomplete", w


def test_a_readable_confirmed_live_observation_releases_the_wait():
    clock = Clock()
    raw = data([dict(t_wall_ns=100, **e) for e in ops()])
    with patch.object(nr, "time", clock), patch.object(nr, "_trace_files", return_value=([("trace.ndjson",42,raw)], [])):
        waited = nr._pb_quiet(SimpleNamespace(status={"preview_refresh": None}), "pb",
            owed=lambda: nc.pb_owed(nr._gateway_events_since({"gateway_pid":101,"run":Path("/unused")},99)))
    assert nr.PB_QUIET_S <= waited <= nr.PB_QUIET_S + .2
