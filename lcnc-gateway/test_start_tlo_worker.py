"""The start tool state of a parse (VP-I20, Codex R51–R57) against the REAL
worker and LinuxCNC's native offline interpreter — one fresh process per case
(native_start_probe.py; the interpreter keeps state between parses in one
process). It reports `skip` where the native modules are missing.

The machine runs every move before a program's own G43/G49 under its
inherited modal G43: the parse starts there (an init-line G43.1), reports it
as `tlo_start`, and gives no limit verdict when the start is unknown."""
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
_CACHE = {}


def probe(case):
    if case not in _CACHE:
        env = dict(os.environ)
        env.pop("PYTHONPATH", None)
        p = subprocess.run([sys.executable, os.path.join(HERE, "native_start_probe.py"), case],
                           capture_output=True, text=True, timeout=120, env=env, cwd=HERE)
        lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
        if not lines:
            raise AssertionError(f"{case}: no result rc={p.returncode} stderr={p.stderr[-800:]}")
        _CACHE[case] = json.loads(lines[-1])
    r = _CACHE[case]
    if "skip" in r:
        raise unittest.SkipTest(r["skip"])
    return r


class TestStartToolState(unittest.TestCase):

    def test_a_move_without_its_own_g43_is_checked_under_the_inherited_offset(self):
        # Codex R51's VP-I20 case: Z max 50, start G43 Z10 — Z45 runs at Z55
        r = probe("inherit_g43")
        self.assertIsNone(r["parse_error"])
        self.assertEqual(r["violations"], [{"line": 3, "axis": "Z", "value": 55.0, "limit": 50.0, "kind": "max"}])
        self.assertEqual((r["start_known"], r["tlo_start"]), (True, [0.0, 0.0, 10.0]))
        self.assertEqual(r["meta"], {"start_known": True, "tlo_start": [0.0, 0.0, 10.0],
                                     "start_mode": 430, "start_reason": None})
        # positive control: the same program started under G49
        r0 = probe("inherit_g49")
        self.assertEqual(r0["violations"], [])
        self.assertEqual((r0["tlo_start"], r0["meta"]["start_mode"]), ([0.0, 0.0, 0.0], 490))

    def test_an_unknown_start_gives_no_verdict(self):
        for case, reason in (("unknown", "no tool offset mode read"),
                             ("a_w_component", "tool offset in A–W"),
                             ("pinned_legacy", "pinned parse without a start seed")):
            r = probe(case)
            self.assertIsNone(r["violations"], case)
            self.assertEqual(r["violations_reason"], "start_unknown", case)
            self.assertIsNone(r["feed_outside"], case)
            self.assertIsNone(r["rapid_outside"], case)
            self.assertEqual((r["start_known"], r["tlo_start"], r["start_reason"]), (False, None, reason), case)

    def test_a_g53_prefix_lands_on_its_machine_target(self):
        # G53 Z0 under the start offset 10: the interpreter subtracts it as
        # the machine does — program Z -10, + tlo_start 10 = machine Z0
        r = probe("g53_prefix")
        self.assertEqual(r["rapid"][0], [0.0, 0.0, -10.0])
        self.assertEqual(r["violations"], [])
        self.assertIsNone(r["tlo_events"])

    def test_the_percent_line_is_init_not_program(self):
        # the interpreter runs the initcodes on a leading `%` line: the
        # start seed's own row is no program row …
        r = probe("percent")
        self.assertIsNone(r["tlo_events"])
        self.assertEqual(r["rapid"], [[0.0, 0.0, -10.0], [1.0, 0.0, -10.0]])
        # … and on a rotary machine the rotary sync move is no phantom point
        # at program 0,0,0 ahead of the program's first move
        for case in ("percent_rotary", "percent_rotary_blank"):
            rr = probe(case)
            self.assertEqual(rr["rapid"], [[0.0, 0.0, -10.0], [1.0, 0.0, -10.0]], case)
            self.assertIsNone(rr["tlo_events"], case)

    def test_the_init_phase_is_an_order_not_a_line_number(self):
        # Codex R58 VP-I22: a subroutine's own G43.1 Z20 is a program row,
        # also when its line number equals the one the init block used; the
        # two moves after it run under Z20 (machine Z = program Z + 20).
        # Since 2026-10-07 the move after the G43.1 starts where the machine
        # stands — program Z0 under the start's 10 is Z-10 under 20 (the
        # relabel vertex, brk) — and rises to Z0: a real move, timed.
        for case in ("percent_sub", "percent_sub_blank"):
            r = probe(case)
            self.assertEqual([row[1:] for row in r["tlo_events"]], [[0.0, 0.0, 20.0, -1]], case)
            self.assertEqual(r["rapid"], [[0.0, 0.0, 0.0], [0.0, 0.0, -10.0], [5.0, 0.0, 0.0], [10.0, 0.0, 0.0]], case)
            self.assertEqual(r["rapid_brk"], [0, 1, 0, 0], case)
            self.assertEqual(r["rapid_ustart"], [1, 0, 0, 0], case)
        # a program's G43.1 with the seed's value stays — by origin, not value
        self.assertEqual(probe("percent_then_g43_1")["tlo_events"], [[0, 0.0, 0.0, 10.0, -1]])
        # Codex R56: G49 then G43.1 Z10 at seq 0 — both rows kept, Z10 governs
        r = probe("codex_r56")
        self.assertEqual(r["tlo_events"], [[0, 0.0, 0.0, 0.0, -1], [0, 0.0, 0.0, 10.0, -1]])
        self.assertEqual(r["rapid"][0], [0.0, 0.0, 0.0])

    def test_one_read_point_pinned_seed_and_gate_override(self):
        r = probe("pinned_seed")       # STAT says 10, the published start was 20
        self.assertEqual(r["tlo_start"], [0.0, 0.0, 20.0])
        self.assertEqual(r["violations"][0]["value"], 60.0)
        g = probe("gate_override")     # STAT says 99, the gate pins 30
        self.assertEqual(g["tlo_start"], [0.0, 0.0, 30.0])
        self.assertEqual(g["violations"][0]["value"], 70.0)

    def test_a_program_that_sets_its_own_offset_first_does_not_depend_on_the_start(self):
        a, b = probe("no_prefix_10"), probe("no_prefix_80")
        self.assertEqual(a["digest_without_start"], b["digest_without_start"])
        self.assertNotEqual(a["tlo_start"], b["tlo_start"])

    def test_an_inch_machine_seeds_in_machine_units(self):
        r = probe("inch")
        self.assertEqual(r["tlo_start"], [0.0, 0.0, 0.5])
        self.assertEqual(r["violations"], [{"line": 3, "axis": "Z", "value": 1.5, "limit": 1.2, "kind": "max"}])


