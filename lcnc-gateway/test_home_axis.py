"""Home and Unhome per axis (package 3a F-HOME.S2b; operator Q349-1, Q363-4;
Codex R363–R365).

Home per axis sends the axis; the gateway names its ONE declared joint
(WEBUI_JOINT_AXES, else trivkins' coordinates=) and refuses an unclear one —
and, for Home, a joint whose home(j) homes a GROUP (a negative
HOME_SEQUENCE shared by magnitude: homing.c 2.9.4 do_home_one_joint). The
admission holds from the mode switch to the home write on the CURRENT
sequence read. Unhome has no sequence rule (base_set_unhomed).

    .venv/bin/python3 -m pytest -q test_home_axis.py
"""
import unittest
import unittest.mock

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()   # MUST precede `import gateway`
import gateway  # noqa: E402
from gateway_util import (axis_joint_rows, home_admission, home_targets, unhome_admission,  # noqa: E402
                          HOME_SEQUENCE_UNKNOWN)
from link_fixture import connect_fake, current  # noqa: E402
from test_button_gates import controller_reads  # noqa: E402
from test_command_dispatch import _RecordingCmd, _payload, _run  # noqa: E402

XYZ_ROWS = axis_joint_rows(list("XYZ"), 3, list("XYZ"))[0]


class TestHomeTargets(unittest.TestCase):
    """The table of Codex R365 (15 target sets) — the controller's rule, not
    a recording fake: home(j) with a negative sequence starts every joint of
    the same magnitude."""
    TABLE = {
        (-1, -1, -1): ({0, 1, 2}, {0, 1, 2}, {0, 1, 2}),
        (1, -2, -2): ({0}, {1, 2}, {1, 2}),
        (-1, 0, 1): ({0, 2}, {1}, {2}),          # the counter-case: a positive 1 joins the -1 group
        (-1, 0, 2): ({0}, {1}, {2}),             # a negative sequence alone
        (1, 1, 0): ({0}, {1}, {2}),              # the shipped 3-axis profile
    }

    def test_the_target_sets(self):
        for seqs, expected in self.TABLE.items():
            for j, want in enumerate(expected):
                with self.subTest(seqs=seqs, joint=j):
                    self.assertEqual(home_targets(list(seqs), j), frozenset(want))

    def test_open_exactly_where_the_set_is_the_joint_itself(self):
        for seqs, expected in self.TABLE.items():
            for axis, want in enumerate(expected):
                joint, why = home_admission(XYZ_ROWS, list(seqs), axis)
                with self.subTest(seqs=seqs, axis=axis):
                    if want == {axis}:
                        self.assertEqual((joint, why), (axis, None))
                    else:
                        self.assertIsNone(joint)
                        self.assertIn("together", why)
                        self.assertIn("Home All", why)

    def test_the_group_reason_names_its_axes(self):
        _j, why = home_admission(XYZ_ROWS, [-1, -1, -1], 0)
        self.assertEqual(why, "Homes X Y Z together (HOME_SEQUENCE -1) — Home All")

    def test_an_unread_sequence_closes_home_but_not_unhome(self):
        self.assertEqual(home_admission(XYZ_ROWS, [None, None, None], 0), (None, HOME_SEQUENCE_UNKNOWN))
        self.assertEqual(home_admission(XYZ_ROWS, [], 0), (None, HOME_SEQUENCE_UNKNOWN))
        # a negative sequence needs every other one to know its group
        self.assertEqual(home_admission(XYZ_ROWS, [-1, None, 0], 0), (None, HOME_SEQUENCE_UNKNOWN))
        # a positive one needs only its own
        self.assertEqual(home_admission(XYZ_ROWS, [1, None, None], 0), (0, None))
        self.assertEqual(unhome_admission(XYZ_ROWS, 0), (0, None))


