#!/usr/bin/env python3
"""Report of the browser-PC follow-up run (Codex R181 VP181-01, R182), by the
phase marks of drive2.py (marks.json). Every statement is either measured,
or NOT PROVEN with its reason — missing data is never a pass (Codex R182
VP182-04).

Status, three statements never mixed (Codex point 1):
  execution  applyState's own time (apply_h)
  cadence    the gap between two applies (gap_h)
  age        a status frame's socket receipt in the WS worker → the end of
             the applyState that shows it or a newer frame (age_h) — without
             the network, the viewer's first build and the render after it
  network    gateway → socket only BOUNDED: the heartbeat round trip timed in
             the worker less the gateway's hold (rt_net_h; unpaired answers
             rt_invalid)
Quantiles come from the phase's POOLED histograms (viewerPerf.binOf), each the
bin's upper edge. A page row covers the 3 s before its emission, which lies up
to the telemetry flush (2 s) before its receipt here: a row counts in a phase
only when [receipt − 6 s, receipt] lies inside it, the page was visible in it
and in the row before (≤ 4.5 s apart), and its render loop did not pause —
the rest is counted as excluded, by reason.

The HAL heartbeat, both sides: the gateway's pre-send gaps (gateway.log
[HB-WAKE] > 100 ms, [HB-STALL] > 200 ms) and the watchdog's receipt
([HB-RISING], True-to-True > 200 ms, as integer ms: a gap under 201 ms is not
listed) — on the wall clock only through drive2's own anchor (anchors.json:
its E-Stop reset's one dump line and one wd.trip_reset record), only while
the log is that instance's (the anchor line still in it), the watchdog's
records cover the phase, and the VM clock never stepped since the anchor.
Then "no gap over 200 ms" is a BOUND; otherwise not proven.

Memory: gateway and worker RSS (rss.jsonl, 0.25 s samples — sample maxima,
peaks between samples unseen), only where the samples cover the phase; the
page's own ledgers (mem_*, 3 s maxima); the JS heap where the browser has one.

Verdicts: S met only when every parse but the last was superseded and
cancelled under its own id, the last published with its own basis, no parse
overlapped another and never two workers lived at once (RSS covered); R
proven only when a run check began before a pinned parse's spawn and was
discarded after its publish (the parse ran while the check ran).

  bpc2.py report [--pages ID,ID] [--marks marks.json] [--anchors anchors.json]
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
ANCHORS = os.path.join(HERE, "anchors.json")
ROW_SPAN_NS = 6 * 10**9        # a row's 3 s window + the telemetry flush (2 s) + delivery
ROW_CHAIN_NS = int(4.5e9)      # a visible row before it, at most this much earlier
HB_HEADER = "[HB-RECV] +0ms watchdog ready, instrumentation active"


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


def page_rows(perf, pages, a, b):
    """The page rows that lie wholly in [a, b) with the page visible in them
    and in the row before; the others counted by reason."""
    rows = sorted((r for r in perf if r.get("page") in pages), key=lambda r: r["t_wall_ns"])
    prev = {}
    keep, excl = [], {}
    for r in rows:
        t, pg = r["t_wall_ns"], r.get("page")
        p = prev.get(pg)
        prev[pg] = r
        if not (a + ROW_SPAN_NS <= t < b):
            if a <= t < b + ROW_SPAN_NS:
                excl["phase_edge"] = excl.get("phase_edge", 0) + 1
            continue
        why = None
        if r.get("vis") != "visible":
            why = "hidden"
        elif p is None or p.get("vis") != "visible" or t - p["t_wall_ns"] > ROW_CHAIN_NS:
            why = "after_hidden_or_quiet"
        elif r.get("raf_pauses", 0):
            why = "render_loop_paused"
        if why:
            excl[why] = excl.get(why, 0) + 1
        else:
            keep.append(r)
    return keep, excl


def status_block(vis):
    gap, age, app, rt = pool(vis, "gap_h"), pool(vis, "age_h"), pool(vis, "apply_h"), pool(vis, "rt_net_h")
    return {
        "frames": sum(r.get("frames", 0) for r in vis),
        "execution_ms": {**quant(app), "max": max((r.get("apply_max_ms", 0) for r in vis), default=None)},
        "cadence_ms": {**quant(gap), "max": max((r.get("gap_max_ms", 0) for r in vis), default=None),
                       "share_over_50": share_over(gap, 50)},
        "age_ms": {**quant(age), "max": max((r.get("age_max_ms", 0) for r in vis), default=None),
                   "share_over_50": share_over(age, 50), "neg": sum(r.get("age_neg", 0) for r in vis),
                   "before_visibility_change": sum(r.get("age_vis_skip", 0) for r in vis),
                   "not_in_it": "the network, the viewer's first build, the render after the apply"},
        "gateway_to_socket_bound_ms": {**quant(rt), "max": max((r.get("rt_net_max_ms", 0) for r in vis), default=None),
                                       "invalid_pairs": sum(r.get("rt_invalid", 0) for r in vis)},
    }


def input_block(vis):
    ind, evd = pool(vis, "in_delay_h"), pool(vis, "ev_dur_h")
    return {"delay_ms": {**quant(ind), "max": max((r.get("in_delay_max_ms", 0) for r in vis), default=None)},
            "odd": sum(r.get("in_odd", 0) for r in vis),
            "slow_to_paint_16ms": ({**quant(evd), "max": max((r.get("ev_dur_max_ms", 0) for r in vis), default=None)}
                                   if any("ev_n" in r for r in vis) else "no Event Timing in this browser")}


def page_memory(vis):
    mem = {}
    for k in ("mem_path_cpu", "mem_path_gpu", "mem_contacts", "mem_contact_views", "heap_used_mb"):
        vals = [r[k] for r in vis if r.get(k) is not None]
        mem[k] = {"first": vals[0], "max_sampled": max(vals), "last": vals[-1]} if vals else "not collected"
    return mem


def clock_steps(gwlog_text):
    """[HB] lines with wall time running away from monotonic time: the VM was
    paused and its clock stepped."""
    return [int(m.group(1)) for m in re.finditer(r"\[HB\] .* skew=(-?\d+)ms", gwlog_text) if abs(int(m.group(1))) > 1000]


def watchdog(a, b, anchor, wd_text, recs, gw_since_anchor):
    """The watchdog's receipt gaps in [a, b) — or why not proven."""
    if anchor is None:
        return {"status": "not proven", "why": "no anchor (drive2's own E-Stop reset)"}
    if wd_text is None:
        return {"status": "not proven", "why": "no hal_watchdog.log"}
    if not wd_text.startswith(HB_HEADER):
        return {"status": "not proven", "why": "the log lacks the instrumentation header"}
    line = f"[HB-DUMP] +{anchor['wd_ms']}ms reason=trip_reset"
    if line not in wd_text[anchor["wd_log_bytes"]:]:
        return {"status": "not proven", "why": "the anchor's dump is not in this log (another watchdog instance?)"}
    if a < anchor["wall_ns"]:
        return {"status": "not proven", "why": "the phase begins before the anchor"}
    ticks = sorted(r["t_wall_ns"] for r in recs
                   if r.get("tag") == "wd.tick_summary" and r.get("pid") == anchor.get("wd_pid")
                   and a - 3e9 <= r["t_wall_ns"] < b + 3e9)
    holes = [y - x for x, y in zip(ticks, ticks[1:])]
    if not ticks or ticks[0] > a + 2e9 or ticks[-1] < b - 2e9 or (holes and max(holes) > 3e9):
        return {"status": "not proven", "why": "the anchored watchdog's own records do not cover the phase"}
    steps = clock_steps(gw_since_anchor)
    if steps:
        return {"status": "not proven", "why": f"the VM clock stepped since the anchor {steps} ms: the mapping does not hold"}
    t0 = anchor["wall_ns"] - anchor["wd_ms"] * 10**6
    gaps = [int(m.group(2)) for m in re.finditer(r"\[HB-RISING\] \+(\d+)ms True-to-True gap (\d+)ms", wd_text)
            if a <= t0 + int(m.group(1)) * 10**6 < b]
    return ({"status": "bound", "statement": "no True-to-True receipt gap over 200 ms (integer ms: every gap < 201 ms)"}
            if not gaps else {"status": "gaps", "gaps_ms": gaps})


