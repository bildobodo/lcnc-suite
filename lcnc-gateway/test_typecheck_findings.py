"""Behaviour defects the type check found (package 2a, plan vor-maschine
R352/R353: a real defect gets its own commit and test, never a cast)."""
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest import mock

import status_runtime
from status_runtime import StatusRuntime

HERE = os.path.dirname(os.path.abspath(__file__))
COMPENSATION = os.path.join(HERE, "..", "subroutines", "surfacemap", "compensation.py")


class _Stat:
    def __init__(self, **attrs):
        self.__dict__.update(attrs)

    def poll(self):
        pass


def _runtime(stat, snapshot=None, tbl_path=None):
    snap = snapshot if snapshot is not None else {}
    return StatusRuntime(get_stat=lambda: stat, get_err=lambda: None, reader_get=snap.get,
                         get_tool_tbl_path=lambda: tbl_path, load_tool_library=lambda: {},
                         get_fb_scale=lambda: 60, get_reader_fresh=lambda: snapshot is not None)


class SpindleOverrideEnabled(unittest.TestCase):
    """2.9.4 has no `stat.spindle_override_enabled` (only the spindle row's
    `override_enabled`): the old read got its default True on every machine —
    M51 P0 never showed, and the UI's "missing data → disabled" was defeated."""

    def payload(self, **stat):
        return _runtime(_Stat(**stat)).poll_status()

    def test_the_spindle_rows_switch_is_reported(self):
        # a full 2.9.4 spindle row (lcnc_iface.SpindleStatus: the binding always has all nine keys)
        row = {"brake": 0, "direction": 0, "enabled": 0, "override_enabled": False, "speed": 0.0,
               "override": 1.0, "homed": False, "orient_state": 0, "orient_fault": 0}
        self.assertIs(self.payload(spindle=(row,)).spindle_override_enabled, False)
        self.assertIs(self.payload(spindle=({**row, "override_enabled": True},)).spindle_override_enabled, True)

    def test_unread_is_unknown_never_enabled(self):
        self.assertIsNone(self.payload().spindle_override_enabled)
        self.assertIsNone(self.payload(spindle=()).spindle_override_enabled)


class ToolChangeInfoWithoutTable(unittest.TestCase):
    """No tool table path known: the lookup names that case — before, it fed
    None to parse_tool_table and reported a TypeError."""

    def test_the_lookup_says_no_table_path(self):
        rt = _runtime(_Stat(), snapshot={"tool_change": True, "tool_prep_number": 3}, tbl_path=None)
        with mock.patch.object(status_runtime._trace, "emit") as emit:
            payload = rt.poll_status()
        self.assertIsNone(payload.tool_change_info)
        calls = [c for c in emit.call_args_list if c.args and c.args[0] == "toolchange.info_lookup_failed"]
        self.assertEqual(len(calls), 1, emit.call_args_list)
        self.assertEqual(calls[0].kwargs.get("exc"), "ValueError")
        self.assertIn("no tool table path", calls[0].kwargs.get("msg", ""))


class CompensationGridWriteFailure(unittest.TestCase):
    """compensation.py's grid write: a mkstemp that fails (folder not
    writable) must end in its own message — the cleanup reached for a
    `tmp_path` never bound and raised NameError instead. Run in a child: the
    module installs SIGINT/SIGTERM handlers on import."""

    def test_a_failed_mkstemp_is_reported_not_a_name_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            probe = os.path.join(tmp, "probe-results.txt")
            with open(probe, "w") as f:
                for x in (0, 10, 20):
                    for y in (0, 10, 20):
                        f.write(f"{x} {y} {0.01 * (x + y)}\n")
            script = textwrap.dedent(f"""
                import sys, types
                sys.modules["linuxcnc"] = types.ModuleType("linuxcnc")
                src = open({COMPENSATION!r}).read()
                entry = "comp = Compensation()\\ncomp.run()\\n"
                assert src.endswith(entry), "the module's entry lines moved"
                mod = types.ModuleType("compensation")
                mod.__file__ = {COMPENSATION!r}
                exec(compile(src[:-len(entry)], {COMPENSATION!r}, "exec"), mod.__dict__)
                def refuse(*a, **k):
                    raise PermissionError("folder not writable")
                mod.tempfile.mkstemp = refuse
                c = object.__new__(mod.Compensation)
                c.filename = {probe!r}
                c.h = {{"method": 1, "resolution": 5.0}}
                c.loadMap()
                print("LOADMAP RETURNED")
            """)
            r = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        self.assertIn("Grid write failed", r.stdout)
        self.assertIn("LOADMAP RETURNED", r.stdout)
        self.assertNotIn("NameError", r.stderr)
        _ = json   # the grid file is never written here


if __name__ == "__main__":
    unittest.main()
