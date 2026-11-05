"""The native stage's case evaluators (plan Codex R283–R285, FI282-05): each
takes what was MEASURED and returns PASS / FAIL / incomplete with the value
and its bound — bounds fixed before the run from the profile's declared
values, never widened after a failure. Pure: the orchestrator measures, these
decide (and the offline tests plant wrong values into them).

Profile 3axis_xyz (lcnc_suite_sim_3axis_xyz.ini): X 0…685, Y 0…705,
Z −190…0.1 mm; MAX_VELOCITY 100 / 100 / 80 mm/s, MAX_ACCELERATION 750 mm/s²;
Z keeps OFFSET_AV_RATIO 0.2 for external offsets → 600 mm/s² for a jog;
servo period T = 1 ms."""
from __future__ import annotations

import math

T = 0.001                     # the servo period, s
JOG_SPEED = 50.0              # mm/s, every jog case
JOG_MIN_TRAVEL = 5.0          # mm before jog_stop (0.3 s at 50 mm/s is 15)
STOP_WITHIN = 0.5             # s from the jog_stop reply to standstill
STANDSTILL = 0.001            # mm/s
ACCEL = (750.0, 750.0, 750.0 * (1 - 0.2))   # X, Y, Z (OFFSET_AV_RATIO)


def brake_bound(axis: int, v: float = JOG_SPEED) -> float:
    """The F5 model (R127): v²/(2a) + 2·v·4T — 2.1 mm on X/Y, 2.5 on Z."""
    return v * v / (2 * ACCEL[axis]) + 2 * v * 4 * T


def _row(case, status, detail, **measured):
    return {"case": case, "status": status, "detail": detail, **measured}


def eval_home(case: str, expected: list[bool], observed: list[bool] | None, completed: bool = True) -> dict:
    """Home All / Home joint j: exactly the expected joints homed, AFTER the
    homing's confirmed completion (R286 FI-I22: the right bits with no
    completion within the time are no PASS)."""
    if observed is None:
        return _row(case, "incomplete", "homed_joints not read", expected=expected)
    if not completed:
        return _row(case, "FAIL", "no confirmed completion (homed and in position) within the time",
                    expected=expected, observed=observed)
    wrong = [f"joint {j} {'homed' if o else 'not homed'}" for j, (e, o) in enumerate(zip(expected, observed)) if e != o]
    if len(observed) != len(expected):
        wrong.append(f"{len(observed)} joints reported, {len(expected)} expected")
    return _row(case, "FAIL" if wrong else "PASS", "; ".join(wrong) or "as expected", expected=expected, observed=observed)


def _finite(*values) -> bool:
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in values)


def _at(t) -> str:
    return "an unknown time" if t is None else f"{t:+.3f} s"


def _val(x, unit: str) -> str:
    return f"{unit} unknown" if x is None else f"{x:.3f} {unit}"


