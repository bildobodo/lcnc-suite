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
change in its window) — never for arriving late, after a gap or with a
paused render loop, which is what load does (Codex R183/R184 VP183-04). How much of the
neighbouring phase an edge row may hold is not bounded (the timers promise
nothing under load), so the quantiles are given twice — all rows, and the
interior ones received at least their own ACTUAL window (win_ms) plus 3 s
after the phase began — and a gap of more than
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

Verdicts (Codex R183 VP183-02, R185): S met only against drive2's switch log
(supersede.json) — each switch's job spawned for its target with its basis,
every one but the last superseded and cancelled under its id, the last
published with its basis, no other job in the phase, no overlap, never two
workers alive (RSS covered). R by the R185 contract, from the ORDER of
events only — no clock offset between the VM and the page: a pinned parse's
own bounds p0, p1 (the worker's monotonic clock around parse(ctx),
gcode.parse_span); two paired heartbeats A, B of one page whose gateway
stamps g (the same clock, after the heartbeat's receipt and before the
answer's send, by the same gateway pid) lie inside it, p0 < g_A < g_B < p1;
then the page-clock window [hr_A, hs_B] lies inside the parse whenever
hr_A < hs_B. A REAL slice of a run check's sweep (stamped where it ran,
collision.sweep_witness) inside that window is the witness. Every page
stamp is taken as uncertain by PAGE_STAMP_MS (both intervals shrink by it),
g by its µs rounding. A worker whose word read ahead of the page's clock
(a context created after a host sleep) or a page whose WebSocket worker did
(age_neg) gives no witness. One witness proves R; its original stamps and
names are kept (r_proof.json).

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
ROW_DELIVERY_NS = 3 * 10**9    # interior rows: received at least their own window (win_ms, the actual
                               # span — Codex R185; window_ms is the timer's period only) plus this
                               # (the 2 s telemetry flush, 1 s slack) after the phase began
ROW_CHAIN_NS = int(4.5e9)      # a longer gap between rows (or to a phase edge) leaves the phase incomplete
R_LATE_NS = 15 * 10**9         # R's page rows and witness words may arrive up to this long after the phase
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


def row_span_ns(r):
    """How far back a row's data may reach from its receipt: its own window
    (the actual one where the page says it) and the delivery."""
    w = r.get("win_ms") if isinstance(r.get("win_ms"), (int, float)) else r.get("window_ms", 3000)
    return int(w * 10**6) + ROW_DELIVERY_NS


def page_rows(perf, pages, a, b):
    """The page rows RECEIVED in [a, b): kept unless they show a hidden page.
    Returns (kept, excluded by reason, interior kept, coverage)."""
    rows = sorted((r for r in perf if r.get("page") in pages and a <= r["t_wall_ns"] < b), key=lambda r: r["t_wall_ns"])
    keep, excl = [], {}
    for r in rows:
        # a paused render loop is no evidence of a hidden page: a long stall
        # of a visible page counts the same (Codex R184 VP183-04) — kept
        why = "hidden" if r.get("vis") != "visible" else "visibility_changed" if r.get("vis_changes", 0) else None
        if why:
            excl[why] = excl.get(why, 0) + 1
        else:
            keep.append(r)
    edges = [a] + [r["t_wall_ns"] for r in rows] + [b]
    gaps = [y - x for x, y in zip(edges, edges[1:]) if y - x > ROW_CHAIN_NS]
    coverage = {"complete": not gaps, "gaps_over_4_5_s": len(gaps),
                "largest_gap_s": round(max(gaps) / 1e9, 1) if gaps else None}
    interior = [r for r in keep if r["t_wall_ns"] >= a + row_span_ns(r)]
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


PAGE_STAMP_MS = 2.0     # a page stamp (timeOrigin + now): Firefox coarsens each of the two to 1 ms
G_STAMP_MS = 0.001      # the gateway's g_mono_ms, rounded to µs


def hb_pairs_of(perf, pages, a, b):
    """The paired heartbeats of each page's rows received in [a, b): seq, send,
    receipt (page clock, ms), g (gateway monotonic ms), gateway pid; and the
    pages whose WebSocket worker read ahead of the page (age_neg)."""
    out, ahead = {}, set()
    for r in perf:
        if r.get("page") not in pages or not (a <= r["t_wall_ns"] < b):
            continue
        if r.get("age_neg"):
            ahead.add(r.get("page"))
        for p in r.get("hb_pairs") or []:
            if isinstance(p, list) and len(p) == 5 and all(isinstance(x, (int, float)) for x in p):
                out.setdefault(r.get("page"), []).append({"seq": p[0], "hs": p[1], "hr": p[2], "g": p[3], "pid": p[4]})
    return out, ahead


