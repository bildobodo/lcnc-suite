"""Macro files (package 5, stage B): the header grammar, the body checks,
the call line and the interpreter's file lookup — pure, macro_files.py."""
import os
import tempfile
import unittest

import macro_files as mf

FACE = """(MACRO Face top)
(UNITS mm)
(PARAM 1 width "Width" length 50 min=1 max=500)
(PARAM 2 depth "Depth" length 0.5 min=0 max=5)
(PARAM 3 feed "Feed" feed 600 min=1)
(PARAM 4 passes "Passes" count 3 min=1 max=20 integer)
(Faces the stock top; a free description line.)
(MSG, a comment command is description too)
o<face_top> sub
  M73
  G21 G90 G94
  G0 Z5
  G1 Z[-#2] F#3
o<face_top> endsub
M2
"""


def parse(text, name="face_top"):
    return mf.parse_macro(name, text)


def messages(meta):
    return [e["message"] for e in meta["errors"]]


class HeaderGrammar(unittest.TestCase):
    def test_a_full_header_parses(self):
        m = parse(FACE)
        self.assertEqual(m["errors"], [])
        self.assertEqual(m["title"], "Face top")
        self.assertEqual(m["units"], "mm")
        self.assertEqual([p["key"] for p in m["params"]], ["width", "depth", "feed", "passes"])
        self.assertEqual(m["params"][3], {"n": 4, "key": "passes", "label": "Passes", "unit": "count",
                                          "default": 3.0, "min": 1.0, "max": 20.0, "integer": True})
        self.assertEqual(len(m["description"]), 2)

    def test_no_header_and_no_params_is_fine(self):
        m = parse("o<park> sub\nG0 X0\no<park> endsub\n", "park")
        self.assertEqual(m["errors"], [])
        self.assertIsNone(m["title"])

    def bad(self, header, needle, name="face_top", body="M73\nG21 G94\n"):
        text = header + f"o<{name}> sub\n{body}o<{name}> endsub\n"
        msgs = messages(parse(text, name))
        self.assertTrue(any(needle in x for x in msgs), msgs)

    def test_header_errors_are_named(self):
        self.bad("(PARM 1 a \"A\" none 1)\n", "Unknown header word PARM")
        self.bad("(MACRO a)\n(MACRO b)\n", "MACRO twice")
        self.bad("(UNITS cm)\n", "UNITS is mm or inch")
        self.bad("(FRAME work)\n", "FRAME is machine")
        self.bad("(PARAM 1 a \"A\" none 1)\n(PARAM 1 b \"B\" none 1)\n", "position 1 twice")
        self.bad("(PARAM 1 a \"A\" none 1)\n(PARAM 2 a \"B\" none 1)\n", "key a twice")
        self.bad("(PARAM 1 A \"A\" none 1)\n", "lower-case identifier")
        self.bad("(PARAM 1 a \"\" none 1)\n", "label")
        self.bad("(PARAM 1 a \"A\" inches 1)\n", "unit 'inches'")
        self.bad("(PARAM 1 a \"A\" none x)\n", "not a number")
        self.bad("(PARAM 1 a \"A\" none 1 min=5 max=2)\n", "above max")
        self.bad("(PARAM 1 a \"A\" count 1.5 integer)\n", "not an integer")
        self.bad("(PARAM 1 a \"A\" none 9 max=5)\n", "outside its range")
        self.bad("(PARAM 1 a \"A\" none 1 step=2)\n", "option 'step=2'")
        self.bad("(PARAM 2 a \"A\" none 1)\n", "without a gap")
        self.bad("(PARAM 31 a \"A\" none 1)\n", "1 … 30")
        self.bad("(PARAM 1 a \"A\" length 1)\n", "UNITS mm or UNITS inch is required")

    def test_file_name_and_sub_name(self):
        self.assertIn("File name", messages(parse("o<Park> sub\no<Park> endsub\n", "Park"))[0])
        m = parse("o<other> sub\no<other> endsub\n", "park")
        self.assertTrue(any("file name says o<park>" in x for x in messages(m)), messages(m))
        m = parse("o<park> sub\no<park> endsub\no<two> sub\no<two> endsub\n", "park")
        self.assertTrue(any("One subroutine per file" in x for x in messages(m)))
        self.assertTrue(any("No o<park> endsub" in x for x in messages(parse("o<park> sub\nG0 X0\n", "park"))))
        self.assertTrue(any("No o<park> sub" in x for x in messages(parse("(MACRO P)\n", "park"))))

    def test_names_are_read_as_the_interpreter_reads_them(self):
        # white space and case outside comments do not matter to LinuxCNC
        self.assertEqual(parse("O< PARK > SUB\nO<park> ENDSUB\n", "park")["errors"], [])


