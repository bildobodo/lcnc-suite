#!/usr/bin/env python3
"""Generate golden kins fixtures from the compiled LinuxCNC oracle.

TCP+TWP plan phase 1b — same discipline as gen_rs274_wcs_fixtures.py:
the oracle is the control's OWN code (scripts/kins_oracle/ vendors
trtfuncs.c + kins_util.c verbatim from v2.9.4 and compiles them for the
host), never a re-derivation. One deterministic case set pins BOTH
mirrors:

    lcnc-webui/src/viewer/kinsFixtures.gen.ts   (TS mirror tests)
    lcnc-gateway/kins_fixtures.gen.json          (Python twin tests)

Every forward case is round-tripped through the oracle's own inverse
before being written (self-consistency gate at 1e-9) — a fixture that
the oracle itself cannot reproduce is a generator bug, not a test.

Regenerate:  python3 scripts/gen_kins_fixtures.py   (needs gcc + libm)
"""
import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

SEED = 0x5C1A5
CASES_PER_DIRECTION = 20
ROUNDTRIP_TOL = 1e-9

REPO = Path(__file__).resolve().parent.parent
ORACLE = REPO / "scripts" / "kins_oracle"
TS_OUT = REPO / "lcnc-webui" / "src" / "viewer" / "kinsFixtures.gen.ts"
JSON_OUT = REPO / "lcnc-gateway" / "kins_fixtures.gen.json"

# (kins, label, xrot, yrot, zrot, xoff, yoff, zoff, tooloff)
PARAM_SETS = [
    ("xyzac", "sim-tcp",   0, 0, 0, 0, 20, 10, 0),      # lcnc_suite_sim_5axis_tcp.ini
    ("xyzac", "tool",      0, 0, 0, 0, 20, 10, 35.5),
    ("xyzac", "rot-point", 12.5, -7.25, 4, 0, 20, 10, 8.125),
    ("xyzac", "zero",      0, 0, 0, 0, 0, 0, 0),
    ("xyzbc", "basic",     0, 0, 0, 15, 0, -12, 0),
    ("xyzbc", "full",      3, 7, -2, 15, 0, -12, 21.75),
]

# xyzacb_trsrn.comp (TWP phase 3): geometry = (y_pivot, z_pivot, x_offset,
# y_offset, y_rot_axis, z_rot_axis, nut_angle_deg, tool_offset_z); plane =
# (pre_rot RADIANS, primary DEG = table C, secondary DEG = spindle B) —
# remap.py's set_p unit asymmetry, see kins_oracle/README.md. "spike-live"
# pins the exact configuration validated against the 2.9.4 captures.
TRSRN_GEO_SPIKE = (50, 120, 0, 0, -1000, -2000, 55, 100)
TRSRN_GEO_PLAIN = (50, 120, 10, -5, 0, 0, 45, 35.5)
TRSRN_GEO_ZERO = (0, 0, 0, 0, 0, 0, 55, 0)
# (label, geometry, switchkins_type, plane)
TRSRN_PARAM_SETS = [
    ("spike-live-tool", TRSRN_GEO_SPIKE, 2, (-1.781762, 130.2455, -40.8555)),
    ("spike-live-tcp",  TRSRN_GEO_SPIKE, 1, (0, 0, 0)),
    ("identity",        TRSRN_GEO_SPIKE, 0, (0, 0, 0)),
    ("plain-tool",      TRSRN_GEO_PLAIN, 2, (0.35, 60.0, -30.0)),
    ("plain-tcp",       TRSRN_GEO_PLAIN, 1, (0, 0, 0)),
    ("zero-tool",       TRSRN_GEO_ZERO,  2, (0.0, 0.0, 0.0)),
]


def compile_harness(build: Path) -> Path:
    exe = build / "harness"
    cmd = ["gcc", "-O2", "-Wall", "-I", str(ORACLE / "stub"),
           "-o", str(exe), str(ORACLE / "harness.c"), str(ORACLE / "kins_util.c"), "-lm"]
    subprocess.run(cmd, check=True)
    return exe


def compile_trsrn_harness(build: Path) -> Path:
    # halcompile-equivalent split: the comp's C body is everything after
    # the first `;;` separator line; harness_trsrn.c includes it verbatim.
    src = (ORACLE / "xyzacb_trsrn.comp").read_text()
    (build / "xyzacb_trsrn_body.c").write_text(src.split("\n;;\n", 1)[1])
    exe = build / "harness_trsrn"
    cmd = ["gcc", "-O2", "-Wall", "-I", str(ORACLE / "stub"), "-I", str(build),
           "-o", str(exe), str(ORACLE / "harness_trsrn.c"), "-lm"]
    subprocess.run(cmd, check=True)
    return exe


