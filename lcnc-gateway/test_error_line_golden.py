"""The parse error's line, on the REAL interpreter (P4-7, machine day F29,
Codex R433/R434): a line only where its origin is proven.

Measured 2026-11-22 on LinuxCNC 2.9.4's gcode module: parse()'s returned
sequence number is no line — one past it for an error found while reading
(prog_read: line 3 → 4), the line for one found while executing (the arc),
the call's line + 1 for an error inside a called file, 0 or 1 inside a
remap (the machine's "(LINE 0)"). The worker now names the main file's line
only where its main context (no call, no remap) and the failing block's byte
offset agree; an error inside a sub or a remap says no line, and a frame an
earlier call left behind proves nothing.

The worker runs in a subprocess with the real modules (this process has the
fake binding); skipped where the native interpreter module is missing.
"""
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_HAS_GCODE = subprocess.run([sys.executable, "-c", "import gcode"], capture_output=True).returncode == 0

PROGRAMS = {
    # name: (text, the proven line or None)
    "read_error": ("G21 G90\nG0 X0\nG1 X1 F100 Q\nM2\n", 3),
    "exec_error": ("G21 G90 G17\nG0 X0 Y0\nG1 X1 F100\nG2 X10 Y0 R1\nG1 X2\nM2\n", 4),
    "after_a_call": ("G21 G90\nG0 X0\no<good_sub> call\nG1 X1 F100\nG1 X2\nG1 X3 Q\nM2\n", 6),
    "after_a_remap": ("G21 G90\nG0 X0\nM611\nG1 X1 F100\nG1 X2\nG2 X10 Y0 R1\nM2\n", 6),
    "in_a_sub_file": ("G21 G90\nG0 X0\nG0 Y0\nG0 Z0\nG1 X1 F100\nG1 X2\nG1 X3\no<bad_sub> call\nG1 X4\nM2\n", None),
    "in_a_remap": ("G21 G90\nG0 X0\nG0 Y0\nG0 Z0\nG1 X1 F100\nG1 X2\nG1 X3\nM610\nG1 X4\nM2\n", None),
    "in_an_inline_sub": ("G21 G90\nG0 X0\nO100 sub\nG1 X1 Q\nO100 endsub\nO100 call\nM2\n", None),
}
SUBS = {
    "bad_sub.ngc": "o<bad_sub> sub\nG0 X0\nG1 X1 Q\no<bad_sub> endsub\nM2\n",
    "good_sub.ngc": "o<good_sub> sub\nG0 X0\no<good_sub> endsub\nM2\n",
    "m610_bad.ngc": "o<m610_bad> sub\nG0 X0\nG1 X1 Q\no<m610_bad> endsub\nM2\n",
    "m611_good.ngc": "o<m611_good> sub\nG0 X0\no<m611_good> endsub\nM2\n",
}
RUNNER = textwrap.dedent("""
    import json, os, sys
    sys.path.insert(0, sys.argv[1])
    import gcode_parse_worker as worker
    out = {}
    for prog in sys.argv[3:]:
        r = worker.parse({"file": prog, "ini_path": sys.argv[2], "units": "mm"})
        out[os.path.basename(prog)] = [r.get("parse_error"), r.get("error_line")]
    print("__RESULT__" + json.dumps(out))
""")


@unittest.skipUnless(_HAS_GCODE, "no native LinuxCNC interpreter module")
class TestTheProvenErrorLine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        (d / "subs").mkdir()
        for name, text in SUBS.items():
            (d / "subs" / name).write_text(text)
        (d / "sim.var").write_text("")
        (d / "tool.tbl").write_text("T1 P1 D6 Z50 ;\n")
        ini = d / "mini.ini"
        ini.write_text(
            "[EMC]\nVERSION = 1.1\n[RS274NGC]\nPARAMETER_FILE = sim.var\n"
            f"SUBROUTINE_PATH = {d / 'subs'}\n"
            "REMAP=M610 modalgroup=6 ngc=m610_bad\nREMAP=M611 modalgroup=6 ngc=m611_good\n"
            "[EMCIO]\nTOOL_TABLE = tool.tbl\n[TRAJ]\nLINEAR_UNITS = mm\nANGULAR_UNITS = degree\n"
            "COORDINATES = X Y Z\n[KINS]\nKINEMATICS = trivkins\nJOINTS = 3\n")
        progs = []
        for name, (text, _line) in PROGRAMS.items():
            p = d / f"{name}.ngc"
            p.write_text(text)
            progs.append(str(p))
        r = subprocess.run([sys.executable, "-c", RUNNER, str(HERE), str(ini), *progs],
                           capture_output=True, text=True, cwd=str(d), timeout=300,
                           env={**os.environ, "INI_FILE_NAME": str(ini)})
        lines = [ln for ln in r.stdout.splitlines() if ln.startswith("__RESULT__")]
        if not lines:
            raise AssertionError(f"the worker ran no programs: rc={r.returncode} {r.stderr[-800:]}")
        cls.got = json.loads(lines[-1][len("__RESULT__"):])

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_each_program_names_only_its_proven_line(self):
        for name, (_text, line) in PROGRAMS.items():
            with self.subTest(name):
                error, got = self.got[f"{name}.ngc"]
                self.assertTrue(error, f"{name}: the program must fail to parse")
                self.assertEqual(got, line)


if __name__ == "__main__":
    unittest.main()
