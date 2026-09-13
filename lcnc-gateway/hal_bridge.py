"""HAL IPC bridge (M6).

Owns the two Unix-socket clients connecting the gateway to its HAL sibling
processes (the gateway never imports `hal` — see GitHub issue #9):

- **watchdog socket** (`hal_watchdog.py`, default ``/tmp/webui-safety.sock``):
  bounded sends of pin-update messages (heartbeat / connected / trip_reset /
  tool_changed). The socket carries a tight 50 ms sendall timeout so a
  scheduling-delayed watchdog can never stall the event loop — a timed-out
  send is a *dropped* message, and the HAL oneshot trips correctly on its own
  if heartbeats truly stop arriving.
- **reader socket** (`hal_reader.py`, default ``/tmp/webui-reader.sock``):
  30 Hz pin-snapshot push plus request/reply RPC (set_p, halshow_dump,
  set_extra_pins), and snapshot freshness (`reader_is_stale`).

**Session binding (2026-09-13).** The first line on either socket is the
hello produced by the injected ``hello`` callable (``session_bind.make_hello``
— names the LinuxCNC instance this gateway is bound to). The helper answers
``welcome`` or ``rejected`` + close. The bridge never dials while the
gateway is unbound (hello instance ``None``), backs off
``REJECT_BACKOFF_SEC`` after a rejection and reports it through
``on_rejected(role, reason)`` + ``helper_status_reason()`` (operator
banner), and classifies a helper that never answers within
``HELPER_REPLY_SEC`` as *legacy* (pre-binding hal_watchdog/hal_reader —
keeps working, banner asks for a LinuxCNC restart). On the watchdog socket
the verdict is drained without blocking (zero-timeout ``select`` before
each send while awaiting — a plain ``recv`` on the 50 ms-timeout socket
would cost 50 ms per heartbeat).

IMPORTANT BOUNDARY (modularization plan, M6): the gateway heartbeat coroutine
stays in gateway.py. This module *transports* heartbeat values handed to
``watchdog_send`` but must never produce one.

Gateway-side dependencies are injected (``set_phase`` for stall forensics,
``on_reader_connect`` for the extra-pin push policy, ``hello`` /
``on_rejected`` for session binding) so this module has no gateway import
and is unit-testable against real Unix sockets in a tempdir. Snapshot reads
follow the no-silent-fallback rule: an absent snapshot or field returns
``None`` all the way to the frontend, never a synthetic default.
"""
import asyncio
import json
import select
import socket as _socket
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import lcnc_trace as _trace

try:
    import fcntl as _fcntl
    import struct as _struct
    _SIOCOUTQ = 0x5411  # Linux: bytes in send buffer not yet consumed
except Exception:
    _fcntl = None
    _struct = None
    _SIOCOUTQ = 0

WATCHDOG_SOCK_PATH = "/tmp/webui-safety.sock"
READER_SOCK_PATH = "/tmp/webui-reader.sock"
# A snapshot is "stale" if no message has arrived within this window.
# The reader pushes at 30 Hz (~33 ms) so 2 s = ~60 missed ticks.
READER_STALE_SEC = 2.0
# Emit cadence for repeated connect failures while a sibling process is down.
# The watchdog connect is retried per heartbeat send (~30 Hz), the reader
# every 1 s — unthrottled, a watchdog outage wrote ~900 error lines per 30 s
# and churned the 50 MB trace rotation away from the forensics that matter.
WD_CONNECT_FAIL_EMIT_SEC = 5.0
READER_CONNECT_FAIL_EMIT_SEC = 30.0
# Session binding: no redial for this long after a helper rejected us (a
# rejected gateway is stale or a duplicate — hammering the supervisor at
# 30 Hz gains nothing), and a shorter pause after the peer closed on us
# without a verdict.
REJECT_BACKOFF_SEC = 5.0
PEER_CLOSED_BACKOFF_SEC = 1.0
# A helper that has not answered the hello within this window predates
# session binding (it ignores unknown keys and never replies).
HELPER_REPLY_SEC = 2.0
# "Not dialling while unbound" is logged at most this often.
UNBOUND_DEFER_EMIT_SEC = 5.0


