"""Unit tests for command_policy — the pure, linuxcnc-free backend authz policy
(issue #19). Run via ``python3 -m unittest test_command_policy`` or pytest.
"""

import re
import unittest
from pathlib import Path

from command_policy import (
    MachineState,
    MachineLimits,
    evaluate_permissions,
    check_command,
    validate_payload,
    COMMAND_GATES,
    COMMAND_SCHEMA,
    READ_ONLY_COMMANDS,
    GATE_REQUIREMENTS,
)


def _gateway_src() -> str:
    return (Path(__file__).resolve().parent / "gateway.py").read_text(encoding="utf-8")


def _function_body(src: str, signature: str) -> str:
    """Source text of one top-level function, from its `def` to the next one."""
    start = src.index(signature)
    rest = src[start + 1:]
    m = re.search(r"\n(?:async def|def) \w", rest)
    return rest[: m.start()] if m else rest


def _dispatched_commands() -> set:
    """Command names the gateway ACTUALLY dispatches, parsed from the
    ``_handle_command_impl`` source (its ``cmd == "..."`` ladder) rather than a
    hand-maintained copy — so a newly added handler that wasn't gated fails the
    coverage test below (review #2). Reads the source as text; no linuxcnc import."""
    return set(re.findall(r'cmd == "([^"]+)"',
                          _function_body(_gateway_src(), "async def _handle_command_impl")))


def _inline_commands() -> set:
    """Command names handled INLINE in the websocket receive loop, before the
    ``handle_command`` dispatch boundary.

    Why this exists: the coverage contract below used to parse only the
    ``_handle_command_impl`` ladder, so its guarantee was silently scoped to
    that one path. Four commands — ``set_compensation``,
    ``set_compensation_method``, ``simulate_probe_trip``, ``confirm_tool_change``
    — sat in the inline ladder authorized by ``client.armed`` alone, invisible
    to this test by construction. Fixing those four without fixing the test
    boundary would have guaranteed a fifth: the next inline handler would land
    ungated and unseen too.

    So: every command reachable on ANY path must be gated, read-only, or listed
    in INLINE_EXEMPT with a reason."""
    return set(re.findall(r'msg\.get\("cmd"\) == "([^"]+)"',
                          _function_body(_gateway_src(), "async def ws_endpoint")))


# Inline handlers that legitimately need no machine-state gate. Each must have a
# reason; "it was already like that" is not one.
INLINE_EXEMPT = frozenset({
    "heartbeat",        # transport liveness; no machine effect
    "hello",            # session handshake, runs before any state exists
    "safety_trip_ack",  # clears an unacked trip — MUST work while in ESTOP
    "get_settings",     # read
    "save_settings",    # UI preferences; server-side section allowlist is its gate
    "client_diag",      # browser telemetry
    "timing_log",       # dev instrumentation
    "halshow_live",     # diagnostics subscribe toggle (read)
    "halshow_refresh",  # diagnostics pin dump (read)
    "tab_visibility",   # client-side hint for status throttling
})

DISPATCHED_COMMANDS = _dispatched_commands()
INLINE_COMMANDS = _inline_commands()
ALL_HANDLED_COMMANDS = DISPATCHED_COMMANDS | INLINE_COMMANDS


def state(**over) -> MachineState:
    """A homed, idle, enabled, armed machine — override fields per test."""
    base = dict(
        armed=True, is_estop=False, is_enabled=True, is_homed=True,
        is_idle=True, is_running=False, is_paused=False, eoffset_enabled=False,
    )
    base.update(over)
    return MachineState(**base)


