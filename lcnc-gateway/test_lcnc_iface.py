"""The LinuxCNC interface (package 2a, plan vor-maschine R352/R353 VM352-01/03,
R354 VM-I01/I02): the fake's runtime shape and call forms, the code's status
reads against the guaranteed / optional fields, the stub-claim check against
surrogate modules (runs everywhere) and against the REAL modules (a child
process without the fake: lcnc_iface_check.py). The static half — stub and
fake against the Protocols, the refused forms — is pyright's
(typings/conformance/)."""
import ast
import os
import subprocess
import sys
import types
import unittest
from pathlib import Path

import fake_linuxcnc as fake
import lcnc_iface_check as check
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

    def test_the_fake_module_has_every_module_name_the_stub_claims(self):
        claims = check.stub_claims((check.TYPINGS / "linuxcnc.pyi").read_text())
        module = fake.build_module()
        self.assertEqual(sorted(n for n in claims.names if not hasattr(module, n)), [])
        self.assertTrue(issubclass(module.error, RuntimeError))

    def test_the_fake_constants_are_the_stubs(self):
        claims = check.stub_claims((check.TYPINGS / "linuxcnc.pyi").read_text())
        self.assertEqual(fake.CONSTANTS, claims.values)

    def test_an_unset_status_field_is_absent_never_a_state(self):
        stat = fake._Stat()
        with self.assertRaises(AttributeError):
            _ = stat.interp_state
        self.assertEqual(stat.axis_mask, 7)


class FakeForms(unittest.TestCase):
    """The sub-operation picks the form, as in the binding (emcmodule.cc
    v2.9.4 emcauto / jog / spindle / mode / state / mist / flood; R354
    VM-I01): a refused form raises the binding's exception and is NOT counted
    as sent."""

    C = fake.CONSTANTS

    def setUp(self):
        self.cmd = fake._Command()

    def refused(self, exc, call, *args):
        before = self.cmd.serial
        with self.assertRaises(exc):
            call(*args)
        self.assertEqual(self.cmd.serial, before, f"{call.__name__}{args} was counted as sent")

    def test_the_six_refused_auto_and_jog_forms(self):
        C, c = self.C, self.cmd
        self.refused(fake.error, c.auto, C["AUTO_RUN"])               # the start line is missing
        self.refused(TypeError, c.auto, C["AUTO_PAUSE"], 1)           # only AUTO_RUN takes a line
        self.refused(TypeError, c.jog, C["JOG_CONTINUOUS"], 0, 0)     # the speed is missing
        self.refused(TypeError, c.jog, C["JOG_INCREMENT"], 0, 0, 1.0)  # the step is missing
        self.refused(TypeError, c.jog, C["JOG_STOP"], 0, 0, 1.0)      # a stop takes no speed
        self.refused(TypeError, c.jog, 999, 0, 0)                     # no such sub-operation
        self.refused(TypeError, c.jog, C["JOG_STOP"], 0, 0, 1.0, 0.1)
        self.refused(TypeError, c.jog, C["JOG_CONTINUOUS"], 0, 0, 1.0, 0.1)   # a step it does not take
        self.refused(TypeError, c.auto, C["AUTO_STEP"], 1)

    def test_unknown_selectors_and_argument_types(self):
        C, c = self.C, self.cmd
        self.refused(fake.error, c.auto, 99)
        self.refused(TypeError, c.auto, C["AUTO_RUN"], 1.5)
        self.refused(TypeError, c.jog, C["JOG_CONTINUOUS"], 0, None, 1.0)
        self.refused(ValueError, c.spindle, 7)
        self.refused(ValueError, c.mode, 0)
        self.refused(ValueError, c.state, 5)
        self.refused(ValueError, c.mist, 2)
        self.refused(ValueError, c.flood, 2)

    def test_the_binding_error_is_a_runtime_error(self):
        self.assertTrue(issubclass(fake.error, RuntimeError))

    def test_every_accepted_form_is_counted(self):
        C, c = self.C, self.cmd
        before = c.serial
        c.auto(C["AUTO_RUN"], 0)
        for fn in ("AUTO_PAUSE", "AUTO_RESUME", "AUTO_STEP", "AUTO_REVERSE", "AUTO_FORWARD"):
            c.auto(C[fn])
        c.jog(C["JOG_STOP"], 0, 0)
        c.jog(C["JOG_CONTINUOUS"], True, 2, -5.0)
        c.jog(C["JOG_INCREMENT"], 0, 1, 5.0, 0.1)
        c.spindle(C["SPINDLE_OFF"])
        c.spindle(C["SPINDLE_FORWARD"], 1000.0, 0)
        c.spindle(C["SPINDLE_REVERSE"], 1000.0, 0, 1)
        c.spindle(C["SPINDLE_INCREASE"], 0)
        c.mode(C["MODE_MDI"])
        c.state(C["STATE_ESTOP_RESET"])
        c.mist(C["MIST_ON"])
        c.flood(C["FLOOD_OFF"])
        self.assertEqual(c.serial, before + 17)   # 6 auto, 3 jog, 4 spindle, 4 selectors