def slices_of(recs, pages):
    """Each run check's real slices with the word that brought them; words
    whose worker read ahead of the page are set apart."""
    out, ahead = [], []
    for r in recs:
        if r.get("tag") != "browser.collision.sweep_witness" or r.get("page") not in pages or r.get("run_gen") is None:
            continue
        s = r.get("s") or []
        if not isinstance(r.get("ahead_ms"), (int, float)) or r["ahead_ms"] > PAGE_STAMP_MS:
            ahead.append({k: r.get(k) for k in ("id", "run_gen", "shard", "ahead_ms")})
            continue
        for i in range(0, len(s) - 1, 2):
            out.append({"page": r.get("page"), "s0": s[i], "s1": s[i + 1], "id": r.get("id"), "run_gen": r.get("run_gen"),
                        "range_from": r.get("range_from"), "shard": r.get("shard"), "gen": r.get("gen")})
    return out, ahead


def r_verdict(spans, pairs, slices, ahead_pages, ahead_words):
    """R overlap by the R185 contract (see the header): the first witness, or
    not proven with what is missing, per pinned parse."""
    tried = []
    for sp in spans:
        p0, p1 = sp.get("p0_ns"), sp.get("p1_ns")
        row = {"job": sp.get("job"), "gateway_pid": sp.get("pid"), "file": sp.get("file"), "cancelled": sp.get("cancelled")}
        tried.append(row)
        if p0 is None or p1 is None:
            row["why"] = "no end stamp (cut short)"
            continue
        lo_g, hi_g = p0 / 1e6 + G_STAMP_MS, p1 / 1e6 - G_STAMP_MS
        row["parse_ms"] = round((p1 - p0) / 1e6, 1)
        best = None
        for page, ps in pairs.items():
            if page in ahead_pages:
                continue
            inside = sorted((p for p in ps if p["pid"] == sp.get("pid") and lo_g < p["g"] < hi_g), key=lambda p: p["g"])
            row.setdefault("heartbeats_inside", {})[page] = len(inside)
            for i, A in enumerate(inside):
                for B in inside[i + 1:]:
                    w0, w1 = A["hr"] + PAGE_STAMP_MS, B["hs"] - PAGE_STAMP_MS
                    if w0 >= w1:
                        continue
                    for sl in slices:
                        if sl["page"] != page:
                            continue
                        lo, hi = max(w0, sl["s0"] + PAGE_STAMP_MS), min(w1, sl["s1"] - PAGE_STAMP_MS)
                        if lo < hi:
                            proof = {"parse": {"job": sp.get("job"), "gateway_pid": sp.get("pid"), "file": sp.get("file"),
                                               "p0_ns": p0, "p1_ns": p1, "t_wall_ns": sp.get("t_wall_ns")},
                                     "heartbeat_a": A, "heartbeat_b": B, "page": page,
                                     "window_page_ms": [w0, w1], "slice": sl,
                                     "sweep": "provisional" if sl.get("range_from") is not None else "full",
                                     "margin_ms": PAGE_STAMP_MS}
                            return {"verdict": "R overlap proven", "proof": proof, "parses": tried}
                    if best is None or w1 - w0 > best:
                        best = w1 - w0
        if best is None:
            row["why"] = "fewer than two paired heartbeats inside it, or none whose window opens"
        else:
            row["why"] = f"no real run-check slice inside its widest window ({best:.0f} ms)"
    why = "no pinned parse with its own bounds in the phase" if not spans else "no witness (see parses)"
    return {"verdict": "R overlap not proven", "why": why, "parses": tried,
            "pages_ws_worker_ahead": sorted(ahead_pages), "witness_words_ahead": ahead_words,
            "run_check_slices": len(slices)}


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
            # the telemetry of the phase arrives up to a flush later: its rows
            # and words up to R_LATE_NS after it
            late = [r for r in t_all if a <= r["t_wall_ns"] < b + R_LATE_NS]
            spans = [r for r in recs if r.get("tag") == "gcode.parse_span" and r.get("pinned")]
            pairs, ahead_pages = hb_pairs_of(perf, pages, a, b + R_LATE_NS)
            slices, ahead_words = slices_of(late, pages)
            p["verdict"] = r_verdict(spans, pairs, slices, ahead_pages, ahead_words)
            if p["verdict"]["verdict"] == "R overlap proven":
                with open(os.path.join(HERE, "r_proof.json"), "w") as f:
                    json.dump(p["verdict"]["proof"], f, indent=1)
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
