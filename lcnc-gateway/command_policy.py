#!/usr/bin/env python3
"""Backend command authorization policy (issue #19).

Pure, ``linuxcnc``-free mirror of the frontend permission model
(``lcnc-webui/src/permissions.ts``). The frontend disables controls the
operator should not use; this module lets the GATEWAY refuse commands a
direct or buggy websocket client could otherwise send in a forbidden machine
state. Same intent, enforced on the trusted side.

Scope is the SAFETY-RELEVANT subset of the frontend's classes, not a 1:1
mirror of every UX nicety: homed-before-motion, idle-before-mode-change,
no-run/MDI-while-running, and eoffset-contamination. This is AUTHORIZATION,
not abort-safety — it only refuses *new* commands; motion-abort safety lives
in the HAL chain (see feedback_armed_is_authorization_not_deadman).

Deliberately omitted vs. the frontend ``MachineState``:
  - ``busy``: a client-side debounce/settling flag the gateway cannot observe,
    and a UX concern rather than a safety floor. Dropping it makes the backend
    gate intentionally COARSER (no ``!busy`` term), so the policy never rejects
    a command the machine would actually accept — it only ever blocks the
    clear, dangerous cases.
  - ``hasFile``: not a safety gate.

Keep this file pure: stdlib only, no ``linuxcnc`` import, no import-time side
effects, so it is unit-testable on a plain developer machine.
"""

from dataclasses import dataclass
from typing import Dict, Optional


@dataclass(frozen=True)
class MachineState:
    """The machine-state inputs the policy needs. Built on the gateway from the
    same ``safe_get`` / ``normalize_homed`` / reader values the status broadcast
    uses, so the backend gate agrees with what the frontend sees."""
    armed: bool
    is_estop: bool
    is_enabled: bool
    is_homed: bool
    is_idle: bool
    is_running: bool
    is_paused: bool
    eoffset_enabled: bool
    #: Every configured rotary axis parked at zero (status_runtime.rotary_at_zero).
    #: Defaults to False so a caller that forgets to supply it gets the CLOSED
    #: gate, not the open one — the machine is built in exactly one place
    #: (policy_state_from_payload), which always sets it.
    rotary_at_zero: bool = False


# Single source of truth for gate semantics (review #6): each gate is an ordered
# list of (requirement predicate, deny message). A gate is PERMITTED iff every
# requirement holds; a DENIAL reports the first unmet requirement's message — so
# the decision and the message read the same table and can never drift.
#
# MUST stay in lockstep with lcnc-webui/src/permissions.ts applyClientOverlay.
# The frontend `!busy` term is intentionally absent here (see module docstring),
# which only ever makes these gates more permissive than the UI, never less.
_R_ARMED = (lambda s: s.armed, "Not armed")
_R_NOT_ESTOP = (lambda s: not s.is_estop, "E-stop active")
_R_ENABLED = (lambda s: s.is_enabled, "Machine not on")
_R_IDLE = (lambda s: s.is_idle, "Machine not idle")
_R_HOMED = (lambda s: s.is_homed, "Machine not homed")
_R_NO_EOFFSET = (lambda s: not s.eoffset_enabled,
                 "Surface compensation active — clear the eoffset first")
_R_ROTARY_ZERO = (lambda s: s.rotary_at_zero,
                  "Rotary axis not at zero — surface-map Z compensation is a "
                  "3-axis feature (the map does not tilt or ride the platter)")
_R_RUNNING = (lambda s: s.is_running, "No program running to pause")
_R_NOT_PAUSED = (lambda s: not s.is_paused, "Program already paused")
_R_PAUSED = (lambda s: s.is_paused, "No program paused to resume")
_R_READY_OR_PAUSED = (lambda s: (s.is_idle and s.is_homed) or s.is_paused,
                      "Must be homed and idle, or paused, to step")

_BASE = (_R_ARMED, _R_NOT_ESTOP, _R_ENABLED)

