"""HAL IPC bridge (M6).

Owns the two Unix-socket clients connecting the gateway to its HAL sibling
processes (the gateway never imports `hal` — see GitHub issue #9):

- **watchdog socket** (`hal_watchdog.py`, default ``/tmp/webui-safety.sock``):
    bounded sends of freshness and pin-update messages (heartbeat / connected /
    trip_reset / tool_changed). The watchdog process owns the short-period HAL
    heartbeat generation; gateway heartbeat messages refresh its liveness window.
    The socket carries a tight 50 ms sendall timeout so a
  scheduling-delayed watchdog can never stall the event loop — a timed-out
    send is a *dropped* refresh, and the HAL oneshot trips correctly on its own
    if gateway freshness updates truly stop arriving.
- **reader socket** (`hal_reader.py`, default ``/tmp/webui-reader.sock``):
  30 Hz pin-snapshot push plus request/reply RPC (set_p, halshow_dump,
  set_extra_pins), and snapshot freshness (`reader_is_stale`).

IMPORTANT BOUNDARY (modularization plan, M6): this module transports watchdog
messages handed to ``watchdog_send`` but must never generate HAL heartbeat
edges itself.

Gateway-side dependencies are injected (``set_phase`` for stall forensics,
``on_reader_connect`` for the extra-pin push policy) so this module has no
gateway import and is unit-testable against real Unix sockets in a tempdir.
Snapshot reads follow the no-silent-fallback rule: an absent snapshot or
field returns ``None`` all the way to the frontend, never a synthetic default.
"""
import asyncio
import json
import socket as _socket
import time
from typing import Any, Callable, Dict, Optional, Tuple

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


class HalBridge:
    def __init__(
        self,
        *,
        set_phase: Callable[[str], None],
        on_reader_connect: Callable[[], None],
        watchdog_path: str = WATCHDOG_SOCK_PATH,
        reader_path: str = READER_SOCK_PATH,
        reader_stale_sec: float = READER_STALE_SEC,
    ) -> None:
        self._set_phase = set_phase
        self._on_reader_connect = on_reader_connect
        self._watchdog_path = watchdog_path
        self._reader_path = reader_path
        self._stale_sec = reader_stale_sec
        # -- watchdog socket --
        self._wd_sock: Optional[_socket.socket] = None
        # hal.send_summary fires once per N sends (N=30 ≈ 1 s at heartbeat
        # cadence). `slow_count` is tallied locally (not an avg/max metric)
        # and reset by the extra-fields callable at emit time; `outq` is read
        # fresh per emit so kernel buffer state is captured at publication.
        self._wd_slow_count = 0
        self._wd_send_agg = _trace.Aggregator(
            "hal.send_summary", every=30, extra_fields=self._wd_send_extras
        )
        # -- reader socket --
        # Single-rebind state: (snapshot, monotonic_ts). Both halves always
        # come from the same tick — no torn reads even if a caller reads both
        # values across an `await`.
        self._reader_state: Optional[Tuple[dict, float]] = None
        self._reader_writer: Optional[asyncio.StreamWriter] = None
        self._reader_lock = asyncio.Lock()
        self._reader_pending: Dict[int, asyncio.Future] = {}
        self._reader_next_id = 0

    # ---- watchdog socket (hal_watchdog.py) ----

    @property
    def watchdog_connected(self) -> bool:
        return self._wd_sock is not None

    def watchdog_connect(self) -> None:
        """Connect to the HAL watchdog Unix socket. Non-fatal if unavailable.

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
        sock = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
        try:
            sock.connect(self._watchdog_path)
            sock.settimeout(0.05)
            self._wd_sock = sock
            _trace.emit("hal.socket_connected")
        except Exception as e:
            sock.close()  # don't leave the fd to refcounting
            _trace.emit("hal.socket_connect_failed", level="error",
                        exc=type(e).__name__, msg=str(e))
            self._wd_sock = None

    def watchdog_disconnect(self) -> None:
        """Disconnect from the HAL watchdog socket."""
        if self._wd_sock is not None:
            try:
                self._wd_sock.close()
            except Exception:
                pass  # safe-silent: socket cleanup, already-closed is fine
            self._wd_sock = None

    def _wd_send_extras(self) -> dict:
        out = {"slow_count": self._wd_slow_count, "tcp_outq": self.watchdog_outq()}
        self._wd_slow_count = 0
        return out

    def watchdog_send(self, msg: dict) -> None:
        """Send a pin-update message to the HAL watchdog via socket."""
        if self._wd_sock is None:
            self.watchdog_connect()
        if self._wd_sock is None:
            return
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

    async def reader_recv_loop(self) -> None:
        """Connect to hal_reader.py and dispatch incoming messages.

        Snapshots update the freshness state. Replies resolve pending futures
        keyed by request id. Reconnects on socket close with a 1 s backoff.
        """
        while True:
            self._set_phase("reader_recv.connecting")
            try:
                reader, writer = await asyncio.open_unix_connection(self._reader_path)
            except Exception as e:
                _trace.emit("reader.connect_failed", level="warn",
                            exc=type(e).__name__, msg=str(e))
                await asyncio.sleep(1.0)
                continue
            self._reader_writer = writer
            _trace.emit("reader.connected")
            # Gateway policy hook (e.g. push extra-pin config so the reader
            # includes user-configured pins in snapshots). Must not block:
            # this loop dispatches RPC replies, so any awaiting must happen
            # in a task the hook spawns itself. A hook failure is loud but
            # must not kill the recv loop — pin updates outrank the hook.
            try:
                self._on_reader_connect()
            except Exception as e:
                _trace.emit("reader.on_connect_hook_failed", level="error",
                            exc=type(e).__name__, msg=str(e))
            try:
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
                    mtype = msg.get("type")
                    if mtype == "snapshot":
                        self._reader_state = (msg, time.monotonic())
                    elif mtype == "reply":
                        fut = self._reader_pending.pop(msg.get("id"), None)
                        if fut is not None and not fut.done():
                            fut.set_result(msg)
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
