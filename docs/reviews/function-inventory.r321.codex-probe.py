"""R321 plan counterexamples, offline only.

Usage: gateway-venv/python probe.py /path/to/archive-at-41d0d1ab [output.json]
Imports the real gateway under the repository's fake LinuxCNC. HAL subprocesses
are replaced completely; all tool-table writes use a TemporaryDirectory.
Assertions describe the observed defects, not acceptance of the future fix.
"""
import asyncio
import copy
import hashlib
import faulthandler
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from unittest.mock import patch

ROOT = Path(sys.argv[1]).resolve()
faulthandler.dump_traceback_later(15)
sys.path.insert(0, str(ROOT / "lcnc-gateway"))
import test_command_dispatch as support
import gateway
from tool_table import parse_tool_table, write_tool_table

observed = {}

async def with_loop_ticks(coro):
    # The restricted sandbox may not wake selector.select for the executor's
    # socketpair notification. A harness-only timer also wakes it regularly.
    async def tick():
        while True:
            await asyncio.sleep(.005)
    timer = asyncio.create_task(tick())
    try:
        return await coro
    finally:
        await asyncio.get_running_loop().shutdown_default_executor()
        timer.cancel()
        try:
            await timer
        except asyncio.CancelledError:
            pass

def setup():
    fixture = support.TestHandlerExecution()
    fixture.setUp()
    gateway._shared_status = support._payload()
    gateway._cmd_lock = None
    return fixture

async def pulse_case(kind):
    fixture = setup()
    calls, pin = [], [0]
    entered, release, ended = threading.Event(), threading.Event(), threading.Event()

    def hal(args, **kwargs):
        assert args[:2] in (["halcmd", "unlinkp"], ["halcmd", "sets"]), args
        calls.append(list(args))
        if args[1] == "sets":
            if args[-1] == "1" and kind == "cancel_during_high":
                entered.set()
                assert release.wait(2), "probe harness did not release the fake subprocess"
            pin[0] = int(args[-1])
            if args[-1] == "1" and kind == "high_timed_out_after_write":
                raise subprocess.TimeoutExpired(args, 2)
            if args[-1] == "1":
                ended.set()
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    async def event(e):
        for _ in range(400):
            if e.is_set():
                return
            await asyncio.sleep(.005)
        raise AssertionError("probe harness timed out")

    with patch.object(gateway.subprocess, "run", hal):
        task = asyncio.create_task(gateway.handle_command({"cmd": "simulate_probe_trip"}, True, fixture.key))
        try:
            if kind == "cancel_during_high":
                await event(entered)
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                else:
                    raise AssertionError("cancellation did not propagate")
                lock_free_before_thread_end = not gateway._get_cmd_lock().locked()
                release.set()
                await event(ended)
                result = {"cancelled": True, "lock_free_before_thread_end": lock_free_before_thread_end}
            else:
                result = await task
            observed[kind] = {"reply": result, "calls": calls, "final_fake_pin": pin[0]}
        finally:
            release.set()
            fixture.doCleanups()

for kind in ("success", "high_timed_out_after_write", "cancel_during_high"):
    print("case: " + kind, file=sys.stderr, flush=True)
    asyncio.run(with_loop_ticks(pulse_case(kind)))
assert observed["success"]["final_fake_pin"] == 0
assert observed["success"]["reply"] == {"ok": True}
assert observed["high_timed_out_after_write"]["final_fake_pin"] == 1
assert observed["high_timed_out_after_write"]["reply"]["ok"] is False
assert observed["cancel_during_high"]["final_fake_pin"] == 1
assert observed["cancel_during_high"]["reply"]["lock_free_before_thread_end"] is True

with tempfile.TemporaryDirectory(prefix="r321-tbl-") as tmp:
    print("case: tool table", file=sys.stderr, flush=True)
    tbl = Path(tmp) / "tool.tbl"
    original = "T1 P8 X1.25 Y-2.5 Z10 D6 ; edited\nT2 P9 X3.25 Y-4.5 Z20 D12 ; untouched\n"
    tbl.write_text(original)
    before = parse_tool_table(str(tbl))
    edited = copy.deepcopy(before)
    edited[0]["Z"] = 11
    write_tool_table(str(tbl), edited)
    after = parse_tool_table(str(tbl))
    observed["table_roundtrip"] = {"before": before, "after": after, "bytes_after": tbl.read_text()}
    assert after[1]["X"] == after[1]["Y"] == 0
    assert before[1]["X"] != 0 and before[1]["Y"] != 0

    # Real renumber handler, policy/metadata storage outside this probe's scope.
    tbl.write_text(original)
    fixture = setup()
    saved_library = {}
    def save_library(lib):
        saved_library.update(copy.deepcopy(lib))
    try:
        with patch.object(gateway, "get_tool_tbl_path", return_value=str(tbl)), \
             patch.object(gateway, "_write_admission_refusal", return_value=None), \
             patch.object(gateway, "load_tool_library", return_value={"1": {"description": "one"}, "2": {"description": "two"}}), \
             patch.object(gateway, "save_tool_library", side_effect=save_library):
            reply = asyncio.run(with_loop_ticks(gateway.handle_command(
                {"cmd": "renumber_tool", "old_tool_number": 1, "tool_number": 7}, True, fixture.key)))
        after = parse_tool_table(str(tbl))
        renamed = next(t for t in after if t["T"] == 7)
        observed["renumber_without_pocket"] = {"reply": reply, "before": before, "after": after,
                                               "library_after": saved_library, "cmd_calls": fixture.cmd.calls}
        assert reply["ok"] is True, reply
        assert renamed["P"] == 7 and before[0]["P"] == 8
    finally:
        fixture.doCleanups()

observed["source"] = {str(p): hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in (
    "lcnc-gateway/gateway.py", "lcnc-gateway/tool_table.py", "lcnc-gateway/test_command_dispatch.py")}
payload = json.dumps(observed, indent=2, ensure_ascii=False) + "\n"
if len(sys.argv) > 2:
    Path(sys.argv[2]).write_text(payload)
else:
    print(payload)
faulthandler.cancel_dump_traceback_later()
