"""WebSocket fan-out (M3).

Owns the per-client fan-out machinery the status broadcast rides on:

- the wire-format layer (msgpack default / json debug; one encoder pair,
  ``encode_ws_frame`` for broadcast-verbatim shared payloads),
- ``ClientState`` + the client registry,
- send mechanics: ``ws_send_measured`` (encode timing, bounded sends, the
  slow-client drop policy) and its fire-and-forget bounded close,
- the per-client status-delta diff,
- per-tick aggregate stats (poller logs them),
- ``build_status_envelope`` — envelope construction with EXPLICIT named
  safety inputs (armed, safety_trip, reader_stale, config_warning), per the
  modularization plan's "no generic event bus" requirement: when safety
  metadata is attached it is visible in the signature, never implied.

The per-client status loop itself still lives in gateway.py (it orchestrates
connection lifecycle, settings/policy side effects, and the hb-stall safety
action); it consumes this module's pieces. ``set_phase`` is injected for
stall forensics. This module never imports gateway.
"""
import asyncio
import collections
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional, Tuple

import msgspec as _msgspec
from fastapi import WebSocket

import lcnc_trace as _trace

# ---- Wire format ----
# WEBUI_WIRE_FORMAT=json explicitly to debug status frames in browser DevTools.
WIRE_FORMAT = (os.environ.get("WEBUI_WIRE_FORMAT") or "msgpack").strip().lower()
if WIRE_FORMAT not in ("json", "msgpack"):
    WIRE_FORMAT = "msgpack"

# Per-send timeout for ws.send_* calls. A backgrounded browser tab that
# stops reading back-pressures the kernel TCP write buffer; `await
# ws.send_bytes` then holds the asyncio loop long enough (1+ s observed)
# to break the 500 ms HAL heartbeat budget and trigger a safety trip.
# We bound any single send to this many seconds and force-close the
# offending client on timeout — bug fix, not trip suppression: the
# heartbeat task is unchanged and still trips on any other loop hang.
# 0.2 s leaves ~300 ms of remaining budget for the rest of the cycle.
WS_SEND_TIMEOUT_S = 0.2

# Delta status frames are the DEFAULT (experiment closed, June 2026): proven
# through weeks of daily sim use including the full #35 verification load
# matrix. Set WEBUI_STATUS_DELTA=0 to fall back to full frames + the
# shared-encode splice — the encode-optimal path for fanout-heavy setups
# (~6+ simultaneous viewers).
STATUS_DELTA_ENABLED = os.environ.get("WEBUI_STATUS_DELTA", "1") == "1"
# Full-snapshot cadence when delta mode is on: force a full every N cycles so
# any drift-bug self-heals within ~3s at 30 Hz.
DELTA_FULL_INTERVAL = 100


def _wire_enc_hook(obj):
    # Any object msgspec doesn't know how to encode gets stringified
    # (covers Path, datetime, and stray non-primitive payloads).
    return str(obj)


json_encoder = _msgspec.json.Encoder(enc_hook=_wire_enc_hook)
msgpack_encoder = _msgspec.msgpack.Encoder(enc_hook=_wire_enc_hook)

# NOTE: status-tick envelope encoding is done INLINE on the event loop (see
# ws_send_measured). An earlier dedicated ThreadPoolExecutor for it was
# measured and removed — encode_qsize stayed 0 while encode_ms still climbed,
# proving the cost is GIL contention, not pool dispatch; a worker pool only
# added overhead.


def json_encoder_encode(obj):
    return json_encoder.encode(obj)  # returns bytes


def encode_ws_frame(obj):
    """Encode a WS payload with the active wire format. Returns bytes for
    msgpack (→ ws.send_bytes) or str for json (→ ws.send_text). Used for
    shared payloads (viewer_gcode, surface_points, comp_grid) that are
    encoded once and broadcast verbatim to every client."""
    if WIRE_FORMAT == "msgpack":
        return msgpack_encoder.encode(obj)
    return json_encoder_encode(obj).decode("utf-8")


