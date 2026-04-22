#!/usr/bin/env python3
import asyncio
import json
import time
import os
import subprocess
import threading
from pathlib import Path
import linuxcnc
import hal  # must import in main thread — _hal C extension registers signal handlers on init

from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional, List, Tuple
from fastapi.staticfiles import StaticFiles
import re
import shutil
import tempfile
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse, JSONResponse, FileResponse, Response

import logging
import click


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


# ---- Config ----
POLL_HZ = 30  # status update rate
BASE_DIR = Path(__file__).resolve().parent
MACHINE_DIR = BASE_DIR / "machine"

# ---- Perf experiment flags (INI-sourced via lcnc-suite launcher) ----
# All flags default OFF. Each is an independent opt-in for A/B measurement.
_WIRE_FORMAT = (os.environ.get("WEBUI_WIRE_FORMAT") or "json").strip().lower()
if _WIRE_FORMAT not in ("json", "msgpack"):
    _WIRE_FORMAT = "json"
_STATUS_DELTA_ENABLED = os.environ.get("WEBUI_STATUS_DELTA") == "1"
_ADAPTIVE_POLL_ENABLED = os.environ.get("WEBUI_ADAPTIVE_POLL") == "1"
try:
    _IDLE_POLL_HZ = max(1, int(os.environ.get("WEBUI_IDLE_POLL_HZ") or "5"))
except ValueError:
    _IDLE_POLL_HZ = 5
# Full-snapshot cadence when delta mode is on: force a full every N cycles so
# any drift-bug self-heals within ~3s at 30 Hz.
_DELTA_FULL_INTERVAL = 100

# ---- Wire-format encoders (msgspec, lazy-initialised) ----
# msgspec.json is used in place of stdlib json.dumps to avoid the per-call
# Encoder setup cost. msgspec.msgpack produces compact binary frames for
# float-heavy StatusPayload. Both encoders are thread-safe for reuse.
def _wire_enc_hook(obj):
    # Matches the prior json.dumps(..., default=str) behaviour: any object
    # msgspec doesn't know how to encode gets stringified. Covers Path, datetime,
    # and defensive stringification of stray non-primitive payloads.
    return str(obj)

try:
    import msgspec as _msgspec
    _json_encoder = _msgspec.json.Encoder(enc_hook=_wire_enc_hook)
    _msgpack_encoder = _msgspec.msgpack.Encoder(enc_hook=_wire_enc_hook)

    def _json_encoder_encode(obj):
        return _json_encoder.encode(obj)  # returns bytes
except Exception:
    _msgspec = None
    _msgpack_encoder = None

    def _json_encoder_encode(obj):
        # Fallback: stdlib json. default=str matches prior ws_send_json behaviour.
        return json.dumps(obj, separators=(",", ":"), default=str)

# If msgspec isn't installed, force-downgrade to JSON even if the operator
# set WEBUI_WIRE_FORMAT=msgpack — msgpack requires msgspec.
if _WIRE_FORMAT == "msgpack" and _msgpack_encoder is None:
    print("[WIRE] msgspec not installed — WEBUI_WIRE_FORMAT=msgpack ignored, falling back to JSON", flush=True)
    _WIRE_FORMAT = "json"


def _encode_ws_frame(obj):
    """Encode a WS payload with the active wire format. Returns bytes for
    msgpack (→ ws.send_bytes) or str for json (→ ws.send_text). Used for
    shared payloads (viewer_gcode, surface_points, comp_grid) that are
    encoded once and broadcast verbatim to every client."""
    if _WIRE_FORMAT == "msgpack":
        return _msgpack_encoder.encode(obj)
    data = _json_encoder_encode(obj)
    return data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else data

# ---- LinuxCNC handles (nullable for auto-reconnect) ----
STAT: Optional[linuxcnc.stat] = None
CMD: Optional[linuxcnc.command] = None
ERR: Optional[linuxcnc.error_channel] = None
lcnc_connected = False
_lcnc_pid: Optional[int] = None  # tracks linuxcncsvr PID

# ---- WCS offset cache (populated from STAT at 30Hz) ----
_WCS_BASES = [5220, 5240, 5260, 5280, 5300, 5320, 5340, 5360, 5380]
_WCS_NAMES = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"]
_G5X_MAP = {"G54": 1, "G55": 2, "G56": 3, "G57": 4, "G58": 5, "G59": 6, "G59.1": 7, "G59.2": 8, "G59.3": 9}
_WCS_AXIS_KEYS = ["x", "y", "z", "a", "b", "c", "u", "v", "w"]
_wcs_cache = [{"name": n, "x": 0.0, "y": 0.0, "z": 0.0, "a": 0.0, "b": 0.0, "c": 0.0, "u": 0.0, "v": 0.0, "w": 0.0, "r": 0.0} for n in _WCS_NAMES]
_wcs_cache_seeded = False

# ---- Connected WebSocket clients ----
_clients: Dict[int, Dict[str, Any]] = {}
_next_client_id = 0

# ---- HAL watchdog socket client ----
# The watchdog is loaded by LinuxCNC HAL config (loadusr -W hal_watchdog.py).
# Gateway connects to its Unix socket to send heartbeat/connected updates.
import sys
import signal
import socket as _socket


_HAL_SOCK_PATH = "/tmp/webui-safety.sock"
_hal_sock: Optional[_socket.socket] = None
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

def _hal_connect():
    """Connect to the HAL watchdog Unix socket. Non-fatal if unavailable."""
    global _hal_sock
    if _hal_sock is not None:
        return  # already connected
    try:
        _hal_sock = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
        _hal_sock.connect(_HAL_SOCK_PATH)
        print("Connected to HAL watchdog socket")
    except Exception as e:
        print(f"[HAL] socket connect failed: {e}", flush=True)
        _hal_sock = None

def _hal_disconnect():
    """Disconnect from the HAL watchdog socket."""
    global _hal_sock
    if _hal_sock is not None:
        try:
            _hal_sock.close()
        except Exception:
            pass
        _hal_sock = None

def _shutdown_signal_handler(signum, frame):
    """Handle SIGTERM/SIGINT: disconnect from HAL watchdog before exit."""
    print(f"Gateway received signal {signum}", flush=True)
    _hal_disconnect()
    _camera_release()
    signal.signal(signum, signal.SIG_DFL)
    os.kill(os.getpid(), signum)

signal.signal(signal.SIGTERM, _shutdown_signal_handler)
signal.signal(signal.SIGINT, _shutdown_signal_handler)


# ---- HAL monitor component for fast pin reads ----
# hal.get_value(name) does mutex + linear search (~6-8ms per call).
# A HAL component's h['pin'] is a direct pointer dereference (<1μs).
# We create input pins and connect them to the source pins' signals.
_hal_comp = None  # type: Optional[hal.component]
_hal_connected_pins: set = set()  # local pin names that were successfully wired

# (source_pin, local_pin_name, hal_type)
_HAL_MONITOR_PINS = [
    ("iocontrol.0.tool-change",      "tool-change",      hal.HAL_BIT),
    ("iocontrol.0.tool-prep-number", "tool-prep-number", hal.HAL_S32),
    ("spindle.0.speed-in",           "spindle-speed-in", hal.HAL_FLOAT),
    ("axis.z.eoffset",               "z-eoffset",        hal.HAL_FLOAT),
    ("axis.z.eoffset-enable",        "z-eoffset-enable", hal.HAL_BIT),
    ("compensation.method",          "comp-method",       hal.HAL_U32),
    ("compensation.grid-version",    "comp-grid-ver",     hal.HAL_U32),
    ("motion.probe-input",           "probe-input",       hal.HAL_BIT),
    ("oneshot.0.out",                "webui-hb-ok",       hal.HAL_BIT),
    ("webui-safety.trip-count",      "safety-trip-count", hal.HAL_U32),
]


def _init_hal_monitor():
    """Create webui-monitor HAL component with input pins for fast reads.

    Called once on first successful LinuxCNC connection.  Each input pin is
    connected to the same signal as the corresponding source pin so reads
    go through a direct pointer instead of the slow hal.get_value() path.
    """
    global _hal_comp
    if _hal_comp is not None:
        return
    try:
        comp = hal.component("webui-monitor")
        for _, pin_name, pin_type in _HAL_MONITOR_PINS:
            comp.newpin(pin_name, pin_type, hal.HAL_IN)
        comp.ready()
        _hal_comp = comp
        print("[HAL] webui-monitor component ready", flush=True)
    except Exception as e:
        print(f"[HAL] webui-monitor creation failed: {e}", flush=True)
        _hal_comp = None
        return

    # Connect each input pin to the source pin's signal
    for source_pin, local_pin, _ in _HAL_MONITOR_PINS:
        _hal_connect_monitor_pin(source_pin, local_pin)



def _hal_connect_monitor_pin(source_pin: str, local_pin: str):
    """Connect webui-monitor.<local_pin> to the same signal as <source_pin>."""
    full_local = f"webui-monitor.{local_pin}"
    try:
        # Check if source pin exists and what signal it's on
        result = subprocess.run(
            ['halcmd', '-s', 'show', 'pin', source_pin],
            capture_output=True, text=True, timeout=2
        )
        if result.returncode != 0 or not result.stdout.strip():
            print(f"[HAL] pin {source_pin} not found, skipping", flush=True)
            return

        # halcmd -s output: "owner type dir value name [arrow signal_name]"
        # e.g. "motmod float IN 0.005 spindle.0.speed-in <== spindle-rps-filtered"
        # show pin returns prefix matches, so find the exact pin line
        signal_name = None
        found = False
        for line in result.stdout.strip().split('\n'):
            parts = line.split()
            if len(parts) >= 5 and parts[4] == source_pin:
                found = True
                if len(parts) >= 7:
                    # parts[5] is arrow (<== or ==>), parts[6] is signal name
                    signal_name = parts[6]
                break

        if not found:
            print(f"[HAL] pin {source_pin} not found in halcmd output", flush=True)
            return

        if signal_name is None:
            # Source pin not connected — create a new signal
            signal_name = f"webui-mon-{local_pin}"
            r = subprocess.run(
                ['halcmd', 'net', signal_name, source_pin],
                capture_output=True, text=True, timeout=2
            )
            if r.returncode != 0:
                print(f"[HAL] net {signal_name} {source_pin} failed: "
                      f"{r.stderr.strip()}", flush=True)
                return

        # Connect our input pin to the signal
        r = subprocess.run(
            ['halcmd', 'net', signal_name, full_local],
            capture_output=True, text=True, timeout=2
        )
        if r.returncode != 0:
            print(f"[HAL] net {signal_name} {full_local} failed: "
                  f"{r.stderr.strip()}", flush=True)
        else:
            _hal_connected_pins.add(local_pin)
            print(f"[HAL] {full_local} <= {signal_name}", flush=True)
    except Exception as e:
        print(f"[HAL] connect {source_pin} failed: {e}", flush=True)


def _hal_fast(local_pin: str, default=None):
    """Read HAL pin from webui-monitor component. Returns default if not wired."""
    if _hal_comp is not None and local_pin in _hal_connected_pins:
        try:
            return _hal_comp[local_pin]
        except Exception:
            pass
    return default


def _hal_send(msg: dict):
    """Send a pin-update message to the HAL watchdog via socket."""
    global _hal_sock
    if _hal_sock is None:
        _hal_connect()
    if _hal_sock is not None:
        try:
            _hal_sock.sendall((json.dumps(msg) + "\n").encode())
        except Exception:
            _hal_sock = None  # will reconnect on next send


async def _disconnect_grace():
    """Keep heartbeat alive while waiting for reconnect, then drop pins."""
    global _hal_last_hb
    ticks = int(_DISCONNECT_GRACE_SEC * POLL_HZ)
    for _ in range(ticks):
        if _clients:
            return  # client reconnected during grace
        _hal_last_hb = not _hal_last_hb
        _hal_send({"heartbeat": _hal_last_hb, "connected": True})
        await asyncio.sleep(1.0 / POLL_HZ)
    if not _clients:
        _hal_send({"connected": False, "heartbeat": False})


def _start_disconnect_grace():
    global _disconnect_grace_task
    if _disconnect_grace_task and not _disconnect_grace_task.done():
        return  # already running
    _disconnect_grace_task = asyncio.get_event_loop().create_task(_disconnect_grace())


def _cancel_disconnect_grace():
    global _disconnect_grace_task
    if _disconnect_grace_task and not _disconnect_grace_task.done():
        _disconnect_grace_task.cancel()
    _disconnect_grace_task = None


_heartbeat_task: Optional[asyncio.Task] = None


async def _heartbeat_loop():
    """Independent HAL heartbeat — decoupled from status processing.

    Toggles at POLL_HZ while clients are connected.  When no clients remain
    the loop yields to _disconnect_grace which manages the grace period.
    E-Stop is handled via the independent command path (ws.receive_text →
    handle_command) so a stuck status_loop does not block safety controls.
    """
    global _hal_last_hb
    _hb_expected = 1.0 / POLL_HZ
    _hb_last = time.monotonic()
    while True:
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


async def _loop_lag_monitor():
    """Fire-and-forget task that measures event-loop scheduling lag.

    Prints whenever the loop takes >100ms longer than the requested sleep to
    wake back up — a proxy for 'main thread blocked on something synchronous'.
    Used to diagnose heartbeat-watchdog trips by correlating [LAG] lines with
    parse / encode / file-IO log lines.
    """
    TICK = 0.05
    THRESHOLD = 0.10
    last = time.monotonic()
    while True:
        await asyncio.sleep(TICK)
        now = time.monotonic()
        drift = now - last - TICK
        if drift > THRESHOLD:
            print(f"[LAG] event loop stalled {drift*1000:.0f}ms", flush=True)
        last = now


_lag_monitor_task: Optional[asyncio.Task] = None


def _start_heartbeat():
    global _heartbeat_task, _lag_monitor_task
    if _heartbeat_task is None or _heartbeat_task.done():
        _heartbeat_task = asyncio.get_event_loop().create_task(_heartbeat_loop())
    if _lag_monitor_task is None or _lag_monitor_task.done():
        _lag_monitor_task = asyncio.get_event_loop().create_task(_loop_lag_monitor())


# ---- Shared status poller ----
# Single global task that calls poll_status() + read_errors_nonblocking() once
# per cycle for all clients, eliminating redundant STAT.poll() / hal_get() / GIL
# contention when multiple clients are connected.

_shared_status: Optional["StatusPayload"] = None
_shared_status_dict: Optional[dict] = None  # cached asdict(_shared_status)
_shared_errors: list = []
_shared_probe_updates: dict = {}
_shared_timing: dict = {}  # poll_ms, errors_ms, parse_ms, poller_ts
# Per-cycle snapshot of connected clients — rebuilt once by the poller so
# every status_loop doesn't repeat the O(N) list-comp (avoids O(N²)/cycle).
# Reference is swapped atomically before _status_event.set(), so readers
# always see a consistent list for the duration of their iteration.
_shared_clients_list: list = []
_surface_points_pending: list | None = None  # latest surface scan points; None = never scanned
_surface_points_version: int = int(time.time())  # bumped each time new data is ready; seeded from startup so ?v= URLs don't collide across restarts
_surface_initialized: bool = False           # True after startup file-read attempted
_comp_grid_pending: dict | None = None       # latest parsed probe-results-grid.json
_comp_grid_version: int = int(time.time())   # bumped each time new grid is ready; seeded from startup so ?v= URLs don't collide across restarts
_comp_grid_initialized: bool = False         # True after startup file-read attempted
_last_comp_hal_ver: int | None = None        # last seen compensation.grid-version HAL value

