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


def eval_home(case: str, expected: list[bool], observed: list[bool] | None) -> dict:
    """Home All / Home joint j: exactly the expected joints homed."""
    if observed is None:
        return _row(case, "incomplete", "homed_joints not read", expected=expected)
    wrong = [f"joint {j} {'homed' if o else 'not homed'}" for j, (e, o) in enumerate(zip(expected, observed)) if e != o]
    if len(observed) != len(expected):
        wrong.append(f"{len(observed)} joints reported, {len(expected)} expected")
    return _row(case, "FAIL" if wrong else "PASS", "; ".join(wrong) or "as expected", expected=expected, observed=observed)


def eval_jog(case: str, axis: int, sign: int, p0: float, anchor: float, samples: list[tuple]) -> dict:
    """A continuous jog, then jog_stop. `p0` before the jog, `anchor` the
    position at the jog_stop REPLY (the measuring anchor, R284), `samples`
    (seconds after the anchor, position, |current_vel|) after it."""
    bound = brake_bound(axis)
    measured = {"axis": "XYZ"[axis], "sign": sign, "travel": round(sign * (anchor - p0), 4), "bound_mm": round(bound, 3)}
    if not samples:
        return _row(case, "incomplete", "no sample after jog_stop", **measured)
    if sign * (anchor - p0) < JOG_MIN_TRAVEL:
        return _row(case, "FAIL", f"moved {anchor - p0:+.3f} mm — not ≥ {JOG_MIN_TRAVEL} in its sign", **measured)
    stop = next(((t, p) for t, p, v in samples if abs(v) <= STANDSTILL), None)
    if stop is None or stop[0] > STOP_WITHIN:
        return _row(case, "FAIL", f"no standstill within {STOP_WITHIN} s of the jog_stop reply", **measured)
    brake = abs(stop[1] - anchor)
    measured.update(stop_s=round(stop[0], 4), brake_mm=round(brake, 4))
    if brake > bound:
        return _row(case, "FAIL", f"braked {brake:.3f} mm past the anchor, bound {bound:.3f}", **measured)
    return _row(case, "PASS", "moved in its sign, stopped within its bounds", **measured)
