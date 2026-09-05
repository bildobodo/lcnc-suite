#!/usr/bin/env python3
import asyncio
import gzip
import json
import math
import time
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
import threading
from pathlib import Path
import linuxcnc

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, List, Tuple
from fastapi.staticfiles import StaticFiles
import re
import shutil
from urllib.parse import urlsplit
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException, Body, Query, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse, JSONResponse, FileResponse, Response

import logging
import click
from contextlib import asynccontextmanager

import lcnc_trace as _trace
_trace.init("gateway")
_trace.install_crash_hooks("gateway")

# Pure, linuxcnc-free helpers (importable under pytest without the binding).
from gateway_util import (
    ALLOWED_EXTENSIONS,
    SUBFILE_NAME_RE,
    resolve_subfile,
    parse_kins_config,
    sanitize_filename,
    validate_extension,
    validate_path_within,
    origin_allowed,
    token_ok,
    finite_float,
    finite_int,
    evaluate_trip_latch,
    evaluate_safety_chain,
    PREVIEW_SCHEMA,
    evaluate_tlo_drift,
    evaluate_rotary_drift, drift_gate_open, inflight_stale_reason,
    rotary_drift_settled,
    evaluate_kins_drift,
    wcs_offset_flat_from_table,
    evaluate_wcs_offset_drift,
    unwritten_estop_signal,
    kins_marker_policy,
    kins_pivot_warning,
    rotary_model_warning,
    parse_telemetry_batch,
    TELEMETRY_BODY_MAX,
    wcs_prov_params,
    evaluate_wcs_provenance,
    wcs_stamp_decision,
    PROV_STAMPED,
)
from command_policy import check_command, validate_payload, MachineLimits, touchoff_route, twp_capture_check, goto_zero_plan
from tool_table import (
    parse_tool_table,
    write_tool_table,
    _merge_tool_data,
    _TOOL_META_FIELDS,
)
from settings_store import SettingsStore, VALID_SECTIONS as _VALID_SETTINGS_SECTIONS
import status_runtime as _status_runtime_mod
from status_runtime import StatusPayload
import bulk_pipeline as _bulk_mod
from tool_store import ToolLibraryStore
from camera_broker import CameraBroker
from fusion_import import decode_fusion_blob


# === LIFECYCLE DIAGNOSTICS (permanent — promoted from temp probe) ===
# This timeline + the [GC]/[HB-WAKE]/lag.window family below is the proven
# attribution toolkit of the #35 effort (it pinned the GC object churn, the
# estop_reset NML hold, and the heartbeat delivery cliff). Quiet by design
# when healthy — keep it.
# Single timeline anchor: every probe line carries +Nms from this anchor,
# so boot, per-client connect, and shutdown all sit on one ruler. See
# /home/cnc/.claude/plans/can-you-plan-for-jolly-leaf.md for the full plan.
#
# REMOVAL MAP — when stripping this probe later, delete:
#   1. This whole block (lines 27 .. END LIFECYCLE DIAGNOSTICS marker below):
#        _T0, _dbg, _UvicornTimingFilter (+ filter install loop),
#        _format_conn_state, _install_shutdown_probe (incl. the _patched
#        monkey-patch of Server._wait_tasks_to_complete).
#   2. All scattered call sites — `git grep -n '_dbg('` and `git grep -n
#      '_T0'` and `git grep -n '_conn_t0'` in this file. As of this
#      writing the call sites are at module-level (BOOT markers around
#      try_connect_lcnc / _hal_connect / _load_machine_config / FastAPI
#      app instantiated / lifespan startup yield) and inside ws_endpoint
#      (CONN markers anchored on _conn_t0).
#   3. The lifespan teardown `[SHUTDOWN]` lines (search `_dt(` inside
#      `lifespan`) — re-anchored to _T0 here; either leave as permanent
#      (recommended — they're cheap and the only signal we have for
#      shutdown timing) or delete if going fully clean.
#
# DO KEEP after removal: the `--timeout-graceful-shutdown 1` flag in
# `lcnc-suite` (the real fix that bounds shutdown drain) and the bug
# fix in _patched's `except (Exception, asyncio.CancelledError)` IF the
# probe block is kept around at all. If removing the probe entirely,
# the `_patched` monkey-patch goes with it and the bug becomes moot.
_T0 = time.monotonic()


# Boot start emitted to trace bus only — gateway terminal already shows
# uvicorn's own startup banner. lcnc_trace.py records monotonic_ms so
# subsequent boot.* events can be plotted on a shared timeline.
_trace.emit("boot.start", pid=os.getpid())


class _UvicornTimingFilter(logging.Filter):
    """Prepend [+Nms] (offset from gateway boot) to every uvicorn log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        offset_ms = (time.monotonic() - _T0) * 1000
        prefix = f"[+{offset_ms:.0f}ms] "
        # uvicorn passes its colorised template via `color_message`; prefix
        # both forms so the on-screen and on-file rendering both show it.
        if isinstance(record.msg, str) and not record.msg.startswith("[+"):
            record.msg = prefix + record.msg
        cm = record.__dict__.get("color_message")
        if isinstance(cm, str) and not cm.startswith("[+"):
            record.__dict__["color_message"] = prefix + cm
        return True


_uv_timing_filter = _UvicornTimingFilter()
for _logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
    logging.getLogger(_logger_name).addFilter(_uv_timing_filter)


# === GC DIAGNOSTICS (permanent) === log generation-0/1/2 garbage-collector events
# with duration. Python GC mark-sweep can stall the main thread for
# hundreds of ms on a large object graph (e.g. accumulated msgpack
# envelopes / status snapshots / error queues during a 12-client
# storm). If a multi-second event-loop stall coincides with a [GC]
# line showing generation=2 and high duration_ms, GC is the culprit.
# Gen-0 fires very frequently (every few hundred allocations) and is
# usually <1 ms; only logged when slow. Gen-2 is logged unconditionally.
import gc as _gc
_gc_start_t: Dict[int, float] = {}


def _gc_callback(phase: str, info: Dict[str, Any]) -> None:
    gen = info.get("generation", -1)
    if phase == "start":
        _gc_start_t[gen] = time.monotonic()
        return
    if phase != "stop":
        return
    t0 = _gc_start_t.pop(gen, None)
    if t0 is None:
        return
    dt_ms = (time.monotonic() - t0) * 1000
    if gen == 2 or dt_ms > 10:
        offset_ms = (time.monotonic() - _T0) * 1000
        print(
            f"[GC] +{offset_ms:.0f}ms gen={gen} duration={dt_ms:.1f}ms "
            f"collected={info.get('collected', 0)} "
            f"uncollectable={info.get('uncollectable', 0)}",
            flush=True,
        )


_gc.callbacks.append(_gc_callback)
# === END LIFECYCLE DIAGNOSTICS ===


class _UvicornUrlColorFilter(logging.Filter):
    """Tint the URL in uvicorn's startup log cyan instead of plain bold."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.__dict__.get("color_message")
        if isinstance(msg, str) and msg.startswith("Uvicorn running on "):
            record.__dict__["color_message"] = (
                "Uvicorn running on "
                + click.style("%s://%s:%d", fg="cyan", bold=True)
                + " (Press CTRL+C to quit)"
            )
        return True


logging.getLogger("uvicorn").addFilter(_UvicornUrlColorFilter())
logging.getLogger("uvicorn.error").addFilter(_UvicornUrlColorFilter())


class _UvicornAccessTelemetryFilter(logging.Filter):
    """Drop /telemetry access-log lines — the browser POSTs these on a
    steady cadence (tab visibility, send-buffer pressure, JS errors) and
    each one would otherwise print an INFO line, drowning real requests.
    The event payload still flows through the trace bus as browser.* —
    only the duplicated access-log noise is suppressed."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3:
            path = args[2]
            if isinstance(path, str) and path.startswith("/telemetry"):
                return False
        return True


logging.getLogger("uvicorn.access").addFilter(_UvicornAccessTelemetryFilter())


# ---- Config ----
POLL_HZ = 30  # status update rate
BASE_DIR = Path(__file__).resolve().parent
# Machine viewer-model dir (machine.json + STLs). Overridable per-config via
# INI [DISPLAY] WEBUI_MACHINE_DIR (exported by the launcher) so e.g. the
# 5-axis sim can ship its own model without touching the default one. A
# missing/broken dir is NOT silent: _load_machine_config() already raises the
# operator-visible config warning banner in that case.
_machine_dir_env = os.environ.get("LCNC_WEBUI_MACHINE_DIR", "").strip()
MACHINE_DIR = Path(_machine_dir_env).expanduser() if _machine_dir_env else BASE_DIR / "machine"

# ---- Perf experiment flags (INI-sourced via lcnc-suite launcher) ----
# WIRE_FORMAT defaults to msgpack: smaller payload than JSON, faster
# C-accelerated encode, and unlocks the per-tick shared-encode path under
# fan-out when delta is off (one encode per tick instead of N). Set
# ---- Wire format / send policy ---- moved to ws_fanout (M3). Constants
# rebound here; the WsFanout instance + method rebinds live after _set_phase.
import ws_fanout as _ws_fanout_mod

_WIRE_FORMAT = _ws_fanout_mod.WIRE_FORMAT
_STATUS_DELTA_ENABLED = _ws_fanout_mod.STATUS_DELTA_ENABLED
_ADAPTIVE_POLL_ENABLED = os.environ.get("WEBUI_ADAPTIVE_POLL") == "1"
try:
    _IDLE_POLL_HZ = max(1, int(os.environ.get("WEBUI_IDLE_POLL_HZ") or "5"))
except ValueError:
    _IDLE_POLL_HZ = 5
_DELTA_FULL_INTERVAL = _ws_fanout_mod.DELTA_FULL_INTERVAL
# msgspec stays imported here: the poller's bulk-payload encodes (surface/grid/
# preview — M4 territory) use it directly.
import msgspec as _msgspec

_json_encoder_encode = _ws_fanout_mod.json_encoder_encode
_msgpack_encoder = _ws_fanout_mod.msgpack_encoder

# Optional WS-init concurrency limiter. Default of 20 is a no-op for the
# documented 10–13-tab scenario. If a real overload manifests (HAL trip
# even after viewer_init caching + dedicated encode pool), set
# WEBUI_WS_INIT_CONCURRENCY=4 (or similar) in [DISPLAY] to serialize
# per-client init at accept time. NOT wired in by default — the cache
# (build_viewer_init) already drops per-connect cost to microseconds on
# 2nd+ client, making this throttle redundant in practice. Wire-up when
# needed: `async with _ws_init_sem:` around the accept→status_task span
# at the top of ws_endpoint(). Keep the wrap-window short (release after
# status_task spawn) so concurrent live connections aren't capped at the
# init-concurrency limit.
_WS_INIT_LIMIT = int(os.environ.get("WEBUI_WS_INIT_CONCURRENCY", "20"))
_ws_init_sem = asyncio.Semaphore(_WS_INIT_LIMIT)

# ── Per-client command worker (2026-09-03) ──
# The WS reader handles liveness/bookkeeping frames only; every command is
# queued to ONE per-client worker task, in order. A handler that awaits
# inside _cmd_lock (a plane touch-off waits up to 30 s for its MDI plus a 3 s
# datum settle; Capture chains four such waits) used to run INSIDE the reader
# loop, so the client's own heartbeats sat unread in the socket until it
# returned and status_loop disarmed the client 3 s later — six operator-
# visible false disarms (safety.hb_stall_disarmed, arrival gaps 3.3–4.0 s,
# each 0.2 s after touchoff.plane / twp.capture). Liveness never queues
# behind work; the event loop itself was never the problem (_cmd_blocking
# runs on a thread).
_WS_CMD_QUEUE_MAX = 32
# Stop-class commands are never rejected by backpressure ("no stop command
# may be droppable", docs/decisions.md) — a 4× hard cap still bounds a
# broken client.
_WS_STOP_CMDS = frozenset({"jog_stop", "jog_stop_multi", "abort", "estop"})
# abort/estop SUPERSEDE the work this client queued before them and PREEMPT
# any in-flight non-stop handler on EVERY client (2026-09-05): a stop must
# never wait behind a 30 s MDI wait, and abort/E-Stop are machine-global, so
# every in-flight handler's assumptions are void. jog_stop/jog_stop_multi
# stay plain FIFO — no supersede, no preempt — because a stray jog_stop
# during an MDI is a certified no-op class (twp_buttons_check) and reordering
# it ahead of the jog_cont it belongs to would be an unbounded jog.
_WS_PREEMPT_CMDS = frozenset({"abort", "estop"})
# Never cancelled by a preempt: the stops themselves, and `arm` — its disarm
# branch jog-stops under _cmd_lock and flips client.armed; cancelling it
# would leave the flip with no reply.
_WS_NO_PREEMPT = _WS_STOP_CMDS | {"arm"}
# Client heartbeat budget (s): status_loop disarms an armed client whose
# last heartbeat is older than this. Module-level so tests can shrink it.
_HB_STALL_SEC = 3.0


# ── Auth / origin controls (issue #17) ──
# Pre-shared token: empty string disables auth (loopback/dev). The launcher
# fail-closed rule guarantees a token is set whenever HOST is non-loopback.
WEBUI_TOKEN = os.environ.get("LCNC_WEBUI_TOKEN", "").strip()
# Explicit Origin allow-list (comma/space-separated). Empty ⇒ same-host only.
_ALLOWED_ORIGINS = {
    o.strip() for o in re.split(r"[,\s]+", os.environ.get("LCNC_WEBUI_ALLOWED_ORIGINS", "").strip()) if o.strip()
}
_DEV = os.environ.get("LCNC_WEBUI_DEV", "0").strip() not in ("", "0", "false", "False")
# In dev the page is served by Vite on :5173 and proxied to the gateway, so the
# Origin won't match the gateway's host:port. Admit the standard local Vite
# origins explicitly; the port rule in _ws_origin_ok also covers LAN dev.
_DEV_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"} if _DEV else set()
_VITE_DEV_PORT = 5173


def _ws_origin_ok(origin: Optional[str], host: Optional[str]) -> bool:
    if origin_allowed(origin, host, _ALLOWED_ORIGINS, _DEV_ORIGINS):
        return True
    # Dev convenience: the Vite dev server is reachable on any LAN IP, and the
    # proxied WS may not preserve the Host header for a same-host match. So in
    # dev mode admit any origin on the Vite port — the token still gates the
    # connection. Never active in production (_DEV is false).
    if _DEV and origin:
        try:
            if urlsplit(origin).port == _VITE_DEV_PORT:
                return True
        except ValueError:
            pass
    return False


def _peer_of(ws: WebSocket) -> str:
    return ws.client.host if ws.client else "?"


async def require_token(request: Request):
    """FastAPI dependency gating mutation routes (issue #17).

    No-op when no token is configured (loopback/dev). Accepts the token from the
    ``X-Auth-Token`` header OR a ``token`` query param — the latter is needed
    because ``navigator.sendBeacon`` (settings flush on page exit) cannot set
    headers.
    """
    if not WEBUI_TOKEN:
        return
    presented = request.headers.get("x-auth-token") or request.query_params.get("token")
    if not token_ok(presented, WEBUI_TOKEN):
        _trace.emit("rest.auth_rejected", level="warn",
                    peer=(request.client.host if request.client else "?"),
                    path=request.url.path)
        raise HTTPException(status_code=401, detail="Unauthorized")


# ---- LinuxCNC handles (nullable for auto-reconnect) ----
STAT: Optional[linuxcnc.stat] = None
CMD: Optional[linuxcnc.command] = None
ERR: Optional[linuxcnc.error_channel] = None
lcnc_connected = False
_lcnc_pid: Optional[int] = None  # tracks linuxcncsvr PID

# ---- WCS offset cache ---- moved to status_runtime (M2). Constants rebound
# here; the cache list itself is rebound after the runtime instance exists.
_WCS_BASES = _status_runtime_mod.WCS_BASES
_WCS_NAMES = _status_runtime_mod.WCS_NAMES
_G5X_MAP = {"G54": 1, "G55": 2, "G56": 3, "G57": 4, "G58": 5, "G59": 6, "G59.1": 7, "G59.2": 8, "G59.3": 9}
_WCS_AXIS_KEYS = _status_runtime_mod.WCS_AXIS_KEYS

# ---- Connected WebSocket clients ----
# ClientState + the client registry moved to ws_fanout (M3). The registry
# global is rebound to the WsFanout instance's dict after _set_phase below.
ClientState = _ws_fanout_mod.ClientState

_next_client_id = 0

# ---- Armed-resume holds (Layer D, session-id resume) ----
# When an armed client's WebSocket closes, we register a short-lived hold
# keyed by session_id. If the same session reconnects within the window via
# `cmd:"hello"`, the new connection silently inherits armed=true. This makes
# Ctrl-R, Wi-Fi blips, and brief screen-lock-induced WS closes invisible.
#
# tab close → new sessionId on next open → no resume (intentional)
# Ctrl-R    → same sessionId → resume granted
_ARMED_RESUME_GRACE_SEC = 10.0
_armed_resume_holds: Dict[str, float] = {}  # session_id → expiry monotonic ts
# Armed-resume is for a CLEAN brief reconnect (Ctrl-R, wifi blip) — the client was
# beating normally right up to the drop. If the heartbeat was already lagging at
# disconnect (a struggling/overloaded client), it's NOT a clean reconnect: do not
# auto-restore armed, require an explicit operator re-arm. 2.0 s = at most ~1
# missed 1 Hz beat; the disarm timeout is 3 s.
_RESUME_MAX_HB_AGE = 2.0


def _register_armed_resume_hold(session_id: Optional[str], client_id: int) -> None:
    """Register an armed-resume hold for a session_id. No-op if no session_id."""
    if not session_id:
        return
    _prune_armed_resume_holds()
    expiry = time.monotonic() + _ARMED_RESUME_GRACE_SEC
    _armed_resume_holds[session_id] = expiry
    _trace.emit(
        "session.resume_hold_registered",
        client_id=client_id, session_id=session_id,
        grace_sec=_ARMED_RESUME_GRACE_SEC,
    )


def _peek_armed_resume_hold(session_id: Optional[str]) -> str:
    """Inspect a session_id without consuming. Returns one of:
      "granted" — hold exists and within grace window
      "expired" — hold exists but past expiry
      "no_match" — no hold registered for this session_id (or no id at all)
    Used by the hello handler to decide which trace event to emit before
    actually consuming the hold via _consume_armed_resume_hold."""
    if not session_id:
        return "no_match"
    expiry = _armed_resume_holds.get(session_id)
    if expiry is None:
        return "no_match"
    if time.monotonic() > expiry:
        return "expired"
    return "granted"


def _consume_armed_resume_hold(session_id: Optional[str]) -> None:
    """Remove the hold for this session_id (single-use). Caller should have
    already peeked to decide whether to grant. Safe to call even if no hold
    exists — pops with default."""
    if not session_id:
        return
    _armed_resume_holds.pop(session_id, None)


def _prune_armed_resume_holds() -> None:
    """Drop expired holds. Bounded size in practice (one entry per recently-
    disconnected armed client) but cheap to keep tidy."""
    now = time.monotonic()
    expired = [sid for sid, exp in _armed_resume_holds.items() if now > exp]
    for sid in expired:
        del _armed_resume_holds[sid]

# ---- HAL IPC: watchdog + reader sockets ----
# Extracted to hal_bridge.py (M6). The bridge owns both Unix-socket clients
# (watchdog sends, reader snapshots + RPC, snapshot freshness); the heartbeat
# coroutine below stays HERE and only hands values to it — the bridge must
# never produce a heartbeat. The instance + legacy-name rebinds (_hal_send,
# _reader_get, ...) live after _set_phase, a constructor dependency; every
# function in between resolves those globals at call time.
import sys
import signal

import hal_bridge as _hal_bridge_mod

_hal_last_hb = False
_disconnect_grace_task: Optional[asyncio.Task] = None
_DISCONNECT_GRACE_SEC = 3.0  # covers 2s frontend reconnect delay
_estop_hold = False  # hold connected=FALSE during UI e-stop

# Bound for CMD.wait_complete() on short mode/teleop/abort transitions.
# Prevents an unbounded block from tying up an executor thread or delaying
# the next command on the same client's receive path. MDI/program_open keep
# their own larger timeouts (5s) because the interpreter can legitimately
# take longer to acknowledge a parsed block.
_CMD_WAIT_TIMEOUT = 2.0
# CMD.wait_complete() holds the GIL for its whole wait (2.9.4 emcmodule.cc:
# the poll loop esleep()s with no Py_BEGIN_ALLOW_THREADS), so a long wait on
# the to_thread worker freezes the event loop — heartbeat task included.
# _cmd_blocking therefore waits in slices this long: each return releases
# the GIL, and a cancel (abort/estop preemption, disconnect) lands after
# the current slice instead of after the whole wait.
_CMD_WAIT_SLICE = 0.05
# wait_complete() rc when _cmd_blocking gave up the wait on cancel — treated
# as failed by _cmd_rc_failed (the handler is being cancelled anyway).
_RC_WAIT_CANCELLED = -2

def _snapshot_trip(trip_ts_ns: int) -> None:
    """Write a forensic bundle when a HAL safety trip fires. Runs in a
    worker thread (asyncio.to_thread) so it can't block the loop. Best
    effort: any failure is logged but doesn't propagate."""
    base = _trace.log_dir()
    if not base:
        # No silent scatter: a trip bundle written to cwd/`/tmp` is a lost
        # forensic record. Surface the bug instead.
        _trace.emit("safety.snapshot_no_log_dir", level="error",
                    trip_ts_ns=trip_ts_ns)
        return
    out_dir = os.path.join(base, f"trips/{trip_ts_ns}/")
    try:
        os.makedirs(out_dir, exist_ok=True)
    except Exception as e:
        _trace.emit("safety.snapshot_mkdir_failed", level="error",
                    out_dir=out_dir, exc=type(e).__name__, msg=str(e))
        return
    try:
        # The bundler is best-effort: 10 s timeout protects against the
        # rare case where /tmp is on a slow filesystem (e.g. tmpfs full).
        rc = subprocess.run(
            [
                "python3",
                "/home/cnc/lcnc-suite/scripts/trace-bundle.py",
                # Pass the exact trip timestamp: --trip's auto-detect anchors
                # on wd.hb_edge, a best-effort 100 ms poller that misses short
                # pin dips — it once re-bundled the PREVIOUS trip's window
                # because the fresh trip never produced a falling edge.
                "--trip-ns", str(trip_ts_ns),
                "--out", out_dir,
            ],
            timeout=10,
            capture_output=True,
            check=False,
        )
        _trace.emit("safety.trip_snapshot_done",
                    out_dir=out_dir, rc=rc.returncode)
    except subprocess.TimeoutExpired:
        _trace.emit("safety.trip_snapshot_timeout", level="warn",
                    out_dir=out_dir, timeout_s=10)
    except Exception as e:
        _trace.emit("safety.trip_snapshot_failed", level="warn",
                    out_dir=out_dir, exc=type(e).__name__, msg=str(e))


async def _reader_configure_extra_pins() -> None:
    """Push the current extra-pin config to the reader.

    Called on reader reconnect (the bridge's on_reader_connect hook spawns
    this as a task — the recv loop dispatches the reply, so awaiting inside
    the hook would deadlock), when settings change, and after a LinuxCNC
    (re)connect via the poller (the kins pin below needs STAT for the INI
    path, so a reader that connected first must be re-pushed). Reads
    settings directly so it's correct regardless of whether status_loop has
    run yet (race-free at startup). Fire-and-forget; failures log but don't
    propagate.
    """
    if not _hal_bridge.reader_connected:
        return
    pins: Dict[str, str] = {}
    try:
        _settings = await asyncio.to_thread(load_settings)  # file read off the loop (B3)
        slp = _settings.get("machine", {}).get("spindleLoadPin", "")
    except Exception:
        slp = ""
    if isinstance(slp, str) and _HAL_PIN_RE.match(slp):
        pins["spindle_load"] = slp
    # Live switchkins mode (TCP+TWP phase 2 deferred refinement): sample
    # motion.switchkins-type so the sim entry move can invert the live
    # joints under the machine's ACTUAL kins mode — the machine may be
    # parked in world mode from a previous run while the loaded program's
    # preamble hasn't executed yet. Only on configs whose declared kins
    # can actually switch: on trivkins the pin doesn't exist and would sit
    # in the reader's missing-pin reminder forever.
    _kins_decl = _parse_kins_decl()
    if kins_marker_policy(_kins_decl) != "ignore":
        pins["kins_type"] = "motion.switchkins-type"
    # TWP plane frame (phase 3 residual): the three pins g53x_core set_p's at
    # every G53.x. Until now the frame reached the client only as parse-time
    # marker comments, so a machine PARKED IN TWP from a previous run — a real
    # state, the upstream demo leaves the machine in it — entering sim had a
    # LIVE switchkins type paired with a frame taken from whatever program
    # happens to be loaded. Mixed authority: right mode, wrong plane.
    # Gated on the TYPE, not on marker policy: only this family has these
    # pins, and asking for them elsewhere would park them in the reader's
    # missing-pin reminder forever. Prefix from the module name — the comp
    # creates its pins under "<module>_kins.", the same quirk
    # parse_kins_config special-cases.
    if (_kins_decl or {}).get("type") == "xyzacb-trsrn":
        _kp = f"{_kins_decl['module']}_kins."
        pins["kins_pre_rot"] = f"{_kp}pre-rot"
        pins["kins_primary_angle"] = f"{_kp}primary-angle"
        pins["kins_secondary_angle"] = f"{_kp}secondary-angle"
        # TWP state + plane definition from the twp-helper comp (P3
        # operator surface: mode chip, plane visualization). Same trsrn
        # gate: the shipped trsrn config IS the TWP stack; a trsrn config
        # without the helper comp would park these in the reader's
        # missing-pin reminder — loud, and correct (its TWP state would
        # be unknowable).
        pins["twp_defined"] = "twp-helper-comp.twp-is-defined"
        pins["twp_active"] = "twp-helper-comp.twp-is-active"
        # Plane position = work offset (twp-o*-world) + origin vector
        # (twp-o*), both in the TABLE frame: the plane is stored relative to
        # the A table, so the sum is a table-frame point and the viewer draws
        # it inside the work group, which is that same frame. Both halves ride
        # the snapshot; status assembles the sum.
        # Datum-write epoch (2026-09-05): M535 bumps it AFTER publishing the
        # datum. Registered BEFORE the datum pins on purpose — the reader
        # samples extra pins in insertion order, and "seq changed ⇒ datum
        # current" needs the seq read first (the helper writes the datum,
        # then the seq). test_extra_pins pins the order.
        pins["twp_datum_seq"] = "twp-helper-comp.twp-datum-seq"
        for _f, _p in (("twp_ox", "twp-ox-world"), ("twp_oy", "twp-oy-world"),
                       ("twp_oz", "twp-oz-world"),
                       ("twp_pox", "twp-ox"), ("twp_poy", "twp-oy"),
                       ("twp_poz", "twp-oz"),
                       ("twp_zx", "twp-zx"), ("twp_zy", "twp-zy"),
                       ("twp_zz", "twp-zz"),
                       ("twp_xx", "twp-xx"), ("twp_xy", "twp-xy"),
                       ("twp_xz", "twp-xz")):
            pins[_f] = f"twp-helper-comp.{_p}"
        # Machine-frame A (deg) the HEAD was last oriented at. The plane
        # itself rides the workpiece and cannot go stale; a live A away from
        # this means the TOOL is no longer normal to the plane. Raw float on
        # the wire — the remap's "no orient yet" sentinel is read client-side.
        pins["twp_pose_a"] = "twp-helper-comp.twp-pose-a"
    try:
        await _reader_request("set_extra_pins", pins=pins)
    except Exception as e:
        _trace.emit("reader.configure_extra_pins_failed", level="warn",
                    exc=type(e).__name__, msg=str(e))


async def _disconnect_grace():
    """Keep heartbeat alive while waiting for reconnect, then drop pins."""
    _set_phase("disconnect_grace.entry")
    global _hal_last_hb
    ticks = int(_DISCONNECT_GRACE_SEC * POLL_HZ)
    for _i in range(ticks):
        if _clients:
            _set_phase("disconnect_grace.client_returned_exit")
            return  # client reconnected during grace
        _set_phase(f"disconnect_grace.tick {_i}/{ticks}")
        _hal_last_hb = not _hal_last_hb
        _hal_send({"heartbeat": _hal_last_hb, "connected": True})
        await asyncio.sleep(1.0 / POLL_HZ)
    if not _clients:
        _set_phase("disconnect_grace.final_drop")
        _hal_send({"connected": False, "heartbeat": False})
    _set_phase("disconnect_grace.exit")


def _start_disconnect_grace():
    global _disconnect_grace_task
    if _disconnect_grace_task and not _disconnect_grace_task.done():
        return  # already running
    _disconnect_grace_task = register_bg_task(asyncio.get_event_loop().create_task(_disconnect_grace()))


async def _cancel_disconnect_grace():
    """Cancel and await the grace task before returning.

    Both _disconnect_grace and _heartbeat_loop toggle _hal_last_hb. If we
    only call .cancel() (returns immediately), the grace task can still run
    one more tick and flip the heartbeat pin while the new heartbeat loop
    is also flipping it — three flips in two ticks can trip oneshot.0.out.
    Awaiting the cancellation guarantees the grace task is done before the
    heartbeat loop starts.
    """
    global _disconnect_grace_task
    task = _disconnect_grace_task
    _disconnect_grace_task = None
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass  # safe-silent: we just cancelled it, CancelledError is the success signal
        except Exception as e:
            _trace.emit("disconnect_grace.cancel_error", level="warn",
                        error=f"{type(e).__name__}: {e}")


_heartbeat_task: Optional[asyncio.Task] = None


async def _heartbeat_loop():
    """Independent HAL heartbeat — decoupled from status processing.

    Toggles at POLL_HZ while clients are connected.  When no clients remain
    the loop yields to _disconnect_grace which manages the grace period.
    E-Stop is handled via the independent command path (ws.receive →
    per-client cmd_worker → handle_command) so a stuck status_loop does not
    block safety controls.
    """
    global _hal_last_hb
    _hb_expected = 1.0 / POLL_HZ
    _hb_last = time.monotonic()
    # === HB-TRACE DIAGNOSTICS (permanent) === fires only when a 30-iteration window (~1 s
    # at POLL_HZ=30) shows an anomaly that [HB-STALL]'s per-tick drift detector
    # misses. Two cases:
    #   1. Monotonic clock froze (VM pause / cgroup throttle / scheduler
    #      lockout): wall delta ≫ monotonic delta between consecutive samples.
    #      [HB-STALL] stays silent because post-sleep drift in monotonic terms
    #      looks normal — the clock itself stopped.
    #   2. Many sub-200ms stalls accumulating: each one is below [HB-STALL]'s
    #      threshold but together push the 30-iter window well past 1 s.
    # Healthy operation = silent. Anomaly = one log line with full context.
    _hb_iter = 0
    _hb_sample_mono = time.monotonic()
    _hb_sample_wall = time.time()
    # Thresholds: skew >100ms means wall and monotonic disagree by enough to
    # rule out routine scheduling jitter; mono_dt >1.5s (50% over expected 1s)
    # means accumulated stall worth surfacing.
    _HB_SKEW_THRESH = 0.1
    _HB_MONO_THRESH = 1.5
    # === HB-WAKE DIAGNOSTICS (permanent) === pre-send anchor to catch a hidden gap that
    # [HB-STALL] cannot see: scheduling delay between asyncio.sleep returning
    # and the heartbeat task actually being selected to run its body. If a
    # busy event loop holds the heartbeat task ready-but-not-running for
    # 100+ ms, this fires while [HB-STALL] (which measures post-sleep drift)
    # stays silent because the elapsed-vs-expected math at sleep return is
    # normal. Threshold 100ms — well under the 200 ms HB-STALL threshold so
    # we catch sub-stall scheduling jitter that otherwise compounds silently.
    _hb_last_pre_send = time.monotonic()
    while True:
        _hb_pre_send = time.monotonic()
        _hb_pre_send_gap = (_hb_pre_send - _hb_last_pre_send) * 1000
        if _hb_pre_send_gap > 100:
            print(
                f"[HB-WAKE] +{(_hb_pre_send - _T0) * 1000:.0f}ms "
                f"pre-send-to-pre-send gap {_hb_pre_send_gap:.0f}ms "
                f"(expected {_hb_expected*1000:.0f}ms)",
                flush=True,
            )
        _hb_last_pre_send = _hb_pre_send
        if _clients:
            _hal_last_hb = not _hal_last_hb
            _hal_send({"heartbeat": _hal_last_hb, "connected": not _estop_hold})
        await asyncio.sleep(_hb_expected)
        _hb_now = time.monotonic()
        # Any gap >200ms between heartbeat ticks is within the 500ms watchdog
        # budget but worth surfacing — lets us correlate stalls with parse /
        # scan / encode events in the logs.
        _hb_drift = _hb_now - _hb_last - _hb_expected
        if _hb_drift > 0.2:
            print(f"[HB-STALL] heartbeat gap {_hb_drift*1000:.0f}ms (expected {_hb_expected*1000:.0f}ms)", flush=True)
        _hb_last = _hb_now
        _hb_iter += 1
        # Sample wall/mono every 30 iterations (~1 s at POLL_HZ=30). Log only
        # when the window shows clock skew or accumulated stall — see the
        # HB-TRACE PROBE comment above the loop for the two failure modes.
        if _hb_iter % 30 == 0:
            _hb_now_wall = time.time()
            _hb_mono_dt = _hb_now - _hb_sample_mono
            _hb_wall_dt = _hb_now_wall - _hb_sample_wall
            _hb_skew = abs(_hb_wall_dt - _hb_mono_dt)
            if _hb_skew > _HB_SKEW_THRESH or _hb_mono_dt > _HB_MONO_THRESH:
                print(
                    f"[HB] +{(_hb_now - _T0) * 1000:.0f}ms iter={_hb_iter} "
                    f"mono_dt={_hb_mono_dt*1000:.0f}ms "
                    f"wall_dt={_hb_wall_dt*1000:.0f}ms "
                    f"skew={_hb_skew*1000:.0f}ms clients={len(_clients)}",
                    flush=True,
                )
            _hb_sample_mono = _hb_now
            _hb_sample_wall = _hb_now_wall


# Phase ring buffer — replaces last-writer-wins single global. Each
# _set_phase call appends (mono_s, name) to the ring. When [LAG] fires we
# dump the slice of the ring that overlaps the stall window, plus compute
# the phase that occupied the largest fraction of it ("dominant_phase" =
# the actual culprit). The previous single-global design always reported
# whoever woke first after the stall, which is innocent.
_PHASE_RING_LEN = 256
_phase_ring: List[Tuple[float, str]] = []
_phase_ring_idx = 0
_current_phase: str = "idle"
_phase_started_at: float = 0.0


def _set_phase(name: str) -> None:
    """Append a phase marker to the ring and update the current pointer.
    Cheap: append + 2 globals + monotonic()."""
    global _current_phase, _phase_started_at, _phase_ring_idx
    now = time.monotonic()
    _current_phase = name
    _phase_started_at = now
    if len(_phase_ring) < _PHASE_RING_LEN:
        _phase_ring.append((now, name))
    else:
        _phase_ring[_phase_ring_idx] = (now, name)
        _phase_ring_idx = (_phase_ring_idx + 1) % _PHASE_RING_LEN


def _phase_ring_snapshot() -> List[Tuple[float, str]]:
    """Return phases in chronological order. Caller must not mutate."""
    if len(_phase_ring) < _PHASE_RING_LEN:
        return list(_phase_ring)
    # Already filled; reorder so oldest is first.
    return _phase_ring[_phase_ring_idx:] + _phase_ring[:_phase_ring_idx]


# ---- M4 bulk pipeline instance ----
# Versioned immutable cached payloads (preview/surface/grid) + the parse
# subprocess lifecycle. Reassigned-scalar state lives as instance ATTRIBUTES
# (not rebinds — rebinding wouldn't track reassignment), so call sites read
# _bulk.<attr> directly. Deps late-bound: STAT rebinds on reconnect, and
# get_machine_units/_build_wcs_rotation_patches are defined further down.
def _live_kins_for_parse():
    """(live switchkins type, live plane frame [p,t1,t2]) for the parse ctx
    — the fifth freshness input. Reader-sourced, same pins the status
    snapshot carries; None on untracked configs / absent snapshot (the
    worker then seeds nothing, honestly)."""
    kt = _reader_get("kins_type")
    fr = (_reader_get("kins_pre_rot"), _reader_get("kins_primary_angle"),
          _reader_get("kins_secondary_angle"))
    frame = [float(v) for v in fr] if all(v is not None for v in fr) else None
    return (int(round(kt)) if kt is not None else None, frame)


def _live_kins_frame_of(st):
    """Status-snapshot view of the live plane frame — all three pins or
    nothing (a partial frame makes no claim)."""
    f = (st.kins_pre_rot, st.kins_primary_angle, st.kins_secondary_angle)
    return [float(v) for v in f] if all(v is not None for v in f) else None


_bulk = _bulk_mod.BulkPipeline(
    get_stat=lambda: STAT,
    get_machine_units=lambda: get_machine_units(),
    build_wcs_rotation_patches=lambda: _build_wcs_rotation_patches(),
    get_live_kins=lambda: _live_kins_for_parse(),
    # The fixture cache + g92 the var-file patches come from, flattened
    # like the worker's __WCSOFF__ line — the in-flight supersede compares
    # a touch-off against exactly what the running parse was seeded with.
    get_wcs_off_flat=lambda: wcs_offset_flat_from_table(
        _wcs_cache, getattr(STAT, "g92_offset", None)),
)


# ---- M3 fanout instance ----
# Send mechanics + client registry + tick stats live on the instance; the
# registry/stats dict objects are stable so these rebinds stay valid.
_ws_fanout = _ws_fanout_mod.WsFanout(set_phase=_set_phase)
_clients = _ws_fanout.clients
_status_tick_stats = _ws_fanout.tick_stats
ws_send_json = _ws_fanout.ws_send_json
ws_send_measured = _ws_fanout.ws_send_measured
_ws_hidden_flag = _ws_fanout.ws_hidden_flag
_diff_status_data = _ws_fanout_mod.diff_status_data


# ---- M6 bridge instance ----
# Created here because _set_phase is a constructor dependency. The legacy
# underscore names are rebound to bound methods so the many call sites —
# including _heartbeat_loop/_disconnect_grace defined ABOVE — read unchanged;
# they resolve these globals at call time, after this point. on_reader_connect
# spawns the extra-pin push as a task (the recv loop dispatches the reply, so
# the hook itself must not await).
_hal_bridge = _hal_bridge_mod.HalBridge(
    set_phase=_set_phase,
    on_reader_connect=lambda: asyncio.create_task(_reader_configure_extra_pins()),
)
_hal_connect = _hal_bridge.watchdog_connect
_hal_disconnect = _hal_bridge.watchdog_disconnect
_hal_send = _hal_bridge.watchdog_send
_reader_recv_loop = _hal_bridge.reader_recv_loop
_reader_request = _hal_bridge.reader_request
_reader_get = _hal_bridge.reader_get
_reader_is_stale = _hal_bridge.reader_is_stale

# Safety-chain completeness banner (review group B1). Grace covers the
# concurrent process bring-up window; after it, a down watchdog socket or a
# fresh reader snapshot without trip_latched means the advertised safety
# chain is NOT in place — broadcast per tick, never trace-only.
_SAFETY_CHAIN_GRACE_SEC = 15.0
_gw_start_mono = time.monotonic()
# One-shot estop-loop writer check result (set by the lifespan task).
_estop_loop_reason: Optional[str] = None


def _safety_chain_reason() -> Optional[str]:
    return evaluate_safety_chain(
        grace_expired=(time.monotonic() - _gw_start_mono) > _SAFETY_CHAIN_GRACE_SEC,
        watchdog_connected=_hal_bridge.watchdog_connected,
        reader_fresh=not _hal_bridge.reader_is_stale(),
        trip_latched_present=_hal_bridge.reader_get("trip_latched") is not None,
        extra_reason=_estop_loop_reason,
    )


async def _estop_loop_check_once() -> None:
    """One-shot (post-grace) check for the unwritten-estop-loop trap.

    HAL topology is fixed at config load, so one look suffices. Best-effort
    forensics: a halcmd failure parses to [] -> indeterminate (None), said
    by _parse_hal_signals' own trace — the primary detections above don't
    depend on this."""
    global _estop_loop_reason
    await asyncio.sleep(_SAFETY_CHAIN_GRACE_SEC)
    try:
        signals = await asyncio.get_running_loop().run_in_executor(
            None, _parse_hal_signals)
        _estop_loop_reason = unwritten_estop_signal(signals)
        if _estop_loop_reason:
            _trace.emit("safety.estop_loop_unwritten", level="error",
                        reason=_estop_loop_reason)
    except Exception as e:
        _trace.emit_exc("safety.estop_loop_check_failed", e)


def _phase_window(start_mono: float, end_mono: float) -> List[dict]:
    """Phases that overlap [start, end]. Each entry has start_ms, dur_ms,
    name. Durations clipped to the window so dominant_phase math is honest."""
    snap = _phase_ring_snapshot()
    out: List[dict] = []
    for i, (t_begin, name) in enumerate(snap):
        # End of this phase is the start of the next, or `now` for the last.
        t_end = snap[i + 1][0] if i + 1 < len(snap) else end_mono
        # Skip phases entirely before the window or entirely after.
        if t_end <= start_mono:
            continue
        if t_begin >= end_mono:
            continue
        clipped_begin = max(t_begin, start_mono)
        clipped_end = min(t_end, end_mono)
        out.append({
            "start_ms": round((clipped_begin - start_mono) * 1000, 2),
            "dur_ms": round((clipped_end - clipped_begin) * 1000, 2),
            "name": name,
        })
    return out


def _dominant_phase(window: List[dict]) -> Optional[str]:
    """Phase name that occupied the largest total duration in the window."""
    if not window:
        return None
    totals: Dict[str, float] = {}
    for ph in window:
        totals[ph["name"]] = totals.get(ph["name"], 0.0) + ph["dur_ms"]
    return max(totals.items(), key=lambda kv: kv[1])[0]


async def _loop_lag_monitor():
    """Fire-and-forget task that measures event-loop scheduling lag.

    Prints + emits a structured `lag.window` event whenever the loop takes
    >50 ms longer than the requested sleep to wake back up. The structured
    event includes the ring-buffer slice that overlaps the stall window
    plus the computed `dominant_phase` (the actual culprit). The legacy
    [LAG] line is preserved for grep familiarity.
    """
    TICK = 0.05
    THRESHOLD = 0.05  # 50 ms — was 100; lower for sub-trip visibility
    last = time.monotonic()
    while True:
        await asyncio.sleep(TICK)
        now = time.monotonic()
        drift = now - last - TICK
        if drift > THRESHOLD:
            # Stall window: the period between when we expected to wake
            # (last + TICK) and when we actually woke (now). Pad backward
            # by a small margin so we catch the phase that started just
            # before the stall.
            window_start = last + TICK - 0.005
            window_end = now
            window = _phase_window(window_start, window_end)
            dominant = _dominant_phase(window)
            phase_age_ms = (now - _phase_started_at) * 1000 if _phase_started_at else 0
            _trace.emit(
                "lag.window",
                level="warn",
                drift_ms=round(drift * 1000, 1),
                window_ms=round((window_end - window_start) * 1000, 1),
                dominant_phase=dominant,
                last_phase=_current_phase,
                last_phase_age_ms=round(phase_age_ms, 1),
                phases=window,
            )
        last = now


_lag_monitor_task: Optional[asyncio.Task] = None
_loop_tick_task: Optional[asyncio.Task] = None


_rss_read_warned = False


def _read_rss_kb() -> int:
    """Read VmRSS from /proc/self/status. Returns 0 on any failure (Linux-
    only path; harmless on other OSes since the gateway runs on Linux)."""
    global _rss_read_warned
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    parts = line.split()
                    if len(parts) >= 2:
                        return int(parts[1])
    except Exception as e:
        # One-shot warn — /proc failure is a fundamental OS issue, not
        # a transient. Rate-limited at one event per process lifetime so
        # the poll loop doesn't spam.
        if not _rss_read_warned:
            _rss_read_warned = True
            _trace.emit_exc("proc.vmrss_read_failed", e)
    return 0


def _executor_qsize() -> int:
    """Pending items in the default thread-pool executor. Best-effort:
    accesses a private attribute (_default_executor._work_queue) since
    asyncio doesn't expose a stable getter. Returns -1 if unavailable."""
    try:
        loop = asyncio.get_event_loop()
        ex = getattr(loop, "_default_executor", None)
        if ex is None:
            return -1
        wq = getattr(ex, "_work_queue", None)
        if wq is None:
            return -1
        return wq.qsize()
    except Exception:
        return -1


# /proc/stat aggregate CPU breakdown — first line is "cpu  user nice system
# idle iowait irq softirq steal guest guest_nice". The `steal` field is what
# we care about: time the VM was runnable but the hypervisor was running
# something else. Inside a VM under host load, this delta jumps. Outside a
# VM (or when the host has plenty of CPU) it stays at 0. Counter unit is
# USER_HZ (100 jiffies/s on Linux), so we convert to ms for readability.
_USER_HZ = 100  # standard on Linux x86; sysconf(_SC_CLK_TCK) confirms but
                # the value has been 100 forever.
_last_proc_stat: Optional[Tuple[float, dict]] = None  # (mono_s, parsed)


def _read_proc_stat() -> Optional[dict]:
    """Read /proc/stat aggregate cpu line. Returns a dict of jiffy counters
    or None on parse failure. Only the aggregate `cpu` line is parsed —
    per-core breakdown is not needed for steal-time detection."""
    try:
        with open("/proc/stat") as f:
            line = f.readline()
        if not line.startswith("cpu "):
            return None
        parts = line.split()
        # parts[0] = 'cpu', parts[1..] = counters in jiffies
        names = ["user", "nice", "system", "idle", "iowait", "irq",
                 "softirq", "steal", "guest", "guest_nice"]
        out: Dict[str, int] = {}
        for i, name in enumerate(names):
            if i + 1 < len(parts):
                try:
                    out[name] = int(parts[i + 1])
                except ValueError:
                    out[name] = 0
            else:
                out[name] = 0
        return out
    except Exception:
        return None


def _proc_stat_delta() -> Dict[str, Any]:
    """Compute per-second jiffy deltas from the last `loop.tick` call.
    Returns dict with `steal_ms`, `iowait_ms`, `idle_pct`, plus raw jiffy
    deltas. First call after start returns absolute values (warm-up)."""
    global _last_proc_stat
    now = time.monotonic()
    cur = _read_proc_stat()
    if cur is None:
        return {"steal_ms": -1}
    if _last_proc_stat is None:
        _last_proc_stat = (now, cur)
        return {"steal_ms": 0, "warmup": True}
    prev_t, prev = _last_proc_stat
    dt_s = max(now - prev_t, 1e-6)
    _last_proc_stat = (now, cur)
    deltas = {k: max(0, cur.get(k, 0) - prev.get(k, 0)) for k in cur}
    total = sum(deltas.values())
    # Convert jiffies → ms via USER_HZ. If the system actually used 250 Hz
    # this would be off by 2.5×, but USER_HZ=100 is universal on x86_64.
    jiffy_ms = 1000.0 / _USER_HZ
    return {
        "steal_ms": round(deltas.get("steal", 0) * jiffy_ms, 1),
        "iowait_ms": round(deltas.get("iowait", 0) * jiffy_ms, 1),
        "user_ms": round(deltas.get("user", 0) * jiffy_ms, 1),
        "system_ms": round(deltas.get("system", 0) * jiffy_ms, 1),
        "idle_ms": round(deltas.get("idle", 0) * jiffy_ms, 1),
        "total_ms": round(total * jiffy_ms, 1),
        "dt_s": round(dt_s, 3),
    }


async def _loop_tick():
    """Emit one `loop.tick` event every 1 s with snapshot of loop health:
    pending tasks, executor queue depth, GC counts, RSS, plus host CPU
    steal time (definitive signal for hypervisor preemption inside a VM).
    Cheap (~80 us total)."""
    import gc
    while True:
        try:
            await asyncio.sleep(1.0)
            try:
                pending = sum(1 for t in asyncio.all_tasks() if not t.done())
            except Exception:
                pending = -1
            ps = _proc_stat_delta()
            _trace.emit(
                "loop.tick",
                pending_tasks=pending,
                executor_qsize=_executor_qsize(),
                gc_counts=list(gc.get_count()),
                rss_kb=_read_rss_kb(),
                clients=len(_clients) if "_clients" in globals() else 0,
                **ps,
            )
        except asyncio.CancelledError:
            return
        except Exception:
            # Never let this task die quietly; loop.
            await asyncio.sleep(1.0)


def _start_heartbeat():
    global _heartbeat_task, _lag_monitor_task, _loop_tick_task
    if _heartbeat_task is None or _heartbeat_task.done():
        _heartbeat_task = register_bg_task(asyncio.get_event_loop().create_task(_heartbeat_loop()))
    if _lag_monitor_task is None or _lag_monitor_task.done():
        _lag_monitor_task = register_bg_task(asyncio.get_event_loop().create_task(_loop_lag_monitor()))
    if _loop_tick_task is None or _loop_tick_task.done():
        _loop_tick_task = register_bg_task(asyncio.get_event_loop().create_task(_loop_tick()))


# ---- Shared status poller ----
# Single global task that calls poll_status() + read_errors_nonblocking() once
# per cycle for all clients, eliminating redundant STAT.poll() / GIL contention
# when multiple clients are connected.

_shared_status: Optional["StatusPayload"] = None
# Wire axis indices with a jog the GATEWAY started and has not stopped. A
# jog_stop for an axis not in here is a no-op (traced): it used to force
# MODE_MANUAL, and a stop arriving in the ~30 ms before STAT showed a fresh
# MDI executing aborted that MDI (the operator's finger leaving the A button
# a beat after pressing → Zero — 2026-09-04/05, seen racing at poll
# granularity even with the interp-busy guard). A successful switch to MDI /
# AUTO clears it: task refuses those while a jog is active, so success means
# none is. Jogs started by other UIs (halui, axis) are not in here — the
# gateway never stops what it did not start; the HAL chain owns motion safety.
_active_jogs: set = set()
_shared_status_dict: Optional[dict] = None  # cached asdict(_shared_status)

# ---- Program-elapsed timer (server-authoritative) ----
# Tracked across status polls so every connected client (including ones that
# joined mid-program) sees the same elapsed time. Anchored to time.monotonic()
# so wall-clock NTP corrections don't jump the counter.
# Pre-encoded msgpack bytes of _shared_status_dict. When the wire format is
# msgpack and no per-client mutation applies (tool_meta injection, delta), each
# client's envelope encode splices these bytes verbatim via msgspec.Raw — one
# encode per tick instead of one per client. None when JSON wire format or
# when the poller has not run yet.
_shared_status_data_msgpack: Optional[bytes] = None
_shared_errors: list = []
_errors_total: int = 0   # monotonic count of drained NML errors (RFL guard abort-detection)
_shared_probe_updates: dict = {}
_shared_timing: dict = {}  # poll_ms, errors_ms, parse_ms, poller_ts
# Per-cycle snapshot of connected clients — rebuilt once by the poller so
# every status_loop doesn't repeat the O(N) list-comp (avoids O(N²)/cycle).
# Reference is swapped atomically before _status_event.set(), so readers
# always see a consistent list for the duration of their iteration.
_shared_clients_list: list = []
_tool_table_version: int = int(time.time())  # bumped after every CMD.load_tool_table(); per-client trackers in status_loop send a `tool_table_changed` ping so other clients refetch

# Halshow live loop — pushes value deltas to clients viewing the Settings → Halshow tab.
# Topology (pin/signal/param structure, links) is built once via halcmd subprocess on subscribe;
# values are diffed every 200 ms via hal.get_info_*, which is ~1 ms for the full HAL.
_halshow_loop_task: Optional[asyncio.Task] = None
_halshow_last_values: dict = {}                # "section/name" → last broadcast value (delta source)
_halshow_topology_sent: dict = {}              # client_id → True once topology has been delivered
_halshow_topology_cache: Optional[dict] = None  # built-once HAL graph (P5); HAL graph is static post-boot

# Safety-trip sticky notification: populated when _status_poller() observes the
# servo-thread HAL latch (webui-hb-latch.fault-out) go FALSE→TRUE after a known-
# good baseline (issue #34). Broadcast to all clients in every status message
# until a client sends {cmd:"safety_trip_ack"}. Lives server-side (not per-client)
# so reload / multi-tab all see the same trip.
_unacked_trip: Optional[dict] = None  # {"reason": str}
_last_fault_latched: Optional[bool] = None  # webui-hb-latch.fault-out at last poll
_trip_baseline_seen: bool = False  # have we ever seen the latch clear (FALSE)?

# Warn-once flags for STAT field absence — the cascade itself is correct (different
# LinuxCNC versions expose different fields), but exhausting all candidates without
# a log leaves the operator staring at a blank DRO with no idea why. Reset on every
# successful try_connect_lcnc() so a real failure isn't masked across reconnects.

_status_gen = 0  # incremented each poll; clients compare to skip redundant sends
_status_poller_task: Optional[asyncio.Task] = None
# Broadcast event replaced on every poll cycle. Per-client loops snapshot the
# current event and `await event.wait()` instead of tight-polling _status_gen.
# Lazily allocated on first use so module import doesn't require an event loop.
_status_event: Optional[asyncio.Event] = None

# Serializes all CMD.* access. The LinuxCNC NML command channel is not
# thread-safe; concurrent handle_command coroutines with >=2 clients
# corrupted NML state and segfaulted the process before this lock existed.
# Must be held for every CMD.* call — direct, via _cmd_blocking, or via
# asyncio.to_thread. Non-reentrant: helpers (_cmd_blocking, set_mode) assume
# the caller already holds the lock.
_cmd_lock: Optional[asyncio.Lock] = None


def _get_cmd_lock() -> asyncio.Lock:
    global _cmd_lock
    if _cmd_lock is None:
        _cmd_lock = asyncio.Lock()
    return _cmd_lock

# Timing log (toggled via "timing_log" WS command from Debug tab)
_timing_log_enabled = False
_timing_log_path: Optional[str] = None


def _log_timing(timing: dict):
    """Append one JSON line to the current timestamped log file.

    Dev-only path (Debug tab toggle). Open-per-write keeps the file handle
    out of module state — simpler shutdown, no handle to leak if the toggle
    is turned on/off repeatedly. If log volume becomes a concern, migrate to
    a logging.FileHandler.
    """
    if not _timing_log_enabled or not _timing_log_path:
        return
    try:
        timing["ts"] = time.time()
        with open(_timing_log_path, "a") as f:
            f.write(json.dumps(timing) + "\n")
    except OSError as e:
        _trace.emit("timing.log_write_failed", level="warn",
                    exc=type(e).__name__, msg=str(e))


_PID_CHECK_INTERVAL = 5.0  # seconds between pgrep PID checks


# Probe result widget names from DEBUG EVAL messages → friendly keys.
# Used by _status_poller below; declared here so the reference at use site
# isn't a forward-reference into the file.
_PROBE_WIDGET_MAP = {
    "x_probed_width":          "x_width",
    "x_center_probed":         "x_center",
    "y_probed_width":          "y_width",
    "y_center_probed":         "y_center",
    "x_minus_probed_position": "x_minus",
    "x_plus_probed_position":  "x_plus",
    "y_minus_probed_position": "y_minus",
    "y_plus_probed_position":  "y_plus",
    "z_minus_probed_position": "z_minus",
    "averaged_diam":           "diameter",
    "edge_delta":              "edge_delta",
    "edge_angle":              "edge_angle",
    "calibration_offset_3032": "cal_offset",
}

_PROBE_EVAL_RE = re.compile(
    r'EVAL\[vcp\.getWidget\{"(\w+)"\}\.setValue\{([^}]+)\}\]',
    re.IGNORECASE,
)


async def _status_poller():
    """Single global poller — polls LinuxCNC once per cycle for all clients.

    All LinuxCNC C extension calls (STAT.poll(), hal.get_value(), NML reads)
    hold the GIL and never release it — run_in_executor provides zero
    parallelism, only thread dispatch overhead (1-5ms per call). Every
    successful LinuxCNC UI (AXIS 50Hz, GMOCCAPY 10Hz, QtVCP 10Hz) polls
    synchronously. We do the same, yielding to the event loop between
    blocking sections so heartbeats and sends can proceed.
    """
    global _shared_status, _shared_status_dict, _shared_errors, _shared_probe_updates, _errors_total
    global _status_gen, lcnc_connected, STAT, CMD, ERR, _reconnect_fails, _shared_timing
    global _status_event, _shared_clients_list
    loop = asyncio.get_event_loop()
    _poll_fails = 0
    _last_pid_check = 0.0
    _cycle_start = time.monotonic()
    _was_active = True  # Experiment 4: track active/idle edge for instant wake-up
    # === IDLE-GATEWAY DIAGNOSTICS (permanent) === log when the gateway is up but no
    # clients are connected. Helps tell "all tabs reconnected fast" from
    # "tabs are stuck somewhere and never reaching us" in the log alone.
    _idle_last_log = 0.0
    while True:
        try:
            _cycle_start = time.monotonic()

            if not _clients:
                _set_phase("status_poller.idle_wait")
                # Periodic idle marker (every ~5s) so the operator can see
                # at a glance that the gateway is alive but unconnected.
                if _cycle_start - _idle_last_log >= 5.0:
                    _uptime_ms = (_cycle_start - _T0) * 1000
                    print(
                        f"[IDLE] +{_uptime_ms:.0f}ms gateway up, "
                        f"0 clients connected (waiting)",
                        flush=True,
                    )
                    _idle_last_log = _cycle_start
                await asyncio.sleep(0.5)
                continue

            # ---- Reconnection logic (moved from per-client status_loop) ----
            # _get_lcnc_pid + try_connect_lcnc spawn subprocesses (pgrep,
            # 1 s timeout; _nml_connectable, 5 s timeout). Running them on
            # the event loop stalls poll_status long enough to flap the
            # HAL heartbeat and trip oneshot.0.out. Offload to a worker.
            if not lcnc_connected:
                pid = await asyncio.to_thread(_get_lcnc_pid)
                if pid is not None and await asyncio.to_thread(try_connect_lcnc):
                    _reconnect_fails = 0
                    _hal_connect()
                    # Re-push extra pins: the kins pin needs STAT (INI path),
                    # so a reader that connected before LinuxCNC did must be
                    # reconfigured now.
                    register_bg_task(asyncio.create_task(_reader_configure_extra_pins()))
                    register_bg_task(asyncio.create_task(_ensure_prov_var_rows()))
                    _poll_fails = 0
                else:
                    if pid is not None and _ever_connected:
                        _reconnect_fails += 1
                        if _reconnect_fails >= _NML_POISON_THRESHOLD:
                            print(f"NML reconnect failed {_reconnect_fails} times with linuxcncsvr alive — restarting gateway")
                            _self_restart()
                    else:
                        _reconnect_fails = 0
                    await asyncio.sleep(2.0)
                    continue

            # ---- Process-level detection: rate-limited PID check ----
            now = time.monotonic()
            if now - _last_pid_check >= _PID_CHECK_INTERVAL:
                _last_pid_check = now
                if await asyncio.to_thread(check_lcnc_instance):
                    if _lcnc_pid is not None:
                        if await asyncio.to_thread(try_connect_lcnc):
                            _reconnect_fails = 0
                            _hal_connect()
                            register_bg_task(asyncio.create_task(_reader_configure_extra_pins()))
                            register_bg_task(asyncio.create_task(_ensure_prov_var_rows()))
                    else:
                        STAT = CMD = ERR = None
                        lcnc_connected = False
                        continue

            # poll_status() blocks ~40ms (GIL held by C extensions).
            # run_in_executor lets the event loop serve HTTP (STL files)
            # between GIL switches during that time. asdict() runs in the
            # same hop so StatusPayload serialisation stays off the event
            # loop too.
            t0 = time.monotonic()
            _set_phase("status_poller.poll_and_serialize")
            st, status_dict = await loop.run_in_executor(None, _poll_and_serialize)
            t1 = time.monotonic()
            _set_phase("status_poller.read_errors")
            # ERR.poll() is a C-extension call that holds the GIL for its
            # NML read; running it inline on the main thread blocks the
            # event loop in the same way STAT.poll does. Move it to the
            # default executor so heartbeat / WS sends can interleave.
            raw_errs = await loop.run_in_executor(None, read_errors_nonblocking)
            t2 = time.monotonic()
            _set_phase("status_poller.post_poll")
            _poll_fails = 0

            # Parse probe results from DEBUG EVAL messages; detect surface scan completion
            errs = []
            probe_updates = {}
            surface_scan_done = False
            OPERATOR_DISPLAY = 13
            for kind, text in raw_errs:
                if kind == OPERATOR_DISPLAY:
                    m = _PROBE_EVAL_RE.search(text)
                    if m:
                        key = _PROBE_WIDGET_MAP.get(m.group(1))
                        if key:
                            try:
                                probe_updates[key] = float(m.group(2))
                            except ValueError as e:
                                _trace.emit_exc(
                                    "probe.widget_value_parse_failed", e,
                                    widget=m.group(1), raw=m.group(2)[:80],
                                )
                            continue
                    elif "LCNC_SURFACE_SCAN_DONE" in text:
                        surface_scan_done = True
                        continue  # consume — don't forward to frontend as an error
                errs.append((kind, text))
                # LinuxCNC's operator channel also rides the trace (2026-09-04):
                # a refused MDI / mode switch used to be visible only in the
                # operator's browser, so an aborted → Zero was undiagnosable
                # from runlogs. OPERATOR_TEXT/DISPLAY (12/13) are messages;
                # everything else (NML/operator errors) is a warn.
                _trace.emit("nml.error", level="info" if kind in (12, 13) else "warn",
                            kind=kind, text=str(text)[:240])

            # INI-change invalidation (issue #29): if the active INI changed
            # under a persistent gateway, the surface/comp caches hold the
            # previous config's data. Reset the init flags + clear pending/bytes
            # and bump versions so clients refetch — the init blocks below then
            # reload from the new config's result files (or stay empty).
            _cur_ini = getattr(STAT, "ini_filename", None)
            if _cur_ini and _bulk.caches_ini is not None and _bulk.caches_ini != _cur_ini:
                _bulk.surface_initialized = False
                _bulk.grid_initialized = False
                _bulk.surface_pending = None
                _bulk.surface_bytes = None
                _bulk.grid_pending = None
                _bulk.grid_bytes = None
                _bulk.surface_version += 1
                _bulk.grid_version += 1
                _trace.emit("cache.ini_changed_invalidated", old=_bulk.caches_ini, new=_cur_ini)
            if _cur_ini:
                _bulk.caches_ini = _cur_ini

            # Startup init: push existing probe-results.txt to new clients on first connect
            if not _bulk.surface_initialized and getattr(STAT, "ini_filename", None):
                pts = await asyncio.to_thread(_bulk.read_probe_results_file)
                if pts:
                    _bulk.surface_pending = pts
                    _bulk.surface_bytes = await asyncio.to_thread(
                        _msgspec.msgpack.encode, pts
                    )
                    _bulk.surface_version += 1
                _bulk.surface_initialized = True

            # Scan completion: re-read file and push updated data to all clients
            if surface_scan_done:
                pts = await asyncio.to_thread(_bulk.read_probe_results_file)
                if pts:
                    _bulk.surface_pending = pts
                    _bulk.surface_bytes = await asyncio.to_thread(
                        _msgspec.msgpack.encode, pts
                    )
                    _bulk.surface_version += 1
                # Tell compensation.py the file is complete and ready to load.
                # Wrapped: compensation.py may not be loaded in all configs.
                try:
                    await _reader_request("set_p", pin="compensation.reload-req", value=str(int(time.time())))
                except Exception as e:
                    _trace.emit("comp.reload_req_failed", level="warn",
                                exc=type(e).__name__, msg=str(e),
                                hint="compensation.py not loaded?")

            # Comp grid startup init: push existing probe-results-grid.json on first connect
            if not _bulk.grid_initialized and getattr(STAT, "ini_filename", None):
                t_read = time.monotonic()
                grid = await asyncio.to_thread(_bulk.read_comp_grid_file)
                t_read_done = time.monotonic()
                if grid:
                    _bulk.grid_pending = grid
                    _bulk.grid_bytes = await asyncio.to_thread(
                        _msgspec.msgpack.encode, grid
                    )
                    t_enc_done = time.monotonic()
                    _bulk.grid_version += 1
                    print(
                        f"[COMP] publish v={_bulk.grid_version} trigger=init "
                        f"file_ms={(t_read_done - t_read)*1000:.0f} "
                        f"encode_ms={(t_enc_done - t_read_done)*1000:.0f} "
                        f"bytes={len(_bulk.grid_bytes)}B "
                        f"total_ms={(t_enc_done - t_read)*1000:.0f}",
                        flush=True,
                    )
                _bulk.last_comp_hal_ver = st.comp_grid_version  # sync — prevents re-fire below
                _bulk.grid_initialized = True

            # Comp grid update: detect via compensation.grid-version HAL pin
            if _bulk.grid_initialized and st.comp_grid_version is not None \
                    and st.comp_grid_version != _bulk.last_comp_hal_ver:
                t_read = time.monotonic()
                grid = await asyncio.to_thread(_bulk.read_comp_grid_file)
                t_read_done = time.monotonic()
                if grid:
                    _bulk.grid_pending = grid
                    _bulk.grid_bytes = await asyncio.to_thread(
                        _msgspec.msgpack.encode, grid
                    )
                    t_enc_done = time.monotonic()
                    _bulk.grid_version += 1
                    print(
                        f"[COMP] publish v={_bulk.grid_version} trigger=hal "
                        f"hal_ver={st.comp_grid_version} "
                        f"file_ms={(t_read_done - t_read)*1000:.0f} "
                        f"encode_ms={(t_enc_done - t_read_done)*1000:.0f} "
                        f"bytes={len(_bulk.grid_bytes)}B "
                        f"total_ms={(t_enc_done - t_read)*1000:.0f}",
                        flush=True,
                    )
                _bulk.last_comp_hal_ver = st.comp_grid_version

            # Gcode preview: parse once (in subprocess) on file change, share
            # to all clients via version counter. Single-flight via
            # _bulk.refresh_running so rapid-fire loads don't stack
            # subprocesses. Parse output is WCS-invariant (worker un-rotates
            # and un-offsets), so rotation edits and WCS switches never
            # trigger a re-parse — frontend re-applies LIVE origin+rotation
            # as scene-graph updates.
            # Edge on either the path OR the file's mtime: re-loading the same
            # path after an in-place edit (web editor Save, or an external
            # edit) keeps active_file constant, so without the mtime check the
            # preview would never re-parse and the UI would show stale content.
            if st.active_file:
                try:
                    _cur_mtime = os.path.getmtime(st.active_file)
                except OSError:
                    # File momentarily absent (e.g. mid atomic-write swap).
                    # Leave _bulk.last_mtime as-is; next tick re-checks.
                    _cur_mtime = _bulk.last_mtime
            else:
                _cur_mtime = None
            file_changed = bool(st.active_file) and (
                st.active_file != _bulk.last_file or _cur_mtime != _bulk.last_mtime
            )
            # reparse_pending: an operator Reparse that arrived during an
            # in-flight parse (or any Reparse — the flag is the request,
            # the cache keys are no longer cleared for it).
            if file_changed or (_bulk.reparse_pending and st.active_file):
                if _bulk.refresh_running:
                    # A parse is running for a superseded file/mtime, or the
                    # operator asked for a fresh one: its result is stale
                    # before it lands. Cancel it; this branch re-fires as
                    # soon as the flag clears (cancel_inflight is idempotent
                    # per parse, so the tick loop does not re-trace).
                    _bulk.cancel_inflight("file" if file_changed else "reparse")
                else:
                    _bulk.schedule_refresh(
                        st.active_file,
                        "file" if file_changed else (_bulk.reparse_pending_reason or "reparse"),
                        _spawn_preview_task)
            elif (
                # In-flight supersede (2026-09-05): the drift edges below are
                # gated on `not refresh_running`, so an edge raised DURING a
                # parse — a touch-off while the rotary-drift parse from
                # → Zero still runs, i.e. every zeroing sequence live — was
                # not even evaluated until that parse published, and then
                # queued a second full parse behind it (41–167 s to a
                # correct preview on the 1.18 M-line program). Evaluate the
                # same edges against the RUNNING parse's input snapshot and
                # cancel it when one fires; reparse_pending restarts it with
                # fresh inputs. Same idle gate, settle guards and 2 s
                # debounce (inflight_stale_reason, pure).
                _bulk.refresh_running
                and _bulk.inflight is not None
                and bool(st.active_file)
                and drift_gate_open(
                    st.active_file, False, True,
                    st.interp_state == linuxcnc.INTERP_IDLE, st.current_vel,
                    time.monotonic() - _bulk.tlo_check_ts)
            ):
                _bulk.tlo_check_ts = time.monotonic()
                _wflat = wcs_offset_flat_from_table(st.wcs_table, st.g92_offset)
                _stale = inflight_stale_reason(
                    _bulk.inflight, st.rotary_abc, _bulk.rotary_check_prev,
                    st.kins_type, _live_kins_frame_of(st), _wflat,
                    _bulk.wcsoff_check_prev)
                _bulk.rotary_check_prev = st.rotary_abc
                _bulk.wcsoff_check_prev = _wflat
                if _stale:
                    _bulk.reparse_pending = True
                    _bulk.reparse_pending_reason = _stale
                    _bulk.cancel_inflight(_stale)
            elif (
                # Schema edge (P1): the published payload's wire-format stamp
                # disagrees with the schema this gateway was started with —
                # the cache key (file+mtime) can't see a code upgrade, so the
                # stamp is the missing key component. Latched per (file,
                # mtime): if the mismatch survives one reparse (the worker on
                # disk genuinely emits a different schema than this process
                # imported — a half-upgraded install), respawning every tick
                # fixes nothing; the client banner carries the signal instead.
                bool(st.active_file)
                and not _bulk.refresh_running
                and _bulk.preview_available()
                and _bulk.published_schema != PREVIEW_SCHEMA
                and _bulk.schema_reparse_attempted != (_bulk.last_file, _bulk.last_mtime)
            ):
                _bulk.schema_reparse_attempted = (_bulk.last_file, _bulk.last_mtime)
                _trace.emit("gcode.schema_stale_reparse", level="warn",
                            published=_bulk.published_schema, expected=PREVIEW_SCHEMA)
                _bulk.schedule_refresh(st.active_file, "schema", _spawn_preview_task)
            elif (
                # TLO drift edge (W2 P4): the per-line limit flags bake the
                # parse-time tool table, so a toolsetter re-measure after
                # load leaves them stale (11,532 false Z-max flags live).
                # Idle-gated — never reparse under a run (the client's
                # parse_tlos hint covers that window) — and debounced to one
                # check per 2 s so MDI/touch-off sequences settle first.
                # The rotary / kins / WCS-offset edges below share this
                # gate. They used to sit under `published_tlo is not None`
                # too, so a payload whose __TLO__ line was absent or
                # malformed never re-seeded its rotary pose at all.
                drift_gate_open(
                    st.active_file, _bulk.refresh_running, _bulk.preview_available(),
                    st.interp_state == linuxcnc.INTERP_IDLE, st.current_vel,
                    time.monotonic() - _bulk.tlo_check_ts)
            ):
                _bulk.tlo_check_ts = time.monotonic()
                _drift = None
                _tlo_meta = _bulk.published_tlo
                if _tlo_meta is not None:
                    _tt_path = _tlo_meta.get("table_path")
                    try:
                        _tt_cur = os.path.getmtime(_tt_path) if _tt_path else None
                    except OSError:
                        _tt_cur = None
                    _tofs = st.tool_offset
                    # Live table rows for every program tool (schema 8): a
                    # re-measure of a tool that is NOT loaded stales the
                    # per-segment pose too. STAT was polled this tick.
                    try:
                        _rows = [(int(t.id), float(t.zoffset))
                                 for t in (getattr(STAT, "tool_table", None) or [])]
                    except (AttributeError, TypeError, ValueError):
                        _rows = None
                    _drift = evaluate_tlo_drift(
                        _tlo_meta, _tt_cur, st.tool_number,
                        _tofs[2] if _tofs and len(_tofs) > 2 else None,
                        table_rows=_rows)
                if _drift is None:
                    # Rotary-pose drift (W6): the payload poses every
                    # uncommanded-rotary segment at the PARSE-time pose; a
                    # run that parks the table tilted makes that stale (the
                    # sim then shows an orient sweep the next run will not
                    # perform — the arc-vs-plunge class). Same idle gate and
                    # debounce; reparse re-seeds from the current pose.
                    # SETTLE GUARD: interp is IDLE while jogging, so drift
                    # alone would reparse every 2 s DURING a rotary jog and
                    # the preview chases the head in laggy snaps (operator-
                    # caught). Fire only once the pose has held still for a
                    # full debounce interval, and never while the trajectory
                    # reports motion.
                    _rdrift = evaluate_rotary_drift(
                        _bulk.published_rotary_seed, st.rotary_abc)
                    _rsettled = (
                        not st.current_vel
                        and rotary_drift_settled(
                            _bulk.rotary_check_prev, st.rotary_abc)
                    )
                    _bulk.rotary_check_prev = st.rotary_abc
                    if _rdrift and _rsettled:
                        _trace.emit("gcode.reparse_rotary_drift",
                                    reason=_rdrift,
                                    seed=_bulk.published_rotary_seed,
                                    live=st.rotary_abc)
                        _drift = _rdrift
                    elif _rdrift is None:
                        # Switchkins drift (fifth freshness input): the
                        # payload's segment modes start from the PARSE-time
                        # switchkins type (and, in TOOL kins, its plane
                        # frame). An M428/M430 or G53.x/G69 issued after
                        # load — or a program parking the machine in TOOL
                        # kins — makes that stale (the 855-unit class). A
                        # type/frame change is a discrete step (no settle
                        # needed); same idle gate and 2 s debounce.
                        _kdrift = evaluate_kins_drift(
                            _bulk.published_kins_seed, st.kins_type,
                            _live_kins_frame_of(st))
                        if _kdrift:
                            _trace.emit("gcode.reparse_kins_drift",
                                        reason=_kdrift,
                                        seed=_bulk.published_kins_seed,
                                        live=st.kins_type)
                            _drift = _kdrift
                        else:
                            # WCS-offset drift: a touch-off changes the
                            # offsets the payload's abc peel and soft-limit
                            # flags were baked with, with NO pose change —
                            # no other edge sees it (live-caught: Zero All
                            # on a tilted head wrote the rotary pose into
                            # G54's rotary offsets; the client re-added
                            # them onto the payload's unpeeled values and
                            # the sim posed A at double the real angle).
                            # Burst-settled: a multi-G10 Zero All reparses
                            # once, after the last write.
                            _wflat = wcs_offset_flat_from_table(
                                st.wcs_table, st.g92_offset)
                            _wdrift = evaluate_wcs_offset_drift(
                                _bulk.published_wcs_off, _wflat)
                            _wsettled = (_wflat is not None
                                         and _wflat == _bulk.wcsoff_check_prev)
                            _bulk.wcsoff_check_prev = _wflat
                            if _wdrift and _wsettled:
                                _trace.emit("gcode.reparse_wcsoff_drift",
                                            reason=_wdrift)
                                _drift = _wdrift
                elif _drift:
                    _trace.emit("gcode.reparse_tlo_drift", reason=_drift,
                                tool=st.tool_number)
                if _drift:
                    # The specific edge ("wcsoff:G54:x", "rotary:A", "kins:type",
                    # "tlo:…") is the reason the trace and the operator's
                    # banner carry — not the bare "drift" it used to be.
                    _bulk.schedule_refresh(st.active_file, _drift, _spawn_preview_task)
            elif not st.active_file and (_bulk.last_file is not None
                                         or _bulk.preview_available()):
                # Unload: one contract (clear_preview — it was dead code
                # diverged from an inline copy here). The preview_available
                # term keeps the branch reachable when the keys were cleared
                # by something other than an unload.
                _bulk.clear_preview()
                _bulk.reparse_pending = False

            # A reserved TWP fixture (G59..G59.3) active on identity kins at
            # boot — the previous session shut down (or aborted) in Plane
            # mode. The var file persisted #5220=6, so the DRO reads the
            # plane frame's TOOL-frame numbers on a machine that is not in
            # that frame. Banner now, restore G54 once the machine is ready.
            _reserved_fixture_heal_tick(st)

            # Safety-trip detection via the servo-thread HAL latch level
            # (webui-hb-latch.fault-out, issue #34). The latch is sticky and
            # owned by HAL — independent of both this poller and the watchdog
            # process — so reading it here survives gateway stalls AND watchdog
            # restarts: the level still reads TRUE on resume. evaluate_trip_latch
            # is a pure state machine (unit-tested in gateway_util) that edge-
            # detects a clean FALSE→TRUE only after a known-good baseline, so a
            # boot-faulted latch doesn't spuriously banner.
            global _last_fault_latched, _trip_baseline_seen, _unacked_trip
            _tl = evaluate_trip_latch(
                _reader_get("trip_latched"), _last_fault_latched, _trip_baseline_seen
            )
            _last_fault_latched = _tl["last_latched"]
            _trip_baseline_seen = _tl["baseline_seen"]
            if _tl["faulted_on_connect"]:
                # First-sight TRUE: boot-in-ESTOP or a trip while the gateway was
                # absent — ambiguous, so audit it but don't raise the banner (the
                # real ESTOP state is already shown via STAT).
                _trace.emit("safety.latch_faulted_on_connect", level="warn")
            if _tl["tripped"] and _unacked_trip is None:
                # No timestamp: the level is only read inside the status loop,
                # which doesn't run when no clients are connected, so "when the
                # gateway noticed" != "when the trip happened" and would mislead
                # operators. Drop it; the trace event below carries its own ts.
                _unacked_trip = {"reason": "hal_heartbeat_timeout"}
                _trace.emit("safety.tripped", level="error")
                # Auto-snapshot the trace bus into a forensic bundle so the trip
                # is reconstructable end-to-end without operator action. Run in
                # to_thread so the bundler subprocess can't block the asyncio
                # loop or the safety-trip status update.
                _trip_ts_ns = int(time.time_ns())
                asyncio.create_task(
                    asyncio.to_thread(_snapshot_trip, _trip_ts_ns)
                )

            # Cache results for per-client loops
            _shared_status = st
            _shared_status_dict = status_dict
            # Pre-encode the shared `data` dict into msgpack bytes once per tick so
            # each client's envelope encode can splice via msgspec.Raw instead of
            # re-encoding the identical payload N times. Only the `_use_shared`
            # path consumes it, and that path requires `not _STATUS_DELTA_ENABLED`
            # — so when delta mode is on (each client diffs+encodes its own frame)
            # this full-status encode every tick was pure wasted loop work. JSON
            # wire format has no Raw-splice primitive, so we skip there too.
            if _WIRE_FORMAT == "msgpack" and not _STATUS_DELTA_ENABLED:
                _set_phase("status_poller.shared_msgpack_encode")
                _t_enc = time.monotonic()
                _shared_status_data_msgpack = _msgpack_encoder.encode(status_dict)
                shared_encode_ms = round((time.monotonic() - _t_enc) * 1000, 2)
            else:
                _shared_status_data_msgpack = None
                shared_encode_ms = 0.0
            _set_phase("status_poller.build_clients_list")
            _shared_clients_list = [
                {"ip": c.ip, "armed": c.armed} for c in _clients.values()
            ]
            t3 = time.monotonic()
            _shared_errors = errs
            if errs:
                # Monotonic error counter: lets long-running sequences (RFL guard)
                # detect "did ANY error/abort surface during my window" even though
                # _shared_errors itself is replaced per tick.
                _errors_total += len(errs)
            _shared_probe_updates = probe_updates
            poll_ms = round((t1 - t0) * 1000, 2)
            errors_ms = round((t2 - t1) * 1000, 2)
            parse_ms = round((t3 - t2) * 1000, 2)
            cycle_ms = round((t3 - _cycle_start) * 1000, 2)
            # overhead = cycle - measured work (exact by construction).
            overhead_ms = round(cycle_ms - poll_ms - errors_ms - parse_ms, 2)
            _shared_timing = {
                "cycle_ms": cycle_ms,
                "overhead_ms": overhead_ms,
                "poll_ms": poll_ms,
                "errors_ms": errors_ms,
                "parse_ms": parse_ms,
                "shared_encode_ms": shared_encode_ms,
                "poller_ts": t3,
            }
            # Snapshot prior tick's aggregate before rolling gen. Silent under
            # normal load. wall_ms naturally ≈ heartbeat period (~33 ms at
            # 30 Hz active, ~200 ms at 5 Hz idle), so we only log on genuine
            # outliers: an unfinished client (done<expected → real stall),
            # a slow per-client send (send_max>20 ms), or wall_ms well above
            # the idle floor (>400 ms but still under the 500 ms HAL trip).
            _s = _status_tick_stats
            if _s["expected"] > 0:
                _wall_ms = (time.monotonic() - _s["tick_start"]) * 1000
                if (
                    _s["done"] < _s["expected"]
                    or _s["send_max"] > 20
                    or _wall_ms > 400
                ):
                    # Include this tick's poller-side breakdown so outliers
                    # show *where* the time went (poll vs encode vs send vs
                    # untracked overhead). Without these, a 510 ms wall_ms
                    # with 66 ms of encode+send leaves ~444 ms unexplained.
                    print(
                        f"[STATUS] tick gen={_s['gen']} "
                        f"clients={_s['done']}/{_s['expected']} "
                        f"poll_ms={poll_ms:.0f} "
                        f"errors_ms={errors_ms:.0f} "
                        f"parse_ms={parse_ms:.0f} "
                        f"overhead_ms={overhead_ms:.0f} "
                        f"shared_encode_ms={shared_encode_ms:.0f} "
                        f"encode_sum_ms={_s['encode_sum']:.0f} "
                        f"send_sum_ms={_s['send_sum']:.0f} "
                        f"send_max_ms={_s['send_max']:.0f} "
                        f"bytes_sum={_s['bytes_sum']} "
                        f"bytes_max={_s['bytes_max']} "
                        f"tool_meta_n={_s['tool_meta_count']} "
                        f"wall_ms={_wall_ms:.0f}",
                        flush=True,
                    )

            # Broadcast: swap in a fresh unset event for future waiters, then
            # set the old one to wake all current waiters. This avoids the
            # clear/set race where a client checking _status_gen between set()
            # and clear() could miss the wake-up.
            _status_gen += 1
            old_evt = _status_event
            _status_event = asyncio.Event()
            # Exclude hidden tabs from expected — they intentionally skip the
            # send loop, so counting them as "expected to finish" would flag
            # every tick as an outlier and spam the log. send_pending peers
            # stay in the count: if a send actually wedges across ticks, the
            # outlier log should still fire.
            _status_tick_stats.update({
                "gen": _status_gen,
                "tick_start": time.monotonic(),
                "expected": sum(1 for c in _clients.values() if not c.hidden),
                "done": 0, "encode_sum": 0.0, "send_sum": 0.0, "send_max": 0.0,
                "bytes_sum": 0, "bytes_max": 0, "tool_meta_count": 0,
            })
            if old_evt is not None:
                old_evt.set()

        except Exception as e:
            _poll_fails += 1
            if _poll_fails >= 5:
                lcnc_connected = False
                STAT = CMD = ERR = None
                _poll_fails = 0
                _trace.emit("poller.persistent_failure", level="warn",
                            exc=type(e).__name__, msg=str(e))

        # Adaptive sleep: subtract time already spent polling this cycle
        elapsed = time.monotonic() - _cycle_start

        # Experiment 4: adaptive poll rate — poll at IDLE_POLL_HZ when the
        # machine is idle (interp idle, not moving, no motion mode); full
        # POLL_HZ otherwise. Instant wake-up on idle→active transition keeps
        # first-motion latency at most one poll cycle, not one idle cycle.
        if _ADAPTIVE_POLL_ENABLED:
            _is_active = _poll_is_active(_shared_status, _reader_is_stale())
            if _is_active and not _was_active:
                # idle → active: skip the sleep, tick immediately
                _was_active = True
                continue
            _was_active = _is_active
            target_hz = POLL_HZ if _is_active else _IDLE_POLL_HZ
        else:
            target_hz = POLL_HZ

        await asyncio.sleep(max(0, (1.0 / target_hz) - elapsed))


def _start_status_poller():
    global _status_poller_task
    if _status_poller_task is None or _status_poller_task.done():
        _status_poller_task = register_bg_task(asyncio.get_event_loop().create_task(_status_poller()))


_reader_task: Optional[asyncio.Task] = None


def _start_reader_recv_loop():
    """Start the long-running webui-reader IPC client task once."""
    global _reader_task
    if _reader_task is None or _reader_task.done():
        _reader_task = register_bg_task(asyncio.get_event_loop().create_task(_reader_recv_loop()))


def _get_lcnc_pid() -> Optional[int]:
    """Return PID of linuxcncsvr if running, else None.
    Fast path: check /proc/<pid>/comm for known PID (<0.1ms).
    Slow path: pgrep subprocess only for initial discovery (~42ms).
    """
    # Fast path: verify known PID is still alive and correct process
    if _lcnc_pid is not None:
        try:
            with open(f"/proc/{_lcnc_pid}/comm") as f:
                if f.read().strip() == "linuxcncsvr":
                    return _lcnc_pid
        except FileNotFoundError:
            pass  # PID is stale — process exited, fall through to pgrep
        except OSError as e:
            # ENOENT is "process gone" (legit). Anything else (EACCES, EIO)
            # is unexpected on /proc and worth surfacing.
            _trace.emit("pid.proc_comm_read_failed", level="warn",
                        pid=_lcnc_pid, exc=type(e).__name__, msg=str(e))
    # Slow path: discover PID via pgrep (only when PID unknown or stale)
    try:
        result = subprocess.run(
            ['pgrep', '-x', 'linuxcncsvr'],
            capture_output=True, text=True, timeout=1,
        )
        if result.returncode == 0:
            return int(result.stdout.strip().split('\n')[0])
    except Exception as e:
        # rc != 0 from pgrep = "no match" (legit, returns None below). This
        # except catches subprocess raising (timeout, OSError, ValueError on
        # parse) — all worth surfacing.
        _trace.emit("pid.pgrep_failed", level="warn",
                    exc=type(e).__name__, msg=str(e))
    return None


def _nml_connectable() -> bool:
    """Test NML connectivity in a disposable subprocess.
    Prevents the main process from touching stale/unready NML."""
    try:
        result = subprocess.run(
            [sys.executable, "-c",
             "import linuxcnc; s=linuxcnc.stat(); s.poll(); print('OK')"],
            capture_output=True, text=True, timeout=5,
        )
        return result.returncode == 0 and "OK" in result.stdout
    except Exception:
        return False


# ---- NML poisoning detection ----
_reconnect_fails = 0
_ever_connected = False     # set True on first successful connection
_NML_POISON_THRESHOLD = 60  # consecutive probe-pass + main-fail = poisoned NML (single global poller)


def _self_restart():
    """Replace this process with a fresh gateway. Last resort for NML poisoning.

    os.execv atomically swaps the process image — no parent/child handoff
    window, no stale PID, file descriptors that aren't FD_CLOEXEC are
    inherited but the gateway re-opens its own HAL/socket state. Falls back
    to os._exit so the launcher can respawn if execv fails.
    """
    print("NML POISONED: self-restarting gateway process", flush=True)
    _hal_disconnect()
    try:
        os.execv(sys.executable, [sys.executable, "-m", "uvicorn"] + sys.argv[1:])
    except Exception as e:
        _trace.emit("restart.execv_failed", level="error",
                    exc=type(e).__name__, msg=str(e),
                    hint="exiting; launcher will respawn")
        os._exit(1)


def try_connect_lcnc() -> bool:
    """Attempt to connect to LinuxCNC. Returns True on success."""
    global STAT, CMD, ERR, lcnc_connected, _lcnc_pid, _nc_files_dir, _ini_config, _ever_connected, _kins_decl_cache
    global _machine_limits
    _nc_files_dir = None        # re-resolve on reconnect
    _ini_config = None          # re-read INI config on reconnect
    _machine_limits = None      # rebuild payload bounds on reconnect (#27)
    _kins_decl_cache = None     # re-parse kins declaration on reconnect
    _status_runtime.invalidate_var_file_path()  # re-resolve on reconnect (P2.1)
    if not _nml_connectable():
        return False
    try:
        STAT = linuxcnc.stat()
        CMD = linuxcnc.command()
        ERR = linuxcnc.error_channel()
        STAT.poll()  # verify it actually works
        lcnc_connected = True
        _ever_connected = True
        _lcnc_pid = _get_lcnc_pid()
        # Re-arm warn-once flags so a STAT field that disappears across a
        # reconnect produces a fresh log line instead of being suppressed.
        _status_runtime.reset_warn_flags()
        print(f"[VINIT] try_connect_lcnc OK, pid={_lcnc_pid}", flush=True)
        return True
    except Exception as e:
        print(f"[VINIT] try_connect_lcnc FAILED: {e}", flush=True)
        STAT = CMD = ERR = None
        lcnc_connected = False
        _lcnc_pid = None
        return False


def check_lcnc_instance() -> bool:
    """Check if linuxcncsvr PID changed. Returns True if reconnect needed."""
    global _lcnc_pid, lcnc_connected, _tool_tbl_path, _tool_tbl_ini
    pid = _get_lcnc_pid()
    if pid == _lcnc_pid:
        if pid is None and lcnc_connected:
            print(f"[VINIT] check_lcnc_instance: PID=None but was connected, resetting", flush=True)
            lcnc_connected = False
            _tool_tbl_path = None  # re-resolve on next connection
            _tool_tbl_ini = None
            return True
        return False
    # PID changed (appeared, disappeared, or different instance)
    old_pid = _lcnc_pid
    _lcnc_pid = pid
    _tool_tbl_path = None  # config may have changed, re-resolve from INI
    _tool_tbl_ini = None
    _status_runtime.invalidate_wcs_mtime()  # force WCS re-seed from var file on next poll
    if pid is None:
        print(f"[VINIT] check_lcnc_instance: PID gone (was {old_pid}), disconnecting", flush=True)
        lcnc_connected = False
        _hal_disconnect()
    else:
        print(f"[VINIT] check_lcnc_instance: PID changed {old_pid} -> {pid}", flush=True)
    return True


# ---- M2 runtime instance ----
# Injected deps are late-bound lambdas: STAT/ERR/_fb_scale rebind on reconnect /
# settings change, and load_tool_library is defined further down this module.
# Legacy names rebind to bound methods so the ~100 call sites read unchanged.
_status_runtime = _status_runtime_mod.StatusRuntime(
    get_stat=lambda: STAT,
    get_err=lambda: ERR,
    reader_get=_hal_bridge.reader_get,
    get_tool_tbl_path=lambda: get_tool_tbl_path(),
    load_tool_library=lambda: load_tool_library(),
    get_fb_scale=lambda: _fb_scale,
    get_kins_switchable=lambda: _kins_is_switchable(),
    # Raw W1 stamps (late-bound: _prov_cache is defined below). No
    # falsification pass — a hand-typed G10 under a reserved fixture is the
    # documented operator-caused escape.
    get_prov_a=lambda: [(_prov_cache.get(i) or {}).get("a") for i in range(1, 10)],
)
safe_get = _status_runtime.safe_get
normalize_homed = _status_runtime.normalize_homed
get_spindle_override = _status_runtime.get_spindle_override
poll_status = _status_runtime.poll_status
_poll_and_serialize = _status_runtime.poll_and_serialize
_poll_is_active = _status_runtime.poll_is_active
_stat_poll_timed = _status_runtime.stat_poll_timed
read_errors_nonblocking = _status_runtime.read_errors_nonblocking
_update_program_timer = _status_runtime.update_program_timer
_seed_wcs_cache = _status_runtime.seed_wcs_cache
_resolve_var_file_path = _status_runtime.resolve_var_file_path
_wcs_cache = _status_runtime.wcs_cache  # stable list — handlers mutate rows in place
to_float_list = _status_runtime_mod.to_float_list
_read_var_file = _status_runtime_mod.read_var_file
_write_var_file_updates = _status_runtime_mod.write_var_file_updates
_policy_state_from_payload = _status_runtime_mod.policy_state_from_payload


# Best-effort connection at startup (gateway still runs if LinuxCNC isn't up yet)
_trace.emit("boot.lcnc_connect_start")
if _get_lcnc_pid() is not None:
    _bt = time.monotonic()
    try_connect_lcnc()
    _trace.emit(
        "boot.lcnc_connect",
        dt_ms=round((time.monotonic() - _bt) * 1000, 1),
        connected=lcnc_connected,
    )
    if lcnc_connected:
        _bt = time.monotonic()
        _hal_connect()
        _trace.emit(
            "boot.hal_connect",
            dt_ms=round((time.monotonic() - _bt) * 1000, 1),
            sock_ok=_hal_bridge.watchdog_connected,
        )
else:
    _trace.emit("boot.lcnc_skip", reason="no linuxcncsvr pid")


# ---- NC files directory ----
# ALLOWED_EXTENSIONS now lives in gateway_util (imported at top).
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB (G-code can legitimately be this large)
# Fusion tool-library import (P1.2): json.loads holds the GIL in the worker thread
# (~6 ms/MB measured), so it can't be isolated from the heartbeat. Realistic
# libraries are <2 MB (<15 ms); cap at 16 MB (~100 ms worst case, sub-trip, machine
# idle during import) so a bogus 50 MB upload can't approach the watchdog budget.
MAX_TOOL_LIBRARY_SIZE = 16 * 1024 * 1024  # 16 MB
_nc_files_dir: Optional[str] = None
_nc_files_ini: Optional[str] = None   # INI identity the _nc_files_dir cache is keyed to
_ini_config: Optional[dict] = None


def get_max_jog_velocity() -> Optional[float]:
    """Return max jog velocity from INI (units/sec), cached."""
    return get_ini_config().get("max_jog_velocity")


_kins_decl_cache: Optional[dict] = None


def _parse_kins_decl() -> Optional[dict]:
    """Kins declaration ([KINS]KINEMATICS + [HAL]HALCMD pivot setp lines)
    from the running config's INI, cached until reconnect (the INI cannot
    change without a LinuxCNC restart). Shared by build_viewer_init
    (viewer_init.kins) and the extra-pins push (live switchkins sampling).
    STAT-dependent: returns None before LinuxCNC connects — never cached,
    so the first post-connect call parses for real."""
    global _kins_decl_cache
    if _kins_decl_cache is not None:
        return _kins_decl_cache
    ini_filename = getattr(STAT, "ini_filename", None) if STAT else None
    if not ini_filename:
        return None
    try:
        _kini = linuxcnc.ini(ini_filename)
        _kins_decl_cache = parse_kins_config(
            _kini.find("KINS", "KINEMATICS"),
            _kini.findall("HAL", "HALCMD") or [],
        )
    except Exception as e:
        _trace.emit_exc("viewer_init.kins_parse_failed", e)
    return _kins_decl_cache


_machine_limits: Optional[MachineLimits] = None
_var_numbers_cache: tuple = (None, None)   # (mtime, frozenset)

# Ceilings used when the INI declares none. These are exactly the literals the
# override handlers hardcoded before issue #27, so a silent INI keeps today's
# behavior — but the substitution is TRACED rather than invisible, and a builder
# who does declare a bound now has it enforced on the trusted side.
_OVERRIDE_FALLBACKS = {
    "max_feed_override": 2.0,
    "min_spindle_override": 0.5,
    "max_spindle_override": 2.0,
}


def _declared_var_numbers() -> Optional[frozenset]:
    """Var numbers this machine's var file declares, mtime-cached.

    The var file IS the machine's statement of which parameters are persistent
    and therefore configurable — the same "ask the machine, don't hardcode"
    rule the rest of the bounds follow. None when it cannot be read, which
    leaves set_probe_vars' key check to the system-range deny only."""
    global _var_numbers_cache
    try:
        ini_path = getattr(STAT, "ini_filename", None)
        if not ini_path:
            return None
        ini = linuxcnc.ini(ini_path)
        var_file = ini.find("RS274NGC", "PARAMETER_FILE")
        if not var_file:
            return None
        if not os.path.isabs(var_file):
            var_file = os.path.join(os.path.dirname(ini_path), var_file)
        mtime = os.path.getmtime(var_file)
        if _var_numbers_cache[0] == mtime:
            return _var_numbers_cache[1]
        nums = set()
        with open(var_file) as fh:
            for line in fh:
                tok = line.split()
                if tok:
                    try:
                        nums.add(int(tok[0]))
                    except ValueError:
                        pass
        result = frozenset(nums)
        _var_numbers_cache = (mtime, result)
        return result
    except (OSError, AttributeError) as e:
        _trace.emit("limits.var_file_unreadable", level="warn", err=str(e))
        return None


def get_machine_limits() -> MachineLimits:
    """Payload bounds this machine declares (issue #27), cached until reconnect.

    Built ONCE — axis/joint counts and INI ceilings do not change during a
    session — so the per-command validate_payload() pass costs a dict lookup,
    not a poll or a file read."""
    global _machine_limits
    if _machine_limits is not None:
        return _machine_limits
    cfg = get_ini_config()
    n_axes = n_joints = None
    try:
        STAT.poll()
        n_axes = len(_axes_from_mask(getattr(STAT, "axis_mask", 0) or 0)) or None
        n_joints = getattr(STAT, "joints", None) or None
    except Exception as e:  # STAT absent / not connected yet
        _trace.emit("limits.stat_unavailable", level="warn", err=str(e))
    missing = [k for k, v in _OVERRIDE_FALLBACKS.items() if cfg.get(k) is None]
    if missing:
        _trace.emit("limits.ini_fallback", level="warn", fields=missing,
                    msg="INI declares no override ceiling — using documented default")
    _machine_limits = MachineLimits(
        n_axes=n_axes,
        n_joints=n_joints,
        max_jog_velocity=cfg.get("max_jog_velocity"),
        max_spindle_speed=cfg.get("max_spindle_speed"),
        max_feed_override=cfg.get("max_feed_override") or _OVERRIDE_FALLBACKS["max_feed_override"],
        min_spindle_override=(cfg.get("min_spindle_override")
                              if cfg.get("min_spindle_override") is not None
                              else _OVERRIDE_FALLBACKS["min_spindle_override"]),
        max_spindle_override=(cfg.get("max_spindle_override")
                              or _OVERRIDE_FALLBACKS["max_spindle_override"]),
        max_linear_velocity=cfg.get("max_velocity") or cfg.get("max_linear_velocity"),
        declared_vars=_declared_var_numbers(),
    )
    return _machine_limits


def get_ini_config() -> dict:
    """Read static INI settings for the UI, cached until reconnect."""
    global _ini_config
    if _ini_config is not None:
        return _ini_config

    config: dict = {}
    if STAT is None:
        return config

    try:
        STAT.poll()
        ini_path = getattr(STAT, "ini_filename", None)
        if not ini_path:
            return config

        ini = linuxcnc.ini(ini_path)

        # Machine linear unit for increment conversion
        linear_unit = (ini.find("TRAJ", "LINEAR_UNITS") or "mm").strip().lower()

        # Ground truth velocity from trajectory planner (always u/s)
        traj_max = _ini_float(ini, "TRAJ", "MAX_LINEAR_VELOCITY")

        # Display velocity values (should be u/s, but some configs use u/min)
        disp_max = _ini_float(ini, "DISPLAY", "MAX_LINEAR_VELOCITY")
        disp_default = _ini_float(ini, "DISPLAY", "DEFAULT_LINEAR_VELOCITY")
        disp_min = _ini_float(ini, "DISPLAY", "MIN_LINEAR_VELOCITY")

        # Heuristic: if DISPLAY MAX is >10x TRAJ MAX, assume u/min → convert
        vel_divisor = 1.0
        if traj_max and disp_max and disp_max > traj_max * 10:
            vel_divisor = 60.0

        config["max_jog_velocity"] = (disp_max / vel_divisor) if disp_max else traj_max
        config["default_jog_velocity"] = (disp_default / vel_divisor) if disp_default else None
        config["min_jog_velocity"] = (disp_min / vel_divisor) if disp_min else None

        # Angular (rotary) jog velocity — always deg/s, no unit conversion
        ang_max = _ini_float(ini, "DISPLAY", "MAX_ANGULAR_VELOCITY")
        ang_default = _ini_float(ini, "DISPLAY", "DEFAULT_ANGULAR_VELOCITY")
        ang_min = _ini_float(ini, "DISPLAY", "MIN_ANGULAR_VELOCITY")
        config["max_angular_jog_velocity"] = ang_max
        config["default_angular_jog_velocity"] = ang_default
        config["min_angular_jog_velocity"] = ang_min

        # Machine native unit (for DRO labels, jog increments, etc.)
        config["linear_units"] = "in" if linear_unit in ("inch", "in", "imperial") else "mm"

        # Jog increments [DISPLAY]
        raw_incr = ini.find("DISPLAY", "INCREMENTS")
        config["increments"] = _parse_increments(raw_incr, linear_unit) if raw_incr else None

        # Spindle defaults [DISPLAY]
        config["default_spindle_speed"] = _ini_float(ini, "DISPLAY", "DEFAULT_SPINDLE_SPEED")
        config["min_spindle_override"] = _ini_float(ini, "DISPLAY", "MIN_SPINDLE_OVERRIDE")
        config["max_spindle_override"] = _ini_float(ini, "DISPLAY", "MAX_SPINDLE_OVERRIDE")

        # Feed override [DISPLAY]
        config["max_feed_override"] = _ini_float(ini, "DISPLAY", "MAX_FEED_OVERRIDE")

        # Debug mode [DISPLAY] — shows sim trip and other debug features in UI
        debug_raw = ini.find("DISPLAY", "DEBUG")
        config["debug"] = bool(int(debug_raw)) if debug_raw else False

        # Spindle speed limits — try SPINDLE_0 through SPINDLE_7
        # (LinuxCNC's EMCMOT_MAX_SPINDLES default; higher requires a rebuild)
        for i in range(8):
            section = f"SPINDLE_{i}"
            v = _ini_float(ini, section, "MAX_FORWARD_VELOCITY")
            if v is not None:
                config["max_spindle_speed"] = v
                config["min_spindle_speed"] = _ini_float(ini, section, "MIN_FORWARD_VELOCITY")
                config["spindle_increment"] = _ini_float(ini, section, "INCREMENT")
                break

        # Subroutine paths for probe macros [RS274NGC]SUBROUTINE_PATH
        sub_raw = ini.find("RS274NGC", "SUBROUTINE_PATH")
        if sub_raw:
            ini_dir = os.path.dirname(ini_path)
            sub_dirs = []
            for p in sub_raw.split(":"):
                # expanduser matches gateway_util.resolve_subroutine_dirs:
                # this config's entries are all `~/…` and were silently
                # dropped (probe-macro listing AND /subfile saw no dirs).
                p = os.path.expanduser(p.strip())
                if not p:
                    continue
                if not os.path.isabs(p):
                    p = os.path.join(ini_dir, p)
                p = os.path.realpath(p)
                if os.path.isdir(p):
                    sub_dirs.append(p)
            config["subroutine_paths"] = sub_dirs

        _ini_config = config
    except Exception as e:
        _trace.emit("ini.parse_failed", level="warn",
                    exc=type(e).__name__, msg=str(e))

    return config


def get_probe_macros() -> list:
    """List probe macro names from subroutine paths."""
    cfg = get_ini_config()
    paths = cfg.get("subroutine_paths", [])
    macros = []
    seen = set()
    for d in paths:
        try:
            for f in sorted(os.listdir(d)):
                if f.startswith("probe_") and f.endswith(".ngc") and f not in seen:
                    seen.add(f)
                    macros.append(f[:-4])  # strip .ngc
        except OSError:
            continue
    return macros


def get_nc_files_dir() -> str:
    """Return NC files directory from the LinuxCNC INI, fallback ~/linuxcnc/nc_files.

    Reads PROGRAM_PREFIX from LCNC_INI_FILE (exported by the launcher) — the same
    boot-independent source get_tool_tbl_path() uses — instead of STAT.ini_filename,
    so it never polls the NML status channel on the event loop and works before
    try_connect_lcnc succeeds (B4). Cached and keyed to the active INI so an INI
    change re-resolves; only a tiny INI parse on first use / INI change.
    """
    global _nc_files_dir, _nc_files_ini
    ini_path = os.environ.get("LCNC_INI_FILE")
    if _nc_files_dir is not None and ini_path == _nc_files_ini:
        return _nc_files_dir

    resolved = None
    if ini_path:
        try:
            ini = linuxcnc.ini(ini_path)
            prefix = ini.find("DISPLAY", "PROGRAM_PREFIX")
            if prefix:
                if not os.path.isabs(prefix):
                    prefix = os.path.join(os.path.dirname(ini_path), prefix)
                prefix = os.path.realpath(prefix)
                if os.path.isdir(prefix):
                    resolved = prefix
        except Exception as e:
            _trace.emit_exc("ini.nc_files_parse_failed", e, ini_path=ini_path)

    if resolved is None:
        resolved = os.path.expanduser("~/linuxcnc/nc_files")
        os.makedirs(resolved, exist_ok=True)

    _nc_files_dir = resolved
    _nc_files_ini = ini_path
    return _nc_files_dir


# ---- Tool Table ----
TOOL_LIBRARY_PATH = BASE_DIR / "tool_library.json"
_tool_tbl_path: Optional[str] = None
_tool_tbl_ini: Optional[str] = None
_tool_meta_dirty = False


def get_tool_tbl_path() -> Optional[str]:
    """Resolve the tool table file path from the LinuxCNC INI.

    Uses LCNC_INI_FILE (exported by the launcher) as the single source of
    truth — independent of the gateway↔LinuxCNC status connection, so this
    works during the boot window before `try_connect_lcnc` succeeds.
    """
    global _tool_tbl_path, _tool_tbl_ini
    ini_path = os.environ.get("LCNC_INI_FILE")
    if not ini_path:
        return None
    if _tool_tbl_path is not None:
        if ini_path != _tool_tbl_ini:
            _tool_tbl_path = None
            _tool_tbl_ini = None
        else:
            return _tool_tbl_path
    try:
        ini = linuxcnc.ini(ini_path)
        tbl = ini.find("EMCIO", "TOOL_TABLE")
        if not tbl:
            return None
        if not os.path.isabs(tbl):
            tbl = os.path.join(os.path.dirname(ini_path), tbl)
        tbl = os.path.realpath(tbl)
        if os.path.isfile(tbl):
            _tool_tbl_path = tbl
            _tool_tbl_ini = ini_path
            return _tool_tbl_path
    except Exception as e:
        _trace.emit_exc("tool_tbl.path_resolve_failed", e, ini_path=ini_path)
    return None


# parse_tool_table / write_tool_table / _merge_tool_data now live in
# tool_table.py, and atomic_write_bytes in gateway_util — both imported at top
# (gateway modularization, issue #33).


async def _reload_tool_table_and_bump():
    """Reload tool.tbl into LinuxCNC and bump the broadcast version.

    Status_loop sends `tool_table_changed` to every client whose
    `_last_tool_table_version` lags this counter, so a remote edit
    propagates within one tick instead of waiting for manual refresh.
    """
    global _tool_table_version
    if CMD:
        await _cmd_blocking(CMD.load_tool_table, wait=None)
    _tool_table_version += 1


async def _persist_imported_tools(tbl_path: str, tbl_tools: list, library: dict) -> None:
    """Persist a full tool-table replacement (the REST Fusion import) atomically
    w.r.t. every other tool / NML operation (issue #24).

    Serialized under `_cmd_lock` — not a separate lock — for two reasons: the WS
    tool handlers (save/add/delete/renumber) already serialize on it via
    `handle_command`, and the reload touches the NML command channel, whose
    thread-safety contract requires that lock. The REST import previously
    bypassed `_cmd_lock`, so it could both race those handlers on tool.tbl /
    tool_library.json (lost update) AND call `_cmd_blocking` without the lock.
    The blocking file writes run off the event loop via `run_in_executor`."""
    loop = asyncio.get_event_loop()
    async with _get_cmd_lock():
        await loop.run_in_executor(None, write_tool_table, tbl_path, tbl_tools)
        await _reload_tool_table_and_bump()
        await loop.run_in_executor(None, save_tool_library, library)


def _current_ini_path() -> str:
    """Return the current INI file path, or 'default' if unavailable."""
    if STAT and getattr(STAT, "ini_filename", None):
        return STAT.ini_filename
    return "default"


def _tool_lib_error(event: str, level: str, e: Exception) -> None:
    _trace.emit(event, level=level, path=str(TOOL_LIBRARY_PATH),
                exc=type(e).__name__, msg=str(e))


# tool_library.json persistence lives in tool_store.py (issue #33). The store
# owns the mtime cache + the strict refuse-to-clobber write; the current-INI key
# (_current_ini_path → STAT) and trace are injected. Thin wrappers below keep the
# existing call sites stable.
_tool_lib_store = ToolLibraryStore(TOOL_LIBRARY_PATH, _current_ini_path,
                                   on_error=_tool_lib_error)


def load_tool_library() -> dict:
    return _tool_lib_store.load()


def save_tool_library(library: dict):
    _tool_lib_store.save(library)


# _TOOL_META_FIELDS now lives in tool_table.py (imported at top, #33).


# ---- Server-Side Settings ----
SETTINGS_PATH = BASE_DIR / "settings.json"
_fb_scale = 60  # spindle feedback scale: 60 (RPS→RPM) or 1 (already RPM)
_spindle_load_pin = ""  # HAL pin for spindle load %, empty = disabled
_HAL_PIN_RE = re.compile(r'^[a-zA-Z0-9_][a-zA-Z0-9_.:-]*$')


def _settings_load_error(e: Exception) -> None:
    _trace.emit("settings.load_failed", level="warn",
                path=str(SETTINGS_PATH), exc=type(e).__name__, msg=str(e))


# settings.json persistence lives in settings_store.py (issue #33). The store
# owns the cache, RMW lock, refuse-to-clobber guard and version counter; the
# current-INI key (_current_ini_path → STAT) is injected. Thin wrappers below
# keep the existing call sites stable.
_settings_store = SettingsStore(SETTINGS_PATH, _current_ini_path,
                                on_load_error=_settings_load_error)


def load_settings() -> dict:
    return _settings_store.load()


def save_settings_section(section: str, data):
    _settings_store.save_section(section, data)


def reset_settings():
    _settings_store.reset()


# _merge_tool_data now lives in tool_table.py (imported at top, #33).




# sanitize_filename / validate_extension / validate_path_within now live in
# gateway_util (imported at top) so they're unit-testable without linuxcnc.


def _ini_float(ini, section: str, key: str):
    v = ini.find(section, key)
    if v is None:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _parse_increments(raw: str, linear_unit: str = "mm") -> List[float]:
    """Parse LinuxCNC INCREMENTS string into sorted machine-unit floats.

    Handles comma-separated ('1 mm, .01 in, 10 mil') or space-separated
    ('.01in .001in') formats, fractions ('1/8000 in'), and unit suffixes.
    Converts to machine units based on LINEAR_UNITS from [TRAJ].
    """
    is_metric = linear_unit in ("mm", "metric")
    if is_metric:
        unit_factors = {
            "mm": 1.0, "cm": 10.0, "um": 0.001,
            "in": 25.4, "inch": 25.4, "mil": 0.0254,
        }
    else:
        unit_factors = {
            "in": 1.0, "inch": 1.0, "mil": 0.001,
            "mm": 1.0 / 25.4, "cm": 10.0 / 25.4, "um": 0.001 / 25.4,
        }

    _num_unit_re = re.compile(
        r'([0-9]*\.?[0-9]+(?:/[0-9]+)?)\s*(mm|cm|um|inch|in|mil)?',
        re.IGNORECASE,
    )

    # Split by comma if commas present, else by whitespace
    entries = [e.strip() for e in raw.split(",")] if "," in raw else raw.split()

    result = []
    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue
        m = _num_unit_re.search(entry)
        if not m:
            continue
        num_str, unit = m.group(1), (m.group(2) or "").lower()
        try:
            if "/" in num_str:
                n, d = num_str.split("/", 1)
                val = float(n) / float(d)
            else:
                val = float(num_str)
        except (ValueError, ZeroDivisionError):
            continue
        if val <= 0:
            continue
        factor = unit_factors.get(unit, 1.0)  # no unit = machine units
        result.append(round(val * factor, 6))

    result.sort()
    return result


def read_machine_limits_from_ini(stat_obj):
    """
    Returns (origin_xyz, size_xyz) from the *active* LinuxCNC INI.

    origin = [xmin, ymin, zmin]
    size   = [xmax-xmin, ymax-ymin, zmax-zmin]
    """
    ini_path = getattr(stat_obj, "ini_filename", None)
    if not ini_path:
        return None

    ini = linuxcnc.ini(ini_path)

    def axis_limits(axis_letter: str, joint_idx: int):
        # Prefer AXIS_X/Y/Z
        sec_axis = f"AXIS_{axis_letter}"
        mn = _ini_float(ini, sec_axis, "MIN_LIMIT")
        mx = _ini_float(ini, sec_axis, "MAX_LIMIT")

        # Fallback to JOINT_*
        if mn is None or mx is None:
            sec_joint = f"JOINT_{joint_idx}"
            mn = _ini_float(ini, sec_joint, "MIN_LIMIT")
            mx = _ini_float(ini, sec_joint, "MAX_LIMIT")

        if mn is None or mx is None:
            return None
        return (mn, mx)

    xl = axis_limits("X", 0)
    yl = axis_limits("Y", 1)
    zl = axis_limits("Z", 2)
    if not xl or not yl or not zl:
        return None

    xmin, xmax = xl
    ymin, ymax = yl
    zmin, zmax = zl

    origin = [xmin, ymin, zmin]
    size = [xmax - xmin, ymax - ymin, zmax - zmin]
    return origin, size


async def _cmd_blocking(cmd_fn, *args, wait=_CMD_WAIT_TIMEOUT) -> int:
    """Run a blocking CMD.* call + optional wait_complete() on a worker thread.

    Every `CMD.* + wait_complete()` pair must go through here. Returns
    wait_complete()'s int result — linuxcnc.RCS_DONE (1) on success,
    linuxcnc.RCS_ERROR (3) when the command was rejected, -1 on timeout,
    _RC_WAIT_CANCELLED (-2) when the wait was abandoned on cancel — or 0
    when wait=None. (An earlier version of this docstring said "0 ok, 1
    failed", which is not the API: the first rc check written against it
    counted every success as a failure. Use _cmd_rc_failed.)

    GIL fact (2.9.4 emcmodule.cc, verified 2026-09-05): the binding's
    wait_complete() is a C poll loop that esleep()s WITHOUT releasing the
    GIL — `asyncio.to_thread` isolates nothing for that half; a
    wait_complete(30) would freeze the event loop (heartbeat task, status
    loop) for as long as the command ran. Live it never showed because every
    awaited command so far completes in ms. So the wait runs in
    _CMD_WAIT_SLICE slices: repeated wait_complete(t) calls re-poll the same
    stored serial (N slices ≡ one long wait to 10 ms), each return lets the
    loop breathe, and a cancel lands after the current slice. The command
    WRITE `cmd_fn(*args)` is never interrupted.

    Caller must hold `_cmd_lock` — NML command channel is not thread-safe.
    """
    cancel = threading.Event()

    def _run():
        cmd_fn(*args)
        if wait is None:
            return 0
        deadline = time.monotonic() + float(wait)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return -1
            rc = CMD.wait_complete(min(_CMD_WAIT_SLICE, remaining))
            if rc != -1:
                return rc
            if cancel.is_set():
                return _RC_WAIT_CANCELLED
    # Shield-and-wait (2026-09-03): the caller holds _cmd_lock via `async
    # with`, which RELEASES on CancelledError — but a thread cannot be
    # cancelled, so a plain `await to_thread()` would free the lock while
    # CMD.mdi / wait_complete is still running on the thread, and the next
    # holder (the disconnect jog-stop, another client's worker) would call
    # NML concurrently — the corruption the lock exists to prevent. Handlers
    # are cancellable (disconnect, abort/estop preemption), so on cancel we
    # flag the slice loop, keep the lock until the thread actually returns
    # (bounded by one slice + one NML call), then propagate. asyncio.wait
    # retrieves the inner result so nothing is reported as never-retrieved.
    inner = asyncio.ensure_future(asyncio.to_thread(_run))
    try:
        return await asyncio.shield(inner)
    except asyncio.CancelledError:
        cancel.set()
        await asyncio.wait({inner})
        raise


_MODE_NAMES = {1: "MANUAL", 2: "AUTO", 3: "MDI"}


async def set_mode(mode: int):
    """Switch LinuxCNC task mode. Caller must hold `_cmd_lock`.

    A refused or timed-out switch RAISES (ValueError → the dispatcher's
    bounded ok:false reply). It used to discard the rc while nine other
    call sites checked theirs — a handler then issued its MDI into the
    wrong mode and reported ok (2026-09-04)."""
    STAT.poll()
    if safe_get("task_mode", None) == mode:
        if mode in (linuxcnc.MODE_MDI, linuxcnc.MODE_AUTO):
            _active_jogs.clear()   # task cannot be in MDI/AUTO with a jog active
        return
    rc = await _cmd_blocking(CMD.mode, mode)
    if _cmd_rc_failed(rc):
        _trace.emit("task.mode_switch_refused", level="warn", mode=mode, rc=rc)
        raise ValueError(f"LinuxCNC refused the mode switch to {_MODE_NAMES.get(mode, mode)} (rc={rc})")
    # rc DONE does not mean the mode changed: emcTaskSetMode IGNORES the
    # request while a jog is active ("Ignoring task mode change while jogging",
    # an operator error, rc still DONE) — the handler then issued its MDI into
    # MANUAL, LinuxCNC answered "Must be in MDI mode", and the reply was ok
    # (2026-09-05, → Zero pressed while the A jog was still held). Verify the
    # mode actually took; a stat without task_mode (the test binding) cannot
    # be verified and is not treated as a failure.
    STAT.poll()
    actual = safe_get("task_mode", None)
    if actual is not None and actual != mode:
        _trace.emit("task.mode_switch_ignored", level="warn", mode=mode, actual=actual,
                    msg="task ignored the mode switch (a jog is active?)")
        raise ValueError(
            f"LinuxCNC ignored the mode switch to {_MODE_NAMES.get(mode, mode)} "
            f"(task stays {_MODE_NAMES.get(actual, actual)}) — a jog is still active: "
            f"release the jog, then try again")
    if mode in (linuxcnc.MODE_MDI, linuxcnc.MODE_AUTO):
        _active_jogs.clear()   # the switch took (or is unverifiable): no jog is active


def _jog_stop_would_abort_mdi(mode, interp, cmd: str) -> bool:
    """A jog-stop arriving while an MDI EXECUTES: no jog can be in flight
    (jogging requires MANUAL), and forcing MANUAL runs LinuxCNC's
    mdi_execute_abort — the → Zero move stopped wherever it was when the
    operator lifted the finger off the A jog (2026-09-04, "sometimes it
    doesn't"). Skip the switch, say so in the trace, never silently."""
    if mode == linuxcnc.MODE_MDI and interp != linuxcnc.INTERP_IDLE:
        _trace.emit("jog.stop_skipped_mdi_busy", level="info", cmd=cmd, interp_state=interp)
        return True
    return False

def reject_if_auto_running() -> Optional[Dict[str, Any]]:
    STAT.poll()
    mode = safe_get("task_mode", None)
    interp = safe_get("interp_state", None)

    # If we're in AUTO and interpreter isn't idle, don't allow mode switches / jog / mdi
    if mode == linuxcnc.MODE_AUTO and interp != linuxcnc.INTERP_IDLE:
        return {
            "ok": False,
            "error": "Busy in AUTO (interpreter not IDLE) — command rejected",
            "task_mode": mode,
            "interp_state": interp,
        }
    # MDI commands are fire-and-forget — guard against overlapping commands
    if mode == linuxcnc.MODE_MDI and interp != linuxcnc.INTERP_IDLE:
        return {
            "ok": False,
            "error": "MDI command in progress — command rejected",
            "task_mode": mode,
            "interp_state": interp,
        }
    return None



def _spawn_preview_task(coro):
    """spawn callable for BulkPipeline.schedule_refresh — the gateway's
    background-task registry + loop, kept out of bulk_pipeline."""
    task = asyncio.create_task(coro)
    register_bg_task(task)
    return task


def _jog_joint_flag() -> int:
    """Return the joint_flag for CMD.jog() based on current trajectory mode.
    0 = Cartesian axis (TRAJ_MODE_TELEOP), 1 = joint (TRAJ_MODE_FREE, safe default)."""
    STAT.poll()
    if safe_get("motion_mode", None) == linuxcnc.TRAJ_MODE_TELEOP:
        return 0
    return 1


def _trace_jog(cmd: str, axis: int, jf: int, **extra) -> None:
    """One `jog.cmd` event per NEW jog (never per stop): what was issued and
    what task/motion looked like at that instant. A jog that "did nothing"
    (matrix, 2026-09-05: jog_cont A, no disarm, no refusal, A never moved)
    is undiagnosable without it."""
    STAT.poll()
    _trace.emit("jog.cmd", level="info", cmd=cmd, axis=axis, jf=jf,
                arg=_jog_axis_arg(axis, jf),
                task_mode=safe_get("task_mode", None), motion_mode=safe_get("motion_mode", None),
                interp=safe_get("interp_state", None), **extra)


async def _jog_mode_flag() -> int:
    """joint_flag for a NEW jog, after putting motion in the right mode.

    While any joint sits outside its own soft-limit window (status
    `joints_beyond_limit`, see gateway_util.joints_beyond_limits) motion
    refuses every world-mode move — teleop jogs and MDI alike — and LinuxCNC's
    own hint is "switch to joint mode to jog off soft limit". So: beyond →
    FREE (joint) mode, jog the joint; back inside and homed → TELEOP again.
    Both transitions are traced. jog_stop never switches mode (a stop must
    address the jog that is running): it keeps using _jog_joint_flag()."""
    STAT.poll()
    beyond = getattr(_shared_status, "joints_beyond_limit", None) or []
    teleop = safe_get("motion_mode", None) == linuxcnc.TRAJ_MODE_TELEOP
    if beyond:
        if teleop:
            rc = await _cmd_blocking(CMD.teleop_enable, 0, wait=2)
            _trace.emit("jog.joint_mode_beyond_limit", level="warn", joints=list(beyond),
                        rc=rc, msg="joint(s) outside their soft-limit window — jogging in joint mode")
        return 1
    if not teleop and bool(getattr(_shared_status, "homed", False)):
        rc = await _cmd_blocking(CMD.teleop_enable, 1, wait=2)
        _trace.emit("jog.teleop_restored", level="info", rc=rc)
        STAT.poll()
        if safe_get("motion_mode", None) == linuxcnc.TRAJ_MODE_TELEOP:
            return 0
        return 1
    return 0 if teleop else 1


def _jog_axis_arg(idx: int, jf: int) -> int:
    """Translate a wire jog index into what CMD.jog expects for joint_flag jf.

    The wire index is the position in the machine's axis list — the same
    index viewer_init.axes and every per-axis status array use. For jf==1
    (joint jog) that IS the joint number (trivkins joints follow the
    COORDINATES order). For jf==0 (teleop) LinuxCNC wants the CANONICAL
    axis number (X=0 … W=8) — a different space whenever the machine's
    axis set has gaps: on XYZAC, C is list index 4 but canonical 5, so the
    untranslated index jogged nonexistent B and silently moved nothing
    (WS-D 5-axis user smoke; the disarm jog-stop missed C the same way).
    Out-of-range indices pass through — CMD.jog rejects them itself."""
    if jf != 0:
        return idx
    letters = _axes_from_mask(int(safe_get("axis_mask", 0) or 0))
    if 0 <= idx < len(letters):
        canonical = _AXIS_LETTERS.find(letters[idx])
        if canonical >= 0:
            return canonical
    return idx


async def _jog_stop_for_client() -> None:
    """Jog-stop every joint as part of a client disarm. Caller must hold _cmd_lock.

    Called when a client transitions to disarmed via heartbeat stall or WS
    close. The point is to stop any in-flight jog this client may have
    started — without a follow-up jog_stop the machine continues moving
    until it hits a limit.

    This function does NOT abort the program. A running G-code program is
    owned by LinuxCNC's interpreter, not by any single client. Motion abort
    from a client-liveness failure is the HAL chain's job (oneshot timeout
    on all-clients-out, or gateway hang). Per the architecture review in
    docs/plans, keep the "armed = authorization" and "HAL = safety" layers
    separate — this function only handles the in-flight-jog case.

    Mode safety: if the machine is in MODE_AUTO with the interpreter
    running, a jog cannot be in flight (jogging requires MANUAL/TELEOP).
    Forcing a mode switch to MANUAL here would interrupt the program —
    exactly what this cleanup is trying to avoid. So skip in that case.

    Multi-armed-client note: today we stop every joint, which can interfere
    with a parallel jog from another armed client. Per-client active-jog
    tracking is a documented follow-up; for now, the bluntness is acceptable
    because simultaneous multi-client jogging is rare and stopping is the
    safe default.
    """
    if not bool(safe_get("enabled", False)):
        return
    if not _active_jogs:
        # The gateway started no jog that is still running: nothing to stop,
        # and a forced MANUAL here is what aborted a fresh MDI on a disarm
        # (2026-09-03 follow-up, closed by construction).
        _trace.emit("jog.stop_for_client_noop", level="info")
        return
    STAT.poll()
    mode = safe_get("task_mode", None)
    interp = safe_get("interp_state", None)
    if mode == linuxcnc.MODE_AUTO and interp != linuxcnc.INTERP_IDLE:
        return  # program running — no jog to stop, must not switch mode
    homed = normalize_homed(safe_get("homed", None))
    if not homed:
        return  # nothing to jog-stop if not homed
    if _jog_stop_would_abort_mdi(mode, interp, "jog_stop_for_client"):
        return  # an MDI is executing — no jog can be in flight; a mode switch would abort it
    await set_mode(linuxcnc.MODE_MANUAL)
    jf = _jog_joint_flag()
    for ax in sorted(_active_jogs):
        await _cmd_blocking(CMD.jog, linuxcnc.JOG_STOP, jf, _jog_axis_arg(ax, jf), wait=None)
    _active_jogs.clear()


def require_armed(armed: bool):
    if not armed:
        raise PermissionError("Not armed")


def require_no_eoffset():
    """Mirror the frontend probe/zero gate (issue #19): refuse a touch-off / work
    offset edit while surface-compensation Z eoffset is active, or LinuxCNC would
    bake the eoffset into the new offset (the current position the offset is
    derived from is contaminated). LinuxCNC itself doesn't enforce this web-UI
    gate, so a direct client could otherwise bypass it. Mirrors the frontend's
    `!eoffsetEnabled` condition: only blocks when the pin is definitely enabled
    (None/stale → allowed, matching the UI)."""
    if _reader_get("z_eoffset_enable"):
        raise PermissionError("Surface compensation active — clear the eoffset before editing work offsets")


def require_no_rotary_tilt():
    """Refuse to ENABLE surface-map Z compensation while a rotary axis is off
    zero.

    The map is a machine-Z shim applied AFTER kinematics: it is only valid with
    the tool normal to the mapped surface (A=0) and the map's XY grid aligned to
    the work (C=0 — the map does not ride the platter). Applying it tilted
    shifts Z in the wrong direction. TWP support made tilted work a first-class
    thing this machine can do, so this became reachable.

    Only the ENABLE direction is guarded — turning compensation OFF while tilted
    is the safe direction and must never be blocked. Refuses when the reading is
    absent (`is True` test), because a gate that cannot see the rotaries must
    not assume they are parked."""
    if not (_shared_status is not None and _shared_status.rotary_at_zero is True):
        raise PermissionError(
            "Rotary axis not at zero — surface-map Z compensation is a 3-axis "
            "feature (the map does not tilt or ride the platter)")


def require_tool_change_pending():
    """Refuse a manual-toolchange confirmation when iocontrol is not asking for
    one.

    `confirm_tool_change` asserts `tool-changed` into HAL, which tells LinuxCNC
    the operator has physically swapped the tool. Machine STATE cannot express
    the real precondition — the machine may legitimately be idle, running or
    paused at M6 — so the gate is the request pin itself: no pending request
    means the confirmation is meaningless at best and desynchronises the
    toolchange handshake at worst.

    Same None/stale convention as require_no_eoffset(): only blocks when the pin
    DEFINITELY says no change is pending (`is False`), so an absent or stale
    reader snapshot allows the command rather than stranding an operator
    mid-change."""
    if _reader_get("tool_change") is False:
        raise PermissionError("No tool change pending")


# ---- Run-from-line toolchange guard (RFL × M600) ----
# LinuxCNC's run-from-line skim re-enters M600 remap bodies in lines 1..N-1:
# G38 probes are queue-busters and execute for REAL while plain moves are
# discarded, and the routine's G43 does not survive into the synthesized state
# (no TLO at cycle start — Z-crash risk on hardware). Guard sequence: measure
# the tool via MDI first (full routine: real retract + G43 applied), arm the
# one-shot #3116 skip flag (tool_touch_off.ngc o<450> no-ops under the skim,
# re-issuing only the modal G43), then AUTO_RUN. Runs as a BACKGROUND task:
# the measurement takes minutes and handle_command holds _cmd_lock for its
# whole body — running it inline would freeze every client's commands (incl.
# Abort) and starve this client's heartbeat. Each CMD step takes the lock
# individually; completion waits poll STAT lock-free. Progress is broadcast
# via the status fanout (rfl_status field), single-flight via _rfl_active.
_rfl_active: bool = False
_rfl_status: Optional[dict] = None   # last guard-sequence phase, riding the status fanout


async def _rfl_wait_interp_idle(timeout_s: float, grace_s: float = 2.0):
    """Wait until the interpreter is idle again after a fire-and-forget MDI.

    Completion = interp observed non-idle then idle again, OR never observed
    non-idle within the grace window while idle (instant commands like
    parameter assignments can finish between polls). Lock-free: only STAT
    reads. Returns (ok, reason)."""
    t0 = time.monotonic()
    deadline = t0 + timeout_s
    started = False
    while time.monotonic() < deadline:
        try:
            STAT.poll()
        except Exception as e:
            return False, f"STAT.poll failed: {e}"
        if safe_get("task_state", None) != linuxcnc.STATE_ON:
            return False, "machine left ON state (estop/off)"
        interp = safe_get("interp_state", None)
        if interp != linuxcnc.INTERP_IDLE:
            started = True
        elif started or (time.monotonic() - t0) > grace_s:
            return True, ""
        await asyncio.sleep(0.1)
    return False, f"timeout after {timeout_s:.0f}s"


async def _rfl_mdi_step(text: str, timeout_s: float):
    """One locked MDI dispatch + lock-free completion wait. Returns (ok, reason)."""
    async with _get_cmd_lock():
        blocked = reject_if_auto_running()
        if blocked:
            return False, blocked.get("error", "busy")
        await set_mode(linuxcnc.MODE_MDI)
        await _cmd_blocking(CMD.mdi, text, wait=None)
    return await _rfl_wait_interp_idle(timeout_s)


def _rfl_phase(phase: str, ok: bool = True, error: str = "") -> None:
    global _rfl_status
    _rfl_status = {"phase": phase, "ok": ok, "error": error, "ts": int(time.time() * 1000)}
    _trace.emit("rfl.phase", level="info" if ok else "warn",
                phase=phase, ok=ok, error=error)


_RFL_WCS_OK = {"G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"}


def _rfl_entry_mdi(entry: dict) -> str:
    """Compose the position-preamble MDI line: optional units + WCS prefixes
    (matching what the program will use at line N), forced G90, rapid to the
    derived XY. Axes the scan couldn't determine are simply omitted (modal)."""
    parts = []
    if entry.get("units"):
        parts.append(entry["units"])
    if entry.get("wcs"):
        parts.append(entry["wcs"])
    parts.append("G90 G0")
    if entry.get("x") is not None:
        parts.append(f"X{entry['x']:.4f}")
    if entry.get("y") is not None:
        parts.append(f"Y{entry['y']:.4f}")
    return " ".join(parts)


def _rfl_entry_reached(entry: dict):
    """Verify the preamble move actually landed (an abort mid-move leaves the
    interp idle with no error text). Compares machine position against the WCS
    target + active g5x/g92 offsets — valid because the scan REFUSES rotation/
    G92-mutating programs. Returns (ok, reason)."""
    STAT.poll()
    g5x = safe_get("g5x_offset", None) or (0.0,) * 9
    g92 = safe_get("g92_offset", None) or (0.0,) * 9
    pos = safe_get("position", None)
    if not pos:
        return False, "no position from STAT"
    mu = get_machine_units()
    scale = 1.0
    if entry.get("units") == "G20" and mu == "mm":
        scale = 25.4
    elif entry.get("units") == "G21" and mu == "in":
        scale = 1.0 / 25.4
    tol = 0.5 if mu == "mm" else 0.02
    for key, i in (("x", 0), ("y", 1)):
        val = entry.get(key)
        if val is None:
            continue
        expected = finite_float(val) * scale + float(g5x[i]) + float(g92[i])
        if abs(float(pos[i]) - expected) > tol:
            return False, f"{key.upper()} at {float(pos[i]):.3f}, expected {expected:.3f}"
    return True, ""


async def _rfl_sequence(start_line: int, pre_tool: int, safe_z: bool,
                        spindle_dir: Optional[str], spindle_speed: int,
                        entry: Optional[dict] = None) -> None:
    global _rfl_active
    flag_armed = False
    try:
        if pre_tool:
            _rfl_phase("measuring")
            err_mark = _errors_total
            ok, why = await _rfl_mdi_step(f"T{pre_tool} M600", timeout_s=240.0)
            if not ok:
                _rfl_phase("measure_failed", False, why)
                return
            STAT.poll()
            tofs = safe_get("tool_offset", None)
            applied = abs(float(tofs[2])) if tofs else 0.0
            if safe_get("tool_in_spindle", None) != pre_tool or applied <= 1e-9:
                _rfl_phase("measure_failed", False,
                           f"verification failed (tool={safe_get('tool_in_spindle', None)}, applied Z={applied:.4f})")
                return
            if _errors_total != err_mark:
                # An error (or operator abort → probe-interrupted error) surfaced
                # during the measurement window — refuse to continue into motion.
                _rfl_phase("measure_failed", False, "errors during measurement (aborted?)")
                return
            ok, why = await _rfl_mdi_step(f"#3116={pre_tool}", timeout_s=10.0)
            if not ok:
                _rfl_phase("flag_failed", False, why)
                return
            flag_armed = True
        if safe_z:
            _rfl_phase("safe_z")
            # "Safe Z" = at or above machine Z0 (the controlled point, TLO
            # included — the frame G53 addresses; stat.position IS
            # motion.traj.position, the value the interp synchs #<_abs_z>
            # from). Never LOWER Z to get there: on a config whose Z window
            # extends above 0 (the TWP sim before its limits were narrowed) a
            # bare G53 Z0 from above was a descent (2026-09-04). Same
            # predicate as the #<_abs_z> guard in go_to_zero/home/g30.ngc.
            STAT.poll()
            pos = safe_get("position", None)
            z_now = float(pos[2]) if pos else None
            if z_now is not None and z_now >= 0.0:
                _trace.emit("rfl.safe_z_already_above", z=round(z_now, 3))
            else:
                ok, why = await _rfl_mdi_step("G53 G0 Z0", timeout_s=120.0)
                if not ok:
                    _rfl_phase("safe_z_failed", False, why)
                    return
                STAT.poll()
                pos = safe_get("position", None)
                if pos and float(pos[2]) < -0.5:
                    # Move ended early (an abort mid-move leaves interp idle
                    # with no error text) — machine is BELOW safe height;
                    # refuse to start.
                    _rfl_phase("safe_z_failed", False,
                               f"Z did not reach safe height (at {float(pos[2]):.2f}, needs >= 0)")
                    return
        if entry and (entry.get("x") is not None or entry.get("y") is not None):
            # Position preamble: rapid to the XY the program expects at line N
            # (at safe height — the handler forces safe_z on whenever entry is
            # given), so the RFL entry's modal Y/Z moves run at the RIGHT X/Y
            # instead of wherever the machine happens to stand.
            _rfl_phase("positioning")
            ok, why = await _rfl_mdi_step(_rfl_entry_mdi(entry), timeout_s=120.0)
            if not ok:
                _rfl_phase("positioning_failed", False, why)
                return
            ok, why = _rfl_entry_reached(entry)
            if not ok:
                _rfl_phase("positioning_failed", False, why)
                return
        if spindle_dir and spindle_speed > 0:
            async with _get_cmd_lock():
                await set_mode(linuxcnc.MODE_MANUAL)
                if spindle_dir == "forward":
                    await _cmd_blocking(CMD.spindle, linuxcnc.SPINDLE_FORWARD, spindle_speed, wait=None)
                elif spindle_dir == "reverse":
                    await _cmd_blocking(CMD.spindle, linuxcnc.SPINDLE_REVERSE, spindle_speed, wait=None)
        _rfl_phase("starting")
        async with _get_cmd_lock():
            await set_mode(linuxcnc.MODE_AUTO)
            await _cmd_blocking(CMD.auto, linuxcnc.AUTO_RUN, start_line, wait=None)
        flag_armed = False  # consumed by the skim (o<450> self-clears #3116)
        _rfl_phase("running")
    except Exception as e:
        _trace.emit_exc("rfl.sequence_failed", e)
        _rfl_phase("failed", False, f"{type(e).__name__}: {e}")
    finally:
        if flag_armed:
            # Never leave a stale skip flag behind — it could silently skip a
            # legitimate future measurement. Best-effort clear, loud on failure.
            ok, why = await _rfl_mdi_step("#3116=0", timeout_s=10.0)
            if ok:
                _trace.emit("rfl.flag_cleared")
            else:
                _trace.emit("rfl.flag_clear_failed", level="error", err=why)
        _rfl_active = False


async def handle_command(msg: Dict[str, Any], armed: bool):
    # Acquire the CMD lock before dispatching. Every path that touches CMD.*
    # must hold this lock; see _cmd_lock docstring.
    async with _get_cmd_lock():
        return await _handle_command_impl(msg, armed)


async def _handle_command_impl(msg: Dict[str, Any], armed: bool):
    global _estop_hold, _rfl_active
    cmd = msg.get("cmd")
    if not cmd:
        return {"ok": False, "error": "Missing cmd"}

    # ---- Read-only commands (no LinuxCNC connection or arming needed) ----
    try:
        if cmd == "get_tool_table":
            tbl_path = get_tool_tbl_path()
            if not tbl_path:
                return {"ok": False, "error": "Tool table path not available"}
            tbl_tools = await asyncio.to_thread(parse_tool_table, tbl_path)  # file reads off the loop (B3)
            library = await asyncio.to_thread(load_tool_library)
            merged = _merge_tool_data(tbl_tools, library)
            current_tool = None
            try:
                if STAT:
                    STAT.poll()
                    raw = safe_get("tool_in_spindle", None)
                    current_tool = int(raw) if raw is not None else None
            except (AttributeError, ValueError, TypeError, linuxcnc.error) as e:
                _trace.emit("tools.current_tool_poll_failed", level="warn",
                            exc=type(e).__name__, msg=str(e))
            return {"ok": True, "tools": merged, "current_tool": current_tool}

        if cmd == "get_probe_results":
            pts = await asyncio.to_thread(_bulk.read_probe_results_file)
            return {"ok": True, "points": pts}

        if cmd == "get_comp_grid":
            ini_path = getattr(STAT, "ini_filename", None)
            config_dir = os.path.dirname(ini_path) if ini_path else ""
            path = os.path.join(config_dir, "probe-results-grid.json")
            if not os.path.isfile(path):
                return {"ok": False, "error": "No grid file"}

            def _load_grid():
                with open(path, "r") as f:
                    try:
                        return json.load(f), None
                    except (json.JSONDecodeError, ValueError):
                        return None, "Invalid grid file"

            grid, err = await asyncio.to_thread(_load_grid)
            if err:
                return {"ok": False, "error": err}
            return {"ok": True, "comp_grid": grid}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    if not lcnc_connected:
        return {"ok": False, "error": "LinuxCNC not connected"}

    # Backend command authorization (issue #19). Enforces the SAME unified policy
    # the frontend consumes (command_policy). Because the frontend's Gate/fire()
    # layer already gates on these exact classes, this never rejects a
    # conforming-UI command — it backstops direct / buggy / malicious clients.
    # 'always' commands (jog_stop, estop, abort, …) pass. The handler-level
    # require_armed()/reject_if_auto_running() guards remain as defense in depth.
    # Denials are bounded + traced — never silently dropped
    # (feedback_no_silent_fallbacks).
    if _shared_status is not None:
        _deny = check_command(cmd, _policy_state_from_payload(
            _shared_status, armed, kins_switchable=_kins_is_switchable()))
        if _deny is not None:
            _trace.emit("ws.command_denied", level="warn", cmd=cmd, reason=_deny)
            return {"ok": False, "error": _deny}
    else:
        # No status snapshot yet (pre-first-poll window). Can't evaluate state;
        # the handler-level guards still apply. Trace so the gap is auditable.
        _trace.emit("policy.check_skipped_no_state", level="warn", cmd=cmd)

    # Payload BOUNDS against what the machine declares (issue #27). Separate
    # claim from finite_int/finite_float's TYPE check in the handlers — see the
    # command_policy docstring. Continuous inputs are clamped and the corrected
    # value merged back (the reply echoes it, so the UI snaps to the real
    # ceiling); discrete/structural values are refused.
    #
    # A refusal RETURNS the bounded reply rather than raising, so both policy
    # layers — gate and bounds — behave identically to a caller. (The recv
    # loop's ValueError catch stays as the backstop for failures raised from
    # inside a handler BODY, e.g. require_armed.)
    try:
        _fixed = validate_payload(cmd, msg, get_machine_limits())
    except ValueError as _bounds_e:
        _trace.emit("ws.payload_rejected", level="warn", cmd=cmd, reason=str(_bounds_e))
        return {"ok": False, "error": str(_bounds_e)}
    if _fixed:
        _trace.emit("ws.payload_clamped", level="warn", cmd=cmd, fields=_fixed)
        msg = {**msg, **_fixed}

    try:
        if cmd == "arm":
            return {"ok": True}

        if cmd == "estop":
            await _cmd_blocking(CMD.state, linuxcnc.STATE_ESTOP, wait=None)
            _estop_hold = True
            _hal_send({"connected": False})  # hold via _estop_hold
            return {"ok": True}

        if cmd == "estop_reset":
            # Trip-ack gate: a client that stayed armed through a trip (a trip
            # revokes nothing — armed is authorization, not liveness) could
            # otherwise Reset -> Machine On without ever confronting the
            # banner; the ack gate on `arm` only bites for clients that lost
            # armed. Enforced recovery order, matching the banner text:
            # Acknowledge -> re-Arm if needed -> E-Stop Reset -> Machine On.
            if _unacked_trip is not None:
                return {"ok": False, "error": "Safety trip not acknowledged"}
            require_armed(armed)
            # Do NOT pre-check emc_enable_in here. Standard LinuxCNC safety
            # chains feed iocontrol.0.user-enable-out back into the AND that
            # drives emc-enable-in (the operator-acknowledgement latch).
            # user-enable-out is LOW by design while task is in STATE_ESTOP,
            # so emc-enable-in is *always* FALSE at the moment of reset —
            # checking it deadlocks the only command that can escape ESTOP.
            # machine_on is the correct gate: by then user-enable-out is
            # TRUE and emc-enable-in reflects only hardware conditions.
            # UI's safetyChainOpen still keeps the estop indicator visible
            # if the chain is hardware-open post-reset, so the operator is
            # not misled. Issues #14 (problem) and #15 (this regression).
            # Pulse the HAL latch reset first so the safety chain can come back
            # up when LinuxCNC transitions out of ESTOP. The gateway sends the
            # IPC; hal_watchdog drives webui-safety.trip-reset-out, and the
            # servo-thread estop_latch clears within a cycle. 20ms sleep ≈ 2×
            # hal_watchdog select slice, enough for the reset edge to propagate
            # and ok-out to land before STATE_ESTOP_RESET is evaluated.
            _hal_send({"trip_reset": True})
            await asyncio.sleep(0.02)
            await _cmd_blocking(CMD.state, linuxcnc.STATE_ESTOP_RESET, wait=None)
            _estop_hold = False
            _hal_send({"connected": True})
            return {"ok": True}

        if cmd == "machine_on":
            require_armed(armed)
            # Optional but nice: avoid guaranteed-fail calls
            STAT.poll()
            if safe_get("estop", True):
                return {"ok": False, "error": "Cannot Machine On while in E-stop"}
            # Same edge-detection defense as estop_reset (issue #14).
            if _reader_get("emc_enable_in") is False:
                return {"ok": False, "error": "Safety chain is open — cannot turn machine on"}
            await _cmd_blocking(CMD.state, linuxcnc.STATE_ON, wait=None)
            return {"ok": True}

        if cmd == "machine_off":
            require_armed(armed)
            await _cmd_blocking(CMD.state, linuxcnc.STATE_OFF, wait=None)
            return {"ok": True}

        if cmd == "set_mode":
            require_armed(armed)
            blocked = reject_if_auto_running()
            if blocked:
                return blocked
            mode = finite_int(msg.get("mode", 0))
            if mode not in (linuxcnc.MODE_MANUAL, linuxcnc.MODE_AUTO, linuxcnc.MODE_MDI):
                return {"ok": False, "error": f"Invalid mode: {mode}"}
            await set_mode(mode)
            return {"ok": True}

        if cmd == "shutdown":
            # No require_armed — confirmation dialog is the safety gate.
            # Signal the LAUNCHER (parent), not ourselves, so the UI
            # shutdown path goes through the same _term trap as Ctrl-C.
            # Self-signaling SIGTERM makes uvicorn run lifespan teardown
            # but the gateway then exits with status 143 (128 + SIGTERM);
            # the launcher's `wait` captures 143 → LinuxCNC sees DISPLAY
            # exit non-zero → "terminated with an error" even though
            # everything ran cleanly. Signaling the launcher routes
            # through its `_term` trap, which forwards SIGTERM to the
            # gateway (lifespan still runs end-to-end) and then `exit 0`s
            # explicitly — identical end state as Ctrl-C.
            print("Shutdown requested via web UI", flush=True)
            try:
                os.kill(os.getppid(), signal.SIGTERM)
            except (ProcessLookupError, PermissionError) as e:
                # Launcher already gone — fall back to self-signal so we
                # at least exit cleanly via uvicorn's lifespan path.
                print(f"Shutdown: launcher signal failed ({e}); self-signaling", flush=True)
                signal.raise_signal(signal.SIGTERM)
            return {"ok": True}

        if cmd == "abort":
            require_armed(armed)
            await _cmd_blocking(CMD.abort, wait=None)
            return {"ok": True}

        if cmd == "mdi":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            text = msg.get("text", "")

            if not isinstance(text, str) or not text.strip():
                return {"ok": False, "error": "Missing text"}
            await set_mode(linuxcnc.MODE_MDI)
            await _cmd_blocking(CMD.mdi, text, wait=None)
            return {"ok": True}

        if cmd == "go_to_zero":
            # The → Zero button, mode-aware (2026-09-03): Machine frame runs
            # the probe_basic subroutine; Plane frame retracts ALONG THE TOOL
            # AXIS to a clearance (never downward) then X0 Y0 in the plane,
            # rotaries untouched; TCP refuses. The plan is command_policy.
            # goto_zero_plan (pure, tested) — the gate, the dimming and this
            # handler read one rule.
            require_armed(armed)
            blocked = reject_if_auto_running()
            if blocked:
                return blocked
            if _shared_status is None:
                return {"ok": False, "error": "No machine state yet — refused"}
            pstate = _policy_state_from_payload(
                _shared_status, armed, kins_switchable=_kins_is_switchable())
            # _shared_status is the StatusPayload OBJECT (attribute access —
            # the first cut read it as a dict and the Plane branch refused
            # every press with "position unknown"; 2026-09-04).
            _wp = getattr(_shared_status, "work_pos", None)
            work_z = None
            if isinstance(_wp, (list, tuple)) and len(_wp) > 2:
                try:
                    work_z = finite_float(_wp[2])
                except (TypeError, ValueError):
                    work_z = None
            clearance = 1.0 if get_machine_units() == "in" else 25.0
            # The active fixture's W1 stamp: Machine frame returns the table
            # to the touch-off angle before X/Y (goto_zero_plan).
            _stamp = None
            if pstate.g5x_index is not None:
                _stamp = _prov_cache.get(finite_int(pstate.g5x_index, lo=1))
            lines, why = goto_zero_plan(pstate, work_z, clearance, stamp=_stamp)
            if why:
                _trace.emit("goto.zero_refused", level="warn", reason=why,
                            kins_type=pstate.kins_type, g5x_index=pstate.g5x_index)
                return {"ok": False, "error": why}
            await set_mode(linuxcnc.MODE_MDI)
            for line in lines:
                await _cmd_blocking(CMD.mdi, line, wait=None)
            _trace.emit("goto.zero", level="info", kins_type=pstate.kins_type, lines=lines)
            return {"ok": True, "lines": lines}

        if cmd == "save_tool":
            require_armed(armed)
            tool_num = finite_int(msg["tool_number"], lo=0)
            tbl_path = get_tool_tbl_path()
            if not tbl_path:
                return {"ok": False, "error": "Tool table path not available"}

            # Update tool.tbl — all file I/O off the loop; _cmd_lock stays held
            # so the read-modify-write is still serialized (B3). ToolLibraryStore
            # is lock-guarded, so an offloaded status-loop read can't race it.
            tbl_tools = await asyncio.to_thread(parse_tool_table, tbl_path)
            found = False
            for t in tbl_tools:
                if t["T"] == tool_num:
                    if "pocket" in msg:
                        t["P"] = finite_int(msg["pocket"], lo=0)
                    if "z_offset" in msg:
                        t["Z"] = finite_float(msg["z_offset"])
                    if "diameter" in msg:
                        t["D"] = finite_float(msg["diameter"], lo=0)
                    if "remark" in msg:
                        t["remark"] = str(msg["remark"])
                    found = True
                    break
            if not found:
                return {"ok": False, "error": f"Tool T{tool_num} not found"}

            await asyncio.to_thread(write_tool_table, tbl_path, tbl_tools)
            await _reload_tool_table_and_bump()

            # Update metadata
            library = await asyncio.to_thread(load_tool_library)
            key = str(tool_num)
            if key not in library:
                library[key] = {}
            for field in _TOOL_META_FIELDS:
                if field in msg:
                    library[key][field] = msg[field]
            await asyncio.to_thread(save_tool_library, library)
            global _tool_meta_dirty
            _tool_meta_dirty = True
            return {"ok": True}

        if cmd == "add_tool":
            require_armed(armed)
            tool_num = finite_int(msg["tool_number"], lo=0)
            tbl_path = get_tool_tbl_path()
            if not tbl_path:
                return {"ok": False, "error": "Tool table path not available"}

            tbl_tools = await asyncio.to_thread(parse_tool_table, tbl_path)
            for t in tbl_tools:
                if t["T"] == tool_num:
                    return {"ok": False, "error": f"Tool T{tool_num} already exists"}

            tbl_tools.append({
                "T": tool_num,
                "P": finite_int(msg.get("pocket", tool_num), lo=0),
                "Z": finite_float(msg.get("z_offset", 0.0)),
                "D": finite_float(msg.get("diameter", 0.0), lo=0),
                "remark": str(msg.get("remark", "")),
            })
            await asyncio.to_thread(write_tool_table, tbl_path, tbl_tools)
            await _reload_tool_table_and_bump()

            # Save metadata if provided
            library = await asyncio.to_thread(load_tool_library)
            key = str(tool_num)
            library[key] = {}
            for field in _TOOL_META_FIELDS:
                if field in msg:
                    library[key][field] = msg[field]
            await asyncio.to_thread(save_tool_library, library)
            return {"ok": True}

        if cmd == "delete_tool":
            require_armed(armed)
            tool_num = finite_int(msg["tool_number"], lo=0)

            # Don't delete the currently loaded tool
            STAT.poll()
            current = safe_get("tool_in_spindle", None)
            try:
                current = int(current) if current is not None else None
            except (ValueError, TypeError):
                current = None
            if current == tool_num:
                return {"ok": False, "error": f"Cannot delete T{tool_num} — currently in spindle"}

            tbl_path = get_tool_tbl_path()
            if not tbl_path:
                return {"ok": False, "error": "Tool table path not available"}

            tbl_tools = await asyncio.to_thread(parse_tool_table, tbl_path)
            new_tools = [t for t in tbl_tools if t["T"] != tool_num]
            if len(new_tools) == len(tbl_tools):
                return {"ok": False, "error": f"Tool T{tool_num} not found"}

            await asyncio.to_thread(write_tool_table, tbl_path, new_tools)
            await _reload_tool_table_and_bump()

            library = await asyncio.to_thread(load_tool_library)
            library.pop(str(tool_num), None)
            await asyncio.to_thread(save_tool_library, library)

            return {"ok": True}

        if cmd == "renumber_tool":
            # One transactional renumber (issue #30): validate, then rewrite the
            # tool table AND move the metadata together under the already-held
            # _cmd_lock. Replaces the old add_tool+delete_tool client sequence,
            # which could leave a duplicate / lost tool if the second send failed.
            require_armed(armed)
            old_num = finite_int(msg["old_tool_number"], lo=0)
            new_num = finite_int(msg["tool_number"], lo=0)
            tbl_path = get_tool_tbl_path()
            if not tbl_path:
                return {"ok": False, "error": "Tool table path not available"}

            tbl_tools = await asyncio.to_thread(parse_tool_table, tbl_path)
            src = next((t for t in tbl_tools if t["T"] == old_num), None)
            if src is None:
                return {"ok": False, "error": f"Tool T{old_num} not found"}
            if new_num != old_num and any(t["T"] == new_num for t in tbl_tools):
                return {"ok": False, "error": f"Tool T{new_num} already exists"}

            # Don't renumber the tool in the spindle — its active offset would
            # shift under it.
            STAT.poll()
            current = safe_get("tool_in_spindle", None)
            try:
                current = int(current) if current is not None else None
            except (ValueError, TypeError):
                current = None
            if current == old_num:
                return {"ok": False, "error": f"Cannot renumber T{old_num} — currently in spindle"}

            src["T"] = new_num
            src["P"] = finite_int(msg.get("pocket", new_num), lo=0)
            src["Z"] = finite_float(msg.get("z_offset", src.get("Z", 0.0)))
            src["D"] = finite_float(msg.get("diameter", src.get("D", 0.0)), lo=0)
            src["remark"] = str(msg.get("remark", src.get("remark", "")))
            await asyncio.to_thread(write_tool_table, tbl_path, tbl_tools)
            await _reload_tool_table_and_bump()

            library = await asyncio.to_thread(load_tool_library)
            meta = library.pop(str(old_num), {}) or {}
            for field in _TOOL_META_FIELDS:
                if field in msg:
                    meta[field] = msg[field]
            library[str(new_num)] = meta
            await asyncio.to_thread(save_tool_library, library)
            return {"ok": True, "tool_number": new_num}

        if cmd == "tool_change":
            require_armed(armed)
            blocked = reject_if_auto_running()
            if blocked:
                return blocked
            tool_num = finite_int(msg["tool_number"], lo=0)
            await set_mode(linuxcnc.MODE_MDI)
            await _cmd_blocking(CMD.mdi, f"T{tool_num} M6 G43", wait=None)
            return {"ok": True}

        if cmd == "auto_step":
            require_armed(armed)
            STAT.poll()
            paused = bool(safe_get("paused", False))
            interp = safe_get("interp_state", None)
            mode = safe_get("task_mode", None)

            if paused:
                # Already paused → advance one block (no mode change)
                await _cmd_blocking(CMD.auto, linuxcnc.AUTO_STEP, wait=None)
            elif mode == linuxcnc.MODE_AUTO and interp != linuxcnc.INTERP_IDLE:
                # Running (not paused). The 'step' gate forbids stepping while
                # running, but it checks a status SNAPSHOT while this handler
                # re-polls fresh — so this guards the race where the program
                # started in between. Reject (consistent with the gate) rather
                # than fall through to the 'idle' branch and re-start a running
                # program (review #3).
                return {"ok": False, "error": "Cannot step while running — pause first"}
            else:
                # Idle → start program and step
                await set_mode(linuxcnc.MODE_AUTO)
                await _cmd_blocking(CMD.auto, linuxcnc.AUTO_STEP, wait=None)
            return {"ok": True}

        if cmd == "auto_run":
            require_armed(armed)
            spindle_dir = msg.get("spindle_dir")
            spindle_speed = finite_int(msg.get("spindle_speed", 0), lo=0)
            start_line = finite_int(msg.get("line", 0), lo=0)
            pre_tool = finite_int(msg.get("pre_tool", 0), lo=0)
            safe_z = bool(msg.get("safe_z", False))
            entry = None
            _ex, _ey = msg.get("entry_x"), msg.get("entry_y")
            if _ex is not None or _ey is not None:
                entry = {
                    "x": finite_float(_ex) if _ex is not None else None,
                    "y": finite_float(_ey) if _ey is not None else None,
                    "wcs": msg.get("entry_wcs") if msg.get("entry_wcs") in _RFL_WCS_OK else None,
                    "units": msg.get("entry_units") if msg.get("entry_units") in ("G20", "G21") else None,
                }
                safe_z = True  # the XY preamble only ever moves at safe height

            if pre_tool or safe_z or entry:
                # RFL guard path (see _rfl_sequence): long-running — the
                # measurement alone takes minutes — so it CANNOT run inside this
                # handler (we hold _cmd_lock here and block this client's receive
                # loop). Validate, spawn, return immediately; progress rides the
                # status fanout as `rfl_status`.
                if _rfl_active:
                    return {"ok": False, "error": "Run-from-line sequence already in progress"}
                blocked = reject_if_auto_running()
                if blocked:
                    return blocked
                _rfl_active = True
                _rfl_phase("queued")
                register_bg_task(asyncio.create_task(_rfl_sequence(
                    start_line, pre_tool, safe_z, spindle_dir, spindle_speed, entry)))
                return {"ok": True, "rfl": "started"}

            if spindle_dir and spindle_speed > 0:
                await set_mode(linuxcnc.MODE_MANUAL)
                if spindle_dir == "forward":
                    await _cmd_blocking(CMD.spindle, linuxcnc.SPINDLE_FORWARD, spindle_speed, wait=None)
                elif spindle_dir == "reverse":
                    await _cmd_blocking(CMD.spindle, linuxcnc.SPINDLE_REVERSE, spindle_speed, wait=None)
            await set_mode(linuxcnc.MODE_AUTO)
            await _cmd_blocking(CMD.auto, linuxcnc.AUTO_RUN, start_line, wait=None)
            return {"ok": True}

        # jog left intact (even if you're not using it right now)
        if cmd == "jog_cont":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axis = finite_int(msg.get("axis"), lo=0)
            vel = finite_float(msg.get("vel", 0.0))
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = await _jog_mode_flag()
            rc = await _cmd_blocking(CMD.jog, linuxcnc.JOG_CONTINUOUS, jf, _jog_axis_arg(axis, jf), vel, wait=None)
            _active_jogs.add(axis)
            _trace_jog("jog_cont", axis, jf, vel=vel, rc=rc)
            return {"ok": True}

        if cmd == "jog_stop":
            # Stopping motion is always allowed — gateway must NOT silently
            # drop a stop request, even from a disarmed client. The previous
            # `if not armed: return ok` short-circuit caused a real safety
            # gap: operator holds jog, disarms, releases → client's jog_stop
            # was accepted as no-op and the machine kept moving. Audit Phase
            # 2 / Issue E1. In AUTO+running a jog cannot be in flight
            # (jogging requires MANUAL/TELEOP) and a forced mode switch
            # would interrupt the program — skip that case explicitly.
            axis = finite_int(msg.get("axis"), lo=0)
            if axis not in _active_jogs:
                # Nothing the gateway started is moving on this axis: a late
                # release. No mode switch — that is what aborted a fresh MDI.
                _trace.emit("jog.stop_without_jog", level="info", cmd="jog_stop", axis=axis)
                return {"ok": True}
            STAT.poll()   # fresh: the guard below must not read a 30 ms-old snapshot
            mode = safe_get("task_mode", None)
            interp = safe_get("interp_state", None)
            if mode == linuxcnc.MODE_AUTO and interp != linuxcnc.INTERP_IDLE:
                return {"ok": True}
            if _jog_stop_would_abort_mdi(mode, interp, "jog_stop"):
                return {"ok": True}
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            await _cmd_blocking(CMD.jog, linuxcnc.JOG_STOP, jf, _jog_axis_arg(axis, jf), wait=None)
            _active_jogs.discard(axis)
            return {"ok": True}

        if cmd == "jog_cont_multi":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axes = msg.get("axes", [])
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = await _jog_mode_flag()
            for entry in axes:
                _ax = finite_int(entry["axis"], lo=0)
                await _cmd_blocking(CMD.jog, linuxcnc.JOG_CONTINUOUS, jf, _jog_axis_arg(_ax, jf), finite_float(entry["vel"]), wait=None)
                _active_jogs.add(_ax)
            return {"ok": True}

        if cmd == "jog_stop_multi":
            # Stopping motion is always allowed — see jog_stop above for the
            # same audit rationale (Phase 2 / Issue E1). In AUTO+running we
            # have no jog in flight and must not switch modes.
            axes = [finite_int(a, lo=0) for a in msg.get("axes", [])]
            active = [a for a in axes if a in _active_jogs]
            if not active:
                _trace.emit("jog.stop_without_jog", level="info", cmd="jog_stop_multi", axes=axes)
                return {"ok": True}
            STAT.poll()
            mode = safe_get("task_mode", None)
            interp = safe_get("interp_state", None)
            if mode == linuxcnc.MODE_AUTO and interp != linuxcnc.INTERP_IDLE:
                return {"ok": True}
            if _jog_stop_would_abort_mdi(mode, interp, "jog_stop_multi"):
                return {"ok": True}
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            for a in active:
                await _cmd_blocking(CMD.jog, linuxcnc.JOG_STOP, jf, _jog_axis_arg(a, jf), wait=None)
                _active_jogs.discard(a)
            return {"ok": True}

        if cmd == "jog_incr":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axis = finite_int(msg.get("axis"), lo=0)
            vel = abs(finite_float(msg.get("vel", 0.0)))  # speed only; distance carries direction
            dist = finite_float(msg.get("distance", 0.0))
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = await _jog_mode_flag()
            rc = await _cmd_blocking(CMD.jog, linuxcnc.JOG_INCREMENT, jf, _jog_axis_arg(axis, jf), vel, dist, wait=None)
            _active_jogs.add(axis)
            _trace_jog("jog_incr", axis, jf, vel=vel, dist=dist, rc=rc)
            return {"ok": True}

        if cmd == "jog_incr_multi":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axes = msg.get("axes", [])
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = await _jog_mode_flag()
            for entry in axes:
                _ax = finite_int(entry["axis"], lo=0)
                await _cmd_blocking(CMD.jog, linuxcnc.JOG_INCREMENT, jf, _jog_axis_arg(_ax, jf), abs(finite_float(entry["vel"])), finite_float(entry["distance"]), wait=None)
                _active_jogs.add(_ax)
            return {"ok": True}

        if cmd == "home_all":
            require_armed(armed)
            await set_mode(linuxcnc.MODE_MANUAL)
            await _cmd_blocking(CMD.home, -1, wait=None)  # -1 homes all axes
            return {"ok": True}

        if cmd == "unhome_all":
            require_armed(armed)
            await set_mode(linuxcnc.MODE_MANUAL)
            await _cmd_blocking(CMD.teleop_enable, 0)  # unhome requires joint mode
            await _cmd_blocking(CMD.unhome, -1, wait=None)  # -1 unhomes all axes
            return {"ok": True}

        if cmd == "home":
            require_armed(armed)
            joint = finite_int(msg.get("joint", -1))
            await set_mode(linuxcnc.MODE_MANUAL)
            await _cmd_blocking(CMD.home, joint, wait=None)
            return {"ok": True}

        if cmd == "unhome":
            require_armed(armed)
            joint = finite_int(msg.get("joint", -1))
            await set_mode(linuxcnc.MODE_MANUAL)
            await _cmd_blocking(CMD.teleop_enable, 0)  # unhome requires joint mode
            await _cmd_blocking(CMD.unhome, joint, wait=None)
            return {"ok": True}

        if cmd == "cycle_start":
            require_armed(armed)
            await set_mode(linuxcnc.MODE_AUTO)
            await _cmd_blocking(CMD.auto, linuxcnc.AUTO_RUN, 0, wait=None)  # Start from beginning
            return {"ok": True}

        if cmd == "cycle_pause":
            require_armed(armed)
            await _cmd_blocking(CMD.auto, linuxcnc.AUTO_PAUSE, wait=None)
            return {"ok": True}

        if cmd == "cycle_resume":
            require_armed(armed)
            # Don't call set_mode - already in AUTO mode when paused
            await _cmd_blocking(CMD.auto, linuxcnc.AUTO_RESUME, wait=None)
            return {"ok": True}

        if cmd == "set_feed_override":
            require_armed(armed)
            # Range is enforced by COMMAND_SCHEMA against the INI's
            # MAX_FEED_OVERRIDE (was a hardcoded 2.0 here, which accepted 200%
            # on a machine whose builder declared 150%).
            scale = finite_float(msg.get("scale", 1.0), 1.0)
            await _cmd_blocking(CMD.feedrate, scale, wait=None)
            return {"ok": True, "scale": scale}

        if cmd == "set_spindle_override":
            require_armed(armed)
            # Range from the INI's MIN/MAX_SPINDLE_OVERRIDE (COMMAND_SCHEMA).
            scale = finite_float(msg.get("scale", 1.0), 1.0)
            await _cmd_blocking(CMD.spindleoverride, scale, wait=None)
            return {"ok": True, "scale": scale}

        if cmd == "spindle_forward":
            require_armed(armed)
            speed = finite_float(msg.get("speed", 0))
            await set_mode(linuxcnc.MODE_MANUAL)
            await _cmd_blocking(CMD.spindle, linuxcnc.SPINDLE_FORWARD, speed, wait=None)
            return {"ok": True}

        if cmd == "spindle_reverse":
            require_armed(armed)
            speed = finite_float(msg.get("speed", 0))
            await set_mode(linuxcnc.MODE_MANUAL)
            await _cmd_blocking(CMD.spindle, linuxcnc.SPINDLE_REVERSE, speed, wait=None)
            return {"ok": True}

        if cmd == "spindle_stop":
            require_armed(armed)
            await set_mode(linuxcnc.MODE_MANUAL)
            await _cmd_blocking(CMD.spindle, linuxcnc.SPINDLE_OFF, wait=None)
            return {"ok": True}

        if cmd == "spindle_increase":
            require_armed(armed)
            await set_mode(linuxcnc.MODE_MANUAL)
            await _cmd_blocking(CMD.spindle, linuxcnc.SPINDLE_INCREASE, wait=None)
            return {"ok": True}

        if cmd == "spindle_decrease":
            require_armed(armed)
            await set_mode(linuxcnc.MODE_MANUAL)
            await _cmd_blocking(CMD.spindle, linuxcnc.SPINDLE_DECREASE, wait=None)
            return {"ok": True}

        if cmd == "flood_on":
            require_armed(armed)
            await _cmd_blocking(CMD.flood, linuxcnc.FLOOD_ON, wait=None)
            return {"ok": True}

        if cmd == "flood_off":
            require_armed(armed)
            await _cmd_blocking(CMD.flood, linuxcnc.FLOOD_OFF, wait=None)
            return {"ok": True}

        if cmd == "mist_on":
            require_armed(armed)
            await _cmd_blocking(CMD.mist, linuxcnc.MIST_ON, wait=None)
            return {"ok": True}

        if cmd == "mist_off":
            require_armed(armed)
            await _cmd_blocking(CMD.mist, linuxcnc.MIST_OFF, wait=None)
            return {"ok": True}

        if cmd == "set_rapid_override":
            require_armed(armed)
            # 0–100% (COMMAND_SCHEMA; 1.0 is LinuxCNC's own ceiling, not a
            # machine-declared one, so it is a named constant there).
            scale = finite_float(msg.get("scale", 1.0), 1.0)
            await _cmd_blocking(CMD.rapidrate, scale, wait=None)
            return {"ok": True, "scale": scale}

        if cmd == "set_optional_stop":
            require_armed(armed)
            value = bool(msg.get("value", False))
            await _cmd_blocking(CMD.set_optional_stop, value, wait=None)
            return {"ok": True}

        if cmd == "set_block_delete":
            require_armed(armed)
            value = bool(msg.get("value", False))
            await _cmd_blocking(CMD.set_block_delete, value, wait=None)
            return {"ok": True}

        if cmd == "set_max_velocity":
            require_armed(armed)
            # Range from the INI's TRAJ MAX_LINEAR_VELOCITY (COMMAND_SCHEMA).
            velocity = finite_float(msg.get("velocity", 0.0))
            await _cmd_blocking(CMD.maxvel, velocity, wait=None)
            return {"ok": True, "velocity": velocity}

        if cmd == "load_file":
            require_armed(armed)
            path = msg.get("path", "")
            if not path or not isinstance(path, str):
                return {"ok": False, "error": "Missing path"}

            abs_path = os.path.abspath(path)
            if not os.path.isfile(abs_path):
                return {"ok": False, "error": "File not found"}

            nc_dir = get_nc_files_dir()
            if not validate_path_within(abs_path, nc_dir):
                return {"ok": False, "error": "File not in NC files directory"}

            if not validate_extension(abs_path):
                return {"ok": False, "error": "Invalid file extension"}

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            # Phase markers (B8) subdivide load_file so the lag monitor pins which
            # step holds the loop — the run named "handle_command cmd=load_file"
            # at ~78 ms but couldn't say which part. set_mode/program_open already
            # offload their NML work; if a marker dominates a future lag.window,
            # that's the synchronous piece to move off-loop next.
            _set_phase("load_file.set_mode")
            await set_mode(linuxcnc.MODE_AUTO)
            # Fire-and-forget (no wait_complete). milltask opens the file in its
            # OWN process; our `wait=5` just polled it via CMD.wait_complete — and
            # the LinuxCNC C binding HOLDS THE GIL across that poll, so the
            # `to_thread` offload could not free the loop (a 44 MB open stalled it
            # 62 ms — `load_file.program_open` dominated the lag.window; a larger
            # file or slower disk scales straight toward the 500 ms watchdog trip).
            # The program_open SEND is a microsecond NML write. Completion is
            # observed via the status stream (interp_state + file) and the preview
            # re-parses from disk independently — same contract as the tool_change
            # fire-and-forget path. Open failures surface on the error channel.
            _set_phase("load_file.program_open")
            await _cmd_blocking(CMD.program_open, abs_path, wait=None)
            return {"ok": True, "path": abs_path}

        if cmd == "unload_file":
            require_armed(armed)
            blocked = reject_if_auto_running()
            if blocked:
                return blocked
            await _cmd_blocking(CMD.abort)
            await _cmd_blocking(CMD.reset_interpreter)
            return {"ok": True}

        if cmd == "list_probe_macros":
            return {"ok": True, "macros": get_probe_macros()}

        if cmd == "set_probe_vars":
            require_armed(armed)
            vars_to_set = msg.get("vars", {})
            if not vars_to_set or not isinstance(vars_to_set, dict):
                return {"ok": False, "error": "Missing vars dict"}
            # 1) Always write to var file for persistence across restarts
            file_ok = False
            ini_path = getattr(STAT, "ini_filename", None)
            if ini_path:
                ini = linuxcnc.ini(ini_path)
                var_file = ini.find("RS274NGC", "PARAMETER_FILE")
                if var_file:
                    if not os.path.isabs(var_file):
                        var_file = os.path.join(os.path.dirname(ini_path), var_file)
                    # Keys are bounds-checked against the machine's var file by
                    # COMMAND_SCHEMA; values get the same finite_* type claim as
                    # every other payload number (a bare cast here wrote
                    # arbitrary #N=inf into the parameter file).
                    str_vars = {str(k): finite_float(v) for k, v in vars_to_set.items()}
                    _trace.emit("probe.set_vars", vars=str_vars)
                    await asyncio.to_thread(_write_var_file_updates, var_file, str_vars)
                    _status_runtime.mark_var_file_written(var_file)
                    file_ok = True
            # 2) Best-effort: set in interpreter memory via MDI (requires armed + machine on + idle)
            # Split into chunks ≤250 chars to fit LinuxCNC's 256-char MDI buffer
            mdi_ok = False
            STAT.poll()
            if armed and bool(safe_get("enabled", False)) and not reject_if_auto_running():
                try:
                    items = [f"#{k}={finite_float(v):.6f}" for k, v in vars_to_set.items()]
                    chunks, current = [], ""
                    for item in items:
                        if current and len(current) + 1 + len(item) > 250:
                            chunks.append(current)
                            current = item
                        else:
                            current = f"{current} {item}".strip() if current else item
                    if current:
                        chunks.append(current)
                    await set_mode(linuxcnc.MODE_MDI)
                    mdi_ok = True
                    for chunk in chunks:
                        ret = await _cmd_blocking(CMD.mdi, chunk, wait=5)
                        if ret != 0:
                            mdi_ok = False
                except Exception as e:
                    _trace.emit("probe.mdi_set_failed", level="warn",
                                exc=type(e).__name__, msg=str(e))
            _trace.emit("probe.set_vars_result",
                        file_saved=file_ok, mdi_set=mdi_ok)
            return {"ok": True, "file_saved": file_ok, "mdi_set": mdi_ok}

        if cmd == "get_probe_vars":
            var_nums = msg.get("vars", [])
            if not var_nums or not isinstance(var_nums, list):
                return {"ok": False, "error": "Missing vars list"}
            ini_path = getattr(STAT, "ini_filename", None)
            if not ini_path:
                return {"ok": False, "error": "No INI file"}
            ini = linuxcnc.ini(ini_path)
            var_file = ini.find("RS274NGC", "PARAMETER_FILE")
            if not var_file:
                return {"ok": False, "error": "No PARAMETER_FILE in INI"}
            if not os.path.isabs(var_file):
                var_file = os.path.join(os.path.dirname(ini_path), var_file)
            result = await asyncio.to_thread(_read_var_file, var_file, {str(v) for v in var_nums})
            _trace.emit("probe.get_vars", vars=result)
            return {"ok": True, "vars": result}

        if cmd == "reparse_preview":
            require_armed(armed)
            # Re-parse the loaded program against the CURRENT work offsets.
            #
            # The preview is parsed once, against the offsets in effect then; a
            # touch-off afterwards leaves it stale (CLAUDE.md has always said
            # "reload the file to re-validate"). But that promise was not
            # keepable in one step: the poller's edge is
            # `active_file != last_file or mtime != last_mtime`, so re-loading
            # the SAME path at the same mtime is a no-op, and the only escape
            # was unload-then-load. Clearing the cache keys makes the edge fire
            # on the next tick — one action that refreshes the render, the
            # soft-limit annotations and the collision/scrub basis together.
            # The request is a FLAG, not a cache-key wipe: clearing the keys
            # was swallowed whenever a parse was already in flight (its
            # completion rewrote them — replied ok, nothing respawned), and
            # it also made the poller's unload branch unreachable.
            _bulk.reparse_pending = True
            _trace.emit("gcode.reparse_requested",
                        deferred=bool(_bulk.refresh_running))
            if _bulk.refresh_running:
                _trace.emit("gcode.reparse_deferred")
            return {"ok": True}

        # ---- Surface compensation + HAL handshakes ----
        # These four ran INLINE in the websocket receive loop until 2026-08-20,
        # authorized by `armed` alone: they never reached check_command, were
        # absent from COMMAND_GATES, and the coverage test could not see them
        # (it parsed only this ladder). A direct websocket client could enable
        # machine-Z compensation, force the probe input, or satisfy a manual
        # toolchange handshake in any machine state. Gates now live in
        # command_policy.COMMAND_GATES; the "LinuxCNC not connected" check and
        # the bounded-error catch come free on this path.
        if cmd == "set_compensation":
            require_armed(armed)
            enable = bool(msg.get("enable", False))
            if enable:
                require_no_rotary_tilt()
            _loop = asyncio.get_event_loop()
            await _loop.run_in_executor(None, _hal_send, {"compensation_enable": enable})
            _trace.emit("compensation.enable", enable=enable)
            return {"ok": True}

        if cmd == "set_compensation_method":
            require_armed(armed)
            method = finite_int(msg.get("method", 2))
            _loop = asyncio.get_event_loop()
            await _loop.run_in_executor(None, _hal_send, {"compensation_method": method})
            _trace.emit("compensation.method", method=method)
            return {"ok": True}

        if cmd == "confirm_tool_change":
            require_armed(armed)
            require_tool_change_pending()
            _loop = asyncio.get_event_loop()
            await _loop.run_in_executor(None, _hal_send, {"tool_changed": True})
            return {"ok": True}

        if cmd == "simulate_probe_trip":
            require_armed(armed)
            try:
                _loop = asyncio.get_event_loop()
                # Unlink any existing writer on probe-in (e.g. qtpyvcp.probe-in.out)
                # so halcmd sets works. The pin may not exist in non-qtpyvcp
                # configs — that's fine. Log other failures (halcmd missing,
                # permission denied, syntax error) so they don't disappear.
                _unlink_res = await _loop.run_in_executor(None, lambda: subprocess.run(
                    ['halcmd', 'unlinkp', 'qtpyvcp.probe-in.out'],
                    capture_output=True, text=True, timeout=2))
                if _unlink_res.returncode != 0:
                    _err = (_unlink_res.stderr or "").strip()
                    if _err and "does not exist" not in _err and "no such" not in _err.lower():
                        _trace.emit("halcmd.unlinkp_failed", level="warn",
                                    pin="qtpyvcp.probe-in.out",
                                    rc=_unlink_res.returncode, stderr=_err)
                await _loop.run_in_executor(None, lambda: subprocess.run(
                    ['halcmd', 'sets', 'probe-in', '1'],
                    capture_output=True, text=True, timeout=2, check=True))
                await asyncio.sleep(0.02)
                await _loop.run_in_executor(None, lambda: subprocess.run(
                    ['halcmd', 'sets', 'probe-in', '0'],
                    capture_output=True, text=True, timeout=2, check=True))
                return {"ok": True}
            except Exception as e:
                return {"ok": False, "error": f"simulate_probe_trip: {e}"}

        if cmd == "get_wcs_table":
            return {"ok": True, "table": [row.copy() for row in _wcs_cache]}

        if cmd == "clear_wcs":
            require_armed(armed)
            blocked = reject_if_auto_running()
            if blocked:
                return blocked
            target = msg.get("target", "active")
            if target == "active":
                STAT.poll()
                indices = [STAT.g5x_index]  # 1-based
            elif target == "all":
                # On a TWP (switchable-kins) config the reserved rows G59..G59.3
                # are the remap's — zeroing them under an active plane destroys
                # it. `all` is the operator's fixtures; `reserved` below is the
                # explicit recovery for the scratch rows.
                indices = list(range(1, 6)) if _kins_is_switchable() else list(range(1, 10))
            elif target == "reserved":
                if _reader_get("twp_active"):
                    return {"ok": False, "error": "A tilted work plane is active — "
                            "G59..G59.3 hold its frame. G69 first."}
                indices = [6, 7, 8, 9]
            elif target in _G5X_MAP:
                indices = [_G5X_MAP[target]]
            else:
                return {"ok": False, "error": f"Invalid target: {target}"}
            await set_mode(linuxcnc.MODE_MDI)
            STAT.poll()
            machine_axes = [a.lower() for a in _axes_from_mask(STAT.axis_mask)]
            zero_parts = " ".join(f"{k.upper()}0" for k in machine_axes) + " R0"
            for p in indices:
                await _cmd_blocking(CMD.mdi, f"G10 L2 P{p} {zero_parts}", wait=5)
            # A cleared offset is still an ESTABLISHED one — zeros touched
            # off at whatever pose the table is at now. Stamping it keeps
            # the record true; leaving the previous stamp behind would make
            # it describe an offset that no longer exists. (Full-triple
            # write, so the mixed-angle decision always stamps.)
            await _stamp_wcs_provenance(
                indices, {p: [0.0, 0.0, 0.0] for p in indices},
                wrote_all_xyz=True)
            # Update cache immediately
            for p in indices:
                ci = p - 1
                if 0 <= ci < 9:
                    _wcs_cache[ci] = {"name": _WCS_NAMES[ci], **{k: 0.0 for k in _WCS_AXIS_KEYS}, "r": 0.0}
            return {"ok": True, "table": [row.copy() for row in _wcs_cache]}

        if cmd == "touchoff":
            # Operator touch-off from the DRO / Zero buttons. Was a client-built
            # `G10 L20 P0 …` MDI: opaque to the gateway, never provenance-
            # stamped, and in Plane mode it wrote the TOOL-frame numbers (and
            # Zero All's rotary words) into G59 — the remap's scratch row —
            # which the next orient then read as a rotary offset. The route
            # decision is command_policy.touchoff_route (pure, tested); the
            # Plane route hands the point to the remap, which writes G54
            # THROUGH the plane (o<twp_touchoff>).
            require_armed(armed)
            require_no_eoffset()
            blocked = reject_if_auto_running()
            if blocked:
                return blocked
            axes_in = msg.get("axes")
            if not isinstance(axes_in, dict) or not axes_in:
                return {"ok": False, "error": "No axis values provided"}
            values = {str(k).upper(): finite_float(v) for k, v in axes_in.items()}
            if _shared_status is None:
                return {"ok": False, "error": "No machine state yet — touch-off refused"}
            pstate = _policy_state_from_payload(
                _shared_status, armed, kins_switchable=_kins_is_switchable())
            route, reason = touchoff_route(pstate, values.keys())
            if route is None:
                _trace.emit("touchoff.refused", level="warn", letters=sorted(values),
                            reason=reason, kins_type=pstate.kins_type,
                            g5x_index=pstate.g5x_index)
                return {"ok": False, "error": reason}
            await set_mode(linuxcnc.MODE_MDI)
            if route == "plane":
                extra = sorted(l for l in values if l not in ("X", "Y", "Z"))
                if extra:
                    return {"ok": False, "error": f"Plane-mode touch-off takes X/Y/Z only (got {extra})"}
                mask = (1 if "X" in values else 0) | (2 if "Y" in values else 0) | (4 if "Z" in values else 0)
                line = (f"o<twp_touchoff> call [{mask}] [{values.get('X', 0.0):.6f}] "
                        f"[{values.get('Y', 0.0):.6f}] [{values.get('Z', 0.0):.6f}]")
                _datum_before = _status_runtime_mod.assemble_twp_datum(_reader_get)
                _seq_before = _reader_get("twp_datum_seq")
                rc = await _cmd_blocking(CMD.mdi, line, wait=30)
                if _cmd_rc_failed(rc):
                    _trace.emit("touchoff.plane_failed", level="warn", rc=rc, line=line)
                    return {"ok": False, "error": "Plane touch-off failed — see the error channel"}
                # The remap wrote G54 (a NON-active row: G59 is active) and its
                # own provenance in the INTERPRETER — neither STAT nor the var
                # file carries it. Seed our G54 row + stamp from the datum the
                # remap published, once it has settled.
                _adopt_m535_datum(await _settle_datum_after_m535(_datum_before, before_seq=_seq_before),
                                  step="touchoff.plane")
                _trace.emit("touchoff.plane", level="info", mask=mask, values=values)
                return {"ok": True, "route": "plane", "index": 6}
            if "Z" in values:
                z_eoff = _reader_get("z_eoffset")
                if z_eoff is None:
                    # The comp eoffset must be added back so the WCS does not
                    # absorb it; an undelivered value is unknown, not 0.
                    return {"ok": False, "error": "Z eoffset not delivered by the HAL reader — touch-off refused"}
                values["Z"] = values["Z"] + finite_float(z_eoff)
            STAT.poll()
            p = finite_int(getattr(STAT, "g5x_index", 0))
            if not 1 <= p <= 9:
                return {"ok": False, "error": f"Active fixture index {p} out of range"}
            ci = p - 1
            prewrite = [finite_float(_wcs_cache[ci].get(k, 0.0)) for k in ("x", "y", "z")]
            words = " ".join(f"{l}{v:.6f}" for l, v in values.items())
            rc = await _cmd_blocking(CMD.mdi, f"G10 L20 P0 {words}", wait=5)
            if _cmd_rc_failed(rc):
                _trace.emit("touchoff.mdi_failed", level="warn", rc=rc, words=words)
                return {"ok": False, "error": "Touch-off failed — see the error channel"}
            STAT.poll()
            off = list(getattr(STAT, "g5x_offset", None) or [])
            if len(off) < 3:
                _trace.emit("touchoff.no_readback", level="warn", index=p)
                return {"ok": True, "route": "mdi", "index": p,
                        "table": [row.copy() for row in _wcs_cache]}
            for i, k in enumerate(_WCS_AXIS_KEYS):
                if i < len(off):
                    _wcs_cache[ci][k] = finite_float(off[i])
            # Stamp the RESULTING triple (a Z-only touch-off leaves X/Y as
            # they were) — same contract as set_wcs.
            wrote_all = {"X", "Y", "Z"} <= set(values)
            prov = await _stamp_wcs_provenance(
                [p], {p: [finite_float(off[i]) for i in range(3)]},
                wrote_all_xyz=wrote_all, prewrite_by_index={p: prewrite})
            _trace.emit("touchoff.mdi", level="info", index=p, words=words,
                        provenance=prov.get(p))
            resp = {"ok": True, "route": "mdi", "index": p,
                    "table": [row.copy() for row in _wcs_cache]}
            if prov.get(p) == "cleared_mixed_angle":
                resp["provenance"] = {"index": p, "action": prov[p]}
            return resp

        if cmd == "twp_capture":
            # One-button plane capture at the tool tip: G69 normalize ->
            # G68.3 with origin at the current tip -> no-move G53.1 P0.
            # The gateway drives the sequence as SEPARATE blocking MDIs:
            # a pure-NGC o-sub wrapper was tried first and failed —
            # remapped G-CODES silently never execute inside an o-sub
            # called from MDI (empirical on 2.9.4: rc clean, no effect,
            # no error; the M-code remaps M530/M535 in subs are fine, and
            # upstream only ever calls G68.x/G53.x at program top level).
            # Between steps the tip is read from STAT — safe because G69
            # left the machine idle in identity/G54 and the policy already
            # guaranteed G92/rotary-offset-clean; each rc is checked and
            # each failure names its step.
            require_armed(armed)
            require_no_eoffset()
            blocked = reject_if_auto_running()
            if blocked:
                return blocked
            if _shared_status is None:
                return {"ok": False, "error": "No machine state yet — capture refused"}
            pstate = _policy_state_from_payload(
                _shared_status, armed, kins_switchable=_kins_is_switchable())
            _trace.emit("twp.capture_state", level="info",
                        twp_defined=pstate.twp_defined, g5x_index=pstate.g5x_index,
                        kins_type=pstate.kins_type,
                        rotary_clean=pstate.rotary_offsets_clean,
                        g92_clean=pstate.g92_xyz_clean)
            reason = twp_capture_check(pstate)
            if reason is not None:
                _trace.emit("twp.capture_refused", level="warn", reason=reason,
                            kins_type=pstate.kins_type, g5x_index=pstate.g5x_index)
                return {"ok": False, "error": reason}
            await set_mode(linuxcnc.MODE_MDI)
            STAT.poll()
            rot = finite_float(getattr(STAT, "rotation_xy", 0.0) or 0.0)
            if abs(rot) > 1e-9:
                # G68.3's origin words assume an unrotated G54 — honest
                # refusal beats a silently displaced plane origin.
                return {"ok": False, "error": "G54 carries a G10 R rotation — "
                        "clear it (G10 L2 P1 R0) before capturing"}
            rc = await _cmd_blocking(CMD.mdi, "G69", wait=10)
            if _cmd_rc_failed(rc):
                _trace.emit("twp.capture_failed", level="warn", rc=rc, step="G69")
                return {"ok": False, "error": "Capture plane failed at G69 — see the error channel"}
            STAT.poll()
            if finite_int(getattr(STAT, "g5x_index", 0)) != 1:
                return {"ok": False, "error": "Capture: G69 did not land in G54 — refusing"}
            _g92 = list(getattr(STAT, "g92_offset", None) or [])
            if any(abs(finite_float(v)) > 1e-6 for v in _g92[:3]):
                return {"ok": False, "error": "A G92 X/Y/Z offset appeared — G92.1 before capturing"}
            _pos = list(getattr(STAT, "actual_position", None) or [])
            _g5x = list(getattr(STAT, "g5x_offset", None) or [])
            _tofs = list(getattr(STAT, "tool_offset", None) or [])
            if len(_pos) < 3 or len(_g5x) < 3 or len(_tofs) < 3:
                return {"ok": False, "error": "Machine position unreadable — capture refused"}
            tip = [finite_float(_pos[i]) - finite_float(_g5x[i]) - finite_float(_tofs[i])
                   for i in range(3)]
            line = f"G68.3 X{tip[0]:.6f} Y{tip[1]:.6f} Z{tip[2]:.6f}"
            rc = await _cmd_blocking(CMD.mdi, line, wait=10)
            if _cmd_rc_failed(rc):
                _trace.emit("twp.capture_failed", level="warn", rc=rc,
                            step="G68.3", line=line)
                return {"ok": False, "error": "Capture plane failed at G68.3 — see the error channel"}
            # Settle: the helper comp promotes twp-is-defined at 1 kHz from
            # the M68 the remap queued — bounded wait on the reader
            # snapshot (<=2 s), never a blind dwell, loud on timeout.
            for _ in range(40):
                if _reader_get("twp_defined"):
                    break
                await asyncio.sleep(0.05)
            else:
                _trace.emit("twp.capture_failed", level="warn", step="settle")
                return {"ok": False, "error": "Capture: the plane definition "
                        "did not settle — see the error channel"}
            # M530 Q2 = ADOPT the current head pose (fork extension): the
            # plane was built FROM the live rotaries one step ago, so the
            # current pose is a solution — Q2 verifies normality and uses it
            # verbatim. A plain G53.1 P0 may pick the OTHER (B,C) branch
            # (observed live: a 168-deg C swing with the tip on the part).
            # G69 already left identity kins, the wrapper's demote is moot.
            rc = await _cmd_blocking(CMD.mdi, "M530 P0 Q2", wait=30)
            if _cmd_rc_failed(rc):
                _trace.emit("twp.capture_failed", level="warn", rc=rc, step="M530 Q2")
                return {"ok": False, "error": "Capture plane failed at the orient — see the error channel"}
            # The orient's kins switch and twp-is-active promote ride the
            # helper comp like the definition did — same bounded settle, so
            # the caller (and the operator's next action) sees TOOL kins
            # actually in force, or an honest failure.
            for _ in range(40):
                _kt = _reader_get("kins_type")
                if _kt is not None and int(round(finite_float(_kt))) == 2:
                    break
                await asyncio.sleep(0.05)
            else:
                _trace.emit("twp.capture_failed", level="warn", step="orient_settle",
                            kins_type=_reader_get("kins_type"))
                return {"ok": False, "error": "Capture: the orient did not enter TOOL "
                        "kinematics — see the error channel"}
            # Final step: touch off THROUGH the plane at the tip (the proven
            # M535 path, all-XYZ zero). G68.3's origin words alone do not pin
            # the plane-frame READING to 0 — the kins-2 world carries pivot
            # terms, so the DRO at the captured tip read a residual (live:
            # ~36 mm at B20 C-15 with no TLO). Zeroing through the plane
            # makes the DRO read 0,0,0 at the tip BY CONSTRUCTION and puts
            # the ONE datum (G54, table frame) at the tip — the operator's
            # ask verbatim ("touch off the plane at the tool tip"). The
            # remap stamps the provenance itself (kins 0 / A 0).
            _datum_before = _status_runtime_mod.assemble_twp_datum(_reader_get)
            _seq_before = _reader_get("twp_datum_seq")
            rc = await _cmd_blocking(CMD.mdi, "o<twp_touchoff> call [7] [0] [0] [0]", wait=30)
            if _cmd_rc_failed(rc):
                _trace.emit("twp.capture_failed", level="warn", rc=rc, step="M535 zero")
                return {"ok": False, "error": "Capture: the plane touch-off failed — see the error channel"}
            _adopt_m535_datum(await _settle_datum_after_m535(_datum_before, before_seq=_seq_before),
                              step="twp.capture")
            _trace.emit("twp.capture", level="info", tip=tip)
            return {"ok": True}

        if cmd == "set_wcs":
            require_armed(armed)
            require_no_eoffset()  # touch-off contamination guard (issue #19)
            blocked = reject_if_auto_running()
            if blocked:
                return blocked
            target = msg.get("target")
            if target not in _G5X_MAP:
                return {"ok": False, "error": f"Invalid WCS: {target}"}
            p = _G5X_MAP[target]
            parts = []
            all_keys = list(_WCS_AXIS_KEYS) + ["r"]
            for axis in all_keys:
                val = msg.get(axis)
                if val is not None:
                    # finite_float, not float(): a bare cast laundered through
                    # this local slipped past the no-bare-payload-cast guard and
                    # shipped `G10 L2 P1 Xinf` into the MDI (issue #27).
                    parts.append(f"{axis.upper()}{finite_float(val):.6f}")
            if not parts:
                return {"ok": False, "error": "No axis values provided"}
            await set_mode(linuxcnc.MODE_MDI)
            ci = p - 1
            # Capture the PRE-write triple first: the mixed-angle decision
            # needs it to falsify the prior stamp (a foreign G10 between our
            # writes shows up as a mismatch here).
            prewrite = [finite_float(_wcs_cache[ci].get(k, 0.0))
                        for k in ("x", "y", "z")]
            await _cmd_blocking(CMD.mdi, f"G10 L2 P{p} {' '.join(parts)}", wait=5)
            for axis in all_keys:
                val = msg.get(axis)
                if val is not None:
                    _wcs_cache[ci][axis] = finite_float(val)
            # Stamp AFTER the cache update, and from the cache: a touch-off
            # may name only some axes (Z alone is the common one), so the
            # values just written are not the offset's X/Y/Z. The stamp has
            # to carry the RESULTING triple or the staleness check compares
            # against something that was never the offset.
            wrote_all = all(msg.get(k) is not None for k in ("x", "y", "z"))
            prov = await _stamp_wcs_provenance(
                [p], {p: [finite_float(_wcs_cache[ci].get(k, 0.0))
                          for k in ("x", "y", "z")]},
                wrote_all_xyz=wrote_all, prewrite_by_index={p: prewrite},
                # Typed values are fixture-frame statements, not measurements
                # at the live pose — stamp table frame (kins 0 / A 0). A
                # partial typed edit onto a fixture stamped at a real pose
                # falsifies the stamp exactly as a pose change would (the
                # override feeds the mixed-angle decision too).
                pose_override=(0.0, 0.0))
            resp = {"ok": True, "table": [row.copy() for row in _wcs_cache]}
            if prov.get(p) == "cleared_mixed_angle":
                # Surface it: the operator mixed table poses in one fixture,
                # so the any-angle touch-off guarantee no longer holds for it
                # (the documented A=0 rule applies until a full re-touch).
                resp["provenance"] = {"index": p, "action": prov[p]}
            return resp

        return {"ok": False, "error": f"Unknown cmd: {cmd}"}

    except PermissionError as pe:
        return {"ok": False, "error": str(pe)}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}



# -----------------------------
# Viewer support (Web 3D)
# -----------------------------

# ── Config-fallback degraded state (issue #21) ──
# A unit-system or machine-geometry fallback is dangerous for a CNC, so it is
# surfaced to the operator (status_msg["config_warning"]) instead of silently
# becoming a normal default. Flags latch until a subsequent successful read.
_units_fallback_active = False
_units_fallback_reason = ""
_config_warning_active = False
_config_warning_reason = ""
# Viewer-config smells computed in build_viewer_init (review D4/D5): trt
# kins declared without INI-HALCMD pivot params, rotary axes on a model
# that articulates none. Rides the same config_warning banner; "" = clean.
_viewer_config_warning = ""
# Reserved-fixture-at-boot heal (2026-08-30): the previous session left
# G59..G59.3 active (Plane mode shut down / aborted) and the var file kept
# #5220. Evaluated ONCE, on the first status carrying a fixture index; the
# heal (a bare `G54`, a pure modal — no motion) runs when `ready` first
# opens. Rides the config_warning banner until then; "" = clean.
_reserved_fixture_warning = ""
_reserved_heal_checked = False
_reserved_heal_pending: Optional[int] = None
_reserved_heal_inflight = False
_reserved_heal_last_try = 0.0


def _reserved_fixture_heal_tick(st) -> None:
    """Status-loop hook: detect once, heal when the machine can take an MDI."""
    global _reserved_fixture_warning, _reserved_heal_checked, _reserved_heal_pending
    if not _reserved_heal_checked:
        if st.g5x_index is None:
            return
        _reserved_heal_checked = True
        try:
            idx = int(st.g5x_index)
        except (TypeError, ValueError):
            return
        if idx in (6, 7, 8, 9) and not st.twp_active and _kins_is_switchable():
            name = _WCS_NAMES[idx - 1] if 0 < idx <= len(_WCS_NAMES) else f"G5x[{idx}]"
            _reserved_heal_pending = idx
            _reserved_fixture_warning = (
                f"{name} (a TWP scratch row) was active at the last shutdown — "
                f"the DRO reads a dead plane frame; restoring G54 once the machine is homed")
            _trace.emit("twp.reserved_fixture_on_boot", level="warn", index=idx)
        return
    if _reserved_heal_pending is None or _reserved_heal_inflight:
        return
    if st.twp_active:
        # An orient happened first — the row is the live plane's now.
        _trace.emit("twp.reserved_fixture_heal_superseded", level="info",
                    index=_reserved_heal_pending)
        _reserved_heal_pending = None
        _reserved_fixture_warning = ""
        return
    if st.g5x_index is not None and int(st.g5x_index) not in (6, 7, 8, 9):
        # The operator (or a program) selected a fixture already.
        _trace.emit("twp.reserved_fixture_heal_superseded", level="info",
                    index=_reserved_heal_pending, now=int(st.g5x_index))
        _reserved_heal_pending = None
        _reserved_fixture_warning = ""
        return
    if not (st.permissions or {}).get("ready"):
        return
    if time.monotonic() - _reserved_heal_last_try < 5.0:
        return
    try:
        asyncio.get_running_loop().create_task(_reserved_fixture_heal())
    except RuntimeError as exc:  # no loop — should not happen in the status loop
        _trace.emit("twp.reserved_fixture_heal_failed", level="warn", error=repr(exc))


async def _reserved_fixture_heal() -> None:
    global _reserved_fixture_warning, _reserved_heal_pending, _reserved_heal_inflight
    global _reserved_heal_last_try
    _reserved_heal_inflight = True
    _reserved_heal_last_try = time.monotonic()
    try:
        if reject_if_auto_running():
            return
        await set_mode(linuxcnc.MODE_MDI)
        rc = await _cmd_blocking(CMD.mdi, "G54", wait=5)
        if _cmd_rc_failed(rc):
            _trace.emit("twp.reserved_fixture_heal_failed", level="warn",
                        index=_reserved_heal_pending, rc=rc)
            return
        _trace.emit("twp.reserved_fixture_healed", level="info", index=_reserved_heal_pending)
        _reserved_heal_pending = None
        _reserved_fixture_warning = ""
    except Exception as exc:  # noqa: BLE001 - a failed heal is loud, not fatal
        _trace.emit("twp.reserved_fixture_heal_failed", level="warn", error=repr(exc))
    finally:
        _reserved_heal_inflight = False


def _set_units_fallback(active: bool, reason: str = "") -> None:
    global _units_fallback_active, _units_fallback_reason
    if active and not _units_fallback_active:
        _trace.emit("config.units_fallback", level="warn", reason=reason)
    _units_fallback_active = active
    _units_fallback_reason = reason if active else ""


def get_machine_units() -> str:
    """Return 'in' or 'mm' based on INI [TRAJ]LINEAR_UNITS.

    Falling back to 'mm' is unit-ambiguous and unsafe for visualization/motion,
    so each fallback is surfaced via _set_units_fallback (issue #21) rather than
    silently returning a default.
    """
    if not STAT or not getattr(STAT, "ini_filename", None):
        _set_units_fallback(True, "no INI loaded")
        return "mm"
    try:
        lu = linuxcnc.ini(STAT.ini_filename).find("TRAJ", "LINEAR_UNITS")
        if not lu:
            _set_units_fallback(True, "[TRAJ]LINEAR_UNITS missing")
            return "mm"
        _set_units_fallback(False)
        return "in" if lu.strip().lower() in ("inch", "in", "imperial") else "mm"
    except Exception as e:
        _set_units_fallback(True, f"INI parse error: {type(e).__name__}")
        return "mm"


def _load_machine_config() -> dict:
    """Load machine model config from machine.json, or return hardcoded defaults."""
    global _config_warning_active, _config_warning_reason
    cfg_path = MACHINE_DIR / "machine.json"
    if cfg_path.exists():
        try:
            with open(cfg_path) as f:
                cfg = json.load(f)
            print(f"[VINIT] Loaded machine config: {cfg.get('name', '?')}", flush=True)
            # A successful (re)load clears any earlier machine.json warning —
            # the operator fixed the file; don't keep bannering the old state.
            _config_warning_active = False
            _config_warning_reason = ""
            return cfg
        except Exception as e:
            # Wrong geometry is an operator-visible degraded state, not a silent
            # default (issue #21).
            _trace.emit_exc("config.machine_json_load_failed", e, level="warn")
            _config_warning_active = True
            _config_warning_reason = f"machine.json load failed ({type(e).__name__}) — using default geometry"
    else:
        _trace.emit("config.machine_json_missing", level="warn", path=str(cfg_path))
        _config_warning_active = True
        _config_warning_reason = "machine.json missing — using default geometry"
    # Fallback: hardcoded defaults (original PM-25MV setup)
    return {
        "name": "Default",
        "groups": [
            {"id": "x", "parent": "root"},
            {"id": "y", "parent": "root"},
            {"id": "z", "parent": "y"},
            {"id": "tool", "parent": "z"},
        ],
        "parts": [
            {"id": "frame",  "file": "frame.stl",  "group": None, "translate": [-760, -122, -294]},
            {"id": "x_axis", "file": "x_axis.stl", "group": "x",  "translate": [319, 398, -244]},
            {"id": "y_axis", "file": "y_axis.stl", "group": "y",  "translate": [-140, 0, 21]},
            {"id": "z_axis", "file": "z_axis.stl", "group": "z",  "translate": [0, 0, 0]},
        ],
        "kinematics": [
            {"group": "x", "joint": 0, "direction": "x", "sign": -1},
            {"group": "y", "joint": 1, "direction": "y", "sign":  1},
            {"group": "z", "joint": 2, "direction": "z", "sign":  1},
        ],
        "workGroup": "x",
        "toolGroup": "tool",
    }


# machine.json is mtime-cached: edits (or the file appearing/disappearing)
# are picked up on the next viewer_init build — no gateway restart needed.
# The viewer_init cache key includes the mtime so stale payloads can't serve.
_machine_cfg: Dict[str, Any] = {}
_machine_cfg_mtime: Optional[float] = None


def _machine_json_mtime() -> float:
    try:
        return (MACHINE_DIR / "machine.json").stat().st_mtime
    except OSError:
        return 0.0


def get_machine_cfg() -> Dict[str, Any]:
    """Current machine model config, reloading machine.json when its mtime changes."""
    global _machine_cfg, _machine_cfg_mtime
    mtime = _machine_json_mtime()
    if _machine_cfg_mtime is None or mtime != _machine_cfg_mtime:
        _machine_cfg = _load_machine_config()
        _machine_cfg_mtime = mtime
    return _machine_cfg


_bt = time.monotonic()
_trace.emit(
    "boot.machine_config",
    dt_ms=round((time.monotonic() - _bt) * 1000, 1),
    name=get_machine_cfg().get("name", "?"),
)


def _stl_versioned(filename: str) -> str:
    """Append ?v=<mtime> for immutable browser caching with automatic invalidation."""
    p = MACHINE_DIR / filename
    mtime = int(p.stat().st_mtime) if p.exists() else 0
    return f"{filename}?v={mtime}"


_AXIS_LETTERS = "XYZABCUVW"


def _axes_from_mask(mask: int) -> List[str]:
    """Derive axis letter list from LinuxCNC axis_mask bitmask."""
    return [_AXIS_LETTERS[i] for i in range(9) if mask & (1 << i)]


#: Fixture index -> the stamp THIS GATEWAY believes it last wrote
#: ({"kins","a","x","y","z"}). Seeded from the var file at connect
#: (_ensure_prov_var_rows), updated only by successful stamps, dropped by
#: clears — the gateway is the only stamper by design, so this cannot go
#: stale w.r.t. its own writes; foreign writes are caught by comparing the
#: cached xyz against the live row (the falsifiability rule).
_prov_cache: Dict[int, Dict[str, float]] = {}
#: var-file paths whose provenance rows have been verified present.
_prov_rows_ensured: set = set()
#: None = not yet checked; False = seeding failed, stamps will NOT survive a
#: restart (announced at stamp time — see _stamp_wcs_provenance).
_prov_rows_ok: Optional[bool] = None


async def _stamp_wcs_provenance(indices, values_by_index,
                                wrote_all_xyz=True, prewrite_by_index=None,
                                pose_override=None):
    """Record the machine state each offset was established in (W1).

    LinuxCNC records nothing about this, and on a rotary machine the same
    three numbers mean different things depending on the table angle and
    the active kinematics. Without it, "touch off with A at 0" can only be
    a documented precondition; with it, a wrong touch-off is detectable.

    Stamped only for machines that HAVE an A rotary — on a 3-axis mill
    there is nothing that could go stale, and writing rows there would be
    noise an operator has to wonder about.

    `pose_override` = (kins, a): recorded IN PLACE of the live sample —
    including as input to the mixed-angle decision. A TYPED fixture value is
    a fixture-frame statement, not a measurement at the current pose, so
    set_wcs passes (0.0, 0.0) (table frame by definition; 2026-08-31,
    closing the decisions.md follow-up). Touch-offs keep the live sample:
    they ARE measurements at the current pose.

    The live pose is read from the JOINT, not from actual_position. Joints are
    the physical invariant and kinematics are labelings: under TOOL/TCP
    kins the world XYZ are relabeled, and while A happens to be passthrough
    in this kins family, recording a labeled value as if it were physical
    is exactly the class of mistake this whole feature exists to catch.

    `values_by_index` maps fixture index -> the RESULTING [x, y, z] triple;
    `prewrite_by_index` maps it to the triple BEFORE this write, and
    `wrote_all_xyz` says whether the write named all three axes. Together
    they feed wcs_stamp_decision: a PARTIAL write merging into components
    established at a different table pose has no single pose, so the fixture
    is CLEARED (loudly) instead of stamped with a confident lie — see the
    helper's docstring for the full matrix.

    Never raises into the caller: a failed stamp must not fail the
    touch-off the operator actually asked for. It is traced instead, and a
    missing stamp reads as "absent" downstream, which is honest.

    Returns {index: "stamped" | "cleared_mixed_angle" | "failed"} plus the
    pose recorded, for the caller to surface in its response.
    """
    out = {}
    try:
        STAT.poll()
        mask = int(getattr(STAT, "axis_mask", 0))
        if not (mask & (1 << 3)):
            return out  # no A axis: nothing to record
        if pose_override is not None:
            kins_val, a_val = float(pose_override[0]), float(pose_override[1])
            return await _stamp_wcs_rows(indices, values_by_index, wrote_all_xyz,
                                         prewrite_by_index, a_val, kins_val, out)
        # Joint index of A = configured axes below it (trivkins compaction,
        # the same layout canonical_to_joint_order documents). NEVER a
        # hardcoded 3: on XYZBC-style masks the slot moves. Gantry
        # duplicate-joint configs are outside this mapping (and outside the
        # proven envelope) — there joint_actual_position has more entries
        # than axes and no per-axis compaction exists.
        a_joint = bin(mask & 0b111).count("1")
        joints = getattr(STAT, "joint_actual_position", None)
        if not joints or len(joints) <= a_joint:
            _trace.emit("wcs.provenance_skipped", level="warn",
                        reason="no joint position")
            return out
        a_val = float(joints[a_joint])
        kins = _reader_get("kins_type")
        # A machine with no switchable kins is always identity: a known 0,
        # not a guess. A switchable machine whose reader snapshot is missing
        # is genuinely unknown — record NOTHING rather than a plausible 0,
        # so it reads as absent downstream instead of as a confident lie.
        if kins is None:
            if _kins_is_switchable():
                _trace.emit("wcs.provenance_skipped", level="warn",
                            reason="kins_type unavailable from reader")
                return out
            kins_val = 0.0
        else:
            kins_val = float(kins)
        return await _stamp_wcs_rows(indices, values_by_index, wrote_all_xyz,
                                     prewrite_by_index, a_val, kins_val, out)
    except Exception as exc:  # noqa: BLE001 - never break a touch-off
        _trace.emit("wcs.provenance_stamp_failed", level="warn", error=repr(exc))
    return out


async def _stamp_wcs_rows(indices, values_by_index, wrote_all_xyz,
                          prewrite_by_index, a_val, kins_val, out):
    """The shared stamp/clear row loop for _stamp_wcs_provenance — one
    implementation for both pose sources (live sample vs pose_override),
    so the mixed-angle decision can never diverge between them."""
    try:
        if _prov_rows_ok is False:
            # The rows could not be seeded into the var file, so whatever is
            # stamped now evaporates at the next LinuxCNC save/restart.
            # Announce that AT STAMP TIME — a stamp that will silently
            # degrade to "assumed A=0" later is the one non-fail-safe hole.
            _trace.emit("wcs.provenance_not_persistent", level="warn",
                        indices=list(indices))
        stamped_ok = []
        for p in indices:
            xyz = values_by_index.get(p)
            if xyz is None:
                continue
            prior = _prov_cache.get(p)
            prior_valid = False
            if prior is not None:
                pre = (prewrite_by_index or {}).get(p)
                # The prior stamp is believed only while its recorded triple
                # still matched the row this write replaced — a foreign G10
                # in between falsifies it.
                prior_valid = pre is not None and all(
                    abs(float(prior[k]) - float(pre[i])) <= 1e-6
                    for i, k in enumerate(("x", "y", "z")))
            action = wcs_stamp_decision(
                prior_valid,
                prior["a"] if prior else 0.0,
                prior["kins"] if prior else 0.0,
                a_val, kins_val, wrote_all_xyz)
            n = wcs_prov_params(p)
            if action == "clear":
                rc = await _cmd_blocking(
                    CMD.mdi, f"#{n['stamped']}=0.000000", wait=5)
                if _cmd_rc_failed(rc):
                    out[p] = "failed"
                    _trace.emit("wcs.provenance_stamp_failed", level="warn",
                                index=p, rc=rc, action="clear")
                    continue
                _prov_cache.pop(p, None)
                out[p] = "cleared_mixed_angle"
                _trace.emit("wcs.provenance_cleared_mixed_angle", level="warn",
                            index=p, current_a=a_val, current_kins=kins_val,
                            prior_a=prior["a"] if prior else None,
                            prior_valid=prior_valid)
                continue
            # The flag goes LAST: if this line is interrupted part-way the
            # record stays unflagged, and an incomplete record must read as
            # absent rather than as a half-truth.
            rc = await _cmd_blocking(
                CMD.mdi,
                f"#{n['kins']}={kins_val:.6f} #{n['a']}={a_val:.6f} "
                f"#{n['x']}={xyz[0]:.6f} #{n['y']}={xyz[1]:.6f} "
                f"#{n['z']}={xyz[2]:.6f} #{n['stamped']}={PROV_STAMPED:.6f}",
                wait=5)
            if _cmd_rc_failed(rc):
                # wait_complete said no (1) or timed out (-1): the record may
                # not exist. No success trace, no cache update — the next
                # decision must not believe a stamp that may not be there.
                out[p] = "failed"
                _trace.emit("wcs.provenance_stamp_failed", level="warn",
                            index=p, rc=rc, action="stamp")
                continue
            _prov_cache[p] = {"kins": kins_val, "a": a_val,
                              "x": float(xyz[0]), "y": float(xyz[1]),
                              "z": float(xyz[2])}
            out[p] = "stamped"
            stamped_ok.append(p)
        if stamped_ok:
            _trace.emit("wcs.provenance_stamped", level="info",
                        indices=stamped_ok, kins=kins_val, a=a_val)
    except Exception as exc:  # noqa: BLE001 - never break a touch-off
        _trace.emit("wcs.provenance_stamp_failed", level="warn", error=repr(exc))
    return out


async def _ensure_prov_var_rows() -> None:
    """Make the provenance parameter rows PERSIST, or say loudly they won't.

    LinuxCNC's parameter save keeps only rows already present in the var
    file — an MDI `#5231=...` writes interp memory, but the value survives a
    restart only if the row exists on disk. The shipped var templates carry
    the rows; a var file from before this feature (or another config's) does
    not, and a stamp made there would silently evaporate at shutdown — the
    one place where the "absent record → assume A=0" fallback is NOT
    fail-safe, because the operator touched off tilted and was told it
    worked.

    So at connect: verify all 54 rows exist in the live var file, append the
    missing ones as ZEROS (0 in the stamped slot IS the documented absent
    value — no data is invented) via the same atomic writer the probe vars
    use, and re-read to verify. Memoized per resolved path; the reconnect
    paths re-run it so an INI switch is re-checked. Failure sets
    _prov_rows_ok=False, which the stamper announces per-stamp.

    Also seeds _prov_cache from the rows found, so the mixed-angle decision
    knows about stamps made in previous sessions.
    """
    global _prov_rows_ok
    try:
        if STAT is None:
            return
        STAT.poll()
        if not (int(getattr(STAT, "axis_mask", 0) or 0) & (1 << 3)):
            return  # no A rotary: the stamp records nothing that can go stale
        path = _resolve_var_file_path()
        if not path or path in _prov_rows_ensured:
            return
        keys = [str(n) for i in range(1, 10)
                for n in wcs_prov_params(i).values()]
        have = await asyncio.to_thread(_read_var_file, path, set(keys))
        missing = [k for k in keys if k not in have]
        if missing:
            await asyncio.to_thread(
                _write_var_file_updates, path, {k: 0.0 for k in missing})
            _status_runtime.mark_var_file_written(path)
            re_read = await asyncio.to_thread(_read_var_file, path, set(missing))
            still = [k for k in missing if k not in re_read]
            if still:
                _prov_rows_ok = False
                _trace.emit("wcs.provenance_seed_failed", level="warn",
                            path=path, still_missing=len(still))
                return
            _trace.emit("wcs.provenance_rows_seeded", level="info",
                        path=path, count=len(missing))
        else:
            _trace.emit("wcs.provenance_rows_ok", level="info", path=path)
        _prov_rows_ok = True
        _prov_rows_ensured.add(path)
        for i in range(1, 10):
            n = wcs_prov_params(i)
            row = {k: have.get(str(v)) for k, v in n.items()}
            if row["stamped"] is None or \
                    abs(float(row["stamped"]) - PROV_STAMPED) > 1e-9:
                continue
            _prov_cache[i] = {k: float(row[k])
                              for k in ("kins", "a", "x", "y", "z")}
    except Exception as exc:  # noqa: BLE001 - a failed check must be loud, not fatal
        _prov_rows_ok = False
        _trace.emit("wcs.provenance_seed_failed", level="warn", error=repr(exc))


async def _settle_datum_after_m535(before, *, before_seq=None, timeout_s: float = 3.0,
                                   period_s: float = 0.05):
    """Wait for the helper's datum pins to reflect the G54 the remap just
    wrote (M535: G10 L2 P1 + saved_work_offset + gui_update_twp; the helper
    republishes at 20 Hz). Keyed on the datum-write EPOCH (2026-09-05):
    M535 bumps twp-datum-seq AFTER publishing the datum, the helper copies
    it LAST in its pass and the reader samples it FIRST, so a changed seq
    in a snapshot proves the datum in that snapshot is current — a touch-off
    landing on the SAME datum settles in one tick instead of burning the
    whole timeout (3089 / 3082 ms per same-datum touch-off, measured
    2026-09-03). A helper without the pin (seq None on either side) falls
    back to the value-keyed test, said once (twp.datum_seq_unavailable). On
    timeout the current value is adopted anyway with a warn trace, so a real
    lag stays loud through the chip. Unreadable pins → None (no seeding,
    traced). Never a dwell."""
    now = None
    now_seq = None
    t0 = time.monotonic()
    seq_said = False
    for _ in range(max(1, int(timeout_s / period_s))):
        # Same snapshot for both reads (no await between them).
        now_seq = _reader_get("twp_datum_seq")
        now = _status_runtime_mod.assemble_twp_datum(_reader_get)
        adv = _status_runtime_mod.datum_seq_advanced(before_seq, now_seq)
        if adv is True:
            _trace.emit("twp.datum_settled", ms=round((time.monotonic() - t0) * 1000),
                        seq_before=before_seq, seq_now=now_seq,
                        changed=_status_runtime_mod.datum_changed(before, now))
            return now
        if adv is None:
            if not seq_said:
                seq_said = True
                _trace.emit("twp.datum_seq_unavailable", level="warn",
                            seq_before=before_seq, seq_now=now_seq)
            if _status_runtime_mod.datum_changed(before, now) is True:
                return now
        await asyncio.sleep(period_s)
    if now is None:
        _trace.emit("twp.datum_unreadable", level="warn")
        return None
    _trace.emit("twp.datum_settle_timeout", level="warn", before=before, now=now,
                seq_before=before_seq, seq_now=now_seq)
    return now


def _adopt_m535_datum(datum, *, step: str) -> None:
    """After M535 wrote G54 through the plane: seed the gateway's G54 row and
    its provenance from the datum the remap published. Exact by M535's own
    contract — it writes G54 == saved_work_offset literally and stamps
    kins 0 / A 0 (table frame == machine frame), so the helper pins ARE the
    row. STAT cannot help (only the ACTIVE fixture's offset is broadcast,
    and G59 is active here) and the var file is written at shutdown."""
    if datum is None:
        _trace.emit("wcs.row_seed_skipped", level="warn", index=1, step=step,
                    reason="datum unreadable")
        return
    try:
        _status_runtime_mod.seed_wcs_row_xyz(_wcs_cache, 0, datum)
    except ValueError as exc:
        _trace.emit("wcs.row_seed_failed", level="warn", index=1, step=step, error=str(exc))
        return
    _prov_cache[1] = {"kins": 0.0, "a": 0.0,
                      "x": float(datum[0]), "y": float(datum[1]), "z": float(datum[2])}
    _trace.emit("wcs.row_seeded_from_datum", level="info", index=1, step=step,
                xyz=[float(v) for v in datum[:3]])


def _cmd_rc_failed(rc) -> bool:
    """Did a _cmd_blocking(..., wait=N) call fail? RCS_DONE (1) and the
    wait=None sentinel 0 are success; RCS_ERROR (3) and -1 (timeout) are
    not. RCS_EXEC (2) cannot come back from wait_complete with a timeout —
    it returns -1 instead — but is treated as failure too: not done is
    not done."""
    # getattr: the fake binding the dispatch tests run under has no RCS_*
    # constants (real value 1) — a bare attribute read turned every
    # rc check into an AttributeError reply (2026-09-04).
    return rc not in (0, getattr(linuxcnc, "RCS_DONE", 1))


def _kins_is_switchable() -> bool:
    """Does this machine have switchable kinematics at all?

    Distinguishes "identity, certainly" from "unknown" when the reader has
    no kins_type — the difference between a recordable fact and a guess.
    Same predicate that decides whether to sample motion.switchkins-type in
    the first place, so the two cannot disagree about what this machine is.
    """
    try:
        return kins_marker_policy(_parse_kins_decl()) != "ignore"
    except Exception:  # noqa: BLE001 - unknown beats a confident wrong answer
        return True


# Cache for build_viewer_init() output. Keyed on every input that can
# change at runtime: stl_base_url (per-client host header), INI path +
# mtime, STAT.axis_mask, STAT.max_velocity (frontend uses it as a jog-
# velocity fallback), and per-STL mtimes. With ~10 clients reconnecting
# in a storm, the second client onward gets a sub-µs cache hit instead
# of paying the file-I/O cost of re-parsing the INI per connect — the
# cost we measured at ~21 ms in [VINIT-T] worst-case. Bounded at 16
# entries so distinct host headers can't grow it without limit.
_viewer_init_cache: Dict[Tuple, Dict[str, Any]] = {}


def _viewer_init_cache_key(stl_base_url: str, cfg: Dict[str, Any], cfg_mtime: float) -> Tuple:
    ini_filename = getattr(STAT, "ini_filename", None) if STAT else None
    if ini_filename and os.path.exists(ini_filename):
        try:
            ini_mtime = int(os.path.getmtime(ini_filename))
        except OSError:
            ini_mtime = 0
    else:
        ini_mtime = 0
    stl_mtimes: Tuple[int, ...] = tuple(
        int((MACHINE_DIR / p["file"]).stat().st_mtime)
        if (MACHINE_DIR / p["file"]).exists() else 0
        for p in cfg.get("parts", [])
    )
    axis_mask = getattr(STAT, "axis_mask", 0) if STAT else 0
    max_v = safe_get("max_velocity", 0.0) or 0.0
    return (
        stl_base_url,
        ini_filename or "",
        ini_mtime,
        cfg_mtime,
        int(axis_mask),
        round(float(max_v), 3),
        stl_mtimes,
    )


def build_viewer_init(stl_base_url: str) -> Dict[str, Any]:
    """Build viewer init payload from machine.json config + INI-derived bounds.

    Result is cached on (stl_base_url, ini mtime, axis_mask, max_velocity,
    stl_mtimes). Storm of 10+ reconnecting clients pays the build cost
    once and then hits cache; cache invalidates automatically if the
    operator edits the INI, swaps a machine STL, or changes max_velocity
    via the UI."""
    # Cache lookup. Misses fall through to the existing build below.
    cfg = get_machine_cfg()
    _cache_key = _viewer_init_cache_key(stl_base_url, cfg, _machine_cfg_mtime or 0.0)
    _cached = _viewer_init_cache.get(_cache_key)
    if _cached is not None:
        _trace.emit("viewer_init.cache_hit", dt_ms=0)
        return _cached

    # Per-step timing collected for [CONN] probe; survives normal startup with
    # negligible cost (a few time.monotonic() calls).
    _bvi_t0 = time.monotonic()
    _bvi_steps: Dict[str, float] = {}

    def _mark(step: str, t0: float) -> None:
        _bvi_steps[step] = (time.monotonic() - t0) * 1000

    _t = time.monotonic()
    limits = read_machine_limits_from_ini(STAT) if STAT else None
    _mark("read_machine_limits", _t)
    if limits:
        bounds_origin, bounds_size = limits
    else:
        bounds_origin, bounds_size = [0, 0, 0], [0, 0, 0]

    _t = time.monotonic()
    units = get_machine_units()
    _mark("get_machine_units", _t)

    # Axis letters from axis_mask (e.g. XYZ=7, XYZAC=39). If LinuxCNC hasn't
    # connected yet, we ship no axes — the client waits for viewer_init before
    # rendering axis-dependent UI.
    _t = time.monotonic()
    if STAT:
        STAT.poll()
        axes = _axes_from_mask(STAT.axis_mask)
    else:
        axes = []
    _mark("stat_poll_axes", _t)

    # Build parts with cache-busted filenames
    parts = []
    for p in cfg.get("parts", []):
        parts.append({
            "id": p["id"],
            "file": _stl_versioned(p["file"]),
            "group": p.get("group"),
            "translate": p.get("translate"),
            "rotate": p.get("rotate"),
            # Optional default color [r,g,b] 0–1 from machine.json (STL has no
            # color channel); user per-part overrides still win client-side.
            "color": p.get("color"),
            # Optional stock flag: the ONE body class the tool may FEED into
            # (collision sweep cutting semantics). Machine parts never are.
            "stock": p.get("stock"),
        })

    # INI/static fields — delivered once per connect so the per-tick status
    # payload doesn't re-ship them to every client every cycle.
    _t = time.monotonic()
    ini_cfg = get_ini_config()
    _mark("get_ini_config", _t)
    ini_filename = getattr(STAT, "ini_filename", None) if STAT else None

    # Kins declaration (TCP+TWP plan phase 1d): module/type/identity_first/
    # pivot params, parsed from the INI — the single source that also
    # configures the real kins ([KINS]KINEMATICS + HALCMD setp lines).
    # Declaration only: the client STORES it but keeps trivkins for the
    # whole-track transform until phase 2 lands per-segment modes (and the
    # TLO-flow audit — the kins' tool-offset pin is live, wcs.tool already
    # carries it; activating without that audit would double-count TLO).
    kins_decl = _parse_kins_decl()

    # Viewer-config smells (review D4/D5) — banner-visible, never trace-only.
    # Recomputed on every cache-miss build; a cache hit keeps the previous
    # value (same inputs, same verdict).
    global _viewer_config_warning
    _viewer_config_warning = "; ".join(filter(None, [
        kins_pivot_warning(kins_decl),
        rotary_model_warning(axes, cfg.get("kinematics")),
    ]))
    if _viewer_config_warning:
        _trace.emit("viewer_init.config_warning", level="warn",
                    reason=_viewer_config_warning)

    ini_config = {
        "ini_filename": ini_filename,
        "linear_units": ini_cfg.get("linear_units"),
        "max_velocity": safe_get("max_velocity", None),
        "max_jog_velocity": get_max_jog_velocity(),
        "default_jog_velocity": ini_cfg.get("default_jog_velocity"),
        "min_jog_velocity": ini_cfg.get("min_jog_velocity"),
        "max_angular_jog_velocity": ini_cfg.get("max_angular_jog_velocity"),
        "default_angular_jog_velocity": ini_cfg.get("default_angular_jog_velocity"),
        "min_angular_jog_velocity": ini_cfg.get("min_angular_jog_velocity"),
        "increments": ini_cfg.get("increments"),
        "default_spindle_speed": ini_cfg.get("default_spindle_speed"),
        "min_spindle_speed": ini_cfg.get("min_spindle_speed"),
        "max_spindle_speed": ini_cfg.get("max_spindle_speed"),
        "min_spindle_override": ini_cfg.get("min_spindle_override"),
        "max_spindle_override": ini_cfg.get("max_spindle_override"),
        "max_feed_override": ini_cfg.get("max_feed_override"),
        "debug": ini_cfg.get("debug", False),
    }

    out = {
        "units": units,
        "stl_base_url": stl_base_url,
        "axes": axes,
        "machine_bounds": {
            "origin": bounds_origin,
            "size": bounds_size,
        },
        "groups": cfg.get("groups", []),
        "parts": parts,
        "kinematics": cfg.get("kinematics", []),
        "workGroup": cfg.get("workGroup"),
        "toolGroup": cfg.get("toolGroup"),
        "kins": kins_decl,
        "ini_config": ini_config,
    }
    _bvi_total = (time.monotonic() - _bvi_t0) * 1000
    _trace.emit(
        "viewer_init.timing",
        total_ms=round(_bvi_total, 1),
        steps={k: round(v, 1) for k, v in _bvi_steps.items()},
    )
    # Store under the same key we looked up with at the top.
    _viewer_init_cache[_cache_key] = out
    # Bounded cache — if a fleet of clients with distinct host headers
    # connects, evict oldest (insertion-order) so we don't grow forever.
    if len(_viewer_init_cache) > 16:
        _viewer_init_cache.pop(next(iter(_viewer_init_cache)))
    return out


def _build_wcs_rotation_patches() -> Dict[str, str]:
    """Build {param_number: str(value)} rotation patches for the parse worker.

    LinuxCNC only writes the var file on shutdown, so after a G10 L2 the disk
    copy is stale — for rotation AND for the axis offsets. Only rotation
    (base + 10) is patched today.

    UNITS, settled by experiment 2026-08-20 (the previous note here claimed the
    var file held "interpreter-internal units" and that _wcs_cache therefore
    mixed units — it does not, and that claim blocked patching axis offsets):
    on a stock INCH sim (LINEAR_UNITS=inch), `G10 L2 P1 X2.5` persisted as
    `#5221 = 2.500000` alongside `STAT.g5x_offset[0] = 2.5`; and with G21 in
    force — PROGRAM units millimetres — `G10 L2 P2 X63.5` persisted as
    `#5241 = 2.500000`. The var file stores MACHINE units, independent of
    program units. So _wcs_cache is uniform (var-file seed and STAT agree) and
    patching axis offsets is safe; see docs/decisions.md.
    """
    patches: Dict[str, str] = {}
    if not _wcs_cache:
        return patches
    for i, base in enumerate(_WCS_BASES):
        row = _wcs_cache[i]
        if not row:
            continue
        # Axis offsets (base+1 .. base+9) and rotation (base+10). Both in
        # MACHINE units on disk and in _wcs_cache — settled by experiment, see
        # the docstring. Patching the axis offsets too means the parse sees the
        # LIVE table, so a touch-off no longer leaves the preview parsed
        # against a stale on-disk value until LinuxCNC's next shutdown.
        for j, key in enumerate(_WCS_AXIS_KEYS):
            val = row.get(key)
            if isinstance(val, (int, float)):
                patches[str(base + 1 + j)] = f"{float(val):.6f}"
        if "r" in row:
            patches[str(base + 10)] = f"{row['r']:.6f}"
    return patches


# ---- Lifespan shutdown registry ----
# Long-lived tasks register themselves here so the FastAPI lifespan can cancel
# them on shutdown. uvicorn replaces our module-level signal handlers, so the
# only deterministic shutdown path is FastAPI's lifespan exit.
_shutting_down: bool = False
_bg_tasks: set[asyncio.Task] = set()

def register_bg_task(t: asyncio.Task) -> asyncio.Task:
    """Register a long-lived task so lifespan can cancel it. Returns the task."""
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)
    return t


@asynccontextmanager
async def lifespan(app: "FastAPI"):
    # A lifespan begins not-shutting-down. Production has one lifespan per
    # process; the in-process test harness opens many, and the flag set by
    # the previous teardown silently skipped every later disarm jog-stop
    # (found by test_arm_is_never_preempted, 2026-09-05).
    global _shutting_down
    _shutting_down = False
    _trace.emit("boot.lifespan_ready")
    # Asyncio loop exists only after lifespan startup — wire the
    # unhandled-task hook here so uvicorn's own handler is preserved.
    _trace.install_asyncio_handler("gateway")
    # === IDLE-GATEWAY DIAGNOSTICS === start the status poller from lifespan
    # rather than waiting for the first WS connect, so the [IDLE] log fires
    # during the pre-first-client window. The poller's `if not _clients`
    # branch sleeps cheaply, so running from boot is harmless.
    _start_status_poller()
    # Warm the machine-path caches now (both resolve from LCNC_INI_FILE, which the
    # launcher exports before uvicorn, and neither touches NML) so the first
    # /upload or tool op doesn't pay an INI parse / makedirs on the event loop (B4).
    try:
        get_nc_files_dir()
        get_tool_tbl_path()
    except Exception as e:
        _trace.emit_exc("boot.path_warmup_failed", e)
    # One-shot estop-loop writer check (review B2 stretch): runs after the
    # safety-chain grace window, feeds _safety_chain_reason's extra_reason.
    register_bg_task(asyncio.create_task(_estop_loop_check_once()))
    # Touch-off provenance rows: the boot-time try_connect_lcnc() ran before
    # the loop existed, so the reconnect-site registrations never fire for a
    # machine that was already up. Run the (memoized, connection-checked)
    # heal once here too.
    register_bg_task(asyncio.create_task(_ensure_prov_var_rows()))
    # Opt-in event-loop attribution (issue #35): with WEBUI_ASYNCIO_DEBUG=1 asyncio
    # logs "Executing <coro …> took N seconds" for any callback holding the loop
    # >50 ms (half the [HB-WAKE] threshold), naming the exact culprit behind a
    # stall. Off by default — asyncio debug mode adds per-callback overhead, an
    # observer effect on the hot path, so it's a diagnostic toggle, not always-on.
    if os.environ.get("WEBUI_ASYNCIO_DEBUG") == "1":
        try:
            _dbg_loop = asyncio.get_running_loop()
            _dbg_loop.slow_callback_duration = 0.05
            _dbg_loop.set_debug(True)
            _trace.emit("boot.asyncio_debug_enabled", level="warn", slow_callback_ms=50)
            print("[ASYNCIO-DEBUG] slow-callback logging enabled (>50ms)", flush=True)
        except Exception as e:
            _trace.emit_exc("boot.asyncio_debug_failed", e)
    # Optional (mmw#4): move the long-lived startup heap out of GC's reach. gen-2
    # (full-heap) collections scan every tracked object and freeze the loop while
    # they run; the startup set (modules, app, caches, viewer init) is never
    # garbage, so scanning it every gen-2 is pure waste (mmw#4 saw 3 of 4
    # collections free 0 objects). collect() first so startup cyclic garbage is
    # reclaimed (not frozen forever), then freeze() promotes the survivors to the
    # permanent generation — later gen-2 collections scan only post-startup allocs.
    # freeze() does NOT disable GC: refcounting is untouched and new objects still
    # flow gen0→1→2, so runtime memory (incl. post-startup cycles) is still fully
    # collected — the frozen set is a one-time snapshot, so this can't pile up over
    # time. Default OFF: it's a narrow optimization with a small risk (a startup
    # cycle that later dies is never reclaimed), so best practice is to A/B it on
    # the target (WEBUI_GC_FREEZE=1) — confirm gen-2 durations drop AND RSS stays
    # flat via the [GC] logs — then flip this default ON once proven.
    if os.environ.get("WEBUI_GC_FREEZE") == "1":
        try:
            _gc.collect()
            _gc.freeze()
            _trace.emit("boot.gc_frozen")
            print("[GC] froze startup heap — gen-2 now scans only new allocations", flush=True)
        except Exception as e:
            _trace.emit_exc("boot.gc_freeze_failed", e)
    yield
    # ---- Shutdown ----
    # Order matters. Each step is bounded so a stuck client/socket can't block
    # the rest. Total worst case ~5s — sized to fit uvicorn's
    # --timeout-graceful-shutdown 5 in the launcher.
    _shutting_down = True
    # Re-anchored to module-level _T0 so [SHUTDOWN] deltas line up with
    # [BOOT]/[CONN]/[SHUTDOWN-PROBE] on a single timeline.
    def _elapsed() -> str:
        return f"+{(time.monotonic() - _T0) * 1000:.0f}ms"
    print(f"[SHUTDOWN] {_elapsed()} lifespan teardown begin", flush=True)

    # 1. Notify all clients before tearing the connection.
    snapshot = list(_clients.values())
    if snapshot:
        try:
            await asyncio.wait_for(
                asyncio.gather(
                    *(ws_send_json(c.ws, {"type": "server_shutdown"}) for c in snapshot),
                    return_exceptions=True,
                ),
                timeout=0.5,
            )
        except asyncio.TimeoutError:
            print(f"[SHUTDOWN] {_elapsed()} server_shutdown broadcast timed out", flush=True)
        print(f"[SHUTDOWN] {_elapsed()} broadcast server_shutdown to {len(snapshot)} clients", flush=True)

    # 2. Close WS connections (1001 = going away).
    if snapshot:
        try:
            await asyncio.wait_for(
                asyncio.gather(
                    *(c.ws.close(code=1001) for c in snapshot),
                    return_exceptions=True,
                ),
                timeout=1.0,
            )
        except asyncio.TimeoutError:
            print(f"[SHUTDOWN] {_elapsed()} WS close timed out", flush=True)
        print(f"[SHUTDOWN] {_elapsed()} closed {len(snapshot)} WS connection(s)", flush=True)

    _shutdown_fusion_proc = _bulk.fusion_import_proc  # (fusion worker — same race as review #2)
    # Capture the in-flight parse handle BEFORE cancelling background tasks
    # (review #2): cancelling _bulk.refresh_gcode_preview runs its finally, which
    # clears _bulk.gcode_parse_proc — but the to_thread worker + subprocess keep
    # running. Reading the global in step 6 would then see None and orphan the
    # child. Hold the handle here so step 6 can still terminate it.
    _shutdown_parse_proc = _bulk.gcode_parse_proc

    # 3. Cancel background tasks. Must precede step 4: _disconnect_grace and
    # _heartbeat_loop continuously toggle the heartbeat field via _hal_send;
    # if still running when step 4 writes the deterministic LOW, the watchdog
    # could see a flipped value on the wire.
    if _bg_tasks:
        tasks = list(_bg_tasks)
        for t in tasks:
            t.cancel()
        try:
            await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=2.0,
            )
        except asyncio.TimeoutError:
            print(f"[SHUTDOWN] {_elapsed()} {sum(1 for t in tasks if not t.done())} bg task(s) did not finish in 2s", flush=True)
        print(f"[SHUTDOWN] {_elapsed()} cancelled {len(tasks)} bg tasks", flush=True)

    # 4. Final HAL state — deterministic LOW transition. hal_watchdog also
    # forces pins LOW on socket close (recv empty data), but explicit is
    # better here so the trip-latch / safety chain settles before halrun
    # unloads the watchdog component.
    try:
        _hal_send({"heartbeat": False, "connected": False})
        print(f"[SHUTDOWN] {_elapsed()} sent final HAL state heartbeat=False connected=False", flush=True)
    except Exception as e:
        print(f"[SHUTDOWN] {_elapsed()} final _hal_send failed: {e}", flush=True)

    # 5. Disconnect HAL sockets (must follow step 4 — _hal_send needs the socket).
    _hal_disconnect()
    await _hal_bridge.reader_aclose()
    print(f"[SHUTDOWN] {_elapsed()} HAL sockets disconnected", flush=True)

    # 6. Terminate the gcode parse subprocess if still alive, using the handle
    # captured before step 3 (review #2). _bulk_mod.terminate_parse_proc bounds the wait
    # (to_thread); terminating the child unblocks the orphaned communicate() thread.
    if _shutdown_fusion_proc is not None:
        try:
            await _bulk_mod.terminate_parse_proc(_shutdown_fusion_proc)
            print(f"[SHUTDOWN] {_elapsed()} fusion import worker handled", flush=True)
        except Exception as e:
            print(f"[SHUTDOWN] {_elapsed()} fusion worker terminate failed: {e}", flush=True)
    proc = _shutdown_parse_proc
    if proc is not None:
        try:
            await _bulk_mod.terminate_parse_proc(proc)
            print(f"[SHUTDOWN] {_elapsed()} gcode parse subprocess handled rc={proc.returncode}", flush=True)
        except Exception as e:
            print(f"[SHUTDOWN] {_elapsed()} gcode proc terminate failed: {e}", flush=True)

    # 7. Camera — awaitable broker shutdown stops the producer + releases the
    # device deterministically (review #4), instead of a fire-and-forget release.
    try:
        await _camera_broker.aclose()
        print(f"[SHUTDOWN] {_elapsed()} camera released", flush=True)
    except Exception as e:
        print(f"[SHUTDOWN] {_elapsed()} camera release failed: {e}", flush=True)

    print(f"[SHUTDOWN] {_elapsed()} lifespan teardown complete", flush=True)


app = FastAPI(lifespan=lifespan)
_trace.emit("boot.app_instantiated")

# CORS is defense-in-depth only — the WS Origin gate and the REST token
# dependency are the real boundary (issue #17). When an explicit allow-list is
# configured, honour it (plus dev origins); otherwise fall back to "*", since
# the gateway can't enumerate its own same-host origins at config time and the
# token (a custom header, never served cross-origin) is what actually gates.
_cors_origins = sorted(_ALLOWED_ORIGINS | _DEV_ORIGINS) if _ALLOWED_ORIGINS else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CacheStaticAssets:
    """Pure ASGI middleware — adds Cache-Control to /assets/ and /static/ responses."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        p = scope.get("path", "")
        if scope["type"] != "http" or not (p.startswith("/assets/") or p.startswith("/static/")):
            await self.app(scope, receive, send)
            return

        async def send_with_cache(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"cache-control", b"public, max-age=31536000, immutable"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_cache)

app.add_middleware(CacheStaticAssets)


@app.middleware("http")
async def trace_http(request: Request, call_next):
    """Phase-track + emit start/end for every HTTP request. Single hook
    covers all routes so we never miss one (the audit found 15+ routes
    that were uninstrumented under the old per-handler approach)."""
    t0 = time.monotonic()
    path = request.url.path
    method = request.method
    peer = "?"
    try:
        if request.client is not None:
            peer = f"{request.client.host}:{request.client.port}"
    except Exception:
        pass  # safe-silent: peer label is cosmetic, "?" is a fine fallback
    # Skip /assets and /static (served by StaticFiles, no instrumentation
    # value, and they fan out a lot during cold-load).
    if path.startswith("/assets/") or path.startswith("/static/"):
        return await call_next(request)
    _set_phase(f"http.{method}.{path}")
    # /telemetry is high-frequency, low-value diagnostics (best-effort browser
    # event batches). Emitting http.start + http.end for each one floods the
    # trace bus and was itself measurable event-loop load (P0.3). Skip the
    # routine pair for it; still surface slow (>50 ms) or error completions.
    is_telemetry = path == "/telemetry"
    if not is_telemetry:
        _trace.emit("http.start", path=path, method=method, peer=peer)
    status = 0
    try:
        resp = await call_next(request)
        try:
            status = int(getattr(resp, "status_code", 0) or 0)
        except Exception:
            status = 0
        return resp
    except Exception as e:
        _trace.emit("http.error", level="error", path=path, method=method,
                    peer=peer, exc=type(e).__name__, msg=str(e))
        raise
    finally:
        dur = (time.monotonic() - t0) * 1000
        if not is_telemetry or dur > 50 or status >= 400 or status == 0:
            level = "warn" if dur > 50 else "info"
            _trace.emit("http.end", level=level, path=path, method=method,
                        peer=peer, duration_ms=round(dur, 1), status=status)


# Serve static machine assets (STLs etc.)
# Always resolve relative to THIS FILE, not cwd

app.mount("/assets", StaticFiles(directory=str(MACHINE_DIR), html=False), name="assets")



@app.get("/health")
def health():
    # `armed_clients` lets a harness check, BEFORE it starts, whether anyone
    # can answer an M6: this config has no HAL loopback for the tool-change
    # half, so confirm_tool_change (armed-only) is the sole path and an
    # unattended run would otherwise just block. Counts, never identities.
    # _clients is Dict[int, ClientState] — iterate VALUES. (`getattr(c,
    # "armed", False)` over the dict silently counted zero armed clients
    # forever, which is the exact silent-fallback shape this endpoint exists
    # to eliminate; assert the attribute instead of defaulting it.)
    return {"ok": True,
            "clients": len(_clients),
            "armed_clients": sum(1 for c in _clients.values() if c.armed)}


@app.post("/telemetry")
async def telemetry(request: Request):
    """Browser → server telemetry sink.

    Body is NDJSON: one JSON object per line. Each event is forwarded to
    the trace bus tagged `browser.<event_kind>`. Designed to be cheap and
    survive partial / malformed batches: a bad line is dropped, not 500'd.
    Used by lcncWs.ts to report tab visibility, WS connect/disconnect,
    send-buffer pressure, and JS errors.

    Sized for ~1 KB / s / tab steady state with sendBeacon flushes on
    pagehide. Treat as untrusted: every field becomes a string in the
    trace, never executed or rendered raw.
    """
    raw = b""
    try:
        raw = await request.body()
    except Exception:
        return {"ok": False, "error": "body_read_failed"}
    if not raw:
        return {"ok": True, "events": 0}
    if len(raw) > TELEMETRY_BODY_MAX:
        # Bounded ingestion (M1): an arbitrary-size NDJSON body previously
        # expanded into unbounded parse work on this handler. Loud, not silent.
        _trace.emit("telemetry.body_oversized", level="warn", bytes=len(raw))
        return {"ok": False, "error": "body_too_large"}
    peer = "?"
    try:
        if request.client is not None:
            peer = f"{request.client.host}:{request.client.port}"
    except Exception:
        pass  # safe-silent: peer label is cosmetic, "?" is a fine fallback
    # Validation/parsing is pure + bounded (gateway_util.parse_telemetry_batch);
    # this handler keeps only transport concerns and the trace emission. Tags are
    # prefixed `browser.` so the merged trace makes the source obvious; fields
    # arrive JSON-decoded (strings/numbers/bools), never executed or rendered raw.
    events, rejected = parse_telemetry_batch(raw)
    for kind, fields in events:
        fields["peer"] = peer
        _trace.emit(f"browser.{kind}", **fields)
    return {"ok": True, "events": len(events), "rejected": rejected}


def _safe_unlink(path: str) -> None:
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass  # safe-silent: best-effort temp cleanup, already-gone is fine


# Injectable file opener for _atomic_stream_upload — tests substitute a blocking
# writer to exercise cancellation during an in-flight write (review #5).
_upload_file_opener = os.fdopen


async def _atomic_stream_write(chunks, dest_path: str, max_bytes: int) -> int:
    """Stream an async iterator of byte chunks to ``dest_path`` atomically and
    bounded, keeping the event loop free. Shared core for ``POST /upload``
    (multipart) and ``PUT /save`` (raw body) — one machinery, not two.

    Every blocking disk op (mkstemp/write/flush/fsync/close/replace/unlink) is
    offloaded via run_in_executor, so a slow disk, an fsync, or a large file
    can't stall the HAL heartbeat (#35). The body is never materialized whole —
    that also avoids the multi-MB allocation burst that feeds gen-2 GC (mmw#4).

    Bounded: rejects with 413 the instant the running byte count exceeds
    ``max_bytes`` (no oversized buffering). Atomic + durable: writes to a
    ``.part`` temp in the destination dir, fsyncs, then ``os.replace`` — and
    removes the temp on ANY failure, so LinuxCNC never sees a partial file.
    Returns the number of bytes written.
    """
    loop = asyncio.get_event_loop()
    dest_dir = os.path.dirname(dest_path) or "."
    # Dedicated single-thread executor so THIS request's file ops serialize on one
    # thread. If the coroutine is cancelled mid-write, the queued close/unlink run
    # AFTER the in-flight write finishes rather than racing it on another pool
    # thread (review #5). Uploads/saves are infrequent, so the thread is cheap.
    io_ex = ThreadPoolExecutor(max_workers=1, thread_name_prefix="upload-io")
    try:
        fd, tmp = await loop.run_in_executor(
            io_ex, lambda: tempfile.mkstemp(dir=dest_dir, suffix=".part")
        )
        written = 0
        try:
            f = _upload_file_opener(fd, "wb")
            try:
                async for chunk in chunks:
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > max_bytes:
                        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
                    await loop.run_in_executor(io_ex, f.write, chunk)
                await loop.run_in_executor(io_ex, lambda: (f.flush(), os.fsync(f.fileno())))
            finally:
                await loop.run_in_executor(io_ex, f.close)
            await loop.run_in_executor(io_ex, os.replace, tmp, dest_path)
            tmp = None  # published — don't unlink in finally
            return written
        finally:
            if tmp is not None:
                await loop.run_in_executor(io_ex, _safe_unlink, tmp)
    finally:
        io_ex.shutdown(wait=False)


async def _atomic_stream_upload(file: "UploadFile", dest_path: str,
                                max_bytes: int, chunk_size: int = 1 << 20) -> int:
    """Multipart-upload adapter over _atomic_stream_write: reads are async
    (Starlette's threadpool — yields to the loop between chunks)."""
    async def _chunks():
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                return
            yield chunk
    return await _atomic_stream_write(_chunks(), dest_path, max_bytes)


@app.post("/upload", dependencies=[Depends(require_token)])
async def upload_gcode(file: UploadFile = File(...)):
    """Upload a G-code file to the NC files directory."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    safe_name = sanitize_filename(file.filename)
    if not validate_extension(safe_name):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file extension. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    nc_dir = get_nc_files_dir()
    dest_path = os.path.join(nc_dir, safe_name)

    if not validate_path_within(dest_path, nc_dir):
        raise HTTPException(status_code=400, detail="Invalid filename")

    try:
        size = await _atomic_stream_upload(file, dest_path, MAX_UPLOAD_SIZE)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    return {"ok": True, "path": dest_path, "filename": safe_name, "size": size}


@app.put("/save", dependencies=[Depends(require_token)])
async def save_gcode(request: Request, path: str = Query(...)):
    """Save edited G-code content back to an existing file.

    The body is the RAW UTF-8 text, not JSON (#35): a 50 MB `JSON.stringify` on the
    browser main thread blocked it for seconds and starved the client heartbeat (the
    gateway never even saw the request — so it never showed as an HB-WAKE). Reading the
    raw body is async network I/O (no loop block), and it arrives already UTF-8-encoded,
    so there's no on-loop encode either. Only the atomic write+fsync is offloaded.
    """
    nc_dir = get_nc_files_dir()
    abs_path = os.path.abspath(path)

    if not validate_path_within(abs_path, nc_dir):
        raise HTTPException(status_code=400, detail="Path outside NC files directory")

    if not validate_extension(abs_path):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file extension. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="File not found")

    # Stream the raw UTF-8 body through the same bounded atomic chunk-writer as
    # /upload (one machinery, not two): the ≤50 MB body is never materialized as
    # one bytes object (request.body() buffered it whole in RAM), the size bound
    # rejects mid-stream, and write/fsync/replace serialize off the loop —
    # LinuxCNC never sees a half-written file.
    try:
        size = await _atomic_stream_write(request.stream(), abs_path, MAX_UPLOAD_SIZE)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    return {"ok": True, "path": abs_path, "size": size}


# ---- Fusion 360 Tool Library Import ----

@app.post("/import-tool-library", dependencies=[Depends(require_token)])
async def import_tool_library(file: UploadFile = File(...)):
    """Preview or apply a Fusion 360 tool library import.

    Query params:
      ?apply=true  — actually write to tool table + library (default: preview only)
      ?overwrite=true — overwrite existing tools (default: skip)
    """
    raw = await file.read(MAX_TOOL_LIBRARY_SIZE + 1)
    if len(raw) > MAX_TOOL_LIBRARY_SIZE:
        raise HTTPException(status_code=413, detail="Tool library too large (max 16 MB)")

    loop = asyncio.get_event_loop()
    machine_unit = get_ini_config().get("linear_units", "mm")  # on loop (cached; may STAT.poll once)
    try:
        parsed, skipped = await _bulk.decode_fusion_offloaded(raw, machine_unit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not parsed and not skipped:
        raise HTTPException(status_code=400, detail="No tools found in library")

    # Count existing tools for warning (file read off the loop)
    tbl_path = get_tool_tbl_path()
    existing_count = 0
    if tbl_path:
        try:
            existing_count = len(await loop.run_in_executor(None, parse_tool_table, tbl_path))
        except Exception as e:
            _trace.emit_exc("tool_tbl.recount_failed", e, tbl_path=tbl_path)

    # Build + JSON-encode the (potentially 60k-tool) response OFF the loop: the
    # harness showed the post-decode work was still tripping the watchdog after
    # the subprocess fix — the remaining ~600 ms was THIS: a 60k-dict copy loop
    # (pointless — `parsed` is wholly ours) plus FastAPI JSON-encoding the lot on
    # the event loop. One offloaded closure produces the final bytes.
    def _build_preview_body() -> bytes:
        skipped_preview = [{"T": t["T"], "description": t.get("description", ""),
                            "type": t.get("type", ""), "fusion_type": t.get("fusion_type", "")}
                           for t in skipped]
        return json.dumps({"ok": True, "tools": parsed, "total": len(parsed),
                           "existing_count": existing_count,
                           "skipped_duplicates": skipped_preview}).encode()

    body = await asyncio.to_thread(_build_preview_body)
    return Response(content=body, media_type="application/json")


@app.post("/import-tool-library/apply", dependencies=[Depends(require_token)])
async def apply_tool_library_import(
    file: UploadFile = File(...),
):
    """Apply a Fusion 360 tool library import — replaces tool.tbl and tool_library.json."""
    raw = await file.read(MAX_TOOL_LIBRARY_SIZE + 1)
    if len(raw) > MAX_TOOL_LIBRARY_SIZE:
        raise HTTPException(status_code=413, detail="Tool library too large (max 16 MB)")

    loop = asyncio.get_event_loop()
    machine_unit = get_ini_config().get("linear_units", "mm")  # on loop (cached; may STAT.poll once)
    try:
        parsed, _skipped = await _bulk.decode_fusion_offloaded(raw, machine_unit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not parsed:
        raise HTTPException(status_code=400, detail="No tools found")

    tbl_path = get_tool_tbl_path()
    if not tbl_path:
        raise HTTPException(status_code=500, detail="Tool table path not available")

    # Replace entire tool table and sidecar. The build loop is pure Python over
    # up-to-60k tools — off the loop (same harness finding as the preview route).
    def _build_apply_payload():
        tbl_tools = []
        library: dict = {}
        for tool in parsed:
            t_num = tool["T"]
            z_init = tool.get("body_length") or tool.get("oal") or 0.0
            tbl_tools.append({
                "T": t_num,
                "P": t_num,
                "Z": float(z_init),
                "D": tool["D"],
                "remark": tool.get("description", ""),
            })
            key = str(t_num)
            library[key] = {}
            for field in _TOOL_META_FIELDS:
                val = tool.get(field)
                if val is not None:
                    library[key][field] = val
            if tool.get("presets"):
                library[key]["presets"] = tool["presets"]
        return tbl_tools, library

    tbl_tools, library = await asyncio.to_thread(_build_apply_payload)

    # Serialize the whole replacement under _cmd_lock + off the event loop, so
    # it can't race the WS tool handlers or call into NML unlocked (issue #24).
    await _persist_imported_tools(tbl_path, tbl_tools, library)

    return {"ok": True, "added": len(parsed), "skipped": len(_skipped)}


@app.get("/files")
def list_files(subdir: str = ""):
    """List G-code files in the NC files directory."""
    nc_dir = get_nc_files_dir()
    browse_dir = os.path.join(nc_dir, subdir) if subdir else nc_dir

    if not validate_path_within(browse_dir, nc_dir):
        raise HTTPException(status_code=400, detail="Invalid directory")

    if not os.path.isdir(browse_dir):
        raise HTTPException(status_code=404, detail="Directory not found")

    entries = []
    try:
        for entry in sorted(os.scandir(browse_dir), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                entries.append({
                    "name": entry.name,
                    "type": "directory",
                    "path": os.path.relpath(entry.path, nc_dir),
                })
            elif entry.is_file():
                _, ext = os.path.splitext(entry.name)
                if ext.lower() in ALLOWED_EXTENSIONS:
                    stat = entry.stat()
                    entries.append({
                        "name": entry.name,
                        "type": "file",
                        "path": entry.path,
                        "size": stat.st_size,
                        "modified": stat.st_mtime,
                    })
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return {"ok": True, "nc_dir": nc_dir, "subdir": subdir, "entries": entries}


# ---- Fan-out instrumentation ----
# Counts how many bulk-payload HTTP requests are in flight at any moment so
# [FANOUT] log lines correlate with [HB-STALL] / [LAG] trips. Uses a simple
# lock because sync def endpoints run in starlette's threadpool.
_fanout_lock = threading.Lock()
_fanout_inflight: Dict[str, int] = {"comp_grid": 0, "preview": 0, "gcode": 0, "surface_points": 0}


def _fanout_enter(kind: str) -> int:
    with _fanout_lock:
        _fanout_inflight[kind] += 1
        return _fanout_inflight[kind]


def _fanout_exit(kind: str) -> int:
    with _fanout_lock:
        _fanout_inflight[kind] -= 1
        return _fanout_inflight[kind]


@app.get("/gcode")
def get_gcode(path: str):
    """Stream a G-code file as plain text so the frontend doesn't need the
    bytes inline in the viewer_gcode WS frame. Path is validated against the
    NC dir allow-list (same as program_open). Uvicorn's file-sendfile path
    runs separately from the WS writer, so bulk reads don't stall heartbeats.
    """
    nc_dir = get_nc_files_dir()
    abs_path = os.path.abspath(path)
    if not validate_path_within(abs_path, nc_dir):
        raise HTTPException(status_code=403, detail="Path outside NC dir")
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="File not found")
    _, ext = os.path.splitext(abs_path)
    if ext.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Invalid extension")
    t_start = time.monotonic()
    peak = _fanout_enter("gcode")
    try:
        return FileResponse(abs_path, media_type="text/plain")
    finally:
        _fanout_exit("gcode")
        handler_ms = (time.monotonic() - t_start) * 1000
        if peak > 1 or handler_ms > 50:
            print(
                f"[FANOUT] gcode peak={peak} handler_ms={handler_ms:.0f} "
                f"bytes={os.path.getsize(abs_path)}B file={os.path.basename(abs_path)}",
                flush=True,
            )


@app.get("/subfile")
def get_subfile(name: str):
    """Serve a called subroutine's source for the inline sub view (W5).

    `name` is the bare o-word name from the payload's marked-span
    sub_names; resolution walks the INI's [RS274NGC]SUBROUTINE_PATH dirs
    exactly like the interpreter does (first hit wins), with realpath
    containment so a symlink can never serve a file outside those dirs.
    """
    if not SUBFILE_NAME_RE.match(name or ""):
        raise HTTPException(status_code=400, detail="Invalid subroutine name")
    dirs = get_ini_config().get("subroutine_paths", [])
    path = resolve_subfile(name, dirs)
    if path is None:
        raise HTTPException(status_code=404, detail="Subroutine not found")
    return FileResponse(path, media_type="text/plain")


@app.get("/preview")
def get_preview(request: Request, v: Optional[int] = None):
    """Return the cached msgpack-encoded parsed G-code preview.

    The `v` query parameter is advisory — purely a cache-buster so the
    browser treats each version as a distinct URL. The server always returns
    the CURRENT cached preview (even if `v` is stale), because that's what
    the client wants anyway. Returns 404 if no file is loaded. If the client
    accepts gzip and a pre-compressed copy exists, serve that instead — both
    variants are produced once per parse, so per-fetch CPU stays at zero.
    """
    if not _bulk.preview_available():
        raise HTTPException(status_code=404, detail="No preview cached")
    t_start = time.monotonic()
    peak = _fanout_enter("preview")
    try:
        accept_enc = request.headers.get("accept-encoding", "")
        use_gzip = "gzip" in accept_enc and _bulk.preview_bytes_gz is not None
        if use_gzip:
            body = _bulk.preview_bytes_gz
        elif _bulk.preview_bytes is not None:
            body = _bulk.preview_bytes
        else:
            # Non-gzip client and the raw copy was dropped: decompress on demand.
            # This is a SYNC endpoint (threadpool), so the loop is untouched.
            # Loud, not silent — exotic clients paying ~100 ms is auditable.
            body = gzip.decompress(_bulk.preview_bytes_gz)  # type: ignore[arg-type]
            _trace.emit("preview.raw_decompress", level="info",
                        bytes=len(body), peer=str(request.client.host if request.client else "?"))
        headers = {
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Preview-Version": str(_bulk.preview_version),
            "Vary": "Accept-Encoding",
        }
        if use_gzip:
            headers["Content-Encoding"] = "gzip"
        return Response(
            content=body,
            media_type="application/x-msgpack",
            headers=headers,
        )
    finally:
        _fanout_exit("preview")
        handler_ms = (time.monotonic() - t_start) * 1000
        if peak > 1 or handler_ms > 50:
            print(
                f"[FANOUT] preview peak={peak} handler_ms={handler_ms:.0f} "
                f"bytes={_bulk.preview_raw_len}B v={_bulk.preview_version}",
                flush=True,
            )


@app.get("/surface_points")
def get_surface_points(v: Optional[int] = None):
    """Return the cached msgpack-encoded surface-scan points.

    Served off the WS writer so the 10-80 KB payload × N clients doesn't
    stall the event loop past the HAL heartbeat window. `v` is advisory —
    a cache-buster so each version is a distinct URL.
    """
    if _bulk.surface_bytes is None:
        raise HTTPException(status_code=404, detail="No surface data")
    t_start = time.monotonic()
    peak = _fanout_enter("surface_points")
    try:
        return Response(
            content=_bulk.surface_bytes,
            media_type="application/x-msgpack",
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Surface-Version": str(_bulk.surface_version),
            },
        )
    finally:
        _fanout_exit("surface_points")
        handler_ms = (time.monotonic() - t_start) * 1000
        if peak > 1 or handler_ms > 50:
            print(
                f"[FANOUT] surface_points peak={peak} handler_ms={handler_ms:.0f} "
                f"bytes={len(_bulk.surface_bytes)}B v={_bulk.surface_version}",
                flush=True,
            )


@app.get("/comp_grid")
def get_comp_grid(v: Optional[int] = None):
    """Return the cached msgpack-encoded compensation grid.

    Same pattern as /surface_points — keeps the up-to-~80 KB grid off the
    single-threaded WS writer.
    """
    if _bulk.grid_bytes is None:
        raise HTTPException(status_code=404, detail="No comp grid")
    t_start = time.monotonic()
    peak = _fanout_enter("comp_grid")
    try:
        return Response(
            content=_bulk.grid_bytes,
            media_type="application/x-msgpack",
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Comp-Grid-Version": str(_bulk.grid_version),
            },
        )
    finally:
        _fanout_exit("comp_grid")
        handler_ms = (time.monotonic() - t_start) * 1000
        if peak > 1 or handler_ms > 50:
            print(
                f"[FANOUT] comp_grid peak={peak} handler_ms={handler_ms:.0f} "
                f"bytes={len(_bulk.grid_bytes)}B v={_bulk.grid_version}",
                flush=True,
            )


# ---------- HAL viewer ----------

def _parse_hal_pins() -> list:
    """Parse `halcmd -s show pin` into list of dicts."""
    try:
        result = subprocess.run(
            ["halcmd", "-s", "show", "pin"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            _trace.emit("halcmd.show_pin_failed", level="warn",
                        rc=result.returncode, stderr=result.stderr.strip())
            return []
    except Exception as e:
        _trace.emit("halcmd.show_pin_raised", level="warn",
                    exc=type(e).__name__, msg=str(e))
        return []
    pins = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        entry = {
            "comp": parts[0],
            "type": parts[1],
            "dir": parts[2],
            "value": parts[3],
            "name": parts[4],
        }
        if len(parts) >= 7 and parts[5] in ("<==", "==>"):
            entry["signal"] = parts[6]
            entry["arrow"] = parts[5]
        pins.append(entry)
    return pins


def _parse_hal_signals() -> list:
    """Parse `halcmd -s show sig` into list of dicts."""
    try:
        result = subprocess.run(
            ["halcmd", "-s", "show", "sig"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            _trace.emit("halcmd.show_sig_failed", level="warn",
                        rc=result.returncode, stderr=result.stderr.strip())
            return []
    except Exception as e:
        _trace.emit("halcmd.show_sig_raised", level="warn",
                    exc=type(e).__name__, msg=str(e))
        return []
    signals = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        sig = {
            "type": parts[0],
            "value": parts[1],
            "name": parts[2],
            "pins": [],
        }
        i = 3
        while i < len(parts) - 1:
            if parts[i] in ("<==", "==>"):
                sig["pins"].append({"arrow": parts[i], "pin": parts[i + 1]})
                i += 2
            else:
                i += 1
        signals.append(sig)
    return signals


def _parse_hal_params() -> list:
    """Parse `halcmd -s show param` into list of dicts."""
    try:
        result = subprocess.run(
            ["halcmd", "-s", "show", "param"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            _trace.emit("halcmd.show_param_failed", level="warn",
                        rc=result.returncode, stderr=result.stderr.strip())
            return []
    except Exception as e:
        _trace.emit("halcmd.show_param_raised", level="warn",
                    exc=type(e).__name__, msg=str(e))
        return []
    params = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        params.append({
            "comp": parts[0],
            "type": parts[1],
            "dir": parts[2],
            "value": parts[3],
            "name": parts[4],
        })
    return params


async def _halshow_topology() -> dict:
    """Full HAL topology (pin/sig/param structure with links) via halcmd subprocess.

    Cached for the gateway lifetime (P5): the HAL graph is fixed at config load, so
    we build it ONCE (3 halcmd subprocesses) and reuse it for every subscriber —
    previously each new subscriber re-ran all three subprocesses. `_halshow_loop`
    processes subscribers sequentially, so the first cache-miss build completes
    before the next subscriber is served (no double-build). Force a rebuild via
    `_invalidate_halshow_topology()` (the `halshow_refresh` command), e.g. after an
    external HAL reload."""
    global _halshow_topology_cache
    if _halshow_topology_cache is not None:
        return _halshow_topology_cache
    loop = asyncio.get_event_loop()
    pins, signals, params = await asyncio.gather(
        loop.run_in_executor(None, _parse_hal_pins),
        loop.run_in_executor(None, _parse_hal_signals),
        loop.run_in_executor(None, _parse_hal_params),
    )
    _halshow_topology_cache = {"pins": pins, "signals": signals, "params": params}
    return _halshow_topology_cache


def _invalidate_halshow_topology() -> None:
    """Drop the cached HAL topology so the next subscriber rebuilds it (P5)."""
    global _halshow_topology_cache
    _halshow_topology_cache = None


async def _halshow_value_snapshot() -> dict:
    """Flat {'section/name': value-string} map via webui-reader's halshow_dump RPC.
    Reader runs hal.get_info_* in its own process (~1 ms typical, see hal-bench memory).
    Values arrive as halcmd-formatted strings so they merge cleanly with the topology snapshot."""
    out: Dict[str, str] = {}
    try:
        result = await _reader_request("halshow_dump", timeout=3.0)
        for name, value in result.get("pins", {}).items():
            out[f"pins/{name}"] = value
        for name, value in result.get("signals", {}).items():
            out[f"signals/{name}"] = value
        for name, value in result.get("params", {}).items():
            out[f"params/{name}"] = value
    except Exception as e:
        _trace.emit("halshow.value_snapshot_failed", level="warn",
                    exc=type(e).__name__, msg=str(e))
    return out


def _ensure_halshow_loop() -> None:
    """Start the live-update task if it isn't already running."""
    global _halshow_loop_task
    if _halshow_loop_task is None or _halshow_loop_task.done():
        _halshow_loop_task = register_bg_task(asyncio.create_task(_halshow_loop()))


async def _halshow_loop() -> None:
    """Push topology snapshot to new subscribers, then 5 Hz value deltas to all subscribers."""
    global _halshow_last_values
    try:
        while any(c.halshow_live for c in _clients.values()):
            # New subscribers: send full topology once
            for cid, c in list(_clients.items()):
                if not c.halshow_live:
                    continue
                if _halshow_topology_sent.get(cid):
                    continue
                ws = c.ws
                if ws is None:
                    continue
                topology = await _halshow_topology()
                try:
                    await ws_send_json(ws, {"type": "halshow_snapshot", **topology})
                    _halshow_topology_sent[cid] = True
                except Exception as e:
                    _trace.emit("halshow.snapshot_send_failed", level="warn",
                                client_id=cid, exc=type(e).__name__, msg=str(e))

            # Value diff for everyone with topology already in hand
            new_values = await _halshow_value_snapshot()
            if _halshow_last_values:
                delta = {k: v for k, v in new_values.items() if _halshow_last_values.get(k) != v}
                if delta:
                    msg: Dict[str, Any] = {"type": "halshow_update", "pins": {}, "signals": {}, "params": {}}
                    for k, v in delta.items():
                        section, name = k.split("/", 1)
                        msg[section][name] = v
                    for cid, c in list(_clients.items()):
                        if not c.halshow_live:
                            continue
                        if not _halshow_topology_sent.get(cid):
                            continue
                        ws = c.ws
                        if ws is None:
                            continue
                        try:
                            await ws_send_json(ws, msg)
                        except Exception as e:
                            _trace.emit_exc("ws.halshow_send_failed", e,
                                            client_id=cid)
            _halshow_last_values = new_values

            await asyncio.sleep(0.2)  # 5 Hz
    finally:
        # No subscribers (or task crashed) — drop baseline so the next subscribe starts clean
        _halshow_last_values = {}
        _halshow_topology_sent.clear()


def _read_g30_vars():
    """Read G30 tool change position (#5181-#5183) from the var file."""
    ini_path = getattr(STAT, "ini_filename", None)
    if not ini_path:
        return {"ok": False, "error": "No INI file"}
    ini = linuxcnc.ini(ini_path)
    var_file = ini.find("RS274NGC", "PARAMETER_FILE")
    if not var_file:
        return {"ok": False, "error": "No PARAMETER_FILE in INI"}
    if not os.path.isabs(var_file):
        var_file = os.path.join(os.path.dirname(ini_path), var_file)
    try:
        result = _read_var_file(var_file, {"5181", "5182", "5183"})
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "x": result.get("5181", 0.0), "y": result.get("5182", 0.0), "z": result.get("5183", 0.0)}


@app.get("/g30")
async def get_g30():
    """Return G30 tool change position (#5181-#5183)."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _read_g30_vars)


def _retrieve_task_exc(t: asyncio.Task) -> None:
    """Done-callback for per-command sub-tasks: retrieve the exception so a
    sub-task that fails while its worker is being cancelled is never logged
    as "Task exception was never retrieved" (crash.asyncio_unhandled). The
    worker reads it again via inflight.exception() — retrieval is idempotent."""
    if not t.cancelled():
        t.exception()


def _preempt_inflight(by: str, from_client: int) -> int:
    """abort/estop from ANY client cancels every client's in-flight non-stop
    handler (2026-09-05, docs/decisions.md). The cancel propagates into
    _cmd_blocking, which keeps _cmd_lock until the current wait slice
    returns — so the stop runs after the current NML call, not after a 30 s
    MDI wait. Stop-class commands and `arm` are never cancelled
    (_WS_NO_PREEMPT). The victim's worker replies "Preempted by <by>" and
    traces ws.command_preempted; this site traces the fan-out once."""
    victims = []
    now = time.monotonic()
    for cid, c in list(_clients.items()):
        t = c.cmd_inflight_task
        if t is None or t.done() or c.cmd_inflight in _WS_NO_PREEMPT:
            continue
        c.cmd_preempted_by = by
        t.cancel()
        victims.append({"client_id": cid, "cmd": c.cmd_inflight,
                        "ran_ms": round((now - c.cmd_inflight_since_mono) * 1000)})
    if victims:
        _trace.emit("ws.command_preempt", level="warn", by=by,
                    from_client=from_client, victims=victims)
    return len(victims)


async def _execute_client_command(client_id: int, client, ws: WebSocket, msg: Dict[str, Any]) -> None:
    """ONE queued command for ONE client — run by that client's cmd_worker in
    ws_endpoint, never by the reader (2026-09-03, see _WS_CMD_QUEUE_MAX).

    Verbatim the block that used to sit inline in the receive loop: the
    `arm` handshake (its disarm branch takes _cmd_lock for the jog-stop,
    which is exactly why it cannot stay in the reader) and the dispatch
    through handle_command with the bounded-error catch, the unload_file
    cache reset and the reply send. `client.armed` is read at EXECUTION
    time. `handle_command` resolves as a module global so tests can stand
    in a slow/raising handler.
    """
    if msg.get("cmd") == "arm":
        want_armed = bool(msg.get("armed", False))
        # Re-arm gate: operator must acknowledge a sticky safety trip
        # before the machine can come back up. Disarming is always
        # allowed.
        if want_armed and _unacked_trip is not None:
            await ws_send_json(ws, {
                "type": "reply",
                "ok": False,
                "error": "Safety trip not acknowledged",
            })
            return
        _was_armed = client.armed
        client.armed = want_armed
        client.last_hb = time.time()  # reset on arm change
        client.last_hb_mono = time.monotonic()
        # Symmetry with auto-disarm paths (Phase 2 / E1.2 + E2):
        # explicit disarm must jog-stop any in-flight jog from this
        # client AND register an armed-resume hold (so a deliberate
        # disarm-then-Ctrl-R can still restore armed state). Closes
        # the released-jog-button hazard and matches the "all paths
        # to disarmed do the same thing" principle.
        if _was_armed and not client.armed:
            if CMD is not None and not _shutting_down:
                try:
                    async with _get_cmd_lock():
                        await _jog_stop_for_client()
                except Exception as _e:
                    _trace.emit(
                        "safety.explicit_disarm_jog_stop_failed", level="error",
                        client_id=client_id, exc=type(_e).__name__, err=str(_e),
                    )
            _register_armed_resume_hold(client.session_id, client_id)
            _trace.emit(
                "safety.explicit_disarmed",
                client_id=client_id,
            )
        elif not _was_armed and client.armed:
            _trace.emit(
                "safety.explicit_armed",
                client_id=client_id,
            )
        await ws_send_json(ws, {"type": "reply", "ok": True, "armed": client.armed})
        return

    _set_phase(f"handle_command cmd={msg.get('cmd', '?')} client#{client_id}")
    try:
        reply = await handle_command(msg, client.armed)
    except (ValueError, TypeError, KeyError, PermissionError, OverflowError) as _val_e:
        # Malformed payload or failed precondition (bad numeric cast,
        # missing field, not-armed). Return a bounded structured error
        # rather than letting it bubble out of the receive loop — an
        # uncaught exception here would tear down the socket and trip
        # the armed-disconnect side effects in `finally` (issue #27).
        _trace.emit("ws.command_invalid", level="warn",
                    client_id=client_id, cmd=msg.get("cmd"),
                    exc=type(_val_e).__name__, msg=str(_val_e))
        reply = {"ok": False, "error": f"{type(_val_e).__name__}: {_val_e}"}
    else:
        if msg.get("cmd") == "unload_file" and reply.get("ok"):
            # reset_interpreter doesn't clear stat.file, so the shared
            # poller's file-change edge won't fire. Clear the shared
            # cache and bump the version so every client's status_loop
            # sends an empty viewer_gcode on the next cycle.
            _bulk.preview_pending = None
            _bulk.preview_bytes = None
            _bulk.preview_bytes_gz = None
            _bulk.preview_version += 1
            _bulk.last_file = None
            _bulk.last_mtime = None
    await ws_send_json(ws, {"type": "reply", "cmd": msg.get("cmd"), **reply})


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    _conn_t0 = time.monotonic()  # === LIFECYCLE DIAGNOSTICS anchor for [CONN] deltas ===
    # Per-client init under the WS-init semaphore. Released at block
    # exit (before the recv loop) so live connections aren't capped by
    # WEBUI_WS_INIT_CONCURRENCY. With cached build_viewer_init() this
    # is almost always a no-op; the limit only matters during a real
    # overload (e.g. >20 tabs reconnecting in lockstep).
    async with _ws_init_sem:
        await ws.accept()
        # ── Auth + origin gate (issue #17) ── reject BEFORE registering the
        # client or starting any background loop. Browsers always send Origin
        # on a WS handshake, so a foreign Origin that fails the check is a
        # cross-origin hijack attempt; the token gates non-browser clients.
        if not _ws_origin_ok(ws.headers.get("origin"), ws.headers.get("host")):
            _trace.emit("ws.auth_rejected", level="warn", peer=_peer_of(ws), reason="origin")
            await ws.close(code=1008)
            return
        if not token_ok(ws.query_params.get("token"), WEBUI_TOKEN):
            _trace.emit("ws.auth_rejected", level="warn", peer=_peer_of(ws), reason="token")
            await ws.close(code=1008)
            return
        global _next_client_id, _estop_hold, _unacked_trip
        global _last_fault_latched, _trip_baseline_seen
        client_id = _next_client_id
        _next_client_id += 1
        client_ip = ws.client.host if ws.client else "unknown"
        _clients[client_id] = ClientState(
            ip=client_ip,
            ws=ws,
            last_hb=time.time(),
            last_hb_mono=time.monotonic(),
        )
        client = _clients[client_id]  # M3 de-closure: per-connection state object
        await _cancel_disconnect_grace()
        _start_heartbeat()
        _start_status_poller()
        _start_reader_recv_loop()
        _trace.emit(
            "ws.connect.accept",
            client_id=client_id, peer=client_ip,
            accept_ms=round((time.monotonic() - _conn_t0) * 1000, 1),
        )

        # Restore lcnc_connected if LinuxCNC is still running but the flag was
        # cleared by a previous connection's WebSocket error
        global lcnc_connected
        _t = time.monotonic()
        _stat_path = "noop"
        if not lcnc_connected:
            if STAT is not None:
                try:
                    await asyncio.to_thread(STAT.poll)
                    lcnc_connected = True
                    _stat_path = "stat-poll"
                except Exception:
                    await asyncio.to_thread(try_connect_lcnc)
                    _stat_path = "stat-fail-reconnect"
            else:
                await asyncio.to_thread(try_connect_lcnc)
                _stat_path = "reconnect"
        _trace.emit(
            "ws.conn.lcnc_restored",
            client_id=client_id,
            dt_ms=round((time.monotonic() - _t) * 1000, 1),
            path=_stat_path,
            connected=lcnc_connected,
        )

        # Viewer init URL base. The viewer_init frame itself is sent ONCE per
        # connection, from status_loop's first successful poll (WS-B): the
        # post-poll send is the one guaranteed to carry live axis data, and
        # viewer_init_sent defaults False on ClientState. (Previously an
        # additional connect-time send fired here and the flag was then
        # unconditionally reset, so every connect double-sent viewer_init.)
        host = ws.headers.get("host", "127.0.0.1:8000")  # includes port
        # Use the gateway's own port (8000) for STL assets rather than the
        # client-facing port.  In dev the client connects via Vite:5173 whose
        # HTTP/1.1 proxy pool is shared with JS-chunk downloads — STL fetches
        # stall behind them.  Gateway has CORS allow_origins=["*"] so a
        # cross-origin fetch from :5173 → :8000 works fine.
        host_only = host.split(":")[0]
        stl_base_url = f"http://{host_only}:8000/assets/"

        # Send initial settings snapshot (part of WS handshake)
        _t = time.monotonic()
        try:
            _set_phase(f"load_settings client#{client_id}")
            _init_settings = await asyncio.get_event_loop().run_in_executor(None, load_settings)
            _set_phase(f"send_settings_init client#{client_id}")
            await ws_send_json(ws, {"type": "settings_init", "settings": _init_settings, "armed": client.armed})
            _trace.emit(
                "ws.connect.settings",
                client_id=client_id,
                settings_ms=round((time.monotonic() - _t) * 1000, 1),
            )
        except Exception as e:
            _trace.emit(
                "ws.connect.settings", level="error",
                client_id=client_id, exc=type(e).__name__, msg=str(e),
            )

        # Send initial G-code ping if a file is already loaded. The full preview
        # payload (feed/rapid polylines, stats) is served over HTTP via GET
        # /preview — we only broadcast a tiny "ready" notification over the WS
        # so each client can fetch the cached msgpack bytes out of band.
        # Cold path (file loaded but not yet parsed): schedule a refresh; the
        # client's status_loop picks up the ping on the next version bump.
        # File *content* is fetched separately via GET /gcode.
        _init_preview_ver = _bulk.preview_version
        _t = time.monotonic()
        _gcode_path = "no-file"
        try:
            if STAT is not None:
                STAT.poll()
            initial_file = safe_get("file", None)
            if initial_file:
                cache_hit = (
                    _bulk.preview_pending is not None
                    and _bulk.preview_pending.get("file") == initial_file
                    and _bulk.preview_available()
                )
                if cache_hit:
                    await ws_send_json(ws, {
                        "type": "viewer_gcode_ready",
                        "version": _bulk.preview_version,
                        "file": initial_file,
                    })
                    _gcode_path = "cache-hit-sent"
                elif _bulk.schedule_refresh(initial_file, "connect", _spawn_preview_task):
                    _gcode_path = "refresh-scheduled"
                else:
                    _gcode_path = "refresh-already-running"
        except Exception as e:
            print(f"Error loading initial G-code: {e}")
        _trace.emit(
            "ws.conn.gcode_ping_sent",
            client_id=client_id,
            dt_ms=round((time.monotonic() - _t) * 1000, 1),
            path=_gcode_path,
        )
        _trace.emit(
            "ws.conn.ready",
            client_id=client_id,
            total_ms=round((time.monotonic() - _conn_t0) * 1000, 1),
        )

        async def status_loop():
            _set_phase(f"status_loop.entry client#{client_id}")
            global _tool_meta_dirty, _fb_scale, _spindle_load_pin
            loop = asyncio.get_event_loop()
            _last_settings_ver = _settings_store.version
            _last_gen = 0  # tracks which _status_gen we last processed
            _consec_fails = 0  # consecutive status_loop exceptions — bail after 10
            # Spindle feedback scale: 60 if pin outputs RPS (default), 1 if RPM
            _ss_init = await asyncio.to_thread(load_settings)  # file read off the loop (B3)
            _machine_s = _ss_init.get("machine", {})
            _fb_scale = 1 if _machine_s.get("spindleFeedbackUnit") == "rpm" else 60
            _slp = _machine_s.get("spindleLoadPin", "")
            _spindle_load_pin = _slp if isinstance(_slp, str) and _HAL_PIN_RE.match(_slp) else ""
            _prev_send_ms = 0.0  # send_ms from previous cycle (sent in next message)
            _prev_encode_ms = 0.0  # encode_ms from previous cycle (wire-format serialise time)
            _last_surface_version = 0  # tracks which _bulk.surface_version was last sent to this client
            _last_comp_grid_version = 0  # tracks which _bulk.grid_version was last sent to this client
            _last_tool_table_version = 0  # tracks which _tool_table_version was last sent to this client
            _last_gcode_preview_version = _init_preview_ver  # initialized from connect-time snapshot
            # Experiment 2: status-delta per-client state
            _last_status_data: Optional[Dict[str, Any]] = None
            _cycles_since_full = 0
            while True:
                try:
                    # Not connected — disarm and send error to this client
                    if not lcnc_connected:
                        if client.viewer_init_sent:
                            client.viewer_init_sent = False
                        if client.armed:
                            client.armed = False
                        try:
                            await ws_send_json(ws, {
                                "type": "status_error",
                                "error": "LinuxCNC not connected",
                                "clients": [{"ip": c.ip, "armed": c.armed} for c in _clients.values()],
                                "armed": client.armed,
                            })
                        except Exception:
                            break
                        await asyncio.sleep(2.0)
                        continue

                    # Wait for new data from shared poller. Awaiting the broadcast
                    # event replaces a 500Hz tight-poll — wakeups now match the
                    # actual poll rate (~30Hz). The 1s timeout is a safety net:
                    # if the poller stalls, we re-check and fall through to the
                    # "poller not running" branch above on the next iteration.
                    if _status_gen == _last_gen:
                        evt = _status_event
                        if evt is None:
                            # Poller hasn't emitted its first event yet.
                            await asyncio.sleep(0.05)
                            continue
                        try:
                            await asyncio.wait_for(evt.wait(), timeout=1.0)
                        except asyncio.TimeoutError:
                            pass  # re-check on next iteration
                        continue
                    _last_gen = _status_gen
                    pickup_ts = time.monotonic()
                    # Phase-mark the per-client build (#35 fanout): with delta on,
                    # _use_shared is False so each client copies the shared dict
                    # (6005) + runs _diff_status_data (6066) + encodes its own
                    # frame — the suspected steady-state stall. If this phase
                    # dominates a lag.window, the fix is delta-off (shared-encode)
                    # or a cheaper diff. ws_send_measured re-phases for encode/send.
                    _set_phase("status_loop.build")

                    # Slow-consumer / hidden-tab skip: if a previous tick's
                    # send to this client is still in flight, OR the client's
                    # tab is backgrounded, skip building and sending status
                    # this tick. Bounds per-client outstanding work to one
                    # send and removes hidden tabs (the storm trigger) from
                    # the fan-out entirely. Loop continues to the next iter
                    # and re-waits on _status_event for the next tick.
                    _client_state = _clients.get(client_id)
                    if _client_state is not None and (
                        _client_state.send_pending or _client_state.hidden
                    ):
                        continue

                    st = _shared_status
                    if st is None:
                        await asyncio.sleep(0.5)
                        continue

                    # The ONE viewer_init per connection (WS-B): sent on the first
                    # successful poll, so it always carries live axis data. Also
                    # re-fires after a LinuxCNC reconnect (the not-connected branch
                    # above resets viewer_init_sent).
                    if not client.viewer_init_sent:
                        print(f"[VINIT] client#{client_id} sending viewer_init (post-poll), STAT={'OK' if STAT else 'None'}", flush=True)
                        _t = time.monotonic()
                        try:
                            _set_phase(f"build_viewer_init client#{client_id}")
                            await ws_send_json(ws, {"type": "viewer_init", "data": build_viewer_init(stl_base_url)})
                            client.viewer_init_sent = True
                            _trace.emit(
                                "ws.conn.viewer_init",
                                client_id=client_id,
                                dt_ms=round((time.monotonic() - _t) * 1000, 1),
                                since_accept_ms=round((time.monotonic() - _conn_t0) * 1000, 1),
                            )
                        except Exception as e:
                            _trace.emit(
                                "ws.conn.viewer_init", level="error",
                                client_id=client_id, exc=type(e).__name__, msg=str(e),
                            )

                    # Merge shared probe updates into per-client results
                    if _shared_probe_updates:
                        client.probe_results.update(_shared_probe_updates)

                    # Build status message. When the wire format is msgpack and no
                    # delta is active, splice the poller's pre-encoded bytes via
                    # msgspec.Raw instead of re-encoding an identical dict for each
                    # client. tool_meta now lives at top-level (not inside data),
                    # so tool-change ticks no longer mutate the shared dict and the
                    # shared-encode path stays engaged.
                    _tool_meta_tick = (st.tool_number != client.prev_tool_num or _tool_meta_dirty)
                    _use_shared = (
                        _WIRE_FORMAT == "msgpack"
                        and not _STATUS_DELTA_ENABLED
                        and _shared_status_data_msgpack is not None
                    )
                    if _use_shared:
                        status_data: Any = _msgspec.Raw(_shared_status_data_msgpack)
                    else:
                        status_data = _shared_status_dict.copy() if _shared_status_dict else st.__dict__.copy()
                    # Envelope assembly moved to ws_fanout.build_status_envelope
                    # (M3): safety metadata is named in the call — when trip /
                    # stale / config-warning state rides the frame, it's visible
                    # right here, not implied by a bus subscription.
                    status_msg: dict = _ws_fanout_mod.build_status_envelope(
                        status_data=status_data,
                        errors=_shared_errors,
                        clients_list=_shared_clients_list,
                        armed=client.armed,
                        safety_trip=_unacked_trip,
                        reader_stale=_reader_is_stale(),
                        safety_chain=_safety_chain_reason(),
                        preview_refresh=_bulk.preview_refresh_status(),
                        config_warning=(
                            {
                                "reason": (_config_warning_reason or _units_fallback_reason
                                           or _viewer_config_warning
                                           or _reserved_fixture_warning),
                                "units": _units_fallback_active,
                            }
                            if (_units_fallback_active or _config_warning_active
                                or _viewer_config_warning
                                or _reserved_fixture_warning) else None
                        ),
                        probe_results=client.probe_results,
                        rfl_status=_rfl_status,
                    )

                    # Inject tool_meta on tool_number change or library edit (for
                    # 3D rendering). Lives at top level — sibling of `data` — so
                    # the shared-encode of `data` stays valid every tick.
                    if _tool_meta_tick:
                        client.prev_tool_num = st.tool_number
                        _tool_meta_dirty = False
                        if st.tool_number is not None:
                            try:
                                # Hot path (per tool-number change × client): read
                                # off the loop. ToolLibraryStore is mtime-cached and
                                # now lock-guarded (B3), so this is safe against a
                                # concurrent WS tool-command write on another thread.
                                _lib = await asyncio.to_thread(load_tool_library)
                                _meta = _lib.get(str(st.tool_number), {})
                                if _meta:
                                    _tm = {k: _meta[k] for k in (
                                        "type", "oal", "flute_length", "shoulder_length",
                                        "shoulder_diameter", "body_length",
                                        "shaft_diameter", "taper_angle",
                                        "point_angle", "tip_diameter", "corner_radius",
                                        "holder_segments", "stl_file",
                                    ) if k in _meta}
                                    if _tm:
                                        status_msg["tool_meta"] = _tm
                            except (KeyError, TypeError, OSError) as e:
                                _trace.emit("status.tool_meta_failed", level="warn",
                                            tool=st.tool_number, exc=type(e).__name__, msg=str(e))

                    # Experiment 2: delta encoding of the `data` field.
                    # After all mutations to status_msg["data"] are done, compare
                    # against this client's last-sent baseline and swap the full
                    # dict for a diff when delta mode is on. On a forced-full
                    # cadence (every _DELTA_FULL_INTERVAL cycles) or first send,
                    # stay with the full payload. `errors`, `clients`, `timing`,
                    # `surface_points`, etc. always go through as-is — they're
                    # already sparse or cheap.
                    if _STATUS_DELTA_ENABLED:
                        if _last_status_data is None or _cycles_since_full >= _DELTA_FULL_INTERVAL:
                            _cycles_since_full = 0
                        else:
                            status_msg["type"] = "status_delta"
                            status_msg["data"] = _diff_status_data(_last_status_data, status_msg["data"])
                            _cycles_since_full += 1
                        _last_status_data = status_data

                    # Timing: only on first status after heartbeat so all
                    # components share the same ~1Hz sample rate.
                    # Two exact sums:
                    #   RT = Network + Server  (client-side, by construction)
                    #   Cycle = Poll + Errors + Parse + Overhead  (server-side)
                    hb_mono = _clients[client_id].hb_mono if client_id in _clients else 0.0
                    if hb_mono > 0:
                        status_msg["timing"] = {
                            "server_ms": round((time.monotonic() - hb_mono) * 1000, 2),
                            "cycle_ms": _shared_timing.get("cycle_ms", 0),
                            "poll_ms": _shared_timing.get("poll_ms", 0),
                            "errors_ms": _shared_timing.get("errors_ms", 0),
                            "parse_ms": _shared_timing.get("parse_ms", 0),
                            "overhead_ms": _shared_timing.get("overhead_ms", 0),
                            # shared_encode_ms: cost of the poller's one-per-tick
                            # msgpack pre-encode that each client's envelope
                            # splices via msgspec.Raw. Keeps the Debug tab honest
                            # — per-client encode_ms drops to envelope-only when
                            # shared-encode is active, masking the shared cost.
                            "shared_encode_ms": _shared_timing.get("shared_encode_ms", 0),
                            # Prior-cycle encode time (status_msg built before the
                            # encode happens → we attach the last known value).
                            # ws_bytes is measured client-side from the received frame.
                            "encode_ms": _prev_encode_ms,
                        }
                        if client_id in _clients:
                            _clients[client_id].hb_mono = 0.0

                    pre_send = time.monotonic()
                    # Mark the client as having an in-flight send. Cleared in
                    # finally so even an exception path doesn't leave the flag
                    # stuck (which would silently mute future fan-out for this
                    # client). The skip check at the top of the loop reads this
                    # flag to bound outstanding work to one send per peer.
                    if client_id in _clients:
                        _clients[client_id].send_pending = True
                    try:
                        _prev_encode_ms, _bytes_sent = await ws_send_measured(ws, status_msg)
                    finally:
                        if client_id in _clients:
                            _clients[client_id].send_pending = False
                    _prev_send_ms = round((time.monotonic() - pre_send) * 1000, 2)

                    # Contribute to per-tick aggregate stats (logged by poller on
                    # next cycle). Only record for the current generation to avoid
                    # double-counting if a client is slow and rolls into next tick.
                    if _status_tick_stats["gen"] == _last_gen:
                        _status_tick_stats["done"] += 1
                        _status_tick_stats["encode_sum"] += _prev_encode_ms
                        _status_tick_stats["send_sum"] += _prev_send_ms
                        if _prev_send_ms > _status_tick_stats["send_max"]:
                            _status_tick_stats["send_max"] = _prev_send_ms
                        # === STATUS-PAYLOAD DIAGNOSTICS === wire-size accounting.
                        _status_tick_stats["bytes_sum"] += _bytes_sent
                        if _bytes_sent > _status_tick_stats["bytes_max"]:
                            _status_tick_stats["bytes_max"] = _bytes_sent
                        if "tool_meta" in status_msg:
                            _status_tick_stats["tool_meta_count"] += 1

                    # Log timing to file if enabled
                    if _timing_log_enabled and "timing" in status_msg:
                        _log_timing({**status_msg["timing"], "send_ms": _prev_send_ms})

                    # Settings broadcast: send full settings when version changes
                    if _last_settings_ver != _settings_store.version:
                        _last_settings_ver = _settings_store.version
                        try:
                            _ss = await loop.run_in_executor(None, load_settings)
                            _machine_s = _ss.get("machine", {})
                            _fb_scale = 1 if _machine_s.get("spindleFeedbackUnit") == "rpm" else 60
                            _slp = _machine_s.get("spindleLoadPin", "")
                            _new_load_pin = _slp if isinstance(_slp, str) and _HAL_PIN_RE.match(_slp) else ""
                            if _new_load_pin != _spindle_load_pin:
                                _spindle_load_pin = _new_load_pin
                                asyncio.create_task(_reader_configure_extra_pins())
                            await ws_send_json(ws, {
                                "type": "settings_changed",
                                "settings": _ss,
                                "armed": client.armed,
                            })
                        except (OSError, json.JSONDecodeError, ValueError) as e:
                            _trace.emit("status.settings_changed_broadcast_failed", level="warn",
                                        exc=type(e).__name__, msg=str(e))

                    # Tool change: auto-deassert when request clears
                    if client.prev_tc_req and not st.tool_change_requested:
                        _hal_send({"tool_changed": False})
                    client.prev_tc_req = st.tool_change_requested

                    # Viewer: gcode preview — send a tiny "ready" ping so each
                    # client fetches the cached msgpack bytes via GET /preview.
                    # Broadcasting the full (multi-MB) frame to every client on
                    # the single-threaded WS writer stalled the event loop past
                    # the HAL heartbeat window. File content is fetched via
                    # GET /gcode; preview data is fetched via GET /preview.
                    if _bulk.preview_version != _last_gcode_preview_version:
                        _last_gcode_preview_version = _bulk.preview_version
                        pending = _bulk.preview_pending
                        if _bulk.preview_available() and pending is not None:
                            try:
                                await ws_send_json(ws, {
                                    "type": "viewer_gcode_ready",
                                    "version": _bulk.preview_version,
                                    "file": pending.get("file"),
                                })
                            except RuntimeError:
                                pass  # safe-silent: WS closed between iteration start and send
                        else:
                            await ws_send_json(ws, {
                                "type": "viewer_gcode",
                                "data": {"file": None, "feed": [], "feed_lines": [], "rapid": []},
                            })

                    # Surface points: cached msgpack lives on the server; send a
                    # tiny version ping so each client fetches via GET /surface_points
                    # off the WS writer.
                    if _bulk.surface_version != _last_surface_version:
                        _last_surface_version = _bulk.surface_version
                        if _bulk.surface_bytes is not None:
                            try:
                                await ws_send_json(ws, {
                                    "type": "surface_points_ready",
                                    "version": _bulk.surface_version,
                                })
                            except RuntimeError:
                                pass  # safe-silent: WS closed between iteration start and send

                    # Compensation grid: same pattern — fetch via GET /comp_grid.
                    if _bulk.grid_version != _last_comp_grid_version:
                        _last_comp_grid_version = _bulk.grid_version
                        if _bulk.grid_bytes is not None:
                            try:
                                await ws_send_json(ws, {
                                    "type": "comp_grid_ready",
                                    "version": _bulk.grid_version,
                                })
                            except RuntimeError:
                                pass  # safe-silent: WS closed between iteration start and send

                    # Tool table: ping clients to refetch via WS RPC `get_tool_table`.
                    # Bumped by _reload_tool_table_and_bump() after every save/add/
                    # delete/import. Initial connect resyncs because _last_*=0.
                    if _tool_table_version != _last_tool_table_version:
                        _last_tool_table_version = _tool_table_version
                        try:
                            await ws_send_json(ws, {
                                "type": "tool_table_changed",
                                "version": _tool_table_version,
                            })
                        except RuntimeError:
                            pass  # safe-silent: WS closed between iteration start and send

                    # Heartbeat timeout — per-client liveness signal.
                    #
                    # Per the architecture cleanup: a client-side heartbeat
                    # stall is NOT a safety event. It is a UI event. The HAL
                    # chain (oneshot.0 + trip-latch) is the real safety, and
                    # it independently trips on gateway hang or all-clients-out.
                    # Stalling on one armed client while others (or even just
                    # viewers) keep the HAL chain alive must NOT abort a
                    # running program. So: disarm the client + jog-stop any
                    # in-flight jog from this client. No program abort.
                    if client_id in _clients:
                        # Monotonic aging: an NTP wall-clock step (+2.9 s observed
                        # on this VM, 2026-08-11) made time.time()-last_hb blow the
                        # 3 s budget while heartbeats arrived on schedule → false
                        # disarm. time.monotonic() is immune in both directions
                        # (a backward step also can't keep a dead client "fresh").
                        if time.monotonic() - _clients[client_id].last_hb_mono > _HB_STALL_SEC:
                            if client.armed:
                                client.armed = False
                                try:
                                    async with _get_cmd_lock():
                                        await _jog_stop_for_client()
                                except Exception as _e:
                                    _trace.emit(
                                        "safety.hb_stall_jog_stop_failed", level="error",
                                        client_id=client_id, exc=type(_e).__name__, err=str(_e),
                                    )
                                # Unhealthy client \u2014 drop any armed-resume hold so a
                                # reconnect can't silently restore armed; the
                                # operator must explicitly re-arm (safety clarity).
                                _consume_armed_resume_hold(_clients[client_id].session_id)
                                # Forensics: arrival gaps (ms between the last hb
                                # arrivals) + total frames received. "No frames at
                                # all in the gap" = delivery-path stall (e.g. the
                                # Vite dev proxy); "frames but no heartbeat" =
                                # browser-side generation problem.
                                _c = _clients[client_id]
                                _now_m = time.monotonic()
                                _ring = list(_c.hb_ring)
                                _gaps = [round((_ring[i] - _ring[i - 1]) * 1000) for i in range(1, len(_ring))]
                                _trace.emit(
                                    "safety.hb_stall_disarmed",
                                    client_id=client_id,
                                    hb_age_ms=round((_now_m - _c.last_hb_mono) * 1000),
                                    # Wall-clock age kept alongside: divergence from
                                    # hb_age_ms proves a clock step in the event itself.
                                    hb_age_wall_ms=round((time.time() - _c.last_hb) * 1000),
                                    last_hb_arrival_ms_ago=round((_now_m - _ring[-1]) * 1000) if _ring else None,
                                    hb_arrival_gaps_ms=_gaps,
                                    frames_rx_total=_c.frames_rx,
                                    # Which handler (if any) this client's worker
                                    # was running — the forensic the 2026-09-03
                                    # touchoff/capture stall hunt lacked.
                                    inflight_cmd=_c.cmd_inflight,
                                    inflight_ms=(round((_now_m - _c.cmd_inflight_since_mono) * 1000)
                                                 if _c.cmd_inflight else None),
                                )
                                try:
                                    await ws_send_json(ws, {"type": "reply", "ok": False, "error": "Heartbeat timeout \u2014 disarmed for safety", "armed": False})
                                except Exception as _e:
                                    # Server-side disarm already happened; the
                                    # notification just didn't reach the client.
                                    # UI may show stale armed state until the
                                    # next status frame. Logged so the missed
                                    # signal is auditable rather than silently
                                    # lost.
                                    _trace.emit(
                                        "safety.disarm_notify_failed", level="warn",
                                        client_id=client_id, exc=type(_e).__name__, err=str(_e),
                                    )
                            else:
                                # Non-armed client stalled — evict to keep _clients accurate
                                # Closing WS triggers finally block → removes from _clients → updates HAL pins
                                try:
                                    await ws.close(code=1000, reason="Heartbeat timeout")
                                except Exception as _e:
                                    # Close failure is recoverable (finally block
                                    # still runs cleanup) but worth surfacing —
                                    # repeated occurrences indicate the WS layer
                                    # is unhealthy.
                                    _trace.emit(
                                        "ws.close_failed", level="warn",
                                        client_id=client_id, reason="hb_stall_nonarmed",
                                        exc=type(_e).__name__, err=str(_e),
                                    )
                                return  # exit status_loop; finally block handles cleanup

                    # Full iteration completed without exception — reset failure counter.
                    # (Healthy early-`continue` paths above are neutral: they don't
                    # reset but also don't increment, so the counter only grows when
                    # exceptions truly occur.)
                    _consec_fails = 0

                except Exception as e:
                    _set_phase(f"status_loop.exception client#{client_id} type={type(e).__name__}")
                    _consec_fails += 1
                    _trace.emit("status.loop_exception", level="warn",
                                client_id=client_id, fails=_consec_fails, max_fails=10,
                                exc=type(e).__name__, msg=str(e))
                    if _consec_fails >= 10:
                        _trace.emit("status.loop_abort", level="error",
                                    client_id=client_id,
                                    msg="aborting status loop after 10 consecutive failures")
                        break
                    await asyncio.sleep(0.5)
            _set_phase(f"status_loop.exit client#{client_id}")

        status_task = register_bg_task(asyncio.create_task(status_loop()))

        # Per-client command worker (2026-09-03): the reader below handles
        # liveness/bookkeeping frames only and queues everything else here.
        # One worker per client keeps per-client order (arm → jog_cont,
        # jog_cont → jog_stop); the reader returns to ws.receive() at once,
        # so this client's heartbeats can never wait behind a handler (the
        # touchoff/capture false-disarm class — see _WS_CMD_QUEUE_MAX).
        cmd_queue = asyncio.Queue()

        async def cmd_worker():
            _set_phase(f"ws.worker.entry client#{client_id}")
            while True:
                _set_phase(f"ws.worker.idle client#{client_id}")
                _wmsg, _enq = await cmd_queue.get()
                _wcmd = _wmsg.get("cmd")
                client.cmd_inflight = _wcmd
                client.cmd_inflight_since_mono = time.monotonic()
                client.cmd_preempted_by = None
                _queued_ms = round((client.cmd_inflight_since_mono - _enq) * 1000)
                if _queued_ms > 500:
                    _trace.emit("ws.command_queue_wait", client_id=client_id,
                                cmd=_wcmd, queued_ms=_queued_ms)
                # Each command runs as its OWN task (2026-09-05) so an
                # abort/estop can cancel it (_preempt_inflight) without
                # killing this worker. asyncio.wait never propagates THIS
                # task's cancel to the sub-task, so the disconnect path
                # cancels it explicitly below.
                inflight = register_bg_task(asyncio.create_task(
                    _execute_client_command(client_id, client, ws, _wmsg)))
                inflight.add_done_callback(_retrieve_task_exc)
                client.cmd_inflight_task = inflight
                try:
                    _set_phase(f"ws.worker.handle cmd={_wcmd} client#{client_id}")
                    try:
                        await asyncio.wait({inflight})
                    except asyncio.CancelledError:
                        inflight.cancel()
                        _trace.emit("ws.command_cancelled_on_disconnect", level="warn",
                                    client_id=client_id, cmd=_wcmd,
                                    ran_ms=round((time.monotonic() - client.cmd_inflight_since_mono) * 1000))
                        raise
                    _ran_ms = round((time.monotonic() - client.cmd_inflight_since_mono) * 1000)
                    if inflight.cancelled():
                        _by = client.cmd_preempted_by
                        if _by:
                            _trace.emit("ws.command_preempted", level="warn", client_id=client_id,
                                        cmd=_wcmd, by=_by, ran_ms=_ran_ms)
                            try:
                                await ws_send_json(ws, {"type": "reply", "cmd": _wcmd, "ok": False,
                                                        "error": f"Preempted by {_by}"})
                            except Exception as _we2:  # noqa: BLE001
                                _trace.emit("ws.command_error_reply_failed", level="warn",
                                            client_id=client_id, cmd=_wcmd, exc=type(_we2).__name__)
                        else:
                            # Lifespan shutdown cancels bg tasks directly.
                            _trace.emit("ws.command_cancelled", level="warn", client_id=client_id,
                                        cmd=_wcmd, ran_ms=_ran_ms)
                        continue
                    _we = inflight.exception()
                    if _we is None:
                        if _ran_ms > 1000:
                            # Names the slow handler in trace.ndjson — the
                            # forensic the hb-stall hunt had to reconstruct.
                            _trace.emit("ws.command_slow", client_id=client_id, cmd=_wcmd, ms=_ran_ms)
                    elif isinstance(_we, WebSocketDisconnect):
                        # Peer vanished under the reply send; the reader's
                        # receive() sees the same disconnect and tears down.
                        _trace.emit("ws.command_reply_lost", level="warn", client_id=client_id, cmd=_wcmd)
                        return
                    else:  # never kill the socket silently
                        _trace.emit("ws.command_exception", level="error", client_id=client_id,
                                    cmd=_wcmd, exc=type(_we).__name__, msg=str(_we))
                        try:
                            await ws_send_json(ws, {"type": "reply", "cmd": _wcmd, "ok": False,
                                                    "error": f"{type(_we).__name__}: {_we}"})
                        except Exception as _we2:  # noqa: BLE001
                            _trace.emit("ws.command_error_reply_failed", level="warn",
                                        client_id=client_id, cmd=_wcmd, exc=type(_we2).__name__)
                finally:
                    client.cmd_inflight = None
                    client.cmd_inflight_since_mono = 0.0
                    client.cmd_inflight_task = None
                    client.cmd_preempted_by = None
                    _set_phase(f"ws.worker.done cmd={_wcmd} client#{client_id}")

        cmd_task = register_bg_task(asyncio.create_task(cmd_worker()))

    _disc_reason = "unknown"
    # Captured on `cmd:"hello"`; the finally block uses this to register
    # the armed-resume hold so the next reconnect of the same tab can
    # silently inherit armed. Stays None for old clients that don't send
    # hello (they lose armed on reconnect, same as today).
    _disc_session_id: Optional[str] = None
    _binary_frame_warned = False
    try:
        while True:
            _set_phase(f"ws.receive client#{client_id}")
            # Not receive_text(): a BINARY frame makes starlette's
            # receive_text() raise KeyError('text'), which sails past the
            # (WebSocketDisconnect, RuntimeError) handler below and tears the
            # connection down through the armed-disconnect side effects — one
            # stray frame from a broken client killed its session. Receive
            # raw, reject non-text politely, keep the connection alive.
            _wsmsg = await ws.receive()
            if _wsmsg["type"] == "websocket.disconnect":
                # Mirror receive_text()'s disconnect semantics for the
                # handler below.
                raise WebSocketDisconnect(_wsmsg.get("code", 1000))
            raw = _wsmsg.get("text")
            if raw is None:
                if not _binary_frame_warned:
                    _binary_frame_warned = True  # once per connection — a broken client repeats
                    _trace.emit("ws.binary_frame_rejected", level="warn",
                                client_id=client_id,
                                bytes=len(_wsmsg.get("bytes") or b""))
                await ws_send_json(ws, {"type": "reply", "ok": False,
                                        "error": "Commands must be text JSON frames"})
                continue
            try:
                msg = json.loads(raw)
            except Exception:
                await ws_send_json(ws, {"type": "reply", "ok": False, "error": "Invalid JSON"})
                continue
            _set_phase(f"handle_msg cmd={msg.get('cmd', '?')} client#{client_id}")
            if client_id in _clients:
                _clients[client_id].frames_rx += 1  # hb-stall forensics: ANY frame counts as delivery

            if msg.get("cmd") == "heartbeat":
                if client_id in _clients:
                    _now_mono = time.monotonic()
                    _clients[client_id].last_hb = time.time()
                    _clients[client_id].last_hb_mono = _now_mono
                    _clients[client_id].hb_mono = _now_mono
                    _clients[client_id].hb_ring.append(_now_mono)
                await ws_send_json(ws, {"type": "pong"})
                continue

            if msg.get("cmd") == "hello":
                # Tab handshake: captures session_id for armed-resume across
                # brief reconnects (Ctrl-R, Wi-Fi blip, screen-lock close).
                # Decision tree, each branch traced — no silent fallbacks.
                #
                # Phase 2 / E4: peek first so denial events distinguish
                # "no hold ever existed" from "hold expired" from "hold
                # would have granted but a safety trip is pending". The
                # previous ordering (unacked-trip-before-peek) emitted
                # `resume_denied_unacked_trip` for fresh tabs that never
                # had a hold — misleading.
                _sid = msg.get("session")
                if isinstance(_sid, str) and _sid:
                    _disc_session_id = _sid
                    if client_id in _clients:
                        _clients[client_id].session_id = _sid
                want_resume = bool(msg.get("resume_armed", False))
                if want_resume:
                    if not _sid:
                        _trace.emit(
                            "session.hello_missing",
                            client_id=client_id, reason="resume_requested_without_session_id",
                        )
                    else:
                        _hold_state = _peek_armed_resume_hold(_sid)
                        if _hold_state == "no_match":
                            _trace.emit(
                                "session.resume_denied_no_match",
                                client_id=client_id, session_id=_sid,
                            )
                        elif _hold_state == "expired":
                            # Consume the stale hold so it doesn't linger.
                            _consume_armed_resume_hold(_sid)
                            _trace.emit(
                                "session.resume_denied_expired",
                                client_id=client_id, session_id=_sid,
                            )
                        elif _hold_state == "granted":
                            # Within grace. Trip check applies here, not earlier:
                            # an unacked trip blocks a real resume, but it should
                            # not poison the trace for a fresh tab with no hold.
                            if _unacked_trip is not None:
                                # Don't consume — once the operator acks the
                                # trip and reconnects again (still within
                                # original window), they should still resume.
                                # Note: in practice the grace window is short
                                # so this is unlikely to matter; the choice
                                # here favours operator-friendly behaviour.
                                _trace.emit(
                                    "session.resume_denied_unacked_trip",
                                    client_id=client_id, session_id=_sid,
                                )
                            else:
                                _consume_armed_resume_hold(_sid)
                                client.armed = True
                                client.last_hb = time.time()
                                client.last_hb_mono = time.monotonic()
                                _trace.emit(
                                    "session.resume_granted",
                                    client_id=client_id, session_id=_sid,
                                )
                await ws_send_json(ws, {"type": "reply", "ok": True, "armed": client.armed})
                continue

            if msg.get("cmd") == "safety_trip_ack":
                # Clearing the banner is independent of clearing the latch: the
                # HAL latch stays set (fault-out TRUE) until the operator's
                # E-Stop Reset. Because evaluate_trip_latch only re-banners on a
                # clean FALSE→TRUE transition, the still-TRUE level after this ack
                # produces no edge and the ack sticks; a genuinely new trip
                # (latch reset → FALSE, then TRUE again) still fires.
                _unacked_trip = None
                # Audit: without this, an acknowledged trip is invisible in the
                # trace — an armed client after a trip looks like a gate bypass.
                _trace.emit("safety.trip_acknowledged", client_id=client_id)
                await ws_send_json(ws, {"type": "reply", "ok": True})
                continue

            if msg.get("cmd") == "get_settings":
                _loop = asyncio.get_event_loop()
                _ss = await _loop.run_in_executor(None, load_settings)
                await ws_send_json(ws, {"type": "settings_init", "settings": _ss, "armed": client.armed})
                continue

            if msg.get("cmd") == "save_settings":
                section = msg.get("section", "")
                if section not in _VALID_SETTINGS_SECTIONS:
                    await ws_send_json(ws, {"type": "reply", "ok": False, "error": f"Unknown settings section: {section}"})
                    continue
                _loop = asyncio.get_event_loop()
                try:
                    await _loop.run_in_executor(None, save_settings_section, section, msg.get("data"))
                except Exception as _se:
                    await ws_send_json(ws, {"type": "reply", "ok": False, "error": f"{type(_se).__name__}: {_se}"})
                    continue
                await ws_send_json(ws, {"type": "reply", "ok": True})
                continue

            if msg.get("cmd") == "client_diag":
                # Periodic browser-side diagnostics (heap, Three.js counters,
                # connection state). Forwarded straight to the trace bus so a
                # renderer crash ("Aw Snap") still leaves a usable timeline in
                # trace.ndjson — the gateway file outlives the browser.
                data = msg.get("data")
                if isinstance(data, dict):
                    _trace.emit("client.diag", client_id=client_id, **data)
                # Fire-and-forget — no reply, no ack, to keep this off the hot path.
                continue

            if msg.get("cmd") == "timing_log":
                global _timing_log_enabled, _timing_log_path
                _timing_log_enabled = bool(msg.get("enable", False))
                if _timing_log_enabled:
                    from datetime import datetime
                    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                    base = _trace.log_dir()
                    if not base:
                        _trace.emit("timing.log_no_log_dir", level="error")
                        _timing_log_enabled = False
                        await ws_send_json(ws, {"type": "reply", "ok": False, "enabled": False})
                        continue
                    timing_dir = os.path.join(base, "timing")
                    os.makedirs(timing_dir, exist_ok=True)
                    _timing_log_path = os.path.join(timing_dir, f"timing-{stamp}.jsonl")
                    _trace.emit("timing.log_started", path=_timing_log_path)
                else:
                    if _timing_log_path:
                        _trace.emit("timing.log_stopped", path=_timing_log_path)
                await ws_send_json(ws, {"type": "reply", "ok": True, "enabled": _timing_log_enabled})
                continue

            if msg.get("cmd") == "halshow_live":
                on = bool(msg.get("on", False))
                if client_id in _clients:
                    _clients[client_id].halshow_live = on
                if not on:
                    _halshow_topology_sent.pop(client_id, None)
                else:
                    # Drop any stale flag so subscriber gets a fresh snapshot
                    _halshow_topology_sent.pop(client_id, None)
                    _ensure_halshow_loop()
                await ws_send_json(ws, {"type": "reply", "ok": True})
                continue

            if msg.get("cmd") == "halshow_refresh":
                # Force a topology rebuild (P5) — e.g. after an external HAL reload.
                # Clears every subscriber's sent-flag so the rebuilt graph re-sends.
                _invalidate_halshow_topology()
                _halshow_topology_sent.clear()
                await ws_send_json(ws, {"type": "reply", "ok": True})
                continue

            if msg.get("cmd") == "tab_visibility":
                # Frontend reports document.visibilityState. While hidden, the
                # browser stops draining the WS and the kernel TCP buffer fills,
                # which is the storm trigger we measured. Status fan-out skips
                # this client while hidden; resumes on the next tick after the
                # tab returns to visible. State-only update — does not require
                # `armed` and never affects machine state.
                #
                # NO REPLY: the very client sending this command is, by
                # definition, the one whose tab just became hidden — i.e. the
                # one whose WS is about to back up. Awaiting `ws_send_json`
                # for a reply would re-introduce the slow-consumer hang we're
                # trying to escape (a 495 ms stall observed in the first storm
                # test with the reply present). Frontend fire-and-forgets.
                hidden = bool(msg.get("hidden", False))
                if client_id in _clients:
                    _clients[client_id].hidden = hidden
                _trace.emit(
                    "ws.tab_visibility",
                    client_id=client_id, hidden=hidden,
                )
                continue

            # NOTE: simulate_probe_trip, confirm_tool_change, set_compensation and
            # set_compensation_method used to be handled HERE, authorized by
            # `client.armed` alone. They now live in _handle_command_impl so they
            # pass check_command, get the bounded-error catch below, and are
            # visible to the coverage contract in test_command_policy — which was
            # structurally scoped to the dispatched ladder and could not see them.

            # Everything else runs on this client's command worker (above):
            # the reader must be back at ws.receive() immediately so the
            # client's heartbeats are never queued behind a handler. Bounded
            # queue, replied + traced when full — never a silent drop; stop-
            # class commands get 4× the headroom and are never rejected first.
            _rcmd = msg.get("cmd")
            if _rcmd in _WS_PREEMPT_CMDS:
                # A stop supersedes the work this client sent before it: drop
                # the queued non-stop commands (replied + traced, never
                # silent), keep stops/arm in their FIFO order ahead of this
                # one, and cancel every client's in-flight handler. All on
                # the loop thread — the worker is either parked in get() or
                # inside its sub-task, never touching the queue.
                _kept, _sup = [], []
                while True:
                    try:
                        _qm, _qt = cmd_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                    (_kept if _qm.get("cmd") in _WS_NO_PREEMPT else _sup).append((_qm, _qt))
                for _qm, _qt in _kept:
                    cmd_queue.put_nowait((_qm, _qt))
                for _qm, _qt in _sup:
                    await ws_send_json(ws, {"type": "reply", "cmd": _qm.get("cmd"), "ok": False,
                                            "error": f"Superseded by {_rcmd}"})
                if _sup:
                    _trace.emit("ws.command_superseded", level="warn", client_id=client_id,
                                by=_rcmd, count=len(_sup), cmds=[m.get("cmd") for m, _ in _sup])
                _preempt_inflight(by=_rcmd, from_client=client_id)
            _depth = cmd_queue.qsize()
            _cap = _WS_CMD_QUEUE_MAX * (4 if _rcmd in _WS_STOP_CMDS else 1)
            if _depth >= _cap:
                _trace.emit("ws.command_queue_full", level="warn", client_id=client_id,
                            cmd=_rcmd, depth=_depth, inflight_cmd=client.cmd_inflight,
                            inflight_ms=(round((time.monotonic() - client.cmd_inflight_since_mono) * 1000)
                                         if client.cmd_inflight else None))
                await ws_send_json(ws, {"type": "reply", "cmd": _rcmd, "ok": False,
                                        "error": f"Command queue full ({_depth} pending) — command dropped"})
                continue
            _set_phase(f"ws.enqueue cmd={_rcmd} client#{client_id}")
            cmd_queue.put_nowait((msg, time.monotonic()))

    except (WebSocketDisconnect, RuntimeError) as _disc_e:
        _set_phase(f"ws_endpoint.WebSocketDisconnect_caught client#{client_id}")
        _disc_reason = type(_disc_e).__name__
    except asyncio.CancelledError:
        # Server going down (WS-B). uvicorn cancels live WS handler tasks
        # BEFORE lifespan shutdown runs, so by the time the lifespan
        # server_shutdown broadcast executes, every handler's finally has
        # already popped its client and the broadcast sees zero clients —
        # the browser historically got a bare 1006 with no frame. This is
        # the only window where a goodbye can still reach the client:
        # best-effort server_shutdown frame + going-away close (1001 — the
        # frontend maps both the frame and the 1001/1012 close codes to the
        # shutdown banner). Each await is hard-bounded so a stuck peer can't
        # stretch the graceful-shutdown window, and the CancelledError is
        # re-raised — the task must still report cancelled to uvicorn.
        _set_phase(f"ws_endpoint.cancelled client#{client_id}")
        _disc_reason = "CancelledError"
        try:
            await asyncio.wait_for(
                ws_send_json(ws, {"type": "server_shutdown"}), timeout=0.25)
            await asyncio.wait_for(ws.close(code=1001), timeout=0.25)
            _trace.emit("ws.shutdown_goodbye_sent", client_id=client_id)
        except (Exception, asyncio.CancelledError) as _bye_e:
            # Socket may already be torn down, or a second cancel arrived
            # mid-send — the goodbye is best-effort, but trace the miss so
            # a silent-1006 regression stays auditable.
            _trace.emit(
                "ws.shutdown_goodbye_failed", level="warn",
                client_id=client_id, exc=type(_bye_e).__name__,
            )
        raise
    finally:
        _finally_t0 = time.monotonic()
        _set_phase(f"ws_endpoint.finally.entry client#{client_id}")
        # Capture heartbeat freshness BEFORE removing the client (review #1): the
        # resume-hold decision below needs it, and popping first made the later
        # lookup always miss → 1e9 → even a healthy Ctrl-R reconnect could never
        # register an armed-resume hold.
        _last_hb_at_drop = _clients[client_id].last_hb_mono if client_id in _clients else None
        _clients.pop(client_id, None)
        _halshow_topology_sent.pop(client_id, None)
        # Command worker: cancel FIRST — the armed jog-stop below needs
        # _cmd_lock, which an in-flight handler may hold; _cmd_blocking keeps
        # the lock until the NML call returns, so this is a request, not a
        # wait (never awaited here: the SIGTERM path must not linger behind a
        # 30 s wait_complete; the lifespan bg-task gather covers it). Queued
        # commands are dropped and said so.
        _set_phase(f"ws_endpoint.finally.cancel_cmd_worker client#{client_id}")
        _inflight_at_drop = client.cmd_inflight
        cmd_task.cancel()
        _dropped = []
        while True:
            try:
                _dm, _ = cmd_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            _dropped.append(_dm.get("cmd"))
        if _dropped:
            _trace.emit("ws.command_dropped_on_disconnect", level="warn",
                        client_id=client_id, count=len(_dropped), cmds=_dropped)
        # Disconnect of an armed client: jog-stop any in-flight jog this
        # client started, then register a 10s armed-resume hold keyed by
        # session_id so a Ctrl-R / Wi-Fi blip can transparently re-arm.
        #
        # We do NOT abort a running program here. Per the architecture
        # cleanup: client liveness is not safety. The HAL chain (oneshot.0
        # + trip-latch) is the real safety, and it independently trips on
        # gateway hang or all-clients-out (via _start_disconnect_grace).
        # A single armed client dropping while viewers (or even nothing)
        # remain must not abort the program — if everyone is gone, HAL
        # grace expires and the trip-latch handles it for real.
        #
        # During global lifespan shutdown the gateway has already broadcast
        # server_shutdown and closed sockets; skip the jog-stop in that
        # window so N clients don't all serialize on _cmd_lock during a
        # LinuxCNC teardown.
        if client.armed and CMD is not None and not _shutting_down:
            _set_phase(f"ws_endpoint.finally.armed_jog_stop client#{client_id}")
            try:
                async with _get_cmd_lock():
                    _set_phase(f"ws_endpoint.finally.armed_jog_stop.cmd_lock_held client#{client_id}")
                    STAT.poll()
                    await _jog_stop_for_client()
            except Exception as _e:
                _trace.emit(
                    "safety.disconnect_jog_stop_failed", level="error",
                    client_id=client_id, exc=type(_e).__name__, err=str(_e),
                )
            # Only arm-resume a client that was beating normally right up to the
            # drop (clean Ctrl-R / wifi blip). A client whose heartbeat was already
            # lagging was struggling/overloaded — don't silently auto-restore armed
            # on reconnect; the operator must explicitly re-arm (safety clarity).
            # Monotonic, same rationale as the hb-stall check: a wall-clock step
            # must not veto (or wrongly grant) the armed-resume hold.
            _hb_age = (time.monotonic() - _last_hb_at_drop) if _last_hb_at_drop is not None else 1e9
            if _hb_age <= _RESUME_MAX_HB_AGE:
                _register_armed_resume_hold(_disc_session_id, client_id)
                _trace.emit("safety.disconnect_disarmed", client_id=client_id)
            else:
                _trace.emit(
                    "safety.disconnect_disarmed_no_resume", level="warn",
                    client_id=client_id, hb_age_ms=round(_hb_age * 1000),
                )
        _set_phase(f"ws_endpoint.finally.cancel_status_task client#{client_id}")
        status_task.cancel()
        # Clear estop hold if no clients remain
        if not _clients:
            _estop_hold = False
        # Update HAL pins to reflect this client is gone
        has_clients = bool(_clients)
        if has_clients:
            _set_phase(f"ws_endpoint.finally.hal_send_disconnected client#{client_id}")
            _hal_send({"connected": True, "heartbeat": False})
        else:
            # Grace period: delay dropping connected pin to allow page refresh
            _set_phase(f"ws_endpoint.finally.start_disconnect_grace client#{client_id}")
            _start_disconnect_grace()
        _set_phase(f"ws_endpoint.finally.done client#{client_id}")
        _trace.emit(
            "ws.disconnect",
            client_id=client_id, peer=client_ip,
            reason=_disc_reason,
            cleanup_ms=round((time.monotonic() - _finally_t0) * 1000, 1),
            session_ms=round((time.monotonic() - _conn_t0) * 1000, 1),
            remaining_clients=len(_clients),
            queue_dropped=len(_dropped),
            inflight_at_drop=_inflight_at_drop,
        )


# ── Camera streaming (optional — requires LCNC_CAMERA_SOURCE env var) ────
try:
    import cv2
except ImportError:
    cv2 = None  # type: ignore[assignment]

_camera: Any = None  # cv2.VideoCapture or None
_camera_lock = threading.Lock()

def _camera_init() -> bool:
    """Lazy-init camera from env var. Returns True if available."""
    global _camera
    if cv2 is None:
        return False
    source = os.environ.get("LCNC_CAMERA_SOURCE", "")
    if not source:
        return False
    # Hold _camera_lock across the whole init: two concurrent /camera requests
    # are each dispatched to the threadpool, so without the lock both could
    # construct a VideoCapture and leak one device handle. Double-check inside.
    with _camera_lock:
        if _camera is not None:
            return _camera.isOpened()
        try:
            src: Any = int(source)
        except ValueError:
            src = source
        _camera = cv2.VideoCapture(src)
        res = os.environ.get("LCNC_CAMERA_RESOLUTION", "1280x720")
        try:
            w, h = (int(x) for x in res.split("x"))
            _camera.set(cv2.CAP_PROP_FRAME_WIDTH, w)
            _camera.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
        except ValueError:
            pass  # safe-silent: malformed resolution string, camera keeps default
        return _camera.isOpened()

def _camera_grab_jpeg(quality: int = 80) -> Optional[bytes]:
    """Grab one frame, return JPEG bytes or None."""
    with _camera_lock:
        if not _camera or not _camera.isOpened():
            return None
        ok, frame = _camera.read()
        if not ok:
            return None
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
        return buf.tobytes()

def _camera_release():
    global _camera
    with _camera_lock:
        if _camera is not None:
            _camera.release()
            _camera = None


# Single-producer camera fan-out (P3 / M5) — the async lifecycle lives in
# camera_broker.py; the device-touching cv2 I/O + bg-task registry are injected.
_camera_broker = CameraBroker(
    grab_jpeg=_camera_grab_jpeg,
    device_init=_camera_init,
    device_release=_camera_release,
    register_bg_task=register_bg_task,
)

# ---- Server-Side Settings Endpoints ----

@app.get("/settings")
async def get_settings():
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, load_settings)
    return {"ok": True, "settings": data}


@app.put("/settings/{section}", dependencies=[Depends(require_token)])
@app.post("/settings/{section}", dependencies=[Depends(require_token)])  # POST used by sendBeacon on page exit
async def put_settings_section(section: str, request: Request):
    if section not in _VALID_SETTINGS_SECTIONS:
        return JSONResponse({"ok": False, "error": f"Unknown section: {section}"}, status_code=400)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Invalid JSON body"}, status_code=400)
    if not isinstance(body, dict) or "data" not in body:
        return JSONResponse({"ok": False, "error": "Missing 'data'"}, status_code=400)
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, save_settings_section, section, body["data"])
    except Exception as e:
        # e.g. refuse-to-clobber when settings.json is corrupt — surface it.
        return JSONResponse({"ok": False, "error": f"{type(e).__name__}: {e}"}, status_code=409)
    return {"ok": True}


@app.delete("/settings", dependencies=[Depends(require_token)])
async def delete_settings():
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, reset_settings)
    return {"ok": True}


@app.get("/camera/stream")
async def camera_stream():
    # One shared producer feeds all viewers (P3): subscribing starts it on the
    # first viewer; the `finally` releases this viewer's slot so the device is
    # freed a short grace after the last one leaves.
    ok = await _camera_broker.subscribe()
    if not ok:
        return JSONResponse({"error": "No camera configured"}, status_code=503)

    async def generate():
        try:
            async for jpeg in _camera_broker.frames():
                yield (b"--frame\r\n"
                       b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n")
        finally:
            _camera_broker.unsubscribe()

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )

@app.get("/camera/status")
async def camera_status():
    loop = asyncio.get_event_loop()
    ok = await loop.run_in_executor(None, _camera_init)
    return {"available": ok, "source": os.environ.get("LCNC_CAMERA_SOURCE", "")}


# ── Production SPA mount (only when LCNC_WEBUI_DIST_DIR is set) ──────────
# MUST be after @app.websocket("/ws") — Starlette matches routes in order,
# and mount("/") is a catch-all that would swallow WebSocket connections.
_DIST_DIR = os.environ.get("LCNC_WEBUI_DIST_DIR")
if _DIST_DIR and Path(_DIST_DIR).is_dir():
    # Serve index.html ourselves so we can inject the auth token (issue #17):
    # the SPA reads window.__LCNC_TOKEN__ and presents it on the WS URL + REST
    # headers. Anyone the gateway serves the page to is already a client it
    # chose to serve, so handing them the LAN-admission token in that page does
    # not weaken it against the real threats (cross-origin WS hijack, which
    # can't read this page cross-origin, and unauthenticated REST mutation).
    def _serve_index() -> Response:
        try:
            html = (Path(_DIST_DIR) / "index.html").read_text(encoding="utf-8")
        except Exception:
            raise HTTPException(status_code=404, detail="index.html not found")
        inject = f"<script>window.__LCNC_TOKEN__ = {json.dumps(WEBUI_TOKEN)};</script>"
        html = html.replace("</head>", inject + "</head>", 1) if "</head>" in html else inject + html
        return Response(content=html, media_type="text/html", headers={"Cache-Control": "no-cache"})

    @app.get("/")
    async def spa_index():
        return _serve_index()

    @app.get("/index.html")
    async def spa_index_html():
        return _serve_index()

    # Catch-all for assets — MUST come after the explicit index routes above.
    app.mount("/", StaticFiles(directory=_DIST_DIR, html=True), name="spa")
