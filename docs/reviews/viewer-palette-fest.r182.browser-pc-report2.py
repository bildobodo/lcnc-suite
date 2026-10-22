#!/usr/bin/env python3
"""Report of the browser-PC follow-up run (Codex R181 VP181-01), by the phase
marks of drive2.py (bpc.py marks.json). Three statements per phase, never
mixed (Codex point 1):

  execution  applyState's own time (apply_h)
  cadence    the gap between two applies (gap_h) — send rate + frame clock
  age        a status frame's socket receipt (WS worker) → its apply (age_h);
             gateway → socket is not in it, only bounded: the heartbeat round
             trip less the gateway's hold (rt_net_h, both legs)

Every quantile is read from the phase's POOLED histograms (the page's 3 s rows
carry fixed bins, viewerPerf.binOf) and given as the bin's UPPER edge; a
window's own p95 is never pooled. Plus: input delay (in_delay_h, ev_*), the
HAL heartbeat on BOTH sides — the gateway's pre-send gaps (gateway.log
[HB-WAKE] > 100 ms, [HB-STALL] > 200 ms) and the watchdog's receipt
([HB-RISING]: True-to-True > 200 ms in hal_watchdog.log, mapped to wall time
through the trip reset both sides record) — as a BOUND, not a quantile; the
parse jobs by id; memory: gateway and worker RSS (rss.jsonl), the page's own
ledgers (mem_*), the JS heap where the browser has one.

  bpc2.py report [--pages ID,ID] [--marks marks.json]
"""
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpc  # noqa: E402

RSS = os.path.join(HERE, "rss.jsonl")
WDLOG = os.path.join(bpc.LOGS, "hal_watchdog.log")


def width(lo):
    lo = float(lo)
    return 1 if lo < 20 else 2 if lo < 100 else 10 if lo < 500 else 50 if lo < 2000 else 500


def pool(rows, key):
    h = {}
    for r in rows:
        for lo, n in (r.get(key) or {}).items():
            h[float(lo)] = h.get(float(lo), 0) + n
    return h


def quant(h, qs=(0.5, 0.95, 0.99)):
    n = sum(h.values())
    if not n:
        return {"n": 0}
    out = {"n": n}
    bins = sorted(h)
    for q in qs:
        need, acc = math.ceil(q * n), 0
        for lo in bins:
            acc += h[lo]
            if acc >= need:
                out[f"p{int(q * 100)}"] = lo + width(lo)
                break
    return out


def share_over(h, ms):
    n = sum(h.values())
    return round(sum(c for lo, c in h.items() if lo >= ms) / n, 4) if n else None


def wd_anchor(trace):
    """The watchdog log's +ms origin on the wall clock: its last
    `[HB-DUMP] … reason=trip_reset` line and the last `wd.trip_reset` trace
    record are the same instant."""
    try:
        text = open(WDLOG).read()
    except OSError:
        return None, []
    dumps = [int(m.group(1)) for m in re.finditer(r"\[HB-DUMP\] \+(\d+)ms reason=trip_reset", text)]
    resets = [r for r in trace if r.get("tag") == "wd.trip_reset"]
    if not dumps or not resets:
        return None, []
    t0 = resets[-1]["t_wall_ns"] - dumps[-1] * 10**6
    rising = [(t0 + int(m.group(1)) * 10**6, int(m.group(2)))
              for m in re.finditer(r"\[HB-RISING\] \+(\d+)ms True-to-True gap (\d+)ms", text)]
    return t0, rising


def clock_steps(a, b):
    """The gateway's [HB] lines name wall time running away from monotonic
    time (skew): the VM was paused and its clock stepped — no gap measured
    across it is real, and the watchdog's wall mapping shifts by it."""
    with open(os.path.join(bpc.LOGS, "gateway.log"), "rb") as f:
        f.seek(a)
        text = f.read(max(0, b - a)).decode("utf-8", "replace")
    return [int(m.group(1)) for m in re.finditer(r"\[HB\] .* skew=(-?\d+)ms", text) if abs(int(m.group(1))) > 1000]


def rss_rows(a, b):
    out = []
    try:
        with open(RSS) as f:
            for line in f:
                r = json.loads(line)
                if a <= r["t_wall_ns"] < b:
                    out.append(r)
    except OSError:
        pass
    return out


def jobs(recs):
    """Every parse by its id: spawn, how it ended, its basis; at most one in
    flight is read off the order (a spawn before the previous job ended)."""
    js, order, overlap, open_jobs = {}, [], 0, set()
    for r in recs:
        t, j = r.get("tag", ""), r.get("job")
        if not t.startswith("gcode.") or j is None:
            continue
        if t == "gcode.spawn_start":
            if open_jobs:
                overlap += 1
            open_jobs.add(j)
            js[j] = {"job": j, "reason": r.get("reason"), "idx": r.get("active_idx"), "basis": r.get("basis"),
                     "pinned": bool(r.get("pinned")), "spawn_ns": r["t_wall_ns"], "events": []}
            order.append(j)
        if j in js:
            js[j]["events"].append(t[len("gcode."):])
            if t in ("gcode.parse_cancelled", "gcode.publish", "gcode.parse_timeout", "gcode.parse_worker_failed",
                     "gcode.reparse_verified_same", "gcode.pinned_unsupported", "gcode.preview_refresh_failed"):
                open_jobs.discard(j)
                js[j]["end_ns"] = r["t_wall_ns"]
                js[j]["ran_ms"] = round((r["t_wall_ns"] - js[j]["spawn_ns"]) / 1e6)
                if t == "gcode.publish":
                    js[j]["published"] = {"idx": r.get("active_idx"), "basis": r.get("basis"), "version": r.get("version")}
    return [js[j] for j in order], overlap