def run_oracle(exe: Path, kins: str, params, lines):
    args = [str(exe), kins] + [repr(float(p)) for p in params]
    r = subprocess.run(args, input="".join(lines), capture_output=True, text=True, check=True)
    out = r.stdout.splitlines()
    if len(out) != len(lines):
        sys.exit(f"oracle answered {len(out)}/{len(lines)} lines for {kins} {params}")
    return [[float(v) for v in line.split()] for line in out]


def gen_set(exe: Path, rng: random.Random, kins: str, label: str, params):
    def joints_case():
        # j3 is A (xyzac, ±100 like the sim) or B (xyzbc, -30..180 DMU-style)
        rot1 = rng.uniform(-100, 50) if kins == "xyzac" else rng.uniform(-30, 180)
        return [round(rng.uniform(-200, 200), 3) for _ in range(3)] + \
               [round(rot1, 3), round(rng.uniform(-720, 720), 3)]

    def world_case():
        rot1 = rng.uniform(-100, 50) if kins == "xyzac" else rng.uniform(-30, 180)
        w = [round(rng.uniform(-200, 200), 3) for _ in range(3)], round(rot1, 3), round(rng.uniform(-720, 720), 3)
        xyz, r1, c = w
        return xyz + ([r1, 0.0, c] if kins == "xyzac" else [0.0, r1, c])

    fwd_in = [joints_case() for _ in range(CASES_PER_DIRECTION)]
    inv_in = [world_case() for _ in range(CASES_PER_DIRECTION)]

    fwd_out = run_oracle(exe, kins, params,
                         [f"F {j[0]} {j[1]} {j[2]} {j[3]} {j[4]} 0\n" for j in fwd_in])
    inv_out = run_oracle(exe, kins, params,
                         [f"I {w[0]} {w[1]} {w[2]} {w[3]} {w[4]} {w[5]}\n" for w in inv_in])

    # Self-consistency gate: the oracle's inverse must reproduce every
    # forward case's joints from its own world output.
    rt = run_oracle(exe, kins, params,
                    [f"I {w[0]} {w[1]} {w[2]} {w[3]} {w[4]} {w[5]}\n" for w in fwd_out])
    for j_in, j_rt in zip(fwd_in, rt):
        worst = max(abs(a - b) for a, b in zip(j_in, j_rt))
        if worst > ROUNDTRIP_TOL:
            sys.exit(f"oracle self-roundtrip failed ({kins}/{label}): {worst}")

    px = ["xRotPoint", "yRotPoint", "zRotPoint", "xOffset", "yOffset", "zOffset", "toolOffset"]
    return {
        "kins": f"{kins}-trt", "label": label,
        "params": {k: float(v) for k, v in zip(px, params)},
        "forward": [{"input": i, "expect": o} for i, o in zip(fwd_in, fwd_out)],
        "inverse": [{"input": i, "expect": o} for i, o in zip(inv_in, inv_out)],
    }


def run_trsrn(exe: Path, geo, lines):
    args = [str(exe)] + [repr(float(g)) for g in geo]
    r = subprocess.run(args, input="".join(lines), capture_output=True, text=True, check=True)
    out = r.stdout.splitlines()
    if len(out) != len(lines):
        sys.exit(f"trsrn oracle answered {len(out)}/{len(lines)} lines for {geo}")
    return out


def gen_trsrn_set(exe: Path, rng: random.Random, label: str, geo, mode: int, plane):
    def joints_case():
        return [round(rng.uniform(-200, 200), 3) for _ in range(3)] + \
               [round(rng.uniform(-100, 100), 3),   # A
                round(rng.uniform(-120, 30), 3),    # B (spindle, nutating chain)
                round(rng.uniform(-360, 360), 3)]   # C (table)

    fwd_in = [joints_case() for _ in range(CASES_PER_DIRECTION)]
    inv_in = [joints_case() for _ in range(CASES_PER_DIRECTION)]  # same ranges as world

    prelude = [f"S {mode}\n", f"P {plane[0]} {plane[1]} {plane[2]}\n"]

    def parse(out_lines):
        vals = []
        for line in out_lines:
            if line in ("OK", "ERR"):
                sys.exit(f"trsrn oracle unexpected '{line}' in case output ({label})")
            vals.append([float(v) for v in line.split()])
        return vals

    raw = run_trsrn(exe, geo, prelude + [f"F {' '.join(map(str, j))}\n" for j in fwd_in])
    assert raw[0] == "OK" and raw[1] == "OK"
    fwd_out = parse(raw[2:])
    raw = run_trsrn(exe, geo, prelude + [f"I {' '.join(map(str, w))}\n" for w in inv_in])
    inv_out = parse(raw[2:])

    # Self-consistency gate: inverse must reproduce every forward case.
    raw = run_trsrn(exe, geo, prelude + [f"I {' '.join(map(str, w))}\n" for w in fwd_out])
    for j_in, line in zip(fwd_in, raw[2:]):
        j_rt = [float(v) for v in line.split()]
        worst = max(abs(a - b) for a, b in zip(j_in, j_rt))
        if worst > ROUNDTRIP_TOL:
            sys.exit(f"trsrn oracle self-roundtrip failed ({label}): {worst}")

    gx = ["yPivot", "zPivot", "xOffset", "yOffset", "yRotAxis", "zRotAxis",
          "nutAngle", "toolOffset"]
    px = ["preRot", "primaryAngle", "secondaryAngle"]
    return {
        "kins": "xyzacb-trsrn", "label": label, "mode": mode,
        "params": {**{k: float(v) for k, v in zip(gx, geo)},
                   **{k: float(v) for k, v in zip(px, plane)}},
        "forward": [{"input": i, "expect": o} for i, o in zip(fwd_in, fwd_out)],
        "inverse": [{"input": i, "expect": o} for i, o in zip(inv_in, inv_out)],
    }