class TestCoverage(unittest.TestCase):
    def test_command_set_was_actually_parsed(self):
        # Guard: a broken source parse must not let the coverage checks pass
        # vacuously on an empty set. Both ladders must have been found.
        self.assertGreater(len(DISPATCHED_COMMANDS), 40)
        self.assertGreater(len(INLINE_COMMANDS), 8)

    def test_every_command_is_gated_or_read_only(self):
        # Covers BOTH dispatch paths — the inline recv-loop ladder included.
        for cmd in ALL_HANDLED_COMMANDS:
            self.assertTrue(
                cmd in COMMAND_GATES or cmd in READ_ONLY_COMMANDS or cmd in INLINE_EXEMPT,
                f"command {cmd!r} has no policy gate, is not read-only, and is not "
                f"an explained INLINE_EXEMPT — a new command may not land ungated",
            )

    def test_no_stale_gate_entries(self):
        # Catch a gate entry for a command the gateway no longer handles.
        for cmd in COMMAND_GATES:
            self.assertIn(cmd, ALL_HANDLED_COMMANDS, f"stale gate for {cmd!r}")

    def test_no_stale_inline_exemptions(self):
        # An exemption for a command that no longer exists (or that moved behind
        # the dispatch boundary and is now properly gated) must not linger.
        for cmd in INLINE_EXEMPT:
            self.assertIn(cmd, INLINE_COMMANDS, f"stale INLINE_EXEMPT for {cmd!r}")

    def test_inline_exemptions_are_not_also_gated(self):
        # A command cannot be both "needs no gate" and gated — that ambiguity is
        # how the four escapees hid. `arm` is the deliberate exception: it is
        # handled inline AND carries an 'always' gate for the dispatched path.
        for cmd in INLINE_EXEMPT:
            self.assertNotIn(cmd, COMMAND_GATES,
                             f"{cmd!r} is both INLINE_EXEMPT and gated — pick one")

    def test_gates_reference_real_permission_classes(self):
        valid = set(evaluate_permissions(state()).keys())
        for cmd, gate in COMMAND_GATES.items():
            self.assertIn(gate, valid, f"{cmd!r} -> unknown gate {gate!r}")


class TestPermissionPort(unittest.TestCase):
    """Spot-check the port matches permissions.ts semantics."""

    def test_disconnected_allows_only_unconditional(self):
        p = evaluate_permissions(state(armed=False))
        self.assertFalse(p["ready"])
        self.assertFalse(p["safety"])
        self.assertTrue(p["always"])

    def test_base_requires_armed_estop_enabled(self):
        self.assertFalse(evaluate_permissions(state(is_enabled=False))["ready"])
        self.assertFalse(evaluate_permissions(state(is_estop=True))["ready"])

    def test_ready_needs_homed_and_idle(self):
        self.assertTrue(evaluate_permissions(state())["ready"])
        self.assertFalse(evaluate_permissions(state(is_homed=False))["ready"])
        self.assertFalse(evaluate_permissions(state(is_idle=False))["ready"])

    def test_eoffset_blocks_probe_and_zero_only(self):
        p = evaluate_permissions(state(eoffset_enabled=True))
        self.assertFalse(p["probe"])
        self.assertFalse(p["zero"])
        self.assertTrue(p["ready"])  # ready is NOT eoffset-gated

    def test_pause_resume_are_mutually_exclusive(self):
        running = evaluate_permissions(state(is_idle=False, is_running=True))
        self.assertTrue(running["pause"])
        self.assertFalse(running["resume"])
        paused = evaluate_permissions(state(is_idle=False, is_paused=True))
        self.assertTrue(paused["resume"])
        self.assertFalse(paused["pause"])

    def test_safety_works_during_estop(self):
        # Machine On/Off must be reachable to clear estop flows; safety drops the
        # enabled/idle terms.
        self.assertTrue(evaluate_permissions(state(is_enabled=False))["safety"])


