"""The payload contract (package 3a, SYS-CONN.S5 + issue #27; Codex R363–R365).

Every command field the gateway reads has ONE rule in command_policy's
COMMAND_SCHEMA: a required field missing, any field null (touchoff.expect's
two leaves excepted), the wrong type and a value outside its range are
refused — through the REAL dispatch, before any controller write (a mode
switch, an MDI, a parameter write) and before any booking. The stops are the
other direction: their payload is never a reason to refuse — a fault widens
them. A frame the reader cannot handle is answered, and the same socket reads
on.

    .venv/bin/python3 -m pytest -q test_payload_contract.py
"""
import json
import time
import unittest
import unittest.mock

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()   # MUST precede `import gateway`
import gateway  # noqa: E402
import command_policy as cp  # noqa: E402
from gateway_util import step_span_refusal, STEP_TRAVEL_UNKNOWN, axis_joint_rows, limit_span  # noqa: E402
from link_fixture import connect_fake, current  # noqa: E402
from test_button_gates import controller_reads  # noqa: E402
from test_command_dispatch import _RecordingCmd, _payload, _run  # noqa: E402

LIMITS = cp.MachineLimits(n_axes=3, n_joints=3, max_jog_velocity=50.0, max_spindle_speed=3000.0,
                          max_feed_override=1.5, min_spindle_override=0.5, max_spindle_override=1.2,
                          max_linear_velocity=100.0, declared_vars=frozenset({3014, 3100, 3054}))

# One VALID payload per command with a required field — the table the probes
# below derive their wrong forms from. Held against COMMAND_SCHEMA: a command
# with a required field and no row here fails `test_the_table_covers_the_schema`.
VALID = {
    "jog_cont": {"axis": 0, "vel": 10.0},
    "jog_incr": {"axis": 0, "vel": 10.0, "distance": 1.0},
    "jog_stop": {"axis": 0},
    "jog_cont_multi": {"axes": [{"axis": 0, "vel": 10.0}]},
    "jog_incr_multi": {"axes": [{"axis": 0, "vel": 10.0, "distance": 1.0}]},
    "jog_stop_multi": {"axes": [0]},
    "home": {"axis": 1},
    "unhome": {"axis": 1},
    "spindle_forward": {"speed": 1000.0},
    "spindle_reverse": {"speed": 1000.0},
    "set_feed_override": {"scale": 1.0},
    "set_spindle_override": {"scale": 1.0},
    "set_rapid_override": {"scale": 1.0},
    "set_max_velocity": {"velocity": 50.0},
    "set_optional_stop": {"value": True},
    "set_block_delete": {"value": True},
    "set_mode": {"mode": 1},
    "auto_run": {"line": 0, "file": "/p.ngc", "version": 3, "source": "a" * 64},
    "mdi": {"text": "G0 X1"},
    "run_macro": {"name": "m", "revision": "0" * 64},
    "set_wcs": {"target": "G54", "x": 1.0},
    "clear_wcs": {"target": "G55"},
    "touchoff": {"axes": {"X": 1.0}},
    "set_kins_mode": {"mode": 0},
    "save_tool": {"tool_number": 5},
    "add_tool": {"tool_number": 5},
    "delete_tool": {"tool_number": 5},
    "renumber_tool": {"old_tool_number": 5, "tool_number": 6},
    "tool_change": {"tool_number": 5},
    "tool_measure": {"tool": 5},
    "set_compensation": {"enable": True},
    "set_compensation_method": {"method": 1},
    "set_params": {"sets": {"probe": {"3014": 1.0}}},
    "probe_run": {"routine": "probe_x_plus", "vars": {"3014": 1.0}},
    "surface_scan_run": {"vars": {"3054": 5.0}},
    "set_g30": {"values": {"X": 0.0}, "based_on": {"X": 0.0}},
    "load_file": {"path": "/p.ngc"},
}

# the wrong forms of a field, by its spec — a boolean and a string are never
# a number, 1.5 is no integer, "false" is no switch
WRONG = {cp.Num: [True, "1"], cp.Enum: [True, 1.5, "1"], cp.Flag: ["false", 0, 1, "true"],
         cp.Seq: [{}, "x"], cp.Text: [5, ["x"]], cp.Choice: [5, ["x"], "nope"],
         cp.AxisMap: [[], "x", {}], cp.VarNumbers: [[], "x"], cp.PurposeSets: [[], "x"]}

# A valid 0 / false stays valid and unchanged (N4)
ZERO_TWINS = [("jog_cont", "vel", 0.0), ("jog_incr", "vel", 0.0), ("spindle_forward", "speed", 0),
              ("set_max_velocity", "velocity", 0.0), ("set_feed_override", "scale", 0.0),
              ("set_block_delete", "value", False), ("set_optional_stop", "value", False),
              ("tool_change", "tool_number", 0), ("set_kins_mode", "mode", 0), ("auto_run", "line", 0)]