def rss_block(rr, a, b):
    gw = sorted((r["t_wall_ns"], r["rss_kb"]) for r in rr if r["kind"] == "gateway")
    holes = [y[0] - x[0] for x, y in zip(gw, gw[1:])]
    if not gw or gw[0][0] > a + 1e9 or gw[-1][0] < b - 1e9 or (holes and max(holes) > 1e9):
        return {"status": "not collected", "why": "the 0.25 s samples do not cover the phase"}
    per, peak = {}, {}
    for r in rr:
        if r["kind"] == "worker":
            per.setdefault(r["t_wall_ns"], set()).add(r["pid"])
            peak[r["pid"]] = max(peak.get(r["pid"], 0), r["rss_kb"])
    return {"status": "sampled", "gateway_kb": {"first": gw[0][1], "max_sampled": max(v for _, v in gw), "last": gw[-1][1]},
            "workers_peak_kb": sorted(peak.values()),
            "workers_at_once_max": max((len(v) for v in per.values()), default=0)}


def jobs(recs):
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


def s_verdict(js, overlap, rss, switches):
    why = []
    if not js:
        return {"verdict": "S not met", "why": ["no parse jobs"]}
    for j in js[:-1]:
        if not {"reparse_superseded", "parse_cancelled"} <= set(j["events"]):
            why.append(f"job {j['job']} was not superseded and cancelled ({j['events']})")
    last = js[-1]
    if "published" not in last or last["published"]["basis"] != last["basis"]:
        why.append(f"the last job {last['job']} was not published with its own basis")
    if switches is not None and len(js) < switches:
        why.append(f"{len(js)} parse jobs for {switches} switches")
    if overlap:
        why.append(f"{overlap} spawn(s) before the previous parse ended")
    if rss.get("status") != "sampled":
        why.append("workers alive at once not collected")
    elif rss["workers_at_once_max"] > 1:
        why.append(f"{rss['workers_at_once_max']} workers alive at once")
    return {"verdict": "S met" if not why else "S not met", "why": why,
            "superseded": sum(1 for j in js if "parse_cancelled" in j["events"])}