# gate -> ordered requirements (armed/estop/enabled first → sensible messages).
GATE_REQUIREMENTS: Dict[str, tuple] = {
    "idle":     _BASE + (_R_IDLE,),
    "jog":      _BASE + (_R_IDLE, _R_HOMED),
    "override": _BASE,
    "ready":    _BASE + (_R_IDLE, _R_HOMED),
    "pause":    _BASE + (_R_RUNNING, _R_NOT_PAUSED),
    "resume":   _BASE + (_R_PAUSED,),
    "step":     _BASE + (_R_READY_OR_PAUSED,),
    "abort":    _BASE,
    "probe":    _BASE + (_R_IDLE, _R_HOMED, _R_NO_EOFFSET),
    "zero":     _BASE + (_R_IDLE, _R_NO_EOFFSET),
    # May the operator START surface-map work — probe a new map, or switch
    # compensation ON? `probe` plus "the tool is normal to the mapped surface
    # and the map's grid is aligned to the work". Deliberately NOT the gate on
    # set_compensation itself: that command must stay usable in the DISABLE
    # direction while tilted, which is the safe direction. The UI uses this
    # class for the ON affordance and the scan button; the backend enforces it
    # handler-side (require_no_rotary_tilt) and inside surface_scan.ngc, which
    # also covers an operator typing the MDI by hand.
    "surfaceComp": _BASE + (_R_IDLE, _R_HOMED, _R_NO_EOFFSET, _R_ROTARY_ZERO),
    "safety":   (_R_ARMED, _R_NOT_ESTOP),            # no `enabled` — Machine On/Off
    "setup":    (_R_ARMED, _R_NOT_ESTOP, _R_IDLE),   # no `enabled` — admin/idle ops
    "armed":    (_R_ARMED,),
    "always":   (),
}


def evaluate_permissions(s: MachineState) -> Dict[str, bool]:
    """The 14 permission classes for `s`, derived from GATE_REQUIREMENTS — the
    same table check_command() reports denials from, so a gate's decision and its
    deny message can't drift (review #6)."""
    return {gate: all(ok(s) for ok, _ in reqs)
            for gate, reqs in GATE_REQUIREMENTS.items()}


# Each mutating command -> the permission gate it requires. ``always`` means the
# command is never blocked by machine state (its own handler-side guard — e.g.
# ``require_armed`` or a confirmation dialog — is the gate). Read-only queries
# are dispatched before this check and are intentionally absent here. The unit
# tests assert this table plus READ_ONLY_COMMANDS covers every command the
# gateway handles, so a newly added command cannot silently land ungated.
COMMAND_GATES: Dict[str, str] = {
    # --- unconditional / safety handshake ---
    "arm": "always",
    "estop": "always",
    "estop_reset": "always",       # runs WHILE in estop; handler require_armed gates it
    "shutdown": "always",          # confirmation dialog is the safety gate
    "abort": "abort",
    "machine_on": "safety",
    "machine_off": "safety",
    # --- mode selection ---
    "set_mode": "idle",
    # --- jogging (stopping is always allowed) ---
    "jog_cont": "jog",
    "jog_incr": "jog",
    "jog_cont_multi": "jog",
    "jog_incr_multi": "jog",
    "jog_stop": "always",
    "jog_stop_multi": "always",
    # --- homing ---
    "home": "zero",
    "home_all": "zero",
    "unhome": "zero",
    "unhome_all": "zero",
    # --- program execution ---
    "cycle_start": "ready",
    "auto_run": "ready",
    "auto_step": "step",
    "cycle_pause": "pause",
    "cycle_resume": "resume",
    "mdi": "ready",
    # --- spindle / coolant ---
    "spindle_forward": "ready",
    "spindle_reverse": "ready",
    "spindle_stop": "ready",
    "spindle_increase": "ready",
    "spindle_decrease": "ready",
    # --- coolant (override gate: usable during execution, like overrides;
    #     the program's own M7/M8/M9 still wins at its next coolant word) ---
    "flood_on": "override",
    "flood_off": "override",
    "mist_on": "override",
    "mist_off": "override",
    # --- overrides (intentionally usable during execution) ---
    "set_feed_override": "override",
    "set_spindle_override": "override",
    "set_rapid_override": "override",
    "set_max_velocity": "override",
    "set_block_delete": "override",
    "set_optional_stop": "override",
    # --- tool change (M6 — runs motion, must not contaminate via eoffset) ---
    "tool_change": "probe",
    # --- work offsets / probing setup ---
    "set_wcs": "probe",
    "clear_wcs": "probe",
    "set_probe_vars": "ready",
    # --- tool-table edits (no machine-enabled needed) ---
    "save_tool": "setup",
    "add_tool": "setup",
    "delete_tool": "setup",
    "renumber_tool": "setup",
    # --- file ops ---
    "load_file": "setup",
    "unload_file": "setup",
    # Re-parse the loaded program against current offsets. Same class as
    # loading it: touches no machine state, but spawns the parse worker.
    "reparse_preview": "setup",
    # --- surface compensation + HAL handshakes (moved out of the pre-dispatch
    #     inline ladder, where they were `armed`-only and structurally invisible
    #     to the coverage test — see test_command_policy._inline_commands) ---
    # Gates match the frontend catalog exactly (machineControls.ts INPUT_DEFS):
    # compToggle -> ready, compMethod -> probe. NOT `zero`/`probe` for the
    # toggle: those carry _R_NO_EOFFSET, which would block DISABLING
    # compensation once it is on — the one direction that must stay available.
    "set_compensation": "ready",
    "set_compensation_method": "probe",
    # Confirming a manual tool change is meaningful only while iocontrol is
    # actually asking for one; machine state cannot express that, so the real
    # precondition is handler-side (require_tool_change_pending). `armed` is
    # the state gate — the operation must remain available while a program is
    # paused at M6, which is exactly when it is used.
    "confirm_tool_change": "armed",
    # Debug affordance that forces the probe input. Gating it on idle/ready
    # would break its ONLY purpose (exercising a probe cycle's reaction while
    # that cycle is running), so `armed` is the honest gate — the change here
    # is that it is now declared, bounded-error'd and coverage-visible rather
    # than ad-hoc.
    "simulate_probe_trip": "armed",
}

