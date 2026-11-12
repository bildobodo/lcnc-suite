"""Suite-wide structured trace bus.

Every component (gateway, hal_reader, hal_watchdog) imports this module and
calls `init(<proc_name>)` once at startup, then `emit(tag, **fields)` for
each event. All events land in trace.ndjson under the resolved log dir
(see lcnc_paths.resolve(); default <install-dir>/runlogs).

Why one shared file across processes: Linux guarantees atomic O_APPEND writes
up to PIPE_BUF (4096 B), so concurrent appends from multiple processes are
line-atomic (emit() caps each line below that). Each line carries `proc` + `pid`
so the bundler can demux later.

Known limitation — multi-writer rollover: the four writers each hold their own
fd and size-check independently, so plain RotatingFileHandler can race at the
50 MB rollover boundary (two processes rename trace.ndjson->.1 at once, losing
history, or one keeps appending to a rotated-away fd). This is accepted as a
rare, diagnostic-only risk: it needs the file to hit 50 MB AND two processes to
cross within the same sub-ms window, and the cost is lost forensic history at a
rotation boundary — never a control/safety effect. The clean fixes both have a
worse cost here: concurrent-log-handler's portalocker lock only coordinates if
EVERY writer holds it, but the HAL siblings run under the system python (no
venv access), so it would be dead weight; a stdlib fcntl.flock handler would
work but is custom code in the trace path. If rollover corruption is ever
actually observed, the flock handler is the dependency-free way to close it.

Why direct file write (not queue + thread): NDJSON encoding is < 50 us per
event; line-buffered O_APPEND write is 1-10 us uncached. At our event rate
(~50/s steady, ~500/s burst) the cost is negligible vs the asyncio loop's
heartbeat budget.

Format example:
    {"t_wall_ns": 1735000000123456789, "t_mono_ms": 12345.6,
     "proc": "gateway", "pid": 1234,
     "tag": "lag", "level": "warn", "msg": "loop stalled",
     "drift_ms": 646}

────────────────────────────────────────────────────────────────────────────
Logging-bucket policy (the contract for choosing print vs _trace.emit):

  Operational events  →  _trace.emit only
    ws connect/disconnect, hal connect, state changes, settings reload,
    tool-table edits, safety trips, reader stale, NML poison, self-restart,
    rare-fault error paths. These are queryable, structured, aggregatable.
    Tag style: dot-namespaced (e.g. "ws.connect.viewer_init",
    "hal.send_timeout"). level= info | warn | error.

  Lifecycle markers   →  _trace.emit only
    BOOT, VINIT, SHUTDOWN — singular events with timing. The bundler
    reconstructs cross-process timelines from these.

  User-facing console →  print(...) only
    The small set of messages the operator must see in the gateway terminal
    (uvicorn's own startup banner, deliberate machine-state announcements,
    user-typed shutdown confirmations). Keep these terse — one line each.

  TEMP probes         →  print(...), marked with `# TEMP`
    [HB-STALL], [LAG], [GC], [HB-WAKE], [HB-TRACE]. These exist to chase a
    specific bug; once the root cause is fixed and the probe code is
    removed, the print goes with it. Don't pollute the trace bus.

  Per-tick spam       →  _trace.emit warn, rate-limit if needed
    Poller errors, missing-field warns. _trace's structured form lets a
    bundler aggregate (e.g. "10× poller.no_machine_pos in 60 s").

NEVER emit the same event through both channels — pick one. Dual-emit
fragments diagnostic search and was the highest-priority cleanup in
Initiative E. See ws.connect.viewer_init / ws.connect.settings for the
canonical patterns.
"""
from __future__ import annotations

import json
import logging
import logging.handlers
import os
import signal
import sys
import threading
import time
import traceback
from types import FrameType, TracebackType
from typing import TYPE_CHECKING, Any, Callable, Iterable, Mapping, Optional, TypeGuard, Union

if TYPE_CHECKING:
    import asyncio

import lcnc_paths

# Filename constants. These live under the resolved log_dir from
# lcnc_paths.resolve(); the launcher uses the same names via shell.
_TRACE_FILENAME = "trace.ndjson"
_CRASH_FILENAME = "crash.log"

