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
from typing import Any, Callable, Dict, List, Optional, Sequence

import linuxcnc

import lcnc_trace as _trace
from command_policy import (
    MachineState as _PolicyMachineState,
    evaluate_permissions,
)
from gateway_util import (
    joints_beyond_limits, PROV_A_EPS, atomic_write_bytes, canonical_to_joint_order,
                          resolve_loaded_file)
from tool_table import parse_tool_table, _merge_tool_data

WCS_BASES = [5220, 5240, 5260, 5280, 5300, 5320, 5340, 5360, 5380]
WCS_NAMES = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"]
WCS_AXIS_KEYS = ["x", "y", "z", "a", "b", "c", "u", "v", "w"]

#: Canonical 9-slot indices of the rotary axes (X Y Z A B C U V W).
_ROTARY_SLOTS = (3, 4, 5)
#: How far a rotary may sit from zero and still count as "not tilted". Sized to
#: reject servo dither on a parked rotary, not to tolerate a deliberate tilt —
#: any real 3+2 orientation is degrees away, not hundredths.
ROTARY_ZERO_TOL_DEG = 0.05


def rotary_at_zero(canonical_pos: Optional[List[float]], axis_mask: int) -> Optional[bool]:
    """Are all CONFIGURED rotary axes parked at zero?

    `canonical_pos` is the 9-wide X..W array (STAT.actual_position), NOT the
    joint-ordered machine_pos — on a non-trivkins machine those index
    differently, and this would read the wrong number on exactly the machines
    that have rotaries. Returns True on a machine with no rotary axes, and None
    when the position is unreadable (the caller must refuse, not assume). Pure.
    """
    if canonical_pos is None or len(canonical_pos) < 6:
        return None
    configured = [s for s in _ROTARY_SLOTS if axis_mask & (1 << s)]
    if not configured:
        return True          # 3-axis machine: nothing can be tilted
    return all(abs(canonical_pos[s]) <= ROTARY_ZERO_TOL_DEG for s in configured)


#: Reader field names for the TWP plane. The drawn position is the SUM of
#: the work offset (twp_o* — helper's -world pins) and the plane-origin
#: vector (twp_po* — "from the work-offset to the twp origin"): upstream's
#: vismach composition. Both halves are in the TABLE frame — the plane is
#: stored relative to the A table, datum'd to coincide with machine coords
#: at A=0 — so the sum is a table-frame point, which is exactly the frame
#: the viewer's work group draws in. All-or-nothing: a partial set is not
#: a plane.
_TWP_PLANE_FIELDS = ("twp_ox", "twp_oy", "twp_oz",
                     "twp_pox", "twp_poy", "twp_poz",
                     "twp_zx", "twp_zy", "twp_zz",
                     "twp_xx", "twp_xy", "twp_xz")


def assemble_twp_datum(reader_get) -> Optional[List[float]]:
    """The WORKPIECE datum the plane is built on — the remap's saved work
    offset (G54 at definition, or the last Plane-mode touch-off), published
    by the helper as twp-o*-world, TABLE frame. The viewer draws it as the
    G54 triad while a reserved fixture is active; None unless all three."""
    vals = [reader_get(k) for k in _TWP_PLANE_FIELDS[:3]]
    if any(v is None for v in vals):
        return None
    return [float(v) for v in vals]


def datum_changed(before: Optional[Sequence[float]], now: Optional[Sequence[float]],
                  eps: float = 1e-6) -> Optional[bool]:
    """Did the helper's datum move between two reads? None when either side
    is unreadable (no claim), True once any of X/Y/Z differs by more than
    eps. The settle after M535 keys on this — never on a fixed dwell."""
    if before is None or now is None or len(before) < 3 or len(now) < 3:
        return None
    return any(abs(float(now[i]) - float(before[i])) > eps for i in range(3))


