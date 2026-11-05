"""The step 2c evaluators on servo sections (plan Codex R299–R301): each
takes a section (`samples` (receipt time, n, values), `problems`) and
returns PASS / FAIL / incomplete. A contradiction seen in the read samples
is a FAIL even in a flawed section; without one, a flaw or a missing proof
is incomplete. Times only by receipt; positions in mm, velocities in mm/s."""
from __future__ import annotations

import math
import statistics

from test_support.native_cases import JOG_MIN_TRAVEL, STOP_WITHIN, _row, brake_bound

STILL_POS = 0.001             # mm: a standstill holds its position within 1 µm
VEL_ZERO = 1e-6               # mm/s: vel-cmd = 0
STILL_BLOCK = 10              # samples of a confirmed standstill
OTHER_AXES = 0.01             # mm the other axes may move during a jog
PATH_TOL = 0.010              # mm: the retract's phases and its end
Z_TOP = -0.010                # mm: Z "up" in the machine frame
MOVE_EPS = 0.005              # mm: the retract's first motion


def _f(*xs) -> bool:
    return all(isinstance(x, (int, float)) and math.isfinite(x) for x in xs)


def eval_jog_servo(case: str, axis: int, sign: int, sec: dict, t_reply: float) -> dict:
    """F-JOG.S5 from servo samples (R299–R301): from the section's start the
    commanded joint moved ≥ 5 mm in its sign by the ANCHOR (the last sample
    RECEIVED before the jog_stop reply), the others within 0.01 mm; from the
    anchor to the furthest point reached at most v²/2a + 2·v·4T; no step
    back past 1 µm; the FIRST confirmed standstill after the observed jog
    (10 samples, vel-cmd 0, position within 1 µm — it may lie before the
    reply) is the fixed reference: its first sample RECEIVED ≤ reply + 0.5 s
    (an upper bound only), and nothing known moves after it to the end mark."""
    samples, problems = sec["samples"], list(sec["problems"])
    bound = brake_bound(axis)
    m = {"axis": "XYZ"[axis], "sign": sign, "bound_mm": round(bound, 3), "problems": problems,
         "samples": len(samples)}
    if not samples:
        return _row(case, "incomplete", "no samples in the section", **m)
    pos = lambda s, j: s[2][j]          # noqa: E731
    vel = lambda s, j: s[2][3 + j]      # noqa: E731
    p0 = [pos(samples[0], j) for j in range(3)]
    ai = max((i for i, s in enumerate(samples) if s[0] < t_reply), default=None)
    # the contradictions first, on every sample read
    for s in samples:
        for j in range(3):
            if j != axis and _f(pos(s, j), p0[j]) and abs(pos(s, j) - p0[j]) > OTHER_AXES:
                return _row(case, "FAIL", f"joint {j} moved {pos(s, j) - p0[j]:+.3f} mm during the jog of "
                            f"joint {axis}", **m)
    peak = p0[axis]
    for s in samples:
        q = pos(s, axis)
        if not _f(q):
            continue
        if sign * (q - peak) < -STILL_POS:
            return _row(case, "FAIL", f"{abs(q - peak):.4f} mm back from its furthest point (sample {s[1]})", **m)
        if sign * (q - peak) > 0:
            peak = q
    mi = next((i for i, s in enumerate(samples) if _f(pos(s, axis)) and abs(pos(s, axis) - p0[axis]) > STILL_POS),
              None)
    ref = None
    if mi is not None:
        for i in range(mi, len(samples) - STILL_BLOCK + 1):
            blk = samples[i:i + STILL_BLOCK]
            if all(_f(vel(s, axis), pos(s, axis)) and abs(vel(s, axis)) <= VEL_ZERO
                   and abs(pos(s, axis) - pos(blk[0], axis)) <= STILL_POS for s in blk):
                ref = i
                break
    if ref is not None:
        rp = pos(samples[ref], axis)
        for s in samples[ref:]:
            v, q = vel(s, axis), pos(s, axis)
            if (_f(v) and abs(v) > VEL_ZERO) or (_f(q) and abs(q - rp) > STILL_POS):
                return _row(case, "FAIL", f"moved again after its standstill (sample {s[1]}: "
                            f"{q} mm, {v} mm/s)", **m)
    if ai is None:
        return _row(case, "incomplete", "no sample received before the jog_stop reply", **m)
    travel = sign * (pos(samples[ai], axis) - p0[axis])
    m["travel_mm"] = round(travel, 4)
    if travel < -STILL_POS:
        return _row(case, "FAIL", f"moved {travel:+.3f} mm against its sign by the anchor", **m)
    upper = sign * (peak - pos(samples[ai], axis))
    m.update(anchor_n=samples[ai][1], brake_upper_mm=round(upper, 4))
    if ref is not None:
        m.update(standstill_n=samples[ref][1], standstill_received_s=round(samples[ref][0] - t_reply, 4),
                 samples_anchor_to_standstill=samples[ref][1] - samples[ai][1])    # descriptive, no time proof
    if travel < JOG_MIN_TRAVEL:
        return _row(case, "incomplete", f"moved {travel:.3f} mm by the anchor, {JOG_MIN_TRAVEL} not shown", **m)
    if ref is None:
        return _row(case, "incomplete", "no confirmed standstill after the jog", **m)
    if upper > bound:
        return _row(case, "incomplete", f"the travel from the reply is at most {upper:.3f} mm by the anchor — not "
                    f"resolved against {bound:.3f}", **m)
    if samples[ref][0] > t_reply + STOP_WITHIN:
        return _row(case, "incomplete", f"the standstill received {samples[ref][0] - t_reply:.3f} s after the reply — "
                    f"within {STOP_WITHIN} s not shown", **m)
    if problems:
        return _row(case, "incomplete", f"the section is flawed: {problems[0]}", **m)
    return _row(case, "PASS", "moved in its sign, stopped within its bounds", **m)


