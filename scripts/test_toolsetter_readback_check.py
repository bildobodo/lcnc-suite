"""The live read-back check runs on a shipped simulator only (Codex R118/R119
VP-I73): the target is verified before anything is connected, armed or reset
— the whole INI and every file its HAL runs against the shipped templates —
and its teardown ends exactly the verified instance's launcher."""
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
    """A complete installed copy of the XYZAC simulator: the INI as the
    installer renders it, its hallib beside it (copied, or linked back)."""

    def setUp(self):
        import sys
        from pathlib import Path
        sys.path.insert(0, HERE)
        from install_examples import render_ini
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        template = open(os.path.join(SIM, NAME)).read()
        self.ini = os.path.join(self.tmp, NAME)
        open(self.ini, "w").write(render_ini(template, template, Path(SIM).resolve().parents[1]))
        shutil.copytree(os.path.join(SIM, "hallib"), os.path.join(self.tmp, "hallib"))

    def refused(self, ini=None, running=None):
        ini = ini or self.ini
        with self.assertRaises(ValueError) as e:
            check.validate_sim_target(ini, running if running is not None else ini)
        return str(e.exception)

    def edit(self, rel, f):
        path = os.path.join(self.tmp, rel)
        open(path, "w").write(f(open(path).read()))

    def test_the_installed_copy_of_a_shipped_simulator_is_accepted(self):
        check.validate_sim_target(self.ini, self.ini)

    def test_a_hallib_linked_back_into_the_checkout_is_accepted(self):
        shutil.rmtree(os.path.join(self.tmp, "hallib"))
        os.symlink(os.path.realpath(os.path.join(SIM, "hallib")), os.path.join(self.tmp, "hallib"))
        check.validate_sim_target(self.ini, self.ini)

    def test_a_hal_file_that_sources_hardware_under_its_shipped_name_is_refused(self):
        # Codex R119: the names were compared, never the files
        open(os.path.join(self.tmp, "hallib", "physical-drives.hal"), "w").write("loadrt hm2_eth\n")
        self.edit("hallib/core_sim_5.hal", lambda t: t + "source hallib/physical-drives.hal\n")
        self.assertIn("hallib/core_sim_5.hal differs", self.refused())

    def test_an_extra_halcmd_is_refused(self):
        # Codex R119: HALCMD entries went unchecked
        self.edit(NAME, lambda t: t.replace("[HAL]\n", "[HAL]\nHALCMD = source physical-drives.hal\n", 1))
        self.assertIn("the INI differs", self.refused())

    def test_a_changed_sourced_file_under_an_unchanged_top_level_file_is_refused(self):
        self.edit("hallib/sim_toolsetter.hal", lambda t: t + "loadrt hm2_eth\n")
        self.assertIn("hallib/sim_toolsetter.hal differs", self.refused())

    def test_a_machine_hal_in_place_of_a_shipped_one_is_refused(self):
        self.edit(NAME, lambda t: t.replace("HALFILE = hallib/core_sim_5.hal", "HALFILE = physical-drives.hal"))
        self.assertIn("not the shipped simulator", self.refused())

    def test_another_running_instance_is_refused(self):
        other = os.path.join(self.tmp, "other", NAME)
        os.makedirs(os.path.dirname(other))
        shutil.copy(self.ini, other)
        self.assertIn("not the one LinuxCNC runs", self.refused(running=other))
        with self.assertRaises(ValueError):
            check.validate_sim_target(self.ini, None)

    def test_a_name_no_shipped_profile_has_is_refused(self):
        machine = os.path.join(self.tmp, "my_machine.ini")
        shutil.copy(self.ini, machine)
        self.assertIn("no shipped simulator profile", self.refused(ini=machine))


class TestTeardown(unittest.TestCase):
    def test_only_the_verified_instances_launcher(self):
        lines = ["101 bash /home/cnc/lcnc-suite/lcnc-suite -ini /a/x.ini",
                 "102 bash /home/cnc/lcnc-suite/lcnc-suite -ini /a/y.ini",
                 "103 bash -c until pgrep -f '/lcnc-suite -ini /a/x.ini'; do sleep 1; done",
                 "104 bash /home/cnc/lcnc-suite/lcnc-suite -ini /a/x.ini.bak"]
        self.assertEqual(check.launcher_pids("/a/x.ini", lines), [101])


if __name__ == "__main__":
    unittest.main()
