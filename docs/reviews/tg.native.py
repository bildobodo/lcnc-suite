#!/usr/bin/env python3
"""Tool guard — the native confirmation on the VM's REAL LinuxCNC (Codex R476
answers 2 and 6, MT476-02), through the native stage's machinery
(scripts/native_run.py of the tree --scripts names: record + stop the LAN sim,
a run tree of --commit, a confined copy of the 3-axis profile, start, the
steps, the restore in `finally`; the unit's ExecStopPost is restore_lan.py).
Nothing is committed from the run but its record.

Every case starts on the copy's own table (T1 … T14, row = index), LinuxCNC
holding it, nothing prepared.

Cases (the gateway's):
  prepared     `T5` without M6: STAT.pocket_prepped 5, the pins 5 / P5. A
               delete of T2, a renumber of T2 to T40 (rows shift) and T5's own
               pocket 5 → 25 are refused by name, file and LinuxCNC unchanged;
               T5's Z, T8's Z and an add behind every row are admitted and
               confirmed. After the M6 the index is -1 and the delete of T2 is
               admitted (and T2 put back).
  resting      `T5` + M6 with T5 already in the spindle: no change, the index
               stays 5 — a shift refused; `T0` makes it 0 and admits it.
  aborted      `T6`, then Abort: the index stays (6), a Z edit admitted, a
               shift refused.
  e-stop       `T6`, then the WebUI's E-Stop: the pins read 0 / 0, the index
               stays — refused ("unclear since the E-Stop"); after reset, on
               and T0 admitted.
  moving       during a manual jog (the interpreter idle) a Z edit is refused;
               once it stands it is admitted. In E-Stop and with the machine
               off it is admitted (STAT.inpos, current_vel recorded).
  ghost        a remark whose line has 267 bytes: refused, file unchanged.

Evidence for the source reading (a raw load_tool_table of the test client,
past the gateway's guard — what the guard prevents):
  raw-shift    T5 prepared; the file without T2's row, loaded raw; `M6`
               without T: which tool LinuxCNC has in the spindle (from the
               source: T6, the row now at index 5), what tool the M6 asked for
               on HAL (from the source: still 5).
  raw-pocket   T5 prepared from P5; the file with T5 in P25 (same index),
               loaded raw; M6: tool-from-pocket (from the source: 25, while 5
               was prepared).
  raw-hash     "#T3 P3 …" in the file, loaded raw; `T5`: the index LinuxCNC
               prepares (from the source and the compiled reader: 5 — the
               commented row keeps index 3 —, T5's position among the rows is 4).

  python3 -I docs/reviews/tg.native.py --scripts <tree> --run-dir <dir> --commit <sha>
Runs only as the user unit `native-run` (restore as its ExecStopPost).
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

PREPARED = "A tool is prepared — change to another tool or send T0"
CLEARED = "Prepared tool unclear since the E-Stop — send T0 first"
MOVING = "Machine moving — wait until it stands"
TOO_LONG = "T5: line too long for LinuxCNC — shorten its description"
BUSY = "starting or running"


def table_path(nr, ctx) -> Path:
    tt = (nr.lt.ini_values(ctx["ini"].read_text()).get(("EMCIO", "TOOL_TABLE")) or [""])[-1]
    return (ctx["config"] / tt).resolve()


def make_step(nr):
    def step(ctx):
        import linuxcnc
        from test_support.live_session import Refused as SessionRefused
        from test_support import servo as sv
        c = ctx["client"]
        rep = ctx["report"].setdefault("tg", {})
        nr._home_joints(c, 3)
        table = table_path(nr, ctx)
        original = table.read_bytes()
        stat, gate = linuxcnc.stat(), sv.HalGate()

        def now():
            stat.poll()
            return stat

        def pins():
            return {p: gate("getp", f"iocontrol.0.{p}").strip() for p in
                    ("tool-prep-index", "tool-prep-number", "tool-prep-pocket", "tool-prepare", "tool-from-pocket")}

        def state():
            s = now()
            return {"pocket_prepped": s.pocket_prepped, "spindle": s.tool_in_spindle, "inpos": bool(s.inpos),
                    "vel": s.current_vel, "task_state": s.task_state, "pins": pins()}

        def until(pred, what, timeout=10.0):
            end = time.monotonic() + timeout
            while not pred(now()):
                if time.monotonic() > end:
                    raise nr.Refused(f"{what}: {state()}")
                time.sleep(0.02)

        def memory():
            return [(i, int(t.id), round(t.zoffset, 6)) for i, t in enumerate(now().tool_table) if i >= 1 and int(t.id) != -1]

        def ask(cmd, **kw):
            """(reply or None, refusal or None); a held start claim is asked again."""
            end = time.monotonic() + 10
            while True:
                try:
                    return c.request(cmd, **kw), None
                except SessionRefused as e:
                    if BUSY not in str(e) or time.monotonic() > end:
                        return None, str(e)
                    time.sleep(0.1)

        def save(tool, **kw):
            return ask("save_tool", tool_number=tool, expected=nr._tool_row_expect(c, tool), **kw)

        def renumber(tool, to):
            return ask("renumber_tool", old_tool_number=tool, tool_number=to, expected=nr._tool_row_expect(c, tool))

        def refused(name, do, why):
            before, mem = table.read_bytes(), memory()
            reply, refusal = do()
            time.sleep(0.4)             # a reload, had one been sent, lands in ~0.1 s
            return {"case": name, "reply": reply, "refusal": refusal, "state": state(),
                    "pass": reply is None and refusal is not None and why in refusal
                    and table.read_bytes() == before and memory() == mem}

        def admitted(name, do):
            before = table.read_bytes()
            reply, refusal = do()
            return {"case": name, "refusal": refusal, "reload": (reply or {}).get("reload"), "state": state(),
                    "pass": reply is not None and reply.get("reload") == "confirmed" and table.read_bytes() != before}

        def raw(data: bytes, tools: int):
            """The file replaced and loaded past the gateway (a foreign NML client)."""
            tmp = table.with_name(table.name + ".tgtmp")
            tmp.write_bytes(data)
            os.replace(tmp, table)
            linuxcnc.command().load_tool_table()
            until(lambda s: len([t for i, t in enumerate(s.tool_table) if i >= 1 and int(t.id) != -1]) == tools,
                  f"LinuxCNC holds {tools} tools")
            time.sleep(0.3)

        def rows_of(data: bytes) -> list[bytes]:
            return [ln for ln in data.split(b"\n") if ln[:1] in (b"T", b"t")]

        n_tools = len(rows_of(original))

        def m6(declared):
            """`M6` without a T, confirmed once; what HAL asked for."""
            asked = {}
            reply, refusal = ask("mdi", text="M6")
            if reply is None:
                return {"refused": refusal}
            t0 = time.monotonic()
            while time.monotonic() < t0 + 15:
                st = dict(c.status)
                if st.get("tool_change_requested") and st.get("tool_change_seq") is not None:
                    asked = {"tool": st.get("tool_change_tool"), "seq": st.get("tool_change_seq")}
                    c.request("confirm_tool_change", request=asked["seq"])
                    break
                if time.monotonic() > t0 + 3 and now().interp_state == linuxcnc.INTERP_IDLE:
                    break               # no change was asked for (the tool is in the spindle)
                time.sleep(0.05)
            until(lambda s: s.interp_state == linuxcnc.INTERP_IDLE, "the M6 ends", 20)
            time.sleep(0.3)
            return {"asked": asked, "declared": declared, "state": state()}

        def fresh():
            """The copy's own table in LinuxCNC, nothing prepared."""
            nr._short(c, "T0")
            until(lambda s: s.pocket_prepped <= 0 and s.interp_state == linuxcnc.INTERP_IDLE, "nothing prepared")
            raw(original, n_tools)
            if now().tool_in_spindle != 0:
                nr._routine(c, "T0 M6", declared=[0], require_busy=False, deadline=30.0)

        def prepare(tool):
            nr._short(c, f"T{tool}")
            until(lambda s: s.pocket_prepped > 0, f"T{tool} prepared")
            time.sleep(0.3)             # the reader's snapshot
            return state()

        cases = rep["cases"] = []

        # ---- prepared
        fresh()
        rep["at_T5"] = prepare(5)
        cases.append({"case": "prepared: index and pins", "pass": rep["at_T5"]["pocket_prepped"] == 5 and
                      rep["at_T5"]["pins"]["tool-prep-number"] == "5" and rep["at_T5"]["pins"]["tool-prep-pocket"] == "5"
                      and rep["at_T5"]["pins"]["tool-prepare"] == "FALSE"})
        why = PREPARED
        cases += [refused("prepared: delete T2", lambda: ask("delete_tool", tool_number=2), why),
                  refused("prepared: renumber T2 to T40", lambda: renumber(2, 40), why),
                  refused("prepared: T5 in another pocket", lambda: save(5, pocket=25), why),
                  admitted("prepared: T5's length", lambda: save(5, z_offset=22.5)),
                  admitted("prepared: T8's length", lambda: save(8, z_offset=68.5)),
                  admitted("prepared: an add behind every row", lambda: ask("add_tool", tool_number=90001, z_offset=1.0))]
        rep["m6_T5"] = m6([5])
        cases.append({"case": "prepared: the M6 takes T5", "pass": rep["m6_T5"].get("state", {}).get("spindle") == 5
                      and rep["m6_T5"]["state"]["pocket_prepped"] == -1})
        cases.append(admitted("changed: delete T2", lambda: ask("delete_tool", tool_number=2)))

        # ---- resting: T5 + M6 with T5 in the spindle
        prepare(5)
        rep["m6_T5_again"] = m6([])
        rest = state()
        cases.append({"case": "resting: the index stays prepared", "state": rest,
                      "pass": rest["pocket_prepped"] > 0 and rest["spindle"] == 5})
        cases.append(refused("resting: delete T3", lambda: ask("delete_tool", tool_number=3), why))
        nr._short(c, "T0")
        until(lambda s: s.pocket_prepped == 0, "T0")
        time.sleep(0.3)
        cases.append(admitted("resting: T0 admits it", lambda: ask("delete_tool", tool_number=3)))

        # ---- aborted
        fresh()
        prepare(6)
        c.request("abort")
        time.sleep(0.5)
        rep["after_abort"] = state()
        cases += [admitted("aborted: T6's length", lambda: save(6, z_offset=60.5)),
                  refused("aborted: delete T2", lambda: ask("delete_tool", tool_number=2), PREPARED)]

        # ---- e-stop
        fresh()
        prepare(6)
        c.request("estop")
        nr._wait(c, lambda s: s.get("is_estop") is True, 10, "E-Stop")
        time.sleep(0.5)
        rep["after_estop"] = state()
        cases.append({"case": "e-stop: the pins are cleared, the index stays", "state": rep["after_estop"],
                      "pass": rep["after_estop"]["pocket_prepped"] == 6 and rep["after_estop"]["pins"]["tool-prep-number"] == "0"
                      and rep["after_estop"]["pins"]["tool-prep-pocket"] == "0"})
        cases.append(refused("e-stop: T8's length", lambda: save(8, z_offset=69.0), CLEARED))
        c.request("estop_reset")
        nr._wait(c, lambda s: s.get("is_estop") is False, 10, "E-Stop reset")
        c.request("machine_on")
        nr._wait(c, lambda s: s.get("is_enabled") is True, 10, "machine on")
        nr._home_joints(c, 3)
        nr._short(c, "T0")
        until(lambda s: s.pocket_prepped == 0, "T0")
        time.sleep(0.3)
        cases.append(admitted("e-stop: after T0", lambda: save(8, z_offset=69.0)))

        # ---- moving
        fresh()
        nr._short(c, "G53 G0 X0 Y0")
        until(lambda s: s.inpos and s.interp_state == linuxcnc.INTERP_IDLE, "standing")
        time.sleep(0.5)
        c.request("set_mode", mode=linuxcnc.MODE_MANUAL)
        c.request("jog_cont", axis=0, vel=3.0)
        try:
            # a jog leaves STAT.inpos TRUE (measured: inpos True, vel 3.0): the
            # guard's standstill is the velocity's
            until(lambda s: abs(s.current_vel) > 0.5, "the jog runs")
            moving = refused("moving: T5's length", lambda: save(5, z_offset=23.0), MOVING)
            moving["interp_idle"], moving["inpos"] = now().interp_state == linuxcnc.INTERP_IDLE, bool(now().inpos)
        finally:
            c.request("jog_stop", axis=0)
        until(lambda s: s.inpos and abs(s.current_vel) < 0.001, "stopped")
        cases += [moving, admitted("moving: once it stands", lambda: save(5, z_offset=23.0))]
        c.request("machine_off")
        nr._wait(c, lambda s: s.get("is_enabled") is False, 10, "machine off")
        cases.append(admitted("off: T5's length", lambda: save(5, z_offset=23.5)))
        c.request("estop")
        nr._wait(c, lambda s: s.get("is_estop") is True, 10, "E-Stop")
        cases.append(admitted("e-stop, nothing prepared: T5's length", lambda: save(5, z_offset=24.0)))
        c.request("estop_reset")
        nr._wait(c, lambda s: s.get("is_estop") is False, 10, "E-Stop reset")
        c.request("machine_on")
        nr._wait(c, lambda s: s.get("is_enabled") is True, 10, "machine on")
        nr._home_joints(c, 3)

        # ---- the line
        cases.append(refused("ghost: T5's description", lambda: save(5, remark="r" * 207 + "T9 P9 Z5 D5"), TOO_LONG))

        # ---- evidence: what the guard prevents (never a pass by itself)
        fresh()
        prepare(5)
        raw(b"\n".join(ln for ln in original.split(b"\n") if not ln.startswith(b"T2 ")), n_tools - 1)
        rep["raw_shift"] = {"before_m6": state(), **m6([5])}
        fresh()
        prepare(5)
        raw(original.replace(b"T5 P5 ", b"T5 P25 "), n_tools)
        rep["raw_pocket"] = {"before_m6": state(), **m6([5])}
        fresh()
        raw(original.replace(b"T3 P3 ", b"#T3 P3 "), n_tools - 1)
        rep["raw_hash"] = {"memory": memory()[:5], "at_T5": prepare(5)}
        fresh()
        shift, pocket, hashed = (rep[k] for k in ("raw_shift", "raw_pocket", "raw_hash"))
        rep["evidence_as_the_source_reads"] = {
            "raw_shift: T6 in the spindle, HAL asked for 5": shift.get("state", {}).get("spindle") == 6
            and shift.get("asked", {}).get("tool") == 5,
            "raw_pocket: from pocket 25, prepared 5": pocket.get("state", {}).get("pins", {}).get("tool-from-pocket") == "25"
            and pocket["before_m6"]["pins"]["tool-prep-pocket"] == "5",
            "raw_hash: T5 at index 5": hashed["at_T5"]["pocket_prepped"] == 5,
        }
        rep["verdict"] = "PASS" if all(x["pass"] for x in cases) and len(cases) == 22 else "FAIL"
        rep["failed"] = [x["case"] for x in cases if not x["pass"]]
        return []
    return step


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scripts", type=Path, required=True)
    ap.add_argument("--run-dir", type=Path, required=True)
    ap.add_argument("--commit", required=True)
    a = ap.parse_args(argv)
    sys.path.insert(0, str(a.scripts.resolve() / "scripts"))
    import native_run as nr
    from test_support.heavy_lock import heavy_lock
    from test_support.system_host import SystemHost
    from test_support import restore_lan as rl
    if not nr.in_restore_unit():
        print("tg.native: runs only in the user unit `native-run` with the restore as its ExecStopPost")
        return 2
    steps = [nr.make_tree(a.commit, "3axis_xyz"), nr.make_copy("3axis_xyz"), nr.start_copy(), nr.connect_client(),
             ("tg-toolguard", make_step(nr))]
    with heavy_lock("tg", wait=3600):
        try:
            report = nr.run(SystemHost(), steps, a.run_dir)
        except rl.TakeOverRefused as e:
            print(f"tg.native: refused — {e}")
            return 2
    nr.write_json(a.run_dir / "report.json", report)
    print(f"tg.native: {'error: ' + report['error'] if report.get('error') else 'done'} — restore "
          f"{report['restore']['outcome']} → {a.run_dir / 'report.json'}")
    return 0 if not report.get("error") else 1


if __name__ == "__main__":
    raise SystemExit(main())
