"""The bundled calibration routines on LinuxCNC's REAL interpreter (P5-1 a,
plan v6, MT439-05): they carry the run token through CALL, parameter and DEBUG
exactly, never write #3032 (nor leave it changed when they abort), and compute
with the argument [0] exactly what the upstream form computed with #3032 = 0.

`rs274` (linuxcnc's standalone interpreter) has no probe: its probing moves
report no contact, so the XY / Z probing subroutines are replaced by stubs
earlier on SUBROUTINE_PATH that put known edges into #5061 / #5062 and report
their offset argument — the routines' own lines run unchanged. What a probe
input does is the native stage's `p5` run.

Every run has a HOME of its own: `rs274` creates LinuxCNC's tool-data file
`$HOME/.tool.mmap` anew, and a LinuxCNC running on this machine maps that very
file — the first runs (2026-11-24) replaced the live sim's tool table with the
test's one tool."""
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "subroutines/probe_basic"
#: the four routines as upstream has them (the bundle before P5), rebuilt from
#: the bundled files by undoing exactly the documented change (ORIGINS.md)
CAL = ("probe_cal_round_pocket", "probe_cal_round_boss", "probe_cal_square_pocket", "probe_cal_square_boss")
RS274 = shutil.which("rs274")
#: the job that declares it has no LinuxCNC (the CI's backend job) skips, by name
NO_BINDING = os.environ.get("LCNC_NO_BINDING") == "1"

# the edges the stubs "touch": the i-th probing call gets the i-th value (no two widths alike), so a
# lost or added call changes every later number
EDGE = "[[#<_n> * #<_n> * 1.37] + 3.5]"


def stub(name: str, param: int) -> str:
    return (f"o<{name}> sub\n  #<_n> = [#<_n> + 1]\n  (DEBUG, STUB {name} offset=#7)\n"
            f"  #{param} = {EDGE}\no<{name}> endsub\nM2\n")


def upstream(text: str) -> str:
    """The routine before P5 (Codex MT439-05's `today`)."""
    text = re.sub(r"  \(LCNC Suite: the run token.*?  #1014 = #1\n",
                  '  (clear current probe calibration offset)\n  #3032 = 0\n'
                  '  (DEBUG, EVAL[vcp.getWidget{"calibration_offset_3032"}.setValue{#3032}])\n', text, flags=re.S)
    text = re.sub(r"(o<probe_[xy]_(?:plus|minus)> call .*)\[0\]", r"\1[#3032]", text)
    text = text.replace("#1013 = [ABS", "#3032 = [ABS")
    return text.replace("(DEBUG, LCNC_CAL_CANDIDATE run=#1014 value=#1013 axis=#3036)",
                        '(DEBUG, EVAL[vcp.getWidget{"calibration_offset_3032"}.setValue{#3032}])')