def _surrogate(stubs: dict[str, str]) -> dict[str, object]:
    """A module per stub that has EXACTLY what the stub claims — classes with
    their members, constants with their values."""
    out: dict[str, object] = {}
    for modname, text in stubs.items():
        claims = check.stub_claims(text)
        mod = types.ModuleType(modname)
        for name in claims.names:
            if name in claims.members:
                setattr(mod, name, type(name, (), {m: None for m in claims.members[name]}))
            else:
                setattr(mod, name, claims.values.get(name, object()))
        out[modname] = mod
    return out


class StubClaims(unittest.TestCase):
    """The stub-claim check (lcnc_iface_check.problems) against surrogate
    modules — runs without LinuxCNC (R354 VM-I02): an extra stub member, a
    missing module name and a changed constant are found; an extra REAL member
    and an optional field present or absent are not."""

    def setUp(self):
        self.stubs = {m: (check.TYPINGS / rel).read_text() for m, rel in check.STUBS.items()}
        self.modules = _surrogate(self.stubs)

    def test_a_surface_with_exactly_the_claims_passes(self):
        self.assertEqual(check.problems(self.modules, self.stubs), [])

    def test_the_stub_claims_are_read(self):
        claims = check.stub_claims(self.stubs["linuxcnc"])
        self.assertTrue({"stat", "command", "ini", "error_channel", "tool", "error", "AUTO_RUN"} <= claims.names)
        self.assertIn("jog", claims.members["command"])
        self.assertIn("orientation", claims.members["tool"])
        self.assertEqual(claims.values["SPINDLE_REVERSE"], -1)
        self.assertNotIn("JointStatus", claims.names)      # an imported helper type is no claim
        self.assertEqual(check.stub_claims(self.stubs["hal"]).values["HAL_RW"], 192)
        self.assertNotIn("_PinInfo", check.stub_claims(self.stubs["hal"]).names)

    def test_an_extra_stub_member_is_found(self):
        stubs = dict(self.stubs)
        stubs["linuxcnc"] = stubs["linuxcnc"].replace(
            "    def abort(self) -> None: ...", "    def abort(self) -> None: ...\n    def codex_nonexistent(self) -> None: ...", 1)
        self.assertIn("linuxcnc.command.codex_nonexistent is claimed by the stub and missing",
                      check.problems(self.modules, stubs))

    def test_a_missing_module_name_is_found(self):
        delattr(self.modules["linuxcnc"], "ini")
        self.assertIn("linuxcnc.ini is claimed by the stub and missing", check.problems(self.modules, self.stubs))

    def test_a_changed_constant_is_found(self):
        self.modules["hal"].HAL_OUT = 31
        self.assertIn("hal.HAL_OUT is 31, the stub says 32", check.problems(self.modules, self.stubs))

    def test_a_missing_stub_is_a_problem_never_a_skip(self):
        stubs = dict(self.stubs)
        del stubs["gcode"]
        self.assertIn("no stub text for gcode", check.problems(self.modules, stubs))

    def test_extra_real_members_and_optional_fields_are_allowed(self):
        lc = self.modules["linuxcnc"]
        lc.command.brake = None                             # the binding has more than the code uses
        self.assertEqual(check.problems(self.modules, self.stubs), [])
        for name in OPTIONAL_STAT_FIELDS:                     # optional: present …
            setattr(lc.stat, name, None)
        self.assertEqual(check.problems(self.modules, self.stubs), [])
        for name in OPTIONAL_STAT_FIELDS:                     # … or absent
            delattr(lc.stat, name)
        self.assertEqual(check.problems(self.modules, self.stubs), [])

    def test_an_optional_field_is_never_a_stub_claim(self):
        claims = check.stub_claims(self.stubs["linuxcnc"])
        self.assertEqual(OPTIONAL_STAT_FIELDS & claims.members["stat"], set())


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
    """The installed modules by every stub claim — names, members, constant
    values (lcnc_iface_check.py in a child without the fake). Skipped only
    where the job says it has no binding (LCNC_NO_BINDING=1, the CI backend
    job) — anywhere else a missing or broken binding fails here."""

    def test_the_real_binding_has_the_interface(self):
        if os.environ.get("LCNC_NO_BINDING") == "1":
            self.skipTest("LCNC_NO_BINDING=1: this job has no LinuxCNC binding (named limit, Q352-4)")
        r = subprocess.run([sys.executable, "-I", str(HERE / "lcnc_iface_check.py")],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "ok"), r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