class _FailureAggregator:
    """Rate-limit repeated failure emits of one trace tag.

    The FIRST failure of an outage emits immediately (zero detection
    latency), then one line per ``interval_sec`` carrying the cumulative
    ``fails`` count since the last successful connect, and ``success()``
    hands back the total so the recovery emit can report it. The outage
    stays fully auditable (no silent fallback — every attempt is counted,
    none is individually logged) without flooding the trace bus.
    """

    def __init__(self, tag: str, *, interval_sec: float, level: str = "error") -> None:
        self._tag = tag
        self._interval = interval_sec
        self._level = level
        self._fails = 0        # failures since last success
        self._last_emit = 0.0  # monotonic ts of last emitted line (0 = none yet)

    def failure(self, exc: BaseException) -> None:
        self._fails += 1
        now = time.monotonic()
        if self._last_emit == 0.0 or now - self._last_emit >= self._interval:
            _trace.emit(self._tag, level=self._level,
                        exc=type(exc).__name__, msg=str(exc), fails=self._fails)
            self._last_emit = now

    def success(self) -> int:
        """Reset for the next outage; returns the failure count it accumulated."""
        n = self._fails
        self._fails = 0
        self._last_emit = 0.0
        return n


class HalBridge:
    def __init__(
        self,
        *,
        set_phase: Callable[[str], None],
        on_reader_connect: Callable[[], None],
        hello: Callable[[], dict],
        on_rejected: Callable[[str, str], None] = lambda role, reason: None,
        watchdog_path: str = WATCHDOG_SOCK_PATH,
        reader_path: str = READER_SOCK_PATH,
        reader_stale_sec: float = READER_STALE_SEC,
        reject_backoff_sec: float = REJECT_BACKOFF_SEC,
        helper_reply_sec: float = HELPER_REPLY_SEC,
    ) -> None:
        self._set_phase = set_phase
        self._on_reader_connect = on_reader_connect
        self._hello = hello
        self._on_rejected = on_rejected
        self._watchdog_path = watchdog_path
        self._reader_path = reader_path
        self._stale_sec = reader_stale_sec
        self._reject_backoff = reject_backoff_sec
        self._helper_reply_sec = helper_reply_sec
        # -- watchdog socket --
        self._wd_sock: Optional[_socket.socket] = None
        self._wd_connect_fails = _FailureAggregator(
            "hal.socket_connect_failed", interval_sec=WD_CONNECT_FAIL_EMIT_SEC)
        self._reader_connect_fails = _FailureAggregator(
            "reader.connect_failed", interval_sec=READER_CONNECT_FAIL_EMIT_SEC,
            level="warn")
        # hal.send_summary fires once per N sends (N=30 ≈ 1 s at heartbeat
        # cadence). `slow_count` is tallied locally (not an avg/max metric)
        # and reset by the extra-fields callable at emit time; `outq` is read
        # fresh per emit so kernel buffer state is captured at publication.
        self._wd_slow_count = 0
        self._wd_send_agg = _trace.Aggregator(
            "hal.send_summary", every=30, extra_fields=self._wd_send_extras
        )
        # Session-binding state (watchdog): idle | awaiting | admitted | legacy
        self._wd_state = "idle"
        self._wd_rx = b""
        self._wd_await_since = 0.0
        self._wd_backoff_until = 0.0
        self._wd_reject_reason: Optional[str] = None
        self._wd_legacy = False
        self._wd_unbound_emit_at = 0.0
        # -- reader socket --
        # Single-rebind state: (snapshot, monotonic_ts). Both halves always
        # come from the same tick — no torn reads even if a caller reads both
        # values across an `await`.
        self._reader_state: Optional[Tuple[dict, float]] = None
        self._reader_writer: Optional[asyncio.StreamWriter] = None
        self._reader_lock = asyncio.Lock()
        self._reader_pending: Dict[int, asyncio.Future] = {}
        self._reader_next_id = 0
        self._reader_backoff_until = 0.0
        self._reader_reject_reason: Optional[str] = None
        self._reader_legacy = False
        self._reader_unbound_emit_at = 0.0

    # ---- session-binding status (operator banner) ----

    @property
    def watchdog_admitted(self) -> bool:
        return self._wd_state == "admitted"

    @property
    def watchdog_reject_reason(self) -> Optional[str]:
        return self._wd_reject_reason

    @property
    def reader_reject_reason(self) -> Optional[str]:
        return self._reader_reject_reason

    def helper_status_reason(self) -> Optional[str]:
        """Banner text for a helper that refused us or predates binding, or
        None when both helpers admitted us (or are simply not connected —
        that is the existing watchdog/reader-down banner's job)."""
        parts: List[str] = []
        if self._wd_reject_reason:
            parts.append(f"HAL watchdog rejected this gateway: {self._wd_reject_reason}")
        if self._reader_reject_reason:
            parts.append(f"HAL reader rejected this gateway: {self._reader_reject_reason}")
        if self._wd_legacy:
            parts.append("hal_watchdog predates session binding (no admission reply) — "
                         "restart LinuxCNC to load the current helpers")
        if self._reader_legacy:
            parts.append("hal_reader predates session binding (no admission reply) — "
                         "restart LinuxCNC to load the current helpers")
        return "; ".join(parts) if parts else None

    # ---- watchdog socket (hal_watchdog.py) ----

    @property
    def watchdog_connected(self) -> bool:
        return self._wd_sock is not None

    def watchdog_connect(self) -> None:
        """Connect to the HAL watchdog Unix socket and send the hello.
        Non-fatal if unavailable; never dials while the gateway is unbound
        (the helper would only answer ``unbound_gateway``) or inside a
        post-rejection backoff.

        Socket is set to a tight (50 ms) sendall timeout so that, if the
        kernel Unix-socket send buffer fills (e.g. watchdog process
        scheduling-delayed during a cold-start handshake storm), the
        heartbeat task does NOT block the asyncio loop waiting for buffer
        space. A timed-out sendall raises socket.timeout, treated as a
        dropped heartbeat — the watchdog correctly trips if heartbeats stop
        reaching it. 50 ms is generous against the 33 ms heartbeat cadence
        and tiny against the 500 ms HAL trip threshold; we lose at most one
        heartbeat to detect backpressure.
        """
        if self._wd_sock is not None:
            return  # already connected
        now = time.monotonic()
        if now < self._wd_backoff_until:
            return
        hello = self._hello()
        if hello.get("instance") is None:
            if now - self._wd_unbound_emit_at >= UNBOUND_DEFER_EMIT_SEC:
                self._wd_unbound_emit_at = now
                _trace.emit("hal.connect_deferred_unbound", level="warn")
            return
        sock = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
        try:
            sock.connect(self._watchdog_path)
            sock.settimeout(0.05)
            sock.sendall((json.dumps(hello) + "\n").encode())
            self._wd_sock = sock
            self._wd_state = "awaiting"
            self._wd_rx = b""
            self._wd_await_since = now
            _prior_fails = self._wd_connect_fails.success()
            if _prior_fails:
                _trace.emit("hal.socket_connected", after_fails=_prior_fails)
            else:
                _trace.emit("hal.socket_connected")
        except Exception as e:
            sock.close()  # don't leave the fd to refcounting
            self._wd_connect_fails.failure(e)
            self._wd_sock = None

    def watchdog_disconnect(self) -> None:
        """Disconnect from the HAL watchdog socket."""
        if self._wd_sock is not None:
            try:
                self._wd_sock.close()
            except Exception:
                pass  # safe-silent: socket cleanup, already-closed is fine
            self._wd_sock = None
        self._wd_state = "idle"
        self._wd_rx = b""

    def _wd_peer_closed(self, detail: str) -> None:
        _trace.emit("hal.peer_closed", level="warn", detail=detail)
        self.watchdog_disconnect()
        self._wd_backoff_until = time.monotonic() + PEER_CLOSED_BACKOFF_SEC

    def _wd_handle_reply_line(self, line: bytes) -> bool:
        """Apply one verdict line. Returns True when the socket was torn down."""
        try:
            msg = json.loads(line.decode("utf-8", errors="replace"))
        except ValueError:
            _trace.emit("hal.bad_reply", level="warn", raw=line[:120].decode("utf-8", "replace"))
            return False
        mtype = msg.get("type") if isinstance(msg, dict) else None
        if mtype == "welcome":
            self._wd_state = "admitted"
            self._wd_reject_reason = None
            self._wd_legacy = False
            _trace.emit("hal.admitted")
            return False
        if mtype == "rejected":
            reason = str(msg.get("reason", "unknown"))
            self._wd_reject_reason = reason
            _trace.emit("hal.rejected", level="error", reason=reason)
            self.watchdog_disconnect()
            self._wd_backoff_until = time.monotonic() + self._reject_backoff
            try:
                self._on_rejected("watchdog", reason)
            except Exception as e:
                _trace.emit("hal.on_rejected_hook_failed", level="error",
                            exc=type(e).__name__, msg=str(e))
            return True
        return False

    def _wd_poll_reply(self) -> None:
        """While awaiting the helper's verdict, drain any reply WITHOUT
        blocking: zero-timeout select, then recv (the socket is in 50 ms
        timeout mode, so a bare recv would wait 50 ms per heartbeat)."""
        sock = self._wd_sock
        if sock is None or self._wd_state != "awaiting":
            return
        try:
            readable, _, _ = select.select([sock], [], [], 0)
        except (OSError, ValueError):
            readable = []
        if readable:
            try:
                data = sock.recv(4096)
            except (BlockingIOError, _socket.timeout):
                data = None
            except OSError as e:
                self._wd_peer_closed(f"recv failed: {e}")
                return
            if data == b"":
                self._wd_peer_closed("closed before verdict")
                return
            if data:
                self._wd_rx += data
                while b"\n" in self._wd_rx:
                    line, self._wd_rx = self._wd_rx.split(b"\n", 1)
                    if self._wd_handle_reply_line(line):
                        return
        if self._wd_state == "awaiting" and \
                time.monotonic() - self._wd_await_since > self._helper_reply_sec:
            self._wd_state = "legacy"
            self._wd_legacy = True
            _trace.emit("hal.helper_legacy", level="warn", role="watchdog",
                        waited_sec=self._helper_reply_sec)

    def _wd_send_extras(self) -> dict:
        out = {"slow_count": self._wd_slow_count, "tcp_outq": self.watchdog_outq(),
               "state": self._wd_state}
        self._wd_slow_count = 0
        return out

    def watchdog_send(self, msg: dict) -> None:
        """Send a pin-update message to the HAL watchdog via socket."""
        if self._wd_sock is None:
            self.watchdog_connect()
        if self._wd_sock is None:
            return
        self._wd_poll_reply()
        if self._wd_sock is None:
            return  # rejected / closed while draining the verdict
        _send_t0 = time.monotonic()
        try:
            self._wd_sock.sendall((json.dumps(msg) + "\n").encode())
        except _socket.timeout:
            # Kernel send buffer full — watchdog process is scheduling-
            # delayed (or hung). Drop this message and DON'T block the loop
            # waiting for buffer space. The heartbeat task continues firing;
            # if the watchdog truly isn't reading, the trip fires correctly
            # via oneshot.0.out going FALSE on its own. This converts a
            # multi-second loop stall into a logged drop of one heartbeat.
            _send_dt_to = (time.monotonic() - _send_t0) * 1000
            _trace.emit("hal.send_timeout", level="warn",
                        send_ms=round(_send_dt_to, 1),
                        msg_keys=list(msg.keys()))
            return
        except (OSError, BrokenPipeError):
            # A helper that rejected us writes the verdict and closes at once;
            # a send racing that close hits EPIPE with the verdict still
            # unread in our buffer. Drain it FIRST so the rejection (reason +
            # backoff) is not discarded with the socket — otherwise we would
            # redial at heartbeat cadence and the operator never sees why.
            if self._wd_state == "awaiting":
                self._wd_poll_reply()
            if self._wd_sock is not None:
                self.watchdog_disconnect()  # close the broken fd; reconnect on next send
                _trace.emit("hal.send_disconnect", level="warn",
                            msg_keys=list(msg.keys()))
            return
        _send_dt = (time.monotonic() - _send_t0) * 1000
        if _send_dt > 30:
            _trace.emit("hal.send_slow", level="warn",
                        send_ms=round(_send_dt, 1),
                        msg_keys=list(msg.keys()))
            self._wd_slow_count += 1
        self._wd_send_agg.record(ms=_send_dt)

    def watchdog_outq(self) -> int:
        """Bytes queued in the kernel send buffer for the watchdog socket.
        Linux only. Returns -1 on any failure. Cheap (one ioctl, ~1 us)."""
        if self._wd_sock is None or _fcntl is None or _struct is None:
            return -1
        try:
            buf = bytearray(4)
            _fcntl.ioctl(self._wd_sock.fileno(), _SIOCOUTQ, buf)
            return _struct.unpack("I", bytes(buf))[0]
        except Exception:
            return -1

    # ---- reader socket (hal_reader.py) ----

    @property
    def reader_connected(self) -> bool:
        return self._reader_writer is not None

    def _reader_dispatch(self, msg: dict) -> None:
        mtype = msg.get("type")
        if mtype == "snapshot":
            self._reader_state = (msg, time.monotonic())
        elif mtype == "reply":
            fut = self._reader_pending.pop(msg.get("id"), None)
            if fut is not None and not fut.done():
                fut.set_result(msg)

    async def _reader_handshake(self, reader: asyncio.StreamReader,
                                writer: asyncio.StreamWriter, hello: dict) -> Tuple[str, List[dict]]:
        """Send the hello and wait for the verdict. Returns
        ``(outcome, early)`` — outcome ``admitted`` / ``legacy`` proceed,
        anything else means the caller must drop the connection (the emit +
        backoff already happened); ``early`` holds snapshots the helper
        pushed before its verdict (legacy readers start pushing at once)."""
        early: List[dict] = []
        writer.write((json.dumps(hello) + "\n").encode())
        await writer.drain()
        deadline = time.monotonic() + self._helper_reply_sec
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                line = await asyncio.wait_for(reader.readline(), timeout=remaining)
            except asyncio.TimeoutError:
                break
            except Exception as e:
                _trace.emit("reader.handshake_error", level="warn",
                            exc=type(e).__name__, msg=str(e))
                self._reader_backoff_until = time.monotonic() + PEER_CLOSED_BACKOFF_SEC
                return "error", early
            if not line:
                _trace.emit("reader.peer_closed", level="warn", detail="closed before verdict")
                self._reader_backoff_until = time.monotonic() + PEER_CLOSED_BACKOFF_SEC
                return "eof", early
            try:
                msg = json.loads(line.decode("utf-8", errors="replace"))
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            mtype = msg.get("type")
            if mtype == "welcome":
                self._reader_reject_reason = None
                self._reader_legacy = False
                _trace.emit("reader.admitted")
                return "admitted", early
            if mtype == "rejected":
                reason = str(msg.get("reason", "unknown"))
                self._reader_reject_reason = reason
                _trace.emit("reader.rejected", level="error", reason=reason)
                self._reader_backoff_until = time.monotonic() + self._reject_backoff
                try:
                    self._on_rejected("reader", reason)
                except Exception as e:
                    _trace.emit("reader.on_rejected_hook_failed", level="error",
                                exc=type(e).__name__, msg=str(e))
                return "rejected", early
            if mtype == "snapshot":
                early.append(msg)
                continue
            if mtype == "reply" and msg.get("id") is None:
                break  # an old reader answered the hello as an unknown RPC
        # No verdict: a helper that predates session binding.
        self._reader_legacy = True
        _trace.emit("reader.helper_legacy", level="warn", role="reader",
                    waited_sec=self._helper_reply_sec)
        return "legacy", early

    async def reader_recv_loop(self) -> None:
        """Connect to hal_reader.py, run the admission handshake, and dispatch
        incoming messages.

        Snapshots update the freshness state. Replies resolve pending futures
        keyed by request id. Reconnects on socket close with a 1 s backoff
        (``REJECT_BACKOFF_SEC`` after a rejection). Never dials while the
        gateway is unbound.
        """
        while True:
            self._set_phase("reader_recv.connecting")
            now = time.monotonic()
            if now < self._reader_backoff_until:
                await asyncio.sleep(min(1.0, self._reader_backoff_until - now))
                continue
            hello = self._hello()
            if hello.get("instance") is None:
                if now - self._reader_unbound_emit_at >= UNBOUND_DEFER_EMIT_SEC:
                    self._reader_unbound_emit_at = now
                    _trace.emit("reader.connect_deferred_unbound", level="warn")
                await asyncio.sleep(1.0)
                continue
            try:
                reader, writer = await asyncio.open_unix_connection(self._reader_path)
            except Exception as e:
                self._reader_connect_fails.failure(e)
                await asyncio.sleep(1.0)
                continue
            self._set_phase("reader_recv.handshake")
            try:
                outcome, early = await self._reader_handshake(reader, writer, hello)
            except Exception as e:
                _trace.emit("reader.handshake_error", level="warn",
                            exc=type(e).__name__, msg=str(e))
                outcome, early = "error", []
                self._reader_backoff_until = time.monotonic() + PEER_CLOSED_BACKOFF_SEC
            if outcome not in ("admitted", "legacy"):
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass  # safe-silent: the helper already closed on us
                continue
            self._reader_writer = writer
            _prior_fails = self._reader_connect_fails.success()
            if _prior_fails:
                _trace.emit("reader.connected", after_fails=_prior_fails, outcome=outcome)
            else:
                _trace.emit("reader.connected", outcome=outcome)
            # Gateway policy hook (e.g. push extra-pin config so the reader
            # includes user-configured pins in snapshots). Fires only once we
            # are admitted, so no RPC can be pipelined ahead of admission.
            # Must not block: this loop dispatches RPC replies, so any
            # awaiting must happen in a task the hook spawns itself. A hook
            # failure is loud but must not kill the recv loop — pin updates
            # outrank the hook.
            try:
                self._on_reader_connect()
            except Exception as e:
                _trace.emit("reader.on_connect_hook_failed", level="error",
                            exc=type(e).__name__, msg=str(e))
            try:
                for msg in early:
                    self._reader_dispatch(msg)
                while True:
                    self._set_phase("reader_recv.readline")
                    line = await reader.readline()
                    if not line:
                        break
                    self._set_phase("reader_recv.process_line")
                    try:
                        msg = json.loads(line.decode())
                    except Exception as e:
                        _trace.emit("reader.bad_json", level="warn",
                                    exc=type(e).__name__, msg=str(e))
                        continue
                    if isinstance(msg, dict):
                        self._reader_dispatch(msg)
            except Exception as e:
                _trace.emit("reader.recv_loop_error", level="warn",
                            exc=type(e).__name__, msg=str(e))
            finally:
                self._set_phase("reader_recv.cleanup")
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass  # safe-silent: async socket cleanup, peer may have vanished
                self._reader_writer = None
                # Fail any pending requests so callers don't hang.
                for fut in self._reader_pending.values():
                    if not fut.done():
                        fut.set_exception(ConnectionError("HAL reader disconnected"))
                self._reader_pending.clear()
            await asyncio.sleep(1.0)

    async def reader_request(self, req: str, timeout: float = 2.0, **kwargs) -> Any:
        """Send a request to hal_reader.py and await the reply.

        Raises ConnectionError if the reader is not connected, TimeoutError
        if the reply doesn't arrive in time, RuntimeError if the reader
        returned ok=False.
        """
        if self._reader_writer is None:
            raise ConnectionError("HAL reader not connected")
        # Lock guards only the ID-increment + future-registration handshake.
        # The actual write+drain happens unlocked: each call writes one
        # complete `{...}\n` framed message in a single StreamWriter.write()
        # (atomic on the buffer), so concurrent senders can't interleave bytes.
        async with self._reader_lock:
            self._reader_next_id += 1
            req_id = self._reader_next_id
            loop = asyncio.get_running_loop()
            fut = loop.create_future()
            self._reader_pending[req_id] = fut
        try:
            self._reader_writer.write(
                (json.dumps({"id": req_id, "req": req, **kwargs}) + "\n").encode())
            await self._reader_writer.drain()
        except Exception:
            self._reader_pending.pop(req_id, None)
            raise
        try:
            reply = await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self._reader_pending.pop(req_id, None)
            raise
        if not reply.get("ok"):
            raise RuntimeError(reply.get("error", "reader request failed"))
        return reply.get("result")

    def reader_get(self, field: str):
        """Return field from latest snapshot, or None if snapshot absent /
        field missing.

        No `default` param by design — every absent value must surface as
        None all the way to the frontend so consumers see "no data" honestly.
        See feedback_no_silent_fallbacks.md.
        """
        state = self._reader_state
        if state is None:
            return None
        return state[0].get(field)

    def reader_is_stale(self) -> bool:
        """True if no snapshot has arrived within the stale window."""
        state = self._reader_state
        if state is None:
            return True
        return (time.monotonic() - state[1]) > self._stale_sec

    async def reader_aclose(self, timeout: float = 0.5) -> None:
        """Close the reader connection (shutdown path). Best-effort, bounded."""
        writer = self._reader_writer
        if writer is None:
            return
        try:
            writer.close()
            await asyncio.wait_for(writer.wait_closed(), timeout=timeout)
        except Exception as e:
            _trace.emit("reader.close_failed", level="warn",
                        exc=type(e).__name__, msg=str(e))