#: the required fields the schema names (46 at 3543b20d) — a floor, so a
#: schema without `required` (the base before package 3a) cannot pass the
#: table probes vacuously (the red check found exactly that)
MIN_REQUIRED = 40


def _required_fields():
    found = [(cmd, field, spec) for cmd, schema in cp.COMMAND_SCHEMA.items()
             for field, spec in schema.items() if getattr(spec, "required", False)]
    assert len(found) >= MIN_REQUIRED, f"only {len(found)} required fields — the probes would pass vacuously"
    return found


class TestTheSchemaTable(unittest.TestCase):
    def test_the_table_covers_the_schema(self):
        missing = sorted({cmd for cmd, _f, _s in _required_fields()} - set(VALID))
        self.assertEqual(missing, [], "a command with a required field needs its VALID row")
        for cmd, payload in VALID.items():
            self.assertEqual(cp.validate_payload(cmd, payload, LIMITS), {}, (cmd, payload))

    def test_every_gated_command_has_an_entry(self):
        self.assertEqual(sorted(set(cp.COMMAND_GATES) - set(cp.COMMAND_SCHEMA)), [])
        # the read-only queries too — two of them reach the handler groups after the check
        self.assertEqual(sorted(set(cp.READ_ONLY_COMMANDS) - set(cp.COMMAND_SCHEMA)), [])

    def test_an_unknown_command_is_refused_not_passed(self):
        with self.assertRaisesRegex(ValueError, "unknown command"):
            cp.validate_payload("no_such_command", {}, LIMITS)

    def test_each_required_field_refuses_missing_null_and_its_wrong_forms(self):
        for cmd, field, spec in _required_fields():
            base = VALID[cmd]
            forms = [("missing", None)] + [("null", None)] + [("wrong", w) for w in WRONG.get(type(spec), [])]
            for kind, value in forms:
                payload = {k: v for k, v in base.items() if k != field}
                if kind != "missing":
                    payload[field] = value
                with self.subTest(cmd=cmd, field=field, kind=kind, value=value):
                    with self.assertRaises(ValueError):
                        cp.validate_payload(cmd, payload, LIMITS)

    def test_the_valid_zero_and_false_twins_arrive(self):
        for cmd, field, value in ZERO_TWINS:
            with self.subTest(cmd=cmd, field=field):
                cp.validate_payload(cmd, {**VALID[cmd], field: value}, LIMITS)

    def test_native_integer_ranges_at_both_limits_and_one_past(self):
        cases = [("auto_run", "line", 0, cp.INT_MAX), ("auto_run", "version", 0, cp.SAFE_INT_MAX),
                 ("tool_change", "tool_number", 0, cp.TOOL_NUMBER_MAX),
                 ("tool_measure", "tool", 1, cp.TOOL_NUMBER_MAX), ("save_tool", "pocket", 0, cp.TOOL_NUMBER_MAX),
                 ("home", "axis", 0, LIMITS.n_axes - 1), ("jog_cont", "axis", 0, LIMITS.n_axes - 1)]
        for cmd, field, lo, hi in cases:
            with self.subTest(cmd=cmd, field=field):
                for ok in (lo, hi):
                    cp.validate_payload(cmd, {**VALID[cmd], field: ok}, LIMITS)
                for bad in (lo - 1, hi + 1):
                    with self.assertRaises(ValueError):
                        cp.validate_payload(cmd, {**VALID[cmd], field: bad}, LIMITS)

    def test_an_integer_past_2_53_is_compared_without_float(self):
        # 2**53 + 1 rounds to 2**53 through float: an exact comparison refuses it
        with self.assertRaises(ValueError):
            cp.validate_payload("auto_run", {**VALID["auto_run"], "version": cp.SAFE_INT_MAX + 2}, LIMITS)

    def test_present_optional_and_nested_values_are_judged(self):
        bad = [("auto_run", {"pre_tool": True}), ("auto_run", {"pre_tool": cp.TOOL_NUMBER_MAX + 1}),
               ("auto_run", {"spindle_dir": "fwd"}), ("auto_run", {"spindle_speed": None}),
               ("auto_run", {"safe_z": "false"}), ("auto_run", {"entry_x": None}),
               ("auto_run", {"entry_wcs": "G60"}), ("auto_run", {"entry_units": "mm"}),
               ("auto_run", {"probe_vars": {"3100": None}}),
               ("run_macro", {"args": [None]}), ("run_macro", {"args": [True]}), ("run_macro", {"args": ["1"]}),
               ("mdi", {"vars": {"3014": None}}), ("mdi", {"vars": {"3014": "1"}}),
               ("probe_run", {"vars": {"3014": None}}), ("surface_scan_run", {"vars": {"3054": True}}),
               ("set_params", {"sets": {"probe": {"3014": "1"}}}), ("set_params", {"sets": {"probe": {"3014": None}}}),
               ("jog_cont_multi", {"axes": [{"axis": 0}]}), ("jog_cont_multi", {"axes": [{"axis": 0, "vel": None}]}),
               ("jog_cont_multi", {"axes": [None]}), ("jog_cont_multi", {"axes": [{"axis": 9, "vel": 1.0}]}),
               ("jog_incr_multi", {"axes": [{"axis": 0, "vel": 1.0}]}),
               ("touchoff", {"axes": {"X": None}}), ("touchoff", {"axes": {"X": True}}),
               ("set_wcs", {"x": True}), ("set_wcs", {"x": None}), ("set_g30", {"values": {"X": None}}),
               ("save_tool", {"z_offset": None}), ("save_tool", {"remark": None}), ("save_tool", {"diameter": None}),
               ("renumber_tool", {"z_offset": None}), ("add_tool", {"remark": 5}),
               ("confirm_tool_change", {"request": True}), ("set_mode", {"mode": 2.0})]
        for cmd, over in bad:
            with self.subTest(cmd=cmd, over=over):
                with self.assertRaises(ValueError):
                    cp.validate_payload(cmd, {**VALID.get(cmd, {}), **over}, LIMITS)

    def test_touchoff_expect_null_is_the_one_null_admitted(self):
        """VM363-02: a leaf null = no claim for that dimension; the object
        itself null, a missing or unknown key, a wrong known form refused."""
        ok = [{"kins_type": None, "g5x_index": 1}, {"kins_type": 0, "g5x_index": None},
              {"kins_type": 2, "g5x_index": 6}, {"kins_type": None, "g5x_index": None}]
        for e in ok:
            cp.validate_payload("touchoff", {"axes": {"X": 1.0}, "expect": e}, LIMITS)
        bad = [None, {}, {"kins_type": 0}, {"kins_type": 0, "g5x_index": 1, "x": 1},
               {"kins_type": True, "g5x_index": 1}, {"kins_type": 0, "g5x_index": 1.5},
               {"kins_type": 3, "g5x_index": 1}, {"kins_type": 0, "g5x_index": 10}]
        for e in bad:
            with self.subTest(expect=e):
                with self.assertRaises(ValueError):
                    cp.validate_payload("touchoff", {"axes": {"X": 1.0}, "expect": e}, LIMITS)

    def test_clear_wcs_takes_all_reserved_or_a_fixture_never_an_implicit_active(self):
        for t in ("all", "reserved", "G54", "G59.3"):
            cp.validate_payload("clear_wcs", {"target": t}, LIMITS)
        for t in ("active", None, 1, ["G54"]):
            with self.subTest(target=t):
                with self.assertRaises(ValueError):
                    cp.validate_payload("clear_wcs", {"target": t}, LIMITS)


