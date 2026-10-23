#!/usr/bin/env python3
"""Calibration of the R phase (Codex R185) on the live XYZAC sim: Machine On
(if off), G54, bpc_run.ngc loaded and checked, Cycle Start, each tool change
confirmed like the dialog's Confirm, the run's end; then every parse and the
Mac page's sweeps with their times (calib-run-<ts>.json), the previous
program loaded back and the machine switched off again if it was off. Under
drive2's guard (no other client armed, no trip, a fresh envelope); a breach
or any refusal aborts a running program."""
import asyncio, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import drive2
from drive2 import Client2, guard, log, mac_pages, trace_since, Stop
from drive import NC, confirm_tool_changes, wait_publish, wait_settled


async def run(c, out):
    if not c.st.get("enabled"):
        await c.cmd({"cmd": "machine_on"})
        await c.until(lambda s: s.get("enabled"), 10, "Machine On")
    if not c.st.get("homed"):
        raise Stop("not homed — calibration expects a homed machine")
    if c.st.get("g5x_index") != 1:
        await c.cmd({"cmd": "mdi", "text": "G54"})
        await c.until(lambda s: s.get("g5x_index") == 1 and s.get("interp_state") == 1, 30, "G54")
    t = time.time_ns()
    out["t_load"] = t
    await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "bpc_run.ngc")})
    await wait_publish(c, t, 300, "bpc_run.ngc")
    await wait_settled(c, t, 1800, "bpc_run.ngc check", quiet_s=8.0)
    out["t_run"] = time.time_ns()
    await c.cmd({"cmd": "cycle_start"})
    await c.until(lambda s: s.get("interp_state") != 1, 15, "run started")
    log("running")
    await c.until(lambda s: s.get("interp_state") == 1 and not s.get("tool_change_requested"), 1800, "run end",
                  tick=lambda: confirm_tool_changes(c))
    out["t_end"] = time.time_ns()
    log("run ended")
    await wait_settled(c, out["t_end"], 600, "the check after the run", quiet_s=10.0)


async def main():
    c = Client2()
    await c.connect()
    await asyncio.sleep(2.0)
    prev, was_on = c.st.get("active_file"), bool(c.st.get("enabled"))
    out = {"prev": prev, "was_on": was_on}
    b = drive2.guard_breach(c)
    if b:
        raise SystemExit("guard: " + b)
    why = []
    seq = asyncio.get_event_loop().create_task(run(c, out))
    asyncio.get_event_loop().create_task(guard(c, seq, why))
    try:
        try:
            await seq
        except asyncio.CancelledError:
            raise Stop("guard: " + (why[0] if why else "cancelled"))
    except Stop as e:
        log("STOP:", e)
        out["stop"] = str(e)
        if c.st.get("interp_state") not in (None, 1):
            try:
                await c.cmd({"cmd": "abort"})
            except Stop as e2:
                log("abort:", e2)
    recs = trace_since(out["t_load"]) if "t_load" in out else []
    pages = mac_pages(out.get("t_load", time.time_ns()) - 60 * 10**9)
    keep = ("gcode.spawn_start", "gcode.publish", "gcode.worker_done", "gcode.parse_cancelled",
            "gcode.reparse_superseded", "gcode.reparse_table_midrun", "gcode.parse_span")
    out["gateway"] = [r for r in recs if r.get("tag") in keep]
    out["page"] = [r for r in recs if r.get("page") in pages and r.get("tag", "").startswith("browser.collision.")]
    fn = os.path.join(HERE, f"calib-run-{time.strftime('%Y%m%d-%H%M%S')}.json")
    with open(fn, "w") as f:
        json.dump(out, f, indent=1)
    log("wrote", fn)
    try:
        if prev:
            t2 = time.time_ns()
            await c.cmd({"cmd": "load_file", "path": prev})
            await wait_publish(c, t2, 300, os.path.basename(prev))
        if not was_on and c.st.get("enabled"):
            await c.cmd({"cmd": "machine_off"})
    except Stop as e:
        log("restore:", e)
    await c.cmd({"cmd": "arm", "armed": False}, timeout=5)
    await c.ws.close()

asyncio.run(main())
