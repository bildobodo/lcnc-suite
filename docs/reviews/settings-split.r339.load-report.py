#!/usr/bin/env python3
"""The report of the per-device simulation load measurement: per phase
(marks.jsonl) and device (samples.jsonl — the Chromium instance's whole
process tree, its workers, its simulation work; perf-<device>.jsonl — the
page's status cadence and age) and the gateway with its parse workers
(gateway.jsonl). CPU is percent of ONE core, from the CPU-time delta over
the phase; RSS the maximum in the phase.

  report.py <outdir>   → <outdir>/report.json + a table on stdout
"""
import json
import os
import sys

OUT = sys.argv[1]


def jl(name):
    p = os.path.join(OUT, name)
    if not os.path.exists(p):
        return []
    with open(p) as f:
        return [json.loads(x) for x in f if x.strip()]


def phases():
    marks = jl("marks.jsonl")
    out, start = [], {}
    for m in marks:
        if m["edge"] == "start":
            start[m["phase"]] = m["t"]
        else:
            out.append((m["phase"], start[m["phase"]], m["t"]))
    return out


def within(rows, t0, t1, key="t"):
    return [r for r in rows if t0 <= r[key] <= t1]


def cpu_pct(rows, get):
    rows = [r for r in rows if get(r) is not None]
    if len(rows) < 2:
        return None
    dt = (rows[-1]["t"] - rows[0]["t"]) / 1000
    return round(100 * (get(rows[-1]) - get(rows[0])) / dt, 1) if dt > 0 else None


def peak_pct(rows, get, win=5):
    best = None
    for i in range(len(rows) - win):
        a, b = rows[i], rows[i + win]
        dt = (b["t"] - a["t"]) / 1000
        if dt > 0 and get(a) is not None and get(b) is not None:
            v = 100 * (get(b) - get(a)) / dt
            best = v if best is None else max(best, v)
    return None if best is None else round(best, 1)


def parse_pct(rows):
    """The parse workers' CPU over the phase: each process's own delta (first
    to last sight in the phase; a process born in it counts from zero)."""
    if len(rows) < 2:
        return None
    first, last = {}, {}
    for r in rows:
        for pid, cpu in (r.get("kids") or {}).items():
            first.setdefault(pid, cpu if r is rows[0] else 0.0)
            last[pid] = cpu
    dt = (rows[-1]["t"] - rows[0]["t"]) / 1000
    return round(100 * sum(last[p] - first[p] for p in last) / dt, 1) if dt > 0 else None


def device(rows, perf, name):
    d = [r for r in rows if r.get(name)]
    get = lambda r: r[name]["cpu"]
    works = [r[name].get("work") or {} for r in d]
    recs = [p["rec"] for p in perf]
    return {
        "cpu_pct": cpu_pct(d, get), "cpu_peak5s_pct": peak_pct(d, get),
        "rss_max_mb": round(max((r[name]["rss_mb"] for r in d), default=0), 1),
        "procs_max": max((r[name]["n"] for r in d), default=0),
        "workers_max": max((r[name]["workers"] for r in d), default=0),
        "collision_worker_seen": any(w.get("worker") for w in works),
        "check_busy_seen": any(w.get("busy") for w in works),
        "status_frames": sum(r.get("frames", 0) for r in recs),
        "status_gap_p95_max_ms": max((r.get("gap_p95_ms", 0) for r in recs), default=None),
        "status_gap_max_ms": max((r.get("gap_max_ms", 0) for r in recs), default=None),
        "status_age_max_ms": max((r.get("age_max_ms", 0) for r in recs), default=None),
    }


def main():
    samples, gw = jl("samples.jsonl"), jl("gateway.jsonl")
    perf = {n: jl(f"perf-{n}.jsonl") for n in ("panel", "laptop")}
    rep = {"drive": json.load(open(os.path.join(OUT, "drive.json"))) if os.path.exists(os.path.join(OUT, "drive.json")) else None,
           "phases": {}}
    for name, t0, t1 in phases():
        s, g = within(samples, t0, t1), within(gw, t0, t1)
        rep["phases"][name] = {
            "seconds": round((t1 - t0) / 1000, 1),
            "panel": device(s, within(perf["panel"], t0, t1), "panel"),
            "laptop": device(s, within(perf["laptop"], t0, t1), "laptop"),
            "gateway": {"cpu_pct": cpu_pct(g, lambda r: r["gw_cpu"]),
                        "rss_max_mb": round(max((r["gw_rss_mb"] for r in g), default=0), 1),
                        "parse_cpu_pct": parse_pct(g),
                        "parse_rss_max_mb": round(max((r["parse_rss_mb"] for r in g), default=0), 1),
                        "parse_procs_max": max((r["parse_n"] for r in g), default=0)},
        }
    with open(os.path.join(OUT, "report.json"), "w") as f:
        json.dump(rep, f, indent=2)
    hdr = f"{'phase':7} {'s':>6} | {'panel cpu%':>10} {'peak':>6} {'rss':>6} {'wk':>3} {'chk':>4} | {'laptop cpu%':>11} {'peak':>6} {'rss':>6} {'wk':>3} {'chk':>4} | {'gw%':>5} {'parse%':>6} {'parseMB':>7}"
    print(hdr)
    for name, p in rep["phases"].items():
        a, b, g = p["panel"], p["laptop"], p["gateway"]
        print(f"{name:7} {p['seconds']:6} | {a['cpu_pct']!s:>10} {a['cpu_peak5s_pct']!s:>6} {a['rss_max_mb']:6} {a['workers_max']:3} {str(a['check_busy_seen'])[0]:>4} | "
              f"{b['cpu_pct']!s:>11} {b['cpu_peak5s_pct']!s:>6} {b['rss_max_mb']:6} {b['workers_max']:3} {str(b['check_busy_seen'])[0]:>4} | "
              f"{g['cpu_pct']!s:>5} {g['parse_cpu_pct']!s:>6} {g['parse_rss_max_mb']:7}")


if __name__ == "__main__":
    main()
