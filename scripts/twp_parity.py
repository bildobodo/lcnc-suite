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
    trt_kins_forward, trt_kins_inverse, read_var_wcs_rows,
)

#: Kins families this harness can derive/forward through a Python twin.
_TRT_FAMILIES = {"xyzac-trt", "xyzbc-trt"}

WORKER = os.path.join(_HERE, "..", "lcnc-gateway", "gcode_parse_worker.py")


# ─────────────────────────── stage 1: preview ───────────────────────────

def run_preview(ini_path, ngc, g5x_index=1, units="mm", rotary_pose=None):
    """Spawn the real parse worker exactly as the gateway does.

    INI_FILE_NAME must be in the environment or the interpreter initialises
    with NO remap table and every TWP code comes back "Unknown g code used"
    with an empty payload — a failure mode that looks like a broken program.
    """
    # LinuxCNC runs its display (and therefore the gateway that spawns this
    # worker) with cwd = the CONFIG DIRECTORY — verified on the live sim, and
    # the INIs already depend on it (`USER_M_PATH = ./`). Offline we must
    # reproduce that or every relative path in the INI resolves against
    # whatever directory the gate happened to start in. When it does not
    # resolve, `[PYTHON]TOPLEVEL` fails to load, the interpreter comes up with
    # NO remap table, and `g68.2` returns "Bad character 'g' used" — an empty
    # payload that the gate then reports as ELEVEN DRIFTED FIELDS instead of
    # "your program did not parse". Paths are absolutised first, because they
    # were given relative to the caller's cwd, not the config dir.
    ini_path = os.path.abspath(ini_path)
    ngc = os.path.abspath(ngc)
    env = dict(os.environ)
    env["INI_FILE_NAME"] = ini_path
    env.setdefault("PYTHONPATH", "/usr/lib/python")
    ctx = {"file": ngc, "ini_path": ini_path, "units": units,
           "var_patches": {}, "g5x_index": g5x_index}
    if rotary_pose:
        ctx["rotary_pose"] = rotary_pose
    p = subprocess.run([sys.executable, WORKER],
                       input=msgspec.msgpack.encode(ctx),
                       capture_output=True, env=env,
                       cwd=os.path.dirname(ini_path))
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


def _stream_abc(payload, stream):
    """(N,3) per-point A/B/C for a stream, or None (pre-schema-2 payload)."""
    raw = payload.get(stream + "_abc")
    if not raw:
        return None
    return _arr(payload, stream + "_abc").reshape(-1, 3)


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
    # Unknown-start flags (schema 6, W3 P1): 1 ⇒ the point is a suppressed
    # first-move ENDPOINT whose path is unclaimed — the overlay must not
    # judge samples against it. Absent = none.
    us = payload.get(stream + "_ustart")
    us = list(us) if us else [0] * len(pts)
    return pts, list(lines), kt, list(seqs), us


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


def derive_tip(pts, kts, seqs, payload, kins_cfg, wcs_terms, tool_z=0.0,
               abc=None):
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
    for i, ((x, y, z), t, sq) in enumerate(zip(pts, kts, seqs)):
        # Per-epoch basis (review P2): each point adds back ITS epoch's g5x
        # (wire wcs_frames row) — the parse-time snapshot the worker peeled
        # against, which on TWP is the plane origin the program writes into
        # G59. Legacy payloads (no rows) keep the caller's single basis.
        ep = governing_epoch(payload, sq)
        # World rotaries (P8.1): the wire abc (shipped since schema 2 for
        # every kins-marked program) plus its epoch's rotary offsets. The
        # wave-1 harness hardcoded zeros here — invisible under the old
        # XYZ-only compare, wrong for the 6-joint one: on trsrn the rotary
        # joints ARE the world abc, so the orient sweep and the held tilt
        # only reach the derived joints through this channel.
        a6 = list(abc[i]) if abc is not None and i < len(abc) else [0.0, 0.0, 0.0]
        if ep is not None:
            eox, eoy, eoz = ep[4], ep[5], ep[6]
            mx, my, mz = float(x) + eox, float(y) + eoy, float(z) + eoz + tool_z
            ma, mb, mc = a6[0] + ep[7], a6[1] + ep[8], a6[2] + ep[9]
        else:
            mx, my, mz = float(x) + ox, float(y) + oy, float(z) + oz
            ma, mb, mc = a6
        fr = governing_frame(payload, sq) if t == 2 else None
        if t == 2 and fr is None:
            frameless += 1
        p = frame_params(base, fr)
        joints = trsrn_kins_inverse([mx, my, mz, ma, mb, mc], p, int(t))
        tip = trsrn_kins_forward(joints, p, 1)
        out.append((joints, tip[:3]))
    if frameless:
        # Same inconsistency the client warns about (warnPlaneWithoutFrame):
        # a plane-mode segment with no governing WEBUI_TWPFRAME marker derives
        # against the base pins, which is a guess. Said loudly, never silently.
        print(f"  !! {frameless} plane-mode point(s) have NO governing "
              "kins_frames row — derived against base pins", file=sys.stderr)
    return out