# Read-only queries handled before the policy check — no machine-state gate.
READ_ONLY_COMMANDS = frozenset({
    "get_tool_table", "get_probe_results", "get_comp_grid",
    "get_probe_vars", "get_wcs_table", "list_probe_macros",
})


def check_command(cmd: str, state: MachineState) -> Optional[str]:
    """Return ``None`` if ``cmd`` is allowed in ``state``, else a short,
    operator-readable deny reason.

    Unknown commands and read-only queries return ``None`` — it is not the
    policy's job to reject them (the dispatcher reports unknown commands, and
    read-only queries do not mutate the machine)."""
    gate = COMMAND_GATES.get(cmd)
    if gate is None:
        return None
    # Decision AND message from the one GATE_REQUIREMENTS table: deny on the
    # first unmet requirement (review #6 — no separate reason chain to drift).
    for ok, message in GATE_REQUIREMENTS[gate]:
        if not ok(state):
            return message
    return None


# ---------------------------------------------------------------------------
# Payload bounds (issue #27)
#
# TWO NON-OVERLAPPING CLAIMS, deliberately kept in separate places:
#   * TYPE     — is this a real, finite number at all?  gateway_util.finite_int /
#                finite_float, called by the handlers (41 sites). Unchanged.
#   * BOUNDS   — is it inside what THIS machine declares?  This table.
# Merging them would mean either duplicating the type claim (two sources, one
# truth, guaranteed drift) or rewriting 41 handler call sites. Split, they cannot
# disagree.
#
# Bounds come from the machine (INI / STAT), never from a literal in a handler —
# a builder who declares MAX_FEED_OVERRIDE 1.5 must not have the gateway accept
# 2.0 while only the frontend refuses, which is policy enforced on the client
# (lcnc-webui/src/permissions.ts forbids exactly that).
#
# OUT-OF-RANGE POSTURE, decided 2026-08-20:
#   * clamp=True  — CONTINUOUS operator inputs (override sliders, jog velocity).
#                   Clamp to the bound and report the corrected value; the UI
#                   snaps back visibly. Erroring on a slider drag is noise.
#   * clamp=False — DISCRETE / STRUCTURAL values (axis index, joint, tool number,
#                   G10 axis words). Reject. A clamped index would silently act
#                   on the WRONG axis or tool — the worst possible outcome.
# ---------------------------------------------------------------------------

