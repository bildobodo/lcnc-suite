#!/usr/bin/env python3
import asyncio
import json
import time
import os
import subprocess
import linuxcnc

from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional, List
from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware


# ---- Config ----
POLL_HZ = 10  # status update rate

# ---- LinuxCNC handles (nullable for auto-reconnect) ----
STAT: Optional[linuxcnc.stat] = None
CMD: Optional[linuxcnc.command] = None
ERR: Optional[linuxcnc.error_channel] = None
lcnc_connected = False
_lcnc_pid: Optional[int] = None  # tracks linuxcncsvr PID


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


def try_connect_lcnc() -> bool:
    """Attempt to connect to LinuxCNC. Returns True on success."""
    global STAT, CMD, ERR, lcnc_connected, _lcnc_pid
    try:
        STAT = linuxcnc.stat()
        CMD = linuxcnc.command()
        ERR = linuxcnc.error_channel()
        STAT.poll()  # verify it actually works
        lcnc_connected = True
        _lcnc_pid = _get_lcnc_pid()
        return True
    except Exception:
        STAT = CMD = ERR = None
        lcnc_connected = False
        _lcnc_pid = None
        return False


def check_lcnc_instance() -> bool:
    """Check if linuxcncsvr PID changed. Returns True if reconnect needed."""
    global _lcnc_pid, lcnc_connected
    pid = _get_lcnc_pid()
    if pid == _lcnc_pid:
        # Same PID (or both None) — but if None and we think we're connected, flag it
        if pid is None and lcnc_connected:
            lcnc_connected = False
            return True
        return False
    # PID changed (appeared, disappeared, or different instance)
    _lcnc_pid = pid
    if pid is None:
        lcnc_connected = False
    return True


# Best-effort connection at startup (gateway still runs if LinuxCNC isn't up yet)
try_connect_lcnc()


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
    current_vel: Optional[float]
    spindle_speed: Optional[float]       # commanded (S word)
    spindle_speed_actual: Optional[float] # after override
    spindle_direction: Optional[int]
    active_file: Optional[str]
    motion_line: Optional[int]
    ini_filename: Optional[str]

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
        current_vel=current_vel,
        spindle_speed=spindle_speed,
        spindle_speed_actual=hal_get('spindle.0.speed-in', 0) * 60,
        spindle_direction=spindle_direction,
        active_file=safe_get("file", None),
        motion_line=safe_get("motion_line", None),
        ini_filename=safe_get("ini_filename", None),
        tool_number=tool_number,
        tool_diameter=tool_diameter,
        tool_length=tool_length,
    )



def read_errors_nonblocking() -> list:
    if ERR is None:
        return []
    out = []
    while True:
        e = ERR.poll()
        if not e:
            break
        out.append(e)
    return out


async def ws_send_json(ws: WebSocket, obj: Dict[str, Any]):
    # default=str prevents weird types from killing the WS during development
    await ws.send_text(json.dumps(obj, separators=(",", ":"), default=str))


def set_mode(mode: int):
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
            CMD.jog(linuxcnc.JOG_CONTINUOUS, 0, axis, vel)
            return {"ok": True}

        if cmd == "jog_stop":
            require_armed(armed)

            blocked = reject_if_auto_running()
            if blocked:
                return blocked

            axis = int(msg.get("axis"))
            set_mode(linuxcnc.MODE_MANUAL)
            CMD.jog(linuxcnc.JOG_STOP, 0, axis)
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
            {"id": "frame",  "file": "frame.stl",  "parent": None, "t": [-760, -122, -294]},
            {"id": "x_axis", "file": "x_axis.stl", "parent": "x",  "t": [319, 398, -244]},
            {"id": "y_axis", "file": "y_axis.stl", "parent": "y",  "t": [-140, 0, 21]},
            {"id": "z_axis", "file": "z_axis.stl", "parent": "z",  "t": [0, 0, 0]},
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




from pathlib import Path

# Serve static machine assets (STLs etc.)
# Always resolve relative to THIS FILE, not cwd
BASE_DIR = Path(__file__).resolve().parent
MACHINE_DIR = BASE_DIR / "machine"

app.mount("/assets", StaticFiles(directory=str(MACHINE_DIR), html=False), name="assets")



@app.get("/health")
def health():
    return {"ok": True}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    armed = False  # connection-local arming

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
        nonlocal last_file
        while True:
            try:
                # Process-level detection: check if linuxcncsvr PID changed
                if check_lcnc_instance():
                    if _lcnc_pid is not None:
                        # New instance detected — reconnect
                        try_connect_lcnc()
                        try:
                            await ws_send_json(ws, {"type": "viewer_init", "data": build_viewer_init(stl_base_url)})
                        except Exception:
                            pass
                        last_file = None  # force re-send of gcode
                    else:
                        # Process gone — null handles and raise
                        global STAT, CMD, ERR
                        STAT = CMD = ERR = None
                        raise RuntimeError("LinuxCNC process exited")

                st = poll_status()
                errs = read_errors_nonblocking()
                await ws_send_json(
                    ws,
                    {
                        "type": "status",
                        "data": asdict(st),
                        "errors": errs,
                    },
                )
                # Viewer: lightweight high-frequency state (you can also drive it from status on the frontend)
                await ws_send_json(
                    ws,
                    {
                        "type": "viewer_state",
                        "data": {
                            "ts": st.ts,
                            "machine_pos": st.machine_pos,
                            "g5x_offset": st.g5x_offset,
                            "g92_offset": st.g92_offset,
                            "active_file": st.active_file,
                            "motion_line": st.motion_line,
                            "tool_number": st.tool_number,
                            "tool_diameter": st.tool_diameter,
                            "tool_length": st.tool_length,
                            "joint_pos": st.joint_pos,
                            "tool_offset": st.tool_offset,
                            "work_pos": st.work_pos,
                            "current_vel": st.current_vel,
                            "spindle_speed": st.spindle_speed_actual,
                            "spindle_direction": st.spindle_direction,
                        },
                    },
                )
            

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

                await asyncio.sleep(1.0 / POLL_HZ)
            except Exception as e:
                global lcnc_connected
                lcnc_connected = False
                await ws_send_json(ws, {"type": "status_error", "error": f"{type(e).__name__}: {e}"})
                # Try to reconnect to LinuxCNC
                if try_connect_lcnc():
                    try:
                        await ws_send_json(ws, {"type": "viewer_init", "data": build_viewer_init(stl_base_url)})
                    except Exception:
                        pass
                    last_file = None  # force re-send of gcode on reconnect
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

            if msg.get("cmd") == "arm":
                armed = bool(msg.get("armed", False))
                await ws_send_json(ws, {"type": "reply", "ok": True, "armed": armed})
                continue

            reply = handle_command(msg, armed)
            await ws_send_json(ws, {"type": "reply", **reply})

    except WebSocketDisconnect:
        pass
    finally:
        status_task.cancel()