def derive_tip_trt(pts, abc, kts, seqs, payload, kins_cfg, wcs_terms, tool_z=0.0):
    """trt-family derivation twin of derive_tip (P8.1 dispatch).

    Same chain, trt twins: program point (+ its epoch basis, + its wire abc
    for the rotaries — under trt the joints ARE the rotary words) →
    machine → joints under the segment's kins side → tip via the WORLD
    forward. World side = type 1 with `sparm=identityfirst`, else type 0
    (worldModeForType's mapping). Every segment resolves per point — a
    payload without kinstype derives as identity, honest to the wire.
    """
    bc = kins_cfg.get("type") == "xyzbc-trt"
    world_type = 1 if kins_cfg.get("identity_first") else 0
    params = dict(kins_cfg.get("params") or {})
    if tool_z:
        params = dict(params, tool_offset=tool_z)
    ox, oy, oz = wcs_terms
    oz += tool_z
    out = []
    for i, ((x, y, z), t, sq) in enumerate(zip(pts, kts, seqs)):
        ep = governing_epoch(payload, sq)
        a6 = list(abc[i]) if abc is not None and i < len(abc) else [0.0, 0.0, 0.0]
        if ep is not None:
            mx, my, mz = float(x) + ep[4], float(y) + ep[5], float(z) + ep[6] + tool_z
            ma, mb, mc = a6[0] + ep[7], a6[1] + ep[8], a6[2] + ep[9]
        else:
            mx, my, mz = float(x) + ox, float(y) + oy, float(z) + oz
            ma, mb, mc = a6
        world = [mx, my, mz, ma, mb, mc]
        if int(t) == world_type:
            j5 = trt_kins_inverse(world, params, bc=bc)
            joints = ([j5[0], j5[1], j5[2], 0.0, j5[3], j5[4]] if bc
                      else [j5[0], j5[1], j5[2], j5[3], 0.0, j5[4]])
        else:
            joints = world   # identity side: joints are the machine coords
        j5 = ([joints[0], joints[1], joints[2], joints[4], joints[5]] if bc
              else [joints[0], joints[1], joints[2], joints[3], joints[5]])
        tip = trt_kins_forward(j5, params, bc=bc)
        out.append((joints, list(tip[:3])))
    return out


def truth_tip(joints, kins_cfg, tool_z=0.0):
    """Live joints → tool tip in the work frame, via the family's twin.

    Refuses (returns None once signalled by the caller) rather than
    guessing when no twin exists for the declared family.
    """
    fam = kins_cfg.get("type")
    params = dict(kins_cfg.get("params") or {})
    if fam == "xyzacb-trsrn":
        return list(trsrn_kins_forward(joints, params, 1)[:3])
    if fam in _TRT_FAMILIES:
        bc = fam == "xyzbc-trt"
        if tool_z:
            params = dict(params, tool_offset=tool_z)
        j5 = ([joints[0], joints[1], joints[2], joints[4], joints[5]] if bc
              else [joints[0], joints[1], joints[2], joints[3], joints[5]])
        return list(trt_kins_forward(j5, params, bc=bc)[:3])
    return None


def swept_axes(joint_rows, eps=1e-3):
    """Which joints actually MOVE across a set of joint rows (P8.1
    completeness): the truth-vs-derived swept SETS must agree, or a whole
    DOF is missing from the offline story — exactly the flat-TWP class
    (truth swings B/C while the derived preview holds them at 0)."""
    rows = np.asarray([list(r) + [0.0] * (6 - len(r)) for r in joint_rows],
                      float)
    if not len(rows):
        return set()
    ptp = rows.max(axis=0) - rows.min(axis=0)
    return {i for i in range(rows.shape[1]) if ptp[i] > eps}


def _seg_dist(p, P):
    """Min distance from point p to polyline P ((M,3), M>=1)."""
    if len(P) == 1:
        return float(np.linalg.norm(p - P[0]))
    A = P[:-1]
    D = P[1:] - A
    L2 = (D * D).sum(axis=1)
    L2[L2 == 0] = 1e-30
    u = np.clip(((p - A) * D).sum(axis=1) / L2, 0.0, 1.0)
    d = p - (A + u[:, None] * D)
    return float(np.sqrt((d * d).sum(axis=1).min()))


