"""The changes between feed and rapid survive the preview's decimation
(2026-11-25), against the REAL worker and LinuxCNC's native offline
interpreter (native_start_probe.py, one fresh process per parse; the
interpreter keeps state between parses in one process).

The payload ships two streams — feed and rapid — that the client merges by seq
into ONE path: the simulation, the drawn path, the run time and the collision
check all read it. Each stream was thinned for itself, so a rapid vertex on a
chord of the RAPID stream was dropped although feeds ran between, and the
merge joined its neighbours with a segment of the wrong kind or in the wrong
place: a G83 arrived as a feed from the clearance plane and one rapid plunge
through the part; a rapid into the block before a feed arrived as that feed;
a ramp entered at Z3 was driven from Z40, 15.6 mm off its corner.

The property, for every program here: against the same parse with nothing
thinned (START_PROBE_UNTHINNED) the merged payload has the same RUNS — the
stretches of one stream in execution order — with bit-equal end vertices in
every per-point channel, and no dropped vertex lies further than the
decimation's tolerance from the segment the payload drives in its place.

And the COURSE inside a run (Codex R487 H1): the vertices a segment replaces
run along it one way, each was at its own time within the tolerance of where
the segment is at that time, and a feed's line, subroutine and call line at
that time are the un-thinned path's. `G0 Z40 / Z-10 / Z15 / Z-5 / Z20` kept
the property above with Z15 and Z-5 dropped: the same places, the same end
time, but 14 mm elsewhere at the same time and 2 contacts of 4."""
import json
import os
import random
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
_CACHE = {}
# the per-point channels of a stream and their width (the wire's dtypes)
CHANNELS = (("", "<f4", 3), ("_abc", "<f4", 3), ("_seq", "<u4", 1), ("_lines", "<u4", 1), ("_tcum", "<f4", 1),
            ("_kinstype", "<u1", 1), ("_brk", "<u1", 1), ("_ustart", "<u1", 1), ("_lineok", "<u1", 1), ("_sub", "<u1", 1),
            ("_cline", "<u2", 1))
EPS_MM = 0.005    # gcode_parse_worker._RDP_EPS_MM


def payload(case, full=False, timed=True):
    """The encoded payload of a case (or of "@file"), thinned as shipped or
    with nothing thinned; `timed` False: on a machine whose INI names no
    velocity (no time axis — the client times the path by its length)."""
    import msgspec
    key = (case, full, timed)
    if key not in _CACHE:
        env = dict(os.environ)
        env.pop("PYTHONPATH", None)
        env.pop("START_PROBE_UNTHINNED", None)
        env.pop("START_PROBE_NO_TIME", None)
        if full:
            env["START_PROBE_UNTHINNED"] = "1"
        if not timed:
            env["START_PROBE_NO_TIME"] = "1"
        with tempfile.TemporaryDirectory(prefix="path-kinds-") as tmp:
            dest = os.path.join(tmp, "p.msgpack")
            p = subprocess.run([sys.executable, str(HERE / "native_start_probe.py"), case, dest],
                               capture_output=True, text=True, timeout=120, env=env, cwd=HERE)
            lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
            if lines and "skip" in (said := json.loads(lines[-1])):
                raise unittest.SkipTest(said["skip"])
            if p.returncode != 0 or not os.path.exists(dest):
                raise AssertionError(f"{case}: rc={p.returncode} {p.stderr[-800:]}")
            _CACHE[key] = msgspec.msgpack.decode(Path(dest).read_bytes())
    return _CACHE[key]


def vertices(d):
    """The merged path: one dict per vertex, in execution order."""
    import numpy as np
    out = []
    for stream in ("feed", "rapid"):
        cols = {}
        for suffix, dtype, width in CHANNELS:
            b = d.get(stream + suffix)
            if b is not None:
                cols[suffix] = np.frombuffer(b, dtype).reshape(-1, width)
        n = len(cols["_seq"]) if len(d.get(stream + "_seq") or b"") else 0
        # the beginning's channels alone may be shorter (a prefix); none here is
        # (an absent channel is an empty buffer)
        short = {stream + s: len(c) for s, c in cols.items() if len(c) not in (0, n)}
        if short:
            raise AssertionError(f"channels not thinned with their stream of {n}: {short}")
        for i in range(n):
            out.append({"stream": stream, **{s: c[i].tobytes() for s, c in cols.items() if len(c) == n},
                        "seq": int(cols["_seq"][i][0]), "p": [float(v) for v in cols[""][i]],
                        "abc": [float(v) for v in cols["_abc"][i]] if len(cols.get("_abc", ())) == n else [0.0, 0.0, 0.0],
                        "still": bool(cols["_brk"][i][0]) if len(cols.get("_brk", ())) == n else False})
    return sorted(out, key=lambda v: v["seq"])