_TRACE_MAX_BYTES = 50 * 1024 * 1024  # 50 MB
_TRACE_BACKUPS = 5
# Multi-writer atomic appends require each line < PIPE_BUF (4096 B on Linux).
# Cap below that (leaving room for the trailing newline the handler adds) so an
# oversize event can't interleave with another process's line and corrupt the
# NDJSON stream. Oversize records are replaced with a bounded truncation marker.
_MAX_LINE_BYTES = 4000
_CRASH_MAX_BYTES = 5 * 1024 * 1024   # 5 MB
_CRASH_BACKUPS = 5
_LOGGER_NAME = "lcnc.trace"

_proc_name: str = "?"
_pid: int = 0
_t0_mono: float = 0.0
_t0_wall_ns: int = 0
_logger: Optional[logging.Logger] = None
_initialized: bool = False
_log_dir: str = ""
_logger_failed: bool = False  # one-shot guard for self-swallow at write time


class _CrashFilter(logging.Filter):
    """Admit only `crash.*` and `browser.error.*` events.

    Reads the tag from the record attribute emit() attaches (`_trace_tag`),
    so the reject path — the vast majority of emits — costs a string check,
    not a json.loads of the whole line on every event (P0.3). Falls back to
    decoding only for the rare record that didn't come through emit()."""

    def filter(self, record: logging.LogRecord) -> bool:
        tag = getattr(record, "_trace_tag", None)
        if tag is None:
            try:
                tag = json.loads(record.msg).get("tag", "")
            except Exception:
                return False
        return tag.startswith("crash.") or tag.startswith("browser.error.")


def init(proc_name: str, log_dir: Optional[str] = None) -> None:
    """Call once at process start. Records the boot time anchor and opens
    the trace file with rotation.

    `log_dir` overrides the resolver — useful for tests. Production
    callers pass nothing and let lcnc_paths.resolve() pick the path.
    """
    global _proc_name, _pid, _t0_mono, _t0_wall_ns, _logger, _initialized, _log_dir
    if _initialized:
        return
    _proc_name = proc_name
    _pid = os.getpid()
    _t0_mono = time.monotonic()
    _t0_wall_ns = time.time_ns()

    if log_dir is None:
        _log_dir, _ = lcnc_paths.resolve()
    else:
        _log_dir = log_dir
    trace_path = os.path.join(_log_dir, _TRACE_FILENAME)
    crash_path = os.path.join(_log_dir, _CRASH_FILENAME)

    try:
        logger = logging.getLogger(_LOGGER_NAME)
        # Keep our handler isolated from the root logger.
        logger.propagate = False
        logger.setLevel(logging.DEBUG)
        # Don't double-attach if a previous init partially ran.
        has_trace = any(
            getattr(h, "_lcnc_role", "") == "trace"
            for h in logger.handlers
        )
        if not has_trace:
            # Stdlib RotatingFileHandler. Line writes are atomic across the four
            # writers (< PIPE_BUF, enforced in emit()); the one un-coordinated
            # multi-writer hazard is the 50 MB rollover itself — see the
            # "Known limitation" note in the module docstring. Accepted as a
            # rare, diagnostic-only risk rather than carry a dependency that the
            # system-python HAL siblings can't share anyway.
            trace_h = logging.handlers.RotatingFileHandler(
                trace_path, maxBytes=_TRACE_MAX_BYTES, backupCount=_TRACE_BACKUPS
            )
            # We pre-encode NDJSON in the message; the formatter just emits
            # the message verbatim with a trailing newline (logging adds one).
            trace_h.setFormatter(logging.Formatter("%(message)s"))
            trace_h._lcnc_role = "trace"  # type: ignore[attr-defined]
            logger.addHandler(trace_h)

            crash_h = logging.handlers.RotatingFileHandler(
                crash_path, maxBytes=_CRASH_MAX_BYTES, backupCount=_CRASH_BACKUPS
            )
            crash_h.setFormatter(logging.Formatter("%(message)s"))
            crash_h.addFilter(_CrashFilter())
            crash_h._lcnc_role = "crash"  # type: ignore[attr-defined]
            logger.addHandler(crash_h)
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
        log_dir=_log_dir,
        msg=f"{proc_name} trace started",
    )


