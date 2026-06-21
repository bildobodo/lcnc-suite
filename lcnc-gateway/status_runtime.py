"""Status runtime (M2).

Owns status sampling and serialization, the WCS and parameter-file caches,
program-timer state, and the adaptive poll-timing decision:

- ``StatusPayload`` — the per-tick status snapshot dataclass.
- ``StatusRuntime.poll_status()`` / ``poll_and_serialize()`` — STAT + reader
  sampling into an immutable payload (the dict is consumed via ``.copy()`` by
  per-client send loops; no internal mutable cache is handed out: the WCS
  table is row-copied into every payload).
- WCS cache seeded from the var file (mtime-invalidated; the var-file path is
  memoized per INI — resolving parses the INI, wasteful at 30 Hz, P2.1).
- Server-authoritative program timer (``update_program_timer``).
- ``poll_is_active`` — the adaptive-poll rate decision (review #6 / safety:
  unknown or stale status must read as ACTIVE, never coast on uncertainty).

The poller *loop* stays in gateway.py — it orchestrates reconnect logic and
bulk caches (M4 territory) — as do status generation/event publication
(rebound there until M3 moves consumption into ws_fanout).

Dependencies are injected per the modularization plan: STAT/ERR accessors
(rebound on reconnect, so accessors not objects), the reader snapshot
accessor (hal_bridge.reader_get — M6), the INI-cached tool-table path
resolver, the tool-library loader, and the spindle feedback scale. The
module never imports gateway.

No-silent-fallback rule: absent STAT fields and absent reader snapshots
propagate as None all the way to the frontend.
"""
import math
import os
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

import linuxcnc

import lcnc_trace as _trace
from command_policy import (
    MachineState as _PolicyMachineState,
    evaluate_permissions,
)
from gateway_util import atomic_write_bytes
from tool_table import parse_tool_table, _merge_tool_data

WCS_BASES = [5220, 5240, 5260, 5280, 5300, 5320, 5340, 5360, 5380]
WCS_NAMES = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"]
WCS_AXIS_KEYS = ["x", "y", "z", "a", "b", "c", "u", "v", "w"]


def to_float_list(x) -> Optional[List[float]]:
    if x is None:
        return None
    try:
        return [float(v) for v in x]
    except Exception:
        return None


def read_var_file(path: str, wanted: set) -> Dict[str, float]:
    """Read var file, return {var_number_str: float_value} for wanted keys."""
    result: Dict[str, float] = {}
    with open(path) as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2 and parts[0] in wanted:
                result[parts[0]] = float(parts[1])
    return result


def write_var_file_updates(var_file: str, str_vars: Dict[str, float]) -> None:
    """Read var_file, replace/insert each {var: value}, atomically write back.

    Sync helper — call via asyncio.to_thread from async handlers so the
    blocking I/O can't stall the event loop.
    """
    with open(var_file) as f:
        lines = f.readlines()
    found = set()
    for i, line in enumerate(lines):
        parts = line.split()
        if len(parts) >= 2 and parts[0] in str_vars:
            lines[i] = f"{parts[0]}\t{str_vars[parts[0]]:.6f}\n"
            found.add(parts[0])
    missing = {k: v for k, v in str_vars.items() if k not in found}
    if missing:
        for k, v in missing.items():
            lines.append(f"{k}\t{v:.6f}\n")
        def _var_key(line):
            try: return int(line.split()[0])
            except (ValueError, IndexError): return 999999
        lines.sort(key=_var_key)
    atomic_write_bytes(var_file, "".join(lines).encode("utf-8"))