def r_verdict(recs, js, pages):
    starts = [r["t_wall_ns"] for r in recs if r.get("tag") == "browser.collision.run_check_start" and r.get("page") in pages]
    disc = [r["t_wall_ns"] for r in recs if r.get("tag") == "browser.collision.run_check_discarded" and r.get("page") in pages]
    for j in (j for j in js if j["pinned"] and "published" in j):
        pub = j["end_ns"]
        before = [s for s in starts if s < j["spawn_ns"]]
        if not before:
            continue
        s0 = max(before)
        after = [d for d in disc if d > pub and not any(s0 < s < d for s in starts)]
        if after:
            return {"verdict": "R overlap proven",
                    "how": f"a run check began (received here) {round((j['spawn_ns'] - s0) / 1e9, 1)} s before pinned "
                           f"parse job {j['job']} spawned and was discarded {round((min(after) - pub) / 1e9, 1)} s "
                           "after that job published",
                    "job": j["job"]}
    return {"verdict": "R overlap not proven", "run_check_starts": len(starts), "discarded": len(disc),
            "pinned_published": [j["job"] for j in js if j["pinned"] and "published" in j]}


def read(path):
    try:
        with open(path, errors="replace") as f:
            return f.read()
    except OSError:
        return None


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


def _by(recs):
    by = {}
    for r in recs:
        by.setdefault(r.get("tag"), []).append(r)
    return by


