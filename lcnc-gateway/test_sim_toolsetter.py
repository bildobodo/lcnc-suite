"""The simulated tool setter's feed decisions (examples/sim_config/
sim_toolsetter/sim_toolsetter_feed.py, operator 2026-09-29): the plate from
the var file, the spindle tool's TABLE length, and a named reason whenever
nothing may trip. The realtime comparison itself (sim_toolsetter.comp) is
five lines in the servo thread, checked live on the sim."""
import importlib.util
import os
import unittest

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "examples",
                     "sim_config", "sim_toolsetter", "sim_toolsetter_feed.py")
_spec = importlib.util.spec_from_file_location("sim_toolsetter_feed", _PATH)
feed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(feed)   # hal / linuxcnc are imported by main() only


class TestReadParams(unittest.TestCase):
    def test_reads_the_plate_and_ignores_the_rest(self):
        text = "3004\t6000.000000\n3100\t150.000000\n3101\t0.000000\n3102\t-300.000000\nbad line\n5221 1\n"
        self.assertEqual(feed.read_params(text), {3100: 150.0, 3101: 0.0, 3102: -300.0})

    def test_unparsable_values_are_absent_not_zero(self):
        self.assertEqual(feed.read_params("3100 abc\n3101 5\n"), {3101: 5.0})
        self.assertEqual(feed.read_params(""), {})
        self.assertEqual(feed.read_params(None), {})


class TestSpindleLength(unittest.TestCase):
    ROWS = [(1, 100.0), (13, 65.067), (2, 0.0)]

    def test_the_table_row_of_the_spindle_tool(self):
        self.assertEqual(feed.spindle_length(13, self.ROWS), 65.067)

    def test_empty_spindle_or_unknown_tool(self):
        self.assertIsNone(feed.spindle_length(0, self.ROWS))
        self.assertIsNone(feed.spindle_length(-1, self.ROWS))
        self.assertIsNone(feed.spindle_length(7, self.ROWS))


class TestFeedValues(unittest.TestCase):
    PLATE = {3100: 150.0, 3101: 0.0, 3102: -300.0}
    ROWS = [(1, 100.0), (13, 65.067), (2, 0.0)]

    def test_armed_with_a_plate_and_a_length(self):
        self.assertEqual(feed.feed_values(self.PLATE, 13, self.ROWS),
                         (150.0, 0.0, -300.0, 65.067, True, "armed"))

    def test_no_plate_no_trip(self):
        v = feed.feed_values({3100: 150.0}, 13, self.ROWS)
        self.assertFalse(v[4])
        self.assertIn("#3101", v[5])
        self.assertIn("#3102", v[5])

    def test_no_tool_no_trip(self):
        self.assertEqual(feed.feed_values(self.PLATE, 0, self.ROWS)[4:], (False, "no tool in the spindle"))
        self.assertEqual(feed.feed_values(self.PLATE, 7, self.ROWS)[4:], (False, "T7 is not in the tool table"))

    def test_no_length_no_trip(self):
        # a tool without a length: the probe finds nothing, as on a machine
        # without a tool setter — never a made-up length in the table
        self.assertEqual(feed.feed_values(self.PLATE, 2, self.ROWS)[4:], (False, "T2 has no length in the tool table"))


if __name__ == "__main__":
    unittest.main()


class TestComponentCheck(unittest.TestCase):
    """config_sync_check names a sim component that is not installed, with
    the command — install.sh builds both; a hand-copied config lacks them."""

    def setUp(self):
        import importlib
        import sys
        import tempfile
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
        self.csc = importlib.import_module("config_sync_check")
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_launcher_names_the_module_dir(self):
        launcher = os.path.join(self.tmp.name, "linuxcnc")
        with open(launcher, "w") as f:
            f.write("#!/bin/bash\nLINUXCNC_RTLIB_DIR=/opt/lcnc/modules\nexport X=1\n")
        self.assertEqual(self.csc.rtlib_dir(launcher), "/opt/lcnc/modules")
        with open(launcher, "w") as f:
            f.write("#!/bin/bash\n")
        self.assertIsNone(self.csc.rtlib_dir(launcher))

    def test_a_missing_component_is_named_with_its_command(self):
        import io
        mods = os.path.join(self.tmp.name, "modules")
        os.makedirs(mods)
        open(os.path.join(mods, "xyzacb_trsrn.so"), "w").close()
        out = io.StringIO()
        self.assertEqual(self.csc.check_components("/repo/examples/sim_config", out=out, modules=mods), 1)
        text = out.getvalue()
        self.assertIn("sim_toolsetter is not installed", text)
        self.assertIn("sudo halcompile --install /repo/examples/sim_config/sim_toolsetter/sim_toolsetter.comp", text)
        open(os.path.join(mods, "sim_toolsetter.so"), "w").close()
        self.assertEqual(self.csc.check_components("/repo/examples/sim_config", out=io.StringIO(), modules=mods), 0)
