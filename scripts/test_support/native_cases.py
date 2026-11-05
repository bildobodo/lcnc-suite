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


# ── step 2a: probe, M600, the override lock (plan R283–R285 FI282-05) ────
PROBE_TOL = 0.003             # mm: (1.67 T)·v_slow + 1 µm — a model assumption for THIS case, never widened
M600_TOL = 0.002              # mm: (1.67 T)·v_slow(20 mm/min) + 1 µm
SAME = 1e-6                   # the applied G43 is the table value itself
RELEASE_WITHIN = 2.0          # s after the confirmed completion (R285)
NO_CONTACT = "without making contact"


def counter(case: str, inner: dict) -> dict:
    """A planted wrong value (a counter-probe): the check holds only when its
    evaluation REFUSES it — PASS iff the inner row is FAIL; an inner PASS is
    this row's FAIL, an unresolved one stays incomplete."""
    status = {"FAIL": "PASS", "PASS": "FAIL"}.get(inner["status"], "incomplete")
    detail = {"PASS": "the planted value is refused", "FAIL": "the planted wrong value PASSED — the check does not hold"
              }.get(status, "the planted value was not decided")
    return {"case": case, "status": status, "detail": f"{detail}: {inner['detail']}", "counter": True, "inner": inner}


def eval_probe_z(case: str, contact, g54_z, expected: float, tol: float = PROBE_TOL) -> dict:
    """Z probing writes G54 Z = the plate (expected, from the independent
    measure — the copy's HAL, never the table after the attempt) ± tol; the
    contact (#5070 = 1) is required."""
    measured = {"expected": expected, "tol_mm": tol, "contact": contact, "g54_z": g54_z}
    if contact is None or not _finite(contact):
        return _row(case, "incomplete", "#5070 not read", **measured)
    if not _finite(g54_z):
        return _row(case, "incomplete", "G54 Z not read", **measured)
    if contact != 1:
        return _row(case, "FAIL", f"no contact recorded (#5070 = {contact:g})", **measured)
    dev = g54_z - expected
    measured["deviation_mm"] = round(dev, 6)
    if abs(dev) <= tol:
        return _row(case, "PASS", f"G54 Z {g54_z:.4f} within {expected:g} ± {tol:g}", **measured)
    return _row(case, "FAIL", f"G54 Z {g54_z:.4f} — expected {expected:g} ± {tol:g}", **measured)


def eval_probe_miss(case: str, contact, g54_before, g54_after, errors: list[str]) -> dict:
    """No contact within the search depth: no contact recorded (#5070 = 0),
    G54 Z unchanged, LinuxCNC's own error in the error channel — whose
    absence is incomplete (a skipped status tick loses its errors)."""
    measured = {"contact": contact, "g54_before": g54_before, "g54_after": g54_after}
    if contact is None or not _finite(contact, g54_before, g54_after):
        return _row(case, "incomplete", "#5070 or G54 Z not read", **measured)
    if contact != 0:
        return _row(case, "FAIL", f"a contact recorded (#5070 = {contact:g}) beyond the search depth", **measured)
    if abs(g54_after - g54_before) > SAME:
        return _row(case, "FAIL", f"G54 Z changed {g54_before:.4f} → {g54_after:.4f} without a contact", **measured)
    said = [e for e in errors if NO_CONTACT in e]
    if not said:
        return _row(case, "incomplete", f"no error saying \"{NO_CONTACT}\" received", **measured)
    return _row(case, "PASS", "no contact, nothing set, the error said so", error=said[0], **measured)


def eval_m600(case: str, l0, length, g43, tol: float = M600_TOL) -> dict:
    """T<n> M600: the table length measured = L0 (recorded BEFORE) ± tol, and
    the applied G43 offset is that same length."""
    measured = {"l0": l0, "length": length, "g43": g43, "tol_mm": tol}
    if not _finite(l0, length, g43):
        return _row(case, "incomplete", "L0, the measured length or the applied offset not read", **measured)
    measured["deviation_mm"] = round(length - l0, 6)
    if abs(length - l0) > tol:
        return _row(case, "FAIL", f"length {length:.4f} — expected {l0:g} ± {tol:g}", **measured)
    if abs(g43 - length) > SAME:
        return _row(case, "FAIL", f"the applied G43 {g43:.4f} is not the measured {length:.4f}", **measured)
    return _row(case, "PASS", f"length {length:.4f} within {l0:g} ± {tol:g}, applied as measured", **measured)


