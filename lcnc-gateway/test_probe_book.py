"""What the machine holds of the probing parameters (probe_book — P5-2 b, plan
v6, Codex R440–R444): the booking's outcomes and their validity, the
classifier over a key range (with the remaps), and the bundled routines' write
table, held against the files. Pure: no gateway import."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

import gateway_util as gu
import probe_book
from probe_book import OFFSET_KEY, PROBE_KEYS, ProbeBook, machine_outcome, routine_effect, routine_reads_offset
from probe_routines import ROUTINES

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = [ROOT / "subroutines/probe_basic", ROOT / "subroutines/surfacemap"]


class TestTheBooking(unittest.TestCase):
    def setUp(self):
        self.t = 1000.0
        self.b = ProbeBook(wall=lambda: self.t)

    def out(self, key, link=1):
        e = self.b.entry(key, link)
        return None if e is None else (e["outcome"], e["value"])

    def test_nothing_is_known_before_the_first_write(self):
        self.assertIsNone(self.out(3015))
        self.assertEqual(self.b.wire(1), {"version": 0, "keys": {}})

    def test_a_taken_chunk_and_a_confirmed_read_stay_distinguishable(self):
        self.b.book({3015: 25.0}, "applied", 1, "probe")
        self.b.book({3016: 200.0}, "read", 1, "read")
        self.assertEqual((self.out(3015), self.out(3016)), (("applied", 25.0), ("read", 200.0)))
        self.assertEqual(self.b.wire(1)["keys"]["3015"], {"value": 25.0, "outcome": "applied", "t": 1_000_000, "job": "probe"})
        with self.assertRaises(ValueError):
            self.b.book({3015: 1.0}, "taken", 1, "probe")

    def test_only_the_probe_s_keys_are_booked(self):
        self.b.book({3116: 0.0, 3015: 1.0, 3100: 2.0}, "applied", 1, "probe")
        self.assertEqual(list(self.b.wire(1)["keys"]), ["3015"])

    def test_a_link_change_makes_every_entry_unknown(self):
        self.b.book({3015: 25.0}, "applied", 1, "probe")
        self.b.book({3016: 200.0}, "read", 1, "read")
        for link in (2, None):
            self.assertEqual((self.out(3015, link), self.out(3016, link)), (("unknown", None), ("unknown", None)), link)
        self.assertEqual(self.out(3015, 1), ("applied", 25.0), "the same Link again: the entry itself never moved")

    def test_an_invalidation_names_its_keys_or_takes_all(self):
        self.b.book({k: 1.0 for k in (3015, 3016, 3050)}, "applied", 1, "probe")
        self.b.invalidate([3015, 9999], "mdi")
        self.assertEqual((self.out(3015), self.out(3016)), (("unknown", None), ("applied", 1.0)))
        self.b.invalidate(None, "auto")
        self.assertEqual({k: self.out(k) for k in PROBE_KEYS}, {k: ("unknown", None) for k in PROBE_KEYS})
        v = self.b.version
        self.b.invalidate(None, "auto")
        self.assertEqual(self.b.version, v, "nothing new to say")
        self.b.invalidate([], "mdi")
        self.assertEqual(self.b.version, v)

    def test_only_the_next_write_or_a_read_restores_a_key(self):
        # a chunk value from BEFORE the call never lifts a later invalidation
        self.b.book({3015: 25.0}, "applied", 1, "probe")
        self.b.invalidate(None, "probe_run")
        self.b.persisted([3015], True)
        self.assertEqual(self.out(3015), ("unknown", None))
        self.b.book({3015: 25.0}, "applied", 1, "set_params")
        self.assertEqual(self.out(3015), ("applied", 25.0))

    def test_a_refused_write_leaves_what_the_machine_holds(self):
        self.b.book({3015: 25.0}, "applied", 1, "probe")
        self.b.refused({3015: 30.0, 3016: 200.0}, "not armed")
        self.assertEqual(self.out(3015), ("applied", 25.0))
        self.assertEqual(self.b.entry(3015, 1)["refused"], {"value": 30.0, "why": "not armed"})
        self.assertEqual(self.b.wire(1)["keys"]["3016"], {"value": None, "outcome": None, "t": 1_000_000, "job": None,
                                                          "refused": 200.0})
        self.b.book({3015: 30.0}, "applied", 1, "probe")
        self.assertIsNone(self.b.entry(3015, 1)["refused"])

    def test_a_read_without_the_file_s_line_is_nothing_known(self):
        self.b.book({3015: 25.0}, "applied", 1, "probe")
        self.b.book({3015: None}, "read", 1, "read")
        self.assertIsNone(self.out(3015))


class TestTheOffsetsMachineOutcome(unittest.TestCase):
    """probeCalibration.machine from the booking of #3032 alone."""

    def setUp(self):
        self.b = ProbeBook(wall=lambda: 5.0)

    def got(self, value=0.2, writing=False, link=1):
        return machine_outcome(value, self.b.entry(OFFSET_KEY, link), writing)["outcome"]

    def test_each_outcome(self):
        self.assertEqual(self.got(), "saved_not_written")                  # never written
        self.assertEqual(self.got(writing=True), "write_pending")
        self.b.book({OFFSET_KEY: 0.05}, "applied", 1, "probe")
        self.assertEqual(self.got(), "saved_not_written")                  # another value
        self.b.invalidate([OFFSET_KEY], "cal_apply")
        self.assertEqual(self.got(), "saved_write_unknown")
        self.b.book({OFFSET_KEY: 0.2}, "applied", 1, "cal_apply")
        self.assertEqual(self.got(), "taken_persist_unconfirmed")          # the file not confirmed yet
        self.b.persisted([OFFSET_KEY], False)
        self.assertEqual(self.got(), "taken_persist_unconfirmed")
        self.b.persisted([OFFSET_KEY], True)
        self.assertEqual(self.got(), "taken")
        self.assertEqual(self.got(link=2), "saved_write_unknown")          # another Link: no claim
        self.b.book({OFFSET_KEY: 0.2}, "read", 1, "read")
        self.assertEqual(self.got(), "taken")                              # a confirmed read

    def test_a_refusal_before_the_write_says_why(self):
        self.b.refused({OFFSET_KEY: 0.2}, "not armed")
        self.assertEqual(machine_outcome(0.2, self.b.entry(OFFSET_KEY, 1), False),
                         {"outcome": "saved_not_written", "at": None, "why": "not armed"})


