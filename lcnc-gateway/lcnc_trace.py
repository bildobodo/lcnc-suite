"""Suite-wide structured trace bus.

Every component (gateway, hal_reader, hal_watchdog) imports this module and
calls `init(<proc_name>)` once at startup, then `emit(tag, **fields)` for
each event. All events land in trace.ndjson under the resolved log dir
(see lcnc_paths.resolve(); default <install-dir>/runlogs).

Why one shared file across processes: one timeline. Each line carries `proc`
+ `pid` so the bundler can demux later; the lines of several writers never
interleave because each is written whole inside the log's lock (below —
emit() still caps a line at _MAX_LINE_BYTES so one event stays one bounded
write).

Multi-writer rollover — ONE coordinated section per line (P3, machine day
2026-11-21, F23; Codex R425 MT425-02, R426): every writer — gateway,
hal_reader, hal_watchdog, the parse worker and the launcher's two lines —
takes the log's stable lock (`trace.lock` / `crash.lock`, never rotated,
never matched by a `trace.ndjson*` / `crash.log*` glob) and, inside ONE
short exclusive section, checks the file's identity (reopens after another
writer's rotation), its size (rotates the chain `.N … .1`), its open end
(a fragment a writer left behind — a partial write under EFBIG / ENOSPC,
a process killed mid-write — is terminated with a newline first: the
damage stays one damaged line and the next record stays readable) and
writes the COMPLETE line. The rotation used to be uncoordinated and was
called "rare"; it is DETERMINISTIC at every rollover: the other processes
kept their fd and wrote on into the renamed file (the machine day's trace
lay in three files, gateway → .1, hal_reader → .2, the rest → trace.ndjson).
The lock is taken with LOCK_NB and retried for at most _LOCK_BUDGET_S —
it bounds the wait for the LOCK, not the file I/O. Without it nothing is
written unlocked: the record is dropped and COUNTED per process and log,
and the next section that gets through writes `trace.write_lost` (crash
log: `crash.write_lost`) — directly, never through emit(). A process that
ends first cannot report its loss (close() tries once more). The
stdlib-only handler (fcntl) is shared by the HAL siblings under the system
python.

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
    A line inside a chain that must run to its end (the shutdown, a HAL
    disconnect) goes through `console(text)` and comes AFTER the chain's
    trace; no console write ever raises (ConsoleGuard, below).

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

import errno
import fcntl
import json
import logging
import os
import signal
import sys
import threading
import time
import traceback
from types import FrameType, TracebackType
from typing import TYPE_CHECKING, Any, Callable, Iterable, Mapping, Optional, TextIO, TypeGuard, Union

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
# The logs' stable locks (P3): names no `trace.ndjson*` / `crash.log*` glob
# matches, so no reader of the logs ever takes a lock file for a generation.
_TRACE_LOCK_FILENAME = "trace.lock"
_CRASH_LOCK_FILENAME = "crash.lock"
# The longest a writer waits for a log's lock (LOCK_NB, retried): the budget
# of the WAIT, not of the file I/O (Codex R425 MT425-02).
_LOCK_BUDGET_S = 0.020
_LOCK_RETRY_S = 0.001
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


def _errname(e: OSError) -> str:
    """The errno's symbol (EFBIG, ENOSPC …), or the exception's class."""
    code = e.errno
    if isinstance(code, int) and code in errno.errorcode:
        return errno.errorcode[code]
    return type(e).__name__


class CoordinatedFileHandler(logging.Handler):
    """One log file shared by several processes, written in ONE coordinated
    section per line (P3; the module docstring has the why).

    The section, under an exclusive flock on `lock_path` taken within
    _LOCK_BUDGET_S: the file's identity (a rotation by another writer → reopen
    the path), the size (past `max_bytes` → rotate `.N … .1` here), the open
    end (a last byte that is no newline → terminate the fragment), a pending
    report, then the complete line (os.write in a loop). Nothing is ever
    written outside the section: a busy lock, a failed open or a failed write
    drops the record and counts it; the next section that gets through writes
    `<prefix>.write_lost {log, count, since_ns, why}` first (or
    `<prefix>.fragment_closed` for a fragment it only terminated) — directly,
    never through emit(), so a failing report never recurses."""

    def __init__(self, path: str, lock_path: str, *, max_bytes: int, backups: int,
                 report_prefix: str) -> None:
        super().__init__()
        self.path = path
        self.lock_path = lock_path
        self.max_bytes = max_bytes
        self.backups = backups
        self.report_prefix = report_prefix
        self.log_name = os.path.basename(path)
        #: the write call — the seam of the fault-injection tests (ENOSPC)
        self.raw_write: Callable[[int, bytes], int] = os.write
        self._owner_pid = os.getpid()
        self._fd: Optional[int] = None
        self._ident: Optional[tuple[int, int]] = None
        self._lock_fd: Optional[int] = None
        # (dev, ino, size) right after this handler's last complete line: an
        # end still there needs no look at its last byte
        self._end: Optional[tuple[int, int, int]] = None
        self._lost = 0
        self._lost_since_ns: Optional[int] = None
        self._lost_why: dict[str, int] = {}
        self._fragments = 0
        self._rotate_failed: dict[str, int] = {}
        self._noted: set[str] = set()
        self._notes_due: list[str] = []
        # inside this handler's own section: a write that reaches it again
        # (a console note's failure traced through emit()) must neither
        # re-lock nor UNLOCK the section's lock (flock is per open file
        # description — a nested unlock would release the outer section)
        self._in_section = False
        self._report_snap: Optional[dict[str, Any]] = None

    # ── the count of what was not written ──────────────────────────────
    def _count_loss(self, why: str) -> None:
        self._lost += 1
        if self._lost_since_ns is None:
            self._lost_since_ns = time.time_ns()
        self._lost_why[why] = self._lost_why.get(why, 0) + 1
        if why not in self._noted:
            # once per reason, on the console — said AFTER the section
            # (_say_notes): the trace cannot carry it now
            self._noted.add(why)
            self._notes_due.append(why)

    def _say_notes(self) -> None:
        """The console notes of new loss reasons, outside the section (the
        console never raises — ConsoleGuard; its own failure is traced
        through emit(), which may reach this handler again)."""
        while self._notes_due:
            why = self._notes_due.pop(0)
            try:
                print(f"[TRACE] {self.log_name}: a record was not written ({why}) — "
                      f"counted, reported as {self.report_prefix}.write_lost",
                      file=sys.stderr, flush=True)
            except Exception:  # noqa: BLE001 - the last fallback is best effort (VM-I14)
                pass

    def pending_report(self) -> dict[str, Any]:
        """The losses and repairs not yet reported (tests read it)."""
        return {"lost": self._lost, "why": dict(self._lost_why),
                "fragments_closed": self._fragments, "rotate_failed": dict(self._rotate_failed)}

    def _report_line(self) -> Optional[bytes]:
        """The pending report — and the snapshot of exactly the counts it
        carries (`_report_snap`): only those are settled once it is written
        (Codex R428 MT-I12 — a loss counted while it is written stays
        pending)."""
        self._report_snap = None
        if not (self._lost or self._fragments or self._rotate_failed):
            return None
        self._report_snap = {"lost": self._lost, "why": dict(self._lost_why),
                             "fragments": self._fragments, "rotate_failed": dict(self._rotate_failed),
                             "at_ns": time.time_ns()}
        lost = self._lost > 0
        rec: dict[str, Any] = {
            "t_wall_ns": time.time_ns(),
            "t_mono_ms": round((time.monotonic() - _t0_mono) * 1000, 3),
            "proc": _proc_name, "pid": os.getpid(),
            "tag": f"{self.report_prefix}.{'write_lost' if lost else 'fragment_closed'}",
            # a lost crash record is a finding (native_run reads crash.log)
            "level": "error" if lost and self.report_prefix == "crash" else "warn",
            "log": self.log_name,
            "count": self._lost,
        }
        if lost:
            rec["since_ns"] = self._lost_since_ns
            rec["why"] = dict(self._lost_why)
        if self._fragments:
            rec["fragments_closed"] = self._fragments
        if self._rotate_failed:
            rec["rotate_failed"] = dict(self._rotate_failed)
        return (json.dumps(rec, separators=(",", ":")) + "\n").encode("utf-8", "replace")

    def _report_written(self) -> None:
        """The report went out: settle exactly what it carried. A loss, a
        fragment or a refused rotation counted meanwhile (the reentrant path
        while it was written) stays pending for the next report; a report
        that failed settles nothing."""
        snap = self._report_snap
        self._report_snap = None
        if snap is None:
            return
        self._lost = max(0, self._lost - snap["lost"])
        for why, n in snap["why"].items():
            left = self._lost_why.get(why, 0) - n
            if left > 0:
                self._lost_why[why] = left
            else:
                self._lost_why.pop(why, None)
        self._lost_since_ns = snap["at_ns"] if self._lost else None
        self._fragments = max(0, self._fragments - snap["fragments"])
        for log, n in snap["rotate_failed"].items():
            left = self._rotate_failed.get(log, 0) - n
            if left > 0:
                self._rotate_failed[log] = left
            else:
                self._rotate_failed.pop(log, None)

    # ── the lock ───────────────────────────────────────────────────────
    def _forget_inherited(self) -> None:
        """A forked child shares the parent's open file descriptions: an
        unlock there would release the PARENT's lock. The child closes its
        copies (no unlock) and opens its own."""
        if os.getpid() == self._owner_pid:
            return
        for fd in (self._fd, self._lock_fd):
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    pass  # safe-silent: the child's copy only
        self._fd = self._lock_fd = None
        self._ident = self._end = None
        self._owner_pid = os.getpid()

    def _lock(self) -> Optional[str]:
        """Take the log's lock within the budget: None, or why not."""
        deadline = time.monotonic() + _LOCK_BUDGET_S
        while True:
            if self._lock_fd is None:
                try:
                    self._lock_fd = os.open(self.lock_path, os.O_RDWR | os.O_CREAT | os.O_CLOEXEC, 0o644)
                except OSError as e:
                    return "lock_open:" + _errname(e)
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    return "lock_busy"
                time.sleep(_LOCK_RETRY_S)
                continue
            except OSError as e:
                return "lock:" + _errname(e)
            # the lock file itself replaced (a cleanup of the folder): every
            # writer must lock the SAME file
            try:
                same = os.fstat(self._lock_fd).st_ino == os.stat(self.lock_path).st_ino
            except OSError:
                same = False
            if same:
                return None
            try:
                os.close(self._lock_fd)   # releases its lock
            except OSError:
                pass  # safe-silent: replaced below
            self._lock_fd = None

    def _unlock(self) -> None:
        if self._lock_fd is not None:
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
            except OSError:
                pass  # safe-silent: the lock goes with the fd at the latest

    # ── inside the section ─────────────────────────────────────────────
    def _current(self) -> tuple[int, tuple[int, int]]:
        """The fd of the file now at `path` (reopened after a rotation)."""
        try:
            st = os.stat(self.path)
            ident: Optional[tuple[int, int]] = (st.st_dev, st.st_ino)
        except FileNotFoundError:
            ident = None
        if self._fd is not None and ident is not None and ident == self._ident:
            return self._fd, ident
        if self._fd is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass  # safe-silent: an old generation's fd
            self._fd = None
        fd = os.open(self.path, os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_CLOEXEC, 0o644)
        st = os.fstat(fd)
        self._fd, self._ident = fd, (st.st_dev, st.st_ino)
        return fd, self._ident

    def _rotate(self) -> None:
        """`.N-1 → .N … path → .1`, under the lock. A failure is reported,
        and the line goes into the file it has (past its size)."""
        try:
            for i in range(self.backups - 1, 0, -1):
                try:
                    os.replace(f"{self.path}.{i}", f"{self.path}.{i + 1}")
                except FileNotFoundError:
                    pass  # a gap in the chain (a rotator that died between two renames)
            if self.backups > 0:
                os.replace(self.path, f"{self.path}.1")
            elif self._fd is not None:
                os.ftruncate(self._fd, 0)
        except OSError as e:
            why = _errname(e)
            self._rotate_failed[why] = self._rotate_failed.get(why, 0) + 1

    def _write_all(self, fd: int, buf: bytes) -> tuple[int, Optional[str]]:
        """Write all of `buf`: (bytes written, None) or (written so far, why)."""
        done = 0
        while done < len(buf):
            try:
                n = self.raw_write(fd, buf[done:])
            except OSError as e:
                return done, _errname(e)
            if n <= 0:
                return done, "short_write"
            done += n
        return done, None

    def _section(self, data: Optional[bytes]) -> bool:
        """The coordinated section (the lock held); `data` None = only the
        report. True when everything asked for was written."""
        try:
            fd, ident = self._current()
            size = os.fstat(fd).st_size
            if size > 0 and self._end != (ident[0], ident[1], size) \
                    and os.pread(fd, 1, size - 1) != b"\n":
                # a fragment some writer left (Codex R426): end it first, so
                # it stays ONE damaged line and this record stays readable —
                # in the file that holds it, BEFORE a rotation could carry the
                # open end into a generation (Codex R428 MT-I13)
                wrote, why = self._write_all(fd, b"\n")
                if why is not None:
                    if data:
                        self._count_loss(why)
                    return False
                self._fragments += 1
                size += wrote
            report = self._report_line()
            need = (len(data) if data else 0) + (len(report) if report else 0)
            if self.max_bytes > 0 and size > 0 and size + need > self.max_bytes:
                self._rotate()
                fd, ident = self._current()
                size = os.fstat(fd).st_size
            report = self._report_line()   # a fragment closed or a rotation refused joins it
        except OSError as e:
            if data:
                self._count_loss(_errname(e))
            return False
        if report:
            wrote, why = self._write_all(fd, report)
            size += wrote
            if why is not None:
                if wrote:
                    self._write_all(fd, b"\n")   # end its own fragment (else the next section does)
                if data:
                    self._count_loss(why)
                self._end = None
                return False
            self._report_written()
        if data:
            wrote, why = self._write_all(fd, data)
            size += wrote
            if why is not None:
                if wrote:
                    self._write_all(fd, b"\n")
                self._count_loss(why)
                self._end = None
                return False
        self._end = (ident[0], ident[1], size)
        return True

    def append(self, data: Optional[bytes]) -> bool:
        """One coordinated section: `data` (a complete line, its newline
        included) after any pending report. False = not (all) written — the
        record is counted, never written unlocked."""
        self._forget_inherited()
        if self._in_section:
            if data:
                self._count_loss("reentrant")
            return False
        why = self._lock()
        if why is not None:
            if data:
                self._count_loss(why)
            self._say_notes()
            return False
        self._in_section = True
        try:
            ok = self._section(data)
        finally:
            self._in_section = False
            self._unlock()
        self._say_notes()
        return ok

    def emit(self, record: logging.LogRecord) -> None:
        try:
            data = (self.format(record) + "\n").encode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001 - counted, never raised into a caller
            self._count_loss("format:" + type(e).__name__)
            if not self._in_section:
                self._say_notes()
            return
        self.append(data)

    def doRollover(self) -> None:
        """Rotate now, in a coordinated section (the stdlib's name: tests and
        tools rotate through it)."""
        self._forget_inherited()
        why = self._lock()
        if why is not None:
            raise OSError(errno.EWOULDBLOCK, f"{self.lock_path}: {why}")
        try:
            self._current()
            self._rotate()
            self._end = None
        finally:
            self._unlock()

    def close(self) -> None:
        """A last try at the pending report, then the fds."""
        self.acquire()
        try:
            if self._lost or self._fragments or self._rotate_failed:
                self.append(None)
            for fd in (self._fd, self._lock_fd):
                if fd is not None:
                    try:
                        os.close(fd)
                    except OSError:
                        pass  # safe-silent: closing
            self._fd = self._lock_fd = None
            self._ident = self._end = None
        finally:
            self.release()
        super().close()


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
            # ONE coordinated section per line for every writer (P3, see the
            # module docstring): identity, size, rotation, open end and the
            # complete line under the log's stable lock.
            trace_h = CoordinatedFileHandler(
                trace_path, os.path.join(_log_dir, _TRACE_LOCK_FILENAME),
                max_bytes=_TRACE_MAX_BYTES, backups=_TRACE_BACKUPS, report_prefix="trace",
            )
            # We pre-encode NDJSON in the message; the formatter just emits
            # the message verbatim (the handler adds the newline).
            trace_h.setFormatter(logging.Formatter("%(message)s"))
            trace_h._lcnc_role = "trace"  # type: ignore[attr-defined]
            logger.addHandler(trace_h)

            crash_h = CoordinatedFileHandler(
                crash_path, os.path.join(_log_dir, _CRASH_LOCK_FILENAME),
                max_bytes=_CRASH_MAX_BYTES, backups=_CRASH_BACKUPS, report_prefix="crash",
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
            try:
                print(
                    f"[TRACE] logger write failed (further failures silenced): {e}",
                    file=sys.stderr, flush=True,
                )
            except Exception:  # noqa: BLE001
                # the LAST fallback is best effort too (Codex R370 VM-I14): a
                # raw, closed stderr made emit() raise here and stopped the
                # shutdown chain that called it before its deadline
                pass


def _exc_msg(exc: BaseException) -> str:
    """str(exc), or a placeholder when the exception's own __str__ raises —
    a failure report must never raise in its caller's chain (VM-I14)."""
    try:
        return str(exc)[:500]
    except Exception:  # noqa: BLE001
        return "<str() of the exception failed>"


def emit_exc(tag: str, exc: BaseException, level: str = "warn",
             **fields: Any) -> None:
    """Convenience for `except Exception as e: emit_exc(tag, e)` patterns.

    Captures exc_type and a truncated exc_msg. Use this instead of
    `except Exception: pass` everywhere that drop hides a real failure
    mode. For parsing failures wanting line context, use emit_exc_tb.
    Never raises, like emit()."""
    emit(
        tag, level=level,
        exc_type=type(exc).__name__,
        exc_msg=_exc_msg(exc),
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
        exc_msg=_exc_msg(exc),
        tb_tail=tb_tail,
        **fields,
    )


# ──────────────────────────────────────────────────────────────────
# The console never raises into its caller.
#
# The gateway's stdout/stderr is the launcher's tee to gateway.log; the HAL
# helpers' is whatever started LinuxCNC. When that reader is gone a write
# raises — BrokenPipeError, EIO on a dead terminal, ValueError on a closed
# stream — out of whatever path printed. The 3a merge gate's install probe
# caught it: the instance-ended chain printed after its latch and before its
# trace, its HAL disconnect and its shutdown request; the print raised, the
# watch task died, and only an outside SIGTERM ended the gateway. In
# hal_watchdog a console line inside the receive path lands in the except
# that forces the pins LOW. A console line is for a human; the trace is the
# record. So:
#   - `console(text)` writes ONE line best-effort — the form a safety chain
#     uses, whatever sys.stdout is at that moment;
#   - `install_crash_hooks` wraps each process's stdout and stderr once in a
#     ConsoleGuard, so every other print (and a library's) is held to the
#     same rule.
# A failure is traced as `console.lost` (once per failure kind and stream),
# `console.recovered` when a later flush gets through — never swallowed.
# ──────────────────────────────────────────────────────────────────


def _console_failure(stream: str, op: str, exc: BaseException) -> tuple[str, Optional[int]]:
    kind = (type(exc).__name__, getattr(exc, "errno", None))
    emit("console.lost", level="warn", stream=stream, op=op,
         exc_type=kind[0], errno=kind[1], exc_msg=str(exc)[:200])
    return kind


def console(text: str) -> None:
    """Print one line to sys.stdout and flush it; a failed write is traced
    (`console.lost`), never raised. emit() never raises either, so a chain
    built from emit + console runs to its end."""
    try:
        print(text, flush=True)
    except (OSError, ValueError) as e:
        _console_failure("stdout", "console", e)


class ConsoleGuard:
    """A console stream whose write and flush never raise (see above)."""

    def __init__(self, stream: TextIO, name: str) -> None:
        self._stream = stream
        self._name = name
        self._failing: Optional[tuple[str, Optional[int]]] = None
        self._dropped = 0
        self._wrote = False     # a write got through since the last failure
        self._tracing = False

    @property
    def wrapped(self) -> TextIO:
        return self._stream

    def _failed(self, op: str, exc: BaseException) -> None:
        self._dropped += 1
        self._wrote = False
        kind = (type(exc).__name__, getattr(exc, "errno", None))
        if kind == self._failing or self._tracing:
            return
        self._tracing = True   # emit's own stderr report must not recurse here
        try:
            self._failing = _console_failure(self._name, op, exc)
        finally:
            self._tracing = False

    def write(self, s: str) -> int:
        try:
            n = self._stream.write(s)
        except (OSError, ValueError) as e:
            self._failed("write", e)
            return len(s)
        self._wrote = True
        return n

    def flush(self) -> None:
        try:
            self._stream.flush()
        except (OSError, ValueError) as e:
            self._failed("flush", e)
            return
        # Recovered only when a write got through AND a flush carried it out:
        # a write may only have buffered its line, and a flush of an empty
        # buffer proves nothing (unbuffered, the write itself raised).
        if self._failing is not None and self._wrote and not self._tracing:
            self._tracing = True
            try:
                emit("console.recovered", stream=self._name, dropped=self._dropped)
            finally:
                self._tracing = False
            self._failing = None
            self._dropped = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)


def guard_console() -> None:
    """Wrap sys.stdout and sys.stderr in a ConsoleGuard (once each)."""
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name)
        if stream is not None and not isinstance(stream, ConsoleGuard):
            setattr(sys, name, ConsoleGuard(stream, name))


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

    Also guards the console (guard_console): from here on no print in the
    process raises into its caller.

    Safe to call multiple times — only the first call wires the hooks."""
    global _crash_hooks_installed
    if _crash_hooks_installed:
        return
    _crash_hooks_installed = True
    guard_console()

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
