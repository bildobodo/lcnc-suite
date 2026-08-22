#!/usr/bin/env python3
"""End-to-end parity harness for a TWP (tilted work plane) config.

Answers three questions that no existing gate covers, because each of the
three stages was previously only checked against ITSELF:

  PREVIEW  what the gateway ships to the browser for a program
  DERIVED  where the offline stack (part-frame preview, scrub sim, collision
           sweep) thinks the tool goes, from that payload
  TRUTH    where the tool ACTUALLY goes, sampled from the running machine

and then, independently of all three, whether the motion is geometrically a
tilted work plane at all:

  INVARIANTS  the programmed square must come out a real square, planar, of
              the programmed side length, lying in the plane G68.2 defined.

The invariants matter most: DERIVED and TRUTH can agree with each other and
still both be wrong. Only the invariants test the machine against the
*intent*, using nothing but sampled joints and the G68.2 arguments.

Frames — all comparisons are done as TOOL TIP IN THE WORKPIECE FRAME, via
forward kins in TCP mode (1) on the actual joint values. That is the only
frame in which "did the tool trace a square on the part" is a meaningful
question on a machine whose work rides a rotary (A here).

Usage
-----
  # no motion — preview + derivation + their agreement
  scripts/twp_parity.py check --ini <INI> --file <NGC>

  # drives the machine: runs the program and samples it (SIM CONFIGS ONLY)
  scripts/twp_parity.py truth --ini <INI> --file <NGC> --out truth.jsonl
  scripts/twp_parity.py compare --ini <INI> --file <NGC> --truth truth.jsonl

`truth` commands the interpreter directly (linuxcnc.command), bypassing the
gateway's armed gate. That is deliberate — this is a diagnostic against a
simulator — and is why it refuses to run unless the INI looks like a sim.
"""

import argparse
import json
import math
import os
import subprocess
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "lcnc-gateway"))

import msgspec  # noqa: E402
import numpy as np  # noqa: E402
import linuxcnc  # noqa: E402

from gateway_util import (  # noqa: E402
    parse_kins_config, trsrn_kins_forward, trsrn_kins_inverse,
)

WORKER = os.path.join(_HERE, "..", "lcnc-gateway", "gcode_parse_worker.py")


# ─────────────────────────── stage 1: preview ───────────────────────────

def run_preview(ini_path, ngc, g5x_index=1, units="mm"):
    """Spawn the real parse worker exactly as the gateway does.

    INI_FILE_NAME must be in the environment or the interpreter initialises
    with NO remap table and every TWP code comes back "Unknown g code used"
    with an empty payload — a failure mode that looks like a broken program.
    """
    env = dict(os.environ)
    env["INI_FILE_NAME"] = ini_path
    env.setdefault("PYTHONPATH", "/usr/lib/python")
    ctx = {"file": ngc, "ini_path": ini_path, "units": units,
           "var_patches": {}, "g5x_index": g5x_index}
    p = subprocess.run([sys.executable, WORKER],
                       input=msgspec.msgpack.encode(ctx),
                       capture_output=True, env=env)
    if p.returncode != 0:
        raise SystemExit(f"parse worker rc={p.returncode}\n{p.stderr.decode()[:2000]}")
    out = msgspec.msgpack.decode(p.stdout)
    out["_stderr"] = p.stderr.decode()
    return out


def _arr(payload, key, dtype=np.float32):
    v = payload.get(key)
    if v is None:
        return np.array([], dtype=dtype)
    if isinstance(v, (bytes, bytearray)):
        return np.frombuffer(v, dtype=dtype)
    return np.asarray(v, dtype=dtype)


def preview_points(payload, stream):
    """(N,3) points, per-point line numbers, raw switchkins types, seqs.

    seq is the global execution-order counter — the key that resolves which
    WEBUI_TWPFRAME marker governs each point (kins_frames rows are keyed by
    it). Without per-point seq every multi-frame program collapses onto ONE
    frame, which is exactly the frames[-1] bug this column replaced.
    """
    pts = _arr(payload, stream).reshape(-1, 3)
    lines = _arr(payload, stream + "_lines", np.int32)
    kt = payload.get(stream + "_kinstype")
    kt = list(kt) if kt else [0] * len(pts)
    seqs = _arr(payload, stream + "_seq", np.uint32)
    return pts, list(lines), kt, list(seqs)


# ────────────────────── stage 2: offline derivation ─────────────────────

