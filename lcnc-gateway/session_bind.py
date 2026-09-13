"""Session binding — a gateway serves exactly ONE LinuxCNC instance, and the
HAL helper processes admit only a gateway bound to the CURRENT instance.

Why (2026-09-13 incident): a desktop logout killed the launcher without its
EXIT trap, leaving the previous session's ``setsid``'d gateway alive. When
LinuxCNC was started again, that orphan reconnected to the NEW session's
hal_reader, kept feeding the HAL watchdog heartbeat, and served the
reconnecting browser from cache with a dead LinuxCNC behind it — a stale
gateway attached to a fresh safety chain. Nothing on the receiving side
could tell it apart from the legitimate gateway.

Three layers, each independently testable:

1. **Identity.** A LinuxCNC instance is ``(linuxcncsvr pid, kernel start
   ticks)`` — pid reuse cannot forge it, and a zombie is NOT an instance.
   Both sides compute it the same way from ``/proc`` (no pgrep subprocess):
   the helpers at HAL load (cache-once, :class:`InstanceResolver`), the
   gateway when it first connects NML (:func:`instance_for_pid`).
2. **Admission (receiver-side).** The first line a gateway sends on either
   Unix socket must be a hello carrying its bound instance and its own pid.
   The helper verifies the pid against the kernel's ``SO_PEERCRED`` (fail
   closed when absent), the instance against its own, and refuses to
   *replace* a connected gateway (:func:`evaluate_admission`, pure;
   :class:`AdmissionGate` for the select-loop plumbing). Rejected clients
   get a one-line reason and are closed without disturbing the admitted
   client's pins. An old-code gateway (no hello) is cut off on its first
   message. Admission costs at most two helper ticks of reconnect latency
   (accept tick + hello tick — ≤200 ms on the 100 ms watchdog loop, inside
   the 500 ms trip budget).
3. **Bind-once (gateway-side).** :func:`bind_to_launcher` arms
   ``PR_SET_PDEATHSIG`` when the launcher started us, so the gateway dies
   with its launcher however the launcher died (the case bash cannot trap);
   gateway.py never re-binds — when the bound instance ends, it exits.

Stdlib only; ``emit`` is injected so this module stays unit-testable
without the trace bus.
"""
from __future__ import annotations

import ctypes
import json
import os
import signal
import socket
import struct
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

PROTO = 1
# A pending client must present its hello within this window.
HELLO_TIMEOUT_SEC = 2.0
# Bound on simultaneous not-yet-admitted sockets (DoS hygiene, not a limit
# any sane deployment reaches). Helpers listen(MAX_PENDING + 1).
MAX_PENDING = 4
# Rejection logging: first occurrence per (reason, peer pid) immediately, then
# one summary line per interval carrying the count — an old-code orphan
# reconnects ~30×/s and must not flood the shared trace bus.
REJECT_LOG_INTERVAL_SEC = 5.0
_PR_SET_PDEATHSIG = 1
_ZOMBIE_STATES = (b"Z", b"X")

Instance = Tuple[int, int]  # (pid, start_ticks)


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------

def proc_stat_fields(pid: int, proc_root: str = "/proc") -> Optional[Tuple[bytes, int]]:
    """``(state, start_ticks)`` from ``/proc/<pid>/stat``, or None if the
    process does not exist / cannot be read. ``comm`` may contain spaces or
    parens, so the fields are split after the LAST ')'."""
    try:
        with open(f"{proc_root}/{pid}/stat", "rb") as f:
            data = f.read()
    except OSError:
        return None
    rpar = data.rfind(b")")
    if rpar < 0:
        return None
    fields = data[rpar + 2:].split()
    # fields[0] is field 3 (state) → field N sits at index N-3; starttime = 22.
    try:
        return fields[0], int(fields[19])
    except (IndexError, ValueError):
        return None


def proc_start_ticks(pid: int, proc_root: str = "/proc") -> Optional[int]:
    """Kernel start time (clock ticks since boot) of ``pid``, or None."""
    st = proc_stat_fields(pid, proc_root)
    return None if st is None else st[1]


def proc_comm(pid: int, proc_root: str = "/proc") -> Optional[str]:
    try:
        with open(f"{proc_root}/{pid}/comm", "r") as f:
            return f.read().strip()
    except OSError:
        return None


