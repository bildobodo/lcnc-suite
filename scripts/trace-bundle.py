#!/usr/bin/env python3
"""LCNC suite trace bundler — merge structured + legacy logs by wall time.

Reads (paths resolved via lcnc_paths.resolve() or --log-dir, default
<install-dir>/runlogs):
  - trace.ndjson + every rotation trace.ndjson.<n>, as ONE snapshot taken
                         under the writers' lock (structured stream; gateway,
                         hal_reader, hal_watchdog, launcher, browser telemetry)
  - crash.log + its rotations, the same way, copied as its own artifact
  - gateway.log          (uvicorn stdout/stderr; uses [+Nms] mono offsets)
  - hal_watchdog.log     (HB-RECV / HB-RISING instrumentation)
  - launcher.log         (bash launcher; [HH:MM:SS.mmm])
  - hal_sample.csv       (halsampler -t output, prefixed sample number)

Writes (into --out):
  - trace-merged.ndjson — full structured stream
  - trace-merged.log    — human-readable, timeline-sorted
  - crash-snapshot.log  — crash.log's generations (never merged into the
                          timeline: the trace carries every crash.* event)
  - bundle.json         — the requested window, the capture bound, the
                          sources (name, dev, ino, size, records, damaged),
                          gaps, truncated_before / tail_missing

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

TRACE_NAME, TRACE_LOCK = "trace.ndjson", "trace.lock"
CRASH_NAME, CRASH_LOCK = "crash.log", "crash.lock"
GATEWAY_LOG = os.path.join(_LOG_DIR, "gateway.log")
WATCHDOG_LOG = os.path.join(_LOG_DIR, "hal_watchdog.log")
LAUNCHER_LOG = os.path.join(_LOG_DIR, "launcher.log")
HAL_SAMPLE_CSV = os.path.join(_LOG_DIR, "hal_sample.csv")

#: a trip's window: 5 s before, 1 s after; the capture waits for the tail
#: plus the writers' slack, bounded on the MONOTONIC clock (Codex R426: a
#: stepped wall clock never makes it an unbounded wait)
TRIP_BEFORE_NS, TRIP_AFTER_NS = 5_000_000_000, 1_000_000_000
TAIL_SLACK_NS = 200_000_000
TAIL_WAIT_MAX_S = (TRIP_AFTER_NS + TAIL_SLACK_NS) / 1e9
#: the bundler is no heartbeat path: it may wait this long for a log's lock
SNAPSHOT_LOCK_WAIT_S = 2.0


def _set_log_dir(path: str) -> None:
    global _LOG_DIR, GATEWAY_LOG, WATCHDOG_LOG, LAUNCHER_LOG, HAL_SAMPLE_CSV
    _LOG_DIR = path
    GATEWAY_LOG = os.path.join(path, "gateway.log")
    WATCHDOG_LOG = os.path.join(path, "hal_watchdog.log")
    LAUNCHER_LOG = os.path.join(path, "launcher.log")
    HAL_SAMPLE_CSV = os.path.join(path, "hal_sample.csv")


def _safe_open(path: str):
    try:
        return open(path, "r", encoding="utf-8", errors="replace")
    except FileNotFoundError:
        sys.stderr.write(f"[bundler] missing input: {path} (skipping)\n")
        return None


# ── A log's generations as ONE snapshot (P3, Codex R425 MT425-03) ────────
# Reading `trace.ndjson.5 … trace.ndjson` by NAME, one after another, is no
# consistent picture: a rotation between two opens renames the file just
# read to `.1` and the next open reads it AGAIN (A, A, B), or a generation is
# missed. Under the log's lock (the writers' own, lcnc_trace) every
# generation is OPENED and its (dev, ino, size) recorded; after the lock is
# released only those descriptors are read, each up to its recorded size — a
# slow reader holds up no writer, and a later rotation renames files this
# snapshot already holds. A name `<log>.<n>` only — `*.lock` never matches.
class LogSnapshot:
    def __init__(self, name: str) -> None:
        self.name = name
        self.files: List[Tuple[str, int, int, int, int]] = []   # (name, fd, dev, ino, size), oldest first
        self.gaps: List[int] = []          # generation numbers missing below the highest one
        self.lock = "held"                 # or "not_acquired: <why>" — named in the bundle, never silent
        self.capture_bound_ns = 0          # the wall clock at the capture (inside the lock)
        self.errors: List[str] = []

    def close(self) -> None:
        for _n, fd, *_ in self.files:
            try:
                os.close(fd)
            except OSError:
                pass  # safe-silent: closing a read-only snapshot fd

    def sources(self) -> List[dict]:
        return [{"name": n, "dev": dev, "ino": ino, "size": size} for n, _fd, dev, ino, size in self.files]


def _generations(log_dir: str, name: str) -> Tuple[List[Tuple[int, str]], List[int]]:
    """[(n, filename)] oldest first (the highest number first, the live
    file n = 0 last) and the gaps below the highest number."""
    pat = re.compile(r"\A" + re.escape(name) + r"(?:\.([1-9][0-9]*))?\Z")
    found: Dict[int, str] = {}
    try:
        entries = os.listdir(log_dir)
    except OSError:
        entries = []
    for entry in entries:
        m = pat.match(entry)
        if m:
            found[int(m.group(1) or 0)] = entry
    top = max(found) if found else 0
    gaps = [n for n in range(1, top) if n not in found]
    return sorted(found.items(), key=lambda kv: -kv[0]), gaps


def _take_lock(path: str, wait_s: float) -> Tuple[Optional[int], str]:
    import fcntl
    try:
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_CLOEXEC, 0o644)
    except OSError as e:
        return None, f"not_acquired: open {type(e).__name__} {e.errno}"
    deadline = time.monotonic() + wait_s
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd, "held"
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(fd)
                return None, f"not_acquired: busy for {wait_s:g} s"
            time.sleep(0.005)
        except OSError as e:
            os.close(fd)
            return None, f"not_acquired: {type(e).__name__} {e.errno}"


def take_snapshot(log_dir: str, name: str, lock_name: str,
                  lock_wait_s: float = SNAPSHOT_LOCK_WAIT_S) -> LogSnapshot:
    """Open every generation of `name` under its lock and record each one's
    identity and size; read them later with read_snapshot()."""
    snap = LogSnapshot(name)
    lock_fd, snap.lock = _take_lock(os.path.join(log_dir, lock_name), lock_wait_s)
    try:
        snap.capture_bound_ns = time.time_ns()
        gens, snap.gaps = _generations(log_dir, name)
        for _n, entry in gens:
            try:
                fd = os.open(os.path.join(log_dir, entry), os.O_RDONLY | os.O_CLOEXEC)
            except FileNotFoundError:
                snap.errors.append(f"{entry}: vanished before its open")
                continue
            except OSError as e:
                snap.errors.append(f"{entry}: {type(e).__name__} {e.errno}")
                continue
            st = os.fstat(fd)
            snap.files.append((entry, fd, st.st_dev, st.st_ino, st.st_size))
    finally:
        if lock_fd is not None:
            os.close(lock_fd)   # releases the lock
    return snap


def read_snapshot(snap: LogSnapshot) -> List[Tuple[str, bytes]]:
    """Each snapshot file's bytes up to its recorded size (oldest first)."""
    out: List[Tuple[str, bytes]] = []
    for entry, fd, _dev, _ino, size in snap.files:
        chunks, done = [], 0
        while done < size:
            b = os.pread(fd, min(1 << 20, size - done), done)
            if not b:
                snap.errors.append(f"{entry}: ended at {done} of {size} bytes")
                break
            chunks.append(b)
            done += len(b)
        out.append((entry, b"".join(chunks)))
    return out