@dataclass
class ClientState:
    """Per-client server-side state. Replaces the prior dict-of-dict
    registry; the field set is small and stable, so a typed shape
    catches typos at write time and avoids `.get()` defaults entirely
    for known fields.

    The broadcast `clients` envelope reads only `ip` and `armed`; the
    rest are server-internal."""
    ip: str
    ws: "WebSocket"
    armed: bool = False
    halshow_live: bool = False
    last_hb: float = 0.0       # wall-clock time of last heartbeat from this client
    hb_mono: float = 0.0       # monotonic ts of last hb (0 = never seen)
    send_pending: bool = False # status fan-out is in-flight to this client
    hidden: bool = False       # client tab is backgrounded (visibilityState)
    session_id: Optional[str] = None  # tab-scoped UUID; basis for armed-resume across brief reconnects
    # Former ws_endpoint closure vars (M3 de-closure): single source of truth
    # for per-connection fanout state shared between the receive path and the
    # status loop. `armed` was previously a closure var duplicated into this
    # field at every write site.
    viewer_init_sent: bool = False
    probe_results: dict = field(default_factory=dict)  # per-client probe DRO results
    prev_tc_req: Optional[bool] = False   # tool-change-requested edge detection
    prev_tool_num: Optional[int] = None   # tool_number edge for tool_meta resend
    # Forensics for hb-stall disarms (delivery-vs-generation attribution): the
    # browser proved it generated+sent heartbeats on time while the gateway saw a
    # 3 s gap (the Vite dev proxy stalled the relay). On a stall, the arrival ring
    # + total frame count say definitively what reached us and when.
    frames_rx: int = 0         # every frame received from this client
    hb_ring: "collections.deque" = field(default_factory=lambda: collections.deque(maxlen=12))  # monotonic hb arrival times


def diff_status_data(last: Dict[str, Any], current: Dict[str, Any]) -> Dict[str, Any]:
    """Return fields of `current` that differ from `last`.

    Single-level diff — StatusPayload is flat (no nested dataclasses). For
    list-valued fields, Python == compares element-wise; mismatched lists are
    included whole. Reports added/changed keys only (no tombstone semantics)
    — `data` mirrors `linuxcnc.stat`, whose keys are stable, so removals
    don't occur in practice.
    """
    diff: Dict[str, Any] = {}
    for k, v in current.items():
        if k not in last or last[k] != v:
            diff[k] = v
    return diff


def build_status_envelope(
    *,
    status_data: Any,
    errors: Any,
    clients_list: Any,
    armed: bool,
    safety_trip: Optional[dict] = None,
    disable_reason: Optional[dict] = None,
    reader_stale: bool = False,
    config_warning: Optional[dict] = None,
    probe_results: Optional[dict] = None,
    rfl_status: Optional[dict] = None,
) -> dict:
    """Assemble the per-tick status envelope.

    Safety metadata is explicit by name (modularization plan: no generic
    event bus that obscures when armed / trip / stale-reader state is
    attached). Optional sections are added only when present so the wire
    frame stays sparse; `data` may be a dict copy or a pre-encoded
    msgspec.Raw splice — this function doesn't care.
    """
    msg: dict = {
        "type": "status",
        "data": status_data,
        "errors": errors,
        "clients": clients_list,
        "armed": armed,
    }
    if safety_trip is not None:
        msg["safety_trip"] = safety_trip
    if disable_reason is not None:
        msg["disable_reason"] = disable_reason
    if reader_stale:
        msg["reader_stale"] = True
    if config_warning is not None:
        msg["config_warning"] = config_warning
    if probe_results:
        msg["probe_results"] = probe_results
    if rfl_status is not None:
        # RFL guard progress (measuring / safe_z / starting / failures)
        # — top-level sibling of `data`, same pattern as safety_trip.
        msg["rfl_status"] = rfl_status
    return msg