def path_overlay(truth_samples, der_tips, der_lines, der_ustart=None):
    """Per-LINE overlay: does the machine, while executing line L, stay on
    the derived geometry the preview claims for line L? (P8.1)

    THE operator-visible metric — endpoint parity can pass while the path
    between endpoints bends wrong. Correspondence is by motion_line, the
    same key as the joints gate: each truth sample compares against ITS
    line's derived span (that line's vertices plus the segment leading
    into its first vertex — motion TO an endpoint happens DURING the
    line). Samples on lines the preview claims no geometry for are
    TRANSIT (the entry/approach class the canon's first-move suppression
    deliberately omits; the client prepends the real entry from the LIVE
    pose at sim entry) — counted, never scored. A mid-line departure, the
    real defect class, lands on a claimed line and counts fully.

    Division of labor with the joints gate: samples executing INSIDE a
    remap or sub (call_level > 0 — the g53.x approach/orient, the G30
    park) are run-time motion whose PATH the preview never claims; their
    endpoints are still validated by the per-line joints compare. Scoring
    them here read the whole orient approach as 100+ mm of "error" on the
    g53.x call's line while the square overlaid exactly.

    truth_samples: [(tip3, motion_line, call_level)] — a legacy capture
    without call_level passes None (treated as main-level, judged).
    der_tips: ordered derived tip polyline; der_lines: per-vertex line
    numbers. der_ustart (W3, schema 6): per-vertex unknown-start flags —
    a suppressed first-move ENDPOINT claims no path, so such vertices
    never build spans (judging approach samples against them scored the
    deliberately-unclaimed park→first-point excursion as ~40–96 mm of
    "error"). A line that runs MORE THAN ONCE in truth (a main-file line
    colliding with a sub-file line — visible once schema 6 ships the
    main-file endpoint too) is claim-consistent only for its LAST run;
    earlier runs are transit. Pure."""
    P = np.asarray(der_tips, float)
    if len(P) == 0 or not truth_samples:
        return None
    spans = {}
    for i, ln in enumerate(der_lines):
        if der_ustart is not None and der_ustart[i]:
            continue   # unknown-path endpoint — claims no geometry
        ln = int(ln)
        if ln not in spans:
            spans[ln] = [max(0, i - 1), i]   # include the leading segment
        else:
            spans[ln][1] = i
    # Start index of each line's LAST truth run (contiguous same-line spans
    # of the ordered capture); overwritten per run so the final value wins.
    last_run_start = {}
    run_start = 0
    for i, (_tip, ln, _lvl) in enumerate(truth_samples):
        if i == 0 or truth_samples[i - 1][1] != ln:
            run_start = i
        last_run_start[int(ln)] = run_start
    dists = []
    transit = 0
    for i, (tip, ln, lvl) in enumerate(truth_samples):
        span = spans.get(int(ln))
        if span is None or (lvl is not None and lvl > 0) \
                or i < last_run_start[int(ln)]:
            transit += 1
            continue
        dists.append(_seg_dist(np.asarray(tip, float), P[span[0]:span[1] + 1]))
    if not dists:
        return {"max": float("nan"), "p95": float("nan"), "mean": float("nan"),
                "judged": 0, "transit": transit}
    d = np.asarray(dists)
    return {"max": float(d.max()), "p95": float(np.percentile(d, 95)),
            "mean": float(d.mean()), "judged": int(len(d)),
            "transit": transit}


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

    # Context header (W6): everything the sim-trajectory dump needs to
    # replay this run through the ACTUAL client code — captured at the same
    # instant as the truth, in the exact wire shapes the client consumes
    # (viewer_init axes/kins, PartFrameWcs, status wcs_table rows).
    ini = linuxcnc.ini(ini_path)
    var_file = ini.find("RS274NGC", "PARAMETER_FILE") or "linuxcnc.var"
    if not os.path.isabs(var_file):
        var_file = os.path.join(os.path.dirname(os.path.abspath(ini_path)), var_file)
    _rows = read_var_wcs_rows(var_file)
    _names = ["G54", "G55", "G56", "G57", "G58", "G59",
              "G59.1", "G59.2", "G59.3"]
    header = {
        "header": True,
        "axes": [l for i, l in enumerate("XYZABCUVW")
                 if s.axis_mask & (1 << i)],
        "kins": parse_kins_config(ini.find("KINS", "KINEMATICS"),
                                  ini.findall("HAL", "HALCMD") or []),
        "start_joints": [s.joint_actual_position[i] for i in range(s.joints)],
        "wcs": {"g5x": [round(v, 6) for v in s.g5x_offset[:9]],
                "g92": [round(v, 6) for v in s.g92_offset[:9]],
                "rotationDeg": s.rotation_xy,
                "tool": [round(v, 6) for v in s.tool_offset[:3]]},
        "wcs_table": [
            dict(name=_names[i],
                 **{k: _rows.get(i + 1, ([0.0] * 9, 0.0))[0][j]
                    for j, k in enumerate("xyzabcuvw")},
                 r=_rows.get(i + 1, ([0.0] * 9, 0.0))[1])
            for i in range(9)
        ],
    }

    # A previous run stuck mid-program (e.g. an unacked M6) would make this
    # capture sample garbage — abort and require idle before starting.
    if s.interp_state != linuxcnc.INTERP_IDLE:
        c.abort()
        for _ in range(20):
            time.sleep(0.5)
            s.poll()
            if s.interp_state == linuxcnc.INTERP_IDLE:
                break
        else:
            raise SystemExit("interpreter stuck non-idle — cannot capture")

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
    else:
        # Timeout: the capture is garbage (a hung M6 wait produced 8899
        # rows of a parked machine that PASSED one comparison direction).
        c.abort()
        raise SystemExit(
            f"capture timed out after {timeout}s (interp state {rows[-1]['interp']}, "
            f"motion_line {rows[-1]['motion_line']}) — aborted; nothing written")

    with open(out_path, "w") as f:
        f.write(json.dumps(header) + "\n")
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