def payload(case, tmpdir):
    path = os.path.join(tmpdir, case.replace("@", "_") + ".mpk")
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    p = subprocess.run([sys.executable, os.path.join(HERE, "native_start_probe.py"), case, path],
                       capture_output=True, text=True, timeout=120, env=env, cwd=HERE)
    lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
    if lines and "skip" in json.loads(lines[-1]):
        raise unittest.SkipTest(json.loads(lines[-1])["skip"])
    if not os.path.exists(path):
        raise AssertionError(f"{case}: no payload rc={p.returncode} stderr={p.stderr[-800:]}")
    import msgspec
    with open(path, "rb") as f:
        return msgspec.msgpack.decode(f.read())


class TestVerifyNative(unittest.TestCase):
    """The verify's equality contract on REAL payloads (VP-I20, plan
    Fassungen 4–6): the published payload at one start, normalised, against
    the fresh one at another — both directions."""

    @classmethod
    def setUpClass(cls):
        import tempfile
        cls.tmp = tempfile.TemporaryDirectory()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def compare(self, name, za, zb):
        import gateway_util
        a, b = payload(f"{name}@{za}", self.tmp.name), payload(f"{name}@{zb}", self.tmp.name)
        return gateway_util.compare_preview_payloads(a, b), gateway_util.compare_preview_payloads(b, a)

    def test_codex_r55_pair_is_the_same_after_normalisation(self):
        # equal machine points, the tip at the start offset: the normalised
        # payload IS the fresh one (the client re-tips the prefix)
        self.assertEqual(self.compare("r55", "10", "20"), ((True, "same"), (True, "same")))

    def test_heavy_test_shape_is_the_same_at_a_measuring_scatter(self):
        self.assertEqual(self.compare("heavy_like", "10", "10.005"), ((True, "same"), (True, "same")))

    def test_the_counterexamples_differ(self):
        for name in ("r54_quadratic", "r53_rest_b"):
            (fwd, _), (back, _) = self.compare(name, "10", "10.005")
            self.assertFalse(fwd, name)
            self.assertFalse(back, name)


if __name__ == "__main__":
    unittest.main()