def parse_trace(data: List[Tuple[str, bytes]]) -> Tuple[List[dict], Dict[str, Dict[str, int]]]:
    """The records of the snapshot's files and, per file, its counts: a line
    that is no JSON object with a wall time — a terminated fragment, a cut
    last line — is DAMAGED and counted, never skipped silently."""
    events: List[dict] = []
    counts: Dict[str, Dict[str, int]] = {}
    for entry, raw in data:
        c = counts.setdefault(entry, {"records": 0, "damaged": 0})
        lines = raw.split(b"\n")
        if lines and lines[-1] == b"":
            lines.pop()
        elif lines:
            c["cut_last_line"] = 1   # no newline at the recorded size
        for line in lines:
            if not line.strip():
                continue
            try:
                ev = json.loads(line.decode("utf-8", "replace"))
            except ValueError:
                c["damaged"] += 1
                continue
            if not isinstance(ev, dict) or not isinstance(ev.get("t_wall_ns"), int):
                c["damaged"] += 1
                continue
            c["records"] += 1
            events.append(ev)
    return events, counts


def wait_for_tail(trip_ns: int, *, now_ns=time.time_ns, sleep=time.sleep,
                  monotonic=time.monotonic) -> float:
    """Wait until the wall clock passes trip + 1 s + the writers' slack, at
    most TAIL_WAIT_MAX_S on the monotonic clock (a trip read ahead of a
    stepped clock never stretches it). Returns the seconds waited."""
    want_s = (trip_ns + TRIP_AFTER_NS + TAIL_SLACK_NS - now_ns()) / 1e9
    wait_s = max(0.0, min(want_s, TAIL_WAIT_MAX_S))
    t0 = monotonic()
    deadline = t0 + wait_s
    while True:
        left = deadline - monotonic()
        if left <= 0:
            return monotonic() - t0
        sleep(min(left, 0.05))