def datum_seq_advanced(before_seq, now_seq) -> Optional[bool]:
    """Did the helper's datum-write epoch (twp-helper-comp.twp-datum-seq,
    bumped by M535 AFTER it published the datum) move between two reads?
    None when either side is unreadable — a helper that predates the pin,
    or no snapshot — so the caller can say so and fall back to the
    value-keyed test. Any change counts: the counter wraps, the reader
    floats it, and floats hold integers exactly far beyond 2^32."""
    if before_seq is None or now_seq is None:
        return None
    return float(now_seq) != float(before_seq)


def seed_wcs_row_xyz(wcs_cache: List[Dict[str, Any]], index0: int,
                     xyz: Sequence[float]) -> None:
    """Overwrite x/y/z of ONE cached fixture row in place (the gateway holds
    the same list object). Used after the remap wrote a NON-ACTIVE fixture
    (M535: G10 L2 P1 while G59 is active) — STAT only refreshes the active
    row and the var file is written at shutdown, so without this the row
    froze at the pre-touch-off value and twpDatumStale fired for a datum
    that never moved. ValueError on a non-finite value or bad index: never
    a partial row."""
    if not (0 <= index0 < len(wcs_cache)):
        raise ValueError(f"wcs row index {index0} out of range")
    vals = []
    for v in xyz[:3]:
        f = float(v)
        if not math.isfinite(f):
            raise ValueError(f"non-finite datum component {v!r}")
        vals.append(f)
    if len(vals) < 3:
        raise ValueError("datum needs three components")
    row = wcs_cache[index0]
    row["x"], row["y"], row["z"] = vals


def assemble_twp_plane(reader_get) -> Optional[List[float]]:
    """The live TWP plane [ox,oy,oz, zx,zy,zz, xx,xy,xz] in the TABLE frame
    (origin already composed: work offset + plane-origin vector) from the
    helper comp's display pins, or None unless every component is present."""
    vals = [reader_get(k) for k in _TWP_PLANE_FIELDS]
    if any(v is None for v in vals):
        return None
    f = [float(v) for v in vals]
    return [f[0] + f[3], f[1] + f[4], f[2] + f[5]] + f[6:]


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
    homed: Optional[bool]  # LinuxCNC stat truth (normalized)
    homed_joints: Optional[list]  # per-joint homed mask (configured joints only)
    # Joint LETTERS whose position lies outside the joint's own soft-limit
    # window (gateway_util.joints_beyond_limits). Non-empty ⇒ motion refuses
    # every world-mode move; the gateway jogs in joint mode meanwhile and the
    # UI says so. None = STAT exposes no joint limits (never silently empty).
    joints_beyond_limit: Optional[List[str]]

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
    g5x_index: Optional[int]  # 1-based: 1=G54, 2=G55 … 6=G59 … 9=G59.3 (STAT.g5x_index)
    g5x_offset: Optional[List[float]]
    g92_offset: Optional[List[float]]
    rotation_xy: Optional[float]
    wcs_table: Optional[List[Dict[str, Any]]]  # all 9 WCS slots (G54–G59.3) w/ per-axis + rotation
    # W1 provenance: the table angle each fixture was touched off at (9 entries,
    # None = no stamp). The client refuses a datum-moved claim on a tilted stamp
    # (the row is not table-frame there).
    wcs_prov_a: Optional[List[Optional[float]]]
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
    current_vel: Optional[float]
    spindle_speed: Optional[float]       # commanded (S word)
    spindle_speed_actual: Optional[float] # after override
    spindle_load: Optional[float]        # load % from configurable HAL pin
    kins_type: Optional[float]           # live motion.switchkins-type (raw HAL value;
                                         # sampled only on switchable-kins configs — None
                                         # = not sampled/reader absent, never a default)
    # Live TWP plane frame — the three pins the TWP remap set_p's at G53.x.
    # UNITS MIRROR THE PINS, including upstream's own asymmetry: pre_rot is
    # RADIANS, the two angles DEGREES. Sampled only on xyzacb-trsrn configs;
    # None = not sampled, never a default. All three or none — a partial trio
    # is not a frame, and the client refuses to build one from it.
    kins_pre_rot: Optional[float]
    kins_primary_angle: Optional[float]
    kins_secondary_angle: Optional[float]
    # Live TWP state from the twp-helper comp (P3 operator surface).
    # Sampled only on xyzacb-trsrn configs; None = not sampled, never a
    # default. twp_plane is the FULL plane definition — [ox,oy,oz (machine
    # frame), zx,zy,zz (plane normal), xx,xy,xz (plane X)] — assembled
    # all-or-nothing from the helper's nine display pins.
    twp_defined: Optional[bool]
    twp_active: Optional[bool]
    twp_plane: Optional[List[float]]
    # The datum the plane rides on (G54 as the remap holds it), TABLE frame —
    # the helper's twp-o*-world pins. None = not sampled.
    twp_datum: Optional[List[float]]
    # Machine-frame A (deg) the HEAD was last oriented at (G53.x). The plane
    # is stored table-relative and rides the workpiece, so it cannot go stale;
    # the head solve can. Raw — the remap's "no orient yet" sentinel (-1e9)
    # rides through so the client interprets it in one place; None still means
    # "not sampled".
    twp_pose_a: Optional[float]
    spindle_direction: Optional[int]
    active_file: Optional[str]
    motion_line: Optional[int]
    # Canonical [A, B, C] actual position (degrees) — the gateway's
    # rotary-drift reparse edge compares this against the payload's
    # parse-time seed (W6). Canonical slots, NOT joint order: the seed is
    # slot-based. None = STAT exposes no canonical position.
    rotary_abc: Optional[List[float]]

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
    #: Every configured rotary axis is within ROTARY_ZERO_TOL_DEG of zero.
    #: True on a machine with no rotary axes at all. None when the position is
    #: unreadable — the gate then refuses rather than assuming zero. Surface-map
    #: Z compensation is a 3-AXIS feature (a machine-Z shim applied after
    #: kinematics, valid only with the tool normal to the mapped surface and the
    #: map's XY grid aligned to the work), so probing or applying it tilted is
    #: directionally wrong.
    rotary_at_zero: Optional[bool]

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