def frame_params(base_params, frame):
    """base kins pins + the governing TWP frame triple.

    Unit asymmetry is load-bearing: pre_rot is RADIANS, primary/secondary are
    DEGREES. Mixing them silently tilts the plane.
    """
    p = dict(base_params)
    if frame is not None:
        _seq, pre_rot_rad, primary_deg, secondary_deg = frame
        p["pre_rot"] = pre_rot_rad
        p["primary_angle"] = primary_deg
        p["secondary_angle"] = secondary_deg
    return p


def governing_epoch(payload, seq):
    """The WCS epoch row governing this segment (wire wcs_frames, review P2).

    Same strictly-before convention as the frames. Rows are [seq, g5x_index,
    rotation_deg, rewritten, g5x x6, g92 x6] in MACHINE units — the basis the
    worker peeled this epoch's endpoints against, which is exactly what the
    derivation must add back. None = legacy single-basis payload.
    """
    rows = payload.get("wcs_frames") or []
    best = None
    for r in rows:
        if r[0] < seq:
            best = r
    return best


def governing_frame(payload, seq):
    """The last WEBUI_TWPFRAME marker STRICTLY before this segment's seq.

    Strict is load-bearing and mirrors the client exactly (previewWorker
    frameIdxFor: `es < seq[v]`): an event at seq N governs segments with
    seq > N. `<=` would hand the boundary point the NEW frame while the
    client renders it under the old one — a silent one-point divergence on
    every re-tilt.
    """
    frames = payload.get("kins_frames") or []
    best = None
    for f in frames:
        if f[0] < seq:
            best = f
    return best


def derive_tip(pts, kts, seqs, payload, kins_cfg, wcs_terms, tool_z=0.0):
    """Preview point -> machine coords -> joints -> tool tip in work frame.

    Mirrors the client chain (partFrame.programToMachine + kinsForSegment
    inverse), then re-forwards in TCP mode so the result is comparable with
    truth sampled from actual joints.

    Each plane-mode point resolves ITS OWN governing frame by seq — a program
    that re-tilts (the incremental_repetition demos) has several kins_frames
    rows, and deriving every point against the last one silently bends all
    but the final tilt.
    """
    base = dict(kins_cfg.get("params") or {})
    base["tool_offset_z"] = tool_z
    # The client's programToMachine adds the TLO along with the WCS origin
    # (partFrame wcsTerms.tx/ty/tz). Omitting it here would not reproduce the
    # client and would show up as a bogus constant offset against truth.
    ox, oy, oz = wcs_terms
    oz += tool_z
    out = []
    frameless = 0
    for (x, y, z), t, sq in zip(pts, kts, seqs):
        # Per-epoch basis (review P2): each point adds back ITS epoch's g5x
        # (wire wcs_frames row) — the parse-time snapshot the worker peeled
        # against, which on TWP is the plane origin the program writes into
        # G59. Legacy payloads (no rows) keep the caller's single basis.
        ep = governing_epoch(payload, sq)
        if ep is not None:
            eox, eoy, eoz = ep[4], ep[5], ep[6]
            mx, my, mz = float(x) + eox, float(y) + eoy, float(z) + eoz + tool_z
        else:
            mx, my, mz = float(x) + ox, float(y) + oy, float(z) + oz
        fr = governing_frame(payload, sq) if t == 2 else None
        if t == 2 and fr is None:
            frameless += 1
        p = frame_params(base, fr)
        joints = trsrn_kins_inverse([mx, my, mz, 0.0, 0.0, 0.0], p, int(t))
        tip = trsrn_kins_forward(joints, p, 1)
        out.append((joints, tip[:3]))
    if frameless:
        # Same inconsistency the client warns about (warnPlaneWithoutFrame):
        # a plane-mode segment with no governing WEBUI_TWPFRAME marker derives
        # against the base pins, which is a guess. Said loudly, never silently.
        print(f"  !! {frameless} plane-mode point(s) have NO governing "
              "kins_frames row — derived against base pins", file=sys.stderr)
    return out


# ─────────────────────────── stage 3: truth ─────────────────────────────

def _is_sim(ini_path):
    ini = linuxcnc.ini(ini_path)
    hal = " ".join(ini.findall("HAL", "HALFILE") or [])
    return "sim" in hal.lower() or "sim" in os.path.basename(ini_path).lower()