class WsFanout:
    def __init__(self, *, set_phase: Callable[[str], None]) -> None:
        self._set_phase = set_phase
        # Client registry. The dict object is STABLE for the fanout's
        # lifetime — gateway rebinds a module global to it and mutates
        # entries through that reference.
        self.clients: Dict[int, ClientState] = {}
        # Per-tick aggregate stats for [STATUS] log. Accumulated as each
        # client's status_loop finishes its send; snapshotted + logged on the
        # next poller tick. All writers run on the single event loop, so no
        # lock is required.
        self.tick_stats: Dict[str, Any] = {
            "gen": 0, "tick_start": 0.0, "expected": 0, "done": 0,
            "encode_sum": 0.0, "send_sum": 0.0, "send_max": 0.0,
            # === STATUS-PAYLOAD DIAGNOSTICS (permanent) === aggregate per-tick
            # wire metrics so the [STATUS] outlier log can attribute encode
            # cost to actual payload size. tool_meta_count: how many clients
            # got a tool_meta block this tick (reconnect-storm inflator).
            "bytes_sum": 0, "bytes_max": 0, "tool_meta_count": 0,
        }

    def ws_hidden_flag(self, ws: WebSocket) -> bool:
        """Look up the `hidden` state of the client owning `ws` by identity.
        Used by the slow-send probes so a single trace event tells us whether
        the slow consumer was a backgrounded tab (hidden-tab gating should
        have caught it) or a genuinely-visible peer (separate problem).

        Iterates over a snapshot (`list(...)`) to avoid the only realistic
        failure mode (`RuntimeError: dictionary changed size during iteration`)
        when another coroutine adds or removes a client mid-call. Any other
        exception is a real bug and is allowed to propagate — better to
        surface a crash than to silently report `hidden=False` on a corrupted
        state and mislead the trace consumer.
        """
        for c in list(self.clients.values()):
            if c.ws is ws:
                return c.hidden
        return False

    async def _safe_ws_close(self, ws: WebSocket, peer: str) -> None:
        """Fire-and-forget close used by the ws_send_measured timeout branch.

        Bounds its own work to 500 ms total. Runs in a background task created
        via asyncio.create_task — the caller (timeout branch in ws_send_measured)
        must NOT await this. ws.close() itself can await an internal drain that
        isn't reliably bounded under storm conditions; if our wait_for here
        fires, the connection is forcibly torn down by the underlying TCP
        timeout / the peer's reconnect logic.
        """
        try:
            await asyncio.wait_for(ws.close(code=1001), timeout=0.5)
        except Exception:
            pass  # safe-silent: WS close is best-effort during shutdown

    async def ws_send_json(self, ws: WebSocket, obj: Dict[str, Any]):
        # Legacy-name shim: all sends go through ws_send_measured so the
        # wire-format flag applies uniformly and non-status messages don't
        # diverge from status frames. Callers that need encode timing / bytes
        # use ws_send_measured directly.
        await self.ws_send_measured(ws, obj)

    async def ws_send_measured(self, ws: WebSocket, obj: Dict[str, Any]) -> Tuple[float, int]:
        """Encode + send a WS payload. Returns (encode_ms, bytes_sent).

        Used by the status hot path to attribute encode cost and payload size
        for the Debug-tab timing surface. Other callers keep using
        ws_send_json when they don't care about the measurement.

        The wire format is chosen by WIRE_FORMAT. encode_ms excludes the
        actual ws.send_* call; bytes_sent is the size of the encoded payload.
        Returns (encode_ms, 0) if the client disconnected mid-send.
        """
        t0 = time.monotonic()
        self._set_phase("ws_send_measured.encode")
        # Inline encode (deliberate). A dedicated encode thread-pool was tried
        # and removed: the trace bus showed encode_qsize=0 across every
        # storm-time loop.tick while encode_ms still climbed to 50–200 ms —
        # pool dispatch isn't the cost, GIL contention is, and offloading only
        # adds dispatch overhead while the worker fights for the GIL alongside
        # the main loop. msgspec's C-level encoder is fast (sub-ms for the
        # typical envelope) and inline encoding eliminates a thread round-trip
        # per send. The `ws.encode_slow` event still fires if this assumption
        # breaks under future load.
        if WIRE_FORMAT == "msgpack":
            data = msgpack_encoder.encode(obj)
        else:
            data = json_encoder_encode(obj)
        encode_ms = round((time.monotonic() - t0) * 1000, 3)
        try:
            _send_peer = f"{ws.client.host}:{ws.client.port}" if ws.client else "?"
        except Exception:
            _send_peer = "?"
        # Encode-only slow path: catches the case where the encode was
        # GIL-starved but the actual ws.send returns fast. Without this,
        # ws.fanout_send_slow only fires when SEND is also slow and we'd
        # miss encode starvation entirely.
        if encode_ms > 50:
            _trace.emit(
                "ws.encode_slow",
                level="warn" if encode_ms > 200 else "info",
                peer=_send_peer, encode_ms=encode_ms, bytes=len(data),
                hidden=self.ws_hidden_flag(ws),
            )
        self._set_phase(f"ws_send.{WIRE_FORMAT} peer={_send_peer} bytes={len(data)}")
        # Bound any single send to WS_SEND_TIMEOUT_S. A backgrounded browser
        # tab stops reading → kernel TCP write buffer fills → `await
        # ws.send_bytes` holds the loop ~1+ s, breaking the 500 ms HAL
        # heartbeat budget. wait_for caps it; on timeout we close the slow
        # client (they're already not getting updates anyway). Other clients
        # are unaffected — each runs in its own status_loop task. The
        # heartbeat task remains tied to the same asyncio loop, so any other
        # cause of loop hang still trips the watchdog correctly.
        send_t0 = time.monotonic()
        try:
            if WIRE_FORMAT == "msgpack":
                await asyncio.wait_for(ws.send_bytes(data), timeout=WS_SEND_TIMEOUT_S)
            else:
                await asyncio.wait_for(
                    ws.send_text(data if isinstance(data, str) else data.decode("utf-8")),
                    timeout=WS_SEND_TIMEOUT_S,
                )
        except asyncio.TimeoutError:
            self._set_phase(f"ws_send_measured.timeout_caught peer={_send_peer}")
            # Slow consumer — log peer and close the WS. The per-client
            # status_loop catches the resulting WebSocketDisconnect and
            # exits cleanly (existing handler).
            try:
                peer = f"{ws.client.host}:{ws.client.port}" if ws.client else "?"
            except Exception:
                peer = "?"
            try:
                obj_type = str(obj.get("type", "?"))
            except Exception:
                obj_type = "?"
            send_ms = (time.monotonic() - send_t0) * 1000
            _trace.emit(
                "ws.slow_client_drop", level="warn",
                peer=peer, send_ms=round(send_ms, 1),
                timeout_ms=int(WS_SEND_TIMEOUT_S * 1000),
                bytes=len(data), obj_type=obj_type,
                hidden=self.ws_hidden_flag(ws),
            )
            # Schedule the close as fire-and-forget so the timeout branch
            # itself never blocks the asyncio loop. With N concurrent slow
            # peers the previous inline `await wait_for(ws.close, 0.1)` could
            # add N × 100 ms of loop-hold; create_task adds ~0 ms. The close
            # task is bounded internally (see _safe_ws_close). Combined with
            # the per-client send_pending flag, no further fan-out is queued
            # to this client until the close completes or the connection
            # errors out.
            asyncio.create_task(self._safe_ws_close(ws, peer))
            self._set_phase(f"ws_send_measured.timeout_returning peer={_send_peer}")
            return (encode_ms, 0)
        except RuntimeError:
            self._set_phase(f"ws_send_measured.RuntimeError peer={_send_peer}")
            return (encode_ms, 0)
        self._set_phase(f"ws_send_measured.send_done peer={_send_peer}")
        send_dt_ms = (time.monotonic() - send_t0) * 1000
        # Promote any slow but completed send (>50 ms) into the trace bus so
        # we see backpressure building before it timeouts.
        if send_dt_ms > 50:
            try:
                peer = f"{ws.client.host}:{ws.client.port}" if ws.client else "?"
            except Exception:
                peer = "?"
            try:
                obj_type = str(obj.get("type", "?"))
            except Exception:
                obj_type = "?"
            _trace.emit(
                "ws.fanout_send_slow",
                level="warn" if send_dt_ms > 200 else "info",
                peer=peer, send_ms=round(send_dt_ms, 1),
                encode_ms=encode_ms, bytes=len(data), obj_type=obj_type,
                hidden=self.ws_hidden_flag(ws),
            )
        # msgspec returns bytes; stdlib json returns str — both have len() == bytes/chars
        return (encode_ms, len(data))