class TestStopsAreWidenedNeverRefused(unittest.TestCase):
    def test_an_invalid_via_is_dropped_from_every_stop(self):
        for cmd in sorted(cp.STOP_COMMANDS):
            payload = {**VALID.get(cmd, {}), "via": "keyboard"}
            out, fault, stop_all = cp.widen_stop(cmd, payload, LIMITS)
            with self.subTest(cmd=cmd):
                self.assertNotIn("via", out)
                self.assertIn("via", fault)
                self.assertFalse(stop_all)

    def test_a_jog_stop_whose_target_fails_stops_every_booked_jog(self):
        for cmd, payload in [("jog_stop", {}), ("jog_stop", {"axis": None}), ("jog_stop", {"axis": True}),
                             ("jog_stop", {"axis": 9}), ("jog_stop_multi", {}), ("jog_stop_multi", {"axes": None}),
                             ("jog_stop_multi", {"axes": [0, None]}), ("jog_stop_multi", {"axes": "x"})]:
            with self.subTest(cmd=cmd, payload=payload):
                _out, fault, stop_all = cp.widen_stop(cmd, payload, LIMITS)
                self.assertTrue(fault)
                self.assertTrue(stop_all)

    def test_a_valid_stop_keeps_its_target_and_an_empty_list_names_nothing(self):
        self.assertEqual(cp.widen_stop("jog_stop", {"axis": 1}, LIMITS), ({"axis": 1}, None, False))
        self.assertEqual(cp.widen_stop("jog_stop_multi", {"axes": []}, LIMITS), ({"axes": []}, None, False))

    def test_the_gateway_stop_set_is_the_policy_set(self):
        self.assertIs(gateway._WS_STOP_CMDS, cp.STOP_COMMANDS)


