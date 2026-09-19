"""Test discovery, fixture isolation and refusal before live motion."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("suite_runner", ROOT / "scripts/test_suite.py")
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)
client_spec = importlib.util.spec_from_file_location(
    "live_session", ROOT / "scripts/test_support/live_session.py")
live_session = importlib.util.module_from_spec(client_spec)
client_spec.loader.exec_module(live_session)


class TestSuiteRunner(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.ini = self.folder / "lcnc_suite_sim_6axis_twp_xyzabc.ini"
        text = (ROOT / "examples/sim_config/lcnc_suite_sim_6axis_twp_xyzabc.ini").read_text()
        self.text = text.replace("DISPLAY = lcnc-suite", f"DISPLAY = {ROOT}/lcnc-suite").replace(
            "TOPLEVEL = twp/python/toplevel.py", f"TOPLEVEL = {ROOT}/examples/sim_config/twp/python/toplevel.py")
        self.ini.write_text(self.text)

    def test_accepts_matching_standard_simulator(self):
        values = suite.validate_live_target(self.ini, self.ini)
        self.assertEqual(values[("KINS", "JOINTS")], ["6"])

    def test_refuses_a_different_running_session(self):
        with self.assertRaisesRegex(ValueError, "running LinuxCNC"):
            suite.validate_live_target(self.ini, self.folder / "another.ini")

    def test_refuses_retired_simulator_even_if_its_name_contains_sim(self):
        other = self.folder / "lcnc_suite_sim_twp.ini"
        other.write_text(self.text)
        with self.assertRaisesRegex(ValueError, "gantry geometry"):
            suite.validate_live_target(other, other)

    def test_refuses_changed_kinematic_geometry(self):
        self.ini.write_text(self.text.replace("nut-angle 45", "nut-angle 55"))
        with self.assertRaisesRegex(ValueError, "geometry"):
            suite.validate_live_target(self.ini, self.ini)

    def test_refuses_extra_hal_hardware(self):
        self.ini.write_text(self.text.replace("HALFILE = hallib/core_sim_6.hal",
                                            "HALFILE = hardware.hal\nHALFILE = hallib/core_sim_6.hal"))
        with self.assertRaisesRegex(ValueError, "HALFILE"):
            suite.validate_live_target(self.ini, self.ini)

    def test_refuses_stale_worktree_launcher_or_remap(self):
        for before in (f"{ROOT}/lcnc-suite", f"{ROOT}/examples/sim_config/twp/python/toplevel.py"):
            with self.subTest(path=before):
                self.ini.write_text(self.text.replace(before, "/old-checkout/file"))
                with self.assertRaisesRegex(ValueError, "this checkout"):
                    suite.validate_live_target(self.ini, self.ini)

    def test_no_live_side_effects_without_explicit_motion_flag(self):
        with patch.object(suite.subprocess, "Popen") as spawn:
            with self.assertRaises(SystemExit) as raised:
                suite.main(["live-twp", "--ini", str(self.ini)])
            self.assertEqual(raised.exception.code, 2)
            spawn.assert_not_called()

    def test_offline_discovers_tests_and_contains_no_live_gate(self):
        commands = suite.offline_commands("all")
        self.assertEqual(commands[0][1][-2:], ["-m", "pytest"])
        self.assertEqual(len(commands), 6)
        self.assertFalse(any("sim_parity" in str(command) for _, command, _ in commands))

    def test_corpus_is_portable_and_does_not_overwrite_references(self):
        reference = ROOT / "scripts/parity_corpus/twp_gantry.json"
        before = reference.read_bytes()
        corpus, demo = suite.materialize_corpus(self.ini, self.folder)
        data = json.loads(corpus.read_text())
        self.assertEqual(data["ini"], str(self.ini))
        self.assertEqual(sum(p["runs"] for p in data["programs"]), 11)
        self.assertEqual(demo.name, "twp_simple_example.ngc")
        for entry in data["programs"]:
            self.assertTrue(Path(entry["file"]).is_file())
            self.assertTrue(Path(entry["file"]).is_relative_to(self.folder))
        self.assertEqual(reference.read_bytes(), before)

    def test_child_failure_is_reported_with_output_and_exit_status(self):
        row = suite.run_gate("broken", [suite.python(), "-c", "print('failure detail'); exit(7)"],
                             self.folder, self.folder, {}, 5)
        self.assertEqual((row["status"], row["exit_code"]), ("fail", 7))
        self.assertIn("failure detail", (self.folder / row["log"]).read_text())

    def test_existing_report_directory_is_never_reused(self):
        with self.assertRaises(FileExistsError):
            suite.main(["offline", "--out-dir", str(self.folder)])

    def test_legacy_arm_reply_has_no_command_field(self):
        client = live_session.SimulatorClient("")
        client.replies.put({"type": "reply", "ok": True, "armed": True})
        with patch.object(client, "send") as send:
            self.assertTrue(client.request("arm", armed=True)["armed"])
            send.assert_called_once_with({"cmd": "arm", "armed": True})

    def test_arm_refusal_does_not_wait_for_a_missing_command_field(self):
        client = live_session.SimulatorClient("")
        client.replies.put({"type": "reply", "ok": False, "error": "Safety trip not acknowledged"})
        with patch.object(client, "send"):
            with self.assertRaisesRegex(RuntimeError, "Safety trip not acknowledged"):
                client.request("arm", armed=True)

    def test_normal_command_ignores_unrelated_toolchange_reply(self):
        client = live_session.SimulatorClient("")
        client.replies.put({"ok": True, "cmd": "confirm_tool_change"})
        client.replies.put({"ok": True, "cmd": "home_all"})
        with patch.object(client, "send"):
            self.assertEqual(client.request("home_all")["cmd"], "home_all")
