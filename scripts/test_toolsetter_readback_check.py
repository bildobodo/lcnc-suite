"""The live read-back check runs on a shipped simulator only (Codex R118
VP-I73): the target is verified before anything is connected, armed or reset,
against the shipped fixtures, and its teardown ends exactly the verified
instance's launcher."""
import importlib.util
import os
import shutil
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("toolsetter_readback_check",
                                               os.path.join(HERE, "toolsetter_readback_check.py"))
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)
SIM = os.path.join(HERE, "..", "examples", "sim_config")
NAME = "lcnc_suite_sim_5axis_xyzac.ini"


class TestTarget(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.ini = os.path.join(self.tmp, NAME)
        shutil.copy(os.path.join(SIM, NAME), self.ini)     # as the installer copies it

    def refused(self, ini, running):
        with self.assertRaises(ValueError) as e:
            check.validate_sim_target(ini, running)
        return str(e.exception)

    def test_the_installed_copy_of_a_shipped_simulator_is_accepted(self):
        check.validate_sim_target(self.ini, self.ini)

    def test_a_machine_configuration_under_a_simulators_name_is_refused(self):
        text = open(self.ini).read()
        lines = [("HALFILE = physical-drives.hal" if ln.strip().startswith("HALFILE") else ln)
                 for ln in text.splitlines()]
        open(self.ini, "w").write("\n".join(lines) + "\n")
        self.assertIn("HALFILE differs", self.refused(self.ini, self.ini))

    def test_another_running_instance_is_refused(self):
        other = os.path.join(self.tmp, "other", NAME)
        os.makedirs(os.path.dirname(other))
        shutil.copy(self.ini, other)
        self.assertIn("not the one LinuxCNC runs", self.refused(self.ini, other))
        self.assertIn("not the one LinuxCNC runs", self.refused(self.ini, None))

    def test_a_name_no_shipped_profile_has_is_refused(self):
        machine = os.path.join(self.tmp, "my_machine.ini")
        shutil.copy(self.ini, machine)
        self.assertIn("no shipped simulator profile", self.refused(machine, machine))


class TestTeardown(unittest.TestCase):
    def test_only_the_verified_instances_launcher(self):
        lines = ["101 bash /home/cnc/lcnc-suite/lcnc-suite -ini /a/x.ini",
                 "102 bash /home/cnc/lcnc-suite/lcnc-suite -ini /a/y.ini",
                 "103 bash -c until pgrep -f '/lcnc-suite -ini /a/x.ini'; do sleep 1; done",
                 "104 bash /home/cnc/lcnc-suite/lcnc-suite -ini /a/x.ini.bak"]
        self.assertEqual(check.launcher_pids("/a/x.ini", lines), [101])


if __name__ == "__main__":
    unittest.main()