@dataclass
class StatusPayload:
    ts: float

    # safety / state
    estop: bool
    enabled: bool
    # HAL safety-chain truth. STAT.estop and STAT.enabled are derived from
    # task_state, which iocontrol drives via *edge* detection on this pin.
    # A chain that was already LOW at the time of an estop_reset / machine_on
    # command is silently missed (issue #14). None ⇒ reader snapshot stale
    # or pin unavailable; the existing reader_stale banner surfaces that.
    emc_enable_in: Optional[bool]
    hal_diag: Optional[Dict[str, Any]]
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
    wcs_table: Optional[List[Dict[str, Any]]]  # all 9 WCS slots (G54–G59.3) w/ per-axis + rotation
    joint_pos: Optional[List[float]]
    joint_diagnostics: Optional[List[Dict[str, Any]]]
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
    current_vel: Optional[float]
    spindle_speed: Optional[float]       # commanded (S word)
    spindle_speed_actual: Optional[float] # after override
    spindle_load: Optional[float]        # load % from configurable HAL pin
    spindle_direction: Optional[int]
    active_file: Optional[str]
    motion_line: Optional[int]

    # program elapsed (server-authoritative, mid-program reconnects see true value)
    program_elapsed_ms: Optional[int]

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

    # backend-authoritative permission classes (issue #19) — mirror of
    # permissions.ts evaluatePermissions(). The frontend CONSUMES this instead
    # of recomputing. Computed with armed=True (the status payload is a single
    # shared broadcast, so per-client `armed`/`busy` are overlaid client-side).
    # Trailing default so the (unreachable) bare constructor stays valid.
    permissions: Optional[Dict[str, bool]] = None
    # estop/enabled merged with the HAL safety chain (issue #14). Computed ONCE
    # in policy_state_from_payload and broadcast here so the frontend banner/DRO
    # consume the same merged truth the command policy uses — no duplicated merge
    # (review #5). None until the first poll.
    is_estop: Optional[bool] = None
    is_enabled: Optional[bool] = None


def policy_state_from_payload(p: "StatusPayload", armed: bool) -> _PolicyMachineState:
    """Build the command-policy MachineState from a status snapshot.

    The estop/enabled HAL-merge lives here (issues #14 + #19): STAT.estop/enabled
    merged with the safety chain (emc_enable_in). poll_status broadcasts the
    result as is_estop/is_enabled, which the frontend banner/DRO consume — so the
    merge rule exists in ONE place (review #5). `armed` is supplied by the caller
    — True for the shared broadcast, the real per-client value for enforcement.

    `busy` is intentionally absent (see command_policy module docstring): it is a
    per-tab client debounce the gateway can't observe, overlaid client-side."""
    emc = p.emc_enable_in
    interp = p.interp_state if p.interp_state is not None else linuxcnc.INTERP_IDLE
    # Treat INTERP_PAUSED as paused even if the STAT.paused flag lags — matching
    # update_program_timer. Otherwise, in that transient both pause and resume
    # gates close and the operator can't resume a paused program (review #1).
    is_paused = bool(p.paused) or interp == linuxcnc.INTERP_PAUSED
    return _PolicyMachineState(
        armed=armed,
        is_estop=bool(p.estop) or (emc is False),
        is_enabled=bool(p.enabled) and (emc is not False),
        is_homed=bool(p.homed),
        is_idle=(interp == linuxcnc.INTERP_IDLE),
        is_running=(not is_paused)
        and interp in (linuxcnc.INTERP_READING, linuxcnc.INTERP_WAITING),
        is_paused=is_paused,
        eoffset_enabled=bool(p.eoffset_enabled),
    )


def _finite_or_none(value) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _bool_or_none(value) -> Optional[bool]:
    if value is None:
        return None
    return bool(value)


