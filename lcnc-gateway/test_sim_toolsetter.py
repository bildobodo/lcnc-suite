"""The simulated tool setter (examples/sim_config/sim_toolsetter/, operator
2026-09-29; Codex R44 ST-I01/ST-I02).

The PLATE is physical: a fixed HAL constant per profile (`setp` in its
core_sim_N.hal), never the WebUI's setting read back — a setting read from
the var file lagged the interpreter and a measurement took the old plate
(ST-I01). The supported operation is the WebUI's reference ON the plate;
another one measures wrong by the difference, and since the sim's tool
length is the table's, the error adds up with every measurement (ST-I05,
pinned below). The control point is the JOINT position
(joint.N.pos-fb) — the motor position carries the home / motor offset and
made every measurement drift by it (ST-I02). The feeder only supplies the
spindle tool's TABLE length. The realtime comparison itself
(sim_toolsetter.comp) is five lines in the servo thread, checked live."""
import importlib.util
import json
import os
import re
import unittest

_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "examples", "sim_config")
_PATH = os.path.join(_ROOT, "sim_toolsetter", "sim_toolsetter_feed.py")
_spec = importlib.util.spec_from_file_location("sim_toolsetter_feed", _PATH)
feed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(feed)   # hal / linuxcnc are imported by main() only


