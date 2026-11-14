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

import math
from dataclasses import dataclass
from typing import Callable, Dict, FrozenSet, Iterable, Mapping, Optional, Tuple, Union

from features import GAMEPAD_COMMANDS, PURPOSE_VARS as PARAM_PURPOSES, VIA_VALUES
from json_types import JsonValue, to_float, to_int


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
    #: Surface compensation's Z eoffset is on. None = UNKNOWN (the HAL reader
    #: is stale, or the pin unread on a machine with a Z axis): the eoffset
    #: gates refuse — unknown is never "no compensation" (button gates BG-12).
    eoffset_enabled: Optional[bool]
    #: Every configured rotary axis parked at zero (status_runtime.rotary_at_zero).
    #: Defaults to False so a caller that forgets to supply it gets the CLOSED
    #: gate, not the open one — the machine is built in exactly one place
    #: (policy_state_from_payload), which always sets it.
    rotary_at_zero: bool = False
    #: Kinematics-mode inputs for the touch-off gates (2026-08-30). Every
    #: field defaults to the CLOSED reading: an unknown kins on a switchable
    #: machine, an unknown fixture, no active plane, a table not known to be
    #: at zero — each refuses. `kins_switchable` defaults True so a builder
    #: that never says what the machine is gets "unknown" (closed), never
    #: "identity" (open); the one real builder (policy_state_from_payload)
    #: always sets it from the kins declaration.
    kins_switchable: bool = True
    #: Live motion.switchkins-type, rounded (0 identity / 1 TCP / 2 TOOL);
    #: None = not sampled or reader stale.
    kins_type: Optional[int] = None
    #: Active fixture, 1-based (G54 = 1 … G59.3 = 9); None = unknown.
    g5x_index: Optional[int] = None
    #: twp-helper-comp twp-is-active (a plane is defined AND the head was
    #: oriented into it).
    twp_active: bool = False
    #: Table A within PROV_A_EPS of zero — the TCP touch-off admission rule
    #: the remap enforces later (to_storage_frame: kins 1 only at A=0).
    a_at_zero: bool = False
    #: A tilted-work-plane is DEFINED (twp-helper-comp twp-is-defined).
    #: Capture refuses rather than silently discarding it (user decision
    #: 2026-08-31: Clear plane first).
    twp_defined: bool = False
    #: G54's A/B/C row ≈ 0 AND G92's rotary components ≈ 0 — the states g683
    #: refuses loudly; the gate closes the Capture button for the same reason
    #: so the operator sees why BEFORE pressing.
    rotary_offsets_clean: bool = False
    #: G92 X/Y/Z ≈ 0 — a live G92 would displace the captured origin
    #: (#<_x> includes it; G68.3's origin words are G54-relative).
    g92_xyz_clean: bool = False
    #: This machine runs the TWP remap stack (gateway _twp_capable: the kins
    #: declaration is the shipped xyzacb-trsrn config). Only then are
    #: G59..G59.3 the remap's scratch rows and plane capture / orient real
    #: actions; a switchable-but-TWP-less machine (a TCP trunnion) and a
    #: plain mill keep their ordinary fixtures (TWP-08a, review 2026-09-14).
    #: Closed default: a builder that never says gets the TWP rules off.
    twp_capable: bool = False
    #: The kins module's `sparm=identityfirst` flag (parse_kins_config):
    #: which RAW switchkins type is identity on a non-trsrn family. Consumed
    #: by the semantic mode mapping (TWP-08b). Same default as the module's.
    identity_first: bool = False
    #: The HEAD is still aligned with the defined plane: the A/B/C pose the
    #: last orient stamped equals the live rotaries (gateway_util
    #: twp_head_aligned is True). Unknown reads False (closed). Gates the
    #: Plane jog frame and Plane → Zero — both promise motion along the tool
    #: axis, which a frozen frame no longer is once a rotary moved (TWP-04).
    twp_aligned: bool = False
    #: The machine STANDS: STAT.inpos AND |current_vel| <= STILL_VEL
    #: (motion_still_of). None = not readable — the G30 capture refuses
    #: (Codex R25 OP-I02: an idle interpreter is no standstill, a manual jog
    #: keeps INTERP_IDLE). Closed default like every field above.
    motion_still: Optional[bool] = None
    #: The interpreter state was READ (STAT.interp_state not None). False: no
    #: gate that needs idle / running / paused opens — an unread state is not
    #: idle (button gates BG-12). Closed default like every field above.
    interp_known: bool = False
    #: iocontrol asks for a manual tool change (HAL tool-change, fresh reader
    #: only). None = unknown — the confirmation stays closed (BG-12 / BG-17).
    tool_change_pending: Optional[bool] = None
    #: STAT.task_mode (TASK_MODE_MANUAL / _AUTO / _MDI); None = unread. The G30
    #: read (no synch with the machine ON in AUTO) and the spindle-before-
    #: homing exception (MANUAL only) read it (button gates D).
    task_mode: Optional[int] = None
    #: A joint is homing (STAT joint[i].homing). None = unread: the mode
    #: gates refuse — a mode switch must not cut a homing sequence (BG-04).
    homing_active: Optional[bool] = None
    #: MDI / AUTO reachable WITHOUT homing (BG-04): motion's kinType is
    #: KINEMATICS_IDENTITY — EMCMOT_COORD refuses an unhomed switch otherwise
    #: (motion command.c v2.9.4:581) — AND [TRAJ] NO_FORCE_HOMING = 1, without
    #: which task refuses every coordinated move anyway. A declaration fact
    #: (gateway _coord_without_homing); unknown reads False (closed).
    coord_without_homing: bool = False
    #: A safety trip not yet acknowledged (gateway _unacked_trip): arming and
    #: E-Stop Reset wait for the acknowledgement (BG-11). Closed default.
    trip_unacked: bool = True
    #: [DISPLAY] WEBUI_SPINDLE_BEFORE_HOMING = 1 (operator Q1): the manual
    #: spindle runs before homing — machine ON, idle, MANUAL only. Closed
    #: default; the gateway reads anything but exactly "1" as off.
    spindle_before_homing: bool = False
    #: [DISPLAY] WEBUI_JOINT_JOG_BEFORE_HOMING = 1 with a valid declared joint
    #: order (operator E1, package E / BG-07): jogging opens before homing —
    #: joint-wise, per axis only where one joint carries the letter, capped
    #: (the gateway's _joint_jog_facts). Closed default.
    joint_jog_before_homing: bool = False


#: Below this |current_vel| (machine units per second) the machine stands —
#: the adaptive poll's idle threshold (status_runtime.is_active).
STILL_VEL = 0.001

#: LinuxCNC's task modes (linuxcnc.MODE_MANUAL / MODE_AUTO / MODE_MDI) — this
#: module imports no binding; test_command_policy pins them to fake_linuxcnc.
TASK_MODE_MANUAL = 1
TASK_MODE_AUTO = 2
TASK_MODE_MDI = 3


def motion_still_of(inpos: object, current_vel: object) -> Optional[bool]:
    """Does the machine stand? None when either input is unreadable —
    never a guessed standstill. Pure; one rule for the policy state and the
    G30 capture's re-check after its synch."""
    if inpos is None or current_vel is None:
        return None
    try:
        vel = abs(to_float(current_vel))
    except (TypeError, ValueError):
        return None
    return bool(inpos) and vel <= STILL_VEL


# Single source of truth for gate semantics (review #6): each gate is an ordered
# list of (requirement predicate, deny message). A gate is PERMITTED iff every
# requirement holds; a DENIAL reports the first unmet requirement's message — so
# the decision and the message read the same table and can never drift.
#
# MUST stay in lockstep with lcnc-webui/src/permissions.ts applyClientOverlay.
# The frontend `!busy` term is intentionally absent here (see module docstring),
# which only ever makes these gates more permissive than the UI, never less.
# Operator reasons are SHORT: "why — what to do" in at most 60 characters
# (design wave D1 live look, operator: "a short info why, not an abstract").
# They are what a dimmed control says at the touch AND what a denied command
# replies; the long explanations live in the docs and the help popovers.
# test_command_policy.TestReasonLength sweeps every state for the cap.
REASON_MAX_CHARS = 60
#: One requirement of a gate: a predicate on the state and the reason its
#: denial gives (the state's own fields, never a guess).
Rule = Callable[["MachineState"], bool]
Requirement = Tuple[Rule, str]
Requirements = Tuple[Requirement, ...]
_KINS_UNKNOWN = "Kinematics mode unknown — HAL reader stale"
_MACHINE_FRAME_ONLY = "Machine frame only"
_HEAD_NOT_ALIGNED = "Head not aligned with the plane — press Orient"
NOT_ARMED = "Not armed — press Arm"

_R_ARMED: Requirement = (lambda s: s.armed, NOT_ARMED)
_R_NOT_ESTOP: Requirement = (lambda s: not s.is_estop, "E-Stop active — reset E-Stop first")
_R_ENABLED: Requirement = (lambda s: s.is_enabled, "Machine off — press Power on")
# An unread interpreter state is not idle (button gates BG-12): this rule
# stands before every idle / running / paused rule, so a denial says the
# state is unknown rather than "busy".
STATE_UNKNOWN = "Machine state unknown — wait for status"
_R_INTERP_KNOWN: Requirement = (lambda s: s.interp_known, STATE_UNKNOWN)
#: A busy interpreter — the idle rule's reason, also the start guard's (BG-32).
MACHINE_BUSY = "Machine busy — wait until it is idle"
_R_IDLE: Requirement = (lambda s: s.is_idle, MACHINE_BUSY)
_R_HOMED: Requirement = (lambda s: s.is_homed, "Not homed — press Home All")
#: Jogging: homed, or joint-wise before homing where the machine declares it
#: (package E) — which axes may move, and how fast, the handler decides.
_R_HOMED_OR_JOINT_JOG: Requirement = (lambda s: s.is_homed or s.joint_jog_before_homing, _R_HOMED[1])
_R_EOFFSET_KNOWN: Requirement = (lambda s: s.eoffset_enabled is not None,
                    "Surface compensation state unknown — HAL reader stale")
