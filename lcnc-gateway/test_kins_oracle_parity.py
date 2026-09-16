"""The two vendored copies of xyzacb_trsrn.comp must agree on the math.

There are two on purpose and they cannot be merged:

  scripts/kins_oracle/xyzacb_trsrn.comp   — the FIXTURE ORACLE. Tracks current
      LinuxCNC master, whose handle-style HAL pin API (hal_real_t,
      hal_get_real, hal_pin_new_real) the harness stubs mirror. LinuxCNC 2.9's
      halcompile cannot parse it at all.

  examples/sim_config/twp/xyzacb_trsrn.comp — the INSTALLABLE runtime module
      for the TWP sim config, revision @493926b56c, using the classic pointer
      API that 2.9's halcompile accepts.

Every kins fixture, both twins and the joint-side soft-limit checks are pinned
to the ORACLE's math, while the machine actually runs the RUNTIME one. If the
two ever disagree, the whole stack would be validated against kinematics no
machine executes — a divergence that no other test could see, because each
side is self-consistent.

So this compares the two `kinematicsForward` / `kinematicsInverse` bodies
directly, normalising only the accessor spelling (`hal_get_real(haldata->x)`
vs `*haldata->x`) and dropping comments and unused-argument casts. It does NOT
compare the surrounding scaffolding: master deleted the demo pin, the
`fdemo` function and the `is_ready` message, none of which is kinematics.
"""
import pathlib
import re
import unittest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
ORACLE = _ROOT / "scripts" / "kins_oracle" / "xyzacb_trsrn.comp"
RUNTIME = _ROOT / "examples" / "sim_config" / "twp" / "xyzacb_trsrn.comp"

_FUNCS = ("kinematicsForward", "kinematicsInverse")


# A statement is KINEMATICS if it declares a local double or writes an output
# coordinate. Everything else inside these functions is scaffolding the two
# revisions genuinely disagree about (master dropped the demo pin echo, the
# `gave_msg` warning and the `is_ready` latch) and none of it touches a
# coordinate. Keeping the rule this narrow is what makes a passing comparison
# mean something: anything excluded provably cannot change a joint value.
_KEEP = re.compile(r"""^(
    double\s+\w+\s*=          # local double declarations (the geometry terms)
  | pos->[\w.]+\s*=           # forward outputs
  | j\[\d+\]\s*=              # inverse outputs
  | switch\s*\(               # the case structure the outputs live in
  | case\s+\d+\s*:
)""", re.VERBOSE)


def _math(path):
    """The kinematics statements of each function, accessor-style normalised."""
    text = path.read_text()
    # halcompile's own split: everything after `;;` is the C body.
    body = text.split(";;", 1)[1]
    body = re.sub(r"hal_get_real\(haldata->(\w+)\)", r"*haldata->\1", body)
    body = re.sub(r"\*\(haldata->(\w+)\)", r"*haldata->\1", body)
    out = []
    for fn in _FUNCS:
        start = body.index("int " + fn)
        end = body.index("} // " + fn)
        chunk = body[start:end]
        chunk = re.sub(r"//.*", "", chunk)                     # comments
        chunk = re.sub(r"/\*.*?\*/", "", chunk, flags=re.S)    # block comments
        # Split into statements, normalise whitespace, keep only kinematics.
        stmts = []
        for raw in chunk.replace("{", ";").replace("}", ";").split(";"):
            s = re.sub(r"\s+", " ", raw).strip()
            if s and _KEEP.match(s):
                stmts.append(s)
        out.append((fn, stmts))
    return dict(out)


class TestKinsOracleParity(unittest.TestCase):
    def test_both_copies_are_present(self):
        # A missing runtime copy means the shipped TWP config cannot be built
        # at all; a missing oracle means the fixtures have no source.
        self.assertTrue(ORACLE.is_file(), f"missing oracle: {ORACLE}")
        self.assertTrue(RUNTIME.is_file(), f"missing runtime comp: {RUNTIME}")

    def test_kinematics_math_is_identical(self):
        a, b = _math(ORACLE), _math(RUNTIME)
        for fn in _FUNCS:
            self.assertEqual(
                a[fn], b[fn],
                f"{fn} differs between the oracle and the installed runtime "
                f"comp — the twins and every kins fixture are pinned to the "
                f"oracle, but the machine runs the runtime module")
            # Guard against the extraction silently matching nothing: all
            # three switchkins cases write three linear joints plus three
            # rotary passthroughs, so the real count is well above this.
            self.assertGreater(len(a[fn]), 20, f"{fn}: extraction found no math")

    def test_the_two_really_are_different_files(self):
        # Guards the guard: if someone "fixes" the duplication by copying one
        # over the other, the parity test above would pass vacuously while the
        # runtime comp stopped compiling on 2.9 (or the harness stopped
        # building). The difference is the point.
        self.assertNotEqual(ORACLE.read_text(), RUNTIME.read_text())
        self.assertIn("hal_get_real", ORACLE.read_text())
        self.assertNotIn("hal_get_real", RUNTIME.read_text())

    def test_runtime_comp_uses_the_api_29_halcompile_accepts(self):
        # The concrete reason the runtime copy exists: 2.9's halcompile cannot
        # parse master's `si32` pin type or its handle-style declarations.
        rt = RUNTIME.read_text()
        self.assertNotIn("si32", rt)
        self.assertIn("hal_pin_float_newf", rt)


if __name__ == "__main__":
    unittest.main()