def runs(path):
    """[(stream, first vertex, last vertex)] — the stretches of one stream."""
    out = []
    for v in path:
        if out and out[-1][0] == v["stream"]:
            out[-1][2] = v
        else:
            out.append([v["stream"], v, v])
    return out


def same(a, b):
    """Two vertices bit-equal in every channel they both carry."""
    return all(a[s] == b[s] for s, _d, _w in CHANNELS if s in a and s in b)


def spacing(x):
    """The f32 spacing at `x` (the wire's resolution of a position or a time)."""
    import numpy as np
    return float(np.spacing(np.float32(abs(x))))


def off(v, a, b):
    """How far vertex `v` lies from the segment a → b (6D, 1 degree = 1 mm)."""
    p, q, r = (x["p"] + x["abc"] for x in (v, a, b))
    d = [y - x for x, y in zip(q, r)]
    L2 = sum(x * x for x in d)
    t = 0.0 if L2 == 0 else min(1.0, max(0.0, sum((x - y) * z for x, y, z in zip(p, q, d)) / L2))
    return sum((x - (y + t * z)) ** 2 for x, y, z in zip(p, q, d)) ** 0.5


class PathKinds(unittest.TestCase):

    def keeps_the_course(self, case, lo, hi, gone, eps, deg):
        """`gone` (execution order), replaced by the segment lo → hi: one way
        along it, at its own time where the segment is then, a feed's line,
        subroutine and call line the segment's. Everything as the wire says
        it, f32: a position is off by half a spacing per coordinate, a time by
        half a spacing at the speed driven."""
        import struct
        pose = lambda v: v["p"] + [a * deg for a in v["abc"]]
        f32 = lambda v, k: struct.unpack("<f", v[k])[0] if k in v else None
        what = f"{case}: {lo['stream']} {lo['seq']} {lo['p']} → {hi['seq']} {hi['p']}"
        p0, p1 = pose(lo), pose(hi)
        u = [b - a for a, b in zip(p0, p1)]
        length = sum(x * x for x in u) ** 0.5
        wire = 8 * spacing(max(abs(x) for v in (lo, hi, *gone) for x in pose(v)))
        far = 0.0
        for v in gone:
            d = [b - a for a, b in zip(p0, pose(v))]
            if length > wire:
                s = sum(x * y for x, y in zip(d, u)) / length
                self.assertGreater(s, far - wire, f"{what}: vertex {v['seq']} {v['p']} runs back along it")
                far = max(far, s)
            else:
                self.assertLessEqual(sum(x * x for x in d) ** 0.5, 2 * wire, f"{what}: vertex {v['seq']} {v['p']} left and came back")
        if length > wire:
            self.assertLess(far, length + wire, f"{what}: driven past its end and back")
        t0, t1 = f32(lo, "_tcum"), f32(hi, "_tcum")
        if t0 is not None and t1 > t0:
            slack = eps + wire + 3 * spacing(t1) * length / (t1 - t0)
            for v in gone:
                w = (f32(v, "_tcum") - t0) / (t1 - t0)
                d = sum((x - a - w * y) ** 2 for x, a, y in zip(pose(v), p0, u)) ** 0.5
                self.assertLessEqual(d, slack, f"{what}: vertex {v['seq']} {v['p']} was elsewhere at its time")
        if lo["stream"] == "feed":
            for v in gone:
                self.assertEqual([v.get(k) for k in ("_lines", "_sub", "_cline", "_lineok")],
                                 [hi.get(k) for k in ("_lines", "_sub", "_cline", "_lineok")],
                                 f"{what}: vertex {v['seq']}'s line at its time")

    def holds(self, case, units="mm", timed=True):
        thin, full = payload(case, timed=timed), payload(case, full=True, timed=timed)
        self.assertEqual(bool(len(thin.get("rapid_tcum") or b"")), timed and bool(len(thin.get("rapid") or b"")), f"{case}: the time axis")
        self.assertIsNone(full["parse_error"], case)
        a, b = vertices(thin), vertices(full)
        ra, rb = runs(a), runs(b)
        self.assertEqual([r[0] for r in ra], [r[0] for r in rb], f"{case}: the runs of one kind, in order")
        for (kind, f0, f1), (_k, g0, g1) in zip(ra, rb):
            self.assertEqual((f0["seq"], f1["seq"]), (g0["seq"], g1["seq"]), f"{case}: a {kind} run's ends")
            self.assertTrue(same(f0, g0) and same(f1, g1), f"{case}: a {kind} run's end vertex differs: {f0} {g0} {f1} {g1}")
        # nothing moved: a kept vertex is the canon's; a dropped one lies within
        # the tolerance of the segment the payload drives in its place
        by_seq = {v["seq"]: v for v in a}
        order = [v["seq"] for v in a]
        eps = (EPS_MM if units == "mm" else EPS_MM / 25.4) + 2e-4
        import bisect
        chords = {}
        for v in b:
            kept = by_seq.get(v["seq"])
            if kept is not None:
                self.assertTrue(same(kept, v), f"{case}: vertex {v['seq']} changed")
                continue
            i = bisect.bisect_left(order, v["seq"])
            self.assertTrue(0 < i < len(a), f"{case}: the path's own end dropped")
            lo, hi = a[i - 1], a[i]
            self.assertEqual((lo["stream"], hi["stream"], hi["still"]), (v["stream"], v["stream"], False),
                             f"{case}: {v['stream']} vertex {v['seq']} {v['p']} is driven between {lo['stream']} {lo['p']} and {hi['stream']} {hi['p']}")
            self.assertLessEqual(off(v, lo, hi), eps, f"{case}: {v['stream']} vertex {v['seq']} {v['p']}")
            chords.setdefault((lo["seq"], hi["seq"]), (lo, hi, []))[2].append(v)
        for lo, hi, gone in chords.values():
            self.keeps_the_course(case, lo, hi, gone, EPS_MM if units == "mm" else EPS_MM / 25.4, 1.0 if units == "mm" else 1 / 25.4)
        # the limit flags say the same of every run; the time axes end alike
        import numpy as np
        for stream in ("feed", "rapid"):
            if thin.get(stream + "_outside") is not None:
                fa, fb = np.frombuffer(thin[stream + "_outside"], "<u1"), np.frombuffer(full[stream + "_outside"], "<u1")
                sa, sb = np.frombuffer(thin[stream + "_seq"], "<u4"), np.frombuffer(full[stream + "_seq"], "<u4")
                # a kept vertex stands for its run's vertices since the kept one before
                prev = 0
                for k, q in enumerate(sa):
                    j = int(np.searchsorted(sb, q))
                    self.assertEqual(bool(fa[k]), bool(fb[prev:j + 1].any()), f"{case}: {stream} outside at seq {q}")
                    prev = j + 1
            if len(thin.get(stream + "_tcum") or b""):
                ta, tb = np.frombuffer(thin[stream + "_tcum"], "<f4"), np.frombuffer(full[stream + "_tcum"], "<f4")
                self.assertEqual(ta[-1], tb[-1], f"{case}: the {stream} time's end")
        self.assertEqual({k: thin["stats"][k] for k in ("feedTime", "rapidTime", "totalTime", "feedDist", "rapidDist")},
                         {k: full["stats"][k] for k in ("feedTime", "rapidTime", "totalTime", "feedDist", "rapidDist")}, case)
        return a, b