def log_dir() -> str:
    """Return the resolved log directory. Empty string before init()."""
    return _log_dir


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
    if len(line.encode("utf-8", "replace")) > _MAX_LINE_BYTES:
        # Too big to append atomically — replace with a valid, bounded record
        # that preserves the core fields and flags the truncation, rather than
        # risk a torn line interleaving with another process's write.
        try:
            line = json.dumps(
                {"t_wall_ns": rec["t_wall_ns"], "t_mono_ms": rec["t_mono_ms"],
                 "proc": rec["proc"], "pid": rec["pid"], "tag": tag,
                 "level": rec["level"], "msg": (msg[:200] if msg else ""),
                 "truncated": True},
                separators=(",", ":"),
            )
        except Exception:
            return
    try:
        # Attach the tag as a record attribute so _CrashFilter can match without
        # re-decoding the JSON line on every emit (P0.3).
        _logger.info(line, extra={"_trace_tag": tag})
    except Exception as e:
        # One-shot self-report. We cannot recursively call emit() to log
        # the logger failure (would infinite-loop), so the only honest
        # signal is a single stderr print the first time it happens.
        # Silent fallback here was the highest-priority trace gap.
        global _logger_failed
        if not _logger_failed:
            _logger_failed = True
            print(
                f"[TRACE] logger write failed (further failures silenced): {e}",
                file=sys.stderr, flush=True,
            )


def emit_exc(tag: str, exc: BaseException, level: str = "warn",
             **fields: Any) -> None:
    """Convenience for `except Exception as e: emit_exc(tag, e)` patterns.

    Captures exc_type and a truncated exc_msg. Use this instead of
    `except Exception: pass` everywhere that drop hides a real failure
    mode. For parsing failures wanting line context, use emit_exc_tb."""
    emit(
        tag, level=level,
        exc_type=type(exc).__name__,
        exc_msg=str(exc)[:500],
        **fields,
    )


def emit_exc_tb(tag: str, exc: BaseException, level: str = "warn",
                tb_limit: int = 8, **fields: Any) -> None:
    """Like emit_exc but includes a short traceback tail. Use for
    parsing failures where the line context matters."""
    try:
        tb_tail = "".join(traceback.format_exception(
            type(exc), exc, exc.__traceback__, limit=tb_limit
        ))[-2000:]
    except Exception:
        tb_tail = ""
    emit(
        tag, level=level,
        exc_type=type(exc).__name__,
        exc_msg=str(exc)[:500],
        tb_tail=tb_tail,
        **fields,
    )


# ──────────────────────────────────────────────────────────────────
# Crash hooks
#
# Three things land in the trace bus that previously only hit stderr:
#   1. sys-level unhandled exceptions  → crash.sys_excepthook
#   2. thread unhandled exceptions     → crash.thread
#   3. asyncio unhandled task errors   → crash.asyncio_unhandled
# Plus SIGTERM/SIGINT as crash.signal at level=info (these are normal
# but the timing is useful for postmortem correlation).
#
# Not catchable in pure Python: SIGSEGV / SIGABRT. The libc abort
# message lands in gateway.log via the launcher tee — document there.
# ──────────────────────────────────────────────────────────────────

_crash_hooks_installed = False