_CAPTURE_OFFSET_EPS = 1e-6  # matches the remap's rotary_offsets_nonzero


def capture_rotary_offsets_clean(wcs_table, g92_offset) -> bool:
    """G54's A/B/C row AND G92's rotary components all ~0 — the capture-gate
    mirror of the remap's rotary_offsets_nonzero (g683 refuses those states
    loudly; the button closes for them with the reason). None/absent/short
    inputs read DIRTY (closed): a gate that cannot see the offsets must
    refuse, never assume clean. Pure; unit-tested."""
    try:
        row = wcs_table[0]
        rot = [float(row[k]) for k in ("a", "b", "c")]
        g92r = [float(g92_offset[i]) for i in range(3, 6)]
    except (TypeError, KeyError, IndexError, ValueError):
        return False
    return all(abs(v) <= _CAPTURE_OFFSET_EPS for v in rot + g92r)


def capture_g92_xyz_clean(g92_offset) -> bool:
    """G92 X/Y/Z all ~0 — a live G92 would displace the captured plane origin
    (#<_x> includes it; G68.3's origin words are G54-relative). None/short
    reads DIRTY (closed). Pure; unit-tested."""
    try:
        g92l = [float(g92_offset[i]) for i in range(3)]
    except (TypeError, IndexError, ValueError):
        return False
    return all(abs(v) <= _CAPTURE_OFFSET_EPS for v in g92l)