class _Dispatch(unittest.TestCase):
    """The REAL handle_command on a ready machine with a recording CMD: a
    refused payload leaves zero controller calls — mode included — and
    nothing booked."""

    def setUp(self):
        self.cmd = _RecordingCmd()
        connect_fake(self, cmd=self.cmd)
        controller_reads(current().stat, task_mode=None)
        saved = gateway._machine_limits
        gateway._machine_limits = LIMITS
        self.addCleanup(lambda: setattr(gateway, "_machine_limits", saved))
        jogs = dict(gateway._active_jogs)
        self.addCleanup(lambda: (gateway._active_jogs.clear(), gateway._active_jogs.update(jogs)))
        gateway._active_jogs.clear()
        claims = list(gateway._source_claims)
        self.addCleanup(lambda: gateway._source_claims.__setitem__(slice(None), claims))
        gateway._source_claims.clear()

    def send(self, msg, armed=True):
        # a machine every gate admits — standing, its fixture read — so a
        # refusal here is the PAYLOAD's (the gate runs first in the dispatch)
        gateway._shared_status = _payload(inpos=True, current_vel=0.0, g5x_index=1)
        return _run(gateway.handle_command(msg, armed))

    def booked(self):
        return (dict(gateway._active_jogs), list(gateway._source_claims))


class TestRefusedBeforeAnyWrite(_Dispatch):
    def test_every_required_field_fault_writes_nothing_and_books_nothing(self):
        for cmd, field, spec in _required_fields():
            if cmd in cp.STOP_COMMANDS:
                continue                      # widened, below
            for kind, value in [("missing", None), ("null", None)] + [("wrong", w) for w in WRONG.get(type(spec), [])[:1]]:
                payload = {"cmd": cmd, **{k: v for k, v in VALID[cmd].items() if k != field}}
                if kind != "missing":
                    payload[field] = value
                with self.subTest(cmd=cmd, field=field, kind=kind):
                    self.cmd.calls.clear()
                    before = self.booked()
                    r = self.send(payload)
                    self.assertFalse(r["ok"], r)
                    self.assertTrue(r["error"].startswith(f"{cmd}: "), r)
                    self.assertEqual(self.cmd.calls, [], "a refused payload reached the controller")
                    self.assertEqual(self.booked(), before, "a refused payload booked something")

    def test_the_old_defaults_act_no_more(self):
        """The R363 candidates A, by their old effect: home without joint was
        Home All, clear_wcs without target zeroed the active offset, an
        override without scale went to 100 %, "false" switched block delete
        ON — each now refused with nothing sent."""
        for msg in ({"cmd": "home"}, {"cmd": "unhome"}, {"cmd": "clear_wcs"}, {"cmd": "set_feed_override"},
                    {"cmd": "set_block_delete", "value": "false"}, {"cmd": "set_optional_stop", "value": "false"},
                    {"cmd": "spindle_forward"}, {"cmd": "set_max_velocity"}, {"cmd": "jog_cont", "axis": 0},
                    {"cmd": "jog_cont_multi"}, {"cmd": "auto_run", "file": "/p.ngc", "version": 1, "source": "x"},
                    {"cmd": "save_tool", "tool_number": 5, "z_offset": None},
                    {"cmd": "mdi", "text": "O<x> CALL", "vars": {"3014": None}},
                    {"cmd": "tool_change", "tool_number": False}, {"cmd": "set_mode", "mode": True}):
            with self.subTest(msg=msg):
                self.cmd.calls.clear()
                r = self.send(msg)
                self.assertFalse(r["ok"], r)
                self.assertEqual(self.cmd.calls, [])

    def test_a_valid_twin_still_reaches_the_controller(self):
        self.cmd.calls.clear()
        r = self.send({"cmd": "set_block_delete", "value": False})
        self.assertTrue(r["ok"], r)
        self.assertIn("set_block_delete", [n for n, _a, _k in self.cmd.calls])
        self.cmd.calls.clear()
        r = self.send({"cmd": "spindle_forward", "speed": 0})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.cmd.args_of("spindle")[1], 0)


class TestTheQueriesStillAnswer(_Dispatch):
    def test_the_read_only_queries_handled_after_the_check_answer(self):
        """R366, before the merge: get_wcs_table and list_probe_macros reach
        the handler groups AFTER validate_payload — without a schema entry the
        dispatch refused them as unknown commands."""
        for cmd in ("get_wcs_table", "list_probe_macros"):
            with self.subTest(cmd=cmd):
                r = self.send({"cmd": cmd}, armed=False)
                self.assertTrue(r.get("ok"), r)