_R_NO_EOFFSET: Requirement = (lambda s: s.eoffset_enabled is False,
                 "Surface compensation on — switch it off first")
_R_ROTARY_ZERO: Requirement = (lambda s: s.rotary_at_zero,
                  "Rotary not at 0 — surface maps are 3-axis only")
_R_RUNNING: Requirement = (lambda s: s.is_running, "No program running")
_R_NOT_PAUSED: Requirement = (lambda s: not s.is_paused, "Program already paused")
_R_PAUSED: Requirement = (lambda s: s.is_paused, "No program paused")
# The spindle stop while a program or an MDI runs or pauses: the program owns
# the spindle (button gates BG-18) — the dimmed stop names the stops that work.
SPINDLE_OWNED = "Program owns the spindle — use Pause or Abort"
_R_SPINDLE_FREE: Requirement = (lambda s: s.is_idle, SPINDLE_OWNED)
_R_NO_TOOL_CHANGE: Requirement = (lambda s: s.tool_change_pending is False,
                     "Tool change pending — finish it first")
_R_TOOL_CHANGE_KNOWN: Requirement = (lambda s: s.tool_change_pending is not None,
                        "Tool change request unknown — HAL reader stale")
_R_TOOL_CHANGE_PENDING: Requirement = (lambda s: s.tool_change_pending is True,
                          "No tool change pending")
# The task mode choice (button gates BG-04): task ignores a switch while a jog
# is active, motion takes a new mode only in position, a homing sequence must
# not be cut — and COORD (MDI / AUTO) needs every joint homed unless the
# machine declares otherwise (coord_without_homing). Power and E-Stop are no
# reason: LinuxCNC takes SET_MODE in E-Stop and off (emctaskmain.cc v2.9.4).
_R_STANDS: Requirement = (lambda s: s.motion_still is True, "Machine moving — wait until it stands")
_R_HOMING_KNOWN: Requirement = (lambda s: s.homing_active is not None, "Homing state unknown — wait for status")
_R_NOT_HOMING: Requirement = (lambda s: s.homing_active is False, "Homing in progress — wait until it ends")
_R_COORD_REACHABLE: Requirement = (lambda s: s.is_homed or s.coord_without_homing,
                      "Not homed — MDI and Auto need Home All")
# The confirmed G30 read synchs the interpreter, which LinuxCNC refuses with
# the machine ON in AUTO (gateway _synch_interp_params, Codex R118): the
# read, the capture and the save say so before the press (BG-13).
_R_TASK_MODE_KNOWN: Requirement = (lambda s: s.task_mode is not None, STATE_UNKNOWN)
G30_NOT_IN_AUTO = "G30 not confirmed in AUTO — switch to MDI first"
_R_SYNCH_POSSIBLE: Requirement = (lambda s: not (s.is_enabled and s.task_mode == TASK_MODE_AUTO), G30_NOT_IN_AUTO)
# The recovery order (BG-11): acknowledge a trip → Arm → E-Stop Reset → On.
TRIP_UNACKED = "Acknowledge the safety trip first"
_R_TRIP_ACKED: Requirement = (lambda s: not s.trip_unacked, TRIP_UNACKED)
# The manual spindle (Q1): homed, or the declared exception in MANUAL.
UNHOMED_SPINDLE_MANUAL = "Unhomed spindle: Manual mode only"


def spindle_manual_refusal(s: MachineState) -> Optional[str]:
    """Why the manual spindle may not start NOW for lack of homing, None when
    it may: homed, or the machine declares the spindle before homing
    (WEBUI_SPINDLE_BEFORE_HOMING, operator Q1) and task is in MANUAL."""
    if s.is_homed:
        return None
    if not s.spindle_before_homing:
        return _R_HOMED[1]
    if s.task_mode != TASK_MODE_MANUAL:
        return UNHOMED_SPINDLE_MANUAL
    return None


_R_SPINDLE_HOMING: Requirement = (lambda s: spindle_manual_refusal(s) is None, _R_HOMED[1])


# ---------------------------------------------------------------------------
# Touch-off under kinematics modes (2026-08-30)
#
# A touch-off writes the ACTIVE fixture (G10 L20 P0). On a TWP machine that is
# only sometimes the datum: G59–G59.3 are the remap's scratch rows (rewritten by
# every orient), Plane mode (kins 2) expresses positions in the TOOL frame, and
# a rotary offset displaces the orient move. The datum lives in ONE place — G54
# in the table frame — and these rules keep every touch-off pointed at it:
#   identity (kins 0 / non-switchable): linear letters into G54–G58; rotary
#       letters into G54 only (the remap then refuses to define a plane on a
#       rotary offset, loudly — allowed for non-TWP workflows).
#   The reserved rows are reserved only on a TWP-CAPABLE machine
#       (MachineState.twp_capable): a plain mill or a TCP trunnion runs no
#       remap that rewrites G59–G59.3, so those stay ordinary fixtures there
#       (TWP-08a — the rule used to refuse every machine's G59 touch-off).
#   TCP (kins 1): linear letters into G54–G58, table at A=0 — TCP world equals
#       the table frame G54 is stored in only at the datum (remap.py
#       to_storage_frame), so the UI refuses exactly where the remap would.
#   Plane (kins 2): linear letters, plane active, G59 active → routed to the
#       remap (o<twp_touchoff>), which transforms the touched point back
#       through the plane and writes G54 — never G59.
#   anything else refuses with the reason.
# The two gates below are STATE-only (check_command sees no payload); the
# per-letter decision is touchoff_route, called by the handler. The gates are
# DEFINED through the route so the two can never disagree.
# ---------------------------------------------------------------------------
LINEAR_LETTERS = frozenset("XYZUVW")
ROTARY_LETTERS = frozenset("ABC")
TOUCHOFF_LETTERS = LINEAR_LETTERS | ROTARY_LETTERS
#: G59..G59.3 — owned by the TWP remap (g53x_core writes them at every orient).
RESERVED_FIXTURES = frozenset({6, 7, 8, 9})


def semantic_kins(s: MachineState) -> Optional[int]:
    """The kinematics MODE the policy reasons about — 0 identity, 1 TCP /
    world, 2 TOOL / plane, 3 unsupported — or None when a switchable
    machine's type is unknown (not sampled / reader stale).

    Raw `motion.switchkins-type` numbers mean different things per kins
    FAMILY: on xyzac-trt raw 0 is the WORLD (TCP) kins unless the module was
    loaded with `sparm=identityfirst`, so a policy that read raw 0 as
    identity would have admitted G53 routines under TCP on a plain trt
    (TWP-08b). The raw type is resolved here, once, from the declaration
    (MachineState.identity_first). The shipped TWP stack (xyzacb-trsrn,
    twp_capable) hardcodes 0/1/2 = identity/TCP/TOOL. World/identity mapping
    mirrors gateway_util.kins_nonidentity_flags (not imported: this module
    stays stdlib-only); one deliberate difference: that checker treats trt
    userk (raw 2) as identity math (the stock template), while ADMISSION of
    G53 motion under a kins the policy cannot verify must refuse — 3.
    """
    if not s.kins_switchable:
        return 0
    k = s.kins_type
    if k is None:
        return None
    if s.twp_capable:
        return k if k in (0, 1, 2) else 3
    identity_raw = 0 if s.identity_first else 1   # sparm=identityfirst: raw 0 is identity
    if k == identity_raw:
        return 0
    if k == 1 - identity_raw:
        return 1
    return 3


def raw_kins_for_semantic(semantic: int, twp_capable: bool,
                          identity_first: bool) -> Optional[int]:
    """The RAW switchkins type that means `semantic` (0 identity, 1 TCP /
    world, 2 TOOL / plane) on this kins family — the inverse of
    semantic_kins, and the reason the two live side by side.

    R-01 (implementation review 2026-09-15): the frame the operator picks is
    semantic, the pin is raw, and the two differ per family — on xyzac-trt
    raw 0 is the WORLD kins unless the module was loaded with
    `sparm=identityfirst`. 2 exists only on the TWP stack. None = this
    family has no such mode, which the caller must refuse rather than
    approximate. Pure; round-trips with semantic_kins by construction
    (tested)."""
    if semantic == 2:
        return 2 if twp_capable else None
    if semantic not in (0, 1):
        return None
    if twp_capable:
        return semantic
    identity_raw = 0 if identity_first else 1   # sparm=identityfirst: raw 0 is identity
    return identity_raw if semantic == 0 else 1 - identity_raw


def _unsupported_mode_msg(s: MachineState) -> str:
    return f"Kinematics mode {s.kins_type} unsupported — select Machine"


def touchoff_route(s: MachineState, letters: Iterable[object]) -> Tuple[Optional[str], Optional[str]]:
    """Where a touch-off of `letters` goes in state `s`.

    Returns ("mdi", None) for a plain G10 L20 into the active fixture,
    ("plane", None) for the Plane-mode remap route, or (None, reason).
    Pure; reasons are operator-readable and surface verbatim."""
    ls = [str(l).upper() for l in letters]
    if not ls:
        return None, "No axis given"
    for l in ls:
        if l not in TOUCHOFF_LETTERS:
            return None, f"{l!r} is not an axis letter"
    k = semantic_kins(s)
    if k is None:
        return None, _KINS_UNKNOWN
    if k == 3:
        return None, _unsupported_mode_msg(s)
    if s.g5x_index is None:
        return None, "Active work offset unknown — HAL reader stale"
    if any(l in ROTARY_LETTERS for l in ls):
        if k != 0:
            return None, "Rotary touch-off: Machine frame only"
        if s.g5x_index != 1:
            return None, "Rotary touch-off: G54 only"
    if k == 2:
        # the remap writes X/Y/Z through the plane; U/V/W are refused HERE,
        # before the handler's switch to MDI (package 3a A2, Codex R363)
        extra = sorted(l for l in ls if l not in ("X", "Y", "Z"))
        if extra:
            return None, f"Plane-mode touch-off takes X/Y/Z only (got {extra})"
        if not s.twp_active:
            return None, "No active plane — press Orient or select Machine"
        if s.g5x_index != 6:
            return None, "Plane frame needs G59 — select Plane again"
        return "plane", None
    if s.twp_capable and s.g5x_index in RESERVED_FIXTURES:
        return None, "G59–G59.3 are reserved — touch off in G54–G58"
    if k == 1 and not s.a_at_zero:
        return None, "TCP touch-off needs A at 0 — jog A to 0 or select Machine"
    if k not in (0, 1):
        return None, _unsupported_mode_msg(s)
    return "mdi", None