def parse_g683(path):
    """The G68.3 definition as the PROGRAM TEXT states it, or None.

    Returns (origin_vector_xyz, b_deg, c_deg, a_deg, g54_xyz): the X/Y/Z
    words on the g68.3 line (a vector from the active work offset, machine
    frame at definition), the head pose (last `b`/`c` words before it — G68.3
    measures the LIVE spindle), the table pose (last `a` word before it) and
    the G54 the program wrote (`g10 l2 p0 ...`, so the parse is independent
    of whatever var-file row a previous session left).
    """
    import re
    b = c = a = 0.0
    g54 = [0.0, 0.0, 0.0]

    def word(src, letter):
        m = re.search(rf"(?<![a-z#<]){letter}\s*(-?[\d.]+)", src, re.I)
        return float(m.group(1)) if m else None

    with open(path) as f:
        for ln in f:
            src = ln.split(";")[0].split("(")[0]
            if re.search(r"\bg10\s*l2\s*p0\b", src, re.I):
                g54 = [word(src, k) or 0.0 for k in "xyz"]
                continue
            if re.search(r"\bg68\.3\b", src, re.I):
                v = [word(src, k) or 0.0 for k in "xyz"]
                return v, b, c, a, g54
            for k in "bca":
                w = word(src, k)
                if w is not None:
                    if k == "b": b = w
                    elif k == "c": c = w
                    else: a = w
    return None


def trsrn_tool_dir(b_deg, c_deg, nut_deg):
    """Tool axis in MACHINE coords from the head pose: +Z rotated about the
    nutating B axis [0, sin(nut), cos(nut)] by B, then about machine Z by C.
    Derived from the head GEOMETRY, not from the kins twin — the independent
    half of the G68.3 invariant (live-validated by twp_reorient_check to
    ~1e-5 deg against the comp)."""
    nut = math.radians(nut_deg)
    k = np.array([0.0, math.sin(nut), math.cos(nut)])
    v = np.array([0.0, 0.0, 1.0])
    bb = math.radians(b_deg)
    r = (v * math.cos(bb) + np.cross(k, v) * math.sin(bb)
         + k * float(np.dot(k, v)) * (1 - math.cos(bb)))
    return _axis_rot(3, c_deg) @ r


def g683_expectation(path, nut_deg, square_z=100.0):
    """(want_normal, want_centroid) in the TABLE frame for a G68.3 program.

    Table-frame plane origin = G54_table + Rx(A)·v (the origin words are a
    VECTOR from the work offset, so only the rotation part of the table map
    applies — the pivot line never enters; the 2026-08-29 review found the
    remap pushing this vector through the POINT path, an origin error of
    (I-Rx(A))·pivot ≈ 776 mm at A=20 that no frame-independent invariant
    could see). Normal = Rx(A)·tool_dir(B, C). The square (square.ngc) is
    traced centred on the plane origin at plane-Z = square_z, so its
    centroid must sit at origin + square_z·normal. Rx written out here via
    twp_parity's own _axis_rot — never imported from the module under test.
    G54 is read as a table-frame point (the program's own G10 is unstamped,
    so the remap applies the documented A=0 rule to it)."""
    g = parse_g683(path)
    if g is None:
        return None, None
    v, b, c, a, g54 = g
    rx = _axis_rot(1, a)
    n_t = rx @ trsrn_tool_dir(b, c, nut_deg)
    origin_t = np.asarray(g54, float) + rx @ np.asarray(v, float)
    return n_t, origin_t + square_z * n_t