def report():
    if "--marks" in sys.argv:
        bpc.MARKS = sys.argv[sys.argv.index("--marks") + 1]
    anchors = sys.argv[sys.argv.index("--anchors") + 1] if "--anchors" in sys.argv else ANCHORS
    marks = bpc.load_marks()
    if len(marks) < 2:
        sys.exit("need two marks")
    a_text = read(anchors)
    anchor = json.loads(a_text) if a_text else None
    t_all = bpc.trace_lines(marks[0]["t_wall_ns"] - 3600 * 10**9, marks[-1]["t_wall_ns"] + 10 * 10**9)
    if "--pages" in sys.argv:
        pages = set(sys.argv[sys.argv.index("--pages") + 1].split(","))
    else:
        pages = {r.get("page") for r in t_all if r.get("tag") == "browser.viewer.perf" and r.get("host") not in bpc.LOCAL}
    wd_text = read(os.path.join(bpc.LOGS, "hal_watchdog.log"))
    gw_path = os.path.join(bpc.LOGS, "gateway.log")
    sup = read(os.path.join(HERE, "supersede.json"))
    switches = len(json.loads(sup)) if sup else None
    perf = [r for r in t_all if r.get("tag") == "browser.viewer.perf"]
    res = []
    for m0, m1 in zip(marks, marks[1:]):
        a, b = m0["t_wall_ns"], m1["t_wall_ns"]
        recs = [r for r in t_all if a <= r["t_wall_ns"] < b]
        vis, excl = page_rows(perf, pages, a, b)
        p = {"phase": m0["name"], "from": m0["local"], "to": m1["local"], "seconds": round((b - a) / 1e9, 1),
             "page_rows": len(vis), "page_rows_excluded": excl}
        if vis:
            p["status"] = status_block(vis)
            p["input"] = input_block(vis)
            p["main_thread_late_max_ms"] = max((r.get("mt_late_max_ms", 0) for r in vis), default=None)
            p["page_memory"] = page_memory(vis)
        else:
            p["status"] = "not proven: no page row wholly in the phase"
        gw_since = ""
        if anchor:
            with open(gw_path, "rb") as f:
                f.seek(anchor["gwlog"])
                gw_since = f.read(max(0, m1["gwlog"] - anchor["gwlog"])).decode("utf-8", "replace")
        p["hal_heartbeat"] = {"gateway_pre_send": bpc.gwlog_slice(m0["gwlog"], m1["gwlog"]),
                              "watchdog_receipt": watchdog(a, b, anchor, wd_text, t_all, gw_since)}
        js, overlap = jobs(recs)
        p["parse_jobs"] = [{k: v for k, v in j.items() if k not in ("spawn_ns", "end_ns")} for j in js]
        p["parse_overlap"] = overlap
        p["process_memory"] = rss_block(rss_rows(a, b), a, b)
        if m0["name"] == "S_supersede":
            p["verdict"] = s_verdict(js, overlap, p["process_memory"], switches)
        if m0["name"] == "R_run":
            p["verdict"] = r_verdict(recs, js, pages)
        by = _by(recs)
        col = {k[len("browser.collision."):]: [r for r in v if r.get("page") in pages]
               for k, v in by.items() if k and k.startswith("browser.collision.")}
        p["collision"] = {k: len(v) for k, v in col.items() if v}
        if col.get("sweep_done"):
            p["collision"]["done_ms"] = [r.get("ms") for r in col["sweep_done"]]
        p["safety"] = sorted({k for k in by if k and (k.startswith("safety.") or k.startswith("wd.trip"))})
        res.append(p)
    print(json.dumps({"pages": sorted(pages), "anchor": anchor, "phases": res}, indent=1, default=str))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "report":
        report()
    else:
        sys.exit("usage: bpc2.py report [--pages ID,ID] [--marks marks.json] [--anchors anchors.json]")
