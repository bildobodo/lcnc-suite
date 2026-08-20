"""Unit tests for command_policy — the pure, linuxcnc-free backend authz policy
(issue #19). Run via ``python3 -m unittest test_command_policy`` or pytest.
"""

import re
import unittest
from pathlib import Path

from command_policy import (
    MachineState,
    evaluate_permissions,
    check_command,
    COMMAND_GATES,
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


class TestNoBarePayloadCasts(unittest.TestCase):
    """#9: every numeric coercion of a websocket command field must go through
    finite_int/finite_float (which reject NaN/Inf/missing/out-of-range and feed
    the bounded-error dispatch boundary). A bare int(msg...)/float(msg...)
    reintroduces the OverflowError + silent-Inf hazards this branch closed —
    fail if one slips back in. finite_int/finite_float are NOT matched (no word
    boundary before 'int'/'float' in 'finite_int'/'finite_float')."""

    def test_no_bare_int_or_float_on_command_payload(self):
        src = (Path(__file__).resolve().parent / "gateway.py").read_text(encoding="utf-8")
        bad = re.findall(r"\b(?:int|float)\((?:msg|entry)\b", src)
        self.assertEqual(bad, [], f"bare payload casts — use finite_int/finite_float: {bad}")


if __name__ == "__main__":
    unittest.main()