class TestTheProgramsThatLostTheirChanges(PathKinds):

    def holds(self, case, units="mm", timed=True):
        # without a time axis the anchors stand alone (with one, the place at
        # every time keeps most of these vertices too)
        super().holds(case, units, timed=False)
        return super().holds(case, units)

    def points(self, case):
        return [(v["stream"][0].upper(), *(round(x, 3) for x in v["p"])) for v in vertices(payload(case))]

    def test_a_g83_keeps_every_peck(self):
        self.holds("pk_g83_99")
        z = [(k, p) for k, x, y, p in self.points("pk_g83_99") if (x, y) == (12.345, -6.789)]
        # R plane, peck, back to R, down to 0.254 above, next peck …
        self.assertEqual(z[:7], [("R", 40.0), ("R", 2.3), ("F", -0.8), ("R", 2.3), ("R", -0.546), ("F", -3.9), ("R", 2.3)])
        self.assertEqual([p for k, p in z if k == "F"], [-0.8, -3.9, -7.0, -10.1, -13.2, -16.3, -18.0])
        self.holds("pk_g83_98")

    def test_a_first_peck_above_the_part_is_no_plunge(self):
        # R10 Q3: the first feeds end at 7, 4, 1 — the payload drove one rapid
        # from 7 to 0.254 above the last peck, through everything
        self.holds("pk_g83_high_98")
        z = [(k, p) for k, x, y, p in self.points("pk_g83_high_98") if (x, y) == (12.345, -6.789)]
        self.assertEqual(z[:6], [("R", 40.0), ("R", 10.0), ("F", 7.0), ("R", 10.0), ("R", 7.254), ("F", 4.0)])
        self.holds("pk_g83_high_99")

    def test_a_rapid_into_the_part_before_a_feed_stays_a_rapid(self):
        self.holds("pk_hidden_rapid")
        self.assertEqual(self.points("pk_hidden_rapid")[1:8],
                         [("R", 50, 30, 40), ("R", 50, 30, -2), ("F", 50, 30, -5), ("R", 50, 30, 15), ("R", 50, 30, -4.5),
                          ("F", 50, 30, -8), ("R", 50, 30, 15)])

    def test_a_ramp_starts_where_the_rapid_ended(self):
        self.holds("pk_ramp_levels")
        pts = self.points("pk_ramp_levels")
        self.assertIn(("R", 6, 6, 3), pts)
        self.assertEqual(pts[pts.index(("F", 26, 6, -3)) - 1], ("R", 6, 6, 3), "the ramp's start, not Z40")

    def test_closed_contours_re_entered_at_one_point(self):
        self.holds("pk_levels")
        pts = self.points("pk_levels")
        for r in (3, -1.5, -3.5, -5.5):
            self.assertIn(("R", 10, 10, r), pts, "the rapid's end before each plunge")


    def test_levels_entered_by_rapids_that_only_go_down(self):
        # one way and evenly driven: no rule of the chord keeps them, the change does
        self.holds("pk_steps_down")
        pts = self.points("pk_steps_down")
        for z in (30, 20, 10, 4, -3):
            self.assertEqual(pts[pts.index(("F", 40, 10, z)) - 1], ("R", 10, 10, z))


