"""P6-a red proofs (plan maschinentag.r457.p6a-plan-v3.md "Mutations", Codex
R457): each mutation breaks ONE part of rule 1 — the believed start read in the
callback that records the program's first point — and its named guards must
fail AT that part. Isolated on the rule-1 head (Codex R457 note 2): no
mutation seeds the canon's `lo` (rule 2, F9-L, is not built; the plan's M8 /
M9 were rule-2 mutations and do not apply). M11–M13 add the one-callback proof
of Codex's note 1.

The client and page guards read COMMITTED native payloads: for them the
runner regenerates the fixtures with the mutation applied
(scripts/gen_start_dep_payloads.py), runs the guard and puts every fixture
back byte-identical; a page guard (pw) rebuilds the page and runs its spec —
under the heavy lock (the page is rebuilt from the restored tree afterwards).
M1 is 4eda3892's rule exactly (`start_lo` = the canon's `lo` at the program's
begin): its red guards are the red-at-the-base proof.

  python3 -I docs/reviews/p6a.mutations.py [name ...]
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CANON = "lcnc-gateway/gcode_canon.py"
FIX = ROOT / "scripts/test_fixtures/start_dep_payloads"
NAT = "test_start_dep_worker.py::TestTheBelievedStartUnderFixtures::"
UNIT = "test_start_dep_worker.py::TestTheReadBelongsToTheFirstPoint::"
VT = "src/viewer/startDepPayloads.test.ts"


def py(node, at):
    return ("pytest", [node, at])


def vt(name, at):
    """A client guard over the regenerated native payloads."""
    return ("vitest", [VT, name, at])


def pw(grep, at):
    """The page: the regenerated payloads, the page rebuilt, its spec run."""
    return ("pw", ["e2e/start-believed.viewer.spec.ts", grep, at])


# the rule-1 head's anchors (gcode_canon.py)
TAKE = ("            self.start_lo, self._start_proof = self._start_proof, None\n"
        "            if self.start_unbound is None:\n"
        "                self.start_unbound = ((0, 1, 2) if self.start_lo is None\n"
        "                                      else tuple(a for a in (0, 1, 2) if a in self.stale))\n")
TAKE_OLD = ("            self._start_proof = None\n"
            "            if self.start_unbound is None:\n"
            "                self.start_unbound = tuple(a for a in (0, 1, 2) if a in self.stale)\n")
BEGIN = "            self._start_tlo = (self.xo, self.yo, self.zo)\n"
REBASE = "        return (lx + (self.xo - sx), ly + (self.yo - sy), lz + (self.zo - sz))\n"
UNITS = "            x, y, z = float(t.current_x) / d, float(t.current_y) / d, float(t.current_z) / d\n"
COMP = ("            if int(t.cutter_comp_side) and float(t.cutter_comp_radius) > 0.0:\n"
        "                return None\n")

MUTS = {
    # M1: 4eda3892 — the canon's `lo` at the program's begin (machine zero)
    "m1_the_canon_lo_at_the_begin": (CANON, [
        (TAKE, TAKE_OLD),
        (BEGIN, BEGIN + "            self.start_lo = tuple(float(v) for v in self.lo)\n")],
        [py(NAT + "test_a_frame_change_before_the_first_motion", "g55_first X"),
         py(NAT + "test_the_machine_day_s_head", "mday_head X"),
         vt("g55_first, live at the believed start", "stays where the machine stands"),
         vt("the machine day's head", "238.525"),
         pw("machine day's head", "the entry ends straight above where the machine stands")]),
    # M2: R456's v2 read — the interpreter at the program's begin, through the
    # canon's offsets of that moment (the interpreter in G55, the canon in G54)
    "m2_the_read_at_the_begin": (CANON, [
        (TAKE, TAKE_OLD),
        (BEGIN, BEGIN + "            _t = self.interp()\n"
                        "            if _t is not None:\n"
                        "                _k = 1 / 25.4 if int(_t.length_units) == 2 else 1\n"
                        "                self.start_lo = tuple(self.rotate_and_translate(\n"
                        "                    *(float(getattr(_t, a)) * _k for a in ('current_x', 'current_y', 'current_z')),\n"
                        "                    0, 0, 0, 0, 0, 0))[:3]\n")],
        [py(NAT + "test_equal_where_it_was_right", "g55_first_rot X"),
         vt("g55_first_rot, live at the believed start", "stays where the machine stands")]),
    # M3: no re-base to the tool offset at the program's begin
    "m3_no_rebase": (CANON, [(REBASE, "        return (lx, ly, lz)\n")],
        [py(NAT + "test_the_tool_offset_before_the_first_point_is_re_based", "g43_line_then_x Z"),
         py(UNIT + "test_the_interpreter_s_unit_and_the_start_tool_basis", "re-based to the begin's tool offset"),
         vt("g43_line_then_x, live at the believed start", "Z: stays where the machine stands")]),
    # M4: no unit conversion (the interpreter's millimetres taken as inches)
    "m4_no_unit_conversion": (CANON, [
        (UNITS, "            x, y, z = float(t.current_x), float(t.current_y), float(t.current_z)\n")],
        [py(NAT + "test_a_frame_change_before_the_first_motion", "g55_first X"),
         vt("g55_first, live at the believed start", "stays where the machine stands")]),
    # M5: the MACHINE's unit instead of the interpreter's (a G20 block on a mm machine)
    "m5_the_machine_unit": (CANON, [
        (UNITS, "            d = 25.4 if abs(float(self.s.linear_units) - 1.0) < 1e-9 else 1.0\n" + UNITS)],
        [py(NAT + "test_the_interpreter_s_unit", "g20_g55 X"),
         vt("g20_g55, live at the believed start", "stays where the machine stands")]),
    # M6: no cutter-compensation queue check
    "m6_no_comp_queue_check": (CANON, [(COMP, "")],
        [py(NAT + "test_the_comp_queue_gives_no_read", "comp_first_g55"),
         vt("cutter-compensation queue", "comp_first_g55")]),
    # M7: no read → the canon's `lo` as the believed start (a guessed fallback)
    "m7_fall_back_to_lo": (CANON, [
        (TAKE, "            self.start_lo, self._start_proof = (self._start_proof if self._start_proof is not None\n"
               "                                                 else tuple(self.lo[:3])), None\n"
               "            if self.start_unbound is None:\n"
               "                self.start_unbound = tuple(a for a in (0, 1, 2) if a in self.stale)\n")],
        [py(NAT + "test_the_comp_queue_gives_no_read", "comp_first_g55"),
         vt("cutter-compensation queue", "comp_first_g55")]),
    # M10: the read before the handler's begin decision (_enter: _phase)
    "m10_read_before_the_begin_decision": (CANON, [(
        "    def straight_traverse(self, x, y, z, a, b, c, u, v, w):  # pyright: ignore[reportIncompatibleMethodOverride]\n"
        "        self._enter()\n"
        "        if self.suppress > 0: return\n"
        "        try:\n"
        "            if self.seq == 0:\n"
        "                self._start_proof = self._start_read()\n",
        "    def straight_traverse(self, x, y, z, a, b, c, u, v, w):  # pyright: ignore[reportIncompatibleMethodOverride]\n"
        "        _early = self._start_read() if self.seq == 0 else None\n"
        "        self._enter()\n"
        "        if self.suppress > 0: return\n"
        "        try:\n"
        "            if self.seq == 0:\n"
        "                self._start_proof = _early\n")],
        [py(NAT + "test_a_python_remap_s_motion_first_is_read_after_the_begin", "py_motion_first_bound"),
         vt("py_motion_first_bound, live at the believed start", "the parse ships its believed start")]),
    # M11: a callback's read outlives it (the arc's, recording nothing)
    "m11_the_read_outlives_its_callback": (CANON, [(
        "            super().arc_feed(x1, y1, cx, cy, rot, z1, a, b, c, u, v, w)\n"
        "        finally:\n"
        "            self._start_proof = None\n",
        "            super().arc_feed(x1, y1, cx, cy, rot, z1, a, b, c, u, v, w)\n"
        "        finally:\n"
        "            pass\n")],
        [py(UNIT + "test_a_callback_that_records_nothing_leaves_no_read", "test_a_callback_that_records_nothing")]),
    # M12: no read, but X, Y, Z not unbound (only what is stale)
    "m12_no_read_not_unbound": (CANON, [(
        "                self.start_unbound = ((0, 1, 2) if self.start_lo is None\n"
        "                                      else tuple(a for a in (0, 1, 2) if a in self.stale))\n",
        "                self.start_unbound = tuple(a for a in (0, 1, 2) if a in self.stale)\n")],
        [py(UNIT + "test_a_recorder_no_handler_covers_finds_no_read", "test_a_recorder_no_handler_covers"),
         py(NAT + "test_the_comp_queue_gives_no_read", "comp_first_g55"),
         vt("cutter-compensation queue", "comp_first_g55")]),
    # M13: a motion entry without its read (the feed): a first feed is unbound
    "m13_a_handler_without_the_read": (CANON, [(
        "    def straight_feed(self, x, y, z, a, b, c, u, v, w):  # pyright: ignore[reportIncompatibleMethodOverride]\n"
        "        self._enter()\n"
        "        if self.suppress > 0: return\n"
        "        try:\n"
        "            if self.seq == 0:\n"
        "                self._start_proof = self._start_read()\n",
        "    def straight_feed(self, x, y, z, a, b, c, u, v, w):  # pyright: ignore[reportIncompatibleMethodOverride]\n"
        "        self._enter()\n"
        "        if self.suppress > 0: return\n"
        "        try:\n"
        "            if self.seq == 0:\n"
        "                pass\n")],
        [py(UNIT + "test_the_first_point_s_own_callback_reads", "feed: no believed start"),
         py(NAT + "test_a_frame_change_before_the_first_motion", "cx_feed_g55")]),
}


def failures(text):
    lines = text.splitlines()
    return [" | ".join(x.strip() for x in lines[i:i + 3] if x.strip())[:300]
            for i, ln in enumerate(lines) if "AssertionError" in ln or "FAIL" in ln or "Error:" in ln]


def regenerate():
    r = subprocess.run([str(ROOT / "lcnc-gateway/.venv/bin/python3"), "scripts/gen_start_dep_payloads.py"],
                       cwd=ROOT, capture_output=True, text=True, timeout=900)
    return r.returncode == 0, r.stdout + r.stderr


def run_guard(kind, args):
    if kind == "pytest":
        r = subprocess.run([str(ROOT / "lcnc-gateway/.venv/bin/python3"), "-m", "pytest", "-q", "-p", "no:cacheprovider",
                            "-o", "addopts=", args[0]], cwd=ROOT / "lcnc-gateway", capture_output=True, text=True, timeout=900)
        return r.returncode != 0, r.stdout + r.stderr, args[1]
    ok, out = regenerate()
    if not ok:
        return False, out, args[-1]
    if kind == "vitest":
        r = subprocess.run(["npx", "vitest", "run", args[0], "-t", args[1]], cwd=ROOT / "lcnc-webui",
                           capture_output=True, text=True, timeout=900)
        return r.returncode != 0, r.stdout + r.stderr, args[2]
    if kind == "pw":
        b = subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900)
        if b.returncode != 0:
            return False, b.stdout + b.stderr, args[2]
        # never under a timeout: a killed runner orphans its web server (4173)
        r = subprocess.run(["npx", "playwright", "test", args[0], "-g", args[1], "--workers=1", "--reporter=list"],
                           cwd=ROOT / "lcnc-webui", capture_output=True, text=True)
        return r.returncode != 0, r.stdout + r.stderr, args[2]
    raise SystemExit(f"unknown guard kind {kind}")


def main(names):
    out = {}
    for name in names or list(MUTS):
        path, reps, guards = MUTS[name]
        f = ROOT / path
        orig = f.read_bytes()
        fixtures = {p: p.read_bytes() for p in FIX.iterdir()}
        text = orig.decode()
        try:
            for old, new in reps:
                if text.count(old) != 1:
                    raise SystemExit(f"{name}: anchor not unique in {path}: {old[:70]!r}")
                text = text.replace(old, new)
            f.write_text(text)
            results = [run_guard(k, a) for k, a in guards]
        finally:
            f.write_bytes(orig)
            for p in FIX.iterdir():
                if p not in fixtures:
                    p.unlink()
            for p, b in fixtures.items():
                p.write_bytes(b)
            if any(k == "pw" for k, _a in guards):
                # the page back to the tree's own build
                subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, timeout=900, check=True)
        red = all(r for r, _o, _a in results)
        at_rule = red and all(at in o for _r, o, at in results)
        out[name] = {"red": red, "at_rule": at_rule}
        print(json.dumps({"mutation": name, "red": red, "at_rule": at_rule,
                          "guards": [[k, a[0].split("::")[-1] if k == "pytest" else a[1]] for k, a in guards],
                          "failures": [failures(o)[:3] for _r, o, _a in results]}), flush=True)
    print(json.dumps({"total": len(out), "red": sum(v["red"] for v in out.values()),
                      "red_at_rule": sum(v["at_rule"] for v in out.values())}))
    return 0 if all(v["at_rule"] for v in out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