class BodyChecks(unittest.TestCase):
    def test_m2_m30_and_percent_before_endsub_refuse(self):
        for line, needle in [("M2", "M2 in the macro"), ("G0 X1 M30", "M30 in the macro"), ("m02", "M2 in"),
                             ("%", "% before endsub")]:
            m = parse(f"o<p> sub\n{line}\no<p> endsub\n", "p")
            self.assertTrue(any(needle in x for x in messages(m)), (line, messages(m)))
        self.assertTrue(any("% before endsub" in x for x in messages(parse("%\no<p> sub\no<p> endsub\n", "p"))))

    def test_not_m2_lookalikes(self):
        for line in ["M200", "M21", "#<_m2> = 1", "(M2 in a comment)", "G0 X2 ; M30 after a semicolon", "M[2]"]:
            self.assertEqual(parse(f"o<p> sub\n{line}\no<p> endsub\n", "p")["errors"], [], line)

    def test_after_endsub_anything_goes_and_code_before_sub_refuses(self):
        self.assertEqual(parse("o<p> sub\no<p> endsub\nM2\n%\n", "p")["errors"], [])
        self.assertTrue(any("never runs" in x for x in messages(parse("G0 X0\no<p> sub\no<p> endsub\n", "p"))))

    def test_entry_rule(self):
        ok = FACE
        self.assertEqual(parse(ok)["errors"], [])
        no_m73 = ok.replace("  M73\n", "")
        self.assertTrue(any("M73 alone" in x for x in messages(parse(no_m73))))
        m73_with_g = ok.replace("  M73\n  G21 G90 G94\n", "  M73 G21 G94\n  G0 Z5\n")
        self.assertTrue(any("M73 alone" in x for x in messages(parse(m73_with_g))))
        no_g94 = ok.replace("G21 G90 G94", "G21 G90")
        self.assertTrue(any("must set G94" in x for x in messages(parse(no_g94))))
        inch = ok.replace("(UNITS mm)", "(UNITS inch)")
        self.assertTrue(any("must set G20" in x for x in messages(parse(inch))))
        rpm = ("(PARAM 1 s \"Speed\" rpm 1000)\no<w> sub\nM73\nG90\no<w> endsub\n")
        self.assertTrue(any("must set G97" in x for x in messages(parse(rpm, "w"))))
        # no length/feed/rpm parameter: no entry rule
        self.assertEqual(parse("(PARAM 1 t \"Time\" time 5)\no<w> sub\nG4 P#1\no<w> endsub\n", "w")["errors"], [])

    def test_g53_without_frame_warns_only(self):
        m = parse("o<park> sub\nG53 G0 Z0\no<park> endsub\n", "park")
        self.assertEqual(m["errors"], [])
        self.assertEqual(len(m["warnings"]), 1)
        m = parse("(FRAME machine)\no<park> sub\nG53 G0 Z0\no<park> endsub\n", "park")
        self.assertEqual(m["warnings"], [])
        self.assertEqual(m["frame"], "machine")


class CallLine(unittest.TestCase):
    def test_every_value_rounded_then_checked(self):
        m = parse(FACE)
        self.assertEqual(mf.build_call(m, [50, 0.5, 600, 3]), {"line": "o<face_top> call [50] [0.5] [600] [3]"})
        self.assertEqual(mf.build_call(m, [50, 1e-7, 600, 3])["line"], "o<face_top> call [50] [0] [600] [3]")
        # the range holds for what the line CARRIES: 5.0000004 is sent as 5
        self.assertEqual(mf.build_call(m, [50, 5.0000004, 600, 3])["line"], "o<face_top> call [50] [5] [600] [3]")
        self.assertIn("at most 5", mf.build_call(m, [50, 5.000001, 600, 3])["error"])
        self.assertIn("whole number", mf.build_call(m, [50, 1, 600, 2.5])["error"])
        self.assertIn("takes 4 values", mf.build_call(m, [50])["error"])
        self.assertIn("not a finite number", mf.build_call(m, [50, float("nan"), 600, 3])["error"])
        self.assertIn("not a finite number", mf.build_call(m, [True, 1, 600, 3])["error"])
        self.assertEqual(mf.format_arg(-0.0000001), "0")

    def test_a_header_error_builds_nothing(self):
        bad = parse("(PARM x)\no<face_top> sub\no<face_top> endsub\n")
        self.assertIn("header errors", mf.build_call(bad, [])["error"])

    def test_the_line_never_exceeds_linelen(self):
        params = "".join(f'(PARAM {i} p{i} "P{i}" none 1)\n' for i in range(1, 31))
        name = "m" * 63
        m = parse(params + f"o<{name}> sub\no<{name}> endsub\n", name)
        self.assertEqual(m["errors"], [])
        self.assertIn("LinuxCNC reads 254", mf.build_call(m, [123456.123456] * 30)["error"])
        self.assertLessEqual(len(mf.build_call(m, [1] * 30)["line"]), mf.MAX_LINE)