@unittest.skipIf(NO_BINDING, "LCNC_NO_BINDING=1: no LinuxCNC in this job")
class TestOnTheInterpreter(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(RS274, "rs274 is part of LinuxCNC — set LCNC_NO_BINDING=1 where there is none")
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.dir = Path(d.name)

    def run_routine(self, routine, token="[12]", axis=0, upstream_form=False, abort_at_start=False, offset=0.2):
        """({message lines}, #3032 after the run) of one call."""
        d = Path(tempfile.mkdtemp(dir=self.dir))
        subs, stubs = d / "subs", d / "stubs"
        subs.mkdir()
        stubs.mkdir()
        for p in BUNDLE.glob("*.ngc"):
            text = p.read_text()
            (subs / p.name).write_text(upstream(text) if upstream_form and p.stem in CAL else text)
        if not abort_at_start:
            for name, param in (("probe_x_plus", 5061), ("probe_x_minus", 5061), ("probe_y_plus", 5062),
                                ("probe_y_minus", 5062), ("probe_z_minus_sub", 5063)):
                (stubs / (name + ".ngc")).write_text(stub(name, param))
        values = {k: 0.0 for base in range(5161, 5400, 1) for k in (base,)}
        values[5220] = 1.0
        values.update({3014: 99, 3015: 50, 3016: 200, 3017: 1000, 3018: 10, 3019: 2, 3020: 10, 3021: 2, 3022: 0,
                       3023: 5, 3024: .5, 3030: 1, 3031: 0, 3032: offset, 3033: 20, 3034: 80, 3035: 81, 3036: axis})
        for k in (3025, 3026, 3027, 3028, 3029):
            values[k] = 0.0
        var = d / "v.var"
        var.write_text("".join(f"{k}\t{v:.6f}\n" for k, v in sorted(values.items())))
        (d / "tool.tbl").write_text("T99 P1 D2 Z50 ;probe\n")
        ini = d / "m.ini"
        ini.write_text(f"[RS274NGC]\nSUBROUTINE_PATH = {stubs}:{subs}\nPARAMETER_FILE = {var}\n"
                       f"[TRAJ]\nLINEAR_UNITS = mm\n[EMCIO]\nTOOL_TABLE = {d / 'tool.tbl'}\n")
        ngc = d / "run.ngc"
        ngc.write_text(f"G21 G90\n#<_n> = 0\nT99 M6\nG0 X0 Y0 Z0\no<{routine}> call {token}\n(DEBUG, END)\nM2\n")
        home = d / "home"
        home.mkdir()
        out = subprocess.run([RS274, "-g", "-i", str(ini), "-v", str(var), "-t", str(d / "tool.tbl"), str(ngc)],
                             capture_output=True, text=True, timeout=60, cwd=d, env={**os.environ, "HOME": str(home)})
        self.assertTrue((home / ".tool.mmap").exists(), "the tool data went to the run's own HOME, never the operator's")
        msgs = re.findall(r'MESSAGE\("(.*)"\)', out.stdout)
        after = next(line.split()[1] for line in var.read_text().splitlines() if line.startswith("3032"))
        return msgs, float(after), out.stdout + out.stderr

    def candidate(self, msgs):
        found = [m for m in msgs if "LCNC_CAL_CANDIDATE" in m]
        self.assertEqual(len(found), 1, msgs)
        m = re.fullmatch(r"\s*LCNC_CAL_CANDIDATE run=(\S+) value=(\S+) axis=(\S+)", found[0])
        return m.group(1), float(m.group(2)), m.group(3)

    def test_the_token_comes_back_exactly_at_the_bounds(self):
        from cal_runs import MAX_RUN, CandidateMsg, parse_candidate
        for n in (1, 4_194_304, MAX_RUN):
            msgs, _after, log = self.run_routine("probe_cal_round_pocket", f"[{n}]")
            run, value, _axis = self.candidate(msgs)
            self.assertEqual(run, f"{n}.000000", log[-400:])
            line = next(m for m in msgs if "LCNC_CAL_CANDIDATE" in m)
            self.assertEqual(parse_candidate(line), CandidateMsg(n, value, 0))
        # a token with decimals is printed as such — and is no token
        msgs, _after, _log = self.run_routine("probe_cal_round_pocket", "[12.5]")
        self.assertIsInstance(parse_candidate(next(m for m in msgs if "LCNC_CAL_CANDIDATE" in m)), str)

    def test_each_routine_computes_what_upstream_did_and_leaves_3032(self):
        for routine in CAL:
            for axis in (0, 1, 2):
                new, after_new, log = self.run_routine(routine, "[77]", axis)
                old, after_old, _ = self.run_routine(routine, "", axis, upstream_form=True)
                self.assertIn(" END", new, (routine, axis, log[-600:]))
                self.assertIn(" END", old, (routine, axis))
                run, value, at = self.candidate(new)
                self.assertEqual((run, at), ("77.000000", f"{axis}.000000"))
                # the old form left its result in #3032 — the new one in its line
                self.assertAlmostEqual(value, after_old, places=6, msg=(routine, axis))
                self.assertEqual(after_new, 0.2, (routine, axis))
                # every probing call got offset 0, as under #3032 = 0; the results in between are the same
                stubs = [m for m in new if "STUB" in m and "z_minus" not in m]
                self.assertTrue(stubs)
                self.assertTrue(all(m.endswith("offset=0.000000") for m in stubs), stubs)
                same = [m for m in new if "LCNC_CAL" not in m and "z_minus" not in m]
                self.assertEqual(same, [m for m in old if "calibration_offset" not in m and "z_minus" not in m],
                                 (routine, axis))

    def test_the_three_axis_choices_are_three_values(self):
        for routine in CAL:
            got = [self.candidate(self.run_routine(routine, "[5]", a)[0])[1] for a in (0, 1, 2)]
            self.assertEqual(len({round(v, 6) for v in got}), 3, (routine, got))
            self.assertAlmostEqual(got[0], (got[1] + got[2]) / 2, places=5, msg=routine)

    def test_an_abort_at_the_first_probe_leaves_the_active_offset(self):
        # no stub: the real subs find no contact and abort — upstream left #3032 = 0
        for routine in CAL:
            msgs, after, _log = self.run_routine(routine, "[9]", abort_at_start=True)
            self.assertFalse([m for m in msgs if "LCNC_CAL" in m], routine)
            self.assertEqual(after, 0.2, routine)
            _msgs, after, _log = self.run_routine(routine, "", upstream_form=True, abort_at_start=True)
            self.assertEqual(after, 0.0, "the upstream form is what this replaces")


class TestTheFiles(unittest.TestCase):
    def test_the_documented_change_is_the_whole_change(self):
        for routine in CAL:
            text = (BUNDLE / (routine + ".ngc")).read_text()
            self.assertEqual(text.count("LCNC_CAL_CANDIDATE"), 1, routine)
            self.assertEqual(text.count("#1014 = #1"), 1, routine)
            self.assertEqual(len(re.findall(r"#1013 = \[ABS", text)), 3, routine)
            self.assertNotRegex(text, r"#3032\s*=(?!\w)")
            self.assertNotIn("calibration_offset_3032", text)
            # the result line stands after the LAST assignment of the result
            self.assertGreater(text.index("LCNC_CAL_CANDIDATE"), text.rindex("#1013 ="), routine)
            self.assertFalse(re.findall(r"o<probe_[xy]_\w+> call .*#3032", text), routine)


if __name__ == "__main__":
    unittest.main()