def find_pids_by_comm(name: str, proc_root: str = "/proc") -> List[int]:
    """All pids whose ``comm`` equals ``name`` (exact match, like ``pgrep -x``)."""
    out: List[int] = []
    try:
        entries = os.listdir(proc_root)
    except OSError:
        return out
    for entry in entries:
        if not entry.isdigit():
            continue
        if proc_comm(int(entry), proc_root) == name:
            out.append(int(entry))
    return out


def instance_for_pid(pid: Optional[int], proc_root: str = "/proc") -> Optional[Instance]:
    """Identity of the LinuxCNC instance owned by ``pid``, or None when the
    process cannot be identified (gone, zombie, or /proc unreadable). A
    zombie linuxcncsvr owns no NML and is not an instance — reporting it as
    one would keep a gateway bound to a dead session until the linuxcnc
    script reaps it. Never a guess."""
    if pid is None:
        return None
    st = proc_stat_fields(pid, proc_root)
    if st is None or st[0] in _ZOMBIE_STATES:
        return None
    return (int(pid), st[1])


def discover_instance(proc_root: str = "/proc",
                      comm: str = "linuxcncsvr") -> Tuple[Optional[Instance], List[Instance]]:
    """Find the CURRENT LinuxCNC instance: the newest-started live
    ``linuxcncsvr``.

    Returns ``(newest, all_found)`` so callers can act when more than one is
    alive (a lingering previous session — LinuxCNC's own lock normally
    prevents it, but "Cleanup other" races exist)."""
    found = []
    for pid in find_pids_by_comm(comm, proc_root):
        inst = instance_for_pid(pid, proc_root)
        if inst is not None:
            found.append(inst)
    found.sort(key=lambda i: (i[1], i[0]))
    return (found[-1] if found else None), found


class InstanceResolver:
    """Cache-once identity of the LinuxCNC instance a helper serves.

    Discovery is lazy (linuxcncsvr may not be up on the helper's first tick)
    but happens ONCE: a helper that outlived its session must never adopt
    the next one — that is the bug class being fixed. After binding,
    :meth:`ended` reports whether the cached instance has died, so admission
    can answer ``instance_ended`` instead of mis-labelling a fresh gateway
    as stale.
    """

    def __init__(self, role: str, *, log: Callable[[str], None] = lambda s: print(s, flush=True),
                 emit: Optional[Callable[..., None]] = None,
                 proc_root: str = "/proc", comm: str = "linuxcncsvr") -> None:
        self._role = role
        self._label = role.upper()
        self._log = log
        self._emit = emit
        self._proc_root = proc_root
        self._comm = comm
        self._cached: Optional[Instance] = None
        self._multi_reported: Optional[Tuple[Instance, ...]] = None

    def current(self) -> Optional[Instance]:
        if self._cached is not None:
            return self._cached
        inst, found = discover_instance(self._proc_root, self._comm)
        if len(found) > 1:
            key = tuple(found)
            if key != self._multi_reported:
                self._multi_reported = key
                self._log(f"[{self._label}] {len(found)} live {self._comm} processes "
                          f"{[i[0] for i in found]} — binding to the newest pid={inst[0]}")
                if self._emit is not None:
                    self._emit(f"{self._role}.multiple_instances", level="error",
                               pids=[i[0] for i in found], chosen=inst[0])
        if inst is None:
            return None
        self._cached = inst
        self._log(f"[{self._label}] session bound to {self._comm} pid={inst[0]} start={inst[1]}")
        if self._emit is not None:
            self._emit(f"{self._role}.instance_bound", instance_pid=inst[0], instance_start=inst[1])
        return inst

    def ended(self) -> bool:
        if self._cached is None:
            return False
        return instance_for_pid(self._cached[0], self._proc_root) != self._cached


# ---------------------------------------------------------------------------
# Hello protocol + admission (pure)
# ---------------------------------------------------------------------------

def make_hello(instance: Optional[Instance], gateway_pid: Optional[int] = None) -> dict:
    """The first line a gateway sends on each helper socket."""
    return {
        "type": "hello",
        "proto": PROTO,
        "gateway_pid": int(gateway_pid if gateway_pid is not None else os.getpid()),
        "instance": None if instance is None else {"pid": instance[0], "start": instance[1]},
    }