def eval_jog(case: str, axis: int, sign: int, p0: float, before, samples: list[tuple]) -> dict:
    """A continuous jog, then jog_stop; the path is measured FROM THE REPLY
    to jog_stop (R284), whose position no status frame shows exactly. It is
    bracketed (R287 FI-I23 — the unseen travel never vanishes): `before` =
    (seconds before the reply ≤ 0, position) of the last status frame before
    it, `samples` (seconds after the reply, position, |current_vel|). The
    motion runs in its sign, so the position at the reply lies between the
    frame before and the first after: the braking travel lies between
    |stop − first after| and |stop − before| — but a frame RECEIVED after the
    reply may have been CAPTURED before it (R288): only the upper bound holds.
    The upper bound runs to the FURTHEST point reached (R290).
    Within the bound: PASS; a proven contradiction — a wrong direction, a
    position more than 0.01 mm behind the furthest point reached, motion
    after the standstill (R289/R290; every KNOWN value counts, whatever else
    its frame leaves unknown) — FAIL; anything else incomplete, an unknown
    position before the standstill too. `first_after_mm` (the stop's
    distance from the first known position after the reply) is reported, no
    bound and never decided on. The standstill is a frame with every value
    known; unknown or non-finite values are never one."""
    bound = brake_bound(axis)
    measured = {"axis": "XYZ"[axis], "sign": sign, "bound_mm": round(bound, 3)}
    if before is None:
        return _row(case, "incomplete", "no status frame before the jog_stop reply", **measured)
    t_b, p_b = before
    if not _finite(p0, t_b, p_b):
        return _row(case, "incomplete", "the start or the position before the reply is unknown", **measured)
    measured.update(travel=round(sign * (p_b - p0), 4), before_s=round(t_b, 4))
    # every KNOWN value is evidence (R290 FI-I23 A): an unknown partner in
    # the same frame makes it no anchor, never drops what it does show
    samples = [tuple(x if _finite(x) else None for x in s) for s in samples]
    travel = sign * (p_b - p0)
    if travel < -0.01:
        return _row(case, "FAIL", f"moved {p_b - p0:+.3f} mm — against its sign", **measured)
    # the whole collected course decides, in ONE pass so the EARLIEST
    # contradiction is named (R289/R290 FI-I23 B): frames arrive in capture
    # order, so in its sign none lies more than the FIXED tolerance behind
    # the furthest point reached so far — small steps back never add up
    # unseen; after the stop (the first frame with every value known, at
    # standstill) no known velocity moves and no known position leaves it
    peak, stop_at = p_b, None
    for i, (t, p, v) in enumerate(samples):
        if stop_at is not None and ((v is not None and abs(v) > STANDSTILL) or
                                    (p is not None and abs(p - samples[stop_at][1]) > 0.01)):
            return _row(case, "FAIL", f"moved again after its standstill at {samples[stop_at][0]:+.3f} s: "
                        f"{_val(p, 'mm')}, {_val(v, 'mm/s')} at {_at(t)}", **measured)
        if p is not None:
            if sign * (p - peak) < -0.01:
                return _row(case, "FAIL", f"{abs(p - peak):.3f} mm back from its furthest point {peak:.3f} at "
                            f"{_at(t)} — against its sign", **measured)
            if sign * (p - peak) > 0:
                peak = p
        if stop_at is None and None not in (t, p, v) and abs(v) <= STANDSTILL:
            stop_at = i
    if travel < JOG_MIN_TRAVEL:
        return _row(case, "incomplete", f"moved {p_b - p0:+.3f} mm by the frame before the reply — it may be stale, "
                    f"≥ {JOG_MIN_TRAVEL} not shown", **measured)
    # a frame RECEIVED within the time was captured within it; a later receipt
    # proves nothing about when the machine stood (R288): no FAIL from it
    if stop_at is None or samples[stop_at][0] > STOP_WITHIN:
        return _row(case, "incomplete", f"no standstill (every value known) received within {STOP_WITHIN} s of "
                    f"the jog_stop reply", **measured)
    if any(p is None for _, p, _ in samples[:stop_at]):
        return _row(case, "incomplete", "a position before the standstill is unknown — the course to it is not "
                    "shown", **measured)
    t_s, p_s, _ = samples[stop_at]
    upper = sign * (peak - p_b)         # the furthest point reached, never the net distance (R290)
    first = next(p for _, p, _ in samples if p is not None)
    measured.update(stop_s=round(t_s, 4), brake_upper_mm=round(upper, 4), first_after_mm=round(abs(p_s - first), 4))
    if upper <= bound:
        return _row(case, "PASS", "moved in its sign, stopped within its bounds", **measured)
    return _row(case, "incomplete", f"the braking travel from the reply is at most {upper:.3f} mm by the frame "
                f"before it; status frames give no lower bound (their capture time is not known) — not "
                f"resolved against {bound:.3f}", **measured)