def kins_runnable(s: MachineState) -> Optional[str]:
    """May a program START under the current kinematics state? None = yes,
    else the operator-readable refusal.

    Plane (TOOL) kinematics is a frozen frame: without an active plane the
    axes follow whatever the kins pins last held, and with an operator
    fixture selected the positions are tilted-frame numbers against
    table-frame offsets. Both are what a program's M2 leaves behind — G54
    restored, the kins TYPE not (it is a HAL pin, not interpreter state; M2
    and M30 are not remappable and the only end hook is the abort handler).
    A 3-axis program started here would cut in the tilted frame. The chip
    shows it (twpPose.ts kinsModeChip); this refuses to run on it. Pure."""
    k = semantic_kins(s)
    if k is None:
        # Same reading as touchoff_route: unknown is not identity.
        return _KINS_UNKNOWN
    if k == 3:
        return _unsupported_mode_msg(s)
    if k == 2 and not s.twp_active:
        return "Plane kinematics without a plane — select Machine"
    if k == 2 and s.g5x_index is None:
        # Plane needs G59 KNOWN: an unread fixture is no G59 (button gates
        # BG-12, Codex R206). The other modes need no fixture here.
        return "Active work offset unknown — wait for status"
    if k == 2 and s.g5x_index != 6:
        return "Plane kinematics without G59 — select Plane or Machine"
    return None


def step_refusal(s: MachineState) -> Optional[str]:
    """May Step fire? None = yes, else the refusal. Out of a pause Step
    continues the program; from idle it STARTS it — the `run` rule, the
    kinematics included (button gates BG-09: the stranded Plane-kins state
    refused Cycle Start and let Step through). Pure."""
    if s.is_paused:
        return None
    if not s.is_idle:
        return "Program running — pause first to step"
    if not s.is_homed:
        return _R_HOMED[1]
    return kins_runnable(s)


def machine_frame_required(s: MachineState) -> Optional[str]:
    """May a G53-moving routine run? None = yes, else the refusal.

    The go-to (Home / G30), tool-change / toolsetter and probing subroutines
    retract and position with G53. Under switched kinematics G53 addresses
    the kinematics' WORLD frame: the tilted plane frame in TOOL mode, the
    table-riding frame in TCP — "G53 Z0" is then not the top of travel, and
    a rotary word swings the head at fixed XYZ joints (the tip sweeps the
    pivot lever). Only identity kinematics makes those routines mean what
    they say (2026-09-03, operator: "if I have defined a plane and press go
    zero, what will happen?"). Pure."""
    k = semantic_kins(s)
    if k is None:
        return _KINS_UNKNOWN
    if k == 3:
        return _unsupported_mode_msg(s)
    if k != 0:
        return _MACHINE_FRAME_ONLY
    return None


# The M-code that SELECTS the Machine frame is configuration-dependent
# (R-01: the shipped trt remaps M428 to its world kins), so operator wording
# names the frame — the JogStrip radio and the typed set_kins_mode command
# own the number.
_R_MACHINE_FRAME: Requirement = (lambda s: machine_frame_required(s) is None, _MACHINE_FRAME_ONLY)
# G30 capture takes the CURRENT position (Codex R25 OP-I02): the machine must
# stand, not merely have an idle interpreter; unknown refuses.
MOTION_UNKNOWN = "Motion state unknown — wait for status"
MACHINE_MOVING = "Machine moving — capture once it stands"
_R_MOTION_KNOWN: Requirement = (lambda s: s.motion_still is not None, MOTION_UNKNOWN)
_R_STILL: Requirement = (lambda s: s.motion_still is True, MACHINE_MOVING)


def goto_zero_plan(s: MachineState, work_z: Optional[float], clearance: float,
                   stamp: Optional[Mapping[str, JsonValue]] = None,
                   metric: bool = True) -> Tuple[Optional[list[str]], Optional[str]]:
    """The → Zero button under the current kinematics: (mdi_lines, None) or
    (None, refusal).

    Machine frame: the probe_basic subroutine (G53 Z0 retract — skipped when
    the controlled point is already at/above machine zero, `#<_abs_z>`: a
    retract never lowers Z — then rotaries to the fixture's touch-off pose,
    then X0 Y0) — `stamp` is the active
    fixture's W1 provenance ({"kins","a",...}, None when unstamped). In
    identity kinematics a fixture is a fixed point in the ROOM, the part's
    datum only at the table angle it was touched off at, so the table goes
    back to the STAMP angle (0 when unstamped = the documented A=0 rule)
    BEFORE X/Y — the tip lands on the part's datum, where the viewer draws
    the triad. 2026-09-04, operator: "G54 did not align anymore with the
    head — it stopped somewhere else" (zeroed at a tilted A, the routine
    drove A to 0). A fixture stamped under TCP/Plane holds table-frame /
    plane numbers, not machine coordinates: refused.
    Plane frame with its plane active and G59 selected: the
    o<twp_goto_zero> subroutine (examples/sim_config/twp/remap_subs) —
    retract ALONG THE TOOL AXIS to `clearance` (machine units; `metric`
    says which, so the sub sets G21/G20 explicitly) unless already above
    it, then X0 Y0 in the plane; rotaries untouched (a rotary move would
    un-orient the head). The sub runs under M73 + G90, so the caller's
    distance mode and units cannot leak in — bare `G0 Z25` / `G0 X0 Y0`
    MDI lines under G91 were +25 of Z and no X/Y move (TWP-01, review
    2026-09-14). The "never lower" decision is the sub's, from the live
    plane Z inside the interpreter; `work_z` is no longer consulted and
    stays only for signature compatibility. TCP: refused — neither the
    machine top nor the tool axis is a world axis there. Pure; unit-tested."""
    k = semantic_kins(s)
    if k is None:
        return None, _KINS_UNKNOWN
    if k == 3:
        return None, _unsupported_mode_msg(s)
    if k == 0:
        sk, a = None, 0.0
        if stamp:
            try:
                sk = int(round(to_float(stamp.get("kins") or 0)))
                a = to_float(stamp.get("a") or 0.0)
            except (TypeError, ValueError):
                return None, "Work offset record unreadable — touch off again"
        if sk not in (None, 0):
            return None, (f"Offset set in {'TCP' if sk == 1 else 'Plane'} — "
                          f"select {'TCP' if sk == 1 else 'Plane'} or touch off again")
        if not math.isfinite(a):
            return None, "Work offset record unreadable — touch off again"
        return [f"O<go_to_zero> CALL [{a:.4f}]"], None
    if k == 1:
        return None, "Machine frame and Plane only"
    if not s.twp_active or s.g5x_index != 6:
        return None, "Plane kinematics without G59 — select Plane or Machine"
    if not s.twp_aligned:
        # The retract is "along the tool axis" only while the head still
        # points where the last orient put it (TWP-04).
        return None, _HEAD_NOT_ALIGNED
    if not math.isfinite(float(clearance)) or float(clearance) < 0:
        return None, "Retract clearance unreadable"
    return [f"O<twp_goto_zero> CALL [{float(clearance):.4f}] [{1 if metric else 0}]"], None


_R_GOZERO: Requirement = (lambda s: goto_zero_plan(s, 0.0, 0.0)[1] is None,
             "Machine frame and Plane only")


#: Plane-frame admission (TWP-04), ordered — ONE source for the handler's
#: refusal text (set_kins_mode mode 2), the `planeFrame` gate that dims the
#: JogStrip radio, and check_command. A bare M430 reuses whatever frame the
#: kins pins last held, so the frame is offered only while a plane is
#: defined and the head is still aligned with it.
_PLANE_FRAME_RULES: Requirements = (
    (lambda s: s.twp_capable,
     "No Plane frame on this machine"),
    (lambda s: s.kins_type is not None, _KINS_UNKNOWN),
    (lambda s: s.twp_defined,
     "No plane defined — Capture one or run G68.2"),
    (lambda s: s.twp_aligned, _HEAD_NOT_ALIGNED),
)


def plane_frame_check(s: MachineState) -> Optional[str]:
    """May the Plane jog frame (M430) be selected? None = yes, else the
    operator-readable refusal — the first failing _PLANE_FRAME_RULES message,
    so the handler, the gate and the WS denial can never disagree. Pure."""
    for ok, msg in _PLANE_FRAME_RULES:
        if not ok(s):
            return msg
    return None


_R_RUNNABLE: Requirement = (lambda s: kins_runnable(s) is None,
               "Plane kinematics without a plane — select Machine")
_R_STEP: Requirement = (lambda s: step_refusal(s) is None,
           "Step needs a homed idle machine, or a pause")


_R_TOUCHOFF_LINEAR: Requirement = (
    lambda s: touchoff_route(s, ("X",))[0] is not None,
    "No touch-off in this frame or work offset")
_R_TOUCHOFF_ROTARY: Requirement = (
    lambda s: touchoff_route(s, ("A",))[0] is not None,
    "Rotary touch-off: Machine frame and G54 only")


