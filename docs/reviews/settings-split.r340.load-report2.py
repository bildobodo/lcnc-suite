#!/usr/bin/env python3
"""The load measurement re-evaluated from its raw data (Codex R339 SS-I07):

- a page's status windows (browser.viewer.perf) belong to a phase by their
  OWN span (win_start .. win_end, the global clock), never by when their
  telemetry post was seen (up to 10 s late): only windows wholly inside a
  phase are pooled; windows over a phase edge are listed apart, never split;
- the status CADENCE (gap_h: time between applied frames) and the status AGE
  (age_h: socket receipt → applied) are pooled histograms each — p50/p95/p99
  as their bin (binOf: 1 ms < 20, 2 ms < 100, 10 ms < 500, 50 ms < 2000,
  500 ms beyond) — and their window maxima;
- the samples are what the loop OBSERVED: their largest interval is given
  (the loop waits on the pages under load);
- CPU over the phase AND over the laptop's check alone (its first busy
  sample to its first idle one after); RSS is the process tree's.

  report2.py <rundir>   → <rundir>/report2.json + a table
"""
import json
import os
import sys

RUN = sys.argv[1]


def jl(name):
    p = os.path.join(RUN, name)
    if not os.path.exists(p):
        return []
    with open(p) as f:
        return [json.loads(x) for x in f if x.strip()]


def phases():
    out, start = [], {}
    for m in jl("marks.jsonl"):
        if m["edge"] == "start":
            start[m["phase"]] = m["t"]
        else:
            out.append((m["phase"], start[m["phase"]], m["t"]))
    return out


def pooled(hists):
    tot = {}
    for h in hists:
        for b, n in (h or {}).items():
            tot[float(b)] = tot.get(float(b), 0) + n
    n = sum(tot.values())
    if not n:
        return {"n": 0}
    out, acc = {"n": n}, 0
    want = [(50, "p50_bin_ms"), (95, "p95_bin_ms"), (99, "p99_bin_ms")]
    for b in sorted(tot):
        acc += tot[b]
        while want and acc >= n * want[0][0] / 100:
            out[want.pop(0)[1]] = b
    return out


def status(perf, t0, t1):
    recs = [p["rec"] for p in perf]
    inside = [r for r in recs if r["win_start"] >= t0 and r["win_end"] <= t1]
    edge = [r for r in recs if r["win_start"] < t1 and r["win_end"] > t0 and r not in inside]
    return {
        "windows_inside": len(inside),
        "covered_s": round(sum(r["win_end"] - r["win_start"] for r in inside) / 1000, 1),
        "cadence_gap": {**pooled(r.get("gap_h") for r in inside),
                        "window_max_ms": max((r.get("gap_max_ms", 0) for r in inside), default=None)},
        "age": {**pooled(r.get("age_h") for r in inside),
                "window_max_ms": max((r.get("age_max_ms", 0) for r in inside), default=None)},
        "edge_windows": [{"from_ms": round(r["win_start"] - t0), "to_ms": round(r["win_end"] - t0),
                          "gap_max_ms": r.get("gap_max_ms"), "age_max_ms": r.get("age_max_ms")} for r in edge],
    }


def cpu(rows, name, t0, t1):
    s = [r for r in rows if t0 <= r["t"] <= t1 and r.get(name)]
    if len(s) < 2:
        return None
    dt = (s[-1]["t"] - s[0]["t"]) / 1000
    return round(100 * (s[-1][name]["cpu"] - s[0][name]["cpu"]) / dt, 1) if dt > 0 else None


def check_span(rows, t0, t1):
    s = [r for r in rows if t0 <= r["t"] <= t1]
    busy = [i for i, r in enumerate(s) if (r["laptop"].get("work") or {}).get("busy")]
    if not busy:
        return None
    a = s[busy[0]]
    b = next((r for r in s[busy[-1] + 1:] if not (r["laptop"].get("work") or {}).get("busy")), s[busy[-1]])
    return a["t"], b["t"]


def main():
    samples = jl("samples.jsonl")
    perf = {n: jl(f"perf-{n}.jsonl") for n in ("panel", "laptop")}
    rep = {"run": os.path.basename(RUN), "phases": {}}
    for name, t0, t1 in phases():
        s = [r for r in samples if t0 <= r["t"] <= t1]
        gaps = [b["t"] - a["t"] for a, b in zip(s, s[1:])]
        ph = {"seconds": round((t1 - t0) / 1000, 1), "samples": len(s),
              "sample_interval_max_ms": max(gaps, default=None)}
        for d in ("panel", "laptop"):
            ph[d] = {
                "cpu_pct_phase": cpu(samples, d, t0, t1),
                "process_tree_rss_max_mb": round(max((r[d]["rss_mb"] for r in s), default=0), 1),
                "workers_max": max((r[d]["workers"] for r in s), default=0),
                "collision_worker_in_observed_samples": any((r[d].get("work") or {}).get("worker") for r in s),
                "check_busy_in_observed_samples": any((r[d].get("work") or {}).get("busy") for r in s),
                "status": status(perf[d], t0, t1),
            }
        span = check_span(samples, t0, t1)
        if span:
            a, b = span
            ph["laptop_check"] = {"seconds": round((b - a) / 1000, 1),
                                  "panel_cpu_pct": cpu(samples, "panel", a, b),
                                  "laptop_cpu_pct": cpu(samples, "laptop", a, b)}
        rep["phases"][name] = ph
    with open(os.path.join(RUN, "report2.json"), "w") as f:
        json.dump(rep, f, indent=2)
    for name, p in rep["phases"].items():
        print(f"== {name} ({p['seconds']} s, {p['samples']} samples, largest sample interval {p['sample_interval_max_ms']} ms)")
        for d in ("panel", "laptop"):
            x = p[d]
            st = x["status"]
            print(f"  {d:6} cpu {x['cpu_pct_phase']}%  rss {x['process_tree_rss_max_mb']} MB  workers {x['workers_max']}  "
                  f"collision worker {x['collision_worker_in_observed_samples']}  | windows {st['windows_inside']} ({st['covered_s']} s)  "
                  f"cadence p95 {st['cadence_gap'].get('p95_bin_ms')} max {st['cadence_gap'].get('window_max_ms')}  "
                  f"age p95 {st['age'].get('p95_bin_ms')} max {st['age'].get('window_max_ms')}  edges {len(st['edge_windows'])}")
        if "laptop_check" in p:
            c = p["laptop_check"]
            print(f"  check {c['seconds']} s: panel {c['panel_cpu_pct']}%  laptop {c['laptop_cpu_pct']}%")


if __name__ == "__main__":
    main()