# Shared gcode preview — parsed once in a subprocess (gcode_parse_worker.py)
# on file/rotation change. The parsed result (multi-MB polylines) is NOT
# broadcast over the WS — N × ws.send_bytes(2.7 MB) saturates the event-loop
# writer and trips the heartbeat watchdog. Instead: pre-encode the bytes, serve
# them via GET /preview (uvicorn streamed response runs off the WS writer),
# and broadcast a tiny JSON ping per version so clients know to fetch.
_gcode_preview_pending: Optional[dict] = None   # {"file","feed","feed_lines","rapid","stats"}
_gcode_preview_version: int = int(time.time()) # bumps on file change (or unload); seeded from startup so ?v= URLs don't collide across restarts
_gcode_last_file: Optional[str] = None          # edge detection in poller
_gcode_refresh_running: bool = False            # single-flight guard
# Pre-encoded msgpack bytes of _gcode_preview_pending. Served over HTTP by
# GET /preview so the 2.7 MB polyline payload never touches the WS writer.
_gcode_preview_bytes: Optional[bytes] = None

# Pre-encoded msgpack bytes of the surface_points / comp_grid data dicts.
# Served over HTTP by GET /surface_points and GET /comp_grid so the 10-80 KB
# per-client fan-out never touches the single-threaded WS writer. Clients
# receive a tiny *_ready JSON ping on version bump and fetch the cached
# bytes out of band.
_surface_points_bytes: Optional[bytes] = None
_comp_grid_bytes: Optional[bytes] = None

# Path to the subprocess parse worker (spawned via asyncio.create_subprocess_exec).
_GCODE_WORKER_PATH = str(BASE_DIR / "gcode_parse_worker.py")

# Safety-trip sticky notification: populated when _status_poller() detects a
# TRUE→FALSE edge on oneshot.0.out (HAL heartbeat watchdog). Broadcast to all
# clients in every status message until a client sends {cmd:"safety_trip_ack"}.
# Lives server-side (not per-client) so reload / multi-tab all see the same trip.
_unacked_trip: Optional[dict] = None  # {"ts": unix_ms, "reason": str}
_last_trip_count: Optional[int] = None  # webui-safety.trip-count at last poll

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
        print(f"[TIMING] log write failed: {e}", flush=True)


_PID_CHECK_INTERVAL = 5.0  # seconds between pgrep PID checks


def _read_probe_results_file() -> list:
    """Read probe-results.txt and return list of [x, y, z] triples."""
    ini_path = getattr(STAT, "ini_filename", None)
    if not ini_path:
        return []
    path = os.path.join(os.path.dirname(ini_path), "probe-results.txt")
    points = []
    if os.path.isfile(path):
        with open(path) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) >= 3:
                    try:
                        points.append([float(parts[0]), float(parts[1]), float(parts[2])])
                    except ValueError:
                        pass
    return points


def _read_comp_grid_file() -> "dict | None":
    """Read probe-results-grid.json and return parsed dict, or None if unavailable."""
    ini_path = getattr(STAT, "ini_filename", None)
    if not ini_path:
        return None
    path = os.path.join(os.path.dirname(ini_path), "probe-results-grid.json")
    if not os.path.isfile(path):
        return None
    with open(path) as f:
        try:
            return json.load(f)
        except Exception:
            return None


def _poll_and_serialize():
    """Executor-thread helper: poll STAT + serialize to dict in one hop.

    Combines poll_status() and asdict() so neither touches the event loop.
    Returns (StatusPayload, dict) — the dict is cached as _shared_status_dict
    and consumed (via .copy()) by every per-client status_loop.
    """
    st = poll_status()
    return st, asdict(st)


async def _status_poller():
    """Single global poller — polls LinuxCNC once per cycle for all clients.

    All LinuxCNC C extension calls (STAT.poll(), hal.get_value(), NML reads)
    hold the GIL and never release it — run_in_executor provides zero
    parallelism, only thread dispatch overhead (1-5ms per call). Every
    successful LinuxCNC UI (AXIS 50Hz, GMOCCAPY 10Hz, QtVCP 10Hz) polls
    synchronously. We do the same, yielding to the event loop between
    blocking sections so heartbeats and sends can proceed.
    """
    global _shared_status, _shared_status_dict, _shared_errors, _shared_probe_updates
    global _status_gen, lcnc_connected, STAT, CMD, ERR, _reconnect_fails, _shared_timing
    global _surface_points_pending, _surface_points_version, _surface_initialized
    global _comp_grid_pending, _comp_grid_version, _comp_grid_initialized, _last_comp_hal_ver
    global _status_event, _shared_clients_list
    global _gcode_preview_pending, _gcode_preview_version
    global _gcode_last_file, _gcode_refresh_running
    global _gcode_preview_bytes
    global _surface_points_bytes, _comp_grid_bytes
    loop = asyncio.get_event_loop()
    _poll_fails = 0
    _last_pid_check = 0.0
    _cycle_start = time.monotonic()
    _was_active = True  # Experiment 4: track active/idle edge for instant wake-up
    while True:
        try:
            _cycle_start = time.monotonic()

            if not _clients:
                await asyncio.sleep(0.5)
                continue

            # ---- Reconnection logic (moved from per-client status_loop) ----
            if not lcnc_connected:
                pid = _get_lcnc_pid()
                if pid is not None and try_connect_lcnc():
                    _reconnect_fails = 0
                    _hal_connect()
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
                if check_lcnc_instance():
                    if _lcnc_pid is not None:
                        if try_connect_lcnc():
                            _reconnect_fails = 0
                            _hal_connect()
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
            st, status_dict = await loop.run_in_executor(None, _poll_and_serialize)
            t1 = time.monotonic()
            raw_errs = read_errors_nonblocking()
            t2 = time.monotonic()
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
                            except ValueError:
                                pass
                            continue
                    elif "LCNC_SURFACE_SCAN_DONE" in text:
                        surface_scan_done = True
                        continue  # consume — don't forward to frontend as an error
                errs.append((kind, text))

            # Startup init: push existing probe-results.txt to new clients on first connect
            if not _surface_initialized and getattr(STAT, "ini_filename", None):
                pts = _read_probe_results_file()
                if pts:
                    _surface_points_pending = pts
                    _surface_points_bytes = await asyncio.to_thread(
                        _msgspec.msgpack.encode, pts
                    )
                    _surface_points_version += 1
                _surface_initialized = True

            # Scan completion: re-read file and push updated data to all clients
            if surface_scan_done:
                pts = _read_probe_results_file()
                if pts:
                    _surface_points_pending = pts
                    _surface_points_bytes = await asyncio.to_thread(
                        _msgspec.msgpack.encode, pts
                    )
                    _surface_points_version += 1

            # Comp grid startup init: push existing probe-results-grid.json on first connect
            if not _comp_grid_initialized and getattr(STAT, "ini_filename", None):
                grid = _read_comp_grid_file()
                if grid:
                    _comp_grid_pending = grid
                    _comp_grid_bytes = await asyncio.to_thread(
                        _msgspec.msgpack.encode, grid
                    )
                    _comp_grid_version += 1
                _last_comp_hal_ver = st.comp_grid_version  # sync — prevents re-fire below
                _comp_grid_initialized = True

            # Comp grid update: detect via compensation.grid-version HAL pin
            if _comp_grid_initialized and st.comp_grid_version is not None \
                    and st.comp_grid_version != _last_comp_hal_ver:
                grid = _read_comp_grid_file()
                if grid:
                    _comp_grid_pending = grid
                    _comp_grid_bytes = await asyncio.to_thread(
                        _msgspec.msgpack.encode, grid
                    )
                    _comp_grid_version += 1
                _last_comp_hal_ver = st.comp_grid_version

            # Gcode preview: parse once (in subprocess) on file change, share
            # to all clients via version counter. Single-flight via
            # _gcode_refresh_running so rapid-fire loads don't stack
            # subprocesses. Parse output is WCS-invariant (worker un-rotates
            # and un-offsets), so rotation edits and WCS switches never
            # trigger a re-parse — frontend re-applies LIVE origin+rotation
            # as scene-graph updates.
            file_changed = bool(st.active_file) and st.active_file != _gcode_last_file
            if file_changed and not _gcode_refresh_running:
                _gcode_refresh_running = True
                asyncio.create_task(_refresh_gcode_preview(st.active_file))
            elif not st.active_file and _gcode_last_file is not None:
                _gcode_preview_pending = None
                _gcode_preview_bytes = None
                _gcode_preview_version += 1
                _gcode_last_file = None

            # Safety-trip detection via webui-safety.trip-count. The counter is
            # incremented by the independent hal_watchdog.py process on every
            # oneshot.0.out TRUE→FALSE edge. Reading it here survives gateway
            # stalls: even if the poller was frozen during the FALSE window,
            # the counter records the trip for us to observe on resume.
            global _last_trip_count, _unacked_trip
            trip_count = _hal_fast("safety-trip-count", None)
            if trip_count is not None:
                if _last_trip_count is None:
                    _last_trip_count = trip_count  # sync on first poll
                elif trip_count > _last_trip_count:
                    if _unacked_trip is None:
                        _unacked_trip = {
                            "ts": int(time.time() * 1000),
                            "reason": "hal_heartbeat_timeout",
                        }
                        print(f"[SAFETY] HAL heartbeat watchdog tripped at {_unacked_trip['ts']} (trip-count {trip_count})", flush=True)
                    _last_trip_count = trip_count

            # Cache results for per-client loops
            _shared_status = st
            _shared_status_dict = status_dict
            _shared_clients_list = [
                {"ip": c["ip"], "armed": c["armed"]} for c in _clients.values()
            ]
            t3 = time.monotonic()
            _shared_errors = errs
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
                "poller_ts": t3,
            }
            # Broadcast: swap in a fresh unset event for future waiters, then
            # set the old one to wake all current waiters. This avoids the
            # clear/set race where a client checking _status_gen between set()
            # and clear() could miss the wake-up.
            _status_gen += 1
            old_evt = _status_event
            _status_event = asyncio.Event()
            if old_evt is not None:
                old_evt.set()

        except Exception as e:
            _poll_fails += 1
            if _poll_fails >= 5:
                lcnc_connected = False
                STAT = CMD = ERR = None
                _poll_fails = 0
                print(f"[POLLER] persistent poll failure: {type(e).__name__}: {e}", flush=True)

        # Adaptive sleep: subtract time already spent polling this cycle
        elapsed = time.monotonic() - _cycle_start

        # Experiment 4: adaptive poll rate — poll at IDLE_POLL_HZ when the
        # machine is idle (interp idle, not moving, no motion mode); full
        # POLL_HZ otherwise. Instant wake-up on idle→active transition keeps
        # first-motion latency at most one poll cycle, not one idle cycle.
        if _ADAPTIVE_POLL_ENABLED and _shared_status is not None:
            st = _shared_status
            _is_active = (
                (st.interp_state is not None and st.interp_state != linuxcnc.INTERP_IDLE)
                or (st.task_mode in (linuxcnc.MODE_AUTO, linuxcnc.MODE_MDI))
                or (st.current_vel is not None and abs(st.current_vel) > 0.001)
                or (st.inpos is False)
                or (st.tool_change_requested is True)
            )
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
        _status_poller_task = asyncio.get_event_loop().create_task(_status_poller())


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
        except (OSError, IOError):
            pass
    # Slow path: discover PID via pgrep (only when PID unknown or stale)
    try:
        result = subprocess.run(
            ['pgrep', '-x', 'linuxcncsvr'],
            capture_output=True, text=True, timeout=1,
        )
        if result.returncode == 0:
            return int(result.stdout.strip().split('\n')[0])
    except Exception:
        pass
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
    """Spawn a fresh gateway process and exit. Last resort for NML poisoning."""
    print("NML POISONED: self-restarting gateway process", flush=True)
    _hal_disconnect()
    subprocess.Popen([sys.executable, "-m", "uvicorn"] + sys.argv[1:])
    os._exit(1)


def try_connect_lcnc() -> bool:
    """Attempt to connect to LinuxCNC. Returns True on success."""
    global STAT, CMD, ERR, lcnc_connected, _lcnc_pid, _nc_files_dir, _ini_config, _ever_connected
    _nc_files_dir = None        # re-resolve on reconnect
    _ini_config = None          # re-read INI config on reconnect
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
        # Create HAL monitor component for fast pin reads (once)
        _init_hal_monitor()
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
    global _wcs_cache_seeded
    old_pid = _lcnc_pid
    _lcnc_pid = pid
    _tool_tbl_path = None  # config may have changed, re-resolve from INI
    _tool_tbl_ini = None
    _wcs_cache_seeded = False  # re-seed WCS cache from var file on next poll
    if pid is None:
        print(f"[VINIT] check_lcnc_instance: PID gone (was {old_pid}), disconnecting", flush=True)
        lcnc_connected = False
        _hal_disconnect()
    else:
        print(f"[VINIT] check_lcnc_instance: PID changed {old_pid} -> {pid}", flush=True)
    return True


# Best-effort connection at startup (gateway still runs if LinuxCNC isn't up yet)
if _get_lcnc_pid() is not None:
    try_connect_lcnc()
    if lcnc_connected:
        _hal_connect()


# ---- NC files directory ----
ALLOWED_EXTENSIONS = {".ngc", ".nc", ".gcode", ".tap", ".txt"}
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB
_nc_files_dir: Optional[str] = None
_ini_config: Optional[dict] = None


def get_max_jog_velocity() -> Optional[float]:
    """Return max jog velocity from INI (units/sec), cached."""
    return get_ini_config().get("max_jog_velocity")


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

        # Spindle speed limits — try SPINDLE_0 through SPINDLE_9
        for i in range(10):
            section = f"SPINDLE_{i}"
            v = _ini_float(ini, section, "MAX_FORWARD_VELOCITY")
            if v is not None:
                config["max_spindle_speed"] = v
                config["min_spindle_speed"] = _ini_float(ini, section, "MIN_FORWARD_VELOCITY")
                break

        # Subroutine paths for probe macros [RS274NGC]SUBROUTINE_PATH
        sub_raw = ini.find("RS274NGC", "SUBROUTINE_PATH")
        if sub_raw:
            ini_dir = os.path.dirname(ini_path)
            sub_dirs = []
            for p in sub_raw.split(":"):
                p = p.strip()
                if not p:
                    continue
                if not os.path.isabs(p):
                    p = os.path.join(ini_dir, p)
                p = os.path.realpath(p)
                if os.path.isdir(p):
                    sub_dirs.append(p)
            config["subroutine_paths"] = sub_dirs

        _ini_config = config
    except Exception:
        pass

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
    """Return NC files directory from LinuxCNC INI, fallback ~/linuxcnc/nc_files."""
    global _nc_files_dir
    if _nc_files_dir is not None:
        return _nc_files_dir

    fallback = os.path.expanduser("~/linuxcnc/nc_files")

    if STAT is not None:
        try:
            STAT.poll()
            ini_path = getattr(STAT, "ini_filename", None)
            if ini_path:
                ini = linuxcnc.ini(ini_path)
                prefix = ini.find("DISPLAY", "PROGRAM_PREFIX")
                if prefix:
                    if not os.path.isabs(prefix):
                        prefix = os.path.join(os.path.dirname(ini_path), prefix)
                    prefix = os.path.realpath(prefix)
                    if os.path.isdir(prefix):
                        _nc_files_dir = prefix
                        return _nc_files_dir
        except Exception:
            pass

    _nc_files_dir = fallback
    os.makedirs(_nc_files_dir, exist_ok=True)
    return _nc_files_dir


