#!/usr/bin/env python3
"""Browser-PC measurement (Messprotokoll, Codex VP112-06): marks and report.

The machine PC is this VM (LinuxCNC sim + gateway), the browser PC the
operator's Mac. Nothing here drives anything: `mark NAME` notes a phase
boundary (wall time + the gateway.log size), `report` reads what the running
suite recorded between the marks:

- the Mac page's own telemetry (`browser.viewer.perf`, host != localhost):
  status-frame gaps as the page applied them (gap_*), render loop (raf_*),
  main-thread timer lateness (mt_* — Firefox has no Long Tasks API), GPU
  fences (gpu_*). Each record summarises a 3 s window: a phase reports the
  distribution of the windows' p95s and the overall max, never one pooled
  p95 (percentiles do not pool);
- the gateway: event-loop lag (lag.window), slow polls, slow fan-out sends,
  VM CPU (loop.tick), the HAL heartbeat's late wake-ups — gateway.log prints
  every pre-send gap over 100 ms ([HB-WAKE]) and every drift over 200 ms
  ([HB-STALL]), so their absence bounds the gap by 100 ms;
- the page's heartbeat delivery stalls (browser.ws.hb_delivery_stall);
- the preview: parses started, published, cancelled, superseded (a basis
  change must replace, never queue); the collision sweeps;
- every safety.* event.

Records are windowed by the gateway's receipt time (t_wall_ns); a page
telemetry record covers the 3 s before it arrived."""
import glob
import json
import os
import statistics
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LOGS = os.path.expanduser("~/lcnc-suite/runlogs")
MARKS = os.path.join(HERE, "marks.json")
LOCAL = {"localhost", "127.0.0.1", "::1"}


def load_marks():
    try:
        with open(MARKS) as f:
            return json.load(f)
    except FileNotFoundError:
        return []


def mark(name):
    marks = load_marks()
    gw = os.path.join(LOGS, "gateway.log")
    marks.append({"name": name, "t_wall_ns": time.time_ns(),
                  "gwlog": os.path.getsize(gw) if os.path.exists(gw) else 0,
                  "local": time.strftime("%H:%M:%S")})
    with open(MARKS, "w") as f:
        json.dump(marks, f, indent=1)
    print(f"mark {name} at {marks[-1]['local']}")


def trace_lines(t0, t1):
    out = []
    for path in glob.glob(os.path.join(LOGS, "trace.ndjson*")):
        with open(path, "rb") as f:
            for raw in f:
                # "t_wall_ns" is the first field of every record
                if not raw.startswith(b'{"t_wall_ns":'):
                    continue
                try:
                    t = int(raw[13:raw.index(b",", 13)])
                except ValueError:
                    continue
                if t0 <= t < t1:
                    try:
                        out.append(json.loads(raw))
                    except ValueError:
                        pass
    out.sort(key=lambda r: r["t_wall_ns"])
    return out


