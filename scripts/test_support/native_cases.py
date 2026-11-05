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


ANCHOR_AGE = 0.1             # s: the anchor frame at most this long after the jog_stop reply


def _finite(*values) -> bool:
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in values)


def eval_jog(case: str, axis: int, sign: int, p0: float, anchor: float, samples: list[tuple],
             anchor_age: float = 0.0) -> dict:
    """A continuous jog, then jog_stop. `p0` before the jog, `anchor` the
    position in the first status frame after the jog_stop REPLY (the
    measuring anchor, R284) and `anchor_age` how long after the reply that
    frame came; `samples` (seconds after the reply, position, |current_vel|).
    An unknown or non-finite value is never a standstill (R286 FI-I23)."""
    bound = brake_bound(axis)
    measured = {"axis": "XYZ"[axis], "sign": sign, "bound_mm": round(bound, 3), "anchor_age_s": anchor_age}
    if not _finite(p0, anchor, anchor_age):
        return _row(case, "incomplete", "the start or the anchor position is unknown", **measured)
    if anchor_age > ANCHOR_AGE:
        return _row(case, "incomplete", f"the anchor frame came {anchor_age:.3f} s after the jog_stop reply "
                    f"(bound {ANCHOR_AGE} s)", **measured)
    measured["travel"] = round(sign * (anchor - p0), 4)
    samples = [(t, p, v) for t, p, v in samples if _finite(t, p, v)]
    if not samples:
        return _row(case, "incomplete", "no sample with known values after jog_stop", **measured)
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