class Lookup(unittest.TestCase):
    def test_first_hit_in_the_interpreters_order(self):
        with tempfile.TemporaryDirectory() as t:
            cwd, prefix, a, macros = (os.path.join(t, n) for n in ("cfg", "nc", "a", "macros"))
            for d in (cwd, prefix, a, macros):
                os.mkdir(d)
            open(os.path.join(macros, "park.ngc"), "w").close()
            subdirs = [a, macros]
            self.assertEqual(mf.resolve_oword("park", cwd, prefix, subdirs), os.path.realpath(os.path.join(macros, "park.ngc")))
            for d in (a, prefix, cwd):   # each earlier place shadows
                open(os.path.join(d, "park.ngc"), "w").close()
                self.assertEqual(mf.resolve_oword("park", cwd, prefix, subdirs), os.path.realpath(os.path.join(d, "park.ngc")))
            self.assertIsNone(mf.resolve_oword("none", cwd, prefix, subdirs))

    def test_an_unset_program_prefix_is_the_root(self):
        seen = []
        mf.resolve_oword("park", None, "", [], opens=lambda p: seen.append(p) or False)
        self.assertEqual(seen, ["/park.ngc"])

    def test_runnable_reason(self):
        ok = parse("o<park> sub\no<park> endsub\n", "park")
        self.assertIsNone(mf.runnable_reason(ok, "/m/park.ngc", "/m/park.ngc"))
        self.assertIn("Shadowed by /nc/park.ngc", mf.runnable_reason(ok, "/m/park.ngc", "/nc/park.ngc"))
        self.assertIn("not on SUBROUTINE_PATH", mf.runnable_reason(ok, "/m/park.ngc", None))
        bad = parse("(PARM)\no<park> sub\no<park> endsub\n", "park")
        self.assertIn("Header error — line 1: Unknown header word PARM", mf.runnable_reason(bad, "/m/park.ngc", "/m/park.ngc"))

    def test_folders_overlap(self):
        self.assertTrue(mf.folders_overlap("/a/b", "/a/b/"))
        self.assertTrue(mf.folders_overlap("/a/b/c", "/a/b"))
        self.assertTrue(mf.folders_overlap("/a/b", "/a/b/c"))
        self.assertFalse(mf.folders_overlap("/a/bc", "/a/b"))


class Examples(unittest.TestCase):
    """The shipped example macros (examples/sim_config/macros) parse clean,
    follow the entry rule, and carry FRAME machine wherever they move in the
    machine frame — directly (G53) or through a suite routine that does."""
    def test_every_example(self):
        from pathlib import Path
        root = Path(__file__).resolve().parent.parent / "examples/sim_config/macros"
        files = sorted(root.glob("*.ngc"))
        self.assertGreaterEqual(len(files), 5)
        for p in files:
            text = p.read_text()
            m = mf.parse_macro(p.stem, text)
            self.assertEqual((m["errors"], m["warnings"]), ([], []), p.name)
            self.assertTrue(text.isascii(), p.name)
            body = text.split(f"o<{p.stem}> sub", 1)[1]
            first = [l.strip() for l in body.splitlines() if mf._code(l)][0]
            self.assertEqual(first, "M73", f"{p.name}: the entry rule, even without parameters")
            if "g53" in mf._code(body) or "o<go_to_g30>" in body.lower():
                self.assertEqual(m["frame"], "machine", p.name)


if __name__ == "__main__":
    unittest.main()
