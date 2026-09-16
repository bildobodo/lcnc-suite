#!/usr/bin/env python3
"""Generate canon WCS-basis fixtures from the REAL LinuxCNC interpreter.

Same discipline as gen_rs274_wcs_fixtures.py and gen_kins_fixtures.py: never
re-derive interpreter semantics — run the real thing, check in what it did, and
let a test pin it.

What is pinned here is which WCS basis the preview extraction must subtract.
The parse worker used to subtract the END-OF-PARSE offsets, which is wrong for
two independent reasons, both reproduced below:

  * `M2` resets the interpreter to G54. So for a program run in any other work
    coordinate system — not just an exotic multi-fixture one — the end-of-parse
    basis is G54's while every segment was produced under the active WCS. The
    whole program renders displaced by the fixture delta.
  * The first MOTION is not the right moment either: a program whose preamble
    selects a different WCS than the active one would then be pinned to the
    preamble's fixture, which is not where it will run.

The right basis is the state after the gateway's initcodes (which force the
machine's ACTIVE WCS) and before the program's first line — what the client
re-adds when it renders.

REQUIRES a running LinuxCNC (the parse binds a live STAT for axis_mask), like
the other oracle generators. Writes lcnc-gateway/canon_fixtures.gen.json.

    lcnc-gateway/.venv/bin/python scripts/gen_canon_fixtures.py
"""
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATEWAY = ROOT / "lcnc-gateway"
sys.path.insert(0, str(GATEWAY))

INI = os.environ.get("CANON_FIXTURE_INI",
                     "/home/cnc/linuxcnc/configs/lcnc_suite_sim/lcnc_suite_sim.ini")
os.environ.setdefault("INI_FILE_NAME", INI)

import linuxcnc          # noqa: E402
import gcode             # noqa: E402
from gcode_canon import PreviewCanon  # noqa: E402

OUT = GATEWAY / "canon_fixtures.gen.json"

# Distinguishable offsets so a wrong basis cannot look right by coincidence.
# Values are MACHINE units (the var file's units — see docs/decisions.md).
VAR_OVERRIDES = {
    "5221": 100.0,   # G54 X
    "5222": 10.0,    # G54 Y
    "5241": 200.0,   # G55 X
    "5242": 20.0,    # G55 Y
}

PROGRAMS = {
    # No WCS word at all: the ONLY thing that changes the basis is M2's reset
    # to G54 — the case that makes this a bug for ordinary programs.
    "plain_m2": """G0 X10 Y0 Z5
G1 X20 Y0 F500
M2
""",
    # Preamble selects G54 while the machine is active in G55: first-motion and
    # program-start disagree, and program-start is the one that renders right.
    "preamble_g54": """G54
G0 X10 Y0 Z5
G1 X20 Y0 F500
M2
""",
    # Switches fixture mid-program. Relative geometry stays exact either way —
    # what moves is where the whole path lands.
    "multifixture": """G54
G0 X10 Y0 Z5
G1 X20 Y0 F500
G55
G0 X10 Y0 Z5
G1 X20 Y0 F500
M2
""",
    # Rewrites the ACTIVE offset mid-program (G10 L2 on the running WCS).
    "g10_rewrite": """G0 X10 Y0 Z5
G10 L2 P2 X250 Y25
G1 X20 Y0 F500
M2
""",
    # G92 plus a G10 R rotation — the combination the rs274 fixtures already
    # pin for the offset formula; here it must survive the basis snapshot too.
    "g92_and_rotation": """G10 L2 P2 R30
G92 X5 Y5
G0 X10 Y0 Z5
G1 X20 Y0 F500
M2
""",
    # Mid-program tool change + G43, then G49 (schema 8 tlo_events): pins
    # WHEN the interpreter fires tool_offset relative to next_line, that
    # the post-G43 traverse is a zero-length unknown-start vertex, the
    # seq convention of the events, and the lo-peel continuity the carry
    # closure rests on. The fixture ini's tool.tbl has T2 Z=47.690467.
    "tlo_midprogram": """G0 X10 Y0 Z5
G1 X20 Y0 F500
T2 M6 G43 H2
G0 X30 Y0 Z5
G1 X40 Y0 F500
G49
G1 X50 Y0 F500
M2
""",
}


def _var_file_with(overrides, src):
    """Copy the machine's var file, overriding specific parameters."""
    lines = Path(src).read_text().splitlines()
    out = []
    for ln in lines:
        tok = ln.split()
        if tok and tok[0] in overrides:
            ln = f"{tok[0]}\t{overrides[tok[0]]:.6f}"
        out.append(ln)
    fd, path = tempfile.mkstemp(suffix=".var")
    os.close(fd)
    Path(path).write_text("\n".join(out) + "\n")
    return path