class StatusRuntime:
    def __init__(
        self,
        *,
        get_stat: Callable[[], Any],
        get_err: Callable[[], Any],
        reader_get: Callable[[str], Any],
        get_tool_tbl_path: Callable[[], Optional[str]],
        load_tool_library: Callable[[], dict],
        get_fb_scale: Callable[[], float],
        get_hal_diag_fields: Optional[Callable[[], List[str]]] = None,
    ) -> None:
        self._get_stat = get_stat
        self._get_err = get_err
        self._reader_get = reader_get
        self._get_hal_diag_fields = get_hal_diag_fields or (lambda: [])
        self._get_tool_tbl_path = get_tool_tbl_path
        self._load_tool_library = load_tool_library
        self._get_fb_scale = get_fb_scale
        # WCS cache. The list object is STABLE for the runtime's lifetime —
        # gateway offset handlers mutate rows in place through a rebound
        # reference; payloads carry row copies, never the rows themselves.
        self.wcs_cache: List[Dict[str, Any]] = [
            {"name": n, "x": 0.0, "y": 0.0, "z": 0.0, "a": 0.0, "b": 0.0,
             "c": 0.0, "u": 0.0, "v": 0.0, "w": 0.0, "r": 0.0}
            for n in WCS_NAMES
        ]
        self._wcs_var_file_mtime: Optional[float] = None
        # Memoized resolved var-file path, keyed by the active INI filename
        # (P2.1): PARAMETER_FILE is static for a given INI, so the INI parse
        # runs once per INI, not per 30 Hz poll. Cleared on reconnect.
        self._var_file_path_cache_key: Optional[str] = None
        self._var_file_path_cache_val: Optional[str] = None
        # Program timer (server-authoritative elapsed clock)
        self._program_start_mono: Optional[float] = None
        self._program_paused_accum_ms = 0
        self._program_pause_start_mono: Optional[float] = None
        self._program_active_last = False
        self._program_paused_last = False
        # Tool-change info lookup cache: {(tool_num, tbl_mtime): merged_list},
        # one entry max.
        self._tc_info_cache: dict = {}
        # Warn-once flags (re-armed on reconnect so a STAT field that
        # disappears across a reconnect produces a fresh log line)
        self._machine_pos_warned = False
        self._spindle_warned = False
        self._err_poll_warned = False

    # ---- invalidation hooks (reconnect paths) ----

    def invalidate_var_file_path(self) -> None:
        """Re-resolve the var-file path on next use (reconnect, P2.1)."""
        self._var_file_path_cache_key = None
        self._var_file_path_cache_val = None

    def invalidate_wcs_mtime(self) -> None:
        """Force re-seed of the WCS cache from the var file on next poll."""
        self._wcs_var_file_mtime = None

    def reset_warn_flags(self) -> None:
        self._machine_pos_warned = False
        self._spindle_warned = False
        self._err_poll_warned = False

    # ---- STAT helpers ----

    def safe_get(self, attr: str, default=None):
        stat = self._get_stat()
        if stat is None:
            return default
        return getattr(stat, attr, default)

    def normalize_homed(self, homed_val) -> Optional[bool]:
        """LinuxCNC homed confirmation. STAT.homed is a fixed-length tuple of int
        (one slot per possible joint, e.g. length 16); STAT.joints is the configured
        joint count. Slice to that count so unused slots don't drag homed False."""
        if not homed_val:
            return None
        nj = self.safe_get("joints", 0)
        if not nj:
            return None
        return all(bool(x) for x in homed_val[:nj])

    def get_spindle_override(self) -> Optional[float]:
        val = self.safe_get("spindle_override", None)
        if val is not None:
            try:
                result = float(val)
                if result > 0:
                    return result
            except (TypeError, ValueError):
                pass  # safe-silent: fallback chain handles below

        spindles = self.safe_get("spindle", None)
        if spindles is not None:
            try:
                s0 = spindles[0]
                if hasattr(s0, 'override'):
                    return float(s0.override)
                if isinstance(s0, dict) and 'override' in s0:
                    return float(s0['override'])
            except (IndexError, AttributeError, TypeError, ValueError, KeyError):
                pass  # safe-silent: last fallback, caller handles None

        return None

    def stat_poll_timed(self, caller: str = "?") -> None:
        """Drop-in replacement for STAT.poll() that times the call and emits
        `stat.poll_slow` on >30 ms. Use from main-thread call sites (handlers)
        so we can localize storm-time GIL contention. The shared poller has
        its own inline probe inside poll_status."""
        stat = self._get_stat()
        if stat is None:
            return
        t0 = time.monotonic()
        stat.poll()
        dt_ms = (time.monotonic() - t0) * 1000
        if dt_ms > 30:
            _trace.emit("stat.poll_slow", level="warn",
                        duration_ms=round(dt_ms, 1), caller=caller)

    # ---- WCS / var-file caches ----

    def resolve_var_file_path(self) -> Optional[str]:
        """Resolve absolute path to the LinuxCNC var file from the active INI.

        Memoized by INI filename so the INI parse runs once per INI, not on every
        30 Hz poll. A successful resolve AND a configured-but-absent PARAMETER_FILE
        are both cached (both stable for the INI); only a transient `linuxcnc.ini`
        failure is left uncached so it retries next tick.
        """
        ini_path = self.safe_get("ini_filename", None)
        if not ini_path:
            return None
        if ini_path == self._var_file_path_cache_key:
            return self._var_file_path_cache_val
        try:
            ini = linuxcnc.ini(ini_path)
        except Exception:
            return None  # transient — don't poison the cache; retry next tick
        var_file = ini.find("RS274NGC", "PARAMETER_FILE")
        if var_file and not os.path.isabs(var_file):
            var_file = os.path.join(os.path.dirname(ini_path), var_file)
        self._var_file_path_cache_key = ini_path
        self._var_file_path_cache_val = var_file or None
        return self._var_file_path_cache_val

    def seed_wcs_cache(self) -> None:
        """Re-read the WCS cache from the var file. Safe to call repeatedly."""
        try:
            var_file = self.resolve_var_file_path()
            if not var_file:
                return
            var_map = {}
            for i, base in enumerate(WCS_BASES):
                for j, key in enumerate(WCS_AXIS_KEYS):
                    var_map[str(base + 1 + j)] = (i, key)
                var_map[str(base + 10)] = (i, "r")
            raw = read_var_file(var_file, set(var_map))
            for var_key, value in raw.items():
                idx, field = var_map[var_key]
                self.wcs_cache[idx][field] = value
            try:
                self._wcs_var_file_mtime = os.path.getmtime(var_file)
            except OSError:
                self._wcs_var_file_mtime = None
        except Exception as e:
            _trace.emit("wcs.seed_cache_failed", level="warn",
                        exc=type(e).__name__, msg=str(e))

    # ---- program timer ----

    def update_program_timer(self, interp_state: Optional[int], paused: bool) -> Optional[int]:
        """Advance the server-authoritative program-elapsed accumulator and
        return the current elapsed time in milliseconds (or None if no program
        has ever run since startup). Called once per status poll.

        Transitions handled:
          idle    → active   start new run (reset accumulator + start anchor)
          running → paused   open a pause segment
          paused  → running  commit pause segment into accumulator
          active  → idle     freeze the elapsed clock at "now"
        """
        active = interp_state is not None and interp_state != linuxcnc.INTERP_IDLE
        is_paused = active and (paused or interp_state == linuxcnc.INTERP_PAUSED)
        now_mono = time.monotonic()

        # idle → active: new run
        if active and not self._program_active_last:
            self._program_start_mono = now_mono
            self._program_paused_accum_ms = 0
            self._program_pause_start_mono = None

        # running → paused: start pause segment
        elif active and is_paused and not self._program_paused_last:
            self._program_pause_start_mono = now_mono

        # paused → running: commit pause segment
        elif active and not is_paused and self._program_paused_last and self._program_pause_start_mono is not None:
            self._program_paused_accum_ms += int((now_mono - self._program_pause_start_mono) * 1000)
            self._program_pause_start_mono = None

        # active → idle while running: freeze the clock at "now" so the final
        # elapsed value stays put after the program ends. If we went idle from
        # PAUSED, _program_pause_start_mono is already set — leave it alone.
        elif not active and self._program_active_last and self._program_pause_start_mono is None and self._program_start_mono is not None:
            self._program_pause_start_mono = now_mono

        self._program_active_last = active
        self._program_paused_last = is_paused

        if self._program_start_mono is None:
            return None
        anchor = self._program_pause_start_mono if self._program_pause_start_mono is not None else now_mono
        return max(0, int((anchor - self._program_start_mono) * 1000) - self._program_paused_accum_ms)

    # ---- poll timing ----

    def poll_is_active(self, st, reader_stale: bool) -> bool:
        """Adaptive-poll active decision (review #6 / safety).

        Returns True (→ 30 Hz) whenever the machine is doing something OR the status is
        incomplete/unknown/stale — we only drop to the idle rate for a CONFIDENTLY idle
        machine. A None key field or a stale reader means we don't actually know the
        machine is idle, so we must keep polling fast, never coast at the idle rate on
        uncertainty. (The old per-field `is not None and …` guards made an unknown field
        contribute nothing, so a fully-unknown status read as idle.)"""
        if st is None or reader_stale:
            return True
        if (st.interp_state is None or st.task_mode is None
                or st.current_vel is None or st.inpos is None):
            return True
        return (
            st.interp_state != linuxcnc.INTERP_IDLE
            or st.task_mode in (linuxcnc.MODE_AUTO, linuxcnc.MODE_MDI)
            or abs(st.current_vel) > 0.001
            or st.inpos is False
            or st.tool_change_requested is True
        )

    # ---- error channel ----

    def read_errors_nonblocking(self) -> list:
        err = self._get_err()
        if err is None:
            return []
        out = []
        try:
            while len(out) < 50:  # cap: prevents executor stall on pathological error floods
                e = err.poll()
                if not e:
                    break
                out.append(e)
        except Exception as e:
            # Error buffer may be briefly invalid after reconnect — log first
            # failure per reconnect window so a persistent issue surfaces;
            # reset via reset_warn_flags() so each reconnect gets one log line max.
            if not self._err_poll_warned:
                _trace.emit("err_chan.poll_failed", level="warn",
                            exc=type(e).__name__, msg=str(e))
                self._err_poll_warned = True
        return out

    # ---- sampling ----

    def poll_status(self) -> StatusPayload:
        stat = self._get_stat()
        if stat is None:
            raise RuntimeError("LinuxCNC not connected")
        safe_get = self.safe_get
        reader_get = self._reader_get
        # Time STAT.poll() in isolation. Trace shows status_poller.poll_and_serialize
        # holding the loop for 700+ms; we don't know yet whether it's STAT.poll
        # itself (LinuxCNC NML read), the var-file mtime check, or Python work.
        # Per-call probe surfaces the actual culprit. Threshold tight enough to
        # catch storm-time elevations (typical poll is <2 ms).
        _stat_t0 = time.monotonic()
        stat.poll()
        _stat_dt_ms = (time.monotonic() - _stat_t0) * 1000
        if _stat_dt_ms > 30:
            _trace.emit("stat.poll_slow", level="warn",
                        duration_ms=round(_stat_dt_ms, 1), caller="poll_status")

        # ---- safety/state ----
        estop = bool(safe_get("estop", True))
        enabled = bool(safe_get("enabled", False))

        # ---- homing (stat-only truth) ----
        homed_val = safe_get("homed", None)
        homed = self.normalize_homed(homed_val)

        nj = safe_get("joints", 0)
        homed_joints = [bool(x) for x in homed_val[:nj]] if homed_val and nj else None

        # ---- offsets ----
        g5x_index = safe_get("g5x_index", None)
        g5x = to_float_list(safe_get("g5x_offset", None))
        g92 = to_float_list(safe_get("g92_offset", None))
        rotation_xy = safe_get("rotation_xy", None)

        # Update WCS cache: re-seed from var file whenever its mtime changes.
        # LinuxCNC rewrites the var file on interpreter sync (program end, MDI
        # completion that wrote vars, probe macros). This catches writes to
        # inactive slots. Active slot is overwritten from STAT below — mid-motion
        # authoritative source.
        try:
            _vfp = self.resolve_var_file_path()
            if _vfp:
                _vmt = os.path.getmtime(_vfp)
                if self._wcs_var_file_mtime is None or _vmt != self._wcs_var_file_mtime:
                    self.seed_wcs_cache()
        except OSError:
            pass  # var file may be momentarily absent during rename-atomic writes
        if g5x_index is not None and g5x is not None:
            ci = g5x_index - 1  # STAT.g5x_index is 1-based
            if 0 <= ci < 9:
                for j, key in enumerate(WCS_AXIS_KEYS):
                    self.wcs_cache[ci][key] = g5x[j] if len(g5x) > j else 0.0
                self.wcs_cache[ci]["r"] = rotation_xy if rotation_xy is not None else 0.0

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
        if machine_pos is None:
            if not self._machine_pos_warned:
                _trace.emit("poller.no_machine_pos", level="warn",
                            msg="STAT exposes no joint_actual_position / actual_position / position — DRO blank")
                self._machine_pos_warned = True

        # Tool offset vector (active tool length comp)
        tool_offset = to_float_list(safe_get("tool_offset", None))

        # Work position (matches AXIS / GMOCCAPY / QtPyVCP convention):
        #   rel = machine_pos − g5x − tool_offset
        #   rotate (rel.x, rel.y) by −rotation_xy
        #   work_pos = rel − g92
        # G92 is applied AFTER rotation per LinuxCNC coordinate-system spec, so a
        # G92 offset typed in the rotated WCS frame stays aligned with that frame.
        work_pos = None
        if machine_pos is not None:
            work_pos = machine_pos.copy()

            if g5x is not None:
                for i in range(min(len(work_pos), len(g5x))):
                    work_pos[i] -= g5x[i]

            if tool_offset is not None:
                for i in range(min(len(work_pos), len(tool_offset))):
                    work_pos[i] -= tool_offset[i]

            if rotation_xy and len(work_pos) >= 2:
                t = -math.radians(rotation_xy)
                c, s = math.cos(t), math.sin(t)
                x, y = work_pos[0], work_pos[1]
                work_pos[0] = x * c - y * s
                work_pos[1] = x * s + y * c

            if g92 is not None:
                for i in range(min(len(work_pos), len(g92))):
                    work_pos[i] -= g92[i]

        # RAW joint positions (for driving the machine model / spindle nose)
        jpos = safe_get("joint_actual_position", None)
        if jpos is None:
            jpos = safe_get("joint_position", None)
        joint_pos = to_float_list(jpos)

        joint_diagnostics = None
        joint_rows = safe_get("joint", None)
        if joint_rows is not None:
            try:
                joint_diagnostics = []
                for index, joint in enumerate(joint_rows[:nj] if nj else joint_rows):
                    if joint is None:
                        joint_diagnostics.append({"index": index})
                        continue
                    get = joint.get if isinstance(joint, dict) else lambda key, default=None: getattr(joint, key, default)
                    joint_diagnostics.append({
                        "index": index,
                        "type": get("jointType", None),
                        "enabled": _bool_or_none(get("enabled", None)),
                        "homed": _bool_or_none(get("homed", None)),
                        "homing": _bool_or_none(get("homing", None)),
                        "inpos": _bool_or_none(get("inpos", None)),
                        "fault": _bool_or_none(get("fault", None)),
                        "min_soft_limit": _bool_or_none(get("min_soft_limit", None)),
                        "max_soft_limit": _bool_or_none(get("max_soft_limit", None)),
                        "min_hard_limit": _bool_or_none(get("min_hard_limit", None)),
                        "max_hard_limit": _bool_or_none(get("max_hard_limit", None)),
                        "ferror_current": _finite_or_none(get("ferror_current", None)),
                        "ferror_highmark": _finite_or_none(get("ferror_highmark", None)),
                        "min_ferror": _finite_or_none(get("min_ferror", None)),
                        "max_ferror": _finite_or_none(get("max_ferror", None)),
                        "input": _finite_or_none(get("input", None)),
                    })
            except Exception as e:
                _trace.emit("joint_diag.collect_failed", level="warn",
                            exc=type(e).__name__, msg=str(e))
                joint_diagnostics = None

        dtg = to_float_list(safe_get("dtg", None))

        # ---- velocity & spindle ----
        current_vel = safe_get("current_vel", None)
        try:
            current_vel = float(current_vel) if current_vel is not None else None
        except Exception:
            current_vel = None

        # Spindle speed and direction. STAT.spindle is a tuple of dicts; entry [0]
        # carries 'speed' (float) and 'direction' (int) for the primary spindle.
        spindle_speed = None
        spindle_direction = None
        spindles = safe_get("spindle", None)
        if spindles:
            s0 = spindles[0]
            spindle_speed = float(s0['speed'])
            spindle_direction = int(s0['direction'])
        else:
            if not self._spindle_warned:
                _trace.emit("poller.no_spindle_data", level="warn",
                            msg="STAT.spindle empty/missing — commanded spindle speed unavailable")
                self._spindle_warned = True

        # ---- tool (stat-only) ----
        # STAT.tool_table is a tuple of tool_result named tuples (id, xoffset..woffset,
        # diameter, frontangle, backangle, orientation). STAT.tool_offset is a 9-tuple
        # of floats holding the active G43 offset (Z at index 2).
        tool_number = safe_get("tool_in_spindle", None)
        tool_diameter = None
        tool_length = None

        tt = safe_get("tool_table", None)
        if tool_number is not None and tt:
            for t in tt:
                if t.id == tool_number:
                    tool_diameter = float(t.diameter)
                    tool_length = abs(float(t.zoffset))
                    break

        if tool_length is None:
            tofs = safe_get("tool_offset", None)
            if tofs:
                tool_length = abs(float(tofs[2]))

        # Tool change request from HAL iocontrol (via webui-reader snapshot).
        # None means reader has no snapshot yet — pass that through honestly.
        tool_change_requested = reader_get("tool_change")  # Optional[bool]
        tool_change_tool = None
        tool_change_info = None
        if tool_change_requested is True:
            _tc_num = reader_get("tool_prep_number")
            # T0 (spindle unload) is a valid tool number — don't treat 0 as "no
            # tool". Only an absent reader snapshot (None) means "unknown".
            tool_change_tool = int(_tc_num) if _tc_num is not None else None
            if tool_change_tool is not None:
                try:
                    tbl_path = self._get_tool_tbl_path()
                    tbl_mtime = os.path.getmtime(tbl_path) if tbl_path and os.path.exists(tbl_path) else 0
                    cache_key = (tool_change_tool, tbl_mtime)
                    if cache_key not in self._tc_info_cache:
                        tbl_tools = parse_tool_table(tbl_path)
                        library = self._load_tool_library()
                        self._tc_info_cache.clear()
                        self._tc_info_cache[cache_key] = _merge_tool_data(tbl_tools, library)
                    entry = next((t for t in self._tc_info_cache[cache_key] if t["T"] == tool_change_tool), None)
                    if entry:
                        tool_change_info = {"D": entry["D"], "Z": entry["Z"], "description": entry.get("description", "")}
                except (OSError, KeyError, ValueError, TypeError) as e:
                    _trace.emit("toolchange.info_lookup_failed", level="warn",
                                tool=tool_change_tool, exc=type(e).__name__, msg=str(e))

        spindle_ovr = self.get_spindle_override()

        # Spindle speed: pass None through if reader has no snapshot yet (or the
        # pin failed to read this tick). UI consumers handle null with `?? null`.
        _sp_in = reader_get("spindle_speed_in")
        spindle_speed_actual = _sp_in * self._get_fb_scale() if _sp_in is not None else None

        program_elapsed_ms = self.update_program_timer(
            safe_get("interp_state", None),
            bool(safe_get("paused", False)),
        )

        hal_diag_fields = self._get_hal_diag_fields()
        hal_diag = {field: reader_get(field) for field in hal_diag_fields}

        payload = StatusPayload(
            ts=time.time(),
            estop=estop,
            enabled=enabled,
            emc_enable_in=reader_get("emc_enable_in"),
            hal_diag=hal_diag,
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
            wcs_table=[row.copy() for row in self.wcs_cache],
            joint_pos=joint_pos,
            joint_diagnostics=joint_diagnostics,
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
            current_vel=current_vel,
            spindle_speed=spindle_speed,
            spindle_speed_actual=spindle_speed_actual,
            spindle_load=reader_get("spindle_load"),
            spindle_direction=spindle_direction,
            active_file=safe_get("file", None),
            motion_line=safe_get("motion_line", None),
            program_elapsed_ms=program_elapsed_ms,
            gcodes=to_float_list(safe_get("gcodes", None)),
            mcodes=to_float_list(safe_get("mcodes", None)),
            tool_number=tool_number,
            tool_diameter=tool_diameter,
            tool_length=tool_length,
            tool_change_requested=tool_change_requested,
            tool_change_tool=tool_change_tool,
            tool_change_info=tool_change_info,
            probe_tripped=bool(safe_get("probe_tripped", 0)),
            probe_input=reader_get("probe_input"),
            probing=bool(safe_get("probing", 0)),
            probed_position=to_float_list(safe_get("probed_position", None)),
            flood=bool(safe_get("flood", 0)),
            mist=bool(safe_get("mist", 0)),
            eoffset_z=reader_get("z_eoffset"),
            eoffset_enabled=reader_get("z_eoffset_enable"),
            comp_method=reader_get("comp_method"),
            comp_grid_version=reader_get("comp_grid_version"),
        )
        # Backend-authoritative permissions from this very snapshot (issue #19).
        # armed=True; the per-client armed/busy overlay happens client-side.
        # One safety-merge: build the policy state once, broadcast its merged
        # is_estop/is_enabled for the frontend banner, and reuse it for permissions
        # (review #5 — removes the duplicate merge that lived in App.vue).
        _pstate = policy_state_from_payload(payload, armed=True)
        payload.is_estop = _pstate.is_estop
        payload.is_enabled = _pstate.is_enabled
        payload.permissions = evaluate_permissions(_pstate)
        return payload

    def poll_and_serialize(self):
        """Executor-thread helper: poll STAT + serialize to dict in one hop.

        Combines poll_status() and the dataclass→dict conversion so neither
        touches the event loop. Returns (StatusPayload, dict) — the dict is
        cached as _shared_status_dict and consumed (via .copy()) by every
        per-client status_loop.

        The conversion uses `__dict__.copy()` rather than dataclasses.asdict().
        asdict() recursively deep-copies every field; for StatusPayload (no
        nested dataclasses, only primitives + flat lists) the deep copy
        produces the same shape as the shallow copy but cost 100–200 ms under
        storm-time GIL contention (measured 2026-05-02). Shallow copy is
        correct because no consumer mutates the dict's list values.

        Emits poll_status.slow on >50 ms total so we keep visibility on
        regressions.
        """
        _t0 = time.monotonic()
        st = self.poll_status()
        _t1 = time.monotonic()
        out = st.__dict__.copy()
        _t2 = time.monotonic()
        poll_ms = (_t1 - _t0) * 1000
        serialize_ms = (_t2 - _t1) * 1000
        total_ms = poll_ms + serialize_ms
        if total_ms > 50:
            _trace.emit(
                "poll_status.slow", level="warn",
                poll_ms=round(poll_ms, 1),
                serialize_ms=round(serialize_ms, 1),
                total_ms=round(total_ms, 1),
            )
        return st, out