class TestStopsThroughTheDispatch(_Dispatch):
    def test_estop_and_abort_with_a_bad_via_still_stop(self):
        r = self.send({"cmd": "abort", "via": "keyboard"}, armed=False)
        self.assertTrue(r["ok"], r)
        self.assertIn("abort", [n for n, _a, _k in self.cmd.calls])

    def test_a_malformed_jog_stop_stops_every_booked_jog_gatewayweit(self):
        """Q363-3: two jogs booked (from any client — the booking is the
        gateway's), a jog_stop without its axis stops both."""
        sent = []

        async def stop(axis):
            sent.append(axis)
            gateway._active_jogs.pop(axis, None)
        with unittest.mock.patch.object(gateway, "_send_jog_stop", stop), \
                unittest.mock.patch.object(gateway, "_auto_running", lambda: False):
            gateway._active_jogs.update({0: (0, 0), 2: (0, 2)})
            r = self.send({"cmd": "jog_stop"}, armed=False)
            self.assertTrue(r["ok"], r)
            self.assertEqual(sorted(sent), [0, 2])
            sent.clear()
            gateway._active_jogs.update({1: (0, 1)})
            r = self.send({"cmd": "jog_stop_multi", "axes": [1, None]}, armed=False)
            self.assertTrue(r["ok"], r)
            self.assertEqual(sent, [1])

    def test_a_valid_jog_stop_keeps_its_target(self):
        sent = []

        async def stop(axis):
            sent.append(axis)
            gateway._active_jogs.pop(axis, None)
        with unittest.mock.patch.object(gateway, "_send_jog_stop", stop), \
                unittest.mock.patch.object(gateway, "_auto_running", lambda: False):
            gateway._active_jogs.update({0: (0, 0), 2: (0, 2)})
            r = self.send({"cmd": "jog_stop", "axis": 2}, armed=False)
            self.assertTrue(r["ok"], r)
            self.assertEqual(sent, [2])
            self.assertIn(0, gateway._active_jogs)


class TestTheStepJogSpan(unittest.TestCase):
    ROWS = [{"letter": "X", "joint": 0, "joint_span": 100.0, "axis_span": 1000.0},
            {"letter": "Y", "joint": None, "joint_span": None, "axis_span": 500.0}]

    def test_joint_mode_reads_the_joint_teleop_the_axis(self):
        self.assertIsNone(step_span_refusal([(0, 1.0, 50.0)], True, self.ROWS))
        self.assertIn("joint 0", step_span_refusal([(0, 1.0, 200.0)], True, self.ROWS))
        self.assertIsNone(step_span_refusal([(0, 1.0, 200.0)], False, self.ROWS))
        self.assertIn("axis X", step_span_refusal([(0, 1.0, -1200.0)], False, self.ROWS))

    def test_an_unknown_target_or_travel_closes_the_step_but_not_a_continuous_jog(self):
        self.assertEqual(step_span_refusal([(1, 1.0, 1.0)], True, self.ROWS), STEP_TRAVEL_UNKNOWN)
        self.assertEqual(step_span_refusal([(5, 1.0, 1.0)], False, self.ROWS), STEP_TRAVEL_UNKNOWN)
        self.assertIsNone(step_span_refusal([(1, 1.0, None)], True, self.ROWS))

    def test_the_span_of_a_limit_window(self):
        self.assertEqual(limit_span(-0.1, 685.0), 685.1)
        for lo, hi in ((None, 1.0), (1.0, 1.0), (2.0, 1.0), ("x", 1.0), (float("nan"), 1.0)):
            self.assertIsNone(limit_span(lo, hi))

    def test_every_shipped_step_fits_every_shipped_span(self):
        """Q363-1: the strip changes nothing — the built-in steps (≤ 1 mm /
        0.1 in) and each profile's [DISPLAY] INCREMENTS stay under its
        smallest span."""
        import re
        from pathlib import Path
        root = Path(__file__).resolve().parent.parent / "examples/sim_config"
        for ini in sorted(root.glob("lcnc_suite_sim_*.ini")):
            text = ini.read_text()
            m = re.search(r"^INCREMENTS\s*=\s*(.+)$", text, re.M)
            steps = [float(re.sub(r"[a-z]+$", "", t)) for t in m.group(1).split()] if m else []
            steps += [0.001, 0.01, 0.1, 1.0]
            spans, sec, lo = [], None, None
            for line in text.splitlines():
                h = re.match(r"^\[(AXIS_\w|JOINT_\d)\]", line)
                if h:
                    sec, lo = h.group(1), None
                kv = re.match(r"^(MIN|MAX)_LIMIT\s*=\s*(\S+)", line)
                if sec and kv:
                    if kv.group(1) == "MIN":
                        lo = float(kv.group(2))
                    elif lo is not None:
                        spans.append(limit_span(lo, float(kv.group(2))))
            with self.subTest(ini=ini.name):
                self.assertTrue(spans and all(spans))
                self.assertLess(max(steps), min(spans))


class TestTheAxisJointRows(unittest.TestCase):
    def test_the_mapping_needs_no_max_velocity(self):
        rows, why = axis_joint_rows(list("XYZ"), 3, list("XYZ"))
        self.assertIsNone(why)
        self.assertEqual([r["joint"] for r in rows], [0, 1, 2])

    def test_a_swapped_order_a_gantry_and_an_undeclared_one(self):
        self.assertEqual([r["joint"] for r in axis_joint_rows(list("YXZ"), 3, list("XYZ"))[0]], [1, 0, 2])
        rows, _ = axis_joint_rows(list("XYYZ"), 4, list("XYZ"))
        self.assertEqual([r["joint"] for r in rows], [0, None, 3])
        rows, why = axis_joint_rows(None, 3, list("XYZ"))
        self.assertTrue(why and all(r["joint"] is None for r in rows))