def load_trace_ndjson(log_dir: str) -> Tuple[List[dict], dict]:
    """The trace's records from ONE snapshot of all its generations, and the
    snapshot's account (sources, gaps, lock, capture bound, damage)."""
    snap = take_snapshot(log_dir, TRACE_NAME, TRACE_LOCK)
    try:
        events, counts = parse_trace(read_snapshot(snap))
    finally:
        snap.close()
    if not snap.files:
        sys.stderr.write(f"[bundler] missing input: {os.path.join(log_dir, TRACE_NAME)} (no generation)\n")
    account = {
        "sources": [{**s, **counts.get(s["name"], {})} for s in snap.sources()],
        "gaps": [f"{TRACE_NAME}.{n}" for n in snap.gaps],
        "lock": snap.lock,
        "capture_bound_ns": snap.capture_bound_ns,
        "errors": snap.errors,
        "oldest_ns": min((e["t_wall_ns"] for e in events), default=None),
        "newest_ns": max((e["t_wall_ns"] for e in events), default=None),
    }
    return events, account


def copy_crash_log(log_dir: str, out_dir: str) -> dict:
    """crash.log as its OWN artifact (Codex R426): a snapshot under its own
    lock, the generations' bytes concatenated oldest first into
    crash-snapshot.log, each source named. Its records stay OUT of the
    timeline — the trace already carries every crash.* event — so nothing is
    counted twice and nothing is deduplicated by content."""
    snap = take_snapshot(log_dir, CRASH_NAME, CRASH_LOCK)
    try:
        data = read_snapshot(snap)
    finally:
        snap.close()
    path = os.path.join(out_dir, "crash-snapshot.log")
    open_ends: List[str] = []
    damaged: Dict[str, int] = {}
    with open(path, "wb") as f:
        for entry, raw in data:
            text = _redact(raw.decode("utf-8", "replace"))
            damaged[entry] = sum(1 for line in text.splitlines() if line.strip() and not _is_json(line))
            f.write(text.encode("utf-8"))
            if text and not text.endswith("\n"):
                # a generation's open end (a fragment some writer left): the
                # boundary is kept — the next generation's first record never
                # glues onto it (Codex R428 MT-I13); named per source
                f.write(b"\n")
                open_ends.append(entry)
    return {"file": "crash-snapshot.log", "sources": snap.sources(),
            "gaps": [f"{CRASH_NAME}.{n}" for n in snap.gaps], "lock": snap.lock,
            "capture_bound_ns": snap.capture_bound_ns, "errors": snap.errors,
            "open_ends": open_ends, "damaged": {k: v for k, v in damaged.items() if v}}