class TestEveryCycleAndBasis(PathKinds):

    def test_the_canned_cycles(self):
        for name in ("g81", "g82", "g83", "g83_high", "g73", "g85", "g89"):
            for ret in ("98", "99"):
                with self.subTest(f"pk_{name}_{ret}"):
                    self.holds(f"pk_{name}_{ret}")

    def test_pecks_written_out_an_arc_between_a_subroutine_s_loop(self):
        for case in ("pk_expanded", "pk_helix", "pk_sub"):
            with self.subTest(case):
                self.holds(case)

    def test_offsets_fixtures_g92_and_a_rotation_between_the_moves(self):
        # a relabel vertex (G43, a fixture, G92) lies in the rapid stream: it is
        # a change of stream like any other for the feeds around it
        for case in ("pk_g43", "pk_fixtures", "pk_g92", "pk_rotated"):
            with self.subTest(case):
                a, _b = self.holds(case)
                if case in ("pk_g43", "pk_fixtures"):
                    self.assertTrue(any(v["still"] for v in a), f"{case}: the relabel vertex")

    def test_the_inch_machine_and_the_inch_program(self):
        self.holds("pk_inch", units="in")
        self.holds("pk_inch_on_mm")

    def test_the_rotary_form_and_kinematics_markers(self):
        a, _b = self.holds("pk_rotary")
        self.assertIn("feed_abc", payload("pk_rotary"), "the 6D form")
        self.assertTrue(any(v["abc"][0] for v in a))
        self.holds("pk_kins")
        self.assertIn("rapid_kinstype", payload("pk_kins"), "the kinematics markers read")

    def test_other_channels_cases(self):
        # relabels and unknown starts (a tool change), the start-dependent
        # beginning, a braking range and the M600 routine, limit stretches
        for case in ("g43_mid", "m6_tc_position", "m6_in_place", "r94_g98_below_r", "e_single", "e_g53_rdp",
                     "m600_known", "lim_loop_cap", "lim_collinear", "lim_collinear_rapid", "lim_arc"):
            with self.subTest(case):
                self.holds(case)