#: Capture-plane admission rules, ordered — ONE source for three consumers:
#: twp_capture_check (the handler's refusal text), the twpCapture gate below
#: (check_command surfaces the FIRST failing rule's message verbatim, so a
#: denied WS command names its exact reason, not a summary), and the button
#: dimming (permissions broadcast). Every predicate is None-safe and every
#: default is the CLOSED reading.
_TWP_CAPTURE_RULES: Requirements = (
    # Capability, not switchability: a TCP trunnion is switchable and has no
    # G68.2 / G53.x remap to capture with (TWP-08b).
    (lambda s: s.twp_capable,
     "No plane capture on this machine"),
    (lambda s: s.kins_type is not None, _KINS_UNKNOWN),
    (lambda s: s.g5x_index is not None,
     "Active work offset unknown — HAL reader stale"),
    (lambda s: not s.twp_defined,
     "A plane is already defined — press Clear plane first"),
    (lambda s: s.g5x_index == 1,
     "Capture works on G54 — select G54 first"),
    (lambda s: s.rotary_offsets_clean,
     "Rotary offset active — clear A/B/C offsets and G92"),
    (lambda s: s.g92_xyz_clean,
     "G92 offset active — run G92.1 first"),
)


def twp_capture_check(s: MachineState) -> Optional[str]:
    """May "Capture plane" fire? None = yes, else the operator-readable refusal.

    The one-button manual TWP definition: G69 normalize, G68.3 with origin
    at the current tool tip, no-move G53.1 P0 — driven by the gateway as
    separate blocking MDIs (remapped G-codes never execute inside an o-sub
    called from MDI). First failing _TWP_CAPTURE_RULES message, so the
    handler, the gate and the WS denial can never disagree.

    No A=0 rule and no kins-mode rule beyond "known": capture from the TCP
    jog frame is the stated workflow (align the spindle with the tip held on
    the face), and the sequence's G69 normalizes kins + fixture before the
    tip sample; g683 converts a live table tilt into the table frame itself."""
    for ok, msg in ((f(s), m) for f, m in _TWP_CAPTURE_RULES):
        if not ok:
            return msg
    return None


_BASE: Requirements = (_R_ARMED, _R_NOT_ESTOP, _R_ENABLED)
# Every idle rule is preceded by "the state was read" (BG-12), every eoffset
# rule by "the eoffset is known".
_IDLE: Requirements = (_R_INTERP_KNOWN, _R_IDLE)
_NO_EOFFSET: Requirements = (_R_EOFFSET_KNOWN, _R_NO_EOFFSET)
_MODE_SWITCH: Requirements = (_R_MOTION_KNOWN, _R_STANDS, _R_HOMING_KNOWN, _R_NOT_HOMING)
_G30_SYNCH: Requirements = (_R_TASK_MODE_KNOWN, _R_SYNCH_POSSIBLE)

# gate -> ordered requirements (armed/estop/enabled first → sensible messages).
GATE_REQUIREMENTS: Dict[str, Requirements] = {
    "idle":     _BASE + _IDLE,
    # no NEW jog while homing runs (Codex R219 BG-35): motion rejects it
    # (command.c v2.9.4:785/853), and a booked jog's stop would cancel the
    # homing; an unread homing state opens nothing. The stops stay open.
    "jog":      _BASE + _IDLE + (_R_HOMING_KNOWN, _R_NOT_HOMING, _R_HOMED_OR_JOINT_JOG),
    "override": _BASE,
    "ready":    _BASE + _IDLE + (_R_HOMED,),
    # Program start (Cycle Start / run-from-line): `ready` plus the
    # kinematics-runnable rule above — a stranded Plane-kins state (post-M2)
    # must not start a program in the tilted frame (2026-09-03).
    "run":      _BASE + _IDLE + (_R_HOMED, _R_RUNNABLE),
    # G53-moving routines (go-to Home/G30, tool change / toolsetter, probing
    # cycles): identity kinematics only — see machine_frame_required.
    "machineFrame": _BASE + _IDLE + (_R_HOMED, _R_MACHINE_FRAME),
    # G30 Capture (operator P4): machineFrame AND the machine stands — the
    # current position is what gets taken over.
    "g30Capture": _BASE + _IDLE + (_R_HOMED, _R_MACHINE_FRAME, _R_MOTION_KNOWN, _R_STILL)
                  + _G30_SYNCH,
    # G30 Save (BG-13): machineFrame and a confirming synch is possible.
    "g30Write": _BASE + _IDLE + (_R_HOMED, _R_MACHINE_FRAME) + _G30_SYNCH,
    # The confirmed G30 READ (BG-13): it synchs the interpreter (no motion) —
    # no power or homing term, closed only where the synch is refused (ON +
    # AUTO) and named so.
    "parameterRead": (_R_ARMED,) + _IDLE + _G30_SYNCH,
    # The → Zero button: Machine frame (subroutine) or Plane frame (retract
    # along the tool axis, then X0 Y0 in the plane); TCP refuses.
    "goZero":   _BASE + _IDLE + (_R_HOMED, _R_GOZERO),
    # The Plane jog frame radio (set_kins_mode 2): TWP machine, plane
    # defined, head aligned — see plane_frame_check. Machine/TCP stay on
    # `ready` like the MDI remap they run.
    "planeFrame": _BASE + _IDLE + (_R_HOMED,) + _PLANE_FRAME_RULES,
    # Stops need no arm (button gates BG-08: arm authorizes NEW machine
    # effects; E-Stop was already `always`). Pause interrupts a running
    # sequence — AUTO or MDI; resuming it is new motion and needs arm.
    "pause":    (_R_INTERP_KNOWN, _R_RUNNING, _R_NOT_PAUSED),
    "resume":   _BASE + (_R_INTERP_KNOWN, _R_PAUSED),
    # Step out of a pause continues; from idle it is a START (BG-09).
    "step":     _BASE + (_R_INTERP_KNOWN, _R_STEP),
    "abort":    (),
    # The spindle stop at idle (BG-18): no arm, no homing; while a program
    # or an MDI runs or pauses the program owns the spindle — Pause / Abort.
    "spindleStop": (_R_NOT_ESTOP, _R_ENABLED, _R_INTERP_KNOWN, _R_SPINDLE_FREE),
    # The manual tool-change confirmation (BG-17): it continues the real
    # interpreter, so armed — and only for a FRESH pending request.
    "toolChangeConfirm": (_R_ARMED, _R_TOOL_CHANGE_KNOWN, _R_TOOL_CHANGE_PENDING),
    "probe":    _BASE + _IDLE + (_R_HOMED,) + _NO_EOFFSET,
    "zero":     _BASE + _IDLE + _NO_EOFFSET,
    # Touch-off (G10 L20 / the Plane-mode remap route): `probe` plus the
    # kins-mode × fixture rule above. Two classes because the per-axis
    # controls differ: rotary letters are identity + G54 only.
    "touchoff":       _BASE + _IDLE + (_R_HOMED,) + _NO_EOFFSET + (_R_TOUCHOFF_LINEAR,),
    "touchoffRotary": _BASE + _IDLE + (_R_HOMED,) + _NO_EOFFSET + (_R_TOUCHOFF_ROTARY,),
    # One-button plane capture at the tool tip (o<twp_capture>): plane from
    # the live rotaries, origin at the tip, no-move orient. Defined through
    # twp_capture_check above.
    "twpCapture": _BASE + _IDLE + (_R_HOMED,) + _NO_EOFFSET + _TWP_CAPTURE_RULES,
    # May the operator START surface-map work — probe a new map, or switch
    # compensation ON? `probe` plus "the tool is normal to the mapped surface
    # and the map's grid is aligned to the work". Deliberately NOT the gate on
    # set_compensation itself: that command must stay usable in the DISABLE
    # direction while tilted, which is the safe direction. The UI uses this
    # class for the ON affordance and the scan button; the backend enforces it
    # handler-side (require_no_rotary_tilt) and inside surface_scan.ngc, which
    # also covers an operator typing the MDI by hand.
    "surfaceComp": _BASE + _IDLE + (_R_HOMED,) + _NO_EOFFSET + (_R_ROTARY_ZERO,),
    # Program / macro maintenance (button gates BG-14): armed and the
    # interpreter KNOWN idle — no E-Stop or power term, the files are not the
    # machine. The commit adds what the snapshot cannot see (gateway
    # _write_admission_refusal): the writer's own connection, no start claim,
    # no load / run-from-line transaction, a CURRENT idle read.
    "sourceWrite": (_R_ARMED,) + _IDLE,
    # The tool table: the same, and no tool change asking for a tool.
    "toolTableWrite": (_R_ARMED,) + _IDLE + (_R_TOOL_CHANGE_KNOWN, _R_NO_TOOL_CHANGE),
    # Loading / unloading / re-parsing the program (BG-03): armed and the
    # interpreter KNOWN idle — no E-Stop, power or homing term: PLAN_OPEN
    # needs none (emctaskmain.cc v2.9.4), and the load no longer switches to
    # AUTO first. The handler adds the commit-time admission.
    "programLoad": (_R_ARMED,) + _IDLE,
    # The task mode, per target (BG-04): MANUAL wherever task takes it, MDI
    # and AUTO only where COORD is reachable. No E-Stop or power term.
    "modeManual": (_R_ARMED,) + _IDLE + _MODE_SWITCH,
    "modeCoord":  (_R_ARMED,) + _IDLE + _MODE_SWITCH + (_R_COORD_REACHABLE,),
    # The manual spindle Fwd / Rev / ± (Q1): `ready`, homing replaced by the
    # declared exception (MANUAL only).
    "spindleManual": _BASE + _IDLE + (_R_SPINDLE_HOMING,),
    # The recovery order (BG-11): ARMING waits for the trip acknowledgement
    # (disarming never waits — the Arm button's other direction), E-Stop
    # Reset needs arm and the acknowledgement. Gates of the UI's directed
    # actions; the `arm` command stays `always` (its handler refuses arming).
    "armEnable":  (_R_TRIP_ACKED,),
    "estopReset": (_R_ARMED, _R_TRIP_ACKED),
    "safety":   (_R_ARMED, _R_NOT_ESTOP),            # no `enabled` — Machine On/Off
    "setup":    (_R_ARMED, _R_NOT_ESTOP) + _IDLE,    # no `enabled` — admin/idle ops
    "armed":    (_R_ARMED,),
    "always":   (),
}