class TestCheckCommand(unittest.TestCase):
    def test_cycle_start_blocked_unhomed(self):
        self.assertIsNotNone(check_command("cycle_start", state(is_homed=False)))
        self.assertIn("homed", check_command("cycle_start", state(is_homed=False)).lower())

    def test_cycle_start_allowed_when_ready(self):
        self.assertIsNone(check_command("cycle_start", state()))

    def test_mdi_blocked_while_running(self):
        self.assertIsNotNone(check_command("mdi", state(is_idle=False, is_running=True)))

    def test_jog_stop_always_allowed(self):
        # Even fully disarmed / estopped — stopping must never be policy-denied.
        self.assertIsNone(check_command("jog_stop", state(armed=False, is_estop=True)))
        self.assertIsNone(check_command("jog_stop_multi", state(armed=False)))

    def test_jog_blocked_unhomed(self):
        self.assertIsNotNone(check_command("jog_cont", state(is_homed=False)))

    def test_touchoff_blocked_with_eoffset(self):
        r = check_command("set_wcs", state(eoffset_enabled=True))
        self.assertIsNotNone(r)
        self.assertIn("compensation", r.lower())

    def test_tool_table_edit_needs_idle_not_enabled(self):
        # setup gate: armed + !estop + idle, but NOT machine-on.
        self.assertIsNone(check_command("save_tool", state(is_enabled=False)))
        self.assertIsNotNone(check_command("save_tool", state(is_idle=False, is_running=True)))

    # ---- commands rescued from the inline ladder (2026-08-20) ----
    # Until then these were authorized by `armed` alone and never reached
    # check_command at all. A direct websocket client could enable machine-Z
    # compensation on an unhomed or running machine.

    def test_set_compensation_blocked_unhomed_and_while_running(self):
        r = check_command("set_compensation", state(is_homed=False))
        self.assertIsNotNone(r)
        self.assertIn("homed", r.lower())
        self.assertIsNotNone(check_command("set_compensation", state(is_idle=False, is_running=True)))
        self.assertIsNone(check_command("set_compensation", state()))

    def test_set_compensation_still_allowed_while_eoffset_active(self):
        # The toggle must be usable in the DISABLE direction once compensation
        # is on, so its gate must NOT carry _R_NO_EOFFSET (that is why it is
        # `ready` and not `probe`/`zero`).
        self.assertIsNone(check_command("set_compensation", state(eoffset_enabled=True)))

    def test_set_compensation_method_blocked_while_eoffset_active(self):
        # Changing interpolation method under a live Z shim: `probe` gate.
        r = check_command("set_compensation_method", state(eoffset_enabled=True))
        self.assertIsNotNone(r)
        self.assertIn("compensation", r.lower())

    def test_confirm_tool_change_survives_pause_and_run(self):
        # Its real precondition is a PENDING request (handler-side
        # require_tool_change_pending), not machine state — the operation must
        # stay available while a program is paused at M6.
        self.assertIsNone(check_command("confirm_tool_change", state(is_idle=False, is_running=True)))
        self.assertIsNone(check_command("confirm_tool_change", state(is_paused=True)))
        self.assertIsNotNone(check_command("confirm_tool_change", state(armed=False)))

    def test_simulate_probe_trip_requires_armed_only(self):
        # Gating it on idle/ready would break its only purpose: exercising a
        # probe cycle's reaction WHILE that cycle runs.
        self.assertIsNone(check_command("simulate_probe_trip", state(is_idle=False, is_running=True)))
        self.assertIsNotNone(check_command("simulate_probe_trip", state(armed=False)))

    def test_not_armed_reason(self):
        self.assertEqual(check_command("cycle_start", state(armed=False)), "Not armed")

    def test_unknown_command_not_policy_denied(self):
        self.assertIsNone(check_command("totally_made_up", state(armed=False)))

    def test_read_only_not_policy_denied(self):
        self.assertIsNone(check_command("get_tool_table", state(armed=False)))

    def test_machine_on_blocked_in_estop(self):
        self.assertIsNotNone(check_command("machine_on", state(is_estop=True)))


class TestSingleSource(unittest.TestCase):
    """#6: the decision (evaluate_permissions) and the deny message
    (check_command) both derive from GATE_REQUIREMENTS — no parallel chain."""

    def test_every_command_gate_has_requirements(self):
        # check_command indexes GATE_REQUIREMENTS[gate]; a missing entry would
        # KeyError at runtime.
        for cmd, gate in COMMAND_GATES.items():
            self.assertIn(gate, GATE_REQUIREMENTS, f"{cmd!r} -> {gate!r} missing")

    def test_evaluate_permissions_keys_match_requirements(self):
        self.assertEqual(set(evaluate_permissions(state()).keys()),
                         set(GATE_REQUIREMENTS.keys()))

    def test_disarmed_denies_with_first_requirement_message(self):
        # Every gated command denies when disarmed, reporting the table's first
        # requirement message; 'always' commands are never denied.
        for cmd, gate in COMMAND_GATES.items():
            r = check_command(cmd, state(armed=False))
            if gate == "always":
                self.assertIsNone(r, f"{cmd!r} should be unconditional")
            else:
                self.assertEqual(r, "Not armed", f"{cmd!r}")

    def test_deny_message_names_a_genuinely_unmet_requirement(self):
        # For a denied command, the returned message must be one of that gate's
        # requirement messages (so the message can't drift from the decision).
        denied = check_command("set_wcs", state(eoffset_enabled=True))  # probe gate
        msgs = [m for _ok, m in GATE_REQUIREMENTS["probe"]]
        self.assertIn(denied, msgs)