class TestReaderFrames(unittest.TestCase):
    """A frame the reader cannot handle is answered — and the SAME socket
    answers the next heartbeat (R363 VM363-03)."""

    def test_each_malformed_frame_keeps_the_socket(self):
        from fastapi.testclient import TestClient
        from test_ws_command_worker import _Harness, _decode
        frames = ["[]", "1", '"x"', json.dumps({"cmd": ["x"]}), json.dumps({"cmd": {"a": 1}}),
                  json.dumps({"cmd": "hello", "session": ["x"], "resume_armed": True}),
                  json.dumps({"cmd": "hello", "session": {"a": 1}, "resume_armed": True}),
                  json.dumps({"cmd": "save_settings", "section": []}),
                  json.dumps({"cmd": "save_settings", "section": {}}),
                  json.dumps({"cmd": "save_settings", "section": "no_such_section"}),
                  json.dumps({"cmd": "client_diag", "data": {"client_id": 7, "tag": "x", "heap": 1}}),
                  json.dumps({"cmd": "timing_log", "enable": "false"}),
                  json.dumps({"cmd": "halshow_live", "on": "false"}),
                  json.dumps({"cmd": "tab_visibility", "hidden": "false"}),
                  json.dumps({"cmd": "device_rename", "name": ["x"]}),
                  json.dumps({"cmd": "safety_trip_ack"}),
                  json.dumps({"cmd": "safety_trip_ack", "id": "nope"})]
        with _Harness():
            with TestClient(gateway.app) as client:
                with client.websocket_connect("/ws") as ws:
                    ws.send_json({"cmd": "hello", "session": "reader", "resume_armed": False})
                    for raw in frames:
                        ws.send_text(raw)
                        ws.send_json({"cmd": "heartbeat"})
                        deadline, pong = time.monotonic() + 5.0, False
                        while time.monotonic() < deadline and not pong:
                            fr = _decode(ws.receive())
                            pong = fr.get("type") == "pong"
                        with self.subTest(frame=raw):
                            self.assertTrue(pong, f"no pong after {raw} — the reader ended")


class TestTheTripAcknowledgementNamesItsTrip(unittest.TestCase):
    def test_only_the_current_trip_id_acknowledges_it(self):
        from fastapi.testclient import TestClient
        from test_ws_command_worker import _Harness, _decode
        saved = (gateway._unacked_trip, gateway._last_trip_ack)
        self.addCleanup(lambda: setattr(gateway, "_unacked_trip", saved[0]) or
                        setattr(gateway, "_last_trip_ack", saved[1]))
        with _Harness():
            with TestClient(gateway.app) as client:
                with client.websocket_connect("/ws") as ws:
                    ws.send_json({"cmd": "hello", "session": "trip", "resume_armed": False})
                    gateway._unacked_trip = {"id": "e1-2", "reason": "heartbeat"}

                    def ack(**kw):
                        ws.send_json({"cmd": "safety_trip_ack", **kw})
                        deadline = time.monotonic() + 5.0
                        while time.monotonic() < deadline:
                            fr = _decode(ws.receive())
                            if fr.get("type") == "reply" and "conn_key" not in fr:
                                return fr
                        raise AssertionError("no reply")
                    for kw in ({}, {"id": "e1-1"}, {"id": None}, {"id": ["e1-2"]}):
                        with self.subTest(kw=kw):
                            r = ack(**kw)
                            self.assertFalse(r["ok"], r)
                            self.assertEqual(gateway._unacked_trip["id"], "e1-2", "the trip stays")
                    r = ack(id="e1-2")
                    self.assertTrue(r["ok"], r)
                    self.assertIsNone(gateway._unacked_trip)
                    self.assertEqual(gateway._last_trip_ack, {"id": "e1-2"})
                    r = ack(id="e1-2")          # a repeat after the acknowledgement: nothing to clear
                    self.assertFalse(r["ok"], r)


class TestArmOnlyByTheLiteralTrue(unittest.TestCase):
    def test_false_strings_and_numbers_disarm(self):
        from fastapi.testclient import TestClient
        from test_ws_command_worker import _Harness, _arm, _drain, _is_reply
        with _Harness():
            with TestClient(gateway.app) as client:
                with client.websocket_connect("/ws") as ws:
                    _arm(ws, "armtrue")
                    for value in ("false", 1, "true", None):
                        with self.subTest(value=value):
                            ws.send_json({"cmd": "arm", "armed": value})
                            frames = _drain(ws, 5.0, 0.5, stop=lambda f: _is_reply(f, "arm"))
                            self.assertIs(frames[-1][1].get("armed"), False, frames[-1][1])
                            _arm(ws, "armtrue")


if __name__ == "__main__":
    unittest.main()


