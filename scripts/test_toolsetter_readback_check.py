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
REPO = os.path.realpath(os.path.join(HERE, ".."))
#: the suite's scripts a `loadusr` finds on PATH — install.sh links them
#: into the checkout; resolved here into THIS checkout, so the tests depend
#: on no ~/.local/bin of the machine they run on
SUITE = {"hal_watchdog.py": "lcnc-gateway/hal_watchdog.py", "hal_reader.py": "lcnc-gateway/hal_reader.py",
         "compensation.py": "subroutines/surfacemap/compensation.py"}


def suite_which(name):
    return os.path.join(REPO, SUITE[name]) if name in SUITE else "/usr/bin/" + name


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
        # the tool setter's feed, which hallib/sim_toolsetter.hal starts
        shutil.copytree(os.path.join(SIM, "sim_toolsetter"), os.path.join(self.tmp, "sim_toolsetter"))

    def refused(self, ini=None, running=None):
        ini = ini or self.ini
        with self.assertRaises(ValueError) as e:
            check.validate_sim_target(ini, running if running is not None else ini, which=suite_which)
        return str(e.exception)

    def edit(self, rel, f):
        path = os.path.join(self.tmp, rel)
        with open(path) as fh:
            text = fh.read()
        changed = f(text)
        self.assertNotEqual(changed, text, f"the edit changes {rel}")
        self.assertIn(text.rstrip("\n").splitlines()[0], changed, "an edit, not a replacement")
        with open(path, "w") as fh:
            fh.write(changed)

    def test_the_installed_copy_of_a_shipped_simulator_is_accepted(self):
        check.validate_sim_target(self.ini, self.ini, which=suite_which)

    def test_a_hallib_linked_back_into_the_checkout_is_accepted(self):
        shutil.rmtree(os.path.join(self.tmp, "hallib"))
        os.symlink(os.path.realpath(os.path.join(SIM, "hallib")), os.path.join(self.tmp, "hallib"))
        check.validate_sim_target(self.ini, self.ini, which=suite_which)

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

    def test_the_script_a_loadusr_starts_is_compared_byte_for_byte(self):
        # Codex R120: `loadusr -Wn sim-toolsetter-feed python3 <script>` —
        # -Wn names the component, the interpreter's script is what runs
        self.edit("sim_toolsetter/sim_toolsetter_feed.py", lambda t: t + "\n# length += 100\n")
        self.assertIn("sim_toolsetter/sim_toolsetter_feed.py differs", self.refused())

    def test_a_missing_script_is_refused(self):
        os.remove(os.path.join(self.tmp, "sim_toolsetter", "sim_toolsetter_feed.py"))
        self.assertIn("sim_toolsetter/sim_toolsetter_feed.py is missing", self.refused())

    def test_the_script_folder_linked_back_into_the_checkout_is_accepted(self):
        shutil.rmtree(os.path.join(self.tmp, "sim_toolsetter"))
        os.symlink(os.path.realpath(os.path.join(SIM, "sim_toolsetter")), os.path.join(self.tmp, "sim_toolsetter"))
        check.validate_sim_target(self.ini, self.ini, which=suite_which)

    def test_a_program_on_path_that_is_neither_the_checkouts_nor_the_systems_is_refused(self):
        # hal_watchdog.py, hal_reader.py, compensation.py: install.sh links
        # them into the checkout; one found elsewhere is no shipped file
        elsewhere = os.path.join(self.tmp, "bin", "hal_watchdog.py")
        os.makedirs(os.path.dirname(elsewhere))
        open(elsewhere, "w").write("print('not the suite's')\n")
        def which(name):
            return elsewhere if name == "hal_watchdog.py" else suite_which(name)
        with self.assertRaises(ValueError) as e:
            check.validate_sim_target(self.ini, self.ini, which=which)
        self.assertIn("hal_watchdog.py runs from", str(e.exception))
        with self.assertRaises(ValueError):
            check.validate_sim_target(self.ini, self.ini, which=lambda n: None)

    def test_another_running_instance_is_refused(self):
        other = os.path.join(self.tmp, "other", NAME)
        os.makedirs(os.path.dirname(other))
        shutil.copy(self.ini, other)
        self.assertIn("not the one LinuxCNC runs", self.refused(running=other))
        with self.assertRaises(ValueError):
            check.validate_sim_target(self.ini, None, which=suite_which)

    def test_a_name_no_shipped_profile_has_is_refused(self):
        machine = os.path.join(self.tmp, "my_machine.ini")
        shutil.copy(self.ini, machine)
        self.assertIn("no shipped simulator profile", self.refused(ini=machine))


class TestLoadusr(unittest.TestCase):
    """halcmd's `loadusr [-W | -Wn name | -w | -i] program [args]`."""

    def test_the_forms_the_profiles_use(self):
        runs = check._loadusr_runs
        self.assertEqual(runs("loadusr -Wn sim-toolsetter-feed python3 sim_toolsetter/sim_toolsetter_feed.py".split()),
                         [("path", "python3"), ("file", "sim_toolsetter/sim_toolsetter_feed.py")])
        self.assertEqual(runs("loadusr -Wn compensation compensation.py probe-results.txt cubic".split()),
                         [("path", "compensation.py")])
        self.assertEqual(runs("loadusr -W ./twp/python/twp-helper-comp.py".split()),
                         [("file", "./twp/python/twp-helper-comp.py")])
        self.assertEqual(runs("loadusr -w -i halui".split()), [("path", "halui")])

    def test_a_form_it_does_not_know_is_refused(self):
        for line in ("loadusr -T 5 prog", "loadusr -Wn name", "loadusr -Wn c python3 -m module",
                     "loadusr python3 -c print(1)"):
            with self.subTest(line=line), self.assertRaises(ValueError):
                check._loadusr_runs(line.split())


class TestTeardown(unittest.TestCase):
    def test_only_the_verified_instances_launcher(self):
        lines = ["101 bash /home/cnc/lcnc-suite/lcnc-suite -ini /a/x.ini",
                 "102 bash /home/cnc/lcnc-suite/lcnc-suite -ini /a/y.ini",
                 "103 bash -c until pgrep -f '/lcnc-suite -ini /a/x.ini'; do sleep 1; done",
                 "104 bash /home/cnc/lcnc-suite/lcnc-suite -ini /a/x.ini.bak"]
        self.assertEqual(check.launcher_pids("/a/x.ini", lines), [101])


if __name__ == "__main__":
    unittest.main()