class TestPayloadSchema(unittest.TestCase):
    """#27: bounds come from what the machine declares, not from literals."""

    LIM = MachineLimits(
        n_axes=5, n_joints=5, max_jog_velocity=50.0, max_spindle_speed=3000.0,
        max_feed_override=1.5, min_spindle_override=0.5, max_spindle_override=1.2,
        max_linear_velocity=100.0, declared_vars=frozenset({3014, 3100, 3101, 5221}),
    )

    def _reject(self, cmd, payload):
        with self.assertRaises(ValueError) as cm:
            validate_payload(cmd, payload, self.LIM)
        return str(cm.exception)

    # ---- the holes this table exists to close ----

    def test_infinite_wcs_word_rejected(self):
        # Shipped `G10 L2 P1 Xinf` into the MDI before #27.
        self.assertIn("finite", self._reject("set_wcs", {"x": float("inf")}))
        self.assertIn("finite", self._reject("set_wcs", {"r": float("nan")}))

    def test_axis_and_joint_indices_bounded_by_the_machine(self):
        self.assertIn("maximum 4", self._reject("jog_cont", {"axis": 7}))
        self.assertIn("maximum 4", self._reject("home", {"joint": 99}))
        # -1 is the documented "all joints" sentinel and must survive.
        self.assertEqual(validate_payload("home", {"joint": -1}, self.LIM), {})

    def test_jog_multi_axes_list_is_capped(self):
        # Each entry issues a CMD.jog under the command lock — an uncapped list
        # is an unbounded loop holding it.
        self.assertIn("maximum", self._reject("jog_cont_multi", {"axes": [0] * 10_000}))

    def test_mdi_length_rejected_not_truncated(self):
        msg = self._reject("mdi", {"text": "G1 X1 " * 60})
        self.assertIn("truncates", msg)

    def test_compensation_method_is_a_closed_set(self):
        self.assertIn("not one of", self._reject("set_compensation_method", {"method": 9}))
        self.assertEqual(validate_payload("set_compensation_method", {"method": 1}, self.LIM), {})

    # ---- continuous inputs clamp and report; structural ones reject ----

    def test_override_clamped_to_ini_ceiling_not_a_literal(self):
        # The handler hardcoded 2.0; this machine's builder declared 1.5.
        self.assertEqual(validate_payload("set_feed_override", {"scale": 2.0}, self.LIM),
                         {"scale": 1.5})

    def test_negative_spindle_speed_clamps_to_zero_not_reverse(self):
        self.assertEqual(validate_payload("spindle_forward", {"speed": -500}, self.LIM),
                         {"speed": 0})

    def test_in_range_values_are_left_alone(self):
        self.assertEqual(validate_payload("set_feed_override", {"scale": 1.2}, self.LIM), {})
        self.assertEqual(validate_payload("jog_cont", {"axis": 2, "vel": 10.0}, self.LIM), {})

    def test_absent_fields_are_not_invented(self):
        # The handler's own default applies; the schema must not fabricate one.
        self.assertEqual(validate_payload("jog_cont", {}, self.LIM), {})
        self.assertEqual(validate_payload("mdi", {"text": None}, self.LIM), {})

    def test_unschemad_command_passes_through(self):
        # The table CONSTRAINS; it does not enumerate.
        self.assertEqual(validate_payload("estop", {"anything": 1}, self.LIM), {})

    # ---- set_probe_vars: machine-declared, system space denied ----

    def test_system_parameter_space_denied_even_when_declared(self):
        # 5221 IS in this machine's var file (WCS offsets are persistent) and
        # must still be refused — G10 L2 owns it.
        msg = self._reject("set_probe_vars", {"vars": {"5221": 1.0}})
        self.assertIn("reserved system parameter space", msg)
        self.assertIn("reserved", self._reject("set_probe_vars", {"vars": {"5": 1.0}}))

    def test_undeclared_var_rejected_with_actionable_message(self):
        msg = self._reject("set_probe_vars", {"vars": {"3200": 1.0}})
        self.assertIn("not in this machine's var file", msg)

    def test_declared_probe_var_accepted(self):
        self.assertEqual(
            validate_payload("set_probe_vars", {"vars": {"3100": 10.0, "3014": 99}}, self.LIM),
            {})

    def test_unreadable_var_file_still_denies_system_space(self):
        # declared_vars=None (var file unreadable): the machine-declared check
        # cannot run, but the system-range deny is unconditional.
        lim = MachineLimits(declared_vars=None)
        with self.assertRaises(ValueError):
            validate_payload("set_probe_vars", {"vars": {"5221": 1.0}}, lim)
        self.assertEqual(validate_payload("set_probe_vars", {"vars": {"3200": 1.0}}, lim), {})

    # ---- the table itself ----

    def test_no_stale_schema_entries(self):
        for cmd in COMMAND_SCHEMA:
            self.assertIn(cmd, ALL_HANDLED_COMMANDS, f"schema for unhandled {cmd!r}")

    def test_schema_commands_are_gated(self):
        # A bounds-checked command that nothing authorizes would be a gap.
        for cmd in COMMAND_SCHEMA:
            self.assertIn(cmd, COMMAND_GATES, f"{cmd!r} has bounds but no gate")

    def test_undeclared_bounds_degrade_to_type_check_only(self):
        # An INI that declares nothing must not crash the pass or invent limits.
        empty = MachineLimits()
        self.assertEqual(validate_payload("jog_cont", {"axis": 3, "vel": 1e6}, empty), {})
        self.assertIn("finite", str(self._reject_with("set_wcs", {"x": float("inf")}, empty)))

    def _reject_with(self, cmd, payload, limits):
        with self.assertRaises(ValueError) as cm:
            validate_payload(cmd, payload, limits)
        return cm.exception