def _read(*parts):
    with open(os.path.join(_ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def _hal_lines(text):
    return [ln.split("#", 1)[0].strip() for ln in text.splitlines() if ln.split("#", 1)[0].strip()]


def _ini(text):
    """{section: [(key, value), ...]} — LinuxCNC INIs repeat keys (HALFILE)."""
    out, sec = {}, None
    for ln in text.splitlines():
        ln = ln.split("#", 1)[0].strip()
        if ln.startswith("[") and ln.endswith("]"):
            sec = ln[1:-1]
            out.setdefault(sec, [])
        elif sec and "=" in ln:
            k, v = ln.split("=", 1)
            out[sec].append((k.strip(), v.strip()))
    return out


def _first(ini, sec, key):
    return next((v for k, v in ini.get(sec, []) if k == key), None)


class TestSpindleLength(unittest.TestCase):
    ROWS = [(1, 100.0), (13, 65.067), (2, 0.0)]

    def test_the_table_row_of_the_spindle_tool(self):
        self.assertEqual(feed.spindle_length(13, self.ROWS), 65.067)

    def test_empty_spindle_or_unknown_tool(self):
        self.assertIsNone(feed.spindle_length(0, self.ROWS))
        self.assertIsNone(feed.spindle_length(-1, self.ROWS))
        self.assertIsNone(feed.spindle_length(7, self.ROWS))


class TestFeedValues(unittest.TestCase):
    ROWS = [(1, 100.0), (13, 65.067), (2, 0.0)]

    def test_armed_with_a_length(self):
        self.assertEqual(feed.feed_values(13, self.ROWS), (65.067, True, "armed"))

    def test_no_tool_no_trip(self):
        self.assertEqual(feed.feed_values(0, self.ROWS)[1:], (False, "no tool in the spindle"))
        self.assertEqual(feed.feed_values(7, self.ROWS)[1:], (False, "T7 is not in the tool table"))

    def test_no_length_no_trip(self):
        # a tool without a length: the probe finds nothing, as on a machine
        # without a tool setter — never a made-up length in the table
        self.assertEqual(feed.feed_values(2, self.ROWS)[1:], (False, "T2 has no length in the tool table"))


class TestThePlateIsPhysical(unittest.TestCase):
    """ST-I01: no position is read back from the WebUI's settings."""

    def test_the_feeder_reads_no_position(self):
        import ast
        tree = ast.parse(_read("sim_toolsetter", "sim_toolsetter_feed.py"))
        tree.body = tree.body[1:]   # the module docstring may say what it does not do
        code = ast.unparse(tree)
        for word in ("PARAMETER_FILE", "3100", "3101", "3102", "'plate", "open("):
            self.assertNotIn(word, code, f"the feeder must not supply the plate ({word!r})")

    def test_nothing_drives_the_plate_pins(self):
        for name in ("sim_toolsetter.hal", "core_sim_3.hal", "core_sim_5.hal", "core_sim_6.hal"):
            for ln in _hal_lines(_read("hallib", name)):
                if ln.startswith("net "):
                    self.assertNotRegex(ln, r"sim-toolsetter\.0\.plate-", f"{name}: {ln}")

    def test_every_profile_fixes_its_plate_inside_its_travel_at_the_shipped_setting(self):
        profiles = json.loads(_read("profiles.json"))["profiles"]
        self.assertEqual(len(profiles), 3)
        for p in profiles:
            ini = _ini(_read(p["ini"]))
            core = next(v for k, v in ini["HAL"] if k == "HALFILE" and "core_sim_" in v)
            lines = _hal_lines(_read(*core.split("/")))
            src = lines.index("source hallib/sim_toolsetter.hal")
            plate = {}
            for i, ln in enumerate(lines):
                m = re.fullmatch(r"setp\s+sim-toolsetter\.0\.plate-([xyz])\s+(\S+)", ln)
                if m:
                    self.assertGreater(i, src, f"{core}: setp before the component is loaded")
                    plate[m.group(1)] = float(m.group(2))
            self.assertEqual(sorted(plate), ["x", "y", "z"], f"{core}: the plate needs X, Y and Z")
            for axis in "xyz":
                lo = float(_first(ini, f"AXIS_{axis.upper()}", "MIN_LIMIT"))
                hi = float(_first(ini, f"AXIS_{axis.upper()}", "MAX_LIMIT"))
                self.assertTrue(lo <= plate[axis] <= hi, f"{p['id']}: plate {axis} {plate[axis]} outside {lo}..{hi}")
            # The WebUI's shipped setting (the profile's seeded var file)
            # names the same plate: out of the box the reference is right.
            seed = feed_rows(_read(p["state_dir"], "sim.var"))
            self.assertEqual((seed[3100], seed[3101], seed[3102]), (plate["x"], plate["y"], plate["z"]), p["id"])


def feed_rows(text):
    rows = {}
    for ln in text.splitlines():
        parts = ln.split()
        if len(parts) >= 2 and parts[0].isdigit():
            rows[int(parts[0])] = float(parts[1])
    return rows


class TestRepeatedMeasurement(unittest.TestCase):
    """Codex R45 ST-I05: what the sim model does over repeated measurements.
    The contact is sim_toolsetter.comp's (trips at Z = plate + length, moving
    down), the result tool_touch_off.ngc's (new = |reference Z| + contact Z,
    -170/-180), and the next measurement's length is the TABLE's — the sim's
    tool has no length of its own. With the reference on the plate the
    measurement repeats; a wrong reference ADDS UP (the documented limit)."""

    @staticmethod
    def contact_z(plate_z, length):
        return plate_z + length          # the comp: z - length <= plate_z

    @staticmethod
    def result(reference_z, contact):
        return abs(reference_z) + contact  # tool_touch_off.ngc -170

    def series(self, plate_z, reference_z, start, n):
        lengths = [start]
        for _ in range(n):
            lengths.append(self.result(reference_z, self.contact_z(plate_z, lengths[-1])))
        return lengths

    def test_the_reference_on_the_plate_returns_the_length_every_time(self):
        self.assertEqual(self.series(-300.0, -300.0, 65.0, 3), [65.0, 65.0, 65.0, 65.0])

    def test_a_wrong_reference_adds_its_error_every_measurement(self):
        # Z set 20 mm too high: 65 -> 45 -> 25 -> 5 (Codex's sequence), never a
        # constant offset — the README says so and names the plate as supported
        self.assertEqual(self.series(-300.0, -280.0, 65.0, 3), [65.0, 45.0, 25.0, 5.0])

    def test_the_readme_names_the_supported_operation_and_the_sequence(self):
        readme = _read("README.md")
        self.assertIn("**supported**", readme)
        self.assertIn("65 → 45 → 25 → 5", readme)
        self.assertNotIn("the same way every time", readme)


class TestJointCoordinates(unittest.TestCase):
    """ST-I02: the control point is the joint position, never the motor's."""

    def test_the_contact_reads_joint_positions(self):
        lines = _hal_lines(_read("hallib", "sim_toolsetter.hal"))
        for n, axis in enumerate("xyz"):
            nets = [ln for ln in lines if ln.startswith("net ") and f"sim-toolsetter.0.{axis}" in ln.split()]
            self.assertEqual(len(nets), 1, f"one net drives sim-toolsetter.0.{axis}")
            self.assertIn(f"joint.{n}.pos-fb", nets[0].split(), nets[0])
        for ln in lines:
            self.assertNotIn("motor-pos", ln, ln)

    def test_no_profile_nets_the_joint_feedback_elsewhere(self):
        # an output pin lives in ONE signal: another net would refuse the file
        for name in ("core_sim_3.hal", "core_sim_5.hal", "core_sim_6.hal", "lcnc_webui.hal"):
            for ln in _hal_lines(_read("hallib", name)):
                for n in range(3):
                    self.assertNotIn(f"joint.{n}.pos-fb", ln.split(), f"{name}: {ln}")


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