class TestTheStepJogThroughTheDispatch(_Dispatch):
    """VM364-01 / R365: the step's travel by the target it ADDRESSES — the
    mapped joint in joint mode (a homed machine backing off its soft limit),
    the axis in teleop — and the mode confirmed at the controller in the
    jog's own last admission. The probe ties the CMD.jog target to the span."""

    ROWS = [{"letter": L, "joint": j, "reason": None, "max_vel": 20.0, "joint_span": 100.0, "axis_span": 1000.0}
            for j, L in enumerate("XYZ")]

    def setUp(self):
        super().setUp()
        st = current().stat
        st.joints, st.axis_mask, st.homed = 3, 0b111, (1, 1, 1, 0, 0, 0, 0, 0, 0)
        self.flag = 0
        for patch in (unittest.mock.patch.object(gateway, "_axis_joint_map", lambda: {"axes": self.ROWS, "reason": None}),
                      unittest.mock.patch.object(gateway, "_jog_mode_flag", self._flag)):
            patch.start()
            self.addCleanup(patch.stop)

    async def _flag(self):
        return self.flag

    def step(self, distance, beyond=(), mode=None):
        current().stat.motion_mode = mode
        gateway._shared_status = _payload(inpos=True, current_vel=0.0, g5x_index=1, joints_beyond_limit=list(beyond))
        self.cmd.calls.clear()
        return _run(gateway.handle_command({"cmd": "jog_incr", "axis": 0, "vel": 5.0, "distance": distance}, True))

    def jogs(self):
        return [a for n, a, _k in self.cmd.calls if n == "jog"]

    def test_backing_off_a_soft_limit_takes_the_joint_span(self):
        self.flag = 1
        r = self.step(200.0, beyond=["X"], mode=linuxcnc.TRAJ_MODE_FREE)
        self.assertFalse(r["ok"], r)
        self.assertIn("joint 0", r["error"])
        self.assertEqual(self.cmd.calls, [], "refused before any write")
        r = self.step(50.0, beyond=["X"], mode=linuxcnc.TRAJ_MODE_FREE)
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.jogs(), [(linuxcnc.JOG_INCREMENT, 1, 0, 5.0, 50.0)], "the joint, under its span")

    def test_in_teleop_the_axis_span_and_the_canonical_axis(self):
        self.flag = 0
        r = self.step(200.0, mode=linuxcnc.TRAJ_MODE_TELEOP)
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.jogs(), [(linuxcnc.JOG_INCREMENT, 0, 0, 5.0, 200.0)])
        r = self.step(1200.0, mode=linuxcnc.TRAJ_MODE_TELEOP)
        self.assertFalse(r["ok"], r)
        self.assertIn("axis X", r["error"])

    def test_teleop_not_reached_writes_no_jog(self):
        self.flag = 1                            # expected teleop, the helper ends in joint mode
        r = self.step(200.0, mode=linuxcnc.TRAJ_MODE_FREE)
        self.assertEqual(r, {"ok": False, "error": gateway.JOG_MODE_CHANGED})
        self.assertEqual(self.jogs(), [])

    def test_a_mode_change_after_the_match_is_caught_at_the_write(self):
        self.flag = 0                            # the helper says teleop ...
        r = self.step(200.0, mode=linuxcnc.TRAJ_MODE_FREE)   # ... the controller reads free at the write
        self.assertFalse(r["ok"], r)
        self.assertIn("Jog mode changed", r["error"])
        self.assertEqual(self.jogs(), [])

    def test_an_unknown_travel_closes_the_step_but_not_the_continuous_jog(self):
        self.ROWS = [dict(r, axis_span=None) for r in self.ROWS]
        self.flag = 0
        r = self.step(1.0, mode=linuxcnc.TRAJ_MODE_TELEOP)
        self.assertEqual(r, {"ok": False, "error": STEP_TRAVEL_UNKNOWN})
        current().stat.motion_mode = linuxcnc.TRAJ_MODE_TELEOP
        r = _run(gateway.handle_command({"cmd": "jog_cont", "axis": 0, "vel": 5.0}, True))
        self.assertTrue(r["ok"], r)