class TestNoBarePayloadCasts(unittest.TestCase):
    """#9: every numeric coercion of a websocket command field must go through
    finite_int/finite_float (which reject NaN/Inf/missing/out-of-range and feed
    the bounded-error dispatch boundary). A bare int(msg...)/float(msg...)
    reintroduces the OverflowError + silent-Inf hazards this branch closed —
    fail if one slips back in. finite_int/finite_float are NOT matched (no word
    boundary before 'int'/'float' in 'finite_int'/'finite_float')."""

    def test_no_bare_int_or_float_on_command_payload(self):
        src = _gateway_src()
        bad = re.findall(r"\b(?:int|float)\((?:msg|entry)\b", src)
        self.assertEqual(bad, [], f"bare payload casts — use finite_int/finite_float: {bad}")

    def test_no_bare_cast_of_payload_derived_local(self):
        """The direct-cast check above only matches the literal names `msg` and
        `entry`, so a value laundered through a local escaped it:

            val = msg.get(axis)
            parts.append(f"{axis.upper()}{float(val):.6f}")   # shipped Xinf

        Three such sites existed (set_wcs twice, set_probe_vars once) and put
        `G10 L2 P1 Xinf` on the MDI and arbitrary `#N=inf` into the parameter
        file. Catch the shape: a bare cast of any short local inside the command
        dispatch, where every numeric coercion must be finite_*."""
        body = _function_body(_gateway_src(), "async def _handle_command_impl")
        found = set(re.findall(
            r"[^_\w]((?:int|float)\([a-z_][a-z0-9_]{0,12})[\)\.,\[]", body))
        # Casts of values that are NOT payload-derived are legitimate. Naming
        # them keeps this honest rather than making the regex cleverer — adding
        # a name here is a claim that the value came from STAT or the INI, not
        # from the websocket.
        ALLOWED = {
            "int(raw",      # safe_get("tool_in_spindle") — from STAT
            "int(current",  # current tool/pocket read back from the tool table
        }
        self.assertEqual(
            sorted(found - ALLOWED), [],
            "bare cast of a payload-derived local inside the dispatch — use "
            "finite_int/finite_float, or add the name to ALLOWED with a reason")


if __name__ == "__main__":
    unittest.main()