def parse_hello_instance(hello: dict) -> Optional[Instance]:
    """Instance named by a hello, None when unbound. Raises ValueError on a
    malformed instance block."""
    inst = hello.get("instance")
    if inst is None:
        return None
    if not isinstance(inst, dict):
        raise ValueError("instance must be an object")
    pid, start = inst["pid"], inst["start"]
    if isinstance(pid, bool) or isinstance(start, bool):
        raise ValueError("instance fields must be integers")
    return (int(pid), int(start))


def evaluate_admission(hello: Optional[dict], peer_pid: Optional[int], peer_uid: Optional[int],
                       my_uid: Optional[int], expected: Optional[Instance],
                       existing_healthy: bool, expected_ended: bool = False) -> Tuple[bool, str]:
    """Decide whether a connecting client may become THE gateway.

    Returns ``(admit, reason)``; ``reason`` is ``"ok"`` on admission, else one
    of: no_hello, proto_unsupported, no_peercred, uid_mismatch, bad_hello,
    pid_mismatch, unbound_gateway, no_current_instance, instance_ended,
    stale_instance, duplicate_gateway. Order matters: identity problems are
    reported before policy ones, so a stale orphan is named as stale even
    when a live gateway is attached. ``peer_*`` come from the kernel
    (``SO_PEERCRED``); absent credentials fail closed — this is the safety
    supervisor's front door.
    """
    if not isinstance(hello, dict) or hello.get("type") != "hello":
        return False, "no_hello"
    if hello.get("proto") != PROTO:
        return False, "proto_unsupported"
    if peer_pid is None or peer_uid is None:
        return False, "no_peercred"
    if my_uid is not None and peer_uid != my_uid:
        return False, "uid_mismatch"
    gp = hello.get("gateway_pid")
    if not isinstance(gp, int) or isinstance(gp, bool):
        return False, "bad_hello"
    if gp != peer_pid:
        return False, "pid_mismatch"
    try:
        theirs = parse_hello_instance(hello)
    except (ValueError, KeyError, TypeError):
        return False, "bad_hello"
    if theirs is None:
        return False, "unbound_gateway"
    if expected is None:
        return False, "no_current_instance"
    if expected_ended:
        return False, "instance_ended"
    if theirs != expected:
        return False, "stale_instance"
    if existing_healthy:
        return False, "duplicate_gateway"
    return True, "ok"


def peer_credentials(sock: socket.socket) -> Optional[Tuple[int, int, int]]:
    """Kernel-asserted ``(pid, uid, gid)`` of the peer on an AF_UNIX socket."""
    try:
        raw = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        pid, uid, gid = struct.unpack("3i", raw)
        return pid, uid, gid
    except (OSError, struct.error, AttributeError):
        return None


# ---------------------------------------------------------------------------
# Select-loop plumbing for the helpers
# ---------------------------------------------------------------------------

@dataclass
class Admitted:
    sock: socket.socket
    leftover: str          # bytes that followed the hello line (pipelined msgs)
    hello: dict
    peer_pid: Optional[int]


@dataclass
class _Pending:
    since: float
    buf: bytes = field(default=b"")