#: Gates with no requirement at all — the only ones a command may pass
#: before the gateway has read a status (BG-12): E-Stop, Arm, the jog stops,
#: Abort. Everything else needs a state to be judged against.
STATELESS_GATES = frozenset(g for g, reqs in GATE_REQUIREMENTS.items() if not reqs)


def evaluate_permissions(s: MachineState) -> Dict[str, bool]:
    """The permission classes for `s` (one per GATE_REQUIREMENTS entry), derived from GATE_REQUIREMENTS — the
    same table check_command() reports denials from, so a gate's decision and its
    deny message can't drift (review #6)."""
    return {gate: all(ok(s) for ok, _ in reqs)
            for gate, reqs in GATE_REQUIREMENTS.items()}


def _gate_reason(gate: str, s: MachineState) -> Optional[str]:
    """The FIRST unmet requirement's operator-readable message for `gate` in
    state `s`, None when the gate is open — the one resolver check_command
    (a denied command) and permission_reasons (a dimmed control) share, so
    the two can never explain the same closed gate differently."""
    for ok, message in GATE_REQUIREMENTS[gate]:
        if not ok(s):
            # The composite rules' reasons name the exact stranded state.
            if ok is _R_RUNNABLE[0]:
                return kins_runnable(s) or message
            if ok is _R_STEP[0]:
                return step_refusal(s) or message
            if ok is _R_MACHINE_FRAME[0]:
                return machine_frame_required(s) or message
            if ok is _R_GOZERO[0]:
                return goto_zero_plan(s, 0.0, 0.0)[1] or message
            if ok is _R_TOUCHOFF_LINEAR[0]:
                return touchoff_route(s, ("X",))[1] or message
            if ok is _R_TOUCHOFF_ROTARY[0]:
                return touchoff_route(s, ("A",))[1] or message
            if ok is _R_SPINDLE_HOMING[0]:
                return spindle_manual_refusal(s) or message
            return message
    return None


def gate_refusal(gate: str, s: MachineState) -> Optional[str]:
    """Why `gate` is closed in `s` (None = open) — for a handler whose
    payload picks a stricter gate than its command's (set_mode → modeCoord
    for MDI / AUTO), from the same table as every other decision."""
    return _gate_reason(gate, s)


def permission_reasons(s: MachineState) -> Dict[str, str]:
    """Why each CLOSED gate is closed (U-06, review 2026-09-14): a dimmed
    control used to have no reachable explanation — the reason lived only in
    the denial a command the control could not send would have produced.
    Broadcast beside `permissions`; open gates are absent. Pure."""
    out: Dict[str, str] = {}
    for gate in GATE_REQUIREMENTS:
        r = _gate_reason(gate, s)
        if r is not None:
            out[gate] = r
    return out


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
    # Runs WHILE in estop: armed and the safety trip acknowledged — the
    # recovery order (button gates BG-11); refused before the first status
    # like every non-stop command (BG-12).
    "estop_reset": "estopReset",
    "shutdown": "armed",           # ends LinuxCNC: the writer's arm + the confirmation (button gates C)
    "abort": "abort",
    "machine_on": "safety",
    "machine_off": "safety",
    # --- mode selection (button gates BG-04: per target — the handler
    #     re-checks modeCoord for MDI / AUTO; the gate cannot see the payload) ---
    "set_mode": "modeManual",
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
    "cycle_start": "run",
    "auto_run": "run",
    "auto_step": "step",
    "cycle_pause": "pause",
    "cycle_resume": "resume",
    "mdi": "ready",
    # a macro file (package 5): the macro bar's own class — `probe` as the
    # client's catalog type `macro`; a `FRAME machine` header adds
    # machineFrame in the handler (the gate a G53 move needs)
    "run_macro": "probe",
    # --- spindle / coolant ---
    # Fwd / Rev / ±: `ready`, or unhomed in MANUAL where the machine
    # declares WEBUI_SPINDLE_BEFORE_HOMING (operator Q1).
    "spindle_forward": "spindleManual",
    "spindle_reverse": "spindleManual",
    "spindle_stop": "spindleStop",
    "spindle_increase": "spindleManual",
    "spindle_decrease": "spindleManual",
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
    "tool_change": "machineFrame",
    "go_to_zero": "goZero",
    # Kinematics-frame selector (M428/M429/M430 as a typed command): `ready`
    # for the switch itself; mode 2 is re-checked handler-side with
    # plane_frame_check (the gate cannot see the payload).
    "set_kins_mode": "ready",
    # --- work offsets / probing setup ---
    "set_wcs": "probe",
    "clear_wcs": "probe",
    # Operator touch-off from the DRO (was a client-built `G10 L20 P0` MDI
    # under `probe`; now routed + stamped server-side, see touchoff_route).
    "touchoff": "touchoff",
    "twp_capture": "twpCapture",
    # A form's confirmed values into the interpreter, named by their purpose
    # (settings split package 3, R336: probe / surface / toolsetter — each
    # its own variables and switch); replaced `set_probe_vars`.
    "set_params": "ready",
    # The routines the WebUI starts, each ONE validated job (R336) in place
    # of a client-built `mdi` with `vars`: the gate of the control that
    # starts it (machineControls.ts probeCell / surfaceScan / toolMeasure /
    # toolUnload); its switch is checked on top (features.COMMAND_FEATURES).
    "probe_run": "machineFrame",
    "surface_scan_run": "surfaceComp",
    "tool_measure": "machineFrame",
    "tool_unload_measure": "machineFrame",
    # G30's stored tool-change position (operator P4, Codex R21–R24): a
    # confirming read synchs the interpreter (no motion) — parameterRead, no
    # power or homing term (button gates BG-13); taking the current position
    # over and saving are MACHINE-frame only: our G30 routines address
    # #5181… with G53 moves under identity kins. All three are closed where
    # the synch is refused (machine ON in AUTO).
    "read_g30": "parameterRead",
    "capture_g30": "g30Capture",
    "set_g30": "g30Write",
    # --- tool-table edits (button gates BG-14: E-Stop allowed, no pending
    #     tool change; the handler re-checks at the write) ---
    "save_tool": "toolTableWrite",
    "add_tool": "toolTableWrite",
    "delete_tool": "toolTableWrite",
    "renumber_tool": "toolTableWrite",
    # --- file ops (button gates BG-03: no AUTO pre-step, no power or homing
    #     term; the handler adds the commit-time admission) ---
    "load_file": "programLoad",
    "unload_file": "programLoad",
    # Re-parse the loaded program against current offsets. Same class as
    # loading it: touches no machine state, but spawns the parse worker.
    "reparse_preview": "programLoad",
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
    # actually asking for one: the gate is armed + a FRESH pending request
    # (button gates BG-17; the handler re-reads it, require_tool_change_pending).
    # No idle / ready term — it is used mid-program, at the M6.
    "confirm_tool_change": "toolChangeConfirm",
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
    "get_wcs_table", "list_probe_macros",
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
    return _gate_reason(gate, state)


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

#: LinuxCNC's own limit for ONE MDI command, in BYTES: 2.9.4 emcmodule.cc
#: mdi() takes the UTF-8 line ("s#") and refuses `len > sizeof(m.command) - 1`
#: with "MDI commands limited to 254 characters" — EMC_TASK_PLAN_EXECUTE's
#: `char command[LINELEN]`, LINELEN 255 (linuxcnc.h), one byte for the NUL.
#: Refused there AFTER the gateway's mode switch, so the gateway refuses
#: first (Codex R366 VM-I11; R367: 254, not 255 — the binding's own number,
#: read in its source and proven live by home_step_live_check.py). A
#: character limit let 138 umlauts (268 bytes) through; macro_files.MAX_LINE
#: is the same number (test_payload_contract holds them together), the
#: parameter chunker packs to 250.
MDI_MAX_BYTES = 254


def mdi_line_refusal(line: str) -> Optional[str]:
    """Why LinuxCNC would not take `line` as one MDI command, or None — no NUL
    (its strcpy would cut the line there: the controller runs a DIFFERENT,
    shorter command than the one checked), valid UTF-8, at most
    MDI_MAX_BYTES bytes. Never repaired: a line that fails is refused.
    Pure."""
    if "\x00" in line:
        return "MDI line holds a NUL character"
    try:
        n = len(line.encode("utf-8"))
    except UnicodeEncodeError:
        return "MDI line is not valid text"
    if n > MDI_MAX_BYTES:
        return f"MDI line is {n} bytes — LinuxCNC takes {MDI_MAX_BYTES}"
    return None
#: EMC_TASK_PLAN_OPEN's `char file[LINELEN]`: 2.9.4 emcmodule.cc
#: program_open() refuses `len > sizeof(m.file) - 1` = 254 BYTES — AFTER it
#: has sent EMC_TASK_PLAN_CLOSE: a longer path closed the loaded program and
#: opened nothing (R367, the sibling of the MDI line's limit).
PROGRAM_PATH_MAX_BYTES = 254


def program_path_refusal(path: str) -> Optional[str]:
    """Why LinuxCNC would not open `path` as a program, or None — valid
    UTF-8 (a name the file system holds in other bytes), at most
    PROGRAM_PATH_MAX_BYTES bytes; a NUL never names a file. Pure."""
    if "\x00" in path:
        return "Program path holds a NUL character"
    try:
        n = len(path.encode("utf-8"))
    except UnicodeEncodeError:
        return "Program path is not valid text — rename the file"
    if n > PROGRAM_PATH_MAX_BYTES:
        return f"Path is {n} bytes, LinuxCNC opens {PROGRAM_PATH_MAX_BYTES} — shorten it"
    return None


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
    #: the parameter writes (see WRITABLE_VAR_DENY_RANGES).
    declared_vars: Optional[FrozenSet[int]] = None