def eval_plateau(case: str, sec: dict, expected: float, period_s: float, tol: float = 0.05,
                 window=(150.0, 450.0), axis: int = 0) -> dict:
    """F-OVERRIDE.S2: inside ONE attempt's section, v = ΔX / T from ADJACENT
    samples (n, n + 1) both finite and both in the window; the median within
    expected ± tol. Fewer than 20 or a flawed section: incomplete."""
    samples, problems = sec["samples"], list(sec["problems"])
    vs = []
    for a, b in zip(samples, samples[1:]):
        xa, xb = a[2][axis], b[2][axis]
        if b[1] == a[1] + 1 and _f(xa, xb) and window[0] <= xa <= window[1] and window[0] <= xb <= window[1]:
            vs.append(abs(xb - xa) / period_s)
    m = {"expected": expected, "tol": tol, "pairs": len(vs), "problems": problems}
    if problems:
        return _row(case, "incomplete", f"the section is flawed: {problems[0]}", **m)
    if len(vs) < 20:
        return _row(case, "incomplete", f"{len(vs)} sample pairs in the window, 20 needed", **m)
    med = statistics.median(vs)
    m["median"] = round(med, 3)
    if abs(med - expected) <= tol * expected:
        return _row(case, "PASS", f"median {med:.2f} mm/s within {expected:g} ± {tol:.0%}", **m)
    return _row(case, "FAIL", f"median {med:.2f} mm/s — expected {expected:g} ± {tol:.0%}", **m)


def eval_retract_path(case: str, sec: dict, start, target) -> dict:
    """F-GOTO.S1c (R284): from the first sample 0.005 mm off the start, (1) Z
    rises to ≥ −0.010 with X/Y within 0.010 of their start; (2) X/Y travel to
    the target with Z ≥ −0.010; (3) a descent to the target's Z only after
    X/Y arrived; the end at rest on the target ± 0.010. A phase not shown is
    incomplete, a violation FAIL."""
    samples, problems = sec["samples"], list(sec["problems"])
    pos = lambda s: s[2][:3]            # noqa: E731
    m = {"start": list(start), "target": list(target), "problems": problems}
    known = [s for s in samples if _f(*pos(s))]
    bi = next((i for i, s in enumerate(known) if max(abs(a - b) for a, b in zip(pos(s), start)) > MOVE_EPS), None)
    if bi is None:
        return _row(case, "incomplete", "no motion of the routine in the section", **m)
    path = known[bi:]
    ji = next((i for i, s in enumerate(path) if pos(s)[2] >= Z_TOP), None)
    for s in path[:len(path) if ji is None else ji]:
        x, y, _ = pos(s)
        if max(abs(x - start[0]), abs(y - start[1])) > PATH_TOL:
            return _row(case, "FAIL", f"X/Y moved {max(abs(x - start[0]), abs(y - start[1])):.3f} mm before Z was "
                        f"up (sample {s[1]})", **m)
    ki = None
    if ji is not None:
        ki = next((i for i in range(ji, len(path)) if max(abs(pos(path[i])[0] - target[0]),
                                                        abs(pos(path[i])[1] - target[1])) <= PATH_TOL), None)
        for s in path[ji:len(path) if ki is None else ki + 1]:
            if pos(s)[2] < Z_TOP:
                return _row(case, "FAIL", f"Z at {pos(s)[2]:.3f} while X/Y moved (sample {s[1]})", **m)
    last = samples[-1]
    at_rest = all(_f(v) and abs(v) <= VEL_ZERO for v in last[2][3:6])
    if at_rest and _f(*pos(last)):
        off = max(abs(a - b) for a, b in zip(pos(last), target))
        m["end_off_mm"] = round(off, 4)
        if off > PATH_TOL:
            return _row(case, "FAIL", f"ended {off:.3f} mm off its target", **m)
    if problems:
        return _row(case, "incomplete", f"the section is flawed: {problems[0]}", **m)
    if ji is None or ki is None or not at_rest:
        return _row(case, "incomplete", "a phase or the rest at the end not shown", **m)
    descent = "no descent (the target's Z is up)" if target[2] >= Z_TOP else "the descent after X/Y arrived"
    return _row(case, "PASS", f"Z up first, then X/Y; {descent}; at rest on the target", **m)
