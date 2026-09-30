"""The pinned re-parse (operator 2026-09-29, Codex R40 MR-I01/MR-I02) against
the REAL worker and LinuxCNC's native offline interpreter — trajectory, TLO
events and limit findings, not only the ctx the worker was sent.

native_pinned_probe.py runs in its own process (the conftest's fake
`linuxcnc` must not shadow the real one there); it reports `skip` where the
native modules are missing (CI without LinuxCNC). It never touches a running
LinuxCNC: `linuxcnc.stat` is replaced by a synthetic STAT, `linuxcnc.command`
raises, `linuxcnc.ini` reads the probe's own temp INI and `gcode.parse` is the
offline interpreter (no NML) — the result is the same with or without a sim
running."""
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


class TestPinnedWorkerNative(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        env = dict(os.environ)
        env.pop("PYTHONPATH", None)
        p = subprocess.run([sys.executable, os.path.join(HERE, "native_pinned_probe.py")],
                           capture_output=True, text=True, timeout=120, env=env, cwd=HERE)
        cls.proc = p
        lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
        cls.result = json.loads(lines[-1]) if lines else None

    def setUp(self):
        if self.result is None:
            self.fail(f"probe produced no result: rc={self.proc.returncode} "
                      f"stderr={self.proc.stderr[-800:]}")
        if "skip" in self.result:
            self.skipTest(self.result["skip"])

    def _check(self, name):
        self.assertIs(self.result["checks"].get(name), True, name)

    def test_the_spindle_pocket_is_the_start_tool(self):
        for name in ("pinned_spindle_keeps_the_start_tool", "pinned_spindle_keeps_the_limit_findings",
                     "an_idle_parse_takes_the_live_spindle", "pinned_meta_reports_the_start_tool",
                     "pinned_spindle_takes_the_new_length"):
            self._check(name)

    def test_the_parameter_basis_is_the_published_one(self):
        for name in ("pinned_keeps_g92", "pinned_keeps_g30", "pinned_wcsoff_reports_the_start_g92",
                     "an_idle_parse_takes_the_new_parameters"):
            self._check(name)

    def test_the_table_time_is_read_before_the_status(self):
        self._check("table_time_read_before_the_status")

    def test_a_random_toolchanger_refuses_the_pin(self):
        self._check("random_toolchanger_refuses_the_pin")


if __name__ == "__main__":
    unittest.main()
