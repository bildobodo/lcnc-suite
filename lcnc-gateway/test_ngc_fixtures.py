"""Every .ngc in the repo must parse — starting with balanced comments.

RS274 comments are SINGLE-LINE: `(` must close on the line it opens. An
unclosed one makes the interpreter stop at that line, and the gateway then
ships a PARTIAL payload describing only a prefix of the program. That is
how a two-line comment written into a corpus fixture once sailed through a
green acceptance gate — the truncation happened to fall after all the
motion, so every geometric check still passed. The gate now refuses a
payload carrying parse_error (scripts/sim_parity.py), and this lint stops
the cause reaching the repo in the first place.

Pure text, no LinuxCNC: runs in CI. The depth rule is shared with
gateway_util.strip_gcode_comments so the lint and the stripper cannot
drift apart.
"""
import os
import unittest

from gateway_util import strip_gcode_comments

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SKIP_DIRS = {".git", "node_modules", ".venv", "dist", "__pycache__"}


def _ngc_files():
    for base, dirs, files in os.walk(_ROOT):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
        for f in files:
            if f.endswith(".ngc"):
                yield os.path.join(base, f)


class TestNgcFixtures(unittest.TestCase):
    def test_repo_has_ngc_files(self):
        # A lint that silently finds nothing to lint looks exactly like a
        # lint that passes.
        self.assertGreater(len(list(_ngc_files())), 10)

    def test_comments_are_balanced_on_every_line(self):
        bad = []
        for path in _ngc_files():
            try:
                with open(path, errors="replace") as f:
                    lines = f.readlines()
            except OSError as e:                        # pragma: no cover
                bad.append((path, 0, f"unreadable: {e}"))
                continue
            for n, raw in enumerate(lines, 1):
                # Walk exactly as strip_gcode_comments does: a `;` only
                # starts a trailing comment at depth 0 — inside `( ... )` it
                # is ordinary comment text. Splitting on `;` first (the
                # obvious shortcut) reports `(note; more)` as unbalanced,
                # which it is not.
                depth = 0
                for ch in raw:
                    if ch == "(":
                        depth += 1
                    elif ch == ")":
                        depth -= 1
                        if depth < 0:
                            break
                    elif ch == ";" and depth == 0:
                        break
                if depth < 0:
                    bad.append((path, n, "')' before '('"))
                elif depth > 0:
                    bad.append((path, n, "'(' never closed on this line — "
                                         "RS274 comments are single-line"))
        self.assertEqual(bad, [], "unbalanced G-code comments:\n" + "\n".join(
            f"  {os.path.relpath(p, _ROOT)}:{n}: {why}" for p, n, why in bad))

    def test_the_stripper_agrees_with_the_lint(self):
        # If strip_gcode_comments ever stopped treating `(` as opening a
        # comment, the lint would be guarding a rule nothing else follows.
        self.assertEqual(strip_gcode_comments("G0 X1 (move) Y2").strip(),
                         "G0 X1  Y2".strip())
        self.assertEqual(strip_gcode_comments("G0 X1 ; tail").strip(), "G0 X1")
        self.assertEqual(strip_gcode_comments("(all comment)").strip(), "")


def _sub_lines(rel):
    """Code lines of one repo subroutine, comments stripped, upper-cased,
    whitespace-collapsed; blank lines dropped."""
    path = os.path.join(_ROOT, rel)
    with open(path, errors="replace") as f:
        out = []
        for raw in f:
            code = strip_gcode_comments(raw).strip().upper()
            if code:
                out.append(" ".join(code.split()))
    return out


class TestSubroutineContracts(unittest.TestCase):
    """Structural contracts of the motion subroutines the UI buttons call —
    source-level, no interpreter (review 2026-09-14 TWP-01/02)."""

    TWP_GOTO_ZERO = "examples/sim_config/twp/remap_subs/twp_goto_zero.ngc"

    def test_twp_goto_zero_guards_then_saves_modal_state(self):
        # TWP-01: the G59 guard precedes ANY modal change (an abort does not
        # run M73's restore); M73 + G90 precede every G0; both unit codes are
        # present (explicit G21/G20 from the #2 flag); no rotary word.
        code = _sub_lines(self.TWP_GOTO_ZERO)
        first = lambda pred: next(i for i, l in enumerate(code) if pred(l))
        guard = first(lambda l: "#5220" in l)
        m73 = first(lambda l: l.startswith("M73"))
        g90 = first(lambda l: l.startswith("G90"))
        g0 = first(lambda l: l.startswith("G0 "))
        self.assertLess(guard, m73)
        self.assertLess(m73, g0); self.assertLess(g90, g0)
        self.assertTrue(any(l == "G21" for l in code)); self.assertTrue(any(l == "G20" for l in code))
        self.assertTrue(any("#<_Z>" in l for l in code), "never-lower reads the live plane Z")
        for l in code:
            if l.startswith("G0 "):
                self.assertFalse(any(w[0] in "ABC" for w in l.split()[1:]), l)


if __name__ == "__main__":
    unittest.main()