# LinuxCNC's MDI buffer is 256 chars; longer text is TRUNCATED MID-WORD and
# executed as a different move, silently. Reject instead (gateway.py's own
# set_probe_vars chunker already encodes this limit).
MDI_MAX_CHARS = 255
# LinuxCNC tool-number ceiling. Not machine-declared anywhere, so it is named
# here rather than buried as a literal in a handler.
TOOL_NUMBER_MAX = 99999


@dataclass(frozen=True)
class MachineLimits:
    """Bounds this machine declares. Built once per connection on the gateway
    from get_ini_config() + STAT (see gateway.get_machine_limits) — never
    rebuilt per command. Every field is Optional: an INI that does not declare a
    bound leaves it None and that field is then type-checked only, with the gap
    surfaced by the caller rather than silently defaulted."""
    n_axes: Optional[int] = None
    n_joints: Optional[int] = None
    max_jog_velocity: Optional[float] = None
    max_spindle_speed: Optional[float] = None
    max_feed_override: Optional[float] = None
    min_spindle_override: Optional[float] = None
    max_spindle_override: Optional[float] = None
    max_linear_velocity: Optional[float] = None
    #: var numbers this machine's var file declares — the writable set for
    #: set_probe_vars (see WRITABLE_VAR_DENY_RANGES).
    declared_vars: Optional[frozenset] = None


#: Parameter ranges that must never be written through set_probe_vars even when
#: the var file declares them (it does declare most of these — that is the
#: point). #1–#30 are subroutine call arguments; #5000+ is system state with
#: proper commands (G10 L2 for offsets, G92, the tool table), and poking it
#: behind the interpreter's back desynchronises what those commands manage.
WRITABLE_VAR_DENY_RANGES = ((1, 30), (5000, 99999))


@dataclass(frozen=True)
class Num:
    """A numeric field. `lo`/`hi` are a literal, None, or a callable taking
    MachineLimits (so machine-declared bounds are named at the use site)."""
    lo: object = None
    hi: object = None
    clamp: bool = False
    integer: bool = False


@dataclass(frozen=True)
class Enum:
    """A small closed value set — reject anything else."""
    values: frozenset


@dataclass(frozen=True)
class Seq:
    """A list field with a hard length cap. Unbounded lists matter: the
    jog-multi handlers iterate the payload's `axes` issuing one CMD.jog per
    entry while holding the command lock."""
    max_len: object


@dataclass(frozen=True)
class Text:
    max_len: object


@dataclass(frozen=True)
class VarNumbers:
    """set_probe_vars' `vars` mapping: keys must be var numbers this machine
    declares AND outside WRITABLE_VAR_DENY_RANGES."""


def _axis_index(_l: MachineLimits):
    return (_l.n_axes - 1) if _l.n_axes else None


def _neg(v):
    """Mirror a declared ceiling into a floor, keeping None as unbounded —
    for fields whose SIGN carries meaning and whose magnitude is what the
    machine bounds."""
    return None if v is None else -v


