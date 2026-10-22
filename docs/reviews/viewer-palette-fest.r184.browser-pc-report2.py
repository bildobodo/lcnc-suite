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
bin's upper edge. A page row belongs to the phase it was RECEIVED in; it is
left out only on evidence of a hidden page (vis not visible, a visibility
change in its window, a paused render loop) — never for arriving late or
after a gap, which is what load does (Codex R183 VP183-04). How much of the
neighbouring phase an edge row may hold is not bounded (the timers promise
nothing under load), so the quantiles are given twice — all rows, and the
interior ones received ≥ 6 s after the phase began — and a gap of more than
4.5 s between rows makes the phase INCOMPLETE. The target (age p95 < 50 ms)
is met only on a complete phase whose two readings agree; else not proven.

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

Verdicts (Codex R183 VP183-01/02): S met only against drive2's switch log
(supersede.json) — each switch's job spawned for its target with its basis,
every one but the last superseded and cancelled under its id, the last
published with its basis, no other job in the phase, no overlap, never two
workers alive (RSS covered). R proven only on ONE page's clock: a run-check
sweep (sweep_start with a run generation … its own end, by request id) began
more than the gateway → socket bound B before the page received the first
frame saying the pinned parse ran (preview.parse_seen on, matched to the
job's spawn by the gateway's started_ms) and ended after the first frame
without it — so the sweep was computing when the gateway sent that first
frame, while the parse ran. B is the phase's largest paired round trip less
hold; without one, not proven. A finished result held on screen proves
nothing; an idle discard proves nothing.

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
ROW_SPAN_NS = 6 * 10**9        # interior rows: received at least this long after the phase began
ROW_CHAIN_NS = int(4.5e9)      # a longer gap between rows (or to a phase edge) leaves the phase incomplete
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
    """The page rows RECEIVED in [a, b): kept unless they show a hidden page.
    Returns (kept, excluded by reason, interior kept, coverage)."""
    rows = sorted((r for r in perf if r.get("page") in pages and a <= r["t_wall_ns"] < b), key=lambda r: r["t_wall_ns"])
    keep, excl = [], {}
    for r in rows:
        why = ("hidden" if r.get("vis") != "visible" else "visibility_changed" if r.get("vis_changes", 0)
               else "render_loop_paused" if r.get("raf_pauses", 0) else None)
        if why:
            excl[why] = excl.get(why, 0) + 1
        else:
            keep.append(r)
    edges = [a] + [r["t_wall_ns"] for r in rows] + [b]
    gaps = [y - x for x, y in zip(edges, edges[1:]) if y - x > ROW_CHAIN_NS]
    coverage = {"complete": not gaps, "gaps_over_4_5_s": len(gaps),
                "largest_gap_s": round(max(gaps) / 1e9, 1) if gaps else None}
    interior = [r for r in keep if r["t_wall_ns"] >= a + ROW_SPAN_NS]
    return keep, excl, interior, coverage


def target(vis, interior, coverage):
    """Age p95 < 50 ms: met only on a complete phase whose readings over all
    rows and over the interior ones agree."""
    q_all, q_in = quant(pool(vis, "age_h")), quant(pool(interior, "age_h"))
    if not q_all.get("n"):
        return {"verdict": "not proven", "why": "no aged frame"}
    met_all, met_in = q_all["p95"] <= 50, (q_in["p95"] <= 50 if q_in.get("n") else None)
    out = {"age_p95_all_rows": q_all["p95"], "age_p95_interior_rows": q_in.get("p95")}
    if not coverage["complete"]:
        return {**out, "verdict": "not proven", "why": "the phase's rows have gaps (incomplete)"}
    if met_in is None or met_all != met_in:
        return {**out, "verdict": "not proven", "why": "the phase edges decide it"}
    return {**out, "verdict": "met" if met_all else "not met"}


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
    """Against drive2's switch log: each switch's job, its target, basis and
    end; nothing else parsed; no overlap; one worker at a time."""
    if not switches:
        return {"verdict": "S not met", "why": ["no switch log (supersede.json)"]}
    by = {j["job"]: j for j in js}
    idx = {"G54": 1, "G55": 2}
    why = []
    for k, sw in enumerate(switches):
        j = by.get(sw.get("job"))
        if j is None:
            why.append(f"switch {sw.get('switch')}: job {sw.get('job')} not in the trace")
            continue
        if j["idx"] != idx.get(sw.get("to")) or j["basis"] != sw.get("basis"):
            why.append(f"switch {sw.get('switch')}: job {j['job']} parsed fixture {j['idx']} basis {j['basis']}, "
                       f"not {sw.get('to')} {sw.get('basis')}")
        if k < len(switches) - 1:
            if not {"reparse_superseded", "parse_cancelled"} <= set(j["events"]):
                why.append(f"switch {sw.get('switch')}: job {j['job']} was not superseded and cancelled ({j['events']})")
        elif "published" not in j or j["published"]["basis"] != j["basis"] or j["published"]["idx"] != idx.get(sw.get("to")):
            why.append(f"the last switch's job {j['job']} was not published with its basis and fixture")
    extra = sorted(set(by) - {sw.get("job") for sw in switches})
    if extra:
        why.append(f"jobs no switch asked for: {extra}")
    if overlap:
        why.append(f"{overlap} spawn(s) before the previous parse ended")
    if rss.get("status") != "sampled":
        why.append("workers alive at once not collected")
    elif rss["workers_at_once_max"] > 1:
        why.append(f"{rss['workers_at_once_max']} workers alive at once")
    return {"verdict": "S met" if not why else "S not met", "why": why,
            "superseded": sum(1 for j in js if "parse_cancelled" in j["events"]), "switches": len(switches)}