class AdmissionGate:
    """Holds not-yet-admitted sockets for a helper's select loop.

    Usage in the loop: ``select`` over ``[server] + gate.socks() + [client]``;
    ``gate.add(conn)`` right after ``accept`` (the gate makes it
    non-blocking); ``gate.handle_readable(sock)`` for a readable pending
    socket — returns :class:`Admitted` exactly once when the hello passes,
    else None (still pending, or rejected + closed); ``gate.expire()`` AFTER
    the readable loop, once per tick. On admission the caller must parse
    ``Admitted.leftover`` immediately (a gateway pipelines its first
    heartbeat right behind the hello). The gate never touches the admitted
    client: replacing it is the caller's decision, taken only on admission.
    """

    def __init__(self, role: str, expected_instance: Callable[[], Optional[Instance]],
                 existing_healthy: Callable[[], bool], *,
                 expected_ended: Callable[[], bool] = lambda: False,
                 emit: Optional[Callable[..., None]] = None,
                 log: Callable[[str], None] = lambda s: print(s, flush=True),
                 hello_timeout: float = HELLO_TIMEOUT_SEC,
                 max_pending: int = MAX_PENDING,
                 reject_log_interval: float = REJECT_LOG_INTERVAL_SEC) -> None:
        self._role = role
        self._label = role.upper()
        self._expected_instance = expected_instance
        self._expected_ended = expected_ended
        self._existing_healthy = existing_healthy
        self._emit = emit
        self._log = log
        self._timeout = hello_timeout
        self._max_pending = max_pending
        self._reject_interval = reject_log_interval
        self._pending: Dict[socket.socket, _Pending] = {}
        # (reason, peer_pid) -> [last_logged_monotonic, occurrences since then]
        self._reject_log: Dict[Tuple[str, Optional[int]], List[float]] = {}

    # -- registry --

    def add(self, sock: socket.socket, now: Optional[float] = None) -> None:
        try:
            sock.setblocking(False)  # CPython accept() returns a BLOCKING socket
        except OSError:
            pass  # safe-silent: a socket that fails setblocking is about to fail recv too
        if len(self._pending) >= self._max_pending:
            self._reject(sock, "too_many_pending", None, None)
            return
        self._pending[sock] = _Pending(since=now if now is not None else time.monotonic())

    def socks(self) -> List[socket.socket]:
        return list(self._pending)

    def __contains__(self, sock: object) -> bool:
        return sock in self._pending

    def __len__(self) -> int:
        return len(self._pending)

    # -- events --

    def handle_readable(self, sock: socket.socket) -> Optional[Admitted]:
        p = self._pending.get(sock)
        if p is None:
            return None
        try:
            data = sock.recv(4096)
        except BlockingIOError:
            return None
        except OSError as e:
            self._drop(sock, "recv_error", str(e))
            return None
        if not data:
            self._drop(sock, "closed_before_hello", None)
            return None
        p.buf += data
        if b"\n" not in p.buf:
            if len(p.buf) > 4096:
                self._reject(sock, "hello_too_long", None, None)
            return None
        line, rest = p.buf.split(b"\n", 1)
        hello: Optional[dict]
        try:
            parsed = json.loads(line.decode("utf-8", errors="replace"))
            hello = parsed if isinstance(parsed, dict) else None
        except ValueError:
            hello = None
        creds = peer_credentials(sock)
        peer_pid = creds[0] if creds else None
        peer_uid = creds[1] if creds else None
        expected = self._expected_instance()
        ok, reason = evaluate_admission(
            hello, peer_pid, peer_uid, os.getuid(), expected,
            self._existing_healthy(), self._expected_ended())
        theirs = None
        if isinstance(hello, dict):
            try:
                theirs = parse_hello_instance(hello)
            except (ValueError, KeyError, TypeError):
                theirs = None
        if not ok:
            self._reject(sock, reason, peer_pid, theirs, expected)
            return None
        del self._pending[sock]
        self._say(sock, {"type": "welcome"})
        self._log(f"[{self._label}] gateway pid={peer_pid} admitted "
                  f"(instance pid={expected[0]} start={expected[1]})")
        if self._emit is not None:
            self._emit(f"{self._role}.client_admitted", peer_pid=peer_pid,
                       instance_pid=expected[0], instance_start=expected[1])
        return Admitted(sock=sock, leftover=rest.decode("utf-8", errors="replace"),
                        hello=hello, peer_pid=peer_pid)

    def expire(self, now: Optional[float] = None) -> None:
        now = now if now is not None else time.monotonic()
        for sock, p in list(self._pending.items()):
            if now - p.since > self._timeout:
                creds = peer_credentials(sock)
                self._reject(sock, "hello_timeout", creds[0] if creds else None, None)

    def close_all(self) -> None:
        for sock in list(self._pending):
            self._drop(sock, "shutdown", None, quiet=True)

    # -- internals --

    def _say(self, sock: socket.socket, obj: dict) -> None:
        try:
            sock.send((json.dumps(obj) + "\n").encode())
        except OSError:
            pass  # safe-silent: courtesy reply to a peer that may already be gone

    def _reject(self, sock: socket.socket, reason: str, peer_pid: Optional[int],
                theirs: Optional[Instance], expected: Optional[Instance] = None) -> None:
        self._say(sock, {"type": "rejected", "reason": reason})
        self._drop(sock, reason, None, quiet=True)
        # Throttle: first per (reason, pid) immediately, then a summary with the
        # count once per interval. Every occurrence is counted — nothing is
        # silently dropped, the bus just isn't flooded by a 30 Hz orphan.
        now = time.monotonic()
        entry = self._reject_log.get((reason, peer_pid))
        if entry is None:
            entry = [now, 0]
            self._reject_log[(reason, peer_pid)] = entry
            count = 1
            due = True
        else:
            entry[1] += 1
            due = (now - entry[0]) >= self._reject_interval
            count = entry[1]
            if due:
                entry[0] = now
                entry[1] = 0
        if not due:
            return
        self._log(f"[{self._label}] REJECTED gateway pid={peer_pid}: {reason} "
                  f"(theirs={theirs}, ours={expected}, count={count})")
        if self._emit is not None:
            self._emit(f"{self._role}.client_rejected", level="error", reason=reason,
                       peer_pid=peer_pid, count=count,
                       theirs=list(theirs) if theirs else None,
                       ours=list(expected) if expected else None)

    def _drop(self, sock: socket.socket, reason: str, detail: Optional[str],
              quiet: bool = False) -> None:
        self._pending.pop(sock, None)
        try:
            sock.close()
        except OSError:
            pass  # safe-silent: cleanup of a socket that may already be closed
        if not quiet:
            self._log(f"[{self._label}] pending client dropped: {reason}"
                      + (f" ({detail})" if detail else ""))
            if self._emit is not None:
                self._emit(f"{self._role}.client_dropped", level="warn",
                           reason=reason, detail=detail)