class TestTheMdiLine(_Dispatch):
    """Codex R366 VM-I11: LinuxCNC takes ONE MDI command of at most 254 BYTES
    (2.9.4 emcmodule.cc: `sizeof(command) - 1`, LINELEN 255) and copies it
    with strcpy — a NUL cuts the line it runs. Every line a payload makes — the raw text, a parameter
    word, a G10, an entry rapid, a touch-off — is judged before the FIRST
    write (the mode switch included); the last write path guards behind."""

    def setUp(self):
        super().setUp()
        # no surface compensation, a fresh reader: the refusal here must be
        # the line's (the eoffset guard runs before it in set_wcs / touchoff)
        p = unittest.mock.patch.object(gateway, "require_no_eoffset", lambda: None)
        p.start()
        self.addCleanup(p.stop)

    def last_mdi(self):
        return [a for n, a, _k in self.cmd.calls if n == "mdi"][-1]

    def test_the_binding_s_own_number_at_the_edge(self):
        """R367: 254 bytes go out unchanged, 255 are refused with nothing
        written — the binding refuses `len > sizeof(command) - 1` = 254 (the
        fake does not mirror it; home_step_live_check.py proves it on the real
        binding); a macro call has the same limit."""
        import macro_files
        self.assertEqual(macro_files.MAX_LINE, cp.MDI_MAX_BYTES)
        edge = "G4 P0 (" + "ä" * 122 + "xx)"           # 254 bytes, 132 characters
        self.assertEqual(len(edge.encode()), 254)
        r = self.send({"cmd": "mdi", "text": edge})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.last_mdi(), (edge,))
        self.cmd.calls.clear()
        r = self.send({"cmd": "mdi", "text": edge[:-1] + "x)"})    # 255 bytes
        self.assertFalse(r["ok"], r)
        self.assertIn("255 bytes", r["error"])
        self.assertEqual(self.cmd.calls, [], "refused before the mode switch")

    def test_the_last_write_path_refuses_a_program_path_too(self):
        """R367: program_open behind load_file's own check — the binding
        would send PLAN_CLOSE before refusing a path past 254 bytes."""
        for p in ("/" + "p" * 254 + ".ngc", "/prog\u0000.ngc"):
            with self.subTest(n=len(p.encode())):
                self.cmd.calls.clear()
                with self.assertRaises(gateway._WriteRefused):
                    _run(gateway._cmd_blocking(gateway.link(), gateway.op(linuxcnc.command.program_open, p), wait=None))
                self.assertEqual(self.cmd.calls, [])

    def test_a_nul_in_the_text_is_refused_before_anything(self):
        r = self.send({"cmd": "mdi", "text": "G0 X1\u0000 Y2"})
        self.assertFalse(r["ok"], r)
        self.assertIn("NUL", r["error"])
        self.assertEqual(self.cmd.calls, [])

    def test_the_byte_limit_not_the_character_count(self):
        long_ = "G4 P0 (" + "ä" * 130 + ")"          # 138 characters, 268 bytes
        r = self.send({"cmd": "mdi", "text": long_})
        self.assertFalse(r["ok"], r)
        self.assertIn("268 bytes", r["error"])
        self.assertEqual(self.cmd.calls, [], "refused before the mode switch")
        ok = "G4 P0 (" + "ä" * 100 + ")"              # 208 bytes: taken unchanged
        r = self.send({"cmd": "mdi", "text": ok})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.last_mdi(), (ok,))

    def test_a_generated_line_past_the_limit_writes_nothing(self):
        for msg in ({"cmd": "set_wcs", "target": "G54", "x": 1e300},
                    {"cmd": "touchoff", "axes": {"X": 1e300}},
                    {"cmd": "mdi", "text": "G0 X1", "vars": {"3014": 1e300}},
                    {"cmd": "auto_run", "line": 5, "file": "/p.ngc", "version": 1, "source": "a" * 64,
                     "entry_x": 1e300, "entry_y": 0.0}):
            with self.subTest(cmd=msg["cmd"]):
                self.cmd.calls.clear()
                before = self.booked()
                r = self.send(msg)
                self.assertFalse(r["ok"], r)
                self.assertTrue("bytes" in r["error"] or "too long" in r["error"], r)
                self.assertEqual(self.cmd.calls, [], "nothing written — the mode switch included")
                self.assertEqual(self.booked(), before)

    def test_a_generated_line_within_the_limit_still_goes_out(self):
        r = self.send({"cmd": "set_wcs", "target": "G54", "x": 1.5})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.last_mdi(), ("G10 L2 P1 X1.500000",))

    def test_a_large_parameter_value_its_line_holds_goes_out(self):
        """R367: a value past the rounding's old 28 digits (≈ 1e22) whose word
        fits the line is written as that word — it answered with the name of
        a decimal exception (toolsetter_rules.canonical)."""
        r = self.send({"cmd": "mdi", "text": "G0 X1", "vars": {"3014": 1e30}})
        self.assertTrue(r["ok"], r)
        mdis = [a[0] for n, a, _k in self.cmd.calls if n == "mdi"]
        self.assertIn("#3014=1000000000000000019884624838656.000000", mdis[0].split())   # (the #3116 clear rides along)
        self.assertEqual(mdis[-1], "G0 X1")

    def test_the_last_write_path_refuses_too(self):
        """Behind every handler's own check: an MDI the gateway composes
        itself (a routine call, a plan) passes _cmd_blocking's guard."""
        for line in ("G0 X1\u0000", "G4 P0 (" + "ä" * 130 + ")"):
            with self.subTest(line=line[:12]):
                self.cmd.calls.clear()
                with self.assertRaises(gateway._WriteRefused):
                    _run(gateway._cmd_blocking(gateway.link(), gateway.op(linuxcnc.command.mdi, line), wait=None))
                self.assertEqual(self.cmd.calls, [])
