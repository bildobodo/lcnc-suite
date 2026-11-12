"""The LinuxCNC interface (package 2a, plan vor-maschine R352/R353 VM352-01/03):
the fake's runtime shape, the code's status reads against the guaranteed /
optional fields, and the REAL binding by name (a child process without the
fake: lcnc_iface_check.py). The static half — stub and fake against the
Protocols — is pyright's (typings/conformance/)."""
import ast
import os
import subprocess
import sys
import unittest
from pathlib import Path

import fake_linuxcnc as fake
from lcnc_iface import COMMAND_METHODS, OPTIONAL_STAT_FIELDS, STAT_FIELDS

HERE = Path(__file__).resolve().parent


class FakeShape(unittest.TestCase):
    """The fake takes exactly the binding's positional arguments."""

    def setUp(self):
        self.cmd = fake._Command()

    def test_a_missing_or_extra_argument_is_refused(self):
        with self.assertRaises(TypeError):
            self.cmd.mdi()
        with self.assertRaises(TypeError):
            self.cmd.mdi("G0 X1", 1)
        with self.assertRaises(TypeError):
            self.cmd.home()
        with self.assertRaises(TypeError):
            self.cmd.jog(0, 0)
        with self.assertRaises(TypeError):
            self.cmd.wait_complete(1.0, 2)

    def test_a_keyword_is_refused_as_by_the_binding(self):
        with self.assertRaises(TypeError):
            self.cmd.mdi(command="G0 X1")
        with self.assertRaises(TypeError):
            self.cmd.home(joint=0)

    def test_an_unknown_command_does_not_exist(self):
        with self.assertRaises(AttributeError):
            _ = self.cmd.not_a_command

    def test_every_command_the_code_calls_is_declared(self):
        self.assertEqual([m for m in COMMAND_METHODS if not hasattr(self.cmd, m)], [])

    def test_wait_complete_answers_an_int_and_sends_count(self):
        self.assertEqual(self.cmd.wait_complete(), fake.CONSTANTS["RCS_DONE"])
        before = self.cmd.serial
        self.cmd.mdi("G0 X1")
        self.cmd.spindle(fake.CONSTANTS["SPINDLE_FORWARD"], 1000.0, 0.0)
        self.assertEqual(self.cmd.serial, before + 2)

    def test_an_unset_status_field_is_absent_never_a_state(self):
        stat = fake._Stat()
        with self.assertRaises(AttributeError):
            _ = stat.interp_state
        self.assertEqual(stat.axis_mask, 7)


def _status_reads(path: Path):
    """Literal field names read off a status: safe_get("x", …) /
    self.safe_get("x", …), and getattr(<stat>, "x", …)."""
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not node.args:
            continue
        f = node.func
        name = f.attr if isinstance(f, ast.Attribute) else (f.id if isinstance(f, ast.Name) else None)
        first = node.args[0]
        if name == "safe_get" and isinstance(first, ast.Constant) and isinstance(first.value, str):
            yield node.lineno, first.value
        elif (name == "getattr" and len(node.args) >= 2 and isinstance(node.args[0], ast.Name)
              and node.args[0].id in ("stat", "STAT", "s") and isinstance(node.args[1], ast.Constant)
              and isinstance(node.args[1].value, str)):
            yield node.lineno, node.args[1].value


class StatusReads(unittest.TestCase):
    """Every literal status name the product code reads is a guaranteed field
    (the stub declares it, the native check finds it) or a NAMED optional one
    with its fallback — the class of `spindle_override_enabled`, a name 2.9.4
    never had, read with a default True."""

    def test_every_status_read_is_guaranteed_or_named_optional(self):
        known = set(STAT_FIELDS) | OPTIONAL_STAT_FIELDS
        product = [p for p in sorted(HERE.glob("*.py"))
                   if not p.name.startswith("test_") and p.name not in ("fake_linuxcnc.py", "conftest.py")]
        unknown = [f"{p.name}:{line} {name}" for p in product for line, name in _status_reads(p)
                   if name not in known]
        self.assertEqual(unknown, [])

    def test_the_scan_sees_the_reads(self):
        reads = {name for _l, name in _status_reads(HERE / "status_runtime.py")}
        self.assertTrue({"interp_state", "spindle", "spindle_override"} <= reads, reads)


class NativeNames(unittest.TestCase):
    """The installed binding by NAME and constant VALUE (lcnc_iface_check.py in
    a child without the fake). Skipped only where the job says it has no
    binding (LCNC_NO_BINDING=1, the CI backend job) — anywhere else a missing
    or broken binding fails here."""

    def test_the_real_binding_has_the_interface(self):
        if os.environ.get("LCNC_NO_BINDING") == "1":
            self.skipTest("LCNC_NO_BINDING=1: this job has no LinuxCNC binding (named limit, Q352-4)")
        r = subprocess.run([sys.executable, "-I", str(HERE / "lcnc_iface_check.py")],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "ok"), r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