#: Parameter ranges that must never be written through a parameter write even when
#: the var file declares them (it does declare most of these — that is the
#: point). #1–#30 are subroutine call arguments; #5000+ is system state with
#: proper commands (G10 L2 for offsets, G92, the tool table), and poking it
#: behind the interpreter's back desynchronises what those commands manage.
WRITABLE_VAR_DENY_RANGES = ((1, 30), (5000, 99999))


#: a schema bound: a literal, none, or a function of the machine's declared limits
Bound = Union[int, float, None, Callable[["MachineLimits"], Optional[float]]]


# Every spec says whether its field is REQUIRED (package 3a, SYS-CONN.S5 +
# #27, Codex R363–R364). Missing, null and the wrong type are three cases:
# a required field missing is refused; null is never "missing" (the page's
# NaN arrives as null) and is refused for every field — the one named
# exception is touchoff.expect's two leaves (ExpectMap); a wrong type is
# refused. An optional field left out keeps its handler's NAMED rule.


@dataclass(frozen=True)
class Num:
    """A numeric field: a JSON number — never a boolean, never a string. An
    `integer` field takes a JSON integer only, compared WITHOUT a detour
    through float (an id past 2^53 is not rounded). `lo`/`hi` are a literal,
    None, or a callable taking MachineLimits (machine-declared bounds named
    at the use site)."""
    lo: Bound = None
    hi: Bound = None
    clamp: bool = False
    integer: bool = False
    required: bool = False


@dataclass(frozen=True)
class Enum:
    """A small closed set of JSON integers — reject anything else (a
    boolean, 1.9, "2")."""
    values: FrozenSet[int]
    required: bool = False


@dataclass(frozen=True)
class Flag:
    """A switch: a JSON boolean, nothing else (bool("false") is True)."""
    required: bool = False


@dataclass(frozen=True)
class Entry:
    """One element of a list of objects (the jog multi forms): its own
    fields, each checked like a top-level field."""
    fields: Mapping[str, object]


@dataclass(frozen=True)
class Seq:
    """A list field with a hard length cap. Unbounded lists matter: the
    jog-multi handlers iterate the payload's `axes` issuing one CMD.jog per
    entry while holding the command lock. `item` checks every element
    (a Num, or an Entry); `min_len` refuses an empty list where nothing
    would be done but a mode switch."""
    max_len: Bound
    required: bool = False
    item: Optional[object] = None
    min_len: int = 0


@dataclass(frozen=True)
class Text:
    max_len: Bound
    required: bool = False


@dataclass(frozen=True)
class MdiText:
    """A raw MDI line (mdi.text): a string LinuxCNC takes as ONE command —
    mdi_line_refusal (no NUL, valid UTF-8, its byte limit)."""
    required: bool = False


@dataclass(frozen=True)
class Choice:
    """A small closed set of WORDS — reject anything else (Enum is for
    integers)."""
    values: FrozenSet[str]
    required: bool = False


@dataclass(frozen=True)
class AxisMap:
    """touchoff's `axes` mapping: axis LETTER -> finite value. Letters are
    structural (an unknown one is rejected, never dropped); values are the
    operator's DRO entries, unbounded like set_wcs' words."""
    required: bool = False


@dataclass(frozen=True)
class VarNumbers:
    """A parameter write's `vars` mapping: keys must be var numbers this
    machine declares AND outside WRITABLE_VAR_DENY_RANGES; every value a
    finite JSON number (a null value wrote `#n=0`)."""
    required: bool = False


@dataclass(frozen=True)
class PurposeSets:
    """set_params' `sets`: purpose (features.PURPOSE_VARS) -> a VarNumbers
    mapping. Each purpose's own variables are the handler's check
    (features.sets_refusal)."""
    required: bool = False


@dataclass(frozen=True)
class Forbidden:
    """A field that must NOT be present — a retired wire form refused rather
    than ignored next to its successor (home's `joint`, R363 N8)."""
    reason: str


@dataclass(frozen=True)
class ExpectMap:
    """touchoff's optional `expect` mapping (U-03, review 2026-09-14): the
    kinematics mode and fixture the operator SAW while entering the value.
    When present: exactly the keys `kins_type` and `g5x_index`, each its
    known form (an integer of its range) or null — "no claim for this
    dimension", the ONE null the contract admits (Codex R363 VM363-02;
    TouchoffExpect, SetupStrip.expectNow). The handler refuses when the live
    state differs — the value must never land on another target."""
    required: bool = False


#: the fixture names a WCS command addresses, in G5X index order (1..9)
FIXTURE_NAMES = ("G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3")


EXPECT_KEYS = frozenset({"kins_type", "g5x_index"})


def touchoff_target_text(kins_type: JsonValue, g5x_index: JsonValue) -> str:
    """Operator wording for a touch-off target: "Plane · G59", "Machine ·
    G54", "TCP · G55", "kins ? · G54". Pure."""
    names = {0: "Machine", 1: "TCP", 2: "Plane"}
    k = None if kins_type is None else names.get(int(round(to_float(kins_type))), f"kins {kins_type}")
    g = None if g5x_index is None else to_int(g5x_index)
    gname = None if g is None else (["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"][g - 1]
                                     if 1 <= g <= 9 else f"fixture {g}")
    return " · ".join(x for x in (k, gname) if x) or "unknown"


def touchoff_expect_check(s: MachineState, expect: JsonValue) -> Optional[str]:
    """Does the touch-off target the keypad was opened under still hold in
    state `s`? None = yes (or no expectation was carried), else the operator
    wording for the refusal. Pure.

    U-03 captured the expectation client-side; R-02 (implementation review
    2026-09-15) is WHERE it is checked: against the published status snapshot
    it accepted a G54 touch-off that the controller had already moved to G55.
    The handler therefore calls this twice — once on the snapshot as a cheap
    pre-check, once on state polled fresh from the controller immediately
    before the write."""
    if not isinstance(expect, dict):
        return None
    ek = expect.get("kins_type")
    eg = expect.get("g5x_index")
    kins_diff = ek is not None and (s.kins_type is None or to_int(ek) != int(s.kins_type))
    fix_diff = eg is not None and (s.g5x_index is None or to_int(eg) != int(s.g5x_index))
    if not (kins_diff or fix_diff):
        return None
    return (f"Touch-off target changed while you were entering: was "
            f"{touchoff_target_text(ek, eg)}, now "
            f"{touchoff_target_text(s.kins_type, s.g5x_index)} — re-enter the value")


def _axis_index(_l: MachineLimits) -> Optional[int]:
    return (_l.n_axes - 1) if _l.n_axes else None


def _neg(v: Optional[float]) -> Optional[float]:
    """Mirror a declared ceiling into a floor, keeping None as unbounded —
    for fields whose SIGN carries meaning and whose magnitude is what the
    machine bounds."""
    return None if v is None else -v


#: the largest value LinuxCNC's C `int` arguments take (emcmodule.cc 2.9.4:
#: `emcauto`'s start line — Codex R363 VM363-01)
INT_MAX = 2**31 - 1
#: a counter the gateway keeps itself (a preview version, a tool-change
#: request): any JSON integer a client can send exactly
SAFE_INT_MAX = 2**53 - 1
PATH_MAX = 4096


def _jog_entry(incremental: bool) -> Entry:
    """One element of jog_cont_multi / jog_incr_multi's `axes`."""
    fields: Dict[str, object] = {
        "axis": Num(lo=0, hi=_axis_index, integer=True, required=True),
        "vel": Num(lo=lambda l: _neg(l.max_jog_velocity), hi=lambda l: l.max_jog_velocity, clamp=True,
                   required=True)}
    if incremental:
        fields["distance"] = Num(required=True)    # the span bound is the handler's (it needs the homing state)
    return Entry(fields)


_JOG_VEL = Num(lo=lambda l: _neg(l.max_jog_velocity), hi=lambda l: l.max_jog_velocity, clamp=True, required=True)
_TOOL = Num(lo=0, hi=TOOL_NUMBER_MAX, integer=True, required=True)
_POCKET = Num(lo=0, hi=TOOL_NUMBER_MAX, integer=True)
_TOOL_FIELDS: Dict[str, object] = {"pocket": _POCKET, "z_offset": Num(), "diameter": Num(lo=0),
                                   "remark": Text(max_len=255)}