def plane_origin_expectation(ngc, a_orient_deg, params):
    """Expected MACHINE-frame plane origin at orient time, from the text.

    Table-frame origin = G54_table + v for G68.2 (words are workpiece
    intent) or G54_table + Rx(A_def)·v for G68.3 (origin words are a
    machine-frame VECTOR at the definition pose, converted rotation-only —
    the 2026-08-29 review find: pushed through the POINT path this picked
    up (I-Rx(A))·pivot ≈ 776 mm). Mapped to machine coords about the table
    axis LINE at the ORIENT pose. G54 is read from the program's own g10 l2
    line as a table-frame point (unstamped -> the documented A=0 rule).
    Returns (origin_machine, normal_table) or (None, None)."""
    piv = np.array([0.0, float(params["y_rot_axis"]), float(params["z_rot_axis"])])
    q, ijk = parse_g682(ngc)
    if q:
        n_t = g682_normal(q, ijk)
        g = parse_g683(ngc)     # reuses the G54 / v parse; g68.3 absent -> None
        import re
        W, v = [0.0] * 3, [0.0] * 3
        with open(ngc) as f:
            for ln in f:
                src = ln.split(";")[0].split("(")[0]
                if re.search(r"\bg10\s*l2\s*p0\b", src, re.I):
                    W = [float((re.search(rf"(?<![a-z#<]){k}\s*(-?[\d.]+)", src, re.I) or [None, 0]).group(1) or 0.0) if re.search(rf"(?<![a-z#<]){k}\s*(-?[\d.]+)", src, re.I) else 0.0 for k in "xyz"]
                if re.search(r"\bg68\.2\b", src, re.I):
                    v = [float(re.search(rf"(?<![a-z#<]){k}\s*(-?[\d.]+)", src, re.I).group(1)) if re.search(rf"(?<![a-z#<]){k}\s*(-?[\d.]+)", src, re.I) else 0.0 for k in "xyz"]
                    break
        origin_t = np.asarray(W, float) + np.asarray(v, float)
    else:
        g = parse_g683(ngc)
        if g is None:
            return None, None
        v, b, c, a_def, W = g
        n_t = _axis_rot(1, a_def) @ trsrn_tool_dir(b, c, float(params["nut_angle"]))
        origin_t = np.asarray(W, float) + _axis_rot(1, a_def) @ np.asarray(v, float)
    origin_m = piv + _axis_rot(1, -float(a_orient_deg)) @ (origin_t - piv)
    return origin_m, n_t


