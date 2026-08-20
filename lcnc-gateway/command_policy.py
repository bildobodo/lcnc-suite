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
