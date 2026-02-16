#!/usr/bin/env python3
import asyncio
import json
import time
import os
import subprocess
from pathlib import Path
import linuxcnc

from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional, List
from fastapi.staticfiles import StaticFiles
import tempfile
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware


# ---- Config ----
POLL_HZ = 10  # status update rate
BASE_DIR = Path(__file__).resolve().parent
MACHINE_DIR = BASE_DIR / "machine"

# ---- LinuxCNC handles (nullable for auto-reconnect) ----
STAT: Optional[linuxcnc.stat] = None
CMD: Optional[linuxcnc.command] = None
ERR: Optional[linuxcnc.error_channel] = None
lcnc_connected = False
_lcnc_pid: Optional[int] = None  # tracks linuxcncsvr PID

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

def _hal_connect():
    """Connect to the HAL watchdog Unix socket. Non-fatal if unavailable."""
    global _hal_sock
    if _hal_sock is not None:
        return  # already connected
    try:
        _hal_sock = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
        _hal_sock.connect(_HAL_SOCK_PATH)
        print("Connected to HAL watchdog socket")
    except Exception:
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
    signal.signal(signum, signal.SIG_DFL)
    os.kill(os.getpid(), signum)

signal.signal(signal.SIGTERM, _shutdown_signal_handler)
signal.signal(signal.SIGINT, _shutdown_signal_handler)

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


def _get_lcnc_pid() -> Optional[int]:
    """Return PID of linuxcncsvr if running, else None."""
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
_NML_POISON_THRESHOLD = 5  # consecutive probe-pass + main-fail = poisoned


def _self_restart():
    """Spawn a fresh gateway process and exit. Last resort for NML poisoning."""
    print("NML POISONED: self-restarting gateway process", flush=True)
    _hal_disconnect()
    subprocess.Popen([sys.executable] + sys.argv)
    os._exit(1)


def try_connect_lcnc() -> bool:
    """Attempt to connect to LinuxCNC. Returns True on success."""
    global STAT, CMD, ERR, lcnc_connected, _lcnc_pid, _nc_files_dir, _max_jog_velocity, _ever_connected
    _nc_files_dir = None        # re-resolve on reconnect
    _max_jog_velocity = None    # re-read from INI on reconnect
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
        return True
    except Exception as e:
        print(f"try_connect_lcnc failed: {e}")
        STAT = CMD = ERR = None
        lcnc_connected = False
        _lcnc_pid = None
        return False


def check_lcnc_instance() -> bool:
    """Check if linuxcncsvr PID changed. Returns True if reconnect needed."""
    global _lcnc_pid, lcnc_connected
    pid = _get_lcnc_pid()
    if pid == _lcnc_pid:
        if pid is None and lcnc_connected:
            lcnc_connected = False
            return True
        return False
    # PID changed (appeared, disappeared, or different instance)
    _lcnc_pid = pid
    if pid is None:
        lcnc_connected = False
        _hal_disconnect()
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
_max_jog_velocity: Optional[float] = None


def get_max_jog_velocity() -> Optional[float]:
    """Return [DISPLAY]MAX_LINEAR_VELOCITY from INI (units/sec), cached."""
    global _max_jog_velocity
    if _max_jog_velocity is not None:
        return _max_jog_velocity
    if STAT is not None:
        try:
            STAT.poll()
            ini_path = getattr(STAT, "ini_filename", None)
            if ini_path:
                ini = linuxcnc.ini(ini_path)
                val = ini.find("DISPLAY", "MAX_LINEAR_VELOCITY")
                if val:
                    _max_jog_velocity = float(val)
                    return _max_jog_velocity
        except Exception:
            pass
    return None


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
    real_path = os.path.realpath(path)
    real_root = os.path.realpath(root)
    return real_path.startswith(real_root + os.sep) or real_path == real_root