def r_verdict(recs, js, pages, bound_ms):
    """One page's clock: a run-check sweep active from more than B before the
    first frame showing the pinned parse until after the first frame without
    it."""
    if bound_ms is None:
        return {"verdict": "R overlap not proven", "why": "no gateway → socket bound in the phase"}
    tried = []
    for pg in sorted(pages):
        ev = [r for r in recs if r.get("page") == pg]
        starts = {r.get("id"): r for r in ev if r.get("tag") == "browser.collision.sweep_start" and r.get("run_gen") is not None}
        ends = {}
        for r in ev:
            if r.get("tag") in ("browser.collision.sweep_done", "browser.collision.sweep_stopped",
                                "browser.collision.sweep_failed", "browser.collision.sweep_cancelled"):
                ends.setdefault(r.get("id"), r)
        seen = [r for r in ev if r.get("tag") == "browser.preview.parse_seen"]
        for j in (j for j in js if j["pinned"] and "published" in j):
            on = [r for r in seen if r.get("state") == "on" and r.get("started_ms") is not None
                  and abs(r["started_ms"] - j["spawn_ns"] / 1e6) <= 50 and r.get("rx_ms") is not None]
            off = [r for r in seen if r.get("state") == "off" and on and r.get("started_ms") == on[0]["started_ms"]
                   and r.get("rx_ms") is not None]
            if not on or not off:
                tried.append(f"job {j['job']}: the page did not report the parse in flight on page {pg}")
                continue
            first, last = on[0]["rx_ms"], off[0]["rx_ms"]
            for sid, st in starts.items():
                en = ends.get(sid)
                if en is None:
                    continue
                if st["t_perf_ms"] < first - bound_ms and en["t_perf_ms"] > last:
                    return {"verdict": "R overlap proven", "job": j["job"], "page": pg, "sweep": sid,
                            "run_gen": st.get("run_gen"),
                            "phase": "provisional" if st.get("range_from") is not None else "full",
                            "how": f"sweep {sid} began {round(first - bound_ms - st['t_perf_ms'])} ms before the first frame "
                                   f"showing parse job {j['job']} less B = {bound_ms} ms, and ended "
                                   f"{round(en['t_perf_ms'] - last)} ms after the first frame without it ({en['tag'][18:]})"}
            tried.append(f"job {j['job']}: no run-check sweep on page {pg} spans it")
    return {"verdict": "R overlap not proven", "why": tried or ["no pinned parse published in the phase"]}


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
    switches = json.loads(sup) if sup else None
    perf = [r for r in t_all if r.get("tag") == "browser.viewer.perf"]
    res = []
    for m0, m1 in zip(marks, marks[1:]):
        a, b = m0["t_wall_ns"], m1["t_wall_ns"]
        recs = [r for r in t_all if a <= r["t_wall_ns"] < b]
        vis, excl, interior, coverage = page_rows(perf, pages, a, b)
        p = {"phase": m0["name"], "from": m0["local"], "to": m1["local"], "seconds": round((b - a) / 1e9, 1),
             "page_rows": len(vis), "page_rows_excluded": excl, "page_rows_interior": len(interior),
             "coverage": coverage}
        if vis:
            p["status"] = status_block(vis)
            p["status_interior"] = status_block(interior) if interior else "no interior row"
            p["target_age_p95_under_50ms"] = target(vis, interior, coverage)
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
            rt = [r for r in vis if r.get("rt_n")]
            p["verdict"] = r_verdict(recs, js, pages, max((r.get("rt_net_max_ms", 0) for r in rt), default=None))
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