def dist(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return {"n": len(vals), "median": round(statistics.median(vals), 1), "max": round(max(vals), 1)}


def gwlog_slice(a, b):
    with open(os.path.join(LOGS, "gateway.log"), "rb") as f:
        f.seek(a)
        text = f.read(max(0, b - a)).decode("utf-8", "replace")
    wake, stall = [], []
    for line in text.splitlines():
        if "[HB-WAKE]" in line and "gap " in line:
            wake.append(float(line.split("gap ")[1].split("ms")[0]))
        elif "[HB-STALL]" in line and "gap " in line:
            stall.append(float(line.split("gap ")[1].split("ms")[0]))
    return {"hb_wake_over_100ms": len(wake), "hb_wake_max_ms": max(wake) if wake else None,
            "hb_stall_over_200ms": len(stall), "hb_stall_max_ms": max(stall) if stall else None}


def phase(recs, gw):
    by = {}
    for r in recs:
        by.setdefault(r["tag"], []).append(r)
    perf = by.get("browser.viewer.perf", [])
    mac = [r for r in perf if r.get("host") not in LOCAL]
    local = [r for r in perf if r.get("host") in LOCAL]
    out = {"seconds": None}
    if mac:
        out["mac_page"] = {
            "hosts": sorted({r.get("host") for r in mac}), "pages": sorted({r.get("cid") for r in mac}),
            "windows": len(mac), "visibility": sorted({r.get("vis") for r in mac}),
            "status_frames": sum(r.get("frames", 0) for r in mac),
            "status_gap_p95_ms": dist([r.get("gap_p95_ms") for r in mac if r.get("frames")]),
            "status_gap_max_ms": max((r.get("gap_max_ms", 0) for r in mac), default=None),
            "status_jank_frames_over_50ms": sum(r.get("jank_frames", 0) for r in mac),
            "raf_gap_p95_ms": dist([r.get("raf_gap_p95_ms") for r in mac if r.get("raf_ticks")]),
            "raf_gap_max_ms": max((r.get("raf_gap_max_ms", 0) for r in mac), default=None),
            "raf_pauses": sum(r.get("raf_pauses", 0) for r in mac),
            "main_thread_late_p95_ms": dist([r.get("mt_late_p95_ms") for r in mac if r.get("mt_probes")]),
            "main_thread_late_max_ms": max((r.get("mt_late_max_ms", 0) for r in mac), default=None),
            "main_thread_blocks_over_20ms": sum(r.get("mt_blocks", 0) for r in mac),
            "main_thread_probes": sum(r.get("mt_probes", 0) for r in mac),
            "gpu_behind_max_ticks": max((r.get("gpu_behind_max", 0) for r in mac if "gpu_behind_max" in r), default=None),
            "gpu_done_p95_ms": dist([r.get("gpu_done_p95_ms") for r in mac if r.get("gpu_fences")]),
            "heap_used_mb": [r.get("heap_used_mb") for r in mac][-1],
        }
    if local:
        out["vm_page_windows"] = len(local)
    lag = by.get("lag.window", [])
    ticks = by.get("loop.tick", [])
    busy = [(t["user_ms"] + t["system_ms"]) / t["total_ms"] * 100 for t in ticks if t.get("total_ms")]
    out["gateway"] = {
        "lag_windows": len(lag), "lag_max_drift_ms": max((r["drift_ms"] for r in lag), default=None),
        "lag_dominant": sorted({r.get("dominant_phase") for r in lag if r.get("drift_ms", 0) >= 100}),
        "poll_status_slow": len(by.get("poll_status.slow", [])),
        "poll_status_slow_max_ms": max((r["total_ms"] for r in by.get("poll_status.slow", [])), default=None),
        "fanout_send_slow": len(by.get("ws.fanout_send_slow", [])),
        "vm_cpu_busy_pct": dist(busy),
        "vm_steal_ms_max": max((t.get("steal_ms", 0) for t in ticks), default=None),
        "clients": sorted({t.get("clients") for t in ticks}),
        **gw,
    }
    # by the page id, never the peer: the Vite dev server proxies the page's
    # telemetry POSTs, so every page arrives from 127.0.0.1
    pages = {r.get("page") for r in mac}
    stalls = [r for r in by.get("browser.ws.hb_delivery_stall", []) if r.get("page") in pages]
    out["page_heartbeat_delivery_stalls"] = {"n": len(stalls),
                                            "rx_gap_max_ms": max((r.get("rx_gap_ms", 0) for r in stalls), default=None)}
    out["preview"] = {k: len(by.get(k, [])) for k in (
        "gcode.refresh_scheduled", "gcode.spawn_start", "gcode.publish", "gcode.worker_done",
        "gcode.reparse_superseded", "gcode.parse_cancelled", "gcode.reparse_table_midrun", "gcode.verify")}
    out["preview"]["reasons"] = [r.get("reason") for r in by.get("gcode.refresh_scheduled", [])]
    out["collision"] = {k[len("browser.collision."):]: len(v) for k, v in by.items() if k.startswith("browser.collision.")}
    out["runs"] = len(by.get("run_basis.start", []))
    out["safety"] = sorted({k for k in by if k.startswith("safety.") or k.startswith("wd.trip")})
    return out


def report():
    marks = load_marks()
    if len(marks) < 2:
        sys.exit("need two marks")
    res = []
    for a, b in zip(marks, marks[1:]):
        p = phase(trace_lines(a["t_wall_ns"], b["t_wall_ns"]), gwlog_slice(a["gwlog"], b["gwlog"]))
        p["seconds"] = round((b["t_wall_ns"] - a["t_wall_ns"]) / 1e9, 1)
        res.append({"phase": a["name"], "from": a["local"], "to": b["local"], **p})
    print(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "mark":
        mark(sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] == "report":
        report()
    else:
        sys.exit("usage: bpc.py mark NAME | report")