def truth_plane_invariants(kins, ngc, truth_path, side=100.0, frame=None):
    """Text-derived plane invariants on a REAL run.

    (ok, report) — or (None, reason) when the program defines no plane, so
    the caller gates nothing rather than passing a vacuous check. This is
    what lets the sim-parity GATE see a remap defect: truth and sim both
    run the same remap and agree with each other perfectly while both cut
    in the wrong place.

    Two checks, each with an INDEPENDENT half:
      normal    — the traced square's fitted normal (per-line endpoints
                  through the mode-1 twin, table frame) vs the normal the
                  text asks for (G68.2 Euler words / G68.3 head pose).
      origin    — the G59 row the remap WROTE (the TOOL samples' own g5x),
                  rotated back to the machine frame through the mode-2
                  frame R (Jacobian of the mode-2 twin at the payload's
                  frame triple — exact, the map is affine), vs the origin
                  the text asks for (plane_origin_expectation). A pure
                  translation of the plane is invisible to every
                  frame-independent invariant; THIS sees it. Needs
                  `frame` (the payload's kins_frames row); without it the
                  origin is reported UNCHECKED, never assumed.
    A centroid-through-the-head-model check was tried first and carried a
    constant ~14 mm head-geometry term in every program including the
    known-good ones; the G59 row is the clean oracle.
    """
    params = kins.get("params") or {}
    q, ijk = parse_g682(ngc)
    wn = g682_normal(q, ijk) if q else None
    if wn is None:
        wn, _wc = g683_expectation(ngc, float(params.get("nut_angle", 0.0)))
    if wn is None:
        return None, "no g68.2/g68.3 in the program — no plane to gate"
    if truth_tip([0.0] * 6, kins) is None:
        return None, f"no Python twin for kins {kins.get('type')!r} — UNCHECKED"
    with open(truth_path) as f:
        first = f.readline()
    hdr = json.loads(first) if first.strip() else {}
    rows = [r for r in (json.loads(l) for l in open(truth_path) if l.strip())
            if not r.get("header")]
    moving = [r for r in rows if r["interp"] != linuxcnc.INTERP_IDLE]
    if not moving:
        return False, "truth capture contains no motion"
    endpoint, last_i = {}, {}
    for i, r in enumerate(moving):
        ln = r["motion_line"]
        nxt = moving[i + 1] if i + 1 < len(moving) else None
        if nxt is None or nxt["motion_line"] != ln:
            src = r if nxt is None else nxt
            # Per-row tool offset (schema 8): the capture records the applied
            # offset on every sample, so a program whose G43 lands after
            # motion starts is tipped with the RIGHT offset per row — row 0's
            # value used to be applied to the whole capture.
            tlo = float((src.get("tool_offset") or [0, 0, 0])[2])
            endpoint[ln] = truth_tip(src["joints"], kins, tool_z=tlo)
            last_i[ln] = i
    order = sorted(endpoint, key=lambda ln: last_i[ln])
    inv = check_square([endpoint[ln] for ln in order], side, tol=0.2,
                       want_normal=wn)
    parts = [f"normal_err {inv.get('normal_err_deg')} deg"]
    ok = bool(inv.get("normal_match")) and bool(inv.get("planar"))
    # origin: the G59 row vs the text. Read from the TOOL-kins samples'
    # own per-sample `g5x` (the offset in force while cutting), NOT the
    # header's wcs_table — that is a capture-START snapshot and on run 1
    # of a program still holds the previous program's G59.
    tool_rows = [r for r in moving if r.get("g5x_index") == 6
                 and isinstance(r.get("g5x"), list) and len(r["g5x"]) >= 3]
    g59 = ({"x": tool_rows[-1]["g5x"][0], "y": tool_rows[-1]["g5x"][1],
            "z": tool_rows[-1]["g5x"][2]} if tool_rows else None)
    if frame is None or kins.get("type") != "xyzacb-trsrn" or not tool_rows \
            or not isinstance(g59, dict):
        parts.append("origin UNCHECKED (no frame/G59/TOOL samples)")
    else:
        pf = frame_params(params, frame)
        j0 = list(tool_rows[-1]["joints"])
        base = np.array(trsrn_kins_forward(j0, pf, 2)[:3])
        R = np.zeros((3, 3))
        for i in range(3):
            jj = list(j0)
            jj[i] += 1.0
            R[:, i] = np.array(trsrn_kins_forward(jj, pf, 2)[:3]) - base
        origin_m, _n = plane_origin_expectation(ngc, j0[3], params)
        if origin_m is None:
            parts.append("origin UNCHECKED (text has no origin)")
        else:
            got = R.T @ np.array([g59["x"], g59["y"], g59["z"]], float)
            err = float(np.linalg.norm(got - origin_m))
            parts.append(f"origin_err {err:.4f} mm")
            ok = ok and err <= 0.5
    parts.append(f"planarity {inv.get('planarity_dev')}")
    return ok, " | ".join(parts)


