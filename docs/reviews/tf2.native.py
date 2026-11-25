#!/usr/bin/env python3
"""TF-2 — the native cases on the VM's REAL LinuxCNC (plan v3 §5, N1–N12,
Codex R479), through the native stage's machinery (scripts/native_run.py of the
tree --scripts names: record + stop the LAN sim, a run tree of --commit, a
confined copy of the 3-axis profile, start, the steps, the restore in
`finally`; the unit's ExecStopPost is restore_lan.py). Nothing is committed
from the run but its record.

Only the run's OWN `io` is held (SIGSTOP, at most 3 s, SIGCONT in `finally` and
by a timer). A foreign value write is `G10 L1` of a second NML client over MDI
(`command.tool_offset` leaves the message's pocket uninitialised,
emcmodule.cc 2.9.4:1013). Every case starts on the copy's own table, LinuxCNC
holding it, nothing prepared, no tool in the spindle.

  N1   hand edit (changed + added): partial → requested, values shown → the
       read complete → an edit admitted and confirmed.
  N2   an acknowledged removal: STAT without the tool, the library unchanged;
       without the acknowledgement refused.
  N3   the file changed between comparison and commit: refused, STAT unchanged.
  N4   `io` held, request, (a) the file changed by hand, (b) `G10 L1` of a
       second NML client, `io` on: "file changed"; the next read is the truth.
  N5   `io` held 2.6 s: not shown at the bound, exactly one tools.load_requested
       in the trace (nothing sent again); the later read shows it.
  N6   `io` held, the file moved away, `io` on: LinuxCNC's table EMPTY (F2), the
       reply not shown; the file back → request → shown.
  N7   TF-1c: commit B, hand-restore A and request it, hand-restore B's bytes
       and request — with a Z (shown) and with a pocket only (not awaited,
       complete).
  N8   T5 in the spindle with G43, its Z changed, request: STAT.tool_offset
       unchanged, index 0 the new value; after the next G43 the new one.
  N9   during a jog: refused by name; a prepared tool with a hand edit that
       moves its index: refused; nothing loaded.
  N10  E-Stop; machine off; 1000 tools in both: requested, shown, the lag.
  N11  an abort of a second client in the wait (io held): "not awaited"; then
       the read is the truth.
  N12  a refused save (Codex R478): hand edit T5 P9 Z11, the table read-only
       for io's user, io held, request, abort, io on, `G10 L1 P5 Z11`. VOID
       unless the pocket pin shows that the load was DISCARDED and the OLD
       pocket kept (R479). Pass: STAT shows Z 11, the file's bytes unchanged,
       the reply is values only (shown, or not awaited — never a load), and
       `T5` prepares the old pocket.

  python3 -I docs/reviews/tf2.native.py --scripts <tree> --run-dir <dir> --commit <sha>
Runs only as the user unit `native-run` (restore as its ExecStopPost).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import signal
import sys
import threading
import time
from pathlib import Path

PREPARED = "A tool is prepared — change to another tool or send T0"
MOVING = "Machine moving — wait until it stands"
FILE_CHANGED = "The file changed — check again"
NOT_CONFIRMED = "Removed tools not confirmed — check again"
BUSY = "starting or running"
HOLD_MAX_S = 3.0
CASES = [f"N{i}" for i in range(1, 13)]


def table_path(nr, ctx) -> Path:
    tt = (nr.lt.ini_values(ctx["ini"].read_text()).get(("EMCIO", "TOOL_TABLE")) or [""])[-1]
    return (ctx["config"] / tt).resolve()


def io_pid(ctx) -> int:
    """The run's own io: comm `io`, its command line naming the copy's INI."""
    found = []
    for p in Path("/proc").iterdir():
        if not p.name.isdigit():
            continue
        try:
            if (p / "comm").read_text().strip() in ("io", "iov2") and str(ctx["ini"]).encode() in (p / "cmdline").read_bytes():
                found.append(int(p.name))
        except OSError:
            continue
    if len(found) != 1:
        raise RuntimeError(f"the run's io process: {found}")
    return found[0]


class Held:
    """io stopped for at most HOLD_MAX_S, whatever happens in the block."""

    def __init__(self, pid: int):
        self.pid, self.timer, self.seconds = pid, None, 0.0

    def __enter__(self):
        os.kill(self.pid, signal.SIGSTOP)
        self.t0 = time.monotonic()
        self.timer = threading.Timer(HOLD_MAX_S, lambda: os.kill(self.pid, signal.SIGCONT))
        self.timer.daemon = True
        self.timer.start()
        end = time.monotonic() + 1
        while (Path(f"/proc/{self.pid}/stat").read_text().rsplit(")", 1)[1].split()[0]) != "T":
            if time.monotonic() > end:
                raise RuntimeError("io did not stop")
            time.sleep(0.005)
        return self

    def __exit__(self, *_exc):
        self.timer.cancel()
        os.kill(self.pid, signal.SIGCONT)
        self.seconds = round(time.monotonic() - self.t0, 3)


class Later:
    """One request in a thread (the client sends one at a time: nothing else is asked of it meanwhile)."""

    def __init__(self, fn):
        self.out = None
        self.error = None

        def run():
            try:
                self.out = fn()
            except BaseException as e:  # noqa: BLE001 — named, judged by the case
                self.error = f"{type(e).__name__}: {e}"
        self.t = threading.Thread(target=run, daemon=True)
        self.t.start()

    def get(self, timeout=20.0):
        self.t.join(timeout)
        if self.t.is_alive():
            raise RuntimeError("the request did not answer")
        return self.out, self.error


def make_step(nr):
    def step(ctx):
        import linuxcnc
        from test_support.live_session import Refused as SessionRefused, SimulatorClient
        from test_support import servo as sv
        c = ctx["client"]
        rep = ctx["report"].setdefault("tf2", {})
        nr._home_joints(c, 3)
        table = table_path(nr, ctx)
        library = ctx["tree"] / "lcnc-gateway/tool_library.json"
        trace = ctx["run"] / "logs/trace.ndjson"
        original = table.read_bytes()
        stat, gate = linuxcnc.stat(), sv.HalGate()
        io = io_pid(ctx)
        rep["io_pid"] = io

        def now():
            stat.poll()
            return stat

        def pin(name):
            return gate("getp", f"iocontrol.0.{name}").strip()

        def until(pred, what, timeout=10.0):
            end = time.monotonic() + timeout
            while not pred(now()):
                if time.monotonic() > end:
                    raise nr.Refused(f"{what}: {memory()[:8]}")
                time.sleep(0.02)

        def memory():
            return {int(t.id): round(t.zoffset, 6) for i, t in enumerate(now().tool_table) if i >= 1 and int(t.id) != -1}

        def put(data: bytes):
            """A hand edit: the file replaced."""
            tmp = table.with_name(table.name + ".tf2tmp")
            tmp.write_bytes(data)
            os.replace(tmp, table)

        def row(data: bytes, tool: int, **over) -> bytes:
            """`data` with T<tool>'s words replaced (Z=…, P=…)."""
            out = []
            for ln in data.split(b"\n"):
                if re.match(rb"T%d\s" % tool, ln):
                    for k, v in over.items():
                        ln = re.sub(rb"(?<= )%s[^ ;]+" % k.encode(), f"{k}{v}".encode(), ln, count=1)
                out.append(ln)
            return b"\n".join(out)

        def without(data: bytes, tool: int) -> bytes:
            return b"\n".join(ln for ln in data.split(b"\n") if not re.match(rb"T%d\s" % tool, ln))

        def ask(client, cmd, **kw):
            """(reply, None) or (None, the refusal); a held start claim is asked again."""
            end = time.monotonic() + 10
            while True:
                try:
                    return client.request(cmd, **kw), None
                except SessionRefused as e:
                    if BUSY not in str(e) or time.monotonic() > end:
                        return None, str(e)
                    time.sleep(0.1)

        def preview():
            return c.request("tool_table_preview")

        def request(p, removed=None):
            return ask(c, "tool_table_load", base=p["base"],
                       removed=[t["T"] for t in p["removed"]] if removed is None else removed)

        def read():
            r = c.request("get_tool_table")
            return {"state": r["proof"]["state"], "load_refusal": r.get("load_refusal"), "differs": r["proof"]["differs"],
                    "missing": r["proof"]["missing"], "owner": bool(r.get("owner", {}).get("link"))}

        def requested_in_trace():
            return sum('"tools.load_requested"' in ln for ln in trace.read_text(errors="replace").splitlines())

        def quiet():
            """No job awaited any more (a complete basis is observed 2 s)."""
            end = time.monotonic() + 5
            while (preview().get("refusal") or "").startswith("LinuxCNC still loads"):
                if time.monotonic() > end:
                    raise nr.Refused("the last job never ended")
                time.sleep(0.1)

        def fresh():
            """The copy's own table in LinuxCNC, nothing prepared, no tool in the spindle."""
            table.chmod(0o644)
            put(original)
            linuxcnc.command().load_tool_table()
            want = {int(m.group(1)): None for m in re.finditer(rb"(?m)^T(\d+)\s", original)}
            until(lambda s: set(memory()) == set(want), "LinuxCNC holds the copy's table")
            if now().tool_in_spindle != 0:
                nr._routine(c, "T0 M6", declared=[0], require_busy=False, deadline=30.0)
            nr._short(c, "T0")
            nr._short(c, "G49")
            until(lambda s: s.pocket_prepped <= 0 and s.interp_state == linuxcnc.INTERP_IDLE, "nothing prepared")
            time.sleep(0.4)             # the reader's snapshot, the gateway's watch
            quiet()
            if read()["state"] != "complete":
                raise nr.Refused(f"the copy's table does not read complete: {read()}")

        def foreign_mdi(text):
            """A second NML client's MDI line (the controller in MDI already)."""
            cmd = linuxcnc.command()
            cmd.mdi(text)
            return cmd

        def to_mdi():
            nr._short(c, "G4 P0")
            until(lambda s: s.task_mode == linuxcnc.MODE_MDI and s.interp_state == linuxcnc.INTERP_IDLE, "MDI")
            time.sleep(0.3)

        cases = rep["cases"] = {}

        def case(name, ok, **facts):
            cases.setdefault(name, {"pass": True, "facts": []})
            cases[name]["facts"].append({**facts, "ok": bool(ok)})
            cases[name]["pass"] = cases[name]["pass"] and bool(ok)

        # ---- N1
        fresh()
        z5 = memory()[5]
        edited = row(original, 5, Z=f"{z5 + 1:+.6f}")
        edited = edited.rstrip(b"\n") + b"\nT90 P90 Z+12.500000 D+6.000000 ;added\n"
        put(edited)
        before = read()
        p = preview()
        r, refusal = request(p)
        after = read()
        saved, why = ask(c, "save_tool", tool_number=8, z_offset=memory()[8] + 0.5, expected=nr._tool_row_expect(c, 8))
        case("N1", before["state"] == "partial" and before["load_refusal"] is None and p["basis"] == "partial"
             and [t["T"] for t in p["changed"]] == [5] and [t["T"] for t in p["added"]] == [90] and r is not None
             and (r["load"], r["values"]) == ("requested", "shown") and after["state"] == "complete"
             and (saved or {}).get("reload") == "confirmed", before=before, reply=r, refusal=refusal, after=after, edit=saved, edit_refusal=why)

        # ---- N2
        fresh()
        lib = library.read_bytes() if library.exists() else None
        put(without(original, 14))
        p = preview()
        none, refused = request(p, removed=[])
        r, refusal = request(p)
        case("N2", [t["T"] for t in p["removed"]] == [14] and none is None and NOT_CONFIRMED in (refused or "")
             and (r or {}).get("values") == "shown" and 14 not in memory()
             and lib == (library.read_bytes() if library.exists() else None), refused=refused, reply=r, refusal=refusal)

        # ---- N3
        fresh()
        put(row(original, 5, Z=f"{z5 + 1:+.6f}"))
        p = preview()
        put(row(original, 5, Z=f"{z5 + 2:+.6f}"))
        mem, n = memory(), requested_in_trace()
        r, refusal = request(p)
        time.sleep(0.5)
        case("N3", r is None and FILE_CHANGED in (refusal or "") and memory() == mem and requested_in_trace() == n, refusal=refusal)

        # ---- N4 (a) a hand edit, (b) a foreign G10 L1 while the request waits in io
        fresh()
        put(row(original, 5, Z=f"{z5 + 1:+.6f}"))
        p = preview()
        with Held(io) as h:
            job = Later(lambda: request(p))
            time.sleep(0.4)             # the request reached task and io's buffer
            put(row(original, 5, Z=f"{z5 + 3:+.6f}"))
        (r, refusal), err = job.get()
        time.sleep(1.0)
        case("N4", err is None and (r or {}).get("why") == "file changed", which="a", reply=r, refusal=refusal, error=err,
             held_s=h.seconds, read=read(), z5=memory().get(5))
        fresh()
        to_mdi()
        put(row(original, 5, Z=f"{z5 + 1:+.6f}"))
        p = preview()
        with Held(io) as h:
            job = Later(lambda: request(p))
            time.sleep(0.4)
            foreign_mdi(f"G10 L1 P5 Z{z5 + 4:.4f}")
            time.sleep(0.2)
        (r, refusal), err = job.get()
        time.sleep(1.5)
        seen = read()
        case("N4", err is None and (r or {}).get("load") == "requested" and (r or {}).get("values") == "not shown"
             and (r or {}).get("why") in ("file changed", "in time"), which="b", reply=r, refusal=refusal, error=err,
             held_s=h.seconds, read=seen, z5=memory().get(5), expected="file changed (io saved the file)")

        # ---- N5
        fresh()
        put(row(original, 5, Z=f"{z5 + 1:+.6f}"))
        p = preview()
        n = requested_in_trace()
        with Held(io) as h:
            job = Later(lambda: request(p))
            time.sleep(2.6)
        (r, refusal), err = job.get()
        until(lambda s: memory().get(5) == round(z5 + 1, 6), "the load ran after the hold")
        later = read()
        case("N5", (r or {}).get("values") == "not shown" and (r or {}).get("why") == "in time" and requested_in_trace() - n == 1
             and later["state"] == "complete", reply=r, refusal=refusal, error=err, held_s=h.seconds, later=later)

        # ---- N6
        fresh()
        put(row(original, 5, Z=f"{z5 + 1:+.6f}"))
        p = preview()
        away = table.with_name(table.name + ".tf2away")
        with Held(io) as h:
            job = Later(lambda: request(p))
            time.sleep(0.4)
            os.rename(table, away)
        try:
            (r, refusal), err = job.get()
            end = time.monotonic() + 5
            while memory() and time.monotonic() < end:
                time.sleep(0.05)
            emptied = memory() == {}
        finally:
            os.rename(away, table)
        time.sleep(0.5)
        p2 = preview()
        back, why2 = request(p2)
        case("N6", emptied and (r or {}).get("values") == "not shown" and (back or {}).get("values") == "shown"
             and memory().get(5) == round(z5 + 1, 6), reply=r, refusal=refusal, error=err, emptied=emptied,
             preview_refusal=p2.get("refusal"), back=back, back_refusal=why2, held_s=h.seconds)

        # ---- N7
        for what, over, want in (("a Z", {"z_offset": z5 + 2}, "shown"), ("a pocket only", {"pocket": 25}, "not awaited")):
            fresh()
            a = table.read_bytes()
            saved, why = ask(c, "save_tool", tool_number=5, expected=nr._tool_row_expect(c, 5), **over)
            b = table.read_bytes()
            put(a)
            ra, wa = request(preview())
            quiet()
            put(b)
            rb, wb = request(preview())
            quiet()
            nr._short(c, "T5")
            until(lambda s: s.pocket_prepped > 0, "T5 prepared")
            pocket = pin("tool-prep-pocket")
            nr._short(c, "T0")
            case("N7", saved is not None and (rb or {}).get("load") == "requested" and (rb or {}).get("values") == want
                 and memory().get(5) == (round(z5 + 2, 6) if want == "shown" else z5)
                 and (want == "shown" or pocket == "25"), what=what, commit=saved, commit_refusal=why, a=ra, a_refusal=wa,
                 b=rb, b_refusal=wb, pocket=pocket)

        # ---- N8
        fresh()
        nr._routine(c, "T5 M6", declared=[5], require_busy=False, deadline=30.0)
        nr._short(c, "G43 H5")
        until(lambda s: abs(s.tool_offset[2] - z5) < 1e-6, "G43 H5")
        put(row(original, 5, Z=f"{z5 + 1:+.6f}"))
        p = preview()
        r, refusal = request(p)
        in_effect, index0 = now().tool_offset[2], now().tool_table[0]
        nr._short(c, "G43 H5")
        until(lambda s: abs(s.tool_offset[2] - (z5 + 1)) < 1e-6, "the next G43 takes it")
        case("N8", p["spindle"] == 5 and (r or {}).get("values") == "shown" and abs(in_effect - z5) < 1e-6
             and int(index0.id) == 5 and abs(index0.zoffset - (z5 + 1)) < 1e-6, reply=r, refusal=refusal,
             in_effect=in_effect, index0=[int(index0.id), index0.zoffset])
        # … and a spindle tool missing in the file is never loadable
        put(without(original, 5))
        p = preview()
        case("N8", p.get("refusal") == "T5 is in the spindle, not in the file — restore it", refusal=p.get("refusal"))

        # ---- N9
        fresh()
        nr._short(c, "G53 G0 X0 Y0")
        until(lambda s: s.inpos and s.interp_state == linuxcnc.INTERP_IDLE, "standing")
        put(row(original, 5, Z=f"{z5 + 1:+.6f}"))
        p = preview()
        mem, n = memory(), requested_in_trace()
        c.request("set_mode", mode=linuxcnc.MODE_MANUAL)
        c.request("jog_cont", axis=0, vel=3.0)
        try:
            until(lambda s: abs(s.current_vel) > 0.5, "the jog runs")
            r, refusal = request(p)
        finally:
            c.request("jog_stop", axis=0)
        until(lambda s: s.inpos and abs(s.current_vel) < 0.001, "stopped")
        case("N9", r is None and MOVING in (refusal or "") and memory() == mem and requested_in_trace() == n, which="jog", refusal=refusal)
        fresh()
        nr._short(c, "T5")
        until(lambda s: s.pocket_prepped > 0, "T5 prepared")
        time.sleep(0.4)
        put(without(original, 2))
        p = preview()
        mem, n = memory(), requested_in_trace()
        r, refusal = request(p)
        case("N9", r is None and PREPARED in (refusal or "") and memory() == mem and requested_in_trace() == n, which="prepared", refusal=refusal)

        # ---- N10
        fresh()
        c.request("machine_off")
        nr._wait(c, lambda s: s.get("is_enabled") is False, 10, "machine off")
        put(row(original, 5, Z=f"{z5 + 1:+.6f}"))
        p = preview()
        t0 = time.monotonic()
        r, refusal = request(p)
        case("N10", (r or {}).get("values") == "shown", which="off", reply=r, refusal=refusal, ms=round((time.monotonic() - t0) * 1000))
        c.request("estop")
        nr._wait(c, lambda s: s.get("is_estop") is True, 10, "E-Stop")
        put(row(original, 5, Z=f"{z5 + 2:+.6f}"))
        p = preview()
        t0 = time.monotonic()
        r, refusal = request(p)
        case("N10", (r or {}).get("values") == "shown", which="E-Stop", reply=r, refusal=refusal, ms=round((time.monotonic() - t0) * 1000))
        c.request("estop_reset")
        nr._wait(c, lambda s: s.get("is_estop") is False, 10, "E-Stop reset")
        c.request("machine_on")
        nr._wait(c, lambda s: s.get("is_enabled") is True, 10, "machine on")
        nr._home_joints(c, 3)
        fresh()
        many = b"".join(b"T%d P%d Z%+f D+6.000000 ;%d\n" % (t, t, 10 + t * 0.001, t) for t in range(1, 1001))
        put(many)
        linuxcnc.command().load_tool_table()
        until(lambda s: len(memory()) == 1000, "LinuxCNC holds 1000 tools")
        time.sleep(0.5)
        put(many.replace(b"Z+10.500000", b"Z+99.000000"))
        p = preview()
        t0 = time.monotonic()
        r, refusal = request(p)
        case("N10", len(p.get("changed") or []) == 1 and (r or {}).get("values") == "shown", which="1000 tools", reply=r,
             refusal=refusal, preview_refusal=p.get("refusal"), ms=round((time.monotonic() - t0) * 1000))

        # ---- N11
        fresh()
        put(row(original, 5, Z=f"{z5 + 1:+.6f}"))
        p = preview()
        token = (nr.lt.ini_values(ctx["ini"].read_text()).get(("DISPLAY", "WEBUI_TOKEN")) or [""])[-1]
        other = SimulatorClient(token, session="tf2-other", auto_confirm=False)
        other.start()
        try:
            with Held(io) as h:
                job = Later(lambda: request(p))
                time.sleep(0.6)
                aborted, abort_refusal = ask(other, "abort")
                time.sleep(0.2)
            (r, refusal), err = job.get()
        finally:
            other.close()
        time.sleep(1.0)
        case("N11", (r or {}).get("load") == "requested" and (r or {}).get("values") == "not awaited" and aborted is not None,
             reply=r, refusal=refusal, error=err, abort_refusal=abort_refusal, held_s=h.seconds, read=read(), z5=memory().get(5))

        # ---- N12
        fresh()
        to_mdi()
        put(row(original, 5, P=9, Z="+11.000000"))
        table.chmod(0o444)
        edited = table.read_bytes()
        p = preview()
        n = requested_in_trace()
        try:
            with Held(io) as h:
                job = Later(lambda: request(p))
                time.sleep(0.5)
                linuxcnc.command().abort()      # (a second NML client's: it drops what io has not read)
                time.sleep(0.2)
            until(lambda s: s.interp_state == linuxcnc.INTERP_IDLE, "idle after the abort")
            time.sleep(0.3)
            discarded_z = memory().get(5)
            cmd = linuxcnc.command()
            cmd.mode(linuxcnc.MODE_MDI)
            cmd.wait_complete(2)
            cmd.mdi("G10 L1 P5 Z11")
            end = time.monotonic() + 3
            while memory().get(5) != 11.0 and time.monotonic() < end:
                time.sleep(0.02)
            (r, refusal), err = job.get()
            time.sleep(0.5)
            z, unchanged = memory().get(5), table.read_bytes() == edited
            c.request("abort")                  # the refused save left io's error behind
            time.sleep(0.5)
            nr._short(c, "T5")
            until(lambda s: s.pocket_prepped > 0, "T5 prepared")
            pocket = pin("tool-prep-pocket")
            nr._short(c, "T0")
        finally:
            table.chmod(0o644)
        seen = read()
        void = not (discarded_z == z5 and pocket == "5")
        cases["N12"] = {"pass": not void and z == 11.0 and unchanged and (r or {}).get("load") == "requested"
                        and (r or {}).get("values") in ("shown", "not awaited") and requested_in_trace() - n == 1
                        and not re.search(r"loaded|confirmed", json.dumps(r or {})),
                        "void": void, "facts": [{"reply": r, "refusal": refusal, "error": err, "z5": z, "z5_after_abort": discarded_z,
                                                 "file_unchanged": unchanged, "pocket_after_T5": pocket, "read": seen, "held_s": h.seconds}]}

        fresh()
        rep["verdict"] = "PASS" if sorted(cases, key=CASES.index) == CASES and all(x["pass"] for x in cases.values()) else "FAIL"
        rep["failed"] = [k for k, x in cases.items() if not x["pass"]]
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
        print("tf2.native: runs only in the user unit `native-run` with the restore as its ExecStopPost")
        return 2
    steps = [nr.make_tree(a.commit, "3axis_xyz"), nr.make_copy("3axis_xyz"), nr.start_copy(), nr.connect_client(),
             ("tf2-toolload", make_step(nr))]
    with heavy_lock("tf2", wait=3600):
        try:
            report = nr.run(SystemHost(), steps, a.run_dir)
        except rl.TakeOverRefused as e:
            print(f"tf2.native: refused — {e}")
            return 2
    nr.write_json(a.run_dir / "report.json", report)
    print(f"tf2.native: {'error: ' + report['error'] if report.get('error') else 'done'} — verdict "
          f"{report.get('tf2', {}).get('verdict')}, restore {report['restore']['outcome']} → {a.run_dir / 'report.json'}")
    return 0 if not report.get("error") and report.get("tf2", {}).get("verdict") == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