@dataclass
class StatusPayload:
    ts: float

    # safety / state
    estop: bool
    enabled: bool
    homed: Optional[bool]  # LinuxCNC stat truth (normalized)

    # task/motion
    task_mode: Optional[int]
    interp_state: Optional[int]
    state: Optional[int]
    motion_mode: Optional[int]  # TRAJ_MODE_FREE=1, TRAJ_MODE_COORD=2, TRAJ_MODE_TELEOP=3

    # offsets and positions
    g5x_index: Optional[int]  # 0=G54, 1=G55, 2=G56, etc.
    g5x_offset: Optional[List[float]]
    g92_offset: Optional[List[float]]
    joint_pos: Optional[List[float]]
    tool_offset: Optional[List[float]]
    machine_pos: Optional[List[float]]
    work_pos: Optional[List[float]]
    dtg: Optional[List[float]]

    # misc
    feed_override: Optional[float]
    spindle_override: Optional[float]
    rapid_override: Optional[float]
    max_velocity: Optional[float]
    max_jog_velocity: Optional[float]
    current_vel: Optional[float]
    spindle_speed: Optional[float]       # commanded (S word)
    spindle_speed_actual: Optional[float] # after override
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




def hal_get(pin: str, default=None):
    """Read a HAL pin value. Tries hal module first, falls back to halcmd."""
    try:
        import hal
        return hal.get_value(pin)
    except Exception:
        pass
    try:
        result = subprocess.run(
            ['halcmd', '-s', 'getp', pin],
            capture_output=True, text=True, timeout=1
        )
        if result.returncode == 0:
            return float(result.stdout.strip())
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

    # ---- offsets ----
    g5x_index = safe_get("g5x_index", None)
    g5x = to_float_list(safe_get("g5x_offset", None))
    g92 = to_float_list(safe_get("g92_offset", None))

    # ---- positions ----
    machine_pos = to_float_list(safe_get("actual_position", None))
    if machine_pos is None:
        machine_pos = to_float_list(safe_get("position", None))  # fallback

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
        except Exception:
            pass
    # Fallback: direct stat attributes
    if spindle_speed is None:
        val = safe_get("spindle_speed", None)
        if val is not None:
            try:
                spindle_speed = float(val)
            except Exception:
                pass
    # Fallback: settings[2] holds the commanded S word
    if spindle_speed is None:
        settings = safe_get("settings", None)
        if settings is not None:
            try:
                spindle_speed = float(settings[2])
            except Exception:
                pass
    if spindle_direction is None:
        val = safe_get("spindle_direction", None)
        if val is not None:
            try:
                spindle_direction = int(val)
            except Exception:
                pass




    # ---- tool (stat-only) ----
    tool_number = safe_get("tool_in_spindle", None)
    try:
        tool_number = int(tool_number) if tool_number is not None else None
    except Exception:
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
        except Exception:
            pass

    # Fallback: STAT.tool_offset vector (if present)
    if tool_length is None:
        tofs = safe_get("tool_offset", None)
        if tofs is not None:
            try:
                tool_length = abs(float(tofs[2]))
            except Exception:
                pass


    spindle_ovr = get_spindle_override()

    return StatusPayload(
        ts=time.time(),
        estop=estop,
        enabled=enabled,
        homed=homed,
        task_mode=safe_get("task_mode", None),
        interp_state=safe_get("interp_state", None),
        state=safe_get("state", None),
        motion_mode=safe_get("motion_mode", None),
        g5x_index=g5x_index,
        g5x_offset=g5x,
        g92_offset=g92,
        joint_pos=joint_pos,
        tool_offset=tool_offset,
        machine_pos=machine_pos,
        work_pos=work_pos,       # <-- tool-tip work coords
        dtg=dtg,
        feed_override=safe_get("feedrate", None),
        spindle_override=spindle_ovr,
        rapid_override=safe_get("rapidrate", None),
        max_velocity=safe_get("max_velocity", None),
        max_jog_velocity=get_max_jog_velocity(),
        current_vel=current_vel,
        spindle_speed=spindle_speed,
        spindle_speed_actual=hal_get('spindle.0.speed-in', 0) * 60,
        spindle_direction=spindle_direction,
        active_file=safe_get("file", None),
        motion_line=safe_get("motion_line", None),
        ini_filename=safe_get("ini_filename", None),
        gcodes=to_float_list(safe_get("gcodes", None)),
        mcodes=to_float_list(safe_get("mcodes", None)),
        tool_number=tool_number,
        tool_diameter=tool_diameter,
        tool_length=tool_length,
    )