# ---------------------------------------------------------------------------
# Gateway ↔ launcher binding
# ---------------------------------------------------------------------------

def pid_alive(pid: int) -> bool:
    """Liveness by signal 0 — EPERM still means alive."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def bind_to_launcher(env: Optional[dict] = None, *, signum: int = signal.SIGTERM) -> dict:
    """Arm ``PR_SET_PDEATHSIG`` when a launcher started us (``LCNC_LAUNCHER_PID``).

    The launcher's EXIT trap SIGTERMs the gateway on every path bash can
    trap; this is the layer for the paths it cannot (SIGKILL, session
    teardown). Returns a dict for the boot trace: ``mode`` is ``standalone``
    (no launcher) or ``launcher``. In launcher mode ``ok`` is False with
    ``reason == "launcher_gone"`` when the launcher is already dead (decided
    by liveness, not ppid — under a subreaper ppid never reads 1): the
    caller must exit, no signal will ever come. ``needs_poll`` is True when
    the launcher is alive but not our direct parent (an intermediate
    process, so PDEATHSIG cannot fire for it) — the caller should run
    :func:`start_launcher_poll`.
    """
    env = os.environ if env is None else env
    raw = str(env.get("LCNC_LAUNCHER_PID", "")).strip()
    if not raw:
        return {"mode": "standalone"}
    try:
        launcher_pid = int(raw)
    except ValueError:
        return {"mode": "launcher", "ok": False, "reason": "bad_launcher_pid", "raw": raw}
    res: dict = {"mode": "launcher", "launcher_pid": launcher_pid, "needs_poll": False}
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        rc = libc.prctl(_PR_SET_PDEATHSIG, int(signum), 0, 0, 0)
        res["pdeathsig"] = (rc == 0)
        if rc != 0:
            res["errno"] = ctypes.get_errno()
    except Exception as e:  # pragma: no cover - non-Linux libc
        res["pdeathsig"] = False
        res["error"] = f"{type(e).__name__}: {e}"
    # Classify AFTER arming: if the launcher died in between, no signal will
    # ever come and we are already an orphan.
    ppid_now = os.getppid()
    res["ppid"] = ppid_now
    if not pid_alive(launcher_pid):
        res["ok"] = False
        res["reason"] = "launcher_gone"
    elif ppid_now == launcher_pid:
        res["ok"] = True
    else:
        res["ok"] = True
        res["reason"] = "ppid_mismatch"
        res["needs_poll"] = True
    return res


def start_launcher_poll(launcher_pid: int, *, signum: int = signal.SIGTERM,
                        interval: float = 1.0,
                        on_dead: Optional[Callable[[], None]] = None) -> threading.Thread:
    """Fallback for :func:`bind_to_launcher` ``needs_poll``: a daemon thread
    that signals this process (or calls ``on_dead``) once the launcher pid is
    gone. Returns the started thread."""
    def _run() -> None:
        while True:
            time.sleep(interval)
            if not pid_alive(launcher_pid):
                if on_dead is not None:
                    on_dead()
                else:
                    os.kill(os.getpid(), signum)
                return
    t = threading.Thread(target=_run, name="launcher-poll", daemon=True)
    t.start()
    return t