COMMAND_SCHEMA: Dict[str, Dict[str, object]] = {
    # --- jogging: axis INDEX is structural (reject), velocity is a slider (clamp)
    #
    # `vel` IS SIGNED and the bound must be symmetric. For jog_cont the sign is
    # the DIRECTION (gateway passes it to CMD.jog unabs'd); the UI sends
    # `vel: v * dir` for both jog commands. Clamping at lo=0 turned every
    # negative jog into vel 0 — the button moved nothing and, because
    # continuous values clamp silently rather than erroring, said nothing
    # either. What is bounded here is the SPEED, i.e. |vel|, so the floor is
    # -max, not 0. A velocity of 0 stays valid and unchanged (N4: what the
    # controller does with it is not verified here).
    "jog_cont":  {"axis": Num(lo=0, hi=_axis_index, integer=True, required=True), "vel": _JOG_VEL},
    "jog_incr":  {"axis": Num(lo=0, hi=_axis_index, integer=True, required=True), "vel": _JOG_VEL,
                  "distance": Num(required=True)},
    # the stops: a payload that fails here is WIDENED, never refused
    # (gateway dispatch, widen_stop — N5)
    "jog_stop":  {"axis": Num(lo=0, hi=_axis_index, integer=True, required=True)},
    "jog_cont_multi":  {"axes": Seq(max_len=lambda l: l.n_axes, required=True, item=_jog_entry(False), min_len=1)},
    "jog_incr_multi":  {"axes": Seq(max_len=lambda l: l.n_axes, required=True, item=_jog_entry(True), min_len=1)},
    "jog_stop_multi":  {"axes": Seq(max_len=lambda l: l.n_axes, required=True,
                                    item=Num(lo=0, hi=_axis_index, integer=True))},
    # --- homing per AXIS (package 3a F-HOME.S2b; operator Q349-1): the strip's
    #     wire index; the gateway names the joint from the declared mapping
    #     and refuses an unclear one (and, for Home, a home group). The joint
    #     on the wire is retired — refused even beside a valid axis (R363 N8).
    #     "All" is home_all / unhome_all alone.
    "home":   {"axis": Num(lo=0, hi=_axis_index, integer=True, required=True),
               "joint": Forbidden("is retired — send the axis, the gateway names the joint")},
    "unhome": {"axis": Num(lo=0, hi=_axis_index, integer=True, required=True),
               "joint": Forbidden("is retired — send the axis, the gateway names the joint")},
    # --- spindle: a speed is continuous, but NEGATIVE is a direction error, not
    #     a slider overshoot — lo=0 clamps a stray sign rather than reversing.
    #     0 stays valid: the page sends it for an empty field (N4).
    "spindle_forward": {"speed": Num(lo=0, hi=lambda l: l.max_spindle_speed, clamp=True, required=True)},
    "spindle_reverse": {"speed": Num(lo=0, hi=lambda l: l.max_spindle_speed, clamp=True, required=True)},
    # --- overrides: builder-declared ceilings, previously hardcoded 2.0 / 0.5
    "set_feed_override":    {"scale": Num(lo=0, hi=lambda l: l.max_feed_override, clamp=True, required=True)},
    "set_spindle_override": {"scale": Num(lo=lambda l: l.min_spindle_override,
                                          hi=lambda l: l.max_spindle_override, clamp=True, required=True)},
    "set_rapid_override":   {"scale": Num(lo=0, hi=1.0, clamp=True, required=True)},  # 1.0 per LinuxCNC
    "set_max_velocity":     {"velocity": Num(lo=0, hi=lambda l: l.max_linear_velocity,
                                             clamp=True, required=True)},
    "set_optional_stop": {"value": Flag(required=True)},
    "set_block_delete":  {"value": Flag(required=True)},
    "set_mode": {"mode": Enum(frozenset({1, 2, 3}), required=True)},      # MANUAL / AUTO / MDI
    # --- program run
    "auto_run": {"line": Num(lo=0, hi=INT_MAX, integer=True, required=True),
                 "file": Text(max_len=PATH_MAX, required=True),
                 "version": Num(lo=0, hi=SAFE_INT_MAX, integer=True, required=True),
                 "source": Text(max_len=64, required=True),   # the confirmed text's sha256 (R17 XZ-07)
                 "probe_vars": VarNumbers(),   # the pre-measurement's toolsetter values (R16)
                 "pre_tool": Num(lo=0, hi=TOOL_NUMBER_MAX, integer=True),
                 "spindle_dir": Choice(frozenset({"forward", "reverse"})),
                 "spindle_speed": Num(lo=0, hi=lambda l: l.max_spindle_speed, clamp=True),
                 "safe_z": Flag(),
                 "entry_x": Num(), "entry_y": Num(),
                 "entry_wcs": Choice(frozenset(FIXTURE_NAMES)),
                 "entry_units": Choice(frozenset({"G20", "G21"}))},
    # --- MDI text: the line's own rule only (mdi_line_refusal: bytes, NUL,
    #     UTF-8). Parsing G-code server-side to decide policy is an
    #     open-ended project and deliberately out of scope.
    "mdi": {"text": MdiText(required=True),
            "vars": VarNumbers()},   # set first, the line only once taken over (R16)
    # --- a macro file: name, the operator's values, the revision shown
    #     (each value is checked against the file's header in the handler)
    "run_macro": {"name": Text(max_len=63, required=True), "args": Seq(max_len=30, item=Num()),
                  "revision": Text(max_len=64, required=True)},
    # --- work offsets: these become G10 L2 words. Unbounded floats reached the
    #     MDI as `G10 L2 P1 Xinf` before this.
    "set_wcs": {"target": Choice(frozenset(FIXTURE_NAMES), required=True),
                **{ax: Num() for ax in ("x", "y", "z", "a", "b", "c", "u", "v", "w", "r")}},
    "clear_wcs": {"target": Choice(frozenset(FIXTURE_NAMES) | {"all", "reserved"}, required=True)},
    "touchoff": {"axes": AxisMap(required=True), "expect": ExpectMap()},
    "set_kins_mode": {"mode": Enum(frozenset({0, 1, 2}), required=True)},
    # --- tool table: a field left out stays as it is (save / renumber, R321
    #     FI321-02), a new tool is unmeasured (add: 0); null is refused
    "save_tool":     {"tool_number": _TOOL, **_TOOL_FIELDS},
    "add_tool":      {"tool_number": _TOOL, **_TOOL_FIELDS},
    "delete_tool":   {"tool_number": _TOOL},
    # The numbers the UI sends (ToolFields): the old one and the new one, and
    # pocket / diameter as save and add bound them (test strategy step 2: a
    # `new_number` nobody sends was bounded, `old_tool_number` was not).
    "renumber_tool": {"old_tool_number": _TOOL, "tool_number": _TOOL, **_TOOL_FIELDS},
    "tool_change":   {"tool_number": _TOOL},              # 0 = unload
    "tool_measure":  {"tool": Num(lo=1, hi=TOOL_NUMBER_MAX, integer=True, required=True)},
    # its absence is the handler's own refusal, which names the next step
    # ("Tool change request changed — confirm again", BG-17/BG-20)
    "confirm_tool_change": {"request": Num(lo=0, hi=SAFE_INT_MAX, integer=True)},
    # --- surface compensation
    "set_compensation": {"enable": Flag(required=True)},
    "set_compensation_method": {"method": Enum(frozenset({0, 1, 2}), required=True)},  # nearest/linear/cubic
    # --- parameters with their purpose, and the routines as jobs (package 3;
    #     each purpose's own variables are the handler's check, features.py).
    #     probe_run's `vars`: required but for the parameterless routines
    #     (features.PARAMLESS_PROBE_ROUTINES) — the handler's rule.
    "set_params": {"sets": PurposeSets(required=True)},
    "probe_run": {"routine": Text(max_len=63, required=True), "vars": VarNumbers()},
    "surface_scan_run": {"vars": VarNumbers(required=True)},
    "set_g30": {"values": AxisMap(required=True), "based_on": AxisMap(required=True)},
    "load_file": {"path": Text(max_len=PATH_MAX, required=True)},
}

# The gamepad's commands say so (package 3): `via: "gamepad"`, refused with
# the gamepad switched off — its stops excepted (gateway dispatch).
for _c in GAMEPAD_COMMANDS:
    COMMAND_SCHEMA.setdefault(_c, {})["via"] = Choice(VIA_VALUES)
# Every gated command AND every read-only query has an entry (N1): an empty
# one says "no fields" — a command without an entry is no longer passed
# through unchecked. The queries handled after the check (get_wcs_table,
# list_probe_macros) need theirs too: without one the dispatch refused them
# as unknown (found before the merge, R366 — the Offsets table and the probe
# macro list would have been dead on a real gateway).
for _c in (*COMMAND_GATES, *READ_ONLY_COMMANDS):
    COMMAND_SCHEMA.setdefault(_c, {})


def _bound(spec_bound: Bound, limits: MachineLimits) -> Optional[float]:
    return spec_bound(limits) if callable(spec_bound) else spec_bound


def _json_number(raw: JsonValue) -> Optional[Union[int, float]]:
    """A JSON number as parsed — int or float; None for anything else (a
    boolean is no number here: bool is an int subclass in Python)."""
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    return raw


def _num_text(v: Union[int, float]) -> str:
    """A bound or value as the operator reads it: an integer whole (2147483648,
    not 2.14748e+09), a float short."""
    return str(v) if isinstance(v, int) else f"{v:g}"


def _check_number(cmd: str, field: str, raw: JsonValue, spec: Num, limits: MachineLimits) -> Optional[Union[int, float]]:
    """Returns a CORRECTED value when clamping applied, else None. Raises
    ValueError for anything but a finite JSON number (an integer field: a
    JSON integer), or a value out of range on a field that rejects."""
    val = _json_number(raw)
    if val is None:
        raise ValueError(f"{cmd}: {field} must be a number")
    if isinstance(val, float) and not math.isfinite(val):
        # set_wcs laundered a cast through a local and shipped `Xinf` into
        # the MDI once, so bounds re-assert it.
        raise ValueError(f"{cmd}: {field} must be finite")
    if spec.integer and not isinstance(val, int):
        raise ValueError(f"{cmd}: {field} must be a whole number")
    lo, hi = _bound(spec.lo, limits), _bound(spec.hi, limits)
    if lo is not None and val < lo:
        if not spec.clamp:
            raise ValueError(f"{cmd}: {field} {_num_text(val)} below minimum {_num_text(lo)}")
        return lo
    if hi is not None and val > hi:
        if not spec.clamp:
            raise ValueError(f"{cmd}: {field} {_num_text(val)} above maximum {_num_text(hi)}")
        return hi
    return None