def read_errors_nonblocking() -> list:
    if ERR is None:
        return []
    out = []
    try:
        while True:
            e = ERR.poll()
            if not e:
                break
            out.append(e)
    except Exception:
        pass  # Error buffer may be briefly invalid after reconnect
    return out


async def ws_send_json(ws: WebSocket, obj: Dict[str, Any]):
    # default=str prevents weird types from killing the WS during development
    await ws.send_text(json.dumps(obj, separators=(",", ":"), default=str))


def set_mode(mode: int):
    STAT.poll()
    if safe_get("task_mode", None) == mode:
        return
    CMD.mode(mode)
    CMD.wait_complete()

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


def handle_command(msg: Dict[str, Any], armed: bool):
    cmd = msg.get("cmd")
    if not cmd:
        return {"ok": False, "error": "Missing cmd"}
    if not lcnc_connected:
        return {"ok": False, "error": "LinuxCNC not connected"}

    try:
        if cmd == "arm":
            return {"ok": True}

        if cmd == "estop":
            require_armed(armed)
            CMD.state(linuxcnc.STATE_ESTOP)
            CMD.wait_complete()
            return {"ok": True}

        if cmd == "estop_reset":
            require_armed(armed)
            CMD.state(linuxcnc.STATE_ESTOP_RESET)
            CMD.wait_complete()
            return {"ok": True}

        if cmd == "machine_on":
            require_armed(armed)
            # Optional but nice: avoid guaranteed-fail calls
            STAT.poll()
            if bool(safe_get("estop", True)):
                return {"ok": False, "error": "Cannot Machine On while in E-stop"}
            CMD.state(linuxcnc.STATE_ON)
            CMD.wait_complete()
            return {"ok": True}

        if cmd == "machine_off":
            require_armed(armed)
            CMD.state(linuxcnc.STATE_OFF)
            CMD.wait_complete()
            return {"ok": True}

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
            set_mode(linuxcnc.MODE_MDI)
            CMD.mdi(text)
            CMD.wait_complete()
            return {"ok": True}

        if cmd == "auto_run":
            require_armed(armed)
            set_mode(linuxcnc.MODE_AUTO)
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
            set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            CMD.jog(linuxcnc.JOG_CONTINUOUS, jf, axis, vel)
            return {"ok": True}

        if cmd == "jog_stop":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axis = int(msg.get("axis"))
            set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            CMD.jog(linuxcnc.JOG_STOP, jf, axis)
            return {"ok": True}

        if cmd == "jog_cont_multi":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axes = msg.get("axes", [])
            set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            for entry in axes:
                CMD.jog(linuxcnc.JOG_CONTINUOUS, jf, int(entry["axis"]), float(entry["vel"]))
            return {"ok": True}

        if cmd == "jog_stop_multi":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axes = msg.get("axes", [])
            set_mode(linuxcnc.MODE_MANUAL)
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
            vel = float(msg.get("vel", 0.0))
            dist = float(msg.get("distance", 0.0))
            set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            CMD.jog(linuxcnc.JOG_INCREMENT, jf, axis, vel, dist)
            return {"ok": True}

        if cmd == "jog_incr_multi":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axes = msg.get("axes", [])
            set_mode(linuxcnc.MODE_MANUAL)
            jf = _jog_joint_flag()
            for entry in axes:
                CMD.jog(linuxcnc.JOG_INCREMENT, jf, int(entry["axis"]), float(entry["vel"]), float(entry["distance"]))
            return {"ok": True}

        if cmd == "home_all":
            require_armed(armed)
            set_mode(linuxcnc.MODE_MANUAL)
            CMD.home(-1)  # -1 homes all axes
            return {"ok": True}

        if cmd == "unhome_all":
            require_armed(armed)
            set_mode(linuxcnc.MODE_MANUAL)
            CMD.unhome(-1)  # -1 unhomes all axes
            return {"ok": True}

        if cmd == "teleop_enable":
            require_armed(armed)
            set_mode(linuxcnc.MODE_MANUAL)
            CMD.teleop_enable(1)
            CMD.wait_complete()
            return {"ok": True}

        if cmd == "teleop_disable":
            require_armed(armed)
            set_mode(linuxcnc.MODE_MANUAL)
            CMD.teleop_enable(0)
            CMD.wait_complete()
            return {"ok": True}

        if cmd == "cycle_start":
            require_armed(armed)
            set_mode(linuxcnc.MODE_AUTO)
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
            set_mode(linuxcnc.MODE_MANUAL)
            CMD.spindle(linuxcnc.SPINDLE_FORWARD, speed)
            return {"ok": True}

        if cmd == "spindle_reverse":
            require_armed(armed)
            speed = float(msg.get("speed", 0))
            set_mode(linuxcnc.MODE_MANUAL)
            CMD.spindle(linuxcnc.SPINDLE_REVERSE, speed)
            return {"ok": True}

        if cmd == "spindle_stop":
            require_armed(armed)
            set_mode(linuxcnc.MODE_MANUAL)
            CMD.spindle(linuxcnc.SPINDLE_OFF)
            return {"ok": True}

        if cmd == "set_rapid_override":
            require_armed(armed)
            scale = float(msg.get("scale", 1.0))
            # Clamp to 0-100%
            scale = max(0.0, min(1.0, scale))
            CMD.rapidrate(scale)
            return {"ok": True, "scale": scale}

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

            real_path = os.path.realpath(path)
            if not os.path.isfile(real_path):
                return {"ok": False, "error": "File not found"}

            nc_dir = get_nc_files_dir()
            if not validate_path_within(real_path, nc_dir):
                return {"ok": False, "error": "File not in NC files directory"}

            if not validate_extension(real_path):
                return {"ok": False, "error": "Invalid file extension"}

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            set_mode(linuxcnc.MODE_AUTO)
            CMD.program_open(real_path)
            CMD.wait_complete()
            return {"ok": True, "path": real_path}

        if cmd == "unload_file":
            require_armed(armed)
            blocked = reject_if_auto_running()
            if blocked:
                return blocked
            CMD.abort()
            CMD.wait_complete()
            CMD.reset_interpreter()
            CMD.wait_complete()
            return {"ok": True}

        return {"ok": False, "error": f"Unknown cmd: {cmd}"}

    except PermissionError as pe:
        return {"ok": False, "error": str(pe)}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