class TestTheCourseInsideARun(PathKinds):
    """Codex R487 H1: to and fro inside a run of one kind."""

    def holds(self, case, units="mm", timed=True):
        # the way back along a segment and the place at every time are two
        # rules: with a time axis the second finds nearly every way back too;
        # without one (or with an F0 stretch) the first stands alone
        a, b = super().holds(case, units)
        if case not in ("pk_speeds",):     # … and only the time knows a speed
            c, _d = super().holds(case, units, timed=False)
            self.assertEqual([v["seq"] for v in c], [v["seq"] for v in a], f"{case}: the same vertices without a time axis")
        return a, b

    def test_codex_s_program_keeps_its_turns_and_its_two_controls_do(self):
        for case, want in (("pk_rev", [40, -10, 15, -5, 20]), ("pk_rev_one", [40, -2, 15]), ("pk_rev_two", [40, -2, 15, -10, 20])):
            with self.subTest(case):
                a, _b = self.holds(case)
                self.assertEqual([round(v["p"][2], 3) for v in a], want)

    def test_repeated_by_rapid_and_by_feeds_of_one_line(self):
        a, b = self.holds("pk_rev_many")
        # the last way up is two moves of one line of motion (Z25, then Z40)
        self.assertEqual(len(b) - len(a), 1)
        a, b = self.holds("pk_rev_feed")
        self.assertEqual(len(b), len(a), "a feed to and fro on one line: every turn")
        a, b = self.holds("pk_rev_feed_x")
        self.assertEqual(len(b), len(a))
        self.holds("pk_rev_sub")
        self.holds("pk_rev_inch", units="in")

    def test_the_rotary_form(self):
        a, b = self.holds("pk_rev_rotary")
        turns = [round(v["abc"][0], 3) for v in a if v["stream"] == "rapid"]
        self.assertEqual([x for i, x in enumerate(turns) if i == 0 or x != turns[i - 1]][:6], [0.0, 50.0, 10.0, 40.0, 20.0, 60.0])
        self.assertEqual([round(v["abc"][0], 3) for v in a if v["stream"] == "feed"], [round(v["abc"][0], 3) for v in b if v["stream"] == "feed"])
        a, b = self.holds("pk_rev_rotary_x")
        self.assertEqual(len(a), len(b))

    def test_straight_and_even_is_still_thinned(self):
        a, b = self.holds("pk_even")
        self.assertEqual([(v["stream"], [round(x, 3) for x in v["p"]]) for v in a],
                         [("rapid", [0, 0, 40]), ("rapid", [50, 30, 40]), ("rapid", [50, 30, -5]), ("feed", [50, 30, -5]), ("feed", [18, 30, -5]),
                          ("rapid", [18, 30, 40])])
        self.assertEqual(len(b), 16)

    def test_the_place_at_every_time_and_the_feed_s_line(self):
        # one line at two speeds: 12 % of its places at the wrong time, up to
        # 13 mm, as one segment
        a, b = self.holds("pk_speeds")
        self.assertEqual(len(a), len(b))
        # three moves of one line, then another line in the same direction at
        # the same speed: the third move read as the next line's
        self.holds("pk_line_tail")
        # the second call of a one-line subroutine: the line is the same, the call is not
        a, b = self.holds("pk_line_subs")
        self.assertEqual([round(v["p"][0], 3) for v in a if v["stream"] == "feed"], [54.0, 62.0, 66.0, 74.0])
        self.assertEqual(len(b) - len(a), 2)

    def test_a_rapid_s_line_is_its_straight_run_s_last(self):
        # what is NOT kept: rapids keep no line anchors. Where they run straight
        # and even over several lines the segment reads its last line (the
        # place at every time is kept)
        import struct
        a, b = self.holds("pk_even")
        line = lambda v: struct.unpack("<I", v["_lines"])[0]
        self.assertEqual([line(v) for v in a if v["stream"] == "rapid"], [2, 3, 7, 14])
        self.assertEqual([line(v) for v in b if v["stream"] == "rapid"], [2, 3, 4, 5, 6, 7, 14])


def to_and_fro(seed):
    """A random program of runs to and fro inside one kind: by rapid (a line
    per move) and by feed (an o-word loop, ONE line for every move), along one
    axis, a diagonal, a rotary, over values drawn close and far, some of them
    small enough to ask the tolerance; speeds that change inside the loop."""
    r = random.Random(seed * 7919)
    out = ["G21 G54 G17 G40 G49 G80 G90 G94", "G0 X0 Y0 Z40"]
    rotary = seed % 3 == 0
    n = 0
    for _ in range(r.randint(4, 8)):
        axis = r.choice(("X", "Y", "Z", "XY", "XZ") + (("A", "XA") if rotary else ()))
        scale = r.choice((0.01, 0.2, 10, 10, 10))
        vals = [round(r.choice((0, 1, 2, 3, 4, 5)) * scale + r.choice((0, 0, 0, 0.002, 0.0004)), 4) for _ in range(r.randint(3, 9))]
        word = lambda v: "".join(f"{a}{v}" for a in axis)
        if r.random() < 0.5:
            out += [f"G0 {word(v)}" for v in vals]
        else:
            # one motion line for all of them (an indirect #[…] would read what
            # nobody can say, and the beginning is not bound then)
            n += 1
            speed = r.choice(("F300", "F[200 + 700*[#1 MOD 2]]"))
            value = "[" + "+".join(f"[#1 EQ {i}]*{v}" for i, v in enumerate(vals)) + "]"
            out += ["#1=0", f"o{100 + n} while [#1 LT {len(vals)}]", f"#2={value}",
                    "G1 " + "".join(f"{a}#2" for a in axis) + f" {speed}", "#1=[#1+1]", f"o{100 + n} endwhile"]
    return "\n".join(out) + "\nM2\n"


