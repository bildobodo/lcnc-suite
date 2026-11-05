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
    Within the bound: PASS; a proven wrong direction: FAIL; anything else
    incomplete. `brake_lower_mm` is reported, never decided on. Unknown or
    non-finite values are never a standstill."""
    bound = brake_bound(axis)
    measured = {"axis": "XYZ"[axis], "sign": sign, "bound_mm": round(bound, 3)}
    if before is None:
        return _row(case, "incomplete", "no status frame before the jog_stop reply", **measured)
    t_b, p_b = before
    if not _finite(p0, t_b, p_b):
        return _row(case, "incomplete", "the start or the position before the reply is unknown", **measured)
    measured.update(travel=round(sign * (p_b - p0), 4), before_s=round(t_b, 4))
    samples = [(t, p, v) for t, p, v in samples if _finite(t, p, v)]
    if not samples:
        return _row(case, "incomplete", "no sample with known values after jog_stop", **measured)
    travel = sign * (p_b - p0)
    if travel < -0.01:
        return _row(case, "FAIL", f"moved {p_b - p0:+.3f} mm — against its sign", **measured)
    if travel < JOG_MIN_TRAVEL:
        return _row(case, "incomplete", f"moved {p_b - p0:+.3f} mm by the frame before the reply — it may be stale, "
                    f"≥ {JOG_MIN_TRAVEL} not shown", **measured)
    # a frame RECEIVED within the time was captured within it; a later receipt
    # proves nothing about when the machine stood (R288): no FAIL from it
    stop = next(((t, p) for t, p, v in samples if abs(v) <= STANDSTILL), None)
    if stop is None or stop[0] > STOP_WITHIN:
        return _row(case, "incomplete", f"no standstill received within {STOP_WITHIN} s of the jog_stop reply",
                    **measured)
    upper = abs(stop[1] - p_b)
    measured.update(stop_s=round(stop[0], 4), brake_upper_mm=round(upper, 4),
                    brake_lower_mm=round(abs(stop[1] - samples[0][1]), 4))
    if upper <= bound:
        return _row(case, "PASS", "moved in its sign, stopped within its bounds", **measured)
    return _row(case, "incomplete", f"the braking travel from the reply is at most {upper:.3f} mm by the frame "
                f"before it; status frames give no lower bound (their capture time is not known) — not "
                f"resolved against {bound:.3f}", **measured)