# -----------------------------
# Viewer support (Web 3D)
# -----------------------------

def build_viewer_init(stl_base_url: str) -> Dict[str, Any]:
    STAT.poll()

    limits = read_machine_limits_from_ini(STAT)
    if limits:
        bounds_origin, bounds_size = limits
    else:
        bounds_origin, bounds_size = [0, 0, 0], [0, 0, 0]

    return {
        "units": "mm",
        "stl_base_url": stl_base_url,
        "machine_bounds": {
        "origin": bounds_origin,
        "size": bounds_size,
        },
        "parts": [
            # these translations are from your vismach model (machine.py)
            # ?v=<mtime> enables immutable browser caching with automatic invalidation on file change
            {"id": "frame",  "file": f"frame.stl?v={int(( MACHINE_DIR / 'frame.stl').stat().st_mtime) if (MACHINE_DIR / 'frame.stl').exists() else 0}",  "parent": None, "t": [-760, -122, -294]},
            {"id": "x_axis", "file": f"x_axis.stl?v={int((MACHINE_DIR / 'x_axis.stl').stat().st_mtime) if (MACHINE_DIR / 'x_axis.stl').exists() else 0}", "parent": "x",  "t": [319, 398, -244]},
            {"id": "y_axis", "file": f"y_axis.stl?v={int((MACHINE_DIR / 'y_axis.stl').stat().st_mtime) if (MACHINE_DIR / 'y_axis.stl').exists() else 0}", "parent": "y",  "t": [-140, 0, 21]},
            {"id": "z_axis", "file": f"z_axis.stl?v={int((MACHINE_DIR / 'z_axis.stl').stat().st_mtime) if (MACHINE_DIR / 'z_axis.stl').exists() else 0}", "parent": "z",  "t": [0, 0, 0]},
        ],
        # match your joint sign usage (X inverted in your model)
        "kinematics": {
            "x": {"axis": 0, "sign": -1},
            "y": {"axis": 1, "sign":  1},
            "z": {"axis": 2, "sign":  1},
        },
    }