def _at_once(rr):
    """The most parse workers alive in one RSS sample."""
    per = {}
    for r in rr:
        if r["kind"] == "worker":
            per.setdefault(r["t_wall_ns"], set()).add(r["pid"])
    return max((len(v) for v in per.values()), default=0)


def phase(recs, gw, a, b, pages, rising):
    by = {}
    for r in recs:
        by.setdefault(r["tag"], []).append(r)
    perf = [r for r in by.get("browser.viewer.perf", []) if r.get("page") in pages]
    vis = [r for r in perf if r.get("vis") == "visible"]
    out = {"page_rows": len(perf), "hidden_rows": len(perf) - len(vis)}
    if vis:
        gap, age, app, rt = pool(vis, "gap_h"), pool(vis, "age_h"), pool(vis, "apply_h"), pool(vis, "rt_net_h")
        out["status"] = {
            "frames": sum(r.get("frames", 0) for r in vis),
            "execution_ms": {**quant(app), "max": max((r.get("apply_max_ms", 0) for r in vis), default=None)},
            "cadence_ms": {**quant(gap), "max": max((r.get("gap_max_ms", 0) for r in vis), default=None),
                           "share_over_50": share_over(gap, 50)},
            "age_ms": {**quant(age), "max": max((r.get("age_max_ms", 0) for r in vis), default=None),
                       "share_over_50": share_over(age, 50), "neg": sum(r.get("age_neg", 0) for r in vis)},
            "gateway_to_socket_bound_ms": {**quant(rt), "max": max((r.get("rt_net_max_ms", 0) for r in vis), default=None)},
        }
        ind, evd = pool(vis, "in_delay_h"), pool(vis, "ev_dur_h")
        out["input"] = {"delay_ms": {**quant(ind), "max": max((r.get("in_delay_max_ms", 0) for r in vis), default=None)},
                        "odd": sum(r.get("in_odd", 0) for r in vis),
                        "slow_to_paint_16ms": ({**quant(evd), "max": max((r.get("ev_dur_max_ms", 0) for r in vis), default=None)}
                                               if any("ev_n" in r for r in vis) else "no Event Timing in this browser")}
        out["main_thread_late_max_ms"] = max((r.get("mt_late_max_ms", 0) for r in vis), default=None)
        mem = {}
        for k in ("mem_path_cpu", "mem_path_gpu", "mem_contacts", "mem_contact_views", "heap_used_mb"):
            vals = [r[k] for r in vis if r.get(k) is not None]
            if vals:
                mem[k] = {"first": vals[0], "max": max(vals), "last": vals[-1]}
        out["page_memory"] = mem
    out["hal_heartbeat"] = {
        **gw,
        "watchdog_true_to_true_over_200ms": [g for t, g in rising if a <= t < b],
        "bound": "no receipt gap over 200 ms at the watchdog" if not [1 for t, g in rising if a <= t < b] else "see the gaps",
    }
    js, overlap = jobs(recs)
    out["parse_jobs"] = [{k: v for k, v in j.items() if k not in ("spawn_ns", "end_ns")} for j in js]
    out["parse_overlap"] = overlap
    rr = rss_rows(a, b)
    gwr = [r["rss_kb"] for r in rr if r["kind"] == "gateway"]
    wk = {}
    for r in rr:
        if r["kind"] == "worker":
            wk[r["pid"]] = max(wk.get(r["pid"], 0), r["rss_kb"])
    out["process_memory_kb"] = {
        "gateway": {"first": gwr[0], "max": max(gwr), "last": gwr[-1]} if gwr else None,
        "workers_peak": sorted(wk.values()),
        "workers_at_once_max": _at_once(rr),
    }
    col = {k[len("browser.collision."):]: [r for r in v if r.get("page") in pages]
           for k, v in by.items() if k.startswith("browser.collision.")}
    out["collision"] = {k: len(v) for k, v in col.items() if v}
    done = col.get("sweep_done", [])
    if done:
        out["collision"]["done_ms"] = [r.get("ms") for r in done]
    out["safety"] = sorted({k for k in by if k.startswith("safety.") or k.startswith("wd.trip")})
    return out


def report():
    if "--marks" in sys.argv:
        bpc.MARKS = sys.argv[sys.argv.index("--marks") + 1]
    marks = bpc.load_marks()
    if len(marks) < 2:
        sys.exit("need two marks")
    t_all = bpc.trace_lines(marks[0]["t_wall_ns"] - 3600 * 10**9, marks[-1]["t_wall_ns"] + 10**9)
    if "--pages" in sys.argv:
        pages = set(sys.argv[sys.argv.index("--pages") + 1].split(","))
    else:
        pages = {r.get("page") for r in t_all if r.get("tag") == "browser.viewer.perf" and r.get("host") not in bpc.LOCAL}
    anchor, rising = wd_anchor(t_all)
    res = []
    for m0, m1 in zip(marks, marks[1:]):
        a, b = m0["t_wall_ns"], m1["t_wall_ns"]
        recs = [r for r in t_all if a <= r["t_wall_ns"] < b]
        gw = {**bpc.gwlog_slice(m0["gwlog"], m1["gwlog"]), "vm_clock_steps_ms": clock_steps(m0["gwlog"], m1["gwlog"])}
        p = phase(recs, gw, a, b, pages, rising)
        res.append({"phase": m0["name"], "from": m0["local"], "to": m1["local"],
                    "seconds": round((b - a) / 1e9, 1), **p})
    print(json.dumps({"pages": sorted(pages), "watchdog_t0_wall_ns": anchor, "phases": res}, indent=1, default=str))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "report":
        report()
    else:
        sys.exit("usage: bpc2.py report [--pages ID,ID] [--marks marks.json]")