# ---- Tool Table ----
TOOL_LIBRARY_PATH = BASE_DIR / "tool_library.json"
_tool_tbl_path: Optional[str] = None
_tool_tbl_ini: Optional[str] = None
_tool_meta_dirty = False
# mtime-keyed cache for tool_library.json — status_loop reads this on every
# tool-number change × every connected client, so the uncached disk-read +
# JSON-parse was the single largest event-loop stall in the status path.
_tool_lib_cache: Optional[Tuple[float, dict]] = None  # (mtime, data)

_TOOL_TP_RE = re.compile(r"T(\d+)\s+P(\d+)")
_TOOL_FIELD_RE = re.compile(r"([XYZD])([+-]?[\d.]+)")


def get_tool_tbl_path() -> Optional[str]:
    """Resolve the tool table file path from the LinuxCNC INI."""
    global _tool_tbl_path, _tool_tbl_ini
    # Invalidate cache if INI changed (user switched config)
    if _tool_tbl_path is not None:
        current_ini = getattr(STAT, "ini_filename", None) if STAT else None
        if current_ini != _tool_tbl_ini:
            _tool_tbl_path = None
            _tool_tbl_ini = None
        else:
            return _tool_tbl_path
    if STAT is None:
        return None
    try:
        STAT.poll()
        ini_path = getattr(STAT, "ini_filename", None)
        if not ini_path:
            return None
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
    except Exception:
        pass
    return None


def parse_tool_table(path: str) -> list:
    """Parse a LinuxCNC tool.tbl file → list of dicts.

    Handles both column orders: Z before D and D before Z,
    since LinuxCNC may rewrite the file in either order.
    """
    tools = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith(";") or line.startswith("#"):
                continue
            tp = _TOOL_TP_RE.match(line)
            if not tp:
                continue
            # Split off remark (everything after ';')
            remark = ""
            if ";" in line:
                data_part, remark = line.split(";", 1)
                remark = remark.strip()
            else:
                data_part = line
            # Extract X/Y/Z/D fields in any order
            fields = {m.group(1): float(m.group(2)) for m in _TOOL_FIELD_RE.finditer(data_part)}
            tools.append({
                "T": int(tp.group(1)),
                "P": int(tp.group(2)),
                "X": fields.get("X", 0.0),
                "Y": fields.get("Y", 0.0),
                "Z": fields.get("Z", 0.0),
                "D": fields.get("D", 0.0),
                "remark": remark,
            })
    return tools


