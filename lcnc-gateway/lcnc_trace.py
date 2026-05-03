"""Suite-wide structured trace bus.

Every component (gateway, hal_reader, hal_watchdog) imports this module and
calls `init(<proc_name>)` once at startup, then `emit(tag, **fields)` for
each event. All events land in /tmp/lcnc-trace.log as one NDJSON line each.

Why one shared file across processes: Linux guarantees atomic O_APPEND writes
up to PIPE_BUF (4096 B), so concurrent appends from multiple processes are
line-atomic. Each line carries `proc` + `pid` so the bundler can demux later.

Why direct file write (not queue + thread): NDJSON encoding is < 50 us per
event; line-buffered O_APPEND write is 1-10 us uncached. At our event rate
(~50/s steady, ~500/s burst) the cost is negligible vs the asyncio loop's
heartbeat budget.

Format example:
    {"t_wall_ns": 1735000000123456789, "t_mono_ms": 12345.6,
     "proc": "gateway", "pid": 1234,
     "tag": "lag", "level": "warn", "msg": "loop stalled",
     "drift_ms": 646}
"""
from __future__ import annotations

import json
import logging
import logging.handlers
import os
import sys
import time
from typing import Any, Optional

TRACE_PATH = "/tmp/lcnc-trace.log"
_MAX_BYTES = 50 * 1024 * 1024  # 50 MB
_BACKUPS = 5
_LOGGER_NAME = "lcnc.trace"

_proc_name: str = "?"
_pid: int = 0
_t0_mono: float = 0.0
_t0_wall_ns: int = 0
_logger: Optional[logging.Logger] = None
_initialized: bool = False


def init(proc_name: str) -> None:
    """Call once at process start. Records the boot time anchor and opens
    the trace file with rotation."""
    global _proc_name, _pid, _t0_mono, _t0_wall_ns, _logger, _initialized
    if _initialized:
        return
    _proc_name = proc_name
    _pid = os.getpid()
    _t0_mono = time.monotonic()
    _t0_wall_ns = time.time_ns()
    try:
        logger = logging.getLogger(_LOGGER_NAME)
        # Keep our handler isolated from the root logger.
        logger.propagate = False
        logger.setLevel(logging.DEBUG)
        # Don't double-attach if a previous init partially ran.
        if not any(isinstance(h, logging.handlers.RotatingFileHandler)
                   for h in logger.handlers):
            handler = logging.handlers.RotatingFileHandler(
                TRACE_PATH, maxBytes=_MAX_BYTES, backupCount=_BACKUPS
            )
            # We pre-encode NDJSON in the message; the formatter just emits
            # the message verbatim with a trailing newline (logging adds one).
            handler.setFormatter(logging.Formatter("%(message)s"))
            logger.addHandler(handler)
        _logger = logger
    except Exception as e:
        print(f"[TRACE] init failed: {e}", file=sys.stderr, flush=True)
        _logger = None
    _initialized = True
    emit(
        "boot",
        t0_wall_ns=_t0_wall_ns,
        t0_mono=_t0_mono,
        argv=sys.argv,
        msg=f"{proc_name} trace started",
    )


def emit(tag: str, level: str = "info", msg: str = "", **fields: Any) -> None:
    """Append one NDJSON line to the trace bus. Never raises.

    Cheap and thread-safe (Python's logging module serializes via a lock).
    """
    if not _initialized or _logger is None:
        return
    now = time.monotonic()
    rec = {
        "t_wall_ns": time.time_ns(),
        "t_mono_ms": round((now - _t0_mono) * 1000, 3),
        "proc": _proc_name,
        "pid": _pid,
        "tag": tag,
        "level": level,
    }
    if msg:
        rec["msg"] = msg
    for k, v in fields.items():
        rec[k] = v
    try:
        line = json.dumps(rec, separators=(",", ":"), default=_json_default)
    except Exception as e:
        try:
            line = json.dumps(
                {"t_wall_ns": rec["t_wall_ns"], "t_mono_ms": rec["t_mono_ms"],
                 "proc": rec["proc"], "pid": rec["pid"], "tag": tag,
                 "level": "error", "msg": f"trace_encode_err: {e}"},
                separators=(",", ":"),
            )
        except Exception:
            return
    try:
        _logger.info(line)
    except Exception:
        pass