def parse_gcode_preview(filename: str) -> Dict[str, Any]:
    """
    Preview-grade modal parser (work coords) inspired by vtk_vismach.GCodePath.
    Returns polyline point lists for feed and rapid moves.
    """
    feed: List[List[float]] = []
    feed_lines: List[int] = []          # parallel: g-code line number for each feed point
    rapid: List[List[float]] = []

    # current position (work coords)
    x = y = z = 0.0

    # modal state
    motion_mode: Optional[str] = None   # G0 / G1 / G2 / G3
    plane = "G17"                       # G17=XY, G18=XZ, G19=YZ

    import math

    def add(arr: List[List[float]], px: float, py: float, pz: float):
        arr.append([float(px), float(py), float(pz)])

    # basic safety: only read real files
    if not filename or not os.path.isfile(filename):
        return {"feed": feed, "feed_lines": feed_lines, "rapid": rapid}


    with open(filename, "r") as f:
        for lineno, raw in enumerate(f, 1):
            line = raw.strip().upper()
            if not line or line.startswith(("(", ";")):
                continue

            words = line.split()

            # update modal state
            for w in words:
                if w in ("G0", "G00"):
                    motion_mode = "G0"
                elif w in ("G1", "G01"):
                    motion_mode = "G1"
                elif w in ("G2", "G02"):
                    motion_mode = "G2"
                elif w in ("G3", "G03"):
                    motion_mode = "G3"
                elif w in ("G17", "G18", "G19"):
                    plane = w

            if motion_mode not in ("G0", "G1", "G2", "G3"):
                continue

            # parse endpoint + arc center offsets (IJK)
            nx, ny, nz = x, y, z
            i = j = k = 0.0

            for w in words:
                try:
                    if w.startswith("X"):
                        nx = float(w[1:])
                    elif w.startswith("Y"):
                        ny = float(w[1:])
                    elif w.startswith("Z"):
                        nz = float(w[1:])
                    elif w.startswith("I"):
                        i = float(w[1:])
                    elif w.startswith("J"):
                        j = float(w[1:])
                    elif w.startswith("K"):
                        k = float(w[1:])
                except ValueError:
                    pass

            # linear / rapid
            if motion_mode == "G0":
                add(rapid, nx, ny, nz)  # rapids: no line tracking needed
                x, y, z = nx, ny, nz
                continue

            if motion_mode == "G1":
                add(feed, nx, ny, nz)
                feed_lines.append(lineno)
                x, y, z = nx, ny, nz
                continue

            # arcs (G2/G3)
            cw = (motion_mode == "G2")

            # select plane axes (copying the same structure you had in vtk_vismach)
            if plane == "G17":  # XY
                sx, sy = x, y
                ex, ey = nx, ny
                cx, cy = x + i, y + j
                fixed_axis = ("Z", z)
            elif plane == "G18":  # XZ
                sx, sy = x, z
                ex, ey = nx, nz
                cx, cy = x + i, z + k
                fixed_axis = ("Y", y)
            else:  # G19 YZ
                sx, sy = y, z
                ex, ey = ny, nz
                cx, cy = y + j, z + k
                fixed_axis = ("X", x)

            r = math.hypot(sx - cx, sy - cy)
            if r <= 0:
                x, y, z = nx, ny, nz
                continue

            a0 = math.atan2(sy - cy, sx - cx)
            a1 = math.atan2(ey - cy, ex - cx)

            if cw and a1 > a0:
                a1 -= 2 * math.pi
            elif (not cw) and a1 < a0:
                a1 += 2 * math.pi

            steps = max(12, int(abs(a1 - a0) * 16))

            for s in range(1, steps + 1):
                a = a0 + (a1 - a0) * (s / steps)
                px = cx + math.cos(a) * r
                py = cy + math.sin(a) * r

                if plane == "G17":
                    add(feed, px, py, fixed_axis[1])
                elif plane == "G18":
                    add(feed, px, fixed_axis[1], py)
                else:
                    add(feed, fixed_axis[1], px, py)
                feed_lines.append(lineno)

            x, y, z = nx, ny, nz

    return {"feed": feed, "feed_lines": feed_lines, "rapid": rapid}


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CacheStaticAssets:
    """Pure ASGI middleware — adds Cache-Control to /assets/ responses without buffering."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/assets/"):
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


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    armed = False  # connection-local arming

    global _next_client_id
    client_id = _next_client_id
    _next_client_id += 1
    client_ip = ws.client.host if ws.client else "unknown"
    _clients[client_id] = {"ip": client_ip, "armed": False, "last_hb": time.time()}

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
    stl_base_url = f"http://{host}/assets/"

    try:
        await ws_send_json(ws, {"type": "viewer_init", "data": build_viewer_init(stl_base_url)})
    except Exception:
        pass  # will send viewer_init on reconnect

    # Send initial G-code if a file is already loaded
    try:
        if STAT is not None:
            STAT.poll()
        initial_file = safe_get("file", None)
        if initial_file:
            preview = parse_gcode_preview(initial_file)
            # Read the raw G-code content
            gcode_content = None
            try:
                with open(initial_file, "r", encoding="utf-8", errors="replace") as f:
                    gcode_content = f.read()
            except Exception:
                pass

            await ws_send_json(
                ws,
                {
                    "type": "viewer_gcode",
                    "data": {
                        "file": initial_file,
                        "feed": preview["feed"],
                        "feed_lines": preview["feed_lines"],
                        "rapid": preview["rapid"],
                        "content": gcode_content,
                    },
                },
            )
    except Exception as e:
        print(f"Error loading initial G-code: {e}")

    last_file: Optional[str] = None


    async def status_loop():
        nonlocal last_file, armed
        global lcnc_connected, STAT, CMD, ERR, _hal_last_hb, _reconnect_fails
        while True:
            try:
                # If not connected to LinuxCNC, try to reconnect
                if not lcnc_connected:
                    pid = _get_lcnc_pid()
                    if pid is not None and try_connect_lcnc():
                        _reconnect_fails = 0
                        _hal_connect()
                        try:
                            await ws_send_json(ws, {"type": "viewer_init", "data": build_viewer_init(stl_base_url)})
                        except Exception:
                            pass
                        last_file = None
                    else:
                        if pid is not None and _ever_connected:
                            _reconnect_fails += 1
                            if _reconnect_fails >= _NML_POISON_THRESHOLD:
                                print(f"NML reconnect failed {_reconnect_fails} times with linuxcncsvr alive — restarting gateway")
                                _self_restart()
                        else:
                            _reconnect_fails = 0
                        try:
                            await ws_send_json(ws, {
                                "type": "status_error",
                                "error": "LinuxCNC not connected",
                                "clients": [{"ip": c["ip"], "armed": c["armed"]} for c in _clients.values()],
                            })
                        except Exception:
                            break
                        await asyncio.sleep(2.0)
                        continue

                # Process-level detection: check if linuxcncsvr PID changed
                if check_lcnc_instance():
                    if _lcnc_pid is not None:
                        # New instance detected — reconnect
                        if try_connect_lcnc():
                            _reconnect_fails = 0
                            _hal_connect()
                        try:
                            await ws_send_json(ws, {"type": "viewer_init", "data": build_viewer_init(stl_base_url)})
                        except Exception:
                            pass
                        last_file = None  # force re-send of gcode
                    else:
                        # Process gone — null handles, let top-of-loop handle reconnection
                        STAT = CMD = ERR = None
                        continue

                st = poll_status()
                errs = read_errors_nonblocking()
                await ws_send_json(
                    ws,
                    {
                        "type": "status",
                        "data": asdict(st),
                        "errors": errs,
                        "clients": [{"ip": c["ip"], "armed": c["armed"]} for c in _clients.values()],
                    },
                )

                # HAL watchdog: send pin updates to subprocess
                has_armed = any(c["armed"] for c in _clients.values())
                _hal_last_hb = not _hal_last_hb
                _hal_send({"heartbeat": _hal_last_hb, "connected": has_armed})

                # Viewer: gcode preview only when the file changes
                if st.active_file and st.active_file != last_file:
                    last_file = st.active_file
                    try:
                        preview = parse_gcode_preview(last_file)

                        # Read the raw G-code content
                        gcode_content = None
                        try:
                            with open(last_file, "r", encoding="utf-8", errors="replace") as f:
                                gcode_content = f.read()
                        except Exception:
                            pass  # If we can't read it, just send None

                        await ws_send_json(
                            ws,
                            {
                                "type": "viewer_gcode",
                                "data": {
                                    "file": last_file,
                                    "feed": preview["feed"],
                                    "feed_lines": preview["feed_lines"],
                                    "rapid": preview["rapid"],
                                    "content": gcode_content,
                                },
                            },
                        )
                    except Exception as e:
                        await ws_send_json(
                            ws,
                            {
                                "type": "viewer_gcode",
                                "ok": False,
                                "error": f"{type(e).__name__}: {e}",
                                "data": {"file": last_file},
                            },
                        )
                elif not st.active_file and last_file:
                    last_file = None
                    await ws_send_json(ws, {
                        "type": "viewer_gcode",
                        "data": {"file": None, "feed": [], "feed_lines": [], "rapid": [], "content": None},
                    })

                # Heartbeat timeout: disarm and stop motion if client stalled
                if armed and client_id in _clients:
                    if time.time() - _clients[client_id].get("last_hb", 0) > 3.0:
                        armed = False
                        _clients[client_id]["armed"] = False
                        try:
                            if bool(safe_get("enabled", False)):
                                mode = safe_get("task_mode", None)
                                interp = safe_get("interp_state", None)
                                if mode == linuxcnc.MODE_AUTO and interp != linuxcnc.INTERP_IDLE:
                                    CMD.abort()
                                else:
                                    set_mode(linuxcnc.MODE_MANUAL)
                                    jf = _jog_joint_flag()
                                    for ax in range(3):
                                        CMD.jog(linuxcnc.JOG_STOP, jf, ax)
                                    CMD.abort()
                        except Exception:
                            pass
                        try:
                            await ws_send_json(ws, {"type": "reply", "ok": False, "error": "Heartbeat timeout \u2014 disarmed for safety"})
                        except Exception:
                            pass

                await asyncio.sleep(1.0 / POLL_HZ)
            except Exception as e:
                lcnc_connected = False
                STAT = CMD = ERR = None
                try:
                    await ws_send_json(ws, {
                        "type": "status_error",
                        "error": f"{type(e).__name__}: {e}",
                        "clients": [{"ip": c["ip"], "armed": c["armed"]} for c in _clients.values()],
                    })
                except Exception:
                    break  # WebSocket is dead — exit loop cleanly
                await asyncio.sleep(2.0)

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
                continue

            if msg.get("cmd") == "arm":
                armed = bool(msg.get("armed", False))
                if client_id in _clients:
                    _clients[client_id]["armed"] = armed
                    _clients[client_id]["last_hb"] = time.time()  # reset on arm change
                await ws_send_json(ws, {"type": "reply", "ok": True, "armed": armed})
                continue

            reply = handle_command(msg, armed)
            await ws_send_json(ws, {"type": "reply", **reply})

    except WebSocketDisconnect:
        pass
    finally:
        _clients.pop(client_id, None)
        # Safety: stop all motion if this armed client disconnects
        if armed and CMD is not None:
            try:
                STAT.poll()
                if bool(safe_get("enabled", False)):
                    mode = safe_get("task_mode", None)
                    interp = safe_get("interp_state", None)
                    if mode == linuxcnc.MODE_AUTO and interp != linuxcnc.INTERP_IDLE:
                        CMD.abort()
                    else:
                        set_mode(linuxcnc.MODE_MANUAL)
                        jf = _jog_joint_flag()
                        for ax in range(3):
                            CMD.jog(linuxcnc.JOG_STOP, jf, ax)
                        CMD.abort()
            except Exception:
                pass
        status_task.cancel()
        # Update HAL pins to reflect this client is gone
        has_armed = any(c["armed"] for c in _clients.values())
        _hal_send({"connected": has_armed, "heartbeat": False})