COMMAND_SCHEMA: Dict[str, Dict[str, object]] = {
    # --- jogging: axis INDEX is structural (reject), velocity is a slider (clamp)
    #
    # `vel` IS SIGNED and the bound must be symmetric. For jog_cont the sign is
    # the DIRECTION (gateway passes it to CMD.jog unabs'd); the UI sends
    # `vel: v * dir` for both jog commands. Clamping at lo=0 turned every
    # negative jog into vel 0 — the button moved nothing and, because
    # continuous values clamp silently rather than erroring, said nothing
    # either. What is bounded here is the SPEED, i.e. |vel|, so the floor is
    # -max, not 0.
    "jog_cont":  {"axis": Num(lo=0, hi=_axis_index, integer=True),
                  "vel": Num(lo=lambda l: _neg(l.max_jog_velocity),
                             hi=lambda l: l.max_jog_velocity, clamp=True)},
    "jog_incr":  {"axis": Num(lo=0, hi=_axis_index, integer=True),
                  "vel": Num(lo=lambda l: _neg(l.max_jog_velocity),
                             hi=lambda l: l.max_jog_velocity, clamp=True)},
    "jog_stop":  {"axis": Num(lo=0, hi=_axis_index, integer=True)},
    "jog_cont_multi":  {"axes": Seq(max_len=lambda l: l.n_axes)},
    "jog_incr_multi":  {"axes": Seq(max_len=lambda l: l.n_axes)},
    "jog_stop_multi":  {"axes": Seq(max_len=lambda l: l.n_axes)},
    # --- homing: joint index structural; -1 is the documented "all joints"
    "home":   {"joint": Num(lo=-1, hi=lambda l: (l.n_joints - 1) if l.n_joints else None,
                            integer=True)},
    "unhome": {"joint": Num(lo=-1, hi=lambda l: (l.n_joints - 1) if l.n_joints else None,
                            integer=True)},
    # --- spindle: a speed is continuous, but NEGATIVE is a direction error, not
    #     a slider overshoot — lo=0 clamps a stray sign rather than reversing.
    "spindle_forward": {"speed": Num(lo=0, hi=lambda l: l.max_spindle_speed, clamp=True)},
    "spindle_reverse": {"speed": Num(lo=0, hi=lambda l: l.max_spindle_speed, clamp=True)},
    # --- overrides: builder-declared ceilings, previously hardcoded 2.0 / 0.5
    "set_feed_override":    {"scale": Num(lo=0, hi=lambda l: l.max_feed_override, clamp=True)},
    "set_spindle_override": {"scale": Num(lo=lambda l: l.min_spindle_override,
                                          hi=lambda l: l.max_spindle_override, clamp=True)},
    "set_rapid_override":   {"scale": Num(lo=0, hi=1.0, clamp=True)},  # 1.0 per LinuxCNC
    "set_max_velocity":     {"velocity": Num(lo=0, hi=lambda l: l.max_linear_velocity,
                                             clamp=True)},
    # --- program run
    "auto_run": {"line": Num(lo=0, integer=True),
                 "pre_tool": Num(lo=0, integer=True),
                 "spindle_speed": Num(lo=0, hi=lambda l: l.max_spindle_speed, clamp=True)},
    # --- MDI text: length only. Parsing G-code server-side to decide policy is
    #     an open-ended project and deliberately out of scope.
    "mdi": {"text": Text(max_len=MDI_MAX_CHARS)},
    # --- work offsets: these become G10 L2 words. Unbounded floats reached the
    #     MDI as `G10 L2 P1 Xinf` before this.
    "set_wcs": {ax: Num() for ax in ("x", "y", "z", "a", "b", "c", "u", "v", "w", "r")},
    # --- tool table
    "save_tool":     {"tool_number": Num(lo=0, hi=TOOL_NUMBER_MAX, integer=True),
                      "pocket": Num(lo=0, hi=TOOL_NUMBER_MAX, integer=True),
                      "diameter": Num(lo=0)},
    "add_tool":      {"tool_number": Num(lo=0, hi=TOOL_NUMBER_MAX, integer=True),
                      "pocket": Num(lo=0, hi=TOOL_NUMBER_MAX, integer=True),
                      "diameter": Num(lo=0)},
    "delete_tool":   {"tool_number": Num(lo=0, hi=TOOL_NUMBER_MAX, integer=True)},
    "renumber_tool": {"tool_number": Num(lo=0, hi=TOOL_NUMBER_MAX, integer=True),
                      "new_number": Num(lo=0, hi=TOOL_NUMBER_MAX, integer=True)},
    "tool_change":   {"tool_number": Num(lo=0, hi=TOOL_NUMBER_MAX, integer=True)},
    # --- surface compensation
    "set_compensation_method": {"method": Enum(frozenset({0, 1, 2}))},  # nearest/linear/cubic
    "set_probe_vars": {"vars": VarNumbers()},
}