def check_square(tips, want_side=None, tol=0.05, want_normal=None,
                 want_centroid=None, centroid_tol=0.5):
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
    if want_centroid is not None:
        # The one invariant that is NOT frame-independent, on purpose: a pure
        # translation of the whole square passes every other check here.
        wc = np.asarray(want_centroid, float)
        res["centroid_expected"] = [round(float(v), 4) for v in wc]
        res["centroid_err_mm"] = round(float(np.linalg.norm(cen - wc)), 4)
        res["centroid_match"] = res["centroid_err_mm"] <= centroid_tol
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
        pts, lines, kts, seqs, ustarts = preview_points(pay, stream)
        if not len(pts):
            continue
        print(f"== {stream}: {len(pts)} pts, kinstype={sorted(set(kts))}"
              f"{', ustarts=' + str(sum(ustarts)) if any(ustarts) else ''} ==")
        bad = [l for l in lines if l > a.max_line]
        if bad:
            print(f"  !! LINE ATTRIBUTION: {len(bad)} point(s) carry line numbers")
            print(f"     above the program's {a.max_line} lines (e.g. {bad[:5]}) —")
            print("     they come from a called sub / python remap, not the main file.")
        g5x = (basis.get("g5x") or [0, 0, 0])[:3]
        der = derive_tip(pts, kts, seqs, pay, kins, tuple(g5x),
                         abc=_stream_abc(pay, stream))
        for i, (j, tip) in enumerate(der):
            print(f"   L{lines[i]:>5} t{kts[i]} prog={[round(float(v),2) for v in pts[i]]}"
                  f" -> j={[round(v,2) for v in j]} tip={[round(v,2) for v in tip]}")
        q, ijk = parse_g682(a.file)
        wn = g682_normal(q, ijk) if q else None
        wc = None
        if wn is not None:
            print(f"  G68.2 Q{int(q)} I/J/K={ijk} -> plane normal "
                  f"{[round(v,6) for v in wn]}")
        else:
            wn, wc = g683_expectation(
                a.file, float((kins.get("params") or {}).get("nut_angle", 0.0)))
        inv = check_square([t for _j, t in der], a.side, want_normal=wn,
                           want_centroid=wc)
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
    fam = kins.get("type")
    if fam != "xyzacb-trsrn" and fam not in _TRT_FAMILIES:
        raise SystemExit(
            f"no Python twin for declared kins family {fam!r} — this compare "
            f"cannot run (unchecked ≠ clean; add a twin, never a guess)")
    rows = [r for r in (json.loads(l) for l in open(a.truth) if l.strip())
            if not r.get("header")]   # W6: line 1 is the sim-dump context header
    moving = [r for r in rows if r["interp"] != linuxcnc.INTERP_IDLE]
    if not moving:
        raise SystemExit("truth capture contains no motion")

    for r in moving:
        # Per-row tool offset (schema 8) — see truth_plane_invariants.
        r["tip"] = truth_tip(r["joints"], kins,
                             tool_z=float((r.get("tool_offset") or [0, 0, 0])[2]))

    # Endpoint per executed line (W3 P6): the FIRST sample AFTER the line's
    # run — the transition sample where motion_line moves on. The previous
    # rule ("last sample still carrying the line") read up to one sample
    # period SHORT of the corner: decelerating at 700 mm/s², the tip sits
    # ½·a·t² ≈ 0.22–0.27 mm behind at the harness's real 25–28 ms stride —
    # the alarming 0.2651 mm joints number, while the path overlay bounded
    # true agreement at 0.0044 mm. The transition sample has just LEFT the
    # (near-stop, G64 P0.001) corner and is early in the fresh accel ramp,
    # so its corner error is far smaller in practice. The FINAL line keeps
    # its own last sample (no successor exists). |v|<eps gating was
    # rejected: blending means some lines legitimately never stop, and eps
    # would be a tunable. Subroutine loops: the LAST run of a line wins,
    # matching the previous semantics.
    endpoint = {}
    endjoints = {}
    for i, r in enumerate(moving):
        ln = r["motion_line"]
        nxt = moving[i + 1] if i + 1 < len(moving) else None
        if nxt is None or nxt["motion_line"] != ln:
            src = r if nxt is None else nxt
            endpoint[ln] = src["tip"]
            endjoints[ln] = src["joints"]

    q, ijk = parse_g682(a.file)
    wn = g682_normal(q, ijk) if q else None
    wc = None
    if wn is None:
        # G68.3 programs: normal AND centroid expected from the text.
        wn, wc = g683_expectation(
            a.file, float((kins.get("params") or {}).get("nut_angle", 0.0)))

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
                       want_normal=wn, want_centroid=wc)
    for k in ("sides", "side_match", "planarity_dev", "planar", "normal",
              "normal_err_deg", "normal_match", "centroid",
              "centroid_expected", "centroid_err_mm", "centroid_match"):
        if k in inv:
            print(f"  {k:16s}: {inv[k]}")

    basis = (pay.get("wcs_basis") or {}).get("g5x") or [0, 0, 0]
    # TLO as the machine had it during the capture — per row since schema 8
    # (the client applies the program's own G43 per segment); print the
    # distinct set so an in-program change is visible in the report.
    _tlos = sorted({float((r.get("tool_offset") or [0, 0, 0])[2]) for r in moving})
    print(f"  tool_offset_z  : {_tlos[0] if len(_tlos) == 1 else _tlos}")
    verdicts = []
    # A plane the text asked for and the machine did not cut in is a failed
    # compare, whatever the joints say: truth and sim share the remap, so
    # joint parity is blind to a wrong plane — these are the only checks
    # with an INDEPENDENT half.
    for k in ("normal_match", "centroid_match"):
        if k in inv:
            verdicts.append(bool(inv[k]))
    all_der_joints = []
    all_der_tips = []
    all_der_lines = []
    all_der_ustart = []
    for stream in ("feed", "rapid"):
        pts, lines, kts, seqs, ustarts = preview_points(pay, stream)
        if not len(pts):
            continue
        s_abc = _stream_abc(pay, stream)
        if fam == "xyzacb-trsrn":
            der = derive_tip(pts, kts, seqs, pay, kins, tuple(basis[:3]),
                             tool_z=tlo_z, abc=s_abc)
        else:
            der = derive_tip_trt(pts, s_abc, kts, seqs, pay, kins,
                                 tuple(basis[:3]), tool_z=tlo_z)
        all_der_joints.extend(j for j, _t in der)
        # Overlay tips forward through the SAME convention as the truth tips
        # (truth_tip: base params, one fixed TCP frame) — derive_tip's own
        # tips carry per-segment frame/TLO params, and comparing tips built
        # under different params reads as a huge bogus offset.
        all_der_tips.extend(truth_tip(j, kins, tool_z=tlo_z) for j, _t in der)
        all_der_lines.extend(int(ln) for ln in lines)
        all_der_ustart.extend(int(u) for u in ustarts)
        # Compare ALL SIX JOINTS, not tool tips (and not XYZ only — P8.1:
        # the XYZ-only compare hid a missing rotary channel entirely, the
        # flat-TWP class). Rotary residuals wrap to ±180° so a same-pose
        # different-branch pair never reads as a full turn of error.
        #
        # Correspondence (W3): per line, the LAST derived vertex in
        # execution order pairs with the truth endpoint — which is also
        # last-run by construction (the endpoint dict overwrites per run).
        # Bare-line pairing broke the moment schema 6 legitimately shipped
        # TWO motions labeled "line 4" (the main-file ustart endpoint and
        # square.ngc's own L4): pairing the early ustart vertex against
        # the late square corner read as ~180 mm of phantom error.
        by_line = {}
        for (j, _t), ln, sq in zip(der, lines, seqs):
            ln = int(ln)
            if ln in endjoints and (ln not in by_line or sq > by_line[ln][0]):
                by_line[ln] = (sq, j)
        pairs = [(np.array((list(j) + [0.0] * 6)[:6], float),
                  np.array((list(endjoints[ln]) + [0.0] * 6)[:6], float))
                 for ln, (_sq, j) in sorted(by_line.items())]
        print(f"== {stream}: derived vs truth JOINTS x6 ({len(pairs)} matched by line) ==")
        if not pairs:
            print("  no line correspondence — cannot compare")
            verdicts.append(False)
            continue
        diffs = np.array([tr - dv for dv, tr in pairs])
        diffs[:, 3:6] = (diffs[:, 3:6] + 180.0) % 360.0 - 180.0
        per_axis = np.abs(diffs).max(axis=0)
        dmax = float(np.max(np.linalg.norm(diffs, axis=1)))
        print(f"  max |derived - truth| : {dmax:.4f} (mm, 1°≙1)   "
              f"per-axis {[round(float(v), 4) for v in per_axis]}")
        ok = dmax <= a.tol
        verdicts.append(ok)
        print(f"  VERDICT: {'MATCH' if ok else 'MISMATCH'} (tol {a.tol})")

    # Swept-axes completeness (P8.1): every DOF the machine moved must move
    # in the derived preview too — endpoint parity can pass while a whole
    # rotary channel is missing between the endpoints.
    truth_swept = swept_axes([r["joints"] for r in moving])
    der_swept = swept_axes(all_der_joints)
    missing = truth_swept - der_swept
    extra = der_swept - truth_swept
    names = "XYZABC"
    print(f"== swept axes: truth {sorted(names[i] for i in truth_swept if i < 6)} "
          f"vs derived {sorted(names[i] for i in der_swept if i < 6)} ==")
    swept_ok = not missing
    if missing:
        print(f"  !! DOF MISSING from the derived preview: "
              f"{sorted(names[i] for i in missing if i < 6)} — the offline "
              f"story is missing a whole axis the machine actually moved")
    if extra:
        # Extra derived motion is suspicious but not the missing-channel
        # class (e.g. an approach the capture's settle window clipped).
        print(f"  note: derived sweeps {sorted(names[i] for i in extra if i < 6)} "
              f"that truth does not — check the capture window")
    print(f"  VERDICT: {'MATCH' if swept_ok else 'MISMATCH'}")
    verdicts.append(swept_ok)

    # Path overlay (P8.1): per-LINE distance from truth samples to the
    # derived geometry claimed for their line — the operator-visible frame
    # ("does the drawn path overlay the live run"), which endpoint parity
    # alone can't see. Transit samples (lines the preview claims nothing
    # for — approach/orient motion the first-move suppression omits by
    # design) are counted, never scored.
    ov = path_overlay(
        [(r["tip"], r["motion_line"], r.get("call_level"))
         for r in moving if r.get("tip")],
        all_der_tips, all_der_lines, all_der_ustart)
    if ov:
        print(f"== path overlay: truth vs derived, per-line (main-level motion) ==")
        print(f"  max {ov['max']:.4f}  p95 {ov['p95']:.4f}  mean {ov['mean']:.4f} (mm)"
              f"  [judged {ov['judged']}, transit (remap/sub or unclaimed): {ov['transit']}]")
        # The overlay tolerance is looser than the endpoint one: truth
        # samples include accel blends.
        ov_ok = ov["judged"] > 0 and ov["p95"] <= max(a.tol * 4, 1.0)
        print(f"  VERDICT: {'MATCH' if ov_ok else 'MISMATCH'} "
              f"(p95 tol {max(a.tol * 4, 1.0)})")
        verdicts.append(ov_ok)

    print(f"\nOVERALL: {'MATCH' if all(verdicts) else 'MISMATCH'} "
          f"({sum(verdicts)}/{len(verdicts)} gates)")
    return 0 if all(verdicts) else 1


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