class TestTheClassifier(unittest.TestCase):
    """param_assigned_keys over PROBE_KEYS: the keys provenly written, none,
    or any (None) — Codex R441's and R442's cases."""

    def env(self, remaps=(), files=None):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        for name, text in (files or {}).items():
            Path(d.name, name + ".ngc").write_text(text)
        return gu.RemapEnv(list(remaps), [d.name], keys=frozenset(gu.TOOLSETTER_BASIS_KEYS) | PROBE_KEYS)

    def keys(self, text, env=None):
        return gu.param_assigned_keys(text, env or self.env(), PROBE_KEYS)

    def test_a_direct_setting_is_its_key(self):
        for text in ("#3015=30", "#3 0 1 5 = 30", "#+3015=30", "#3015.0=30", "#3015=30 #3050=1"):
            got = self.keys(text)
            self.assertIn(3015, got, text)
        self.assertEqual(self.keys("#3015=30 #3050=1"), {3015, 3050})
        self.assertEqual(self.keys("G0 X1 Y2"), frozenset())
        self.assertEqual(self.keys("#3116=0"), frozenset())

    def test_a_computed_target_is_any(self):
        for text in ("#[3000+15]=30", "#1=3015\n##1=30", "#ABS[3015]=30"):
            self.assertIsNone(self.keys(text), text)

    def test_a_call_into_another_file_is_any_even_when_it_is_found(self):
        env = self.env(files={"shop_probe": "o<shop_probe> sub\n#3015=1\no<shop_probe> endsub\n"})
        self.assertIsNone(self.keys("o<shop_probe> call", env))
        self.assertIsNone(self.keys("o<nowhere> call", env))
        self.assertIsNone(self.keys("M98 P1000", env))

    def test_a_remapped_code_carries_its_body(self):
        env = self.env(["M200 modalgroup=10 ngc=m200"], {"m200": "o<m200> sub\n#3015=30\n#3009=1\no<m200> endsub\n"})
        self.assertEqual(self.keys("M200", env), {3015})
        self.assertEqual(gu.toolsetter_assigned_keys("M200", env), {3009})
        self.assertIsNone(self.keys("M201", self.env(["M201 modalgroup=10 python=m201"])))

    def test_an_env_read_for_other_keys_proves_nothing(self):
        env = gu.RemapEnv([], [])
        self.assertIsNone(self.keys("#3015=30", env))
        self.assertEqual(gu.toolsetter_assigned_keys("#3009=1", env), {3009})
        self.assertIsNone(self.keys("G0 X1", gu.RemapEnv.unknown()))