def sample_run(ini_path, ngc, out_path, hz=50, timeout=180):
    """Run the program on the live machine, sampling joints throughout."""
    if not _is_sim(ini_path):
        raise SystemExit("refusing: INI does not look like a simulator config")

    s = linuxcnc.stat()
    c = linuxcnc.command()
    s.poll()
    if s.estop:
        raise SystemExit("machine is in E-STOP — clear it first")
    if not s.enabled:
        raise SystemExit("machine is OFF — turn it on first")
    if not all(s.homed[: s.joints]):
        raise SystemExit("machine is not homed — home it first")

    c.mode(linuxcnc.MODE_AUTO)
    c.wait_complete()
    c.program_open(ngc)
    c.auto(linuxcnc.AUTO_RUN, 0)

    dt = 1.0 / hz
    t0 = time.time()
    rows = []
    seen_running = False
    # The interpreter reports IDLE transiently while a remap runs and while the
    # queue drains, so "went idle once" is NOT end-of-program. Require a settle
    # window before believing it — without this the capture truncates mid-run
    # and every downstream comparison silently compares against a partial path.
    SETTLE_S = 3.0
    while time.time() - t0 < timeout:
        s.poll()
        running = s.interp_state != linuxcnc.INTERP_IDLE
        seen_running = seen_running or running
        if time.time() - t0 < SETTLE_S:
            running = True
        rows.append({
            "t": round(time.time() - t0, 4),
            "joints": [round(s.joint_actual_position[i], 6) for i in range(s.joints)],
            "actual": [round(v, 6) for v in s.actual_position[:6]],
            "motion_line": s.motion_line,
            # call_level > 0 means motion_line is a line in a SUBROUTINE or
            # remap file, not in the loaded program — the two numberings
            # collide, so the UI must not follow it blindly.
            "call_level": getattr(s, "call_level", None),
            "exec_file": os.path.basename(getattr(s, "file", "") or ""),
            "g5x_index": s.g5x_index,
            "g5x": [round(v, 6) for v in s.g5x_offset[:6]],
            "tool_offset": [round(v, 6) for v in s.tool_offset[:3]],
            "interp": s.interp_state,
        })
        if seen_running and not running:
            break
        time.sleep(dt)

    with open(out_path, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(f"sampled {len(rows)} rows -> {out_path}")
    return rows


# ───────────────────────── stage 4: invariants ──────────────────────────

def fit_plane(P):
    """Best-fit plane through points -> (centroid, unit normal, max deviation)."""
    P = np.asarray(P, float)
    cen = P.mean(axis=0)
    _u, _s, vt = np.linalg.svd(P - cen)
    n = vt[2] / np.linalg.norm(vt[2])
    dev = float(np.max(np.abs((P - cen) @ n)))
    return cen, n, dev


def _axis_rot(axis, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    if axis == 1:
        return np.array([[1.0, 0, 0], [0, c, -s], [0, s, c]])
    if axis == 2:
        return np.array([[c, 0, s], [0, 1.0, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


def g682_normal(q_code, ijk):
    """Plane normal from a G68.2 line's Q rotation-order code and I/J/K angles.

    Q is a 3-digit axis sequence (1=X, 2=Y, 3=Z), e.g. Q121 = X then Y then X,
    with I/J/K the angles applied in that order. The plane's normal is the
    rotated +Z axis. This is derived from the PROGRAM TEXT, never from our own
    transforms — it is the independent half of the invariant.
    """
    seq = [int(d) for d in str(int(q_code))]
    R = np.eye(3)
    for axis, ang in zip(seq, list(ijk) + [0.0, 0.0, 0.0]):
        R = R @ _axis_rot(axis, ang)
    return R @ np.array([0.0, 0.0, 1.0])


def parse_g682(path):
    """Pull (q, [i, j, k]) off the first G68.2 line in a program."""
    import re
    with open(path) as f:
        for ln in f:
            s = ln.split(";")[0].split("(")[0]
            if not re.search(r"\bg68\.2\b", s, re.I):
                continue
            def g(letter):
                m = re.search(rf"\b{letter}\s*(-?[\d.]+)", s, re.I)
                return float(m.group(1)) if m else 0.0
            return g("q"), [g("i"), g("j"), g("k")]
    return None, None


def check_square(tips, want_side=None, tol=0.05, want_normal=None):
    """Geometry of a traced square, in whatever frame the points are given.

    Isolates the square itself — the longest run of consecutive segments whose
    length matches want_side — so the approach and retract moves (different Z,
    different length) cannot pollute the planarity fit. Frame-independent:
    lengths, planarity and the normal's DIRECTION are all invariant under the
    rigid transform that separates our frames, so a shape that is right here
    is right regardless of where it is placed.
    """
    P = np.asarray(tips, float)
    if len(P) < 4:
        return {"ok": False, "why": f"only {len(P)} points"}
    sides = [float(np.linalg.norm(P[i + 1] - P[i])) for i in range(len(P) - 1)]
    res = {"n_points": len(P), "sides": [round(v, 4) for v in sides]}

    sq = list(range(len(P)))
    if want_side:
        eps = max(tol, want_side * 1e-3)
        best = run = []
        for i, s in enumerate(sides):
            if abs(s - want_side) <= eps:
                run = (run or [i]) + [i + 1]
                if len(run) > len(best):
                    best = run
            else:
                run = []
        if len(best) >= 3:
            sq = best
        res["square_points"] = sq
        res["side_match"] = len(best) >= 4

    cen, n, dev = fit_plane(P[sq])
    res["planarity_dev"] = round(dev, 6)
    res["planar"] = dev <= tol
    res["normal"] = [round(v, 6) for v in n]
    res["centroid"] = [round(v, 4) for v in cen]
    if want_normal is not None:
        wn = np.asarray(want_normal, float)
        wn = wn / np.linalg.norm(wn)
        # sign-agnostic: a plane's normal has no preferred direction
        cosang = abs(float(np.dot(n, wn)))
        res["normal_expected"] = [round(v, 6) for v in wn]
        res["normal_err_deg"] = round(math.degrees(math.acos(min(1.0, cosang))), 4)
        res["normal_match"] = res["normal_err_deg"] <= 0.5
    return res


# ──────────────────────────────── cli ───────────────────────────────────

def cmd_check(a):
    pay = run_preview(a.ini, a.file, a.g5x)
    kins = parse_kins_config(
        linuxcnc.ini(a.ini).find("KINS", "KINEMATICS"),
        linuxcnc.ini(a.ini).findall("HAL", "HALCMD") or [])
    print("== preview ==")
    if pay.get("parse_error"):
        print(f"  PARSE ERROR line {pay.get('error_line')}: {pay['parse_error']}")
    basis = pay.get("wcs_basis") or {}
    print(f"  wcs_basis_index : {pay.get('wcs_basis_index')}")
    print(f"  wcs_used        : {pay.get('wcs_used')}")
    print(f"  basis g5x       : {[round(v,3) for v in (basis.get('g5x') or [])[:6]]}")
    print(f"  kins_frames     : {pay.get('kins_frames')}")
    print(f"  wcs_frames      : {len(pay.get('wcs_frames') or [])} epoch(s)"
          + "".join(f"\n    seq={int(r[0])} idx={int(r[1])} rw={int(r[3])} "
                    f"g5x={[round(v, 3) for v in r[4:7]]}"
                    for r in (pay.get("wcs_frames") or [])))
    if pay.get("wcs_used") and pay.get("wcs_basis_index") not in (pay.get("wcs_used") or []):
        if pay.get("wcs_frames"):
            print("  motion WCS differs from the parse basis — HANDLED: per-epoch")
            print("  wcs_frames rows peel and re-add each section in its own frame.")
        else:
            print("  !! FRAME MISMATCH: the program's motion WCS is not the parse basis WCS.")
            print("     Shipped coords are peeled against the basis and the client re-adds")
            print("     the LIVE WCS, so the path displaces by the difference")
            print("     (LEGACY payload — no wcs_frames on the wire).")

    for stream in ("feed", "rapid"):
        pts, lines, kts, seqs = preview_points(pay, stream)
        if not len(pts):
            continue
        print(f"== {stream}: {len(pts)} pts, kinstype={sorted(set(kts))} ==")
        bad = [l for l in lines if l > a.max_line]
        if bad:
            print(f"  !! LINE ATTRIBUTION: {len(bad)} point(s) carry line numbers")
            print(f"     above the program's {a.max_line} lines (e.g. {bad[:5]}) —")
            print("     they come from a called sub / python remap, not the main file.")
        g5x = (basis.get("g5x") or [0, 0, 0])[:3]
        der = derive_tip(pts, kts, seqs, pay, kins, tuple(g5x))
        for i, (j, tip) in enumerate(der):
            print(f"   L{lines[i]:>5} t{kts[i]} prog={[round(float(v),2) for v in pts[i]]}"
                  f" -> j={[round(v,2) for v in j]} tip={[round(v,2) for v in tip]}")
        q, ijk = parse_g682(a.file)
        wn = g682_normal(q, ijk) if q else None
        if wn is not None:
            print(f"  G68.2 Q{int(q)} I/J/K={ijk} -> plane normal "
                  f"{[round(v,6) for v in wn]}")
        inv = check_square([t for _j, t in der], a.side, want_normal=wn)
        for k, v in inv.items():
            print(f"  {k:16s}: {v}")
    return 0


def cmd_truth(a):
    sample_run(a.ini, a.file, a.out, a.hz)
    return 0


def cmd_compare(a):
    pay = run_preview(a.ini, a.file, a.g5x)
    kins = parse_kins_config(
        linuxcnc.ini(a.ini).find("KINS", "KINEMATICS"),
        linuxcnc.ini(a.ini).findall("HAL", "HALCMD") or [])
    params = dict(kins.get("params") or {})
    rows = [json.loads(l) for l in open(a.truth) if l.strip()]
    moving = [r for r in rows if r["interp"] != linuxcnc.INTERP_IDLE]
    if not moving:
        raise SystemExit("truth capture contains no motion")

    for r in moving:
        r["tip"] = trsrn_kins_forward(r["joints"], params, 1)[:3]

    # Endpoint per executed line: the LAST sample carrying that motion_line is
    # where that move finished. This gives an exact derived<->truth
    # correspondence, instead of guessing corners out of a sampled path.
    endpoint = {}
    endjoints = {}
    for r in moving:
        endpoint[r["motion_line"]] = r["tip"]
        endjoints[r["motion_line"]] = r["joints"]

    q, ijk = parse_g682(a.file)
    wn = g682_normal(q, ijk) if q else None

    print("== truth ==")
    print(f"  samples={len(rows)} moving={len(moving)}")
    print(f"  g5x_index seen : {sorted({r['g5x_index'] for r in rows})}")
    print(f"  motion_line    : {sorted(endpoint)}")
    # Invariants go on the per-line ENDPOINTS, in execution order — the real
    # corners. Fitting a plane over every sampled point folds in the approach,
    # the orient move and the retract, which are not in the plane and make a
    # correct machine look non-planar.
    order = sorted(endpoint, key=lambda ln: [i for i, r in enumerate(moving)
                                             if r["motion_line"] == ln][-1])
    inv = check_square([endpoint[ln] for ln in order], a.side, tol=0.2,
                       want_normal=wn)
    for k in ("sides", "side_match", "planarity_dev", "planar", "normal",
              "normal_err_deg", "normal_match"):
        if k in inv:
            print(f"  {k:16s}: {inv[k]}")

    basis = (pay.get("wcs_basis") or {}).get("g5x") or [0, 0, 0]
    # TLO as the machine had it during the capture — the client applies it too.
    tlo_z = float((moving[0].get("tool_offset") or [0, 0, 0])[2])
    print(f"  tool_offset_z  : {tlo_z}")
    for stream in ("feed", "rapid"):
        pts, lines, kts, seqs = preview_points(pay, stream)
        if not len(pts):
            continue
        der = derive_tip(pts, kts, seqs, pay, kins, tuple(basis[:3]), tool_z=tlo_z)
        # Compare JOINTS, not tool tips: the tip needs a forward-kins pass whose
        # tool_offset_z convention must match on both sides, and getting that
        # subtly wrong shows up as a large bogus "frame offset". Joints are what
        # the machine actually did, with no further modelling on either side.
        pairs = [(np.array(j[:3], float), np.array(endjoints[int(ln)][:3], float))
                 for (j, _t), ln in zip(der, lines) if int(ln) in endjoints]
        print(f"== {stream}: derived vs truth JOINTS ({len(pairs)} matched by line) ==")
        if not pairs:
            print("  no line correspondence — cannot compare")
            continue
        diffs = np.array([tr - dv for dv, tr in pairs])
        dmax = float(np.max(np.linalg.norm(diffs, axis=1)))
        print(f"  max |derived - truth| : {dmax:.4f} mm   "
              f"mean {[round(float(v),4) for v in diffs.mean(axis=0)]}")
        print(f"  VERDICT: {'MATCH' if dmax <= a.tol else 'MISMATCH'} (tol {a.tol})")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--ini", required=True)
        p.add_argument("--file", required=True)
        p.add_argument("--g5x", type=int, default=1)
        p.add_argument("--side", type=float, default=100.0)
        p.add_argument("--max-line", type=int, default=200, dest="max_line")

    p = sub.add_parser("check", help="preview + derivation, no motion")
    common(p)
    p.set_defaults(fn=cmd_check)

    p = sub.add_parser("truth", help="RUN the program and sample it")
    common(p)
    p.add_argument("--out", default="twp_truth.jsonl")
    p.add_argument("--hz", type=int, default=50)
    p.set_defaults(fn=cmd_truth)

    p = sub.add_parser("compare", help="compare a truth capture to the preview")
    common(p)
    p.add_argument("--truth", required=True)
    p.add_argument("--tol", type=float, default=0.5)
    p.set_defaults(fn=cmd_compare)

    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