def write_tool_table(path: str, tools: list):
    """Write tools to a LinuxCNC tool.tbl file atomically."""
    lines = [";Tool  Pocket Z Offset     Diameter     Remark\n"]
    for t in sorted(tools, key=lambda x: x["T"]):
        tn = t["T"]
        pn = t.get("P", tn)
        z = t.get("Z", 0.0)
        d = t.get("D", 0.0)
        remark = t.get("remark", "")
        line = f"T{tn:<5d} P{pn:<5d} Z{z:+013.6f}  D{d:+012.6f}"
        if remark:
            line += f"   ; {remark}"
        lines.append(line + "\n")
    dir_name = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.writelines(lines)
        os.rename(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except Exception:
            pass
        raise


def _current_ini_path() -> str:
    """Return the current INI file path, or 'default' if unavailable."""
    if STAT and getattr(STAT, "ini_filename", None):
        return STAT.ini_filename
    return "default"


def _load_tool_library_all() -> dict:
    """Load the full tool_library.json (all configs), mtime-cached.

    Hot path: status_loop calls load_tool_library() on every tool-number
    change for every connected client. mtime-keying catches both UI edits
    (via _save_tool_library_all) and external edits to the file.
    """
    global _tool_lib_cache
    if not TOOL_LIBRARY_PATH.exists():
        _tool_lib_cache = None
        return {}
    try:
        mtime = TOOL_LIBRARY_PATH.stat().st_mtime
    except OSError:
        return _tool_lib_cache[1] if _tool_lib_cache else {}
    if _tool_lib_cache is not None and _tool_lib_cache[0] == mtime:
        return _tool_lib_cache[1]
    try:
        with open(TOOL_LIBRARY_PATH, "r") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return _tool_lib_cache[1] if _tool_lib_cache else {}
    _tool_lib_cache = (mtime, data)
    return data


def _save_tool_library_all(all_data: dict):
    """Write tool_library.json atomically."""
    global _tool_lib_cache
    fd, tmp = tempfile.mkstemp(dir=str(TOOL_LIBRARY_PATH.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(all_data, f, indent=2)
        os.rename(tmp, str(TOOL_LIBRARY_PATH))
    except Exception:
        try:
            os.unlink(tmp)
        except Exception:
            pass
        raise
    _tool_lib_cache = None  # invalidate; next read re-loads with fresh mtime


def load_tool_library() -> dict:
    """Load extended tool metadata for the current INI config."""
    all_data = _load_tool_library_all()
    ini = _current_ini_path()
    # Migration: if top-level keys look like tool numbers (old format), wrap them
    if all_data and not any(k.startswith("/") for k in all_data) and any(k.isdigit() for k in all_data):
        all_data = {ini: all_data}
        _save_tool_library_all(all_data)
    return all_data.get(ini, {})


def save_tool_library(library: dict):
    """Write tool metadata for the current INI config."""
    all_data = _load_tool_library_all()
    all_data[_current_ini_path()] = library
    _save_tool_library_all(all_data)


_TOOL_META_FIELDS = (
    "type", "description", "flutes", "oal", "flute_length", "shoulder_length",
    "shoulder_diameter", "corner_radius", "body_length", "shaft_diameter",
    "taper_angle", "point_angle", "tip_diameter", "material", "holder", "holder_segments",
    "assembly_gauge_length", "profile",
)


# ---- Server-Side Settings ----
SETTINGS_PATH = BASE_DIR / "settings.json"
_settings_version = 0
_settings_cache: Optional[dict] = None
_fb_scale = 60  # spindle feedback scale: 60 (RPS→RPM) or 1 (already RPM)
_spindle_load_pin = ""  # HAL pin for spindle load %, empty = disabled
_tc_info_cache: dict = {}  # {(tool_num, tbl_mtime): merged_list} — one entry max
_HAL_PIN_RE = re.compile(r'^[a-zA-Z0-9_][a-zA-Z0-9_.:-]*$')
_VALID_SETTINGS_SECTIONS = {"macros", "machine", "viewer", "camera", "mdi", "gamepad", "probe", "toolsetter", "keyboard", "display", "panels"}


def _load_settings_all() -> dict:
    """Load the full settings.json (all configs)."""
    global _settings_cache
    if _settings_cache is not None:
        return _settings_cache
    if SETTINGS_PATH.exists():
        try:
            with open(SETTINGS_PATH, "r") as f:
                _settings_cache = json.load(f)
                return _settings_cache
        except Exception:
            pass
    _settings_cache = {}
    return _settings_cache


def _save_settings_all(all_data: dict):
    """Write settings.json atomically."""
    global _settings_cache
    fd, tmp = tempfile.mkstemp(dir=str(SETTINGS_PATH.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(all_data, f, indent=2)
        os.rename(tmp, str(SETTINGS_PATH))
        _settings_cache = all_data
    except Exception:
        try:
            os.unlink(tmp)
        except Exception:
            pass
        raise


def load_settings() -> dict:
    """Load settings for the current INI config."""
    all_data = _load_settings_all()
    return all_data.get(_current_ini_path(), {})


def save_settings_section(section: str, data):
    """Save a single settings section for the current INI config."""
    global _settings_version
    all_data = _load_settings_all()
    ini = _current_ini_path()
    if ini not in all_data:
        all_data[ini] = {}
    all_data[ini][section] = data
    _save_settings_all(all_data)
    _settings_version += 1


def reset_settings():
    """Reset all settings for the current INI config."""
    global _settings_version
    all_data = _load_settings_all()
    ini = _current_ini_path()
    if ini in all_data:
        del all_data[ini]
        _save_settings_all(all_data)
    _settings_version += 1


def _merge_tool_data(tbl_tools: list, library: dict) -> list:
    """Merge tool.tbl entries with metadata from tool_library.json."""
    merged = []
    for t in tbl_tools:
        key = str(t["T"])
        meta = library.get(key, {})
        entry = {
            "T": t["T"],
            "P": t["P"],
            "Z": t["Z"],
            "D": t["D"],
            "remark": t.get("remark", ""),
        }
        for field in _TOOL_META_FIELDS:
            if field == "description":
                entry[field] = meta.get("description", t.get("remark", ""))
            elif field == "type":
                entry[field] = meta.get("type", "")
            else:
                entry[field] = meta.get(field)
        merged.append(entry)
    return merged




def sanitize_filename(name: str) -> str:
    name = os.path.basename(name)
    name = name.replace("\x00", "")
    name = name.lstrip(".")
    if not name:
        name = "uploaded.ngc"
    return name


def validate_extension(filename: str) -> bool:
    _, ext = os.path.splitext(filename)
    return ext.lower() in ALLOWED_EXTENSIONS


def validate_path_within(path: str, root: str) -> bool:
    # Use abspath (not realpath) so symlinked subdirectories are allowed
    abs_path = os.path.abspath(path)
    abs_root = os.path.abspath(root)
    return abs_path.startswith(abs_root + os.sep) or abs_path == abs_root


@dataclass
class StatusPayload:
    ts: float

    # safety / state
    estop: bool
    enabled: bool
    homed: Optional[bool]  # LinuxCNC stat truth (normalized)
    homed_joints: Optional[list]  # per-joint homed mask (configured joints only)

    # task/motion
    task_mode: Optional[int]
    interp_state: Optional[int]
    paused: Optional[bool]
    state: Optional[int]
    motion_mode: Optional[int]  # TRAJ_MODE_FREE=1, TRAJ_MODE_COORD=2, TRAJ_MODE_TELEOP=3
    inpos: Optional[bool]       # machine is at commanded position
    axis_mask: Optional[int]    # bitmask of configured axes (bit0=X, bit1=Y, bit2=Z, …)
    program_units: Optional[int]  # 1=inch, 2=mm, 3=cm
    current_line: Optional[int]   # interpreter line (read-ahead, ahead of motion_line)
    read_line: Optional[int]      # line being parsed
    call_level: Optional[int]     # subroutine nesting depth

    # offsets and positions
    g5x_index: Optional[int]  # 0=G54, 1=G55, 2=G56, etc.
    g5x_offset: Optional[List[float]]
    g92_offset: Optional[List[float]]
    rotation_xy: Optional[float]
    joint_pos: Optional[List[float]]
    tool_offset: Optional[List[float]]
    machine_pos: Optional[List[float]]
    work_pos: Optional[List[float]]
    dtg: Optional[List[float]]

    # misc
    feed_override: Optional[float]
    spindle_override: Optional[float]
    rapid_override: Optional[float]
    feed_override_enabled: Optional[bool]
    spindle_override_enabled: Optional[bool]
    block_delete: Optional[bool]           # block delete (/) switch
    optional_stop: Optional[bool]          # optional stop (M1) switch
    feed_hold_enabled: Optional[bool]      # feed hold allowed
    adaptive_feed_enabled: Optional[bool]  # adaptive feed active
    max_velocity: Optional[float]
    max_jog_velocity: Optional[float]
    current_vel: Optional[float]
    spindle_speed: Optional[float]       # commanded (S word)
    spindle_speed_actual: Optional[float] # after override
    spindle_load: Optional[float]        # load % from configurable HAL pin
    spindle_direction: Optional[int]
    active_file: Optional[str]
    motion_line: Optional[int]
    ini_filename: Optional[str]

    # active modal codes
    gcodes: Optional[List[int]]
    mcodes: Optional[List[int]]

    # tool (stat-only)
    tool_number: Optional[int]
    tool_diameter: Optional[float]
    tool_length: Optional[float]   # Z length offset (positive magnitude)

    # tool change (HAL iocontrol)
    tool_change_requested: Optional[bool]
    tool_change_tool: Optional[int]
    tool_change_info: Optional[dict]

    # probing
    probe_tripped: Optional[bool]
    probe_input: Optional[bool]
    probing: Optional[bool]
    probed_position: Optional[List[float]]

    # external offset (surface compensation)
    eoffset_z: Optional[float]
    eoffset_enabled: Optional[bool]
    comp_method: Optional[int]  # 0=nearest, 1=linear, 2=cubic
    comp_grid_version: Optional[int]

    # coolant
    flood: Optional[bool]
    mist: Optional[bool]

    # INI config (static, cached)
    linear_units: Optional[str] = None  # "mm" or "in" — machine native units from [TRAJ]LINEAR_UNITS
    default_jog_velocity: Optional[float] = None
    min_jog_velocity: Optional[float] = None
    max_angular_jog_velocity: Optional[float] = None
    default_angular_jog_velocity: Optional[float] = None
    min_angular_jog_velocity: Optional[float] = None
    increments: Optional[List[float]] = None
    default_spindle_speed: Optional[float] = None
    min_spindle_override: Optional[float] = None
    max_spindle_override: Optional[float] = None
    max_feed_override: Optional[float] = None
    max_spindle_speed: Optional[float] = None
    min_spindle_speed: Optional[float] = None
    debug: Optional[bool] = None




def hal_get(pin: str, default=None):
    """Read a HAL pin value. Tries hal module first, falls back to halcmd."""
    try:
        return hal.get_value(pin)
    except Exception:
        pass
    try:
        result = subprocess.run(
            ['halcmd', '-s', 'getp', pin],
            capture_output=True, text=True, timeout=1
        )
        if result.returncode == 0:
            raw = result.stdout.strip()
            if raw == "TRUE":
                return 1
            if raw == "FALSE":
                return 0
            return float(raw)
    except Exception:
        pass
    return default


def safe_get(attr: str, default=None):
    if STAT is None:
        return default
    try:
        return getattr(STAT, attr)
    except Exception:
        return default


def to_float_list(x) -> Optional[List[float]]:
    if x is None:
        return None
    try:
        return [float(v) for v in x]
    except Exception:
        return None


def normalize_homed(homed_val) -> Optional[bool]:
    """
    LinuxCNC-native homed confirmation (stat-only), using only configured joints.

    Why: STAT.homed can be a fixed-length mask (e.g. 9 entries). Unused joints stay False.
    If we all() the whole mask, homed may remain False even when the machine is homed.
    """
    # Scalar case (some builds)
    if isinstance(homed_val, (int, bool)):
        return bool(homed_val)

    # Mask case
    if isinstance(homed_val, (list, tuple)):
        if len(homed_val) == 0:
            return None

        # Prefer STAT.joints if available
        nj = safe_get("joints", None)
        if isinstance(nj, int) and nj > 0:
            mask = homed_val[:nj]
        else:
            # Fallback: infer from STAT.joint list length if available
            jlist = safe_get("joint", None)
            if jlist is not None:
                try:
                    mask = homed_val[:len(jlist)]
                except Exception:
                    mask = homed_val
            else:
                mask = homed_val

        return all(bool(x) for x in mask)

    return None

def _ini_float(ini, section: str, key: str):
    v = ini.find(section, key)
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
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


def get_spindle_override() -> Optional[float]:
    """
    Get spindle override with fallbacks for different LinuxCNC versions.
    Returns the override scale factor (1.0 = 100%).
    """
    # Try 1: Direct spindle_override attribute
    val = safe_get("spindle_override", None)
    if val is not None:
        try:
            result = float(val)
            if result > 0:  # Sanity check
                return result
        except (TypeError, ValueError):
            pass

    # Try 2: spindle array with override (multi-spindle configs)
    spindles = safe_get("spindle", None)
    if spindles is not None:
        try:
            # If it's an array/list, get first spindle's override
            if hasattr(spindles, '__getitem__'):
                s0 = spindles[0]
                if hasattr(s0, 'override'):
                    return float(s0.override)
                # Also try as dict
                if isinstance(s0, dict) and 'override' in s0:
                    return float(s0['override'])
        except (IndexError, AttributeError, TypeError, ValueError, KeyError):
            pass

    # Try 3: Check if spindle itself has override (single spindle)
    if spindles is not None:
        try:
            if hasattr(spindles, 'override'):
                return float(spindles.override)
        except (AttributeError, TypeError, ValueError):
            pass

    # Try 4: spindlerate (some versions)
    val = safe_get("spindlerate", None)
    if val is not None:
        try:
            result = float(val)
            if result > 0:
                return result
        except (TypeError, ValueError):
            pass

    # Try 5: Check spindle_0 specifically
    val = safe_get("spindle_0", None)
    if val is not None:
        try:
            if hasattr(val, 'override'):
                return float(val.override)
        except (AttributeError, TypeError, ValueError):
            pass

    return None


def _read_var_file(path: str, wanted: set) -> Dict[str, float]:
    """Read var file, return {var_number_str: float_value} for wanted keys."""
    result: Dict[str, float] = {}
    with open(path) as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2 and parts[0] in wanted:
                result[parts[0]] = float(parts[1])
    return result


def _seed_wcs_cache():
    """One-time seed of _wcs_cache from the var file (correct at startup)."""
    global _wcs_cache_seeded
    try:
        ini_path = getattr(STAT, "ini_filename", None)
        if not ini_path:
            return
        ini = linuxcnc.ini(ini_path)
        var_file = ini.find("RS274NGC", "PARAMETER_FILE")
        if not var_file:
            return
        if not os.path.isabs(var_file):
            var_file = os.path.join(os.path.dirname(ini_path), var_file)
        var_map = {}
        for i, base in enumerate(_WCS_BASES):
            for j, key in enumerate(_WCS_AXIS_KEYS):
                var_map[str(base + 1 + j)] = (i, key)
            var_map[str(base + 10)] = (i, "r")
        raw = _read_var_file(var_file, set(var_map))
        for var_key, value in raw.items():
            idx, field = var_map[var_key]
            _wcs_cache[idx][field] = value
        _wcs_cache_seeded = True
        print("[wcs] cache seeded from var file", flush=True)
    except Exception as e:
        print(f"[wcs] seed cache failed: {e}", flush=True)


def poll_status() -> StatusPayload:
    if STAT is None:
        raise RuntimeError("LinuxCNC not connected")
    STAT.poll()

    # ---- safety/state ----
    estop = bool(safe_get("estop", True))
    enabled = bool(safe_get("enabled", False))

    # ---- homing (stat-only truth) ----
    homed_val = safe_get("homed", None)
    homed = normalize_homed(homed_val)

    homed_joints = None
    if isinstance(homed_val, (list, tuple)):
        nj = safe_get("joints", None)
        if isinstance(nj, int) and nj > 0:
            homed_joints = [bool(x) for x in homed_val[:nj]]
        else:
            homed_joints = [bool(x) for x in homed_val]

    # ---- offsets ----
    g5x_index = safe_get("g5x_index", None)
    g5x = to_float_list(safe_get("g5x_offset", None))
    g92 = to_float_list(safe_get("g92_offset", None))
    rotation_xy = safe_get("rotation_xy", None)

    # Update WCS cache with live active-WCS data from STAT
    if not _wcs_cache_seeded:
        _seed_wcs_cache()
    if g5x_index is not None and g5x is not None:
        ci = g5x_index - 1  # STAT.g5x_index is 1-based
        if 0 <= ci < 9:
            for j, key in enumerate(_WCS_AXIS_KEYS):
                _wcs_cache[ci][key] = g5x[j] if len(g5x) > j else 0.0
            _wcs_cache[ci]["r"] = rotation_xy if rotation_xy is not None else 0.0

    # ---- positions ----
    # Prefer joint_actual_position (live encoder feedback, updates even when
    # machine is off/ESTOP) over actual_position (motion controller output,
    # stops updating when servo loop is disabled).  For trivkins machines
    # joint positions are identical to Cartesian axis positions.
    machine_pos = to_float_list(safe_get("joint_actual_position", None))
    if machine_pos is None:
        machine_pos = to_float_list(safe_get("actual_position", None))
    if machine_pos is None:
        machine_pos = to_float_list(safe_get("position", None))

    # Tool offset vector (active tool length comp)
    tool_offset = to_float_list(safe_get("tool_offset", None))

    # Work position (AXIS "G54 WORK"): WORK = MACHINE - G5X - G92 - TOOL_OFFSET
    work_pos = None
    if machine_pos is not None:
        work_pos = machine_pos.copy()

        if g5x is not None:
            for i in range(min(len(work_pos), len(g5x))):
                work_pos[i] -= g5x[i]

        if g92 is not None:
            for i in range(min(len(work_pos), len(g92))):
                work_pos[i] -= g92[i]

        if tool_offset is not None:
            for i in range(min(len(work_pos), len(tool_offset))):
                work_pos[i] -= tool_offset[i]

    # RAW joint positions (for driving the machine model / spindle nose)
    jpos = safe_get("joint_actual_position", None)
    if jpos is None:
        jpos = safe_get("joint_position", None)
    joint_pos = to_float_list(jpos)

    dtg = to_float_list(safe_get("dtg", None))

    # ---- velocity & spindle ----
    current_vel = safe_get("current_vel", None)
    try:
        current_vel = float(current_vel) if current_vel is not None else None
    except Exception:
        current_vel = None

    # Spindle speed and direction
    spindle_speed = None
    spindle_direction = None
    spindles = safe_get("spindle", None)
    if spindles is not None:
        try:
            if hasattr(spindles, '__getitem__'):
                s0 = spindles[0]
                # Try attribute access
                for attr in ('speed', 'Speed'):
                    v = getattr(s0, attr, None)
                    if v is not None:
                        spindle_speed = float(v)
                        break
                # Try dict access
                if spindle_speed is None and isinstance(s0, dict):
                    spindle_speed = float(s0.get('speed', s0.get('Speed', 0)))
                for attr in ('direction', 'Direction'):
                    v = getattr(s0, attr, None)
                    if v is not None:
                        spindle_direction = int(v)
                        break
                if spindle_direction is None and isinstance(s0, dict):
                    spindle_direction = int(s0.get('direction', s0.get('Direction', 0)))
        except (AttributeError, ValueError, TypeError, IndexError, KeyError):
            pass  # spindle[0] shape varies across linuxcnc versions — fall through to legacy paths
    # Fallback: direct stat attributes
    if spindle_speed is None:
        val = safe_get("spindle_speed", None)
        if val is not None:
            try:
                spindle_speed = float(val)
            except (ValueError, TypeError):
                pass
    # Fallback: settings[2] holds the commanded S word
    if spindle_speed is None:
        settings = safe_get("settings", None)
        if settings is not None:
            try:
                spindle_speed = float(settings[2])
            except (ValueError, TypeError, IndexError):
                pass
    if spindle_direction is None:
        val = safe_get("spindle_direction", None)
        if val is not None:
            try:
                spindle_direction = int(val)
            except (ValueError, TypeError):
                pass




    # ---- tool (stat-only) ----
    tool_number = safe_get("tool_in_spindle", None)
    try:
        tool_number = int(tool_number) if tool_number is not None else None
    except (ValueError, TypeError):
        tool_number = None

    tool_diameter = None
    tool_length = None

    # Try STAT.tool_table (if present)
    tt = safe_get("tool_table", None)
    if tool_number is not None and tt:
        try:
            for t in tt:
                # tool id varies by build
                tnum = getattr(t, "id", None)
                if tnum is None:
                    tnum = getattr(t, "toolno", None)
                if tnum is None:
                    tnum = getattr(t, "tool", None)
                if tnum is None:
                    continue
                if int(tnum) != int(tool_number):
                    continue

                d = getattr(t, "diameter", None)
                if d is None:
                    d = getattr(t, "dia", None)
                if d is not None:
                    tool_diameter = float(d)

                z = getattr(t, "zoffset", None)
                if z is None:
                    # sometimes offset is a tuple/struct with .z
                    off = getattr(t, "offset", None)
                    if off is not None:
                        z = getattr(off, "z", None)
                if z is not None:
                    tool_length = abs(float(z))

                break
        except (AttributeError, ValueError, TypeError):
            pass  # tool_table shape varies by linuxcnc version — leave tool_diameter/length as None

    # Fallback: STAT.tool_offset vector (if present)
    if tool_length is None:
        tofs = safe_get("tool_offset", None)
        if tofs is not None:
            try:
                tool_length = abs(float(tofs[2]))
            except (ValueError, TypeError, IndexError):
                pass


    # Tool change request from HAL iocontrol
    _tc_req = _hal_fast('tool-change', 0)
    tool_change_requested = bool(_tc_req)
    tool_change_tool = None
    tool_change_info = None
    if tool_change_requested:
        _tc_num = _hal_fast('tool-prep-number', 0)
        tool_change_tool = int(_tc_num) if _tc_num else None
        if tool_change_tool is not None:
            try:
                tbl_path = get_tool_tbl_path()
                tbl_mtime = os.path.getmtime(tbl_path) if tbl_path and os.path.exists(tbl_path) else 0
                cache_key = (tool_change_tool, tbl_mtime)
                if cache_key not in _tc_info_cache:
                    tbl_tools = parse_tool_table(tbl_path)
                    library = load_tool_library()
                    _tc_info_cache.clear()
                    _tc_info_cache[cache_key] = _merge_tool_data(tbl_tools, library)
                entry = next((t for t in _tc_info_cache[cache_key] if t["T"] == tool_change_tool), None)
                if entry:
                    tool_change_info = {"D": entry["D"], "Z": entry["Z"], "description": entry.get("description", "")}
            except (OSError, KeyError, ValueError, TypeError) as e:
                print(f"[TOOLCHANGE] info lookup failed for T{tool_change_tool}: {type(e).__name__}: {e}", flush=True)

    spindle_ovr = get_spindle_override()
    ini_cfg = get_ini_config()

    return StatusPayload(
        ts=time.time(),
        estop=estop,
        enabled=enabled,
        homed=homed,
        homed_joints=homed_joints,
        task_mode=safe_get("task_mode", None),
        interp_state=safe_get("interp_state", None),
        paused=bool(safe_get("paused", False)),
        state=safe_get("state", None),
        motion_mode=safe_get("motion_mode", None),
        inpos=bool(safe_get("inpos", 0)),
        axis_mask=safe_get("axis_mask", None),
        program_units=safe_get("program_units", None),
        current_line=safe_get("current_line", None),
        read_line=safe_get("read_line", None),
        call_level=safe_get("call_level", None),
        g5x_index=g5x_index,
        g5x_offset=g5x,
        g92_offset=g92,
        rotation_xy=rotation_xy,
        joint_pos=joint_pos,
        tool_offset=tool_offset,
        machine_pos=machine_pos,
        work_pos=work_pos,       # <-- tool-tip work coords
        dtg=dtg,
        feed_override=safe_get("feedrate", None),
        spindle_override=spindle_ovr,
        rapid_override=safe_get("rapidrate", None),
        feed_override_enabled=bool(safe_get("feed_override_enabled", True)),
        spindle_override_enabled=bool(safe_get("spindle_override_enabled", True)),
        block_delete=bool(safe_get("block_delete", 0)),
        optional_stop=bool(safe_get("optional_stop", 0)),
        feed_hold_enabled=bool(safe_get("feed_hold_enabled", 0)),
        adaptive_feed_enabled=bool(safe_get("adaptive_feed_enabled", 0)),
        max_velocity=safe_get("max_velocity", None),
        max_jog_velocity=get_max_jog_velocity(),
        current_vel=current_vel,
        spindle_speed=spindle_speed,
        spindle_speed_actual=_hal_fast('spindle-speed-in', 0) * _fb_scale,
        spindle_load=hal_get(_spindle_load_pin) if _spindle_load_pin else None,
        spindle_direction=spindle_direction,
        active_file=safe_get("file", None),
        motion_line=safe_get("motion_line", None),
        ini_filename=safe_get("ini_filename", None),
        gcodes=to_float_list(safe_get("gcodes", None)),
        mcodes=to_float_list(safe_get("mcodes", None)),
        tool_number=tool_number,
        tool_diameter=tool_diameter,
        tool_length=tool_length,
        tool_change_requested=tool_change_requested,
        tool_change_tool=tool_change_tool,
        tool_change_info=tool_change_info,
        probe_tripped=bool(safe_get("probe_tripped", 0)),
        probe_input=bool(_hal_fast("probe-input", False)),
        probing=bool(safe_get("probing", 0)),
        probed_position=to_float_list(safe_get("probed_position", None)),
        flood=bool(safe_get("flood", 0)),
        mist=bool(safe_get("mist", 0)),
        eoffset_z=_hal_fast("z-eoffset", None),
        eoffset_enabled=bool(_hal_fast("z-eoffset-enable", False)),
        comp_method=_hal_fast("comp-method", None),
        comp_grid_version=_hal_fast("comp-grid-ver", None),
        linear_units=ini_cfg.get("linear_units"),
        default_jog_velocity=ini_cfg.get("default_jog_velocity"),
        min_jog_velocity=ini_cfg.get("min_jog_velocity"),
        max_angular_jog_velocity=ini_cfg.get("max_angular_jog_velocity"),
        default_angular_jog_velocity=ini_cfg.get("default_angular_jog_velocity"),
        min_angular_jog_velocity=ini_cfg.get("min_angular_jog_velocity"),
        increments=ini_cfg.get("increments"),
        default_spindle_speed=ini_cfg.get("default_spindle_speed"),
        min_spindle_override=ini_cfg.get("min_spindle_override"),
        max_spindle_override=ini_cfg.get("max_spindle_override"),
        max_feed_override=ini_cfg.get("max_feed_override"),
        max_spindle_speed=ini_cfg.get("max_spindle_speed"),
        min_spindle_speed=ini_cfg.get("min_spindle_speed"),
        debug=ini_cfg.get("debug", False),
    )



def read_errors_nonblocking() -> list:
    if ERR is None:
        return []
    out = []
    try:
        while len(out) < 50:  # cap: prevents executor stall on pathological error floods
            e = ERR.poll()
            if not e:
                break
            out.append(e)
    except Exception:
        pass  # Error buffer may be briefly invalid after reconnect
    return out


async def ws_send_json(ws: WebSocket, obj: Dict[str, Any]):
    # Legacy-name shim: all sends go through ws_send_measured so the wire-format
    # flag applies uniformly and non-status messages don't diverge from status
    # frames. Callers that need encode timing / bytes use ws_send_measured directly.
    await ws_send_measured(ws, obj)


def _diff_status_data(last: Dict[str, Any], current: Dict[str, Any]) -> Dict[str, Any]:
    """Return fields of `current` that differ from `last`.

    Single-level diff — StatusPayload is flat (no nested dataclasses per the
    definition around line 1144). For list-valued fields, Python == compares
    element-wise; mismatched lists are included whole. Removed keys are NOT
    reported: the one-shot injected field `tool_meta` would otherwise be
    cleared on the cycle after tool-change, which is exactly what we don't
    want (client keeps last known tool_meta — server re-injects on actual change).
    """
    diff: Dict[str, Any] = {}
    for k, v in current.items():
        if k not in last or last[k] != v:
            diff[k] = v
    return diff


async def ws_send_measured(ws: WebSocket, obj: Dict[str, Any]) -> Tuple[float, int]:
    """Encode + send a WS payload. Returns (encode_ms, bytes_sent).

    Used by the status hot path to attribute encode cost and payload size for
    the Debug-tab timing surface. Other callers keep using ws_send_json when
    they don't care about the measurement.

    The wire format is chosen by _WIRE_FORMAT (see Experiment 1). encode_ms
    excludes the actual ws.send_* call; bytes_sent is the size of the encoded
    payload. Returns (encode_ms, 0) if the client disconnected mid-send.
    """
    loop = asyncio.get_event_loop()
    t0 = time.monotonic()
    if _WIRE_FORMAT == "msgpack":
        data = await loop.run_in_executor(None, _msgpack_encoder.encode, obj)
    else:
        data = await loop.run_in_executor(None, _json_encoder_encode, obj)
    encode_ms = round((time.monotonic() - t0) * 1000, 3)
    try:
        if _WIRE_FORMAT == "msgpack":
            await ws.send_bytes(data)
        else:
            await ws.send_text(data if isinstance(data, str) else data.decode("utf-8"))
    except RuntimeError:
        return (encode_ms, 0)
    # msgspec returns bytes; stdlib json returns str — both have len() == bytes/chars
    return (encode_ms, len(data))


async def _cmd_blocking(cmd_fn, *args, wait=_CMD_WAIT_TIMEOUT) -> int:
    """Run a blocking CMD.* call + optional wait_complete() on a worker thread.

    Every `CMD.* + wait_complete()` pair must go through here. The LinuxCNC C
    extension holds the GIL during its blocking sections; calling it directly
    from the event-loop thread starves `_heartbeat_loop` and trips the HAL
    watchdog. `asyncio.to_thread` isolates the blocking section so heartbeats
    and status polls keep firing. Returns wait_complete()'s int result (0 ok,
    1 failed, -1 timeout) or 0 when wait=None.

    Caller must hold `_cmd_lock` — NML command channel is not thread-safe.
    """
    def _run():
        cmd_fn(*args)
        if wait is not None:
            return CMD.wait_complete(wait)
        return 0
    return await asyncio.to_thread(_run)


async def set_mode(mode: int):
    """Switch LinuxCNC task mode. Caller must hold `_cmd_lock`."""
    STAT.poll()
    if safe_get("task_mode", None) == mode:
        return
    await _cmd_blocking(CMD.mode, mode)

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



def _jog_joint_flag() -> int:
    """Return the joint_flag for CMD.jog() based on current trajectory mode.
    0 = Cartesian axis (TRAJ_MODE_TELEOP), 1 = joint (TRAJ_MODE_FREE, safe default)."""
    STAT.poll()
    if safe_get("motion_mode", None) == linuxcnc.TRAJ_MODE_TELEOP:
        return 0
    return 1


def require_armed(armed: bool):
    if not armed:
        raise PermissionError("Not armed")


async def handle_command(msg: Dict[str, Any], armed: bool):
    # Acquire the CMD lock before dispatching. Every path that touches CMD.*
    # must hold this lock; see _cmd_lock docstring.
    async with _get_cmd_lock():
        return await _handle_command_impl(msg, armed)


async def _handle_command_impl(msg: Dict[str, Any], armed: bool):
    global _estop_hold
    cmd = msg.get("cmd")
    if not cmd:
        return {"ok": False, "error": "Missing cmd"}

    # ---- Read-only commands (no LinuxCNC connection or arming needed) ----
    try:
        if cmd == "get_tool_table":
            tbl_path = get_tool_tbl_path()
            if not tbl_path:
                return {"ok": False, "error": "Tool table path not available (LinuxCNC not connected yet?)"}
            tbl_tools = parse_tool_table(tbl_path)
            library = load_tool_library()
            merged = _merge_tool_data(tbl_tools, library)
            current_tool = None
            try:
                if STAT:
                    STAT.poll()
                    raw = safe_get("tool_in_spindle", None)
                    current_tool = int(raw) if raw is not None else None
            except (AttributeError, ValueError, TypeError, linuxcnc.error) as e:
                print(f"[TOOLS] current_tool poll failed: {type(e).__name__}: {e}", flush=True)
            return {"ok": True, "tools": merged, "current_tool": current_tool}

        if cmd == "get_probe_results":
            return {"ok": True, "points": _read_probe_results_file()}

        if cmd == "get_comp_grid":
            ini_path = getattr(STAT, "ini_filename", None)
            config_dir = os.path.dirname(ini_path) if ini_path else ""
            path = os.path.join(config_dir, "probe-results-grid.json")
            if os.path.isfile(path):
                with open(path, "r") as f:
                    try:
                        grid = json.load(f)
                        return {"ok": True, "comp_grid": grid}
                    except (json.JSONDecodeError, ValueError):
                        return {"ok": False, "error": "Invalid grid file"}
            return {"ok": False, "error": "No grid file"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    if not lcnc_connected:
        return {"ok": False, "error": "LinuxCNC not connected"}

    try:
        if cmd == "arm":
            return {"ok": True}

        if cmd == "estop":
            CMD.state(linuxcnc.STATE_ESTOP)
            _estop_hold = True
            _hal_send({"connected": False})  # hold via _estop_hold
            return {"ok": True}

        if cmd == "estop_reset":
            require_armed(armed)
            # Release hal_watchdog's trip-latch first so the safety chain
            # can come back up when LinuxCNC transitions out of ESTOP.
            # 20ms sleep ≈ 2× hal_watchdog select slice, enough for the
            # pin write to land before STATE_ESTOP_RESET is evaluated.
            _hal_send({"trip_reset": True})
            time.sleep(0.02)
            CMD.state(linuxcnc.STATE_ESTOP_RESET)
            _estop_hold = False
            _hal_send({"connected": True})
            return {"ok": True}

        if cmd == "machine_on":
            require_armed(armed)
            # Optional but nice: avoid guaranteed-fail calls
            STAT.poll()
            if bool(safe_get("estop", True)):
                return {"ok": False, "error": "Cannot Machine On while in E-stop"}
            CMD.state(linuxcnc.STATE_ON)
            return {"ok": True}

        if cmd == "machine_off":
            require_armed(armed)
            CMD.state(linuxcnc.STATE_OFF)
            return {"ok": True}

        if cmd == "set_mode":
            require_armed(armed)
            blocked = reject_if_auto_running()
            if blocked:
                return blocked
            mode = int(msg.get("mode", 0))
            if mode not in (linuxcnc.MODE_MANUAL, linuxcnc.MODE_AUTO, linuxcnc.MODE_MDI):
                return {"ok": False, "error": f"Invalid mode: {mode}"}
            await set_mode(mode)
            return {"ok": True}

        if cmd == "shutdown":
            # No require_armed — confirmation dialog is the safety gate
            print("Shutdown requested via web UI", flush=True)
            _hal_disconnect()
            _camera_release()
            os._exit(0)

        if cmd == "abort":
            require_armed(armed)
            CMD.abort()
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
            CMD.mdi(text)
            return {"ok": True}

        if cmd == "save_tool":
            require_armed(armed)
            tool_num = int(msg["tool_number"])
            tbl_path = get_tool_tbl_path()
            if not tbl_path:
                return {"ok": False, "error": "Tool table path not available"}

            # Update tool.tbl
            tbl_tools = parse_tool_table(tbl_path)
            found = False
            for t in tbl_tools:
                if t["T"] == tool_num:
                    if "pocket" in msg:
                        t["P"] = int(msg["pocket"])
                    if "z_offset" in msg:
                        t["Z"] = float(msg["z_offset"])
                    if "diameter" in msg:
                        t["D"] = float(msg["diameter"])
                    if "remark" in msg:
                        t["remark"] = str(msg["remark"])
                    found = True
                    break
            if not found:
                return {"ok": False, "error": f"Tool T{tool_num} not found"}

            write_tool_table(tbl_path, tbl_tools)
            if CMD:
                await asyncio.to_thread(CMD.load_tool_table)

            # Update metadata
            library = load_tool_library()
            key = str(tool_num)
            if key not in library:
                library[key] = {}
            for field in _TOOL_META_FIELDS:
                if field in msg:
                    library[key][field] = msg[field]
            save_tool_library(library)
            global _tool_meta_dirty
            _tool_meta_dirty = True
            return {"ok": True}

        if cmd == "add_tool":
            require_armed(armed)
            tool_num = int(msg["tool_number"])
            tbl_path = get_tool_tbl_path()
            if not tbl_path:
                return {"ok": False, "error": "Tool table path not available"}

            tbl_tools = parse_tool_table(tbl_path)
            for t in tbl_tools:
                if t["T"] == tool_num:
                    return {"ok": False, "error": f"Tool T{tool_num} already exists"}

            tbl_tools.append({
                "T": tool_num,
                "P": int(msg.get("pocket", tool_num)),
                "Z": float(msg.get("z_offset", 0.0)),
                "D": float(msg.get("diameter", 0.0)),
                "remark": str(msg.get("remark", "")),
            })
            write_tool_table(tbl_path, tbl_tools)
            if CMD:
                await asyncio.to_thread(CMD.load_tool_table)

            # Save metadata if provided
            library = load_tool_library()
            key = str(tool_num)
            library[key] = {}
            for field in _TOOL_META_FIELDS:
                if field in msg:
                    library[key][field] = msg[field]
            save_tool_library(library)
            return {"ok": True}

        if cmd == "delete_tool":
            require_armed(armed)
            tool_num = int(msg["tool_number"])

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

            tbl_tools = parse_tool_table(tbl_path)
            new_tools = [t for t in tbl_tools if t["T"] != tool_num]
            if len(new_tools) == len(tbl_tools):
                return {"ok": False, "error": f"Tool T{tool_num} not found"}

            write_tool_table(tbl_path, new_tools)
            if CMD:
                await asyncio.to_thread(CMD.load_tool_table)

            library = load_tool_library()
            library.pop(str(tool_num), None)
            save_tool_library(library)

            return {"ok": True}

        if cmd == "tool_change":
            require_armed(armed)
            blocked = reject_if_auto_running()
            if blocked:
                return blocked
            tool_num = int(msg["tool_number"])
            await set_mode(linuxcnc.MODE_MDI)
            CMD.mdi(f"T{tool_num} M6 G43")
            return {"ok": True}

        if cmd == "auto_step":
            require_armed(armed)
            STAT.poll()
            paused = bool(safe_get("paused", False))
            interp = safe_get("interp_state", None)
            mode = safe_get("task_mode", None)

            if paused:
                # Already paused → advance one block (no mode change)
                CMD.auto(linuxcnc.AUTO_STEP)
            elif mode == linuxcnc.MODE_AUTO and interp != linuxcnc.INTERP_IDLE:
                # Running (not paused) → pause first, next click will step
                CMD.auto(linuxcnc.AUTO_PAUSE)
            else:
                # Idle → start program and step
                await set_mode(linuxcnc.MODE_AUTO)
                CMD.auto(linuxcnc.AUTO_STEP)
            return {"ok": True}

        if cmd == "auto_run":
            require_armed(armed)
            spindle_dir = msg.get("spindle_dir")
            spindle_speed = int(msg.get("spindle_speed", 0))
            if spindle_dir and spindle_speed > 0:
                await set_mode(linuxcnc.MODE_MANUAL)
                if spindle_dir == "forward":
                    CMD.spindle(linuxcnc.SPINDLE_FORWARD, spindle_speed)
                elif spindle_dir == "reverse":
                    CMD.spindle(linuxcnc.SPINDLE_REVERSE, spindle_speed)
            await set_mode(linuxcnc.MODE_AUTO)
            start_line = int(msg.get("line", 0))
            CMD.auto(linuxcnc.AUTO_RUN, start_line)
            return {"ok": True}

        # jog left intact (even if you're not using it right now)
        if cmd == "jog_cont":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axis = int(msg.get("axis"))
            vel = float(msg.get("vel", 0.0))
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            CMD.jog(linuxcnc.JOG_CONTINUOUS, jf, axis, vel)
            return {"ok": True}

        if cmd == "jog_stop":
            if not armed:
                return {"ok": True}  # safety no-op — stopping is always safe

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axis = int(msg.get("axis"))
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            CMD.jog(linuxcnc.JOG_STOP, jf, axis)
            return {"ok": True}

        if cmd == "jog_cont_multi":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axes = msg.get("axes", [])
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            for entry in axes:
                CMD.jog(linuxcnc.JOG_CONTINUOUS, jf, int(entry["axis"]), float(entry["vel"]))
            return {"ok": True}

        if cmd == "jog_stop_multi":
            if not armed:
                return {"ok": True}  # safety no-op — stopping is always safe

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axes = msg.get("axes", [])
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            for a in axes:
                CMD.jog(linuxcnc.JOG_STOP, jf, int(a))
            return {"ok": True}

        if cmd == "jog_incr":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axis = int(msg.get("axis"))
            vel = abs(float(msg.get("vel", 0.0)))  # speed only; distance carries direction
            dist = float(msg.get("distance", 0.0))
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            CMD.jog(linuxcnc.JOG_INCREMENT, jf, axis, vel, dist)
            return {"ok": True}

        if cmd == "jog_incr_multi":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axes = msg.get("axes", [])
            await set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            for entry in axes:
                CMD.jog(linuxcnc.JOG_INCREMENT, jf, int(entry["axis"]), abs(float(entry["vel"])), float(entry["distance"]))
            return {"ok": True}

        if cmd == "home_all":
            require_armed(armed)
            await set_mode(linuxcnc.MODE_MANUAL)
            CMD.home(-1)  # -1 homes all axes
            return {"ok": True}

        if cmd == "unhome_all":
            require_armed(armed)
            await set_mode(linuxcnc.MODE_MANUAL)
            await _cmd_blocking(CMD.teleop_enable, 0)  # unhome requires joint mode
            CMD.unhome(-1)  # -1 unhomes all axes
            return {"ok": True}

        if cmd == "home":
            require_armed(armed)
            joint = int(msg.get("joint", -1))
            await set_mode(linuxcnc.MODE_MANUAL)
            CMD.home(joint)
            return {"ok": True}

        if cmd == "unhome":
            require_armed(armed)
            joint = int(msg.get("joint", -1))
            await set_mode(linuxcnc.MODE_MANUAL)
            await _cmd_blocking(CMD.teleop_enable, 0)  # unhome requires joint mode
            CMD.unhome(joint)
            return {"ok": True}

        if cmd == "cycle_start":
            require_armed(armed)
            await set_mode(linuxcnc.MODE_AUTO)
            CMD.auto(linuxcnc.AUTO_RUN, 0)  # Start from beginning
            return {"ok": True}

        if cmd == "cycle_pause":
            require_armed(armed)
            CMD.auto(linuxcnc.AUTO_PAUSE)
            return {"ok": True}

        if cmd == "cycle_resume":
            require_armed(armed)
            # Don't call set_mode - already in AUTO mode when paused
            CMD.auto(linuxcnc.AUTO_RESUME)
            return {"ok": True}

        if cmd == "set_feed_override":
            require_armed(armed)
            scale = float(msg.get("scale", 1.0))
            # Clamp to reasonable range (0-200%)
            scale = max(0.0, min(2.0, scale))
            CMD.feedrate(scale)
            return {"ok": True, "scale": scale}

        if cmd == "set_spindle_override":
            require_armed(armed)
            scale = float(msg.get("scale", 1.0))
            # Clamp to reasonable range (50-200%)
            scale = max(0.5, min(2.0, scale))
            CMD.spindleoverride(scale)
            return {"ok": True, "scale": scale}

        if cmd == "spindle_forward":
            require_armed(armed)
            speed = float(msg.get("speed", 0))
            await set_mode(linuxcnc.MODE_MANUAL)
            CMD.spindle(linuxcnc.SPINDLE_FORWARD, speed)
            return {"ok": True}

        if cmd == "spindle_reverse":
            require_armed(armed)
            speed = float(msg.get("speed", 0))
            await set_mode(linuxcnc.MODE_MANUAL)
            CMD.spindle(linuxcnc.SPINDLE_REVERSE, speed)
            return {"ok": True}

        if cmd == "spindle_stop":
            require_armed(armed)
            await set_mode(linuxcnc.MODE_MANUAL)
            CMD.spindle(linuxcnc.SPINDLE_OFF)
            return {"ok": True}

        if cmd == "flood_on":
            require_armed(armed)
            CMD.flood(linuxcnc.FLOOD_ON)
            return {"ok": True}

        if cmd == "flood_off":
            require_armed(armed)
            CMD.flood(linuxcnc.FLOOD_OFF)
            return {"ok": True}

        if cmd == "mist_on":
            require_armed(armed)
            CMD.mist(linuxcnc.MIST_ON)
            return {"ok": True}

        if cmd == "mist_off":
            require_armed(armed)
            CMD.mist(linuxcnc.MIST_OFF)
            return {"ok": True}

        if cmd == "set_rapid_override":
            require_armed(armed)
            scale = float(msg.get("scale", 1.0))
            # Clamp to 0-100%
            scale = max(0.0, min(1.0, scale))
            CMD.rapidrate(scale)
            return {"ok": True, "scale": scale}

        if cmd == "set_optional_stop":
            require_armed(armed)
            value = bool(msg.get("value", False))
            CMD.set_optional_stop(value)
            return {"ok": True}

        if cmd == "set_block_delete":
            require_armed(armed)
            value = bool(msg.get("value", False))
            CMD.set_block_delete(value)
            return {"ok": True}

        if cmd == "set_max_velocity":
            require_armed(armed)
            velocity = float(msg.get("velocity", 0.0))
            # Clamp to positive values
            velocity = max(0.0, velocity)
            CMD.maxvel(velocity)
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

            await set_mode(linuxcnc.MODE_AUTO)
            # program_open can legitimately take several seconds on large files —
            # offload so the heartbeat/poller keep ticking during the wait.
            await _cmd_blocking(CMD.program_open, abs_path, wait=5)
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
                    str_vars = {str(k): float(v) for k, v in vars_to_set.items()}
                    print(f"[probe] set_probe_vars: {str_vars}", flush=True)
                    with open(var_file) as f:
                        lines = f.readlines()
                    found = set()
                    for i, line in enumerate(lines):
                        parts = line.split()
                        if len(parts) >= 2 and parts[0] in str_vars:
                            lines[i] = f"{parts[0]}\t{str_vars[parts[0]]:.6f}\n"
                            found.add(parts[0])
                    # Insert missing vars and re-sort by var number
                    missing = {k: v for k, v in str_vars.items() if k not in found}
                    if missing:
                        for k, v in missing.items():
                            lines.append(f"{k}\t{v:.6f}\n")
                        def _var_key(line):
                            try: return int(line.split()[0])
                            except Exception: return 999999
                        lines.sort(key=_var_key)
                    # Atomic write: tempfile + rename prevents corruption on crash
                    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(var_file), suffix=".tmp")
                    try:
                        with os.fdopen(fd, "w") as f:
                            f.writelines(lines)
                        os.replace(tmp_path, var_file)
                    except Exception:
                        os.unlink(tmp_path)
                        raise
                    file_ok = True
            # 2) Best-effort: set in interpreter memory via MDI (requires armed + machine on + idle)
            # Split into chunks ≤250 chars to fit LinuxCNC's 256-char MDI buffer
            mdi_ok = False
            STAT.poll()
            if armed and bool(safe_get("enabled", False)) and not reject_if_auto_running():
                try:
                    items = [f"#{k}={float(v):.6f}" for k, v in vars_to_set.items()]
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
                    print(f"[probe] MDI set failed: {e}", flush=True)
            print(f"[probe] set_probe_vars result: file_saved={file_ok} mdi_set={mdi_ok}", flush=True)
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
            result = _read_var_file(var_file, {str(v) for v in var_nums})
            print(f"[probe] get_probe_vars: {result}", flush=True)
            return {"ok": True, "vars": result}

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
                indices = list(range(1, 10))
            elif target in _G5X_MAP:
                indices = [_G5X_MAP[target]]
            else:
                return {"ok": False, "error": f"Invalid target: {target}"}
            await set_mode(linuxcnc.MODE_MDI)
            STAT.poll()
            machine_axes = [a.lower() for a in _axes_from_mask(getattr(STAT, "axis_mask", 7))]
            zero_parts = " ".join(f"{k.upper()}0" for k in machine_axes) + " R0"
            for p in indices:
                await _cmd_blocking(CMD.mdi, f"G10 L2 P{p} {zero_parts}", wait=5)
            # Update cache immediately
            for p in indices:
                ci = p - 1
                if 0 <= ci < 9:
                    _wcs_cache[ci] = {"name": _WCS_NAMES[ci], **{k: 0.0 for k in _WCS_AXIS_KEYS}, "r": 0.0}
            return {"ok": True, "table": [row.copy() for row in _wcs_cache]}

        if cmd == "set_wcs":
            require_armed(armed)
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
                    parts.append(f"{axis.upper()}{float(val):.6f}")
            if not parts:
                return {"ok": False, "error": "No axis values provided"}
            await set_mode(linuxcnc.MODE_MDI)
            await _cmd_blocking(CMD.mdi, f"G10 L2 P{p} {' '.join(parts)}", wait=5)
            ci = p - 1
            for axis in all_keys:
                val = msg.get(axis)
                if val is not None:
                    _wcs_cache[ci][axis] = float(val)
            return {"ok": True, "table": [row.copy() for row in _wcs_cache]}

        return {"ok": False, "error": f"Unknown cmd: {cmd}"}

    except PermissionError as pe:
        return {"ok": False, "error": str(pe)}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}



# Probe result widget names from DEBUG EVAL messages → friendly keys
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

# -----------------------------
# Viewer support (Web 3D)
# -----------------------------

def get_machine_units() -> str:
    """Return 'in' or 'mm' based on INI [TRAJ]LINEAR_UNITS."""
    if not STAT or not getattr(STAT, "ini_filename", None):
        return "mm"
    try:
        ini = linuxcnc.ini(STAT.ini_filename)
        lu = (ini.find("TRAJ", "LINEAR_UNITS") or "mm").strip().lower()
        return "in" if lu in ("inch", "in", "imperial") else "mm"
    except Exception:
        return "mm"


def _load_machine_config() -> dict:
    """Load machine model config from machine.json, or return hardcoded defaults."""
    cfg_path = MACHINE_DIR / "machine.json"
    if cfg_path.exists():
        try:
            with open(cfg_path) as f:
                cfg = json.load(f)
            print(f"[VINIT] Loaded machine config: {cfg.get('name', '?')}", flush=True)
            return cfg
        except Exception as e:
            print(f"[VINIT] Failed to load machine.json: {e}, using defaults", flush=True)
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


MACHINE_CFG = _load_machine_config()


def _stl_versioned(filename: str) -> str:
    """Append ?v=<mtime> for immutable browser caching with automatic invalidation."""
    p = MACHINE_DIR / filename
    mtime = int(p.stat().st_mtime) if p.exists() else 0
    return f"{filename}?v={mtime}"


_AXIS_LETTERS = "XYZABCUVW"


def _axes_from_mask(mask: int) -> List[str]:
    """Derive axis letter list from LinuxCNC axis_mask bitmask."""
    return [_AXIS_LETTERS[i] for i in range(9) if mask & (1 << i)]


def build_viewer_init(stl_base_url: str) -> Dict[str, Any]:
    """Build viewer init payload from machine.json config + INI-derived bounds."""
    print(f"[VINIT] build_viewer_init called, STAT={'OK' if STAT else 'None'}, lcnc_connected={lcnc_connected}", flush=True)

    limits = read_machine_limits_from_ini(STAT) if STAT else None
    if limits:
        bounds_origin, bounds_size = limits
    else:
        bounds_origin, bounds_size = [0, 0, 0], [0, 0, 0]

    units = get_machine_units()

    # Axis letters from axis_mask (e.g. XYZ=7, XYZAC=39)
    axis_mask = 7  # default XYZ
    if STAT:
        try:
            STAT.poll()
            axis_mask = getattr(STAT, "axis_mask", 7)
        except (AttributeError, linuxcnc.error) as e:
            print(f"[INIT] axis_mask poll failed — defaulting to XYZ: {type(e).__name__}: {e}", flush=True)
    axes = _axes_from_mask(axis_mask)

    # Build parts with cache-busted filenames
    parts = []
    for p in MACHINE_CFG.get("parts", []):
        parts.append({
            "id": p["id"],
            "file": _stl_versioned(p["file"]),
            "group": p.get("group"),
            "translate": p.get("translate"),
            "rotate": p.get("rotate"),
        })

    return {
        "units": units,
        "stl_base_url": stl_base_url,
        "axes": axes,
        "machine_bounds": {
            "origin": bounds_origin,
            "size": bounds_size,
        },
        "groups": MACHINE_CFG.get("groups", []),
        "parts": parts,
        "kinematics": MACHINE_CFG.get("kinematics", []),
        "workGroup": MACHINE_CFG.get("workGroup"),
        "toolGroup": MACHINE_CFG.get("toolGroup"),
    }


def _build_wcs_rotation_patches() -> Dict[str, str]:
    """Build {param_number: str(value)} rotation patches for the parse worker.

    LinuxCNC only writes the var file on shutdown, so after G10 L2 R changes
    the disk copy has stale rotation. Only rotation (base + 10) is patched —
    axis offsets on disk are already correct in interpreter-internal units.
    (_wcs_cache mixes internal units from seed with machine units from STAT,
    so patching axis offsets would corrupt them.)
    """
    patches: Dict[str, str] = {}
    if not _wcs_cache:
        return patches
    for i, base in enumerate(_WCS_BASES):
        row = _wcs_cache[i]
        if row and "r" in row:
            patches[str(base + 10)] = f"{row['r']:.6f}"
    return patches


async def _refresh_gcode_preview(filepath: str):
    """Parse filepath in an isolated subprocess and publish the result.

    Called from _status_poller on file change. Single-flight via
    _gcode_refresh_running — the caller sets the flag before scheduling, this
    coroutine clears it on exit. The subprocess has its own Python interpreter
    and its own GIL, so _heartbeat_loop keeps ticking through the parse even
    for multi-second programs.
    """
    global _gcode_preview_pending, _gcode_preview_version
    global _gcode_last_file, _gcode_refresh_running
    global _gcode_preview_bytes
    t_start = time.monotonic()
    try:
        ini_path = getattr(STAT, "ini_filename", None) if STAT is not None else None
        if not ini_path:
            return
        active_idx = getattr(STAT, "g5x_index", None) if STAT is not None else None
        patches = _build_wcs_rotation_patches()
        ctx = {
            "file": filepath,
            "ini_path": ini_path,
            "units": get_machine_units(),
            "var_patches": patches,
            "g5x_index": active_idx if isinstance(active_idx, int) else 1,
        }
        ctx_bytes = _msgpack_encoder.encode(ctx) if _msgpack_encoder else json.dumps(ctx).encode()
        print(f"[GCODE] spawn start file={os.path.basename(filepath)} active_idx={active_idx}", flush=True)

        t_spawn = time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            sys.executable, _GCODE_WORKER_PATH,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        t_spawned = time.monotonic()
        print(f"[GCODE] spawn ok pid={proc.pid} fork_ms={(t_spawned - t_spawn)*1000:.0f}", flush=True)

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=ctx_bytes),
                timeout=60.0,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            print(f"[GCODE] parse timeout for {filepath}", flush=True)
            return
        t_communicated = time.monotonic()
        if proc.returncode != 0:
            err_tail = stderr.decode(errors="replace")[:500] if stderr else ""
            print(f"[GCODE] parse worker exit {proc.returncode}: {err_tail}", flush=True)
            return
        # Surface worker-side timing (printed to stderr by the worker).
        if stderr:
            for ln in stderr.decode(errors="replace").splitlines():
                if ln.strip():
                    print(f"[WORKER] {ln}", flush=True)
        print(f"[GCODE] worker done parse_ms={(t_communicated - t_spawned)*1000:.0f} stdout={len(stdout)}B", flush=True)

        if not _msgpack_encoder:
            print("[GCODE] msgspec not installed — cannot decode worker result", flush=True)
            return
        t_dec = time.monotonic()
        preview = await asyncio.to_thread(_msgspec.msgpack.decode, stdout)
        t_dec_done = time.monotonic()
        pending = {
            "file": filepath,
            "feed": preview.get("feed", []),
            "feed_lines": preview.get("feed_lines", []),
            "rapid": preview.get("rapid", []),
            "stats": preview.get("stats"),
        }
        # Encode once off-thread for the GET /preview endpoint. Clients fetch
        # this over HTTP (uvicorn's streamed-response path — independent of
        # the WS writer), so the event loop isn't stalled by N-way 2.7 MB
        # send_bytes() on a single thread.
        preview_bytes: bytes = await asyncio.to_thread(_msgspec.msgpack.encode, pending)
        t_enc_done = time.monotonic()
        # Publish pending + bytes together before bumping the version so
        # GET /preview readers never see stale bytes under a new version.
        _gcode_preview_pending = pending
        _gcode_preview_bytes = preview_bytes
        _gcode_preview_version += 1
        _gcode_last_file = filepath
        print(
            f"[GCODE] publish v={_gcode_preview_version} "
            f"decode_ms={(t_dec_done - t_dec)*1000:.0f} "
            f"encode_ms={(t_enc_done - t_dec_done)*1000:.0f} "
            f"bytes={len(preview_bytes)}B "
            f"total_ms={(t_enc_done - t_start)*1000:.0f}",
            flush=True,
        )
    except Exception as e:
        print(f"[GCODE] preview refresh failed for {filepath}: {type(e).__name__}: {e}", flush=True)
    finally:
        _gcode_refresh_running = False


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


# Serve static machine assets (STLs etc.)
# Always resolve relative to THIS FILE, not cwd

app.mount("/assets", StaticFiles(directory=str(MACHINE_DIR), html=False), name="assets")



@app.get("/health")
def health():
    return {"ok": True}


@app.post("/upload")
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

    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    try:
        fd, tmp_path = tempfile.mkstemp(dir=nc_dir, suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            f.write(content)
        os.rename(tmp_path, dest_path)
    except Exception as e:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    return {"ok": True, "path": dest_path, "filename": safe_name, "size": len(content)}


@app.put("/save")
async def save_gcode(path: str = Body(...), content: str = Body(...)):
    """Save edited G-code content back to an existing file."""
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

    encoded = content.encode("utf-8")
    if len(encoded) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    try:
        fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(abs_path), suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            f.write(encoded)
        os.rename(tmp_path, abs_path)
    except Exception as e:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    return {"ok": True, "path": abs_path, "size": len(encoded)}


# ---- Fusion 360 Tool Library Import ----

_FUSION_TYPE_MAP = {
    "flat end mill": "endmill",
    "ball end mill": "ball",
    "bull nose end mill": "bullnose",
    "chamfer mill": "chamfer",
    "drill": "drill",
    "spot drill": "drill",
    "counter bore": "endmill",
    "reamer": "endmill",
    "boring bar": "endmill",
    "center drill": "centerdrill",
    "counter sink": "countersink",
    "dovetail mill": "dovetail",
    "face mill": "facemill",
    "lollipop mill": "lollipop",
    "slot mill": "slotmill",
    "thread mill": "threadmill",
    "form mill": "formmill",
    "radius mill": "radiusmill",
    "tapered mill": "tapered",
    "probe": "probe",
    "tap right hand": "tap",
    "tap left hand": "tap",
    "engraving cutter": "engraver",
}


def _parse_fusion_library(data: dict) -> tuple[list, list]:
    """Parse a Fusion 360 Library.json → (tools, skipped_duplicates).

    Tools with duplicate numbers are excluded from the main list and returned
    separately so the caller can warn about them.  The *first* occurrence of
    each number is kept; later duplicates are skipped.
    """
    tools: list[dict] = []
    skipped: list[dict] = []
    seen_nums: dict[int, int] = {}          # tool_num → index in tools[]
    for entry in data.get("data", []):
        pp = entry.get("post-process", {})
        geom = entry.get("geometry", {})
        presets = entry.get("start-values", {}).get("presets", [])
        holder = entry.get("holder", {})

        tool_num = pp.get("number")
        if tool_num is None:
            continue

        fusion_type = entry.get("type", "")
        our_type = _FUSION_TYPE_MAP.get(fusion_type, "other")

        tool = {
            "T": int(tool_num),
            "D": float(geom.get("DC", 0)),
            "description": entry.get("description", "").strip(),
            "type": our_type,
            "flutes": geom.get("NOF"),
            "oal": geom.get("OAL"),
            "flute_length": geom.get("LCF"),
            "corner_radius": geom.get("RE"),
            "body_length": geom.get("LB"),
            "shaft_diameter": geom.get("SFDM"),
            "taper_angle": geom.get("TA"),
            "point_angle": geom.get("SIG"),
            "tip_diameter": geom.get("tip-diameter"),
            "shoulder_length": geom.get("shoulder-length"),
            "shoulder_diameter": geom.get("shoulder-diameter"),
            "assembly_gauge_length": geom.get("assemblyGaugeLength"),
            "material": entry.get("BMC"),
            "holder": holder.get("description") if holder else None,
            "fusion_type": fusion_type,
        }
        # ---- Per-type angle normalization (Fusion stores half-angles for some types) ----
        # Source: FreeCAD Better Tool Library reverse-engineering of Fusion 360 geometry keys
        if our_type in ("chamfer", "countersink", "centerdrill"):
            # Fusion TA is half-angle for chamfer/countersink — double to get included angle
            if tool.get("taper_angle"):
                tool["taper_angle"] *= 2
        if our_type in ("countersink", "centerdrill"):
            # Fusion SIG is half-angle for countersink/centerdrill — double to get included angle
            if tool.get("point_angle"):
                tool["point_angle"] *= 2
        # (drill/spot drill SIG is already the full included angle — no adjustment needed)

        # Normalize holder segments (stacked frustums) for 3D rendering
        holder_segs = holder.get("segments", []) if holder else []
        if holder_segs:
            tool["holder_segments"] = [
                {"height": s["height"], "lower_diameter": s["lower-diameter"],
                 "upper_diameter": s["upper-diameter"]}
                for s in holder_segs if "height" in s
            ]
        # Preserve form mill profile (2D outline segments) for 3D rendering
        if our_type == "formmill":
            raw_profile = geom.get("profile")
            if raw_profile and isinstance(raw_profile, list):
                tool["profile"] = raw_profile
        # Preserve raw presets (speeds/feeds per material) for sidecar
        if presets:
            tool["presets"] = presets

        t_int = int(tool_num)
        if t_int in seen_nums:
            skipped.append(tool)
        else:
            seen_nums[t_int] = len(tools)
            tools.append(tool)
    return tools, skipped


@app.post("/import-tool-library")
async def import_tool_library(file: UploadFile = File(...)):
    """Preview or apply a Fusion 360 tool library import.

    Query params:
      ?apply=true  — actually write to tool table + library (default: preview only)
      ?overwrite=true — overwrite existing tools (default: skip)
    """
    from starlette.requests import Request

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large")

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")

    if "data" not in data or not isinstance(data["data"], list):
        raise HTTPException(status_code=400, detail="Not a Fusion 360 tool library (missing 'data' array)")

    parsed, skipped = _parse_fusion_library(data)
    if not parsed and not skipped:
        raise HTTPException(status_code=400, detail="No tools found in library")

    # Count existing tools for warning
    tbl_path = get_tool_tbl_path()
    existing_count = 0
    if tbl_path:
        try:
            existing_count = len(parse_tool_table(tbl_path))
        except Exception:
            pass

    preview = [{**t} for t in parsed]
    skipped_preview = [{"T": t["T"], "description": t.get("description", ""),
                        "type": t.get("type", ""), "fusion_type": t.get("fusion_type", "")}
                       for t in skipped]

    return {"ok": True, "tools": preview, "total": len(parsed),
            "existing_count": existing_count,
            "skipped_duplicates": skipped_preview}


@app.post("/import-tool-library/apply")
async def apply_tool_library_import(
    file: UploadFile = File(...),
):
    """Apply a Fusion 360 tool library import — replaces tool.tbl and tool_library.json."""
    raw = await file.read()
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")

    parsed, _skipped = _parse_fusion_library(data)
    if not parsed:
        raise HTTPException(status_code=400, detail="No tools found")

    tbl_path = get_tool_tbl_path()
    if not tbl_path:
        raise HTTPException(status_code=500, detail="Tool table path not available")

    # Replace entire tool table and sidecar
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

    write_tool_table(tbl_path, tbl_tools)
    if CMD:
        await asyncio.to_thread(CMD.load_tool_table)
    save_tool_library(library)

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
    return FileResponse(abs_path, media_type="text/plain")


@app.get("/preview")
def get_preview(v: Optional[int] = None):
    """Return the cached msgpack-encoded parsed G-code preview.

    The `v` query parameter is advisory — purely a cache-buster so the
    browser treats each version as a distinct URL. The server always returns
    the CURRENT cached preview (even if `v` is stale), because that's what
    the client wants anyway. Returns 404 if no file is loaded.
    """
    if _gcode_preview_bytes is None:
        raise HTTPException(status_code=404, detail="No preview cached")
    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Preview-Version": str(_gcode_preview_version),
    }
    return Response(
        content=_gcode_preview_bytes,
        media_type="application/x-msgpack",
        headers=headers,
    )


@app.get("/surface_points")
def get_surface_points(v: Optional[int] = None):
    """Return the cached msgpack-encoded surface-scan points.

    Served off the WS writer so the 10-80 KB payload × N clients doesn't
    stall the event loop past the HAL heartbeat window. `v` is advisory —
    a cache-buster so each version is a distinct URL.
    """
    if _surface_points_bytes is None:
        raise HTTPException(status_code=404, detail="No surface data")
    return Response(
        content=_surface_points_bytes,
        media_type="application/x-msgpack",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Surface-Version": str(_surface_points_version),
        },
    )


@app.get("/comp_grid")
def get_comp_grid(v: Optional[int] = None):
    """Return the cached msgpack-encoded compensation grid.

    Same pattern as /surface_points — keeps the up-to-~80 KB grid off the
    single-threaded WS writer.
    """
    if _comp_grid_bytes is None:
        raise HTTPException(status_code=404, detail="No comp grid")
    return Response(
        content=_comp_grid_bytes,
        media_type="application/x-msgpack",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Comp-Grid-Version": str(_comp_grid_version),
        },
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
            return []
    except Exception:
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
            return []
    except Exception:
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
            return []
    except Exception:
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


@app.get("/hal")
async def get_hal():
    """Return HAL pins, signals, and params as parsed JSON."""
    loop = asyncio.get_event_loop()
    pins, signals, params = await asyncio.gather(
        loop.run_in_executor(None, _parse_hal_pins),
        loop.run_in_executor(None, _parse_hal_signals),
        loop.run_in_executor(None, _parse_hal_params),
    )
    return {"pins": pins, "signals": signals, "params": params}


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


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    armed = False  # connection-local arming

    global _next_client_id, _estop_hold, _unacked_trip
    global _gcode_preview_pending, _gcode_preview_version
    global _gcode_last_file
    global _gcode_preview_bytes, _gcode_refresh_running
    client_id = _next_client_id
    _next_client_id += 1
    client_ip = ws.client.host if ws.client else "unknown"
    _clients[client_id] = {"ip": client_ip, "armed": False, "last_hb": time.time(), "hb_mono": 0.0}
    _cancel_disconnect_grace()
    _start_heartbeat()
    _start_status_poller()

    # Restore lcnc_connected if LinuxCNC is still running but the flag was
    # cleared by a previous connection's WebSocket error
    global lcnc_connected
    if not lcnc_connected:
        if STAT is not None:
            try:
                STAT.poll()
                lcnc_connected = True
            except Exception:
                try_connect_lcnc()
        else:
            try_connect_lcnc()

    # Viewer: send static model/init once per connection
    host = ws.headers.get("host", "127.0.0.1:8000")  # includes port
    # Use the gateway's own port (8000) for STL assets rather than the
    # client-facing port.  In dev the client connects via Vite:5173 whose
    # HTTP/1.1 proxy pool is shared with JS-chunk downloads — STL fetches
    # stall behind them.  Gateway has CORS allow_origins=["*"] so a
    # cross-origin fetch from :5173 → :8000 works fine.
    host_only = host.split(":")[0]
    stl_base_url = f"http://{host_only}:8000/assets/"

    print(f"[VINIT] client#{client_id} connect-time viewer_init: lcnc_connected={lcnc_connected}, STAT={'OK' if STAT else 'None'}", flush=True)
    try:
        await ws_send_json(ws, {"type": "viewer_init", "data": build_viewer_init(stl_base_url)})
        viewer_init_sent = True  # prevents status_loop re-send; reset on LinuxCNC reconnect
        print(f"[VINIT] client#{client_id} connect-time viewer_init SENT OK", flush=True)
    except Exception as e:
        print(f"[VINIT] client#{client_id} connect-time viewer_init FAILED: {e}", flush=True)

    # Send initial settings snapshot (part of WS handshake)
    try:
        _init_settings = await asyncio.get_event_loop().run_in_executor(None, load_settings)
        await ws_send_json(ws, {"type": "settings_init", "settings": _init_settings, "armed": armed})
    except Exception as e:
        print(f"[SETTINGS] client#{client_id} settings_init FAILED: {e}", flush=True)

    # Send initial G-code ping if a file is already loaded. The full preview
    # payload (feed/rapid polylines, stats) is served over HTTP via GET
    # /preview — we only broadcast a tiny "ready" notification over the WS
    # so each client can fetch the cached msgpack bytes out of band.
    # Cold path (file loaded but not yet parsed): schedule a refresh; the
    # client's status_loop picks up the ping on the next version bump.
    # File *content* is fetched separately via GET /gcode.
    _init_preview_ver = _gcode_preview_version
    try:
        if STAT is not None:
            STAT.poll()
        initial_file = safe_get("file", None)
        if initial_file:
            cache_hit = (
                _gcode_preview_pending is not None
                and _gcode_preview_pending.get("file") == initial_file
                and _gcode_preview_bytes is not None
            )
            if cache_hit:
                await ws_send_json(ws, {
                    "type": "viewer_gcode_ready",
                    "version": _gcode_preview_version,
                    "file": initial_file,
                })
            elif not _gcode_refresh_running:
                _gcode_refresh_running = True
                asyncio.create_task(_refresh_gcode_preview(initial_file))
    except Exception as e:
        print(f"Error loading initial G-code: {e}")

    viewer_init_sent = False
    _probe_results: dict = {}  # populated from shared poller probe updates
    _prev_tc_req = False  # previous tool-change-requested state for edge detection
    _prev_tool_num = None  # previous tool_number for metadata edge detection


    async def status_loop():
        nonlocal armed, viewer_init_sent, _probe_results, _prev_tc_req, _prev_tool_num
        global _tool_meta_dirty, _fb_scale, _spindle_load_pin
        loop = asyncio.get_event_loop()
        _last_settings_ver = _settings_version
        _last_gen = 0  # tracks which _status_gen we last processed
        _consec_fails = 0  # consecutive status_loop exceptions — bail after 10
        # Spindle feedback scale: 60 if pin outputs RPS (default), 1 if RPM
        _ss_init = load_settings()
        _machine_s = _ss_init.get("machine", {})
        _fb_scale = 1 if _machine_s.get("spindleFeedbackUnit") == "rpm" else 60
        _slp = _machine_s.get("spindleLoadPin", "")
        _spindle_load_pin = _slp if isinstance(_slp, str) and _HAL_PIN_RE.match(_slp) else ""
        _prev_send_ms = 0.0  # send_ms from previous cycle (sent in next message)
        _prev_encode_ms = 0.0  # encode_ms from previous cycle (wire-format serialise time)
        _last_surface_version = 0  # tracks which _surface_points_version was last sent to this client
        _last_comp_grid_version = 0  # tracks which _comp_grid_version was last sent to this client
        _last_gcode_preview_version = _init_preview_ver  # initialized from connect-time snapshot
        # Experiment 2: status-delta per-client state
        _last_status_data: Optional[Dict[str, Any]] = None
        _cycles_since_full = 0
        while True:
            try:
                # Not connected — disarm and send error to this client
                if not lcnc_connected:
                    if viewer_init_sent:
                        viewer_init_sent = False
                    if armed:
                        armed = False
                        if client_id in _clients:
                            _clients[client_id]["armed"] = False
                    try:
                        await ws_send_json(ws, {
                            "type": "status_error",
                            "error": "LinuxCNC not connected",
                            "clients": [{"ip": c["ip"], "armed": c["armed"]} for c in _clients.values()],
                            "armed": armed,
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

                st = _shared_status
                if st is None:
                    await asyncio.sleep(0.5)
                    continue

                # Send viewer_init on first successful poll for this client
                if not viewer_init_sent:
                    print(f"[VINIT] client#{client_id} sending viewer_init (post-poll), STAT={'OK' if STAT else 'None'}", flush=True)
                    try:
                        await ws_send_json(ws, {"type": "viewer_init", "data": build_viewer_init(stl_base_url)})
                        viewer_init_sent = True
                        print(f"[VINIT] client#{client_id} viewer_init SENT OK", flush=True)
                    except Exception as e:
                        print(f"[VINIT] client#{client_id} viewer_init FAILED: {e}", flush=True)

                # Merge shared probe updates into per-client results
                if _shared_probe_updates:
                    _probe_results.update(_shared_probe_updates)

                # Build status message — use cached asdict + clients snapshot
                # from poller (O(1) ref copy vs. rebuilding per client).
                status_data = _shared_status_dict.copy() if _shared_status_dict else asdict(st)
                status_msg: dict = {
                    "type": "status",
                    "data": status_data,
                    "errors": _shared_errors,
                    "clients": _shared_clients_list,
                    "armed": armed,
                }
                if _unacked_trip is not None:
                    status_msg["safety_trip"] = _unacked_trip
                if _probe_results:
                    status_msg["probe_results"] = _probe_results

                # Inject tool_meta on tool_number change or library edit (for 3D rendering)
                if st.tool_number != _prev_tool_num or _tool_meta_dirty:
                    _prev_tool_num = st.tool_number
                    _tool_meta_dirty = False
                    if st.tool_number is not None:
                        try:
                            _lib = load_tool_library()
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
                                    status_msg["data"]["tool_meta"] = _tm
                        except (KeyError, TypeError, OSError) as e:
                            print(f"[STATUS] tool_meta build failed for T{st.tool_number}: {type(e).__name__}: {e}", flush=True)

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
                hb_mono = _clients.get(client_id, {}).get("hb_mono", 0.0)
                if hb_mono > 0:
                    status_msg["timing"] = {
                        "server_ms": round((time.monotonic() - hb_mono) * 1000, 2),
                        "cycle_ms": _shared_timing.get("cycle_ms", 0),
                        "poll_ms": _shared_timing.get("poll_ms", 0),
                        "errors_ms": _shared_timing.get("errors_ms", 0),
                        "parse_ms": _shared_timing.get("parse_ms", 0),
                        "overhead_ms": _shared_timing.get("overhead_ms", 0),
                        # Prior-cycle encode time (status_msg built before the
                        # encode happens → we attach the last known value).
                        # ws_bytes is measured client-side from the received frame.
                        "encode_ms": _prev_encode_ms,
                    }
                    if client_id in _clients:
                        _clients[client_id]["hb_mono"] = 0.0

                pre_send = time.monotonic()
                _prev_encode_ms, _ = await ws_send_measured(ws, status_msg)
                _prev_send_ms = round((time.monotonic() - pre_send) * 1000, 2)

                # Log timing to file if enabled
                if _timing_log_enabled and "timing" in status_msg:
                    _log_timing({**status_msg["timing"], "send_ms": _prev_send_ms})

                # Settings broadcast: send full settings when version changes
                if _last_settings_ver != _settings_version:
                    _last_settings_ver = _settings_version
                    try:
                        _ss = await loop.run_in_executor(None, load_settings)
                        _machine_s = _ss.get("machine", {})
                        _fb_scale = 1 if _machine_s.get("spindleFeedbackUnit") == "rpm" else 60
                        _slp = _machine_s.get("spindleLoadPin", "")
                        _spindle_load_pin = _slp if isinstance(_slp, str) and _HAL_PIN_RE.match(_slp) else ""
                        await ws_send_json(ws, {
                            "type": "settings_changed",
                            "settings": _ss,
                            "armed": armed,
                        })
                    except (OSError, json.JSONDecodeError, ValueError) as e:
                        print(f"[STATUS] settings_changed broadcast failed: {type(e).__name__}: {e}", flush=True)

                # Tool change: auto-deassert when request clears
                if _prev_tc_req and not st.tool_change_requested:
                    _hal_send({"tool_changed": False})
                _prev_tc_req = st.tool_change_requested

                # Viewer: gcode preview — send a tiny "ready" ping so each
                # client fetches the cached msgpack bytes via GET /preview.
                # Broadcasting the full (multi-MB) frame to every client on
                # the single-threaded WS writer stalled the event loop past
                # the HAL heartbeat window. File content is fetched via
                # GET /gcode; preview data is fetched via GET /preview.
                if _gcode_preview_version != _last_gcode_preview_version:
                    _last_gcode_preview_version = _gcode_preview_version
                    pending = _gcode_preview_pending
                    if _gcode_preview_bytes is not None and pending is not None:
                        try:
                            await ws_send_json(ws, {
                                "type": "viewer_gcode_ready",
                                "version": _gcode_preview_version,
                                "file": pending.get("file"),
                            })
                        except RuntimeError:
                            pass
                    else:
                        await ws_send_json(ws, {
                            "type": "viewer_gcode",
                            "data": {"file": None, "feed": [], "feed_lines": [], "rapid": []},
                        })

                # Surface points: cached msgpack lives on the server; send a
                # tiny version ping so each client fetches via GET /surface_points
                # off the WS writer.
                if _surface_points_version != _last_surface_version:
                    _last_surface_version = _surface_points_version
                    if _surface_points_bytes is not None:
                        try:
                            await ws_send_json(ws, {
                                "type": "surface_points_ready",
                                "version": _surface_points_version,
                            })
                        except RuntimeError:
                            pass

                # Compensation grid: same pattern — fetch via GET /comp_grid.
                if _comp_grid_version != _last_comp_grid_version:
                    _last_comp_grid_version = _comp_grid_version
                    if _comp_grid_bytes is not None:
                        try:
                            await ws_send_json(ws, {
                                "type": "comp_grid_ready",
                                "version": _comp_grid_version,
                            })
                        except RuntimeError:
                            pass

                # Heartbeat timeout
                if client_id in _clients:
                    if time.time() - _clients[client_id].get("last_hb", 0) > 3.0:
                        if armed:
                            # Armed client stalled — disarm and stop motion
                            armed = False
                            _clients[client_id]["armed"] = False
                            try:
                                async with _get_cmd_lock():
                                    if bool(safe_get("enabled", False)):
                                        mode = safe_get("task_mode", None)
                                        interp = safe_get("interp_state", None)
                                        if mode == linuxcnc.MODE_AUTO and interp != linuxcnc.INTERP_IDLE:
                                            CMD.abort()
                                        else:
                                            homed = normalize_homed(safe_get("homed", None))
                                            if homed:
                                                await set_mode(linuxcnc.MODE_MANUAL)
                                                jf = _jog_joint_flag()
                                                _nj = getattr(STAT, "joints", 3) if STAT else 3
                                                for ax in range(_nj):
                                                    CMD.jog(linuxcnc.JOG_STOP, jf, ax)
                                            CMD.abort()
                            except Exception:
                                pass
                            try:
                                await ws_send_json(ws, {"type": "reply", "ok": False, "error": "Heartbeat timeout \u2014 disarmed for safety", "armed": False})
                            except Exception:
                                pass
                        else:
                            # Non-armed client stalled — evict to keep _clients accurate
                            # Closing WS triggers finally block → removes from _clients → updates HAL pins
                            try:
                                await ws.close(code=1000, reason="Heartbeat timeout")
                            except Exception:
                                pass
                            return  # exit status_loop; finally block handles cleanup

                # Full iteration completed without exception — reset failure counter.
                # (Healthy early-`continue` paths above are neutral: they don't
                # reset but also don't increment, so the counter only grows when
                # exceptions truly occur.)
                _consec_fails = 0

            except Exception as e:
                _consec_fails += 1
                print(f"[STATUS] client#{client_id} status_loop exception ({_consec_fails}/10): {type(e).__name__}: {e}", flush=True)
                if _consec_fails >= 10:
                    print(f"[STATUS] client#{client_id} aborting status loop after 10 consecutive failures", flush=True)
                    break
                await asyncio.sleep(0.5)

    status_task = asyncio.create_task(status_loop())

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                await ws_send_json(ws, {"type": "reply", "ok": False, "error": "Invalid JSON"})
                continue

            if msg.get("cmd") == "heartbeat":
                if client_id in _clients:
                    _clients[client_id]["last_hb"] = time.time()
                    _clients[client_id]["hb_mono"] = time.monotonic()
                await ws_send_json(ws, {"type": "pong"})
                continue

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
                    continue
                armed = want_armed
                if client_id in _clients:
                    _clients[client_id]["armed"] = armed
                    _clients[client_id]["last_hb"] = time.time()  # reset on arm change
                await ws_send_json(ws, {"type": "reply", "ok": True, "armed": armed})
                continue

            if msg.get("cmd") == "safety_trip_ack":
                _unacked_trip = None
                await ws_send_json(ws, {"type": "reply", "ok": True})
                continue

            if msg.get("cmd") == "get_settings":
                _loop = asyncio.get_event_loop()
                _ss = await _loop.run_in_executor(None, load_settings)
                await ws_send_json(ws, {"type": "settings_init", "settings": _ss, "armed": armed})
                continue

            if msg.get("cmd") == "save_settings":
                section = msg.get("section", "")
                if section not in _VALID_SETTINGS_SECTIONS:
                    await ws_send_json(ws, {"type": "reply", "ok": False, "error": f"Unknown settings section: {section}"})
                    continue
                _loop = asyncio.get_event_loop()
                await _loop.run_in_executor(None, save_settings_section, section, msg.get("data"))
                await ws_send_json(ws, {"type": "reply", "ok": True})
                continue

            if msg.get("cmd") == "timing_log":
                global _timing_log_enabled, _timing_log_path
                _timing_log_enabled = bool(msg.get("enable", False))
                if _timing_log_enabled:
                    from datetime import datetime
                    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                    _timing_log_path = f"/tmp/lcnc-timing-{stamp}.jsonl"
                    print(f"[TIMING] Log started: {_timing_log_path}", flush=True)
                else:
                    if _timing_log_path:
                        print(f"[TIMING] Log stopped: {_timing_log_path}", flush=True)
                await ws_send_json(ws, {"type": "reply", "ok": True, "enabled": _timing_log_enabled})
                continue

            if msg.get("cmd") == "simulate_probe_trip":
                if not armed:
                    await ws_send_json(ws, {"type": "reply", "ok": False, "error": "Not armed"})
                    continue
                if not lcnc_connected:
                    await ws_send_json(ws, {"type": "reply", "ok": False, "error": "LinuxCNC not connected"})
                    continue
                try:
                    _loop = asyncio.get_event_loop()
                    # Unlink any existing writer on probe-in (e.g. qtpyvcp.probe-in.out)
                    # so halcmd sets works. Ignore errors if already unlinked.
                    await _loop.run_in_executor(None, lambda: subprocess.run(
                        ['halcmd', 'unlinkp', 'qtpyvcp.probe-in.out'],
                        capture_output=True, text=True, timeout=2))
                    await _loop.run_in_executor(None, lambda: subprocess.run(
                        ['halcmd', 'sets', 'probe-in', '1'],
                        capture_output=True, text=True, timeout=2, check=True))
                    await asyncio.sleep(0.02)
                    await _loop.run_in_executor(None, lambda: subprocess.run(
                        ['halcmd', 'sets', 'probe-in', '0'],
                        capture_output=True, text=True, timeout=2, check=True))
                    await ws_send_json(ws, {"type": "reply", "ok": True})
                except Exception as e:
                    await ws_send_json(ws, {"type": "reply", "ok": False, "error": f"simulate_probe_trip: {e}"})
                continue

            if msg.get("cmd") == "confirm_tool_change":
                if not armed:
                    await ws_send_json(ws, {"type": "reply", "ok": False, "error": "Not armed"})
                    continue
                if not lcnc_connected:
                    await ws_send_json(ws, {"type": "reply", "ok": False, "error": "LinuxCNC not connected"})
                    continue
                _loop = asyncio.get_event_loop()
                await _loop.run_in_executor(None, _hal_send, {"tool_changed": True})
                await ws_send_json(ws, {"type": "reply", "ok": True})
                continue

            if msg.get("cmd") == "set_compensation":
                if not armed:
                    await ws_send_json(ws, {"type": "reply", "ok": False, "error": "Not armed"})
                    continue
                enable = bool(msg.get("enable", False))
                _loop = asyncio.get_event_loop()
                await _loop.run_in_executor(None, _hal_send, {"compensation_enable": enable})
                await ws_send_json(ws, {"type": "reply", "ok": True})
                continue

            if msg.get("cmd") == "set_compensation_method":
                if not armed:
                    await ws_send_json(ws, {"type": "reply", "ok": False, "error": "Not armed"})
                    continue
                method = int(msg.get("method", 2))
                _loop = asyncio.get_event_loop()
                await _loop.run_in_executor(None, _hal_send, {"compensation_method": method})
                await ws_send_json(ws, {"type": "reply", "ok": True})
                continue

            reply = await handle_command(msg, armed)
            if msg.get("cmd") == "unload_file" and reply.get("ok"):
                # reset_interpreter doesn't clear stat.file, so the shared
                # poller's file-change edge won't fire. Clear the shared
                # cache and bump the version so every client's status_loop
                # sends an empty viewer_gcode on the next cycle.
                _gcode_preview_pending = None
                _gcode_preview_bytes = None
                _gcode_preview_version += 1
                _gcode_last_file = None
            await ws_send_json(ws, {"type": "reply", **reply})

    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        _clients.pop(client_id, None)
        # Safety: stop all motion if this armed client disconnects
        if armed and CMD is not None:
            try:
                async with _get_cmd_lock():
                    STAT.poll()
                    if bool(safe_get("enabled", False)):
                        mode = safe_get("task_mode", None)
                        interp = safe_get("interp_state", None)
                        if mode == linuxcnc.MODE_AUTO and interp != linuxcnc.INTERP_IDLE:
                            CMD.abort()
                        else:
                            homed = normalize_homed(safe_get("homed", None))
                            if homed:
                                await set_mode(linuxcnc.MODE_MANUAL)
                                jf = _jog_joint_flag()
                                _nj = getattr(STAT, "joints", 3) if STAT else 3
                                for ax in range(_nj):
                                    CMD.jog(linuxcnc.JOG_STOP, jf, ax)
                            CMD.abort()
            except Exception:
                pass
        status_task.cancel()
        # Clear estop hold if no clients remain
        if not _clients:
            _estop_hold = False
        # Update HAL pins to reflect this client is gone
        has_clients = bool(_clients)
        if has_clients:
            _hal_send({"connected": True, "heartbeat": False})
        else:
            # Grace period: delay dropping connected pin to allow page refresh
            _start_disconnect_grace()


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
    if _camera is not None:
        return _camera.isOpened()
    source = os.environ.get("LCNC_CAMERA_SOURCE", "")
    if not source:
        return False
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
        pass
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

# ---- Server-Side Settings Endpoints ----

@app.get("/settings")
async def get_settings():
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, load_settings)
    return {"ok": True, "settings": data}


@app.put("/settings/{section}")
@app.post("/settings/{section}")  # POST used by sendBeacon on page exit
async def put_settings_section(section: str, request: Request):
    if section not in _VALID_SETTINGS_SECTIONS:
        return {"ok": False, "error": f"Unknown section: {section}"}
    body = await request.json()
    data = body.get("data")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, save_settings_section, section, data)
    return {"ok": True}


@app.delete("/settings")
async def delete_settings():
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, reset_settings)
    return {"ok": True}


@app.get("/camera/stream")
async def camera_stream():
    loop = asyncio.get_event_loop()
    ok = await loop.run_in_executor(None, _camera_init)
    if not ok:
        return JSONResponse({"error": "No camera configured"}, status_code=503)
    fps = int(os.environ.get("LCNC_CAMERA_FPS", "15"))
    delay = 1.0 / fps

    async def generate():
        while True:
            jpeg = await loop.run_in_executor(None, _camera_grab_jpeg)
            if jpeg is None:
                await asyncio.sleep(delay)
                continue
            yield (b"--frame\r\n"
                   b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n")
            await asyncio.sleep(delay)

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
    app.mount("/", StaticFiles(directory=_DIST_DIR, html=True), name="spa")
