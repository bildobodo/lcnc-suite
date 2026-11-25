"""R481 counterexamples; run in the archived gateway with -p conftest.

No real NML, HAL or network: the existing _Guard isolates every endpoint.
Tests assert the refusal contract, so the head is expected to fail six.
"""
import json
import os
from pathlib import Path
import time
from unittest.mock import patch

import pytest
from test_tool_guard_gateway import _Guard, TestWhatIsNotKnown as Cases
import gateway
import tool_proof
from tool_table import tool_table_bytes


def record(value):
    with Path(os.environ["R481_RESULTS"]).open("a") as f:
        f.write(json.dumps(value, ensure_ascii=False) + "\n")


@pytest.fixture
def guard():
    g = _Guard()
    g.setUp()
    try:
        yield g
    finally:
        g.tearDown()
        g.doCleanups()


@pytest.mark.parametrize("name", list(Cases.WRITES))
def test_missing_prepare_pin_refuses_before_any_write(guard, name):
    g = guard
    g.prepare(2, 5, 5)
    del g.reader["tool_prepare"]
    before = g.files()
    reply = Cases.WRITES[name](g)()
    record(dict(case="missing tool_prepare", endpoint=name, reply=reply,
                files_changed=g.files() != before, loads=g.io.loads))
    assert reply["ok"] is False, "Missing preparation state must not authorize a reload"
    assert g.files() == before
    assert g.io.loads == 0


def test_no_admission_from_two_individually_refusing_snapshots(guard):
    g = guard
    g.prepare(2, 5, 5)
    # A completed T5 preparation at index 2. B begins T8 preparation;
    # ioControl keeps the old index until read_hal_inputs sees prepared.
    a = dict(g.reader)
    b = dict(a, tool_prepare=True, tool_prep_number=8, tool_prep_pocket=8)
    after = tool_table_bytes([dict(T=5, P=5, Z=50, D=5), dict(T=8, P=8, Z=80, D=8)])
    why = [tool_proof.prepared_refusal(after, None, 2, s["tool_prepare"],
                                      s["tool_prep_number"], s["tool_prep_pocket"])
           for s in (a, b)]
    assert all(why), "Neither real snapshot authorizes this deletion"
    bridge = gateway._hal_bridge
    history = []
    with patch.object(bridge, "_reader_state", (a, time.monotonic())):
        def read(field):
            value = bridge.reader_get(field)
            history.append([field, value])
            if field == "tool_prepare":
                bridge._reader_state = (b, time.monotonic())
            return value
        with patch.object(gateway, "_reader_get", read), \
             patch.object(gateway, "_reader_is_stale", bridge.reader_is_stale):
            before = g.files()
            reply = g.edit(cmd="delete_tool", tool_number=2)()
            record(dict(case="snapshot changes after prepare read", coherent_refusals=why,
                        reads=history, reply=reply, files_changed=g.files() != before,
                        loads=g.io.loads))
            assert reply["ok"] is False, "No coherent HAL snapshot admitted this write"
            assert g.files() == before
            assert g.io.loads == 0


@pytest.mark.parametrize("name", list(Cases.WRITES))
@pytest.mark.parametrize("preparing", [False, True])
def test_known_prepare_controls(guard, name, preparing):
    g = guard
    g.prepare(2, 5, 5)
    g.reader["tool_prepare"] = preparing
    before = g.files()
    reply = Cases.WRITES[name](g)()
    record(dict(case="known preparation control", endpoint=name, preparing=preparing,
                reply=reply, files_changed=g.files() != before, loads=g.io.loads))
    assert reply["ok"] is (not preparing)
    assert g.io.loads == (0 if preparing else 1)
    if preparing:
        assert g.files() == before
