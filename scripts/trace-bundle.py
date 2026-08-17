#!/usr/bin/env python3
"""LCNC suite trace bundler — merge structured + legacy logs by wall time.

Reads (paths resolved via lcnc_paths.resolve(), default <install-dir>/runlogs):
  - trace.ndjson         (structured stream; gateway, hal_reader, hal_watchdog,
                          launcher proc.status, browser telemetry)
  - gateway.log          (uvicorn stdout/stderr; uses [+Nms] mono offsets)
  - hal_watchdog.log     (HB-RECV / HB-RISING instrumentation)
  - launcher.log         (bash launcher; [HH:MM:SS.mmm])
  - hal_sample.csv       (halsampler -t output, prefixed sample number)

Writes (default — in same log dir):
  - trace-merged.ndjson — full structured stream
  - trace-merged.log    — human-readable, timeline-sorted

Usage:
  python3 trace-bundle.py                  # whole capture
  python3 trace-bundle.py --trip           # auto-detect last trip, slice ±5s
  python3 trace-bundle.py --window=trip-5s..trip+1s
  python3 trace-bundle.py --window=12345..23456  (mono ms range)
  python3 trace-bundle.py --phases-only    # only phase + lag events
  python3 trace-bundle.py --out /path/to/dir/  # output dir

Designed to fail-soft: a missing input file is logged once and skipped, not
fatal — even a partial timeline is more useful than no timeline.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Resolve via the shared resolver so this script tracks env / INI overrides
# the same way gateway/hal_reader/hal_watchdog do.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lcnc-gateway"))
try:
    import lcnc_paths
    _LOG_DIR = lcnc_paths.resolve()[0]
except Exception:
    # Mirror the resolver's derived default: <install-dir>/runlogs.
    _LOG_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "runlogs"))

TRACE_PATH = os.path.join(_LOG_DIR, "trace.ndjson")
GATEWAY_LOG = os.path.join(_LOG_DIR, "gateway.log")
WATCHDOG_LOG = os.path.join(_LOG_DIR, "hal_watchdog.log")
LAUNCHER_LOG = os.path.join(_LOG_DIR, "launcher.log")
HAL_SAMPLE_CSV = os.path.join(_LOG_DIR, "hal_sample.csv")


def _safe_open(path: str):
    try:
        return open(path, "r", encoding="utf-8", errors="replace")
    except FileNotFoundError:
        sys.stderr.write(f"[bundler] missing input: {path} (skipping)\n")
        return None


def load_trace_ndjson() -> List[dict]:
    """Read structured trace.ndjson. Returns events with t_wall_ns."""
    f = _safe_open(TRACE_PATH)
    if f is None:
        return []
    events = []
    with f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            if not isinstance(ev, dict):
                continue
            if "t_wall_ns" not in ev:
                continue
            events.append(ev)
    return events


def _t0_wall_ns_for_proc(events: Iterable[dict]) -> Dict[Tuple[str, int], int]:
    """Find each (proc, pid)'s `boot` event so we can reconstruct wall time
    for legacy text logs that only carry mono offsets."""
    t0: Dict[Tuple[str, int], int] = {}
    for ev in events:
        if ev.get("tag") != "boot":
            continue
        proc = ev.get("proc")
        pid = ev.get("pid")
        if proc is None or pid is None:
            continue
        # The `boot` event carries t0_wall_ns + t0_mono explicitly.
        wall = ev.get("t0_wall_ns") or ev.get("t_wall_ns")
        if wall is not None:
            t0[(str(proc), int(pid))] = int(wall)
    return t0


_GATEWAY_LINE_RE = re.compile(r"^\[(?P<tag>[^\]]+)\]\s+\+(?P<ms>\d+)ms\s+(?P<rest>.*)$")
_LAUNCHER_LINE_RE = re.compile(r"^\[(?P<hms>\d{2}:\d{2}:\d{2}\.\d{3})\]\s+(?P<rest>.*)$")
_WATCHDOG_LINE_RE = re.compile(r"^\[(?P<tag>[^\]]+)\]\s+\+(?P<ms>\d+)ms\s+(?P<rest>.*)$")


def load_gateway_log(t0_lookup: Dict[Tuple[str, int], int]) -> List[dict]:
    """Convert legacy gateway log lines to events using the gateway's recorded
    t0_wall_ns from the trace bus boot event."""
    f = _safe_open(GATEWAY_LOG)
    if f is None:
        return []
    # Use the most recent gateway boot anchor; legacy log doesn't carry pid.
    gw_anchors = [(k, v) for k, v in t0_lookup.items() if k[0] == "gateway"]
    if not gw_anchors:
        return []
    # Pick the one with the largest t0 — that's the most recent boot, which
    # is what the legacy log lines correspond to.
    gw_anchors.sort(key=lambda kv: kv[1], reverse=True)
    t0_ns = gw_anchors[0][1]
    events: List[dict] = []
    with f:
        for line in f:
            line = line.rstrip("\n")
            m = _GATEWAY_LINE_RE.match(line)
            if not m:
                continue
            mono_ms = int(m.group("ms"))
            wall_ns = t0_ns + mono_ms * 1_000_000
            events.append({
                "t_wall_ns": wall_ns,
                "t_mono_ms": mono_ms,
                "proc": "gateway_legacy",
                "pid": gw_anchors[0][0][1],
                "tag": m.group("tag"),
                "level": "info",
                "msg": m.group("rest"),
            })
    return events


def load_watchdog_log(t0_lookup: Dict[Tuple[str, int], int]) -> List[dict]:
    f = _safe_open(WATCHDOG_LOG)
    if f is None:
        return []
    wd_anchors = [(k, v) for k, v in t0_lookup.items() if k[0] == "hal_watchdog"]
    if not wd_anchors:
        return []
    wd_anchors.sort(key=lambda kv: kv[1], reverse=True)
    t0_ns = wd_anchors[0][1]
    events: List[dict] = []
    with f:
        for line in f:
            line = line.rstrip("\n")
            m = _WATCHDOG_LINE_RE.match(line)
            if not m:
                continue
            mono_ms = int(m.group("ms"))
            wall_ns = t0_ns + mono_ms * 1_000_000
            events.append({
                "t_wall_ns": wall_ns,
                "t_mono_ms": mono_ms,
                "proc": "hal_watchdog_legacy",
                "pid": wd_anchors[0][0][1],
                "tag": m.group("tag"),
                "level": "info",
                "msg": m.group("rest"),
            })
    return events


def load_launcher_log() -> List[dict]:
    """Launcher log uses [HH:MM:SS.mmm] timestamps. We assume today's date —
    if the capture spans midnight the bundler will be off by ≤1 day for any
    pre-midnight lines, which is acceptable for this diagnostic tool."""
    f = _safe_open(LAUNCHER_LOG)
    if f is None:
        return []
    events: List[dict] = []
    today_struct = time.localtime()
    base_struct = (today_struct.tm_year, today_struct.tm_mon, today_struct.tm_mday)
    with f:
        for line in f:
            line = line.rstrip("\n")
            m = _LAUNCHER_LINE_RE.match(line)
            if not m:
                continue
            try:
                hh, mm, ss_ms = m.group("hms").split(":")
                ss, ms = ss_ms.split(".")
                t = time.mktime((
                    base_struct[0], base_struct[1], base_struct[2],
                    int(hh), int(mm), int(ss),
                    today_struct.tm_wday, today_struct.tm_yday, today_struct.tm_isdst,
                ))
                wall_ns = int(t * 1e9) + int(ms) * 1_000_000
            except Exception:
                continue
            events.append({
                "t_wall_ns": wall_ns,
                "t_mono_ms": 0,
                "proc": "launcher_legacy",
                "pid": 0,
                "tag": "launcher",
                "level": "info",
                "msg": m.group("rest"),
            })
    return events


def load_hal_sample(t0_lookup: Dict[Tuple[str, int], int]) -> List[dict]:
    """halsampler -t output: '<sample_number> <pin0> <pin1> ...'.  Sample
    number maps to mono ms via the ~1 ms servo cycle. Wall time = LinuxCNC
    boot wall. We don't have LinuxCNC's exact boot wall, so use the launcher
    boot or gateway boot as an approximation; absolute wall ms can drift but
    relative ordering is preserved."""
    csv_path = HAL_SAMPLE_CSV
    if not os.path.exists(csv_path):
        sys.stderr.write(f"[bundler] missing input: {csv_path} (skipping)\n")
        return []
    # Use gateway's t0 wall as the anchor (LinuxCNC boots before gateway,
    # but the absolute alignment we need is for correlating gateway events
    # with HAL pin transitions in the same window — relative is enough).
    gw_anchors = [(k, v) for k, v in t0_lookup.items() if k[0] == "gateway"]
    if not gw_anchors:
        return []
    gw_anchors.sort(key=lambda kv: kv[1], reverse=True)
    t0_ns = gw_anchors[0][1]
    events: List[dict] = []
    cols: Optional[List[str]] = None
    with open(csv_path, "r", errors="replace") as f:
        for raw in f:
            line = raw.rstrip("\n").strip()
            if not line:
                continue
            if line.startswith("#"):
                # Header line we wrote in the launcher.
                cols = [c.strip() for c in line.lstrip("#").split(",") if c.strip()]
                continue
            parts = line.split()
            if not parts or not parts[0].isdigit():
                continue
            sample_n = int(parts[0])
            values = parts[1:]
            mono_ms = sample_n  # 1 ms servo cycle
            wall_ns = t0_ns + mono_ms * 1_000_000
            evt: Dict[str, Any] = {
                "t_wall_ns": wall_ns,
                "t_mono_ms": mono_ms,
                "proc": "hal_sample",
                "pid": 0,
                "tag": "halsample",
                "level": "info",
                "sample": sample_n,
            }
            if cols and len(cols) >= len(values) + 1:
                # First col is t_sample header; pin cols start at index 1.
                pin_names = cols[1:1 + len(values)]
                for name, val in zip(pin_names, values):
                    evt[name] = val
            else:
                for i, val in enumerate(values):
                    evt[f"col{i}"] = val
            events.append(evt)
    return events


def slice_window(events: List[dict], start_ns: int, end_ns: int) -> List[dict]:
    return [e for e in events if start_ns <= e["t_wall_ns"] <= end_ns]


def parse_window(spec: str, all_events: List[dict]) -> Tuple[int, int]:
    """Accept 'A..B' where A and B are either numeric ms (mono, requires
    a single-process capture) or 'trip-Ns' / 'trip+Ns'."""
    if ".." not in spec:
        raise SystemExit(f"--window expected 'A..B', got {spec!r}")
    a, b = spec.split("..", 1)
    return _resolve_window_endpoint(a, all_events, start=True), \
           _resolve_window_endpoint(b, all_events, start=False)


def _last_trip_wall_ns(events: List[dict]) -> Optional[int]:
    """Find the last trip anchor. `safety.tripped` (gateway, latch-level
    FALSE→TRUE) is authoritative — `wd.hb_edge edge=falling` comes from a
    best-effort 100 ms poller that misses short pin dips entirely (a trip
    with no falling edge is exactly the case issue #34 exists for). The
    legacy `[SAFETY] tripped` line is kept for old captures."""
    last: Optional[int] = None
    for e in events:
        if e.get("tag") == "safety.tripped":
            last = max(last or 0, e["t_wall_ns"])
        elif e.get("tag") == "wd.hb_edge" and e.get("edge") == "falling":
            last = max(last or 0, e["t_wall_ns"])
        elif e.get("tag") == "SAFETY" and "tripped" in str(e.get("msg", "")):
            last = max(last or 0, e["t_wall_ns"])
    return last


def _resolve_window_endpoint(token: str, events: List[dict], start: bool) -> int:
    token = token.strip()
    m = re.match(r"^trip(?P<sign>[+-])(?P<n>\d+)(?P<unit>s|ms)$", token)
    if m:
        trip = _last_trip_wall_ns(events)
        if trip is None:
            raise SystemExit("no trip detected; can't resolve trip-relative window")
        n = int(m.group("n"))
        unit = m.group("unit")
        ns = n * (1_000_000_000 if unit == "s" else 1_000_000)
        return trip + ns if m.group("sign") == "+" else trip - ns
    if token.isdigit():
        # Treat as wall ns directly. Bundler users in advanced cases.
        return int(token)
    raise SystemExit(f"unrecognized window endpoint: {token!r}")


# Auth-token redaction at the WRITERS — the single choke point every event
# source flows through. Bundles are the artifact people SHARE (bug reports,
# forum posts), and uvicorn's access log puts the live WS token in every
# connection line (`/ws?token=...`); the launcher now redacts at the tee,
# but bundles must also be safe when built from logs an older launcher
# wrote. The charset excludes quote, ampersand, whitespace AND backslash —
# backslash matters: in a serialized JSON string an embedded quote is \" ,
# and a match consuming the backslash would un-escape it and break the
# JSON. Real tokens are urlsafe-base64 (no backslashes), so nothing is
# under-redacted.
_TOKEN_RE = re.compile(r"(?i)(token=)[^\"&\s\\]+")


def _redact(line: str) -> str:
    return _TOKEN_RE.sub(r"\1REDACTED", line)


def write_ndjson(events: List[dict], out_path: str) -> None:
    with open(out_path, "w") as f:
        for e in events:
            f.write(_redact(json.dumps(e, separators=(",", ":"))) + "\n")


def write_log(events: List[dict], out_path: str) -> None:
    with open(out_path, "w") as f:
        # Use the earliest event as 0 for relative timestamps — friendlier
        # than absolute epoch ns when reading by eye.
        if not events:
            return
        t0 = min(e["t_wall_ns"] for e in events)
        for e in events:
            rel_ms = (e["t_wall_ns"] - t0) / 1_000_000
            tag = e.get("tag", "?")
            proc = e.get("proc", "?")
            level = e.get("level", "info")
            msg = e.get("msg", "")
            extras = " ".join(
                f"{k}={v}" for k, v in e.items()
                if k not in ("t_wall_ns", "t_mono_ms", "proc", "pid", "tag", "level", "msg")
            )
            f.write(_redact(f"[+{rel_ms:9.3f}ms] [{level:5s}] [{proc:18s}] {tag:30s} {msg} {extras}").rstrip() + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trip", action="store_true",
                    help="auto-detect last safety trip, slice ±5 s/1 s")
    ap.add_argument("--trip-ns", type=int, default=None,
                    help="explicit trip anchor (wall ns) — the gateway passes "
                         "its known trip timestamp so the window never depends "
                         "on auto-detection; slices -5 s/+1 s around it")
    ap.add_argument("--window", type=str,
                    help="custom window: 'trip-5s..trip+1s' or 'A..B' (wall ns)")
    ap.add_argument("--phases-only", action="store_true",
                    help="filter to phase.* / lag.* / loop.* events")
    ap.add_argument("--out", type=str, default="/tmp",
                    help="output directory (default: /tmp)")
    args = ap.parse_args()

    structured = load_trace_ndjson()
    t0_lookup = _t0_wall_ns_for_proc(structured)

    legacy_gw = load_gateway_log(t0_lookup)
    legacy_wd = load_watchdog_log(t0_lookup)
    legacy_l = load_launcher_log()
    sampler = load_hal_sample(t0_lookup)

    all_events = structured + legacy_gw + legacy_wd + legacy_l + sampler
    all_events.sort(key=lambda e: e["t_wall_ns"])

    if args.trip_ns is not None or args.trip:
        if args.trip_ns is not None:
            trip = args.trip_ns
        else:
            trip = _last_trip_wall_ns(all_events)
        if trip is None:
            sys.stderr.write("[bundler] --trip: no trip detected\n")
            return 2
        start_ns = trip - 5 * 1_000_000_000
        end_ns = trip + 1 * 1_000_000_000
        all_events = slice_window(all_events, start_ns, end_ns)
    elif args.window:
        start_ns, end_ns = parse_window(args.window, all_events)
        all_events = slice_window(all_events, start_ns, end_ns)

    if args.phases_only:
        all_events = [
            e for e in all_events
            if e.get("tag", "").startswith(("phase.", "lag.", "loop."))
        ]

    os.makedirs(args.out, exist_ok=True)
    nd_path = os.path.join(args.out, "trace-merged.ndjson")
    log_path = os.path.join(args.out, "trace-merged.log")
    write_ndjson(all_events, nd_path)
    write_log(all_events, log_path)

    sys.stderr.write(
        f"[bundler] {len(structured)} structured + "
        f"{len(legacy_gw)} gw_legacy + {len(legacy_wd)} wd_legacy + "
        f"{len(legacy_l)} launcher_legacy + {len(sampler)} sampler "
        f"→ {len(all_events)} merged → {nd_path}, {log_path}\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