def policy_state_from_payload(p: "StatusPayload", armed: bool,
                              kins_switchable: bool = True) -> _PolicyMachineState:
    """Build the command-policy MachineState from a status snapshot.

    `kins_switchable` is the machine's kins DECLARATION (gateway
    _kins_is_switchable), not a status field: it decides whether a missing
    kins_type means "identity, certainly" or "unknown" (closed touch-off
    gates). Defaults to True — unknown — so a caller that does not say what
    the machine is gets the closed reading.

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
        # None (position unreadable) reads as NOT at zero: a gate that cannot
        # see the rotaries must refuse, not assume. This is the opposite of the
        # eoffset convention above deliberately — an absent eoffset pin means
        # "no compensation active" (permissive is correct), while an absent
        # rotary reading means "I don't know how the tool is oriented".
        rotary_at_zero=(p.rotary_at_zero is True),
        # Touch-off gates (2026-08-30): the kins mode × active fixture rule.
        # kins_type is the raw switchkins pin (float) — rounded here, once.
        kins_switchable=bool(kins_switchable),
        # getattr: a partial payload (test doubles, an older envelope) reads as
        # UNKNOWN — the closed gate — never as identity/G54.
        kins_type=(None if (_kt := getattr(p, "kins_type", None)) is None
                   else int(round(float(_kt)))),
        g5x_index=(None if (_gi := getattr(p, "g5x_index", None)) is None else int(_gi)),
        twp_active=(getattr(p, "twp_active", None) is True),
        # Table A at the datum within the provenance window; an absent
        # canonical position reads as NOT at zero (closed), like the rotary
        # rule above.
        a_at_zero=((_ra := getattr(p, "rotary_abc", None)) is not None and len(_ra) > 0
                   and abs(float(_ra[0])) <= PROV_A_EPS),
        # Capture-plane gate inputs (2026-08-31): absent table/offset data
        # reads CLOSED, like every rule above.
        twp_defined=(getattr(p, "twp_defined", None) is True),
        rotary_offsets_clean=capture_rotary_offsets_clean(
            getattr(p, "wcs_table", None), getattr(p, "g92_offset", None)),
        g92_xyz_clean=capture_g92_xyz_clean(getattr(p, "g92_offset", None)),
    )


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
        get_kins_switchable: Callable[[], bool] = lambda: True,
        get_prov_a: Callable[[], Optional[List[Optional[float]]]] = lambda: None,
    ) -> None:
        self._get_stat = get_stat
        # Kins declaration for the touch-off gates; default "unknown" = closed
        # (see policy_state_from_payload). The gateway wires _kins_is_switchable.
        self._get_kins_switchable = get_kins_switchable
        self._get_prov_a = get_prov_a
        self._get_err = get_err
        self._reader_get = reader_get
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
        # Loaded-program resolver state: STAT.file flips to subroutine paths
        # mid-execution (M6 remap, o-word CALLs); resolve_loaded_file holds the
        # last idle-time value so active_file means "loaded program", not
        # "interpreter's currently open file". _file_flip_traced dedupes the
        # ignored-flip trace to one line per flip (not one per 30 Hz tick).
        self._loaded_file: Optional[str] = None
        self._loaded_file_seen = False
        self._file_flip_traced: Optional[str] = None
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

    def mark_var_file_written(self, path: str) -> None:
        """The GATEWAY just wrote the var file (provenance rows, probe vars).
        Adopt its new mtime so the next poll does not reseed all nine axis
        rows from disk — those disk rows are the shutdown-stale values and
        would clobber a row the gateway seeded from the live datum."""
        try:
            self._wcs_var_file_mtime = os.path.getmtime(path)
        except OSError:
            self._wcs_var_file_mtime = None

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

        # Update WCS cache: re-seed from the var file whenever its mtime
        # changes. LinuxCNC writes that file ONLY at shutdown (decisions.md
        # 2026-08-20; gcode_canon.py), so this path catches DISK writers — the
        # gateway's own provenance/probe-var writes (which call
        # mark_var_file_written so they do not reseed axis rows they never
        # wrote) and foreign editors — never an interpreter-side G10 to an
        # inactive slot. The active slot is overwritten from STAT below (the
        # mid-motion authoritative source); an inactive slot written by the
        # remap (M535 → G10 L2 P1 while G59 is active) is seeded by the
        # gateway from the helper's datum pins (seed_wcs_row_xyz).
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
        # joint positions equal Cartesian axis positions VALUE-wise, but the
        # ARRAY LAYOUT differs: joint arrays are compacted to the configured
        # axes (joint order), canonical arrays are 9-wide X..W at fixed slots.
        # machine_pos is JOINT-ORDERED on the wire — the canonical fallbacks
        # are re-indexed to match.
        axis_mask = safe_get("axis_mask", 0) or 0
        if not axis_mask:
            # No mask = cannot re-index canonical offsets to joint slots.
            # Fall back to index-wise math (exact for XYZ-canonical-prefix
            # machines, the old behavior) — but never silently: STAT always
            # carries axis_mask on a loaded config, so this firing at all
            # means something upstream is wrong.
            if not getattr(self, "_axis_mask_warned", False):
                _trace.emit("poller.no_axis_mask", level="warn",
                            msg="STAT has no axis_mask — offsets applied index-wise (joint↔canonical re-indexing skipped)")
                self._axis_mask_warned = True
            axis_mask = 0b111111111
        # Canonical actual position, kept in slot order for the rotary-drift
        # edge (W6): the parse-time seed is canonical-slot-based (A/B/C =
        # slots 3/4/5), while machine_pos below is JOINT order.
        _canon_pos = to_float_list(safe_get("actual_position", None))
        rotary_abc = _canon_pos[3:6] if _canon_pos and len(_canon_pos) >= 6 else None
        machine_pos = to_float_list(safe_get("joint_actual_position", None))
        if machine_pos is None:
            machine_pos = canonical_to_joint_order(_canon_pos, axis_mask)
        if machine_pos is None:
            machine_pos = canonical_to_joint_order(
                to_float_list(safe_get("position", None)), axis_mask)
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
        # The offsets are CANONICAL-indexed — re-index to joint order before
        # subtracting from the joint-ordered machine_pos (a plain index-wise
        # subtraction silently took B's offset from C's angle on XYZBC, and C's
        # from nothing on XYZAC — "Zero B/C does nothing").
        # ---- kins-mode work_pos source (2026-08-31, operator-caught) ----
        # The subtraction below is the trivkins identity: joints == world.
        # Under switchable kins mode 1/2 (TCP/TOOL) the world coords come
        # from the FORWARD KINS — subtracting G59 from joint values produced
        # DRO numbers that never read 0 at the plane origin. So: non-zero
        # live kins type sources the math from canonical actual_position
        # (the trajectory's forward-kins world output); identity keeps the
        # encoder-live joint path (updates with the machine off). A missing
        # world position under kins != 0 leaves the DRO BLANK (None) — never
        # joint-frame numbers posing as plane coordinates.
        _kt_raw = reader_get("kins_type")
        _kins_nonzero = _kt_raw is not None and int(round(float(_kt_raw))) != 0
        pos_src = machine_pos
        if _kins_nonzero:
            pos_src = canonical_to_joint_order(_canon_pos, axis_mask)
            if pos_src is None:
                if not getattr(self, "_world_pos_warned", False):
                    _trace.emit("poller.world_pos_missing", level="warn",
                                msg="kins mode != 0 but STAT has no actual_position — work_pos blank")
                    self._world_pos_warned = True
        work_pos = None
        if pos_src is not None:
            work_pos = pos_src.copy()

            g5x_j = canonical_to_joint_order(g5x, axis_mask)
            if g5x_j is not None:
                for i in range(min(len(work_pos), len(g5x_j))):
                    work_pos[i] -= g5x_j[i]

            tofs_j = canonical_to_joint_order(tool_offset, axis_mask)
            if tofs_j is not None:
                for i in range(min(len(work_pos), len(tofs_j))):
                    work_pos[i] -= tofs_j[i]

            if rotation_xy:
                # Rotate in the XY plane via the JOINT slots of X and Y —
                # index 0/1 only by accident of X,Y being the first two
                # configured axes (a lathe's joint 1 is Z). A letter's joint
                # index = number of set mask bits below its canonical bit.
                ix = 0 if (axis_mask & 1) else -1
                iy = bin(axis_mask & 0b1).count("1") if (axis_mask & 2) else -1
                if 0 <= ix < len(work_pos) and 0 <= iy < len(work_pos):
                    t = -math.radians(rotation_xy)
                    c, s = math.cos(t), math.sin(t)
                    x, y = work_pos[ix], work_pos[iy]
                    work_pos[ix] = x * c - y * s
                    work_pos[iy] = x * s + y * c

            g92_j = canonical_to_joint_order(g92, axis_mask)
            if g92_j is not None:
                for i in range(min(len(work_pos), len(g92_j))):
                    work_pos[i] -= g92_j[i]

        # RAW joint positions (for driving the machine model / spindle nose)
        jpos = safe_get("joint_actual_position", None)
        joints_beyond_limit = None
        jinfo = safe_get("joint", None)
        if jpos is not None and jinfo:
            try:
                nj_lim = int(safe_get("joints", 0) or 0) or len(jinfo)
                lims = [(j.get("min_position_limit"), j.get("max_position_limit"))
                        if isinstance(j, dict) else (None, None) for j in jinfo[:nj_lim]]
                jl = [L for i, L in enumerate("XYZABCUVW") if int(axis_mask) & (1 << i)]
                joints_beyond_limit = [jl[i] if i < len(jl) else f"J{i}"
                                       for i in joints_beyond_limits(list(jpos)[:nj_lim], lims)]
            except (TypeError, ValueError, AttributeError) as exc:
                _trace.emit("poller.joint_limits_unreadable", level="warn", error=repr(exc))
                joints_beyond_limit = None
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

        # Loaded program (see resolve_loaded_file): STAT.file follows the
        # interpreter's open file, flipping to subroutine paths mid-execution.
        # Adopt changes only while the interpreter is idle; trace ignored flips
        # once each so the branch stays auditable without 30 Hz spam.
        _interp = safe_get("interp_state", None)
        _raw_file = safe_get("file", None)
        active_file, _flip = resolve_loaded_file(
            _raw_file,
            _interp is None or _interp == linuxcnc.INTERP_IDLE,
            self._loaded_file,
            self._loaded_file_seen,
        )
        self._loaded_file = active_file
        self._loaded_file_seen = True
        if _flip is not None and _flip != self._file_flip_traced:
            _trace.emit("status.file_flip_ignored", level="info",
                        raw_file=os.path.basename(_flip), loaded=os.path.basename(active_file or ""))
        self._file_flip_traced = _flip

        payload = StatusPayload(
            ts=time.time(),
            estop=estop,
            enabled=enabled,
            emc_enable_in=reader_get("emc_enable_in"),
            homed=homed,
            homed_joints=homed_joints,
            joints_beyond_limit=joints_beyond_limit,
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
            wcs_prov_a=self._get_prov_a(),
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
            current_vel=current_vel,
            spindle_speed=spindle_speed,
            spindle_speed_actual=spindle_speed_actual,
            spindle_load=reader_get("spindle_load"),
            kins_type=reader_get("kins_type"),
            kins_pre_rot=reader_get("kins_pre_rot"),
            kins_primary_angle=reader_get("kins_primary_angle"),
            kins_secondary_angle=reader_get("kins_secondary_angle"),
            twp_defined=(None if (_twpd := reader_get("twp_defined")) is None
                         else bool(_twpd)),
            twp_active=(None if (_twpa := reader_get("twp_active")) is None
                        else bool(_twpa)),
            twp_plane=assemble_twp_plane(reader_get),
            twp_datum=assemble_twp_datum(reader_get),
            twp_pose_a=reader_get("twp_pose_a"),
            spindle_direction=spindle_direction,
            active_file=active_file,
            motion_line=safe_get("motion_line", None),
            rotary_abc=rotary_abc,
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
            # Canonical (9-wide) position, never the joint-ordered machine_pos —
            # see rotary_at_zero().
            rotary_at_zero=rotary_at_zero(
                to_float_list(safe_get("actual_position", None)), axis_mask),
        )
        # Backend-authoritative permissions from this very snapshot (issue #19).
        # armed=True; the per-client armed/busy overlay happens client-side.
        # One safety-merge: build the policy state once, broadcast its merged
        # is_estop/is_enabled for the frontend banner, and reuse it for permissions
        # (review #5 — removes the duplicate merge that lived in App.vue).
        _pstate = policy_state_from_payload(
            payload, armed=True, kins_switchable=self._get_kins_switchable())
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