def program(seed):
    """A random program whose moves meet on few lines: X / Y on a coarse grid,
    Z on a few levels, single-axis moves, so many vertices are collinear across
    the two streams; pecks, canned cycles, arcs, offsets and fixtures between."""
    r = random.Random(seed)
    z = lambda: r.choice((15, 8, 5, 3, 1, -1, -2, -3, -5, -8))
    grid = (0, 10, 20, 30)
    out = ["G21 G54 G17 G40 G49 G80 G90 G94", "G0 X0 Y0 Z40"]
    for _ in range(r.randint(25, 60)):
        k = r.random()
        if k < 0.34:
            out.append(f"G{r.choice((0, 0, 1))} Z{z()} F{r.choice((100, 300))}")
        elif k < 0.52:
            out.append(f"G{r.choice((0, 1))} {r.choice('XY')}{r.choice(grid)} F200")
        elif k < 0.60:
            out.append(f"G{r.choice((0, 1))} X{r.choice(grid)} Y{r.choice(grid)} Z{z()} F200")
        elif k < 0.72:
            top = r.choice((2, 4, 9))
            out.append(f"G{r.choice((98, 99))} {r.choice(('G81', 'G82 P0.1', 'G83 Q2.5', 'G73 Q2', 'G85', 'G89 P0.1'))} "
                       f"X{r.choice(grid)} Y{r.choice(grid)} Z{top - r.choice((6, 11))} R{top} F100")
            for _ in range(r.randint(0, 2)):
                out.append(f"{r.choice('XY')}{r.choice(grid)}")
            out.append("G80")
        elif k < 0.80:
            out.append(f"G1 X10 Y10 F300\nG{r.choice((2, 3))} X10 Y10 I{r.choice((-4, 4))} J0 Z{z()}")
        elif k < 0.86:
            out.append(r.choice(("G43 H1", "G43 H2", "G49")))
        elif k < 0.92:
            out.append(r.choice(("G55", "G54", "G92 Z2", "G92.1")))
        else:
            out.append("G91\n" + "\n".join(f"G{r.choice((0, 1))} Z{r.choice((-2, -1, 1, 2))} F100" for _ in range(r.randint(1, 4))) + "\nG90")
    return "\n".join(out) + "\nG80\nG49\nG92.1\nM2\n"


class TestRandomPrograms(PathKinds):
    SEEDS = range(1, 25)

    def test_random_programs_keep_their_runs(self):
        with tempfile.TemporaryDirectory(prefix="path-kinds-prog-") as tmp:
            files = {}
            for seed in self.SEEDS:
                rotary = seed % 4 == 0
                inch = seed % 6 == 0
                text = program(seed)
                if rotary:
                    text = text.replace("G0 X0 Y0 Z40", "G0 X0 Y0 Z40 A0").replace("G80\nG49", "G0 A20\nG1 A30 F500\nG0 A10\nG0 A50\nG80\nG49")
                f = Path(tmp) / f"p{seed}.json"
                f.write_text(json.dumps([text, "in" if inch else "mm", 0.0, [490],
                                         {"rotary": rotary, "zmin": -500, "zmax": 500}]))
                files[seed] = (f"@{f}", "in" if inch else "mm")
            with ThreadPoolExecutor(max_workers=4) as ex:
                list(ex.map(lambda kv: payload(*kv), [(c, full) for c, _u in files.values() for full in (False, True)]))
            kept = dropped = 0
            for seed, (case, units) in files.items():
                with self.subTest(seed=seed):
                    a, b = self.holds(case, units)
                    kept += len(a)
                    dropped += len(b) - len(a)
            self.assertGreater(kept, 1000)
            self.assertGreater(dropped, 100, "the decimation still thins inside a run")

    def test_random_programs_to_and_fro_keep_their_course(self):
        with tempfile.TemporaryDirectory(prefix="path-kinds-rev-") as tmp:
            files = {}
            for seed in self.SEEDS:
                f = Path(tmp) / f"r{seed}.json"
                inch = seed % 5 == 0
                f.write_text(json.dumps([to_and_fro(seed), "in" if inch else "mm", 0.0, [490], {"rotary": seed % 3 == 0, "zmin": -500, "zmax": 500}]))
                files[seed] = (f"@{f}", "in" if inch else "mm")
            with ThreadPoolExecutor(max_workers=4) as ex:
                list(ex.map(lambda kv: payload(*kv), [(c, full) for c, _u in files.values() for full in (False, True)]))
            kept = dropped = 0
            for seed, (case, units) in files.items():
                with self.subTest(seed=seed):
                    a, b = self.holds(case, units)
                    kept += len(a)
                    dropped += len(b) - len(a)
            self.assertGreater(kept, 500)
            self.assertGreater(dropped, 20, "what runs one way and evenly is still thinned")


class TestTheClientsPayloadsAreFresh(unittest.TestCase):
    """The payloads lcnc-webui/src/viewer/pathKinds.test.ts takes through the
    client, regenerated from the worker under test and compared byte for byte
    (the reason in test_start_dep_worker's freshness guard)."""

    def test_each_payload_is_what_the_worker_under_test_writes(self):
        import importlib.util
        root = HERE.parent
        spec = importlib.util.spec_from_file_location("gen_path_kinds_payloads", root / "scripts" / "gen_path_kinds_payloads.py")
        assert spec is not None and spec.loader is not None
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        committed = sorted(p.name for p in gen.OUT.glob("*.msgpack"))
        self.assertEqual(committed, sorted(f"{c}{x}.msgpack" for c in gen.CASES for x in ("", ".full")))
        stale = []
        with tempfile.TemporaryDirectory(prefix="path-kinds-fresh-") as tmp:
            for case in gen.CASES:
                for full in (False, True):
                    name = f"{case}{'.full' if full else ''}.msgpack"
                    if not gen.write_payload(case, Path(tmp) / name, full):
                        raise unittest.SkipTest("no native LinuxCNC modules")
                    if (Path(tmp) / name).read_bytes() != (gen.OUT / name).read_bytes():
                        stale.append(name)
        self.assertEqual(stale, [], "regenerate (scripts/gen_path_kinds_payloads.py) and review the difference")