class _Recorder(PreviewCanon):
    """PreviewCanon plus the two REJECTED candidate bases, so the fixture can
    assert the chosen one differs from them (a non-vacuous test)."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.basis_at_first_motion = None
        # Every tool_offset callback with the line it fired on (schema 8):
        # whether the interpreter fires one for init/initcodes is exactly
        # the kind of fact that must come from the real thing.
        self.tool_offset_calls = []

    def tool_offset(self, *a):
        # [lineno, seq, xo, yo, zo, lo_z_before, tlo_z_before, lo_z_after]:
        # the lo-peel identity (lo_before + tlo_before == lo_after + zo) is
        # what the relabel-carry closure rests on — pinned on the real thing.
        lo_before, tlo_before = self.lo[2], self.zo
        super().tool_offset(*a)
        self.tool_offset_calls.append(
            [self.lineno, self.seq] + [float(v) for v in a[:3]]
            + [float(lo_before), float(tlo_before), float(self.lo[2])])

    def straight_traverse(self, *a):
        if self.basis_at_first_motion is None:
            self.basis_at_first_motion = self.wcs_basis()
        super().straight_traverse(*a)

    def straight_feed(self, *a):
        if self.basis_at_first_motion is None:
            self.basis_at_first_motion = self.wcs_basis()
        super().straight_feed(*a)


def run_one(name, source, initcodes, var_path, stat):
    with tempfile.NamedTemporaryFile("w", suffix=".ngc", delete=False) as fh:
        fh.write(source)
        prog = fh.name
    canon = _Recorder(stat, 0)
    canon.parameter_file = var_path
    try:
        result, err_line = gcode.parse(prog, canon, list(initcodes), "")
    finally:
        os.unlink(prog)
    if result > gcode.MIN_ERROR:
        raise SystemExit(f"{name}: parse failed at line {err_line}: {gcode.strerror(result)}")
    return {
        "name": name,
        "source": source,
        "initcodes": list(initcodes),
        "basis_at_start": canon.basis_at_start,
        "basis_at_end": canon.wcs_basis(),
        "basis_at_first_motion": canon.basis_at_first_motion,
        # A couple of raw canon endpoints so a consumer can check the
        # subtraction itself, not just the basis choice.
        "feed_endpoints": [list(seg[2][:6]) for seg in canon.feed[:4]],
        "rapid_endpoints": [list(seg[2][:6]) for seg in canon.rapid[:4]],
        "feed_count": len(canon.feed),
        "rapid_count": len(canon.rapid),
        # Schema 8: per-segment tool offsets + the event channel.
        "tlo_events": [list(e) for e in canon.tlo_events],
        "tool_offset_calls": canon.tool_offset_calls,
        "feed_tlos": [list(seg[4]) for seg in canon.feed],
        "rapid_tlos": [list(seg[3]) for seg in canon.rapid],
        "feed_seqs": [seg[5] for seg in canon.feed],
        "rapid_seqs": [seg[4] for seg in canon.rapid],
        "feed_starts": [list(seg[1][:3]) for seg in canon.feed],
        "feed_ends": [list(seg[2][:3]) for seg in canon.feed],
        "rapid_starts": [list(seg[1][:3]) for seg in canon.rapid],
        "rapid_ends": [list(seg[2][:3]) for seg in canon.rapid],
        "unknown_start": list(canon.unknown_start),
    }


def main():
    stat = linuxcnc.stat()
    stat.poll()
    ini = linuxcnc.ini(INI)
    src_var = ini.find("RS274NGC", "PARAMETER_FILE")
    if src_var and not os.path.isabs(src_var):
        src_var = os.path.join(os.path.dirname(INI), src_var)
    var_path = _var_file_with(VAR_OVERRIDES, src_var)

    cases = []
    try:
        for name, source in PROGRAMS.items():
            # Forced into G55 — the machine's active WCS as the gateway would
            # push it in. G54 would make every candidate basis agree.
            cases.append(run_one(name, source, ["G21", "G90", "G59"], var_path, stat))
            cases.append(run_one(name + "__g55", source, ["G21", "G90", "G55"], var_path, stat))
    finally:
        os.unlink(var_path)

    payload = {
        "_comment": ("Generated by scripts/gen_canon_fixtures.py from the REAL "
                     "LinuxCNC interpreter. Offsets are in CANON units (inches) "
                     "— the extraction multiplies by unit_scale. Do not hand-edit."),
        "ini": INI,
        "var_overrides": VAR_OVERRIDES,
        "cases": cases,
    }
    OUT.write_text(json.dumps(payload, indent=1) + "\n")
    print(f"wrote {OUT} ({len(cases)} cases)")
    for c in cases:
        s = c["basis_at_start"][0][0] if c["basis_at_start"] else None
        e = c["basis_at_end"][0][0]
        m = c["basis_at_first_motion"][0][0] if c["basis_at_first_motion"] else None
        print(f"  {c['name']:26} start_g5x_x={s} end={e} first_motion={m}")


if __name__ == "__main__":
    main()