def main():
    rng = random.Random(SEED)
    with tempfile.TemporaryDirectory() as td:
        exe = compile_harness(Path(td))
        sets = [gen_set(exe, rng, k, l, p) for (k, l, *p) in PARAM_SETS]
        texe = compile_trsrn_harness(Path(td))
        trsrn_sets = [gen_trsrn_set(texe, rng, l, g, m, pl)
                      for (l, g, m, pl) in TRSRN_PARAM_SETS]

    header = (f"// AUTO-GENERATED by scripts/gen_kins_fixtures.py — DO NOT EDIT.\n"
              f"// Oracle: LinuxCNC v2.9.4 trtfuncs.c/kins_util.c + master@493926b56c\n"
              f"// xyzacb_trsrn.comp compiled via scripts/kins_oracle/ (see its README\n"
              f"// for provenance). Seed {SEED:#x}.\n"
              f"// Regenerate: python3 scripts/gen_kins_fixtures.py\n")
    ts = header
    ts += ("export interface KinsFixtureCase { input: number[]; expect: number[] }\n"
           "export interface KinsFixtureSet {\n"
           "  kins: string; label: string;\n"
           "  params: { xRotPoint: number; yRotPoint: number; zRotPoint: number;\n"
           "            xOffset: number; yOffset: number; zOffset: number; toolOffset: number };\n"
           "  /** joints (5) → world [x,y,z,a,b,c] */\n"
           "  forward: KinsFixtureCase[];\n"
           "  /** world [x,y,z,a,b,c] → joints (5) */\n"
           "  inverse: KinsFixtureCase[];\n"
           "}\n"
           "export const KINS_FIXTURES: KinsFixtureSet[] = ")
    ts += json.dumps(sets, indent=1) + ";\n"
    ts += ("\nexport interface TrsrnFixtureSet {\n"
           "  kins: string; label: string;\n"
           "  /** switchkins type the set was generated under (0|1|2) */\n"
           "  mode: number;\n"
           "  params: { yPivot: number; zPivot: number; xOffset: number; yOffset: number;\n"
           "            yRotAxis: number; zRotAxis: number; nutAngle: number; toolOffset: number;\n"
           "            preRot: number; primaryAngle: number; secondaryAngle: number };\n"
           "  /** joints (6) → world [x,y,z,a,b,c] */\n"
           "  forward: KinsFixtureCase[];\n"
           "  /** world [x,y,z,a,b,c] → joints (6) */\n"
           "  inverse: KinsFixtureCase[];\n"
           "}\n"
           "export const TRSRN_KINS_FIXTURES: TrsrnFixtureSet[] = ")
    ts += json.dumps(trsrn_sets, indent=1) + ";\n"
    TS_OUT.write_text(ts)

    JSON_OUT.write_text(json.dumps(
        {"generator": "scripts/gen_kins_fixtures.py", "seed": SEED,
         "oracle": "LinuxCNC v2.9.4 trtfuncs.c + master@493926b56c xyzacb_trsrn.comp (scripts/kins_oracle)",
         "sets": sets, "trsrn_sets": trsrn_sets},
        indent=1) + "\n")

    n = sum(len(s["forward"]) + len(s["inverse"]) for s in sets + trsrn_sets)
    print(f"wrote {len(sets)}+{len(trsrn_sets)} sets / {n} cases -> {TS_OUT.name}, {JSON_OUT.name}")


if __name__ == "__main__":
    main()