class TestTheChord(unittest.TestCase):
    """gcode_parse_worker._rdp_keep, pure: what a chord may replace."""

    def keep(self, points, times=None, anchors=(), eps=EPS_MM):
        import numpy as np
        import gcode_parse_worker as worker
        calls = []
        real = worker._course_splits

        def counted(*a):
            calls.append(a[3] - a[2])
            return real(*a)
        worker._course_splits = counted
        try:
            kept = worker._rdp_keep(np.asarray(points, dtype=np.float64), anchors, eps * eps,
                                    None if times is None else np.asarray(times, dtype=np.float64))
        finally:
            worker._course_splits = real
        self.calls = calls
        return kept

    def test_one_way_and_evenly_is_two_points(self):
        n = 20001
        self.assertEqual(self.keep([(i * 0.1, i * 0.05, 0) for i in range(n)], [i * 0.01 for i in range(n)]), [0, n - 1])
        self.assertEqual(len(self.calls), 1)
        # with a rotary turning along, and where a point is off by less than the tolerance
        self.assertEqual(self.keep([(i, 0, 0, i * 2, 0, 0) for i in range(50)], list(range(50))), [0, 49])
        self.assertEqual(self.keep([(i, (i % 2) * 0.004, 0) for i in range(50)]), [0, 49])

    def test_to_and_fro_is_kept_in_one_pass(self):
        # an axis run to and fro: every turn, at one look (not one per turn)
        pts = [(0, 0, 0)] + [(100 - (i % 3) * 0.5 if i % 2 else 1 + (i % 5) * 0.5, 0, 0) for i in range(1, 20001)] + [(100.5, 0, 0)]
        self.assertEqual(self.keep(pts), list(range(len(pts))))
        self.assertLessEqual(len(self.calls), 3)
        # monotone stretches between the turns are still thinned
        pts = [(x, 0, 0) for x in (0, 10, 20, 50, 40, 30, 35, 41, 60, 80)]
        self.assertEqual(self.keep(pts), [0, 3, 5, 9])
        # Codex's program, and before its first point (a turn at the chord's start)
        self.assertEqual(self.keep([(0, 0, z) for z in (40, -10, 15, -5, 20)]), [0, 1, 2, 3, 4])

    def test_small_steps_back_add_up(self):
        # 1000 steps back of 1e-5 mm, each below the wire's resolution: 0.01 mm
        pts = [(0, 100, 0), (1, 100, 0)] + [(1 - i * 1e-5, 100, 0) for i in range(1, 1001)] + [(2, 100, 0)]
        self.assertEqual(self.keep(pts), [0, 1, 1001, 1002])
        # … and 2e-5 in all is the rounding of the wire: thinned
        pts = [(0, 100, 0), (1, 100, 0)] + [(1 - i * 2e-8, 100, 0) for i in range(1, 1001)] + [(2, 100, 0)]
        self.assertEqual(self.keep(pts), [0, len(pts) - 1])

    def test_out_and_back_to_one_point(self):
        # no direction to run along: whoever left is kept, however little
        self.assertEqual(self.keep([(0, 0, 0), (0.004, 0, 0), (0, 0, 0)]), [0, 1, 2])
        self.assertEqual(self.keep([(5, 5, 5)] * 40), [0, 39])
        self.assertEqual(self.keep([(0, 0, 0)] + [(0.004 * (i % 2), 0, 0) for i in range(1, 400)] + [(0, 0, 0)]), list(range(400)) + [400])
        self.assertLessEqual(len(self.calls), 4)

    def test_a_rotary_s_way_back_is_a_way_back(self):
        pts = [(0, 0, 0, a, 0, 0) for a in (0, 50, 10, 40, 60)]
        self.assertEqual(self.keep(pts), [0, 1, 2, 4])   # 10 → 40 → 60 is one way
        self.assertEqual(self.keep([(x, 0, 0, a, 0, 0) for x, a in ((0, 0), (10, 5), (20, 10), (15, 7.5), (40, 20))]), [0, 2, 3, 4])

    def test_one_line_at_two_speeds(self):
        pts = [(x, 0, 0) for x in (0, 10, 20, 30, 40)]
        self.assertEqual(self.keep(pts, [0, 1, 2, 3, 4]), [0, 4])
        self.assertEqual(self.keep(pts, [0, 1, 2, 2.1, 2.2]), [0, 2, 4])
        self.assertEqual(self.keep(pts), [0, 4], "no time axis: the client times the path by its length")
        # a stretch that stands still in time (no feed rate): its ends are one instant
        self.assertEqual(self.keep(pts, [0, 0, 0, 0, 0]), [0, 4])
        # alternating: one look
        n = 4001
        self.assertEqual(self.keep([(i * 5, 0, 0) for i in range(n)], [3.5 * i + (i % 2) for i in range(n)]), list(range(n)))
        self.assertLessEqual(len(self.calls), 2)
        # a speed that changes slowly, each step below the tolerance: the place at every time
        t = [0.0]
        for i in range(400):
            t.append(t[-1] + 0.01 / (1 + i * 0.01))
        self.assertGreater(len(self.keep([(i * 0.01, 0, 0) for i in range(401)], t)), 2)

    def test_random_ways_keep_places_turns_and_times(self):
        import numpy as np
        for seed in range(400):
            r = random.Random(seed)
            dim = r.choice((3, 6))
            n = r.randint(3, 60)
            step = r.choice((0.003, 0.05, 2.0))
            speed = r.choice((None, "even", "uneven"))
            p, pts, t, times = [r.choice((0.0, 900.0)) for _ in range(dim)], [], 0.0, []
            heading = [r.choice((-1, 0, 1)) for _ in range(dim)]
            for _ in range(n):
                if r.random() < 0.4:
                    heading = [r.choice((-1, 0, 0, 1)) for _ in range(dim)] if r.random() < 0.5 else [-h for h in heading]
                q = [a + h * step * r.choice((0, 1, 2)) + r.choice((0, 0, 0.001)) for a, h in zip(p, heading)]
                d = sum((a - b) ** 2 for a, b in zip(p, q)) ** 0.5
                t += d / (1.0 if speed != "uneven" else r.choice((1.0, 1.0, 9.0)))
                p = q
                pts.append(q)
                times.append(t)
            kept = self.keep(pts, times if speed else None, [0, n // 2])
            self.assertEqual(kept, sorted(set(kept)))
            self.assertTrue({0, n // 2, n - 1} <= set(kept))
            P, T = np.asarray(pts), np.asarray(times)
            back = min(EPS_MM, 4 * spacing(np.abs(P).max()))
            for i, j in zip(kept, kept[1:]):
                u = P[j] - P[i]
                L = float(np.linalg.norm(u))
                far = 0.0
                for k in range(i + 1, j):
                    d = P[k] - P[i]
                    if L > back:
                        s = float(d @ u) / L
                        self.assertGreaterEqual(s, far - back - 1e-9, f"seed {seed}: {i}..{j}: {k} runs back")
                        self.assertLessEqual(s, L + back + 1e-9)
                        far = max(far, s)
                        w = min(1.0, max(0.0, s / L))
                        self.assertLessEqual(float(np.linalg.norm(d - w * u)), EPS_MM + 1e-9, f"seed {seed}: {i}..{j}: {k}")
                    else:
                        self.assertLessEqual(float(np.linalg.norm(d)), back + 1e-9, f"seed {seed}: {i}..{j}: {k} left and came back")
                    if speed and T[j] > T[i]:
                        w = float((T[k] - T[i]) / (T[j] - T[i]))
                        self.assertLessEqual(float(np.linalg.norm(d - w * u)), EPS_MM + 1e-9, f"seed {seed}: {i}..{j}: {k} at its time")


class TestTheAnchors(unittest.TestCase):
    """gateway_util.list_change_indices, pure."""

    def test_both_sides_of_every_change_in_both_streams(self):
        import gateway_util
        f = gateway_util.list_change_indices
        feed, rapid = [3, 4, 5, 9, 10], [1, 2, 6, 7, 8, 11, 12]
        # 1 2 | 3 4 5 | 6 7 8 | 9 10 | 11 12
        self.assertEqual(f(feed, rapid), {2, 3})
        self.assertEqual(f(rapid, feed), {1, 2, 4, 5})

    def test_execution_order_not_adjacency(self):
        import gateway_util
        f = gateway_util.list_change_indices
        # doubled seqs (relabel vertices inserted at odd ones): 2 4 6 are one run
        self.assertEqual(f([2, 4, 6, 10], [8]), {2, 3})
        # a relabel vertex in the rapid stream between two feeds
        self.assertEqual(f([2, 4, 6, 8], [5]), {1, 2})

    def test_nothing_to_anchor(self):
        import gateway_util
        f = gateway_util.list_change_indices
        self.assertEqual(f([], [1]), set())
        self.assertEqual(f([1], [2]), set())
        self.assertEqual(f([1, 2, 3], []), set())
        self.assertEqual(f([5, 6, 7], [1, 2, 3]), set(), "one change only, at the stream's own first vertex")


if __name__ == "__main__":
    unittest.main()