def eval_override_lock(case: str, frames: list[tuple], t_trigger: float) -> dict:
    """F-OVERRIDE.S2b (R285): during M600's measuring phase the status says
    the feed override is LOCKED, after the routine's end it is FREE again.
    `frames` = (receipt time, merged status). Required: (1) a frame received
    after the trigger showing it free before the locked phase; (2) the
    observed edge to locked and locked in every frame of that phase; (3)
    within RELEASE_WITHIN s of the confirmed completion (interpreter idle, no
    tool change open) a frame RECEIVED at or after it showing it free — the
    completion frame itself may. No observed locked phase: incomplete."""
    fresh = [(t, st) for t, st in frames if t >= t_trigger]
    en = [(t, st.get("feed_override_enabled")) for t, st in fresh]
    locked = [i for i, (_, e) in enumerate(en) if e is False]
    if not locked:
        return _row(case, "incomplete", "no frame showed the override locked")
    first, last = locked[0], locked[-1]
    if not any(e is True for _, e in en[:first]):
        return _row(case, "incomplete", "no frame after the trigger showed it free before the lock",
                    locked_from_s=round(en[first][0] - t_trigger, 3))
    inside = [t for t, e in en[first:last + 1] if e is not False]
    if inside:
        return _row(case, "FAIL", f"not locked at {inside[0] - t_trigger:+.3f} s inside the measuring phase")
    done = next((t for t, st in fresh[first:] if st.get("interp_state") == 1 and st.get("tool_change_seq") is None
                 and st.get("tool_change_requested") is False), None)
    measured = {"locked_from_s": round(en[first][0] - t_trigger, 3), "locked_to_s": round(en[last][0] - t_trigger, 3)}
    if done is None:
        return _row(case, "incomplete", "no confirmed completion received", **measured)
    measured["done_s"] = round(done - t_trigger, 3)
    free = next((t for t, e in en if done <= t <= done + RELEASE_WITHIN and e is True), None)
    if free is None:
        return _row(case, "FAIL", f"not free within {RELEASE_WITHIN} s of the completion", **measured)
    return _row(case, "PASS", "locked through the measuring phase, free after the routine",
                free_s=round(free - t_trigger, 3), **measured)


def eval_m6_hold(case: str, holds: list[dict], tool_before, tool_after, offset_after, tool: int, length: float,
                 hold_s: float) -> dict:
    """F-TOOLCHANGE.S2: M6 waited for the explicit confirmation — ONE hold of
    `hold_s` with ≥ 90 % of its 20 Hz samples and no gap past 0.1 s (the
    helper refused every sample that broke it) — and went on with the new
    tool: in the spindle, its length applied."""
    measured = {"tool_before": tool_before, "tool_after": tool_after, "offset_after": offset_after}
    if len(holds) != 1:
        return _row(case, "FAIL", f"{len(holds)} held requests — M6 raised none to hold" if not holds
                    else f"{len(holds)} held requests, one expected", **measured)
    h = holds[0]
    measured.update(samples=h["samples"], max_gap_s=round(h["max_gap_s"], 3))
    if h["samples"] < 0.9 * hold_s * 20 or h["max_gap_s"] > 0.1:
        return _row(case, "FAIL", f"the hold is not shown: {h['samples']} samples, a gap up to "
                    f"{h['max_gap_s']:.3f} s", **measured)
    if not _finite(offset_after):
        return _row(case, "incomplete", "the applied offset after the change not read", **measured)
    if tool_after != tool:
        return _row(case, "FAIL", f"T{tool_after} in the spindle after the change, T{tool} expected", **measured)
    if abs(offset_after - length) > SAME:
        return _row(case, "FAIL", f"the applied offset {offset_after} is not T{tool}'s length {length}", **measured)
    return _row(case, "PASS", f"held {hold_s:g} s waiting, then T{tool} with its length", **measured)


def eval_unload(case: str, served: list[dict], tool_after, offset_after) -> dict:
    """T0 M600 (F-TOOLMEASURE.S6b): the spindle empty (T0) and no length
    applied afterwards; the change to T0 the only one confirmed."""
    measured = {"served": served, "tool_after": tool_after, "offset_after": offset_after}
    if not _finite(offset_after):
        return _row(case, "incomplete", "the applied offset after the unload not read", **measured)
    if any(c["tool"] != 0 for c in served):
        return _row(case, "FAIL", "a change to another tool than T0 confirmed", **measured)
    if tool_after != 0:
        return _row(case, "FAIL", f"T{tool_after} in the spindle after the unload", **measured)
    if abs(offset_after) > SAME:
        return _row(case, "FAIL", f"a length {offset_after} still applied after the unload", **measured)
    return _row(case, "PASS", "the spindle empty, no length applied", **measured)