def _check_var_numbers(cmd: str, field: str, raw: JsonValue, limits: MachineLimits) -> None:
    """A VarNumbers mapping: keys var numbers this machine declares, outside
    WRITABLE_VAR_DENY_RANGES; every value a finite JSON number (a null value
    used to write `#n=0` — R363). Raises ValueError."""
    if not isinstance(raw, dict):
        raise ValueError(f"{cmd}: {field} must be a mapping")
    for key, value in raw.items():
        # ONE spelling per number (Codex R367 VM-I11 rest A): `int()` takes
        # "03054", " 3054", "+3054", "3_054" and other scripts' digits — the
        # check judged #3054 while the writer wrote the key as sent (a
        # 274-byte chunk after the first parameter went out), and two
        # spellings of one number passed side by side. Digits 0-9, no
        # leading zero: the key IS the number's decimal form.
        if not (key.isascii() and key.isdigit() and key == str(int(key))):   # (a JSON key is a str)
            raise ValueError(f"{cmd}: {field} key {key!r} is not a parameter number "
                             f"— digits only, no leading zero")
        num = int(key)
        for dlo, dhi in WRITABLE_VAR_DENY_RANGES:
            if dlo <= num <= dhi:
                raise ValueError(
                    f"{cmd}: #{num} is reserved system parameter space "
                    f"— use the proper command (G10 L2, G92, tool table)")
        if limits.declared_vars is not None and num not in limits.declared_vars:
            raise ValueError(
                f"{cmd}: #{num} is not in this machine's var file — "
                f"declare it there to make it configurable")
        _check_number(cmd, f"{field}.#{num}", value, Num(), limits)
        number = _json_number(value)                 # a finite JSON number by now
        # each value becomes ONE word `#n=<v>` of an MDI chunk; a word longer
        # than a line no chunking can carry (Codex R366 VM-I11) — refused here,
        # before any write
        word = f"#{num}={float(number or 0):.6f}"   # the form _apply_probe_vars_detail writes (the key IS str(num))
        if len(word) > MDI_MAX_BYTES:
            raise ValueError(f"{cmd}: {field}.#{num} is too long for one MDI word ({len(word)} characters)")


def _required(spec: object) -> bool:
    return bool(getattr(spec, "required", False))


def _check_field(cmd: str, field: str, raw: JsonValue, spec: object, limits: MachineLimits) -> Optional[JsonValue]:
    """One PRESENT, non-null value against its spec. Returns a corrected
    value (a clamp, also inside a list of entries) or None; raises
    ValueError for a refused one."""
    if isinstance(spec, Num):
        return _check_number(cmd, field, raw, spec, limits)
    if isinstance(spec, Enum):
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise ValueError(f"{cmd}: {field} must be an integer")
        if raw not in spec.values:
            raise ValueError(f"{cmd}: {field} {raw} not one of {sorted(spec.values)}")
        return None
    if isinstance(spec, Flag):
        if not isinstance(raw, bool):
            raise ValueError(f"{cmd}: {field} must be true or false")
        return None
    if isinstance(spec, Seq):
        if not isinstance(raw, list):
            raise ValueError(f"{cmd}: {field} must be a list")
        cap = _bound(spec.max_len, limits)
        if cap is not None and len(raw) > cap:
            raise ValueError(f"{cmd}: {field} has {len(raw)} entries, maximum {cap}")
        if len(raw) < spec.min_len:
            raise ValueError(f"{cmd}: {field} is empty")
        if spec.item is None:
            return None
        fixed_list: list[JsonValue] = []
        changed = False
        for i, el in enumerate(raw):
            if el is None:
                raise ValueError(f"{cmd}: {field}[{i}] must not be null")
            fixed = _check_field(cmd, f"{field}[{i}]", el, spec.item, limits)
            changed = changed or fixed is not None
            fixed_list.append(el if fixed is None else fixed)
        return fixed_list if changed else None
    if isinstance(spec, Entry):
        if not isinstance(raw, dict):
            raise ValueError(f"{cmd}: {field} must be an object")
        corrected = _check_object(cmd, field, raw, spec.fields, limits)
        return {**raw, **corrected} if corrected else None
    if isinstance(spec, Choice):
        # a WORD of the set; anything else (an unhashable list or object
        # too) is the same refusal, never set membership's TypeError
        if not isinstance(raw, str) or raw not in spec.values:
            raise ValueError(f"{cmd}: {field} {str(raw)[:24]!r} not one of {sorted(spec.values)}")
        return None
    if isinstance(spec, MdiText):
        if not isinstance(raw, str):
            raise ValueError(f"{cmd}: {field} must be a string")
        why = mdi_line_refusal(raw)
        if why:
            raise ValueError(f"{cmd}: {field}: {why}")
        return None
    if isinstance(spec, Text):
        if not isinstance(raw, str):
            raise ValueError(f"{cmd}: {field} must be a string")
        cap = _bound(spec.max_len, limits)
        if cap is not None and len(raw) > cap:
            raise ValueError(
                f"{cmd}: {field} is {len(raw)} characters, maximum {cap} "
                f"(LinuxCNC truncates longer input mid-word)")
        return None
    if isinstance(spec, AxisMap):
        if not isinstance(raw, dict) or not raw:
            raise ValueError(f"{cmd}: {field} must be a non-empty mapping")
        for key, val in raw.items():
            letter = str(key).upper()
            if letter not in TOUCHOFF_LETTERS:
                raise ValueError(f"{cmd}: {key!r} is not an axis letter")
            _check_number(cmd, f"{field}.{letter}", val, Num(), limits)
        return None
    if isinstance(spec, ExpectMap):
        if not isinstance(raw, dict):
            raise ValueError(f"{cmd}: {field} must be a mapping")
        if frozenset(raw) != EXPECT_KEYS:
            raise ValueError(f"{cmd}: {field} must name exactly {sorted(EXPECT_KEYS)}")
        leaves = {"kins_type": Enum(frozenset({0, 1, 2})), "g5x_index": Num(lo=1, hi=9, integer=True)}
        for key, val in raw.items():
            if val is not None:          # null = no claim for this dimension (VM363-02)
                _check_field(cmd, f"{field}.{key}", val, leaves[key], limits)
        return None
    if isinstance(spec, VarNumbers):
        _check_var_numbers(cmd, field, raw, limits)
        return None
    if isinstance(spec, PurposeSets):
        if not isinstance(raw, dict):
            raise ValueError(f"{cmd}: {field} must be a mapping")
        for purpose, values in raw.items():
            if purpose not in PARAM_PURPOSES:
                raise ValueError(f"{cmd}: {field} {str(purpose)[:24]!r} not one of {sorted(PARAM_PURPOSES)}")
            _check_var_numbers(cmd, f"{field}.{purpose}", values, limits)
        return None
    # A spec class this chain does not know would otherwise pass every value
    # through silently — the opposite of a bounds check.
    raise TypeError(f"{cmd}: {field} has an unhandled schema spec {spec!r}")


def _check_object(cmd: str, where: str, msg: Mapping[str, JsonValue], schema: Mapping[str, object],
                  limits: MachineLimits) -> Dict[str, JsonValue]:
    """Every field of `schema` in `msg`: a Forbidden one present, a required
    one missing, any one null — refused; a present one checked. Returns the
    corrections."""
    corrections: Dict[str, JsonValue] = {}
    for field, spec in schema.items():
        name = f"{where}.{field}" if where else field
        if isinstance(spec, Forbidden):
            if field in msg:
                raise ValueError(f"{cmd}: {name} {spec.reason}")
            continue
        if field not in msg:
            if _required(spec):
                raise ValueError(f"{cmd}: {name} missing")
            continue
        raw = msg[field]
        if raw is None:
            raise ValueError(f"{cmd}: {name} must not be null")
        fixed = _check_field(cmd, name, raw, spec, limits)
        if fixed is not None:
            corrections[field] = fixed
    return corrections


def validate_payload(cmd: str, msg: Mapping[str, JsonValue], limits: MachineLimits) -> Dict[str, JsonValue]:
    """The ONE payload check of a command (package 3a, SYS-CONN.S5 + #27,
    Codex R363–R364): its fields against what the machine declares.

    Returns a dict of CORRECTED field values (clamped continuous inputs) for the
    caller to merge into the payload — never mutates `msg`, so the correction is
    explicit and testable. Raises ValueError for a refused payload; the
    gateway's dispatch boundary turns that into a bounded structured reply.

    A required field missing, ANY field null (but touchoff.expect's two
    leaves), a wrong type and a value out of range are refused. An optional
    field left out keeps its handler's named rule. Every gated command has an
    entry; a command with none is refused rather than passed through. Unknown
    extra fields are not judged (N8), a Forbidden one is refused. Pure."""
    schema = COMMAND_SCHEMA.get(cmd)
    if schema is None:
        raise ValueError(f"{cmd}: unknown command")
    return _check_object(cmd, "", msg, schema, limits)


#: The stop commands (gateway._WS_STOP_CMDS is the same set — a test holds
#: them equal): their payload is never a reason to refuse (N5).
STOP_COMMANDS = frozenset({"jog_stop", "jog_stop_multi", "abort", "estop", "cycle_pause", "spindle_stop"})
#: the stops that address jogs — a fault in their target widens them to
#: every jog the gateway booked
JOG_STOPS = frozenset({"jog_stop", "jog_stop_multi"})


def widen_stop(cmd: str, msg: Mapping[str, JsonValue],
               limits: MachineLimits) -> Tuple[Dict[str, JsonValue], Optional[str], bool]:
    """A stop's payload checked — and on a fault WIDENED, never refused (N5,
    Codex R363 Q363-3): an invalid `via` is dropped (the stop runs as one
    from the strip); a jog stop whose target fails (missing, null, the wrong
    type, out of range, a bad entry) stops every jog the gateway booked.
    Returns (the payload to run, the fault or None, stop every booked jog).
    A valid empty jog_stop_multi stays "nothing named". Pure."""
    out: Dict[str, JsonValue] = dict(msg)
    faults: list[str] = []
    if "via" in out:
        try:
            _check_object(cmd, "", {"via": out["via"]}, {"via": Choice(VIA_VALUES)}, limits)
        except ValueError as e:
            faults.append(str(e))
            out.pop("via")
    schema = {k: v for k, v in COMMAND_SCHEMA.get(cmd, {}).items() if k != "via"}
    stop_all = False
    try:
        out.update(_check_object(cmd, "", out, schema, limits))
    except ValueError as e:
        faults.append(str(e))
        stop_all = cmd in JOG_STOPS
    return out, ("; ".join(faults) or None), stop_all