def _is_json(line: str) -> bool:
    try:
        json.loads(line)
    except ValueError:
        return False
    return True


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


def bundle_manifest(account: dict, window: Optional[Tuple[int, int]], trip: Optional[int],
                    waited_s: float, crash: dict) -> dict:
    """What the bundle holds and what it cannot (bundle.json): the requested
    window, the capture bound, the trace's sources and gaps, and the edges —
    `truncated_before` (the window starts before the oldest record kept: a
    RETENTION bound, no proof of lost events), `tail_missing` (the capture
    was taken before the window's end)."""
    m: dict = {
        "requested_window": None if window is None else {"start_ns": window[0], "end_ns": window[1]},
        "trip_ns": trip,
        "tail_wait_s": round(waited_s, 3),
        "capture_bound_ns": account["capture_bound_ns"],
        "trace": {k: account[k] for k in ("sources", "gaps", "lock", "errors", "oldest_ns", "newest_ns")},
        "damaged_lines": sum(s.get("damaged", 0) for s in account["sources"]),
        "crash": crash,
        "order": "wall time — display order, not causality",
    }
    if window is not None:
        oldest = account["oldest_ns"]
        m["truncated_before"] = oldest is None or window[0] < oldest
        m["tail_missing"] = account["capture_bound_ns"] < window[1]
    return m


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
    ap.add_argument("--log-dir", type=str, default=None,
                    help="the suite's log dir (the gateway passes the one it writes; "
                         "default: lcnc_paths.resolve())")
    args = ap.parse_args()
    if args.log_dir:
        _set_log_dir(args.log_dir)

    waited_s = 0.0
    if args.trip_ns is not None:
        # the window's tail: the writers' records up to trip + 1 s (bounded)
        waited_s = wait_for_tail(args.trip_ns)
    structured, account = load_trace_ndjson(_LOG_DIR)
    t0_lookup = _t0_wall_ns_for_proc(structured)

    legacy_gw = load_gateway_log(t0_lookup)
    legacy_wd = load_watchdog_log(t0_lookup)
    legacy_l = load_launcher_log()
    sampler = load_hal_sample(t0_lookup)

    all_events = structured + legacy_gw + legacy_wd + legacy_l + sampler
    # Display order by wall time — no causality (the processes' clocks are
    # one clock, their records' order across processes is not proven by it)
    all_events.sort(key=lambda e: e["t_wall_ns"])

    window: Optional[Tuple[int, int]] = None
    trip: Optional[int] = None
    if args.trip_ns is not None or args.trip:
        if args.trip_ns is not None:
            trip = args.trip_ns
        else:
            trip = _last_trip_wall_ns(all_events)
        if trip is None:
            sys.stderr.write("[bundler] --trip: no trip detected\n")
            return 2
        window = (trip - TRIP_BEFORE_NS, trip + TRIP_AFTER_NS)
    elif args.window:
        window = parse_window(args.window, all_events)
    if window is not None:
        all_events = slice_window(all_events, window[0], window[1])

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
    crash = copy_crash_log(_LOG_DIR, args.out)
    manifest = bundle_manifest(account, window, trip, waited_s, crash)
    with open(os.path.join(args.out, "bundle.json"), "w") as f:
        f.write(_redact(json.dumps(manifest, indent=1)) + "\n")

    sys.stderr.write(
        f"[bundler] {len(structured)} structured + "
        f"{len(legacy_gw)} gw_legacy + {len(legacy_wd)} wd_legacy + "
        f"{len(legacy_l)} launcher_legacy + {len(sampler)} sampler "
        f"→ {len(all_events)} merged → {nd_path}, {log_path}\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