class TestTheMapping(unittest.TestCase):
    def test_a_swapped_joint_order_sends_the_declared_joint(self):
        rows = axis_joint_rows(list("YXZ"), 3, list("XYZ"))[0]   # joint 0 carries Y
        self.assertEqual(home_admission(rows, [1, 1, 1], 0), (1, None))     # X → joint 1
        self.assertEqual(unhome_admission(rows, 1), (0, None))              # Y → joint 0

    def test_a_gantry_axis_and_an_undeclared_order_are_closed_with_their_reason(self):
        rows = axis_joint_rows(list("XYYZ"), 4, list("XYZ"))[0]
        joint, why = home_admission(rows, [1, 1, 1, 1], 1)
        self.assertIsNone(joint)
        self.assertIn("Gantry", why)
        self.assertEqual(unhome_admission(rows, 1)[0], None)
        rows = axis_joint_rows(None, 3, list("XYZ"))[0]
        self.assertIn("WEBUI_JOINT_AXES", home_admission(rows, [1, 1, 1], 0)[1])
        rows = axis_joint_rows(list("XY"), 3, list("XYZ"))[0]       # an incomplete declaration
        self.assertIsNone(home_admission(rows, [1, 1, 1], 0)[0])

    def test_the_shipped_profiles_send_what_they_sent(self):
        """Identity on every shipped profile: 3 axes by trivkins, 5 and 6 by
        their new WEBUI_JOINT_AXES — the joint each axis homes is its index."""
        import re
        from pathlib import Path
        from gateway_util import parse_joint_letters, trivkins_coordinates
        root = Path(__file__).resolve().parent.parent / "examples/sim_config"
        for ini in sorted(root.glob("lcnc_suite_sim_*.ini")):
            text = ini.read_text()
            m = re.search(r"^WEBUI_JOINT_AXES\s*=\s*(.+)$", text, re.M)
            k = re.search(r"^KINEMATICS\s*=\s*(.+)$", text, re.M)
            letters = parse_joint_letters(m.group(1)) if m else trivkins_coordinates(k.group(1))
            axes = re.search(r"^COORDINATES\s*=\s*(.+)$", text, re.M).group(1).replace(" ", "")
            rows, why = axis_joint_rows(letters, len(letters or []), list(axes))
            with self.subTest(ini=ini.name):
                self.assertIsNone(why)
                self.assertEqual([r["joint"] for r in rows], list(range(len(axes))))


class _HomeDispatch(unittest.TestCase):
    def setUp(self):
        self.cmd = _RecordingCmd()
        connect_fake(self, cmd=self.cmd)
        controller_reads(current().stat, task_mode=None)
        current().stat.joints = 3
        self.seqs = [1, 2, 3]
        self.amap = {"axes": [dict(r, max_vel=10.0, joint_span=100.0, axis_span=100.0) for r in XYZ_ROWS],
                     "reason": None}
        for patch in (unittest.mock.patch.object(gateway, "_axis_joint_map", lambda: self.amap),
                      unittest.mock.patch.object(gateway, "_home_sequences", lambda: list(self.seqs))):
            patch.start()
            self.addCleanup(patch.stop)

    def send(self, msg):
        gateway._shared_status = _payload()
        return _run(gateway.handle_command(msg, True))

    def writes(self):
        return [(n, a) for n, a, _k in self.cmd.calls if n in ("mode", "home", "unhome", "teleop_enable")]


class TestHomeThroughTheDispatch(_HomeDispatch):
    def test_a_single_sequence_homes_the_axis_joint(self):
        r = self.send({"cmd": "home", "axis": 1})
        self.assertTrue(r["ok"], r)
        self.assertIn(("home", (1,)), self.writes())

    def test_a_group_is_refused_before_anything_is_written(self):
        self.seqs = [-1, -1, -1]
        r = self.send({"cmd": "home", "axis": 0})
        self.assertFalse(r["ok"], r)
        self.assertIn("together", r["error"])
        self.assertEqual(self.writes(), [])

    def test_unhome_has_no_group_rule(self):
        self.seqs = [-1, -1, -1]
        r = self.send({"cmd": "unhome", "axis": 2})
        self.assertTrue(r["ok"], r)
        self.assertIn(("unhome", (2,)), self.writes())

    def test_the_retired_joint_field_is_refused_even_beside_an_axis(self):
        for msg in ({"cmd": "home", "joint": 0}, {"cmd": "home", "axis": 0, "joint": 0}, {"cmd": "home"},
                    {"cmd": "unhome", "joint": 1}):
            with self.subTest(msg=msg):
                r = self.send(msg)
                self.assertFalse(r["ok"], r)
                self.assertEqual(self.writes(), [])

    def test_a_group_appearing_during_the_wait_sends_no_home(self):
        """R365 Rest B: [1,2,3] admits the single home; while the mode switch
        is written, [-1,-1,-1] becomes known — the home write's own admission
        refuses it. And fresh → unread the same way."""
        for later in ([-1, -1, -1], [None, None, None]):
            with self.subTest(later=later):
                self.cmd.calls.clear()
                self.seqs = [1, 2, 3]
                real_mode = self.cmd.__getattr__("mode")

                def mode(m, later=later):
                    real_mode(m)
                    self.seqs = list(later)     # the change lands while the switch is written
                with unittest.mock.patch.object(self.cmd, "mode", mode, create=True):
                    r = self.send({"cmd": "home", "axis": 0})
                self.assertFalse(r["ok"], r)
                self.assertNotIn("home", [n for n, _a in self.writes()])

    def test_an_unchanged_single_sequence_sends_its_home(self):
        self.cmd.calls.clear()
        r = self.send({"cmd": "home", "axis": 0})
        self.assertTrue(r["ok"], r)
        self.assertEqual([n for n, _a in self.writes()][-1], "home")


if __name__ == "__main__":
    unittest.main()