def _json_default(o: Any) -> Any:
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    if isinstance(o, bytes):
        try:
            return o.decode("utf-8", errors="replace")
        except Exception:
            return repr(o)
    return repr(o)


class Aggregator:
    """Periodic-summary helper for trace events.

    Three call sites (gateway _hal_send, hal_reader per-tick,
    hal_watchdog per-tick) all follow the same pattern: accumulate
    count + per-metric total + per-metric max for N events, emit a
    summary, reset. This class collapses the boilerplate.

    Usage::

        agg = Aggregator("hal.send_summary", every=30)
        agg.record(send_ms=1.4)
        # ... after every 30 record() calls, emits one event with
        # count=30, avg_send_ms=..., max_send_ms=...

    Per-metric fields are emitted as ``avg_<metric>_ms`` and
    ``max_<metric>_ms`` if the metric name ends in ``_ms``, otherwise
    as ``avg_<metric>`` and ``max_<metric>``. The ``count`` field is
    always included. Optional ``extra_fields`` are merged into the
    summary at emit-time; pass a callable to defer evaluation.
    """

    def __init__(self, tag: str, every: int = 30,
                 level: str = "info",
                 count_field: str = "count",
                 extra_fields=None) -> None:
        self._tag = tag
        self._every = max(1, int(every))
        self._level = level
        # count_field overrides the field name for the recordings
        # counter. Most call sites use "count"; the watchdog summary
        # historically used "ticks", and we preserve that field name
        # exactly so trace consumers don't see a rename.
        self._count_field = count_field
        # extra_fields can be a dict (static) or a zero-arg callable
        # returning a dict (computed at emit time, e.g. for
        # `client_inq` that needs to be read fresh).
        self._extra_fields = extra_fields
        self._count = 0
        self._totals: dict = {}
        self._maxes: dict = {}

    def record(self, **measurements: float) -> None:
        """Add one observation. Triggers an emit + reset every
        ``every`` calls. Doesn't propagate exceptions to the caller
        (telemetry must never crash production paths) but does NOT
        swallow them silently — failures emit a `trace.aggregator_error`
        event so a buggy caller (NaN measurement, non-numeric value,
        thread-safety issue) is visible in the trace bus instead of
        being hidden behind dropped data."""
        try:
            for k, v in measurements.items():
                fv = float(v)
                self._totals[k] = self._totals.get(k, 0.0) + fv
                if fv > self._maxes.get(k, float("-inf")):
                    self._maxes[k] = fv
            self._count += 1
            if self._count >= self._every:
                self._emit()
        except Exception as e:
            emit(
                "trace.aggregator_error", level="error",
                agg_tag=self._tag,
                phase="record",
                exc=type(e).__name__, err=str(e),
                metric_keys=list(measurements.keys()),
            )
            self._reset()

    def _emit(self) -> None:
        fields: dict = {self._count_field: self._count}
        for k, total in self._totals.items():
            avg = total / self._count if self._count else 0.0
            # Field naming: simply prefix with `avg_` / `max_`. Caller
            # chooses metric names — `record(ms=…)` → `avg_ms`/`max_ms`,
            # `record(pin_ms=…, send_ms=…)` → `avg_pin_ms`/`max_pin_ms`/etc.
            fields[f"avg_{k}"] = round(avg, 3)
            fields[f"max_{k}"] = round(self._maxes.get(k, 0.0), 3)
        # Static or computed extras. Computed lets callers attach
        # point-in-time state (current pin values, kernel buffer
        # depth) without having to record them every observation.
        # If the callable raises, surface as `trace.aggregator_error`
        # rather than silently emitting the summary without extras —
        # otherwise a buggy extras callable produces summaries that
        # *look* fine but are missing the expected fields.
        try:
            if callable(self._extra_fields):
                extras = self._extra_fields() or {}
            elif isinstance(self._extra_fields, dict):
                extras = self._extra_fields
            else:
                extras = {}
            fields.update(extras)
        except Exception as e:
            emit(
                "trace.aggregator_error", level="error",
                agg_tag=self._tag,
                phase="extra_fields",
                exc=type(e).__name__, err=str(e),
            )
        emit(self._tag, level=self._level, **fields)
        self._reset()

    def _reset(self) -> None:
        self._count = 0
        self._totals.clear()
        self._maxes.clear()
