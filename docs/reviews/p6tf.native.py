#!/usr/bin/env python3
"""P6 "tool files read" — the native confirmation on the VM's REAL LinuxCNC
(plan maschinentag.r465 v4 §9 "Native evidence", Codex R465), through the
native stage's machinery (scripts/native_run.py of the tree --scripts names:
record + stop the LAN sim, a run tree of --commit, a confined copy of the
3-axis profile, start, the steps, the restore in `finally`; the unit's
ExecStopPost is restore_lan.py). Nothing is committed from the run but its
record.

Cases:
  burst   a table of ~900 tools (~90 kB: io's save is ~25 write(2) calls),
          loaded by LinuxCNC; a PROGRAM of G10 L1 lines (io saves the file
          in place after each — the interpreter's saves, no _cmd_lock held)
          while the PRODUCT reader polls get_tool_table on a second
          connection and an independent sampler re-reads the file in a tight
          loop. Pass: the sampler saw torn states; no `complete` reply
          carries a torn content (its rev.table is never a torn content's
          sha256, its rows are every tool); reported: how many attempts and
          replies were not complete (zero = the run did not meet a torn
          state through the product — said so, never a pass by itself).
          An edit sent while the program runs: refused (toolTableWrite —
          the existing admission, not MT-TF1).
  prefix  the machine idle; the file truncated IN PLACE to a clean prefix
          (a paused io save; LinuxCNC's memory still holds every tool): the
          read is partial naming the missing tools; a save_tool is refused
          by MT-TF1 ("Tool table not confirmed — nothing written; read
          again"), the file unchanged, no reload (LinuxCNC still holds every
          tool). The full content back: the read complete, a save_tool
          admitted and its reload confirmed.

  python3 -I docs/reviews/p6tf.native.py --scripts <tree> --run-dir <dir> --commit <sha>
Runs only as the user unit `native-run` (restore as its ExecStopPost).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

TOOL = 1                       # the G10 L1 burst's tool (not loaded)
EDIT_TOOL = 2
EXTRA_TOOLS = range(101, 951)  # 850 more tools with long remarks: ~90 kB
N_BURST = 150
NOT_CONFIRMED = "Tool table not confirmed — nothing written; read again"

SAMPLER = r'''
import hashlib, json, os, sys
path, stop, out, n_total = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
seen, reads = {}, 0
while not os.path.exists(stop):
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as e:
        seen.setdefault("err:" + type(e).__name__, {"n": 0})["n"] += 1
        continue
    reads += 1
    key = hashlib.sha256(data).hexdigest()
    e = seen.get(key)
    if e is None:
        tools = sum(1 for ln in data.split(b"\n") if ln[:1] in (b"T", b"t"))
        full = data.endswith(b"\n") and tools == n_total
        seen[key] = {"n": 1, "len": len(data), "nl": data.endswith(b"\n"), "tools": tools, "full": full,
                     "tail": None if full else data[-90:].decode("latin-1")}
    else:
        e["n"] += 1
with open(out, "w") as f:
    json.dump({"reads": reads, "seen": seen}, f)
'''


def table_path(nr, ctx) -> Path:
    tt = (nr.lt.ini_values(ctx["ini"].read_text()).get(("EMCIO", "TOOL_TABLE")) or [""])[-1]
    return (ctx["config"] / tt).resolve()


def home_count(stat) -> int:
    stat.poll()
    return sum(1 for i, t in enumerate(stat.tool_table) if i >= 1 and int(t.id) != -1)


def make_step(nr, run_dir: Path, token_of):
    def step(ctx):
        import linuxcnc
        from test_support.live_session import SimulatorClient, Refused as SessionRefused
        c = ctx["client"]
        rep = ctx["report"].setdefault("p6tf", {})
        nr._home_joints(c, 3)
        table = table_path(nr, ctx)
        rep["table_file"] = str(table.relative_to(ctx["config"]))
        stat = linuxcnc.stat()

        # ---- the big table, loaded by LinuxCNC (a foreign NML reload: the
        # harness's; the gateway's edit would refuse a file LinuxCNC does not hold)
        cur = table.read_text(encoding="utf-8", errors="replace").rstrip("\n").splitlines()
        extra = [f"T{t} P{t} D+6.000000 Z+{40 + t / 100:.6f} ; long remark {t:04d} " + "x" * 72 for t in EXTRA_TOOLS]
        tmp = table.with_name(table.name + ".p6tftmp")
        tmp.write_text("\n".join(cur + extra) + "\n", encoding="utf-8")
        os.replace(tmp, table)
        n_total = sum(1 for ln in table.read_text().splitlines() if ln[:1] in "Tt")
        linuxcnc.command().load_tool_table()
        end = time.monotonic() + 10
        while home_count(stat) != n_total:
            if time.monotonic() > end:
                raise nr.Refused(f"LinuxCNC did not load the {n_total}-tool table: {home_count(stat)}")
            time.sleep(0.05)
        first = c.request("get_tool_table")
        rep["loaded"] = {"tools": n_total, "size": table.stat().st_size, "proof": first.get("proof", {}).get("state"),
                         "blksize": os.stat(table).st_blksize}
        if first.get("proof", {}).get("state") != "complete":
            raise nr.Refused(f"the loaded table does not read complete: {first.get('proof')}")

        # ---- burst: the program of G10 L1, the product reader, the sampler
        token = token_of(ctx)
        reader = SimulatorClient(token, session="p6tf-reader", auto_confirm=False)
        reader.start(arm=False)
        replies: list = []
        stop_reading = threading.Event()

        def read_loop():
            while not stop_reading.is_set():
                t = time.monotonic()
                try:
                    r = reader.request("get_tool_table")
                except SessionRefused as e:
                    replies.append({"t": t, "failed": str(e)[:200]})
                    continue
                p = r.get("proof") or {}
                replies.append({"t": t, "ms": round((time.monotonic() - t) * 1000, 1), "state": p.get("state"),
                                "attempts": p.get("attempts"), "why": p.get("why"), "rev": (r.get("rev") or {}).get("table"),
                                "tools": len(r.get("tools") or []), "unread": len(r.get("unread") or []),
                                "missing": len(p.get("missing") or []), "differs": [d.get("T") for d in p.get("differs") or []][:5]})
        sampler_py = run_dir / "sampler.py"
        sampler_py.write_text(SAMPLER)
        stop_file, out_file = run_dir / "sampler.stop", run_dir / "sampler.json"
        sampler = subprocess.Popen([sys.executable, "-I", str(sampler_py), str(table), str(stop_file), str(out_file), str(n_total)])
        program = "".join(f"G10 L1 P{TOOL} Z{50 + i * 0.1234567891 + 1.1e-9 * (i + 1):.10f}\n" for i in range(N_BURST)) + "M2\n"
        nr._load_program(ctx, c, "p6tf_burst.ngc", program)
        th = threading.Thread(target=read_loop, daemon=True)
        th.start()
        time.sleep(0.5)
        edit_during = None
        t0 = time.monotonic()
        try:
            nr._when_free(c, "cycle_start")
            nr._wait(c, lambda s: s.get("interp_state") not in (None, linuxcnc.INTERP_IDLE), 10, "the burst runs")
            try:
                c.request("save_tool", tool_number=EDIT_TOOL, z_offset=33.0, expected=nr._tool_row_expect(c, EDIT_TOOL))
                edit_during = {"refused": False}
            except SessionRefused as e:
                edit_during = {"refused": True, "error": str(e)[:200]}
            nr._wait(c, lambda s: s.get("interp_state") == linuxcnc.INTERP_IDLE, 180, "the burst ends")
        finally:
            burst_s = time.monotonic() - t0
            time.sleep(0.5)
            stop_reading.set()
            th.join(40)
            stop_file.write_text("stop")
            sampler.wait(60)
            reader.close()
        sampled = json.loads(out_file.read_text())
        seen = {k: v for k, v in sampled["seen"].items() if not k.startswith("err:")}
        torn = {k for k, v in seen.items() if not v["full"]}
        full = {k for k, v in seen.items() if v["full"]}
        got = [r for r in replies if "state" in r]
        complete = [r for r in got if r["state"] == "complete"]
        bad = [r for r in complete if r["rev"] in torn or r["tools"] != n_total]
        rep["burst"] = {
            "g10_lines": N_BURST, "seconds": round(burst_s, 1),
            "sampler": {"reads": sampled["reads"], "distinct": len(seen), "torn": len(torn), "full": len(full),
                        "torn_examples": [seen[k]["tail"] for k in list(torn)[:5]],
                        "errors": {k: v for k, v in sampled["seen"].items() if k.startswith("err:")}},
            "reader": {"replies": len(replies), "failed": [r for r in replies if "failed" in r][:5],
                       "complete": len(complete), "partial": sum(r["state"] == "partial" for r in got),
                       "unchecked": sum(r["state"] == "unchecked" for r in got),
                       "attempts_over_1": sum((r["attempts"] or 0) > 1 for r in got),
                       "complete_rev_a_sampled_full_content": sum(r["rev"] in full for r in complete),
                       "complete_with_a_torn_content_or_short": bad[:5],
                       "not_complete_examples": [r for r in got if r["state"] != "complete"][:8],
                       "ms_median": sorted(r["ms"] for r in got)[len(got) // 2] if got else None},
            "edit_during_the_burst": edit_during,
        }
        burst_ok = bool(torn) and not bad and edit_during is not None and edit_during["refused"]
        met = rep["burst"]["reader"]["partial"] + rep["burst"]["reader"]["attempts_over_1"]
        rep["burst"]["verdict"] = ("PASS" if burst_ok else "FAIL") + (
            "" if met else " — the product reader met no torn state (vacuous for the reader: said so)")

        # ---- prefix: a paused save at rest, the machine idle
        full_bytes = table.read_bytes()
        lines = full_bytes.split(b"\n")
        keep = int(len(lines) * 0.7)
        prefix = b"\n".join(lines[:keep]) + b"\n"
        dropped = n_total - sum(1 for ln in lines[:keep] if ln[:1] in (b"T", b"t"))
        mem_before = home_count(stat)
        with open(table, "r+b") as f:          # in place, like io (the same inode)
            f.truncate(len(prefix))
        read = c.request("get_tool_table")
        expect = {"table": read["table"], "tool": EDIT_TOOL,
                  "fields": {k: next(t for t in read["tools"] if t["T"] == EDIT_TOOL).get(k) for k in nr.TOOL_EDIT_FIELDS}}
        try:
            c.request("save_tool", tool_number=EDIT_TOOL, z_offset=34.0, expected=expect)
            refusal = None
        except SessionRefused as e:
            refusal = str(e)
        time.sleep(0.5)                        # a reload, had one been sent, lands in ~0.1 s
        prefix_case = {"read_state": read["proof"]["state"], "missing": len(read["proof"]["missing"]),
                       "dropped": dropped, "refusal": refusal,
                       "file_unchanged": table.read_bytes() == prefix,
                       "linuxcnc_tools_before": mem_before, "linuxcnc_tools_after": home_count(stat)}
        tmp.write_bytes(full_bytes)
        os.replace(tmp, table)
        back = c.request("get_tool_table")
        ok = c.request("save_tool", tool_number=EDIT_TOOL, z_offset=35.0, expected={
            "table": back["table"], "tool": EDIT_TOOL,
            "fields": {k: next(t for t in back["tools"] if t["T"] == EDIT_TOOL).get(k) for k in nr.TOOL_EDIT_FIELDS}})
        after = c.request("get_tool_table")
        prefix_case.update(restored_state=back["proof"]["state"], edit_after=ok.get("reload"),
                           read_after=after["proof"]["state"], attempts_after=after["proof"].get("attempts"),
                           t2_after=next(t for t in after["tools"] if t["T"] == EDIT_TOOL)["Z"])
        prefix_case["verdict"] = "PASS" if (
            prefix_case["read_state"] == "partial" and prefix_case["missing"] == dropped
            and refusal is not None and NOT_CONFIRMED in refusal and prefix_case["file_unchanged"]
            and prefix_case["linuxcnc_tools_after"] == mem_before == n_total
            and prefix_case["restored_state"] == "complete" and prefix_case["edit_after"] == "confirmed"
            and prefix_case["read_after"] == "complete" and prefix_case["attempts_after"] == 1
            and abs(prefix_case["t2_after"] - 35.0) < 1e-6) else "FAIL"
        rep["prefix"] = prefix_case

        # the gateway's own words in the run's trace
        events: dict = {}
        trace = ctx["run"] / "logs" / "trace.ndjson"
        if trace.exists():
            for ln in trace.read_text(errors="replace").splitlines():
                if '"tools.' in ln:
                    try:
                        ev = json.loads(ln).get("tag")
                    except ValueError:
                        continue
                    if isinstance(ev, str) and ev.startswith("tools."):
                        events[ev] = events.get(ev, 0) + 1
        rep["trace_tools_events"] = events
        rep["verdict"] = "PASS" if rep["burst"]["verdict"].startswith("PASS") and prefix_case["verdict"] == "PASS" else "FAIL"
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
        print("p6tf.native: runs only in the user unit `native-run` with the restore as its ExecStopPost")
        return 2

    def token_of(ctx):
        return (nr.lt.ini_values(ctx["ini"].read_text()).get(("DISPLAY", "WEBUI_TOKEN")) or [""])[-1]
    steps = [nr.make_tree(a.commit, "3axis_xyz"), nr.make_copy("3axis_xyz"), nr.start_copy(), nr.connect_client(),
             ("p6tf-toolfiles", make_step(nr, a.run_dir, token_of))]
    with heavy_lock("p6tf", wait=3600):
        try:
            report = nr.run(SystemHost(), steps, a.run_dir)
        except rl.TakeOverRefused as e:
            print(f"p6tf.native: refused — {e}")
            return 2
    nr.write_json(a.run_dir / "report.json", report)
    print(f"p6tf.native: {'error: ' + report['error'] if report.get('error') else 'done'} — restore "
          f"{report['restore']['outcome']} → {a.run_dir / 'report.json'}")
    return 0 if not report.get("error") else 1


if __name__ == "__main__":
    raise SystemExit(main())