class TestTheBundledRoutines(unittest.TestCase):
    def bundle(self, over=None):
        def read(name):
            if over and name in over:
                return over[name]
            for d in BUNDLE:
                p = d / (name + ".ngc")
                if p.is_file():
                    return p.read_bytes()
            return None
        return read

    def env(self, remaps=()):
        e = gu.RemapEnv(list(remaps), [str(d) for d in BUNDLE], keys=PROBE_KEYS)
        return lambda line: e.text_effect(line)[0]

    def test_the_table_follows_the_files(self):
        # a new or changed assignment to #3014–#3059 (or a changed file)
        # fails here until the table is regenerated
        spec = importlib.util.spec_from_file_location("gen_probe_routines", ROOT / "scripts/gen_probe_routines.py")
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        self.assertEqual((ROOT / "lcnc-gateway/probe_routines.py").read_text(), gen.render(),
                         "python3 -I scripts/gen_probe_routines.py --write")

    def test_the_calibrations_write_no_probe_parameter(self):
        # P5-1 a: #3032 is written by no calibration
        for name in ("probe_cal_round_pocket", "probe_cal_round_boss", "probe_cal_square_pocket", "probe_cal_square_boss"):
            self.assertEqual(ROUTINES[name][1], (), name)
            self.assertEqual(routine_effect(name, self.bundle(), self.env()), frozenset(), name)
        self.assertEqual({n for n, r in ROUTINES.items() if OFFSET_KEY in r[1]}, {"probe_cal_reset"})

    def test_a_proven_effect_needs_the_bundled_file_and_its_calls(self):
        self.assertEqual(routine_effect("probe_round_boss", self.bundle(), self.env()), frozenset())
        # the same name from another file on the path
        self.assertIsNone(routine_effect("probe_round_boss", self.bundle({"probe_round_boss": b"o<probe_round_boss> sub\n"}), self.env()))
        # a changed file it CALLS
        raw = (BUNDLE[0] / "probe_x_plus.ngc").read_bytes()
        self.assertIsNone(routine_effect("probe_round_boss", self.bundle({"probe_x_plus": raw + b"\n#3015=1\n"}), self.env()))
        self.assertIsNone(routine_effect("shop_probe", self.bundle(), self.env()))
        # not resolvable at all
        self.assertIsNone(routine_effect("probe_round_boss", lambda _n: None, self.env()))

    def test_a_remap_the_body_meets_counts(self):
        self.assertIsNone(routine_effect("probe_round_boss", self.bundle(), self.env(["M50 modalgroup=10 python=m50"])))
        self.assertIsNone(routine_effect("probe_round_boss", self.bundle(), lambda _l: None))

    def test_who_reads_the_offset(self):
        self.assertFalse(routine_reads_offset("probe_z_minus_wco", self.bundle()))
        self.assertFalse(routine_reads_offset("surface_scan", self.bundle()))
        self.assertTrue(routine_reads_offset("probe_round_boss", self.bundle()))
        self.assertTrue(routine_reads_offset("shop_probe", self.bundle()), "unknown reads it")
        self.assertTrue(routine_reads_offset("probe_z_minus_wco", self.bundle({"probe_z_minus_wco": b"x"})))

    def test_the_keys_are_the_panel_s_and_the_scan_s(self):
        self.assertEqual(PROBE_KEYS, set(range(3014, 3037)) | set(range(3050, 3060)))
        self.assertIn(probe_book.OFFSET_KEY, PROBE_KEYS)


if __name__ == "__main__":
    unittest.main()