def install_crash_hooks(proc_name: str) -> None:
    """Wire sys.excepthook, threading.excepthook, and SIGTERM/SIGINT
    handlers so unhandled errors land in the trace bus.

    The asyncio handler is NOT installed here because the event loop
    doesn't exist at import time. Gateway calls `install_asyncio_handler()`
    inside its FastAPI lifespan startup.

    Safe to call multiple times — only the first call wires the hooks."""
    global _crash_hooks_installed
    if _crash_hooks_installed:
        return
    _crash_hooks_installed = True

    prev_excepthook = sys.excepthook

    def _sys_hook(exc_type: type[BaseException], exc_value: BaseException,
                  exc_tb: Optional[TracebackType]) -> None:
        try:
            tb_tail = "".join(traceback.format_exception(
                exc_type, exc_value, exc_tb, limit=12
            ))[-2000:]
            emit(
                "crash.sys_excepthook", level="error",
                proc=proc_name,
                exc_type=getattr(exc_type, "__name__", str(exc_type)),
                exc_msg=str(exc_value)[:500],
                tb_tail=tb_tail,
            )
        finally:
            # Chain to the previous hook (typically sys.__excepthook__)
            # so the traceback still hits stderr and lands in gateway.log
            # via the launcher tee.
            try:
                prev_excepthook(exc_type, exc_value, exc_tb)
            except Exception:
                # safe-silent: hook chain is best-effort, Python is already
                # unwinding the interpreter.
                pass

    sys.excepthook = _sys_hook

    def _thread_hook(args: threading.ExceptHookArgs) -> None:
        try:
            tb_tail = "".join(traceback.format_exception(
                args.exc_type, args.exc_value, args.exc_traceback, limit=12
            ))[-2000:]
            emit(
                "crash.thread", level="error",
                proc=proc_name,
                thread_name=getattr(args.thread, "name", "?"),
                exc_type=getattr(args.exc_type, "__name__", str(args.exc_type)),
                exc_msg=str(args.exc_value)[:500],
                tb_tail=tb_tail,
            )
        except Exception:
            # safe-silent: same reasoning as _sys_hook chain.
            pass

    threading.excepthook = _thread_hook

    # SIGTERM/SIGINT: log timing, then re-raise default disposition so the
    # process's existing graceful shutdown runs. Don't swallow the signal.
    def _signal_hook(signo: int, frame: Optional[FrameType]) -> None:
        try:
            emit(
                "crash.signal", level="info",
                proc=proc_name,
                signo=signo,
                signame=signal.Signals(signo).name,
            )
        except Exception:
            # safe-silent: signal handlers must return quickly.
            pass
        # Restore default and re-raise so the kernel's default disposition
        # (terminate) runs, but only after the existing handler chain
        # in each process has finished its asyncio teardown.
        signal.signal(signo, signal.SIG_DFL)
        os.kill(os.getpid(), signo)

    # Only install if no handler is already wired by the host process.
    # gateway.py / hal_watchdog.py both install their own SIGTERM handlers
    # for cooperative shutdown — don't clobber them. We log via the asyncio
    # loop signal handler instead (see install_asyncio_handler).
    for signo in (signal.SIGTERM, signal.SIGINT):
        try:
            current = signal.getsignal(signo)
            if current in (signal.SIG_DFL, signal.SIG_IGN, None):
                signal.signal(signo, _signal_hook)
        except (ValueError, OSError):
            # safe-silent: signal.signal raises ValueError off the main
            # thread; we may be imported into a worker. Not fatal.
            pass


def install_asyncio_handler(proc_name: str) -> None:
    """Install an asyncio exception handler that mirrors unhandled task
    errors to the trace bus. Must be called from inside a running event
    loop (e.g. FastAPI lifespan startup)."""
    import asyncio
    loop = asyncio.get_event_loop()
    prev = loop.get_exception_handler()

    def _handler(loop_: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        # context: asyncio's own handler contract (typeshed _ExceptionHandler)
        try:
            exc: Optional[BaseException] = context.get("exception")
            tb_tail = ""
            if exc is not None:
                try:
                    tb_tail = "".join(traceback.format_exception(
                        type(exc), exc, exc.__traceback__, limit=12
                    ))[-2000:]
                except Exception:
                    tb_tail = ""
            emit(
                "crash.asyncio_unhandled", level="error",
                proc=proc_name,
                message=str(context.get("message", ""))[:300],
                exc_type=type(exc).__name__ if exc is not None else None,
                exc_msg=str(exc)[:500] if exc is not None else None,
                tb_tail=tb_tail,
            )
        finally:
            # Preserve existing handling (uvicorn installs its own) so
            # nothing observable changes besides the new trace entry.
            if prev is not None:
                try:
                    prev(loop_, context)
                except Exception:
                    # safe-silent: previous handler is third-party.
                    pass
            else:
                loop_.default_exception_handler(context)

    loop.set_exception_handler(_handler)


def _is_collection(o: object) -> TypeGuard[Iterable[object]]:
    """A set, frozenset or tuple — encoded as a JSON list."""
    return isinstance(o, (set, frozenset, tuple))


def _json_default(o: object) -> object:
    if _is_collection(o):
        return list(o)
    if isinstance(o, bytes):
        try:
            return o.decode("utf-8", errors="replace")
        except Exception:
            return repr(o)
    return repr(o)


#: An Aggregator's extras: static fields, or a zero-arg callable that returns
#: them at emit time (None = none). Trace fields are any value — the bus
#: encodes JSON and reprs the rest (_json_default).
ExtraFields = Union[Mapping[str, object], Callable[[], Optional[Mapping[str, object]]], None]


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
                 extra_fields: ExtraFields = None) -> None:
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
        self._totals: dict[str, float] = {}
        self._maxes: dict[str, float] = {}

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
        # Any: these go to emit(**fields: Any), the trace bus's own field
        # contract (JSON, a repr for the rest) — a field named like one of
        # emit's parameters keeps reaching it as before
        fields: dict[str, Any] = {self._count_field: self._count}
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
                if not isinstance(extras, dict):
                    raise TypeError(f"extra_fields returned {type(extras).__name__}, not a dict")
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