def _bound(spec_bound, limits: MachineLimits):
    return spec_bound(limits) if callable(spec_bound) else spec_bound


def _check_number(cmd, field, raw, spec: Num, limits) -> Optional[float]:
    """Returns a CORRECTED value when clamping applied, else None. Raises
    ValueError when the value is out of range and the field rejects."""
    try:
        val = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"{cmd}: {field} must be a number")
    if val != val or val in (float("inf"), float("-inf")):
        # finite_* normally catches this; set_wcs laundered its cast through a
        # local and shipped `Xinf` into the MDI, so bounds re-assert it.
        raise ValueError(f"{cmd}: {field} must be finite")
    if spec.integer and val != int(val):
        raise ValueError(f"{cmd}: {field} must be a whole number")
    lo, hi = _bound(spec.lo, limits), _bound(spec.hi, limits)
    if lo is not None and val < lo:
        if not spec.clamp:
            raise ValueError(f"{cmd}: {field} {val:g} below minimum {lo:g}")
        return lo
    if hi is not None and val > hi:
        if not spec.clamp:
            raise ValueError(f"{cmd}: {field} {val:g} above maximum {hi:g}")
        return hi
    return None


def validate_payload(cmd: str, msg: Dict, limits: MachineLimits) -> Dict[str, object]:
    """Bounds-check one command payload against what the machine declares.

    Returns a dict of CORRECTED field values (clamped continuous inputs) for the
    caller to merge into the payload — never mutates `msg`, so the correction is
    explicit and testable. Raises ValueError for a rejected value; the gateway's
    dispatch boundary already turns that into a bounded structured reply.

    Fields absent from the payload are not invented: a handler's own default
    applies. Commands with no schema entry pass through — this table constrains,
    it does not enumerate. Pure."""
    schema = COMMAND_SCHEMA.get(cmd)
    if not schema:
        return {}
    corrections: Dict[str, object] = {}
    for field, spec in schema.items():
        if field not in msg or msg[field] is None:
            continue
        raw = msg[field]
        if isinstance(spec, Num):
            fixed = _check_number(cmd, field, raw, spec, limits)
            if fixed is not None:
                corrections[field] = int(fixed) if spec.integer else fixed
        elif isinstance(spec, Enum):
            try:
                val = int(raw)
            except (TypeError, ValueError):
                raise ValueError(f"{cmd}: {field} must be an integer")
            if val not in spec.values:
                raise ValueError(
                    f"{cmd}: {field} {val} not one of "
                    f"{sorted(spec.values)}")
        elif isinstance(spec, Seq):
            if not isinstance(raw, (list, tuple)):
                raise ValueError(f"{cmd}: {field} must be a list")
            cap = _bound(spec.max_len, limits)
            if cap is not None and len(raw) > cap:
                raise ValueError(
                    f"{cmd}: {field} has {len(raw)} entries, maximum {cap}")
        elif isinstance(spec, Text):
            if not isinstance(raw, str):
                raise ValueError(f"{cmd}: {field} must be a string")
            cap = _bound(spec.max_len, limits)
            if cap is not None and len(raw) > cap:
                raise ValueError(
                    f"{cmd}: {field} is {len(raw)} characters, maximum {cap} "
                    f"(LinuxCNC truncates longer input mid-word)")
        elif isinstance(spec, VarNumbers):
            if not isinstance(raw, dict):
                raise ValueError(f"{cmd}: {field} must be a mapping")
            for key in raw:
                try:
                    num = int(key)
                except (TypeError, ValueError):
                    raise ValueError(f"{cmd}: {key!r} is not a var number")
                for dlo, dhi in WRITABLE_VAR_DENY_RANGES:
                    if dlo <= num <= dhi:
                        raise ValueError(
                            f"{cmd}: #{num} is reserved system parameter space "
                            f"— use the proper command (G10 L2, G92, tool table)")
                if limits.declared_vars is not None and num not in limits.declared_vars:
                    raise ValueError(
                        f"{cmd}: #{num} is not in this machine's var file — "
                        f"declare it there to make it configurable")
    return corrections
