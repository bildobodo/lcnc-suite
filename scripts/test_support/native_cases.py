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
# the release window is SEEN only with frames through it: after the
# completion the gateway may poll at its idle rate (WEBUI_IDLE_POLL_HZ, 5 Hz
# → 0.2 s) — one late tick on top (R293 FI-I26 B)
WINDOW_GAP_S = 0.3
NO_CONTACT = "without making contact"
ERROR_KINDS = (1, 11)         # NML_ERROR, OPERATOR_ERROR — a DEBUG / text line (12, 13) is no failure

# Each evaluator judges every part as soon as ITS values are known: a known
# contradiction is FAIL whatever else is unread; only with no contradiction
# does a missing value make it incomplete (R292 FI-I28, as FI-I23 for the jog).


def _failures(errors) -> list[str]:
    return [text for kind, text in errors if kind in ERROR_KINDS]


RETURN_TOL = 0.001            # mm: the return's own target, at rest


def eval_m600_return(case: str, call, end, top_z: float, errors=(), setting=None, call_tool=None,
                     call_offset=None, tool=None, end_tool=None, table=None, applied=None) -> dict:
    """M600's return with #3106 = 1 (operator 2026-11-05): after the
    measurement the spindle is at the top of travel (`top_z`, the routine's
    drive-free G53 Z0) at the X/Y where M600 was called — Z never descends on
    its own. `call` / `end`: joint positions (x, y, z), the call's read before
    the send, the end's at the confirmed completion. The case proves the
    climb the old return could not make (Codex R307): `setting` (#3106) is 1,
    the call at the top with an applied length (`call_offset`, the empty
    spindle 0) shorter than the new tool's; the end has the target `tool`,
    its stored `table` length applied (`applied`), no NML error. A known
    contradiction is FAIL whatever else is unread; a missing proof is
    incomplete — "no error" alone is no PASS."""
    measured = {"call": None if call is None else list(call), "end": None if end is None else list(end),
                "top_z": top_z, "errors": list(errors), "setting_3106": setting, "call_tool": call_tool,
                "call_offset": call_offset, "tool": tool, "end_tool": end_tool, "table": table, "applied": applied}

    def known(p, i):
        return p is not None and len(p) > i and _finite(p[i])
    fail = _failures(errors)
    if fail:
        return _row(case, "FAIL", f"the routine reported: {fail[0]}", **measured)
    if known(end, 2) and abs(end[2] - top_z) > RETURN_TOL:
        return _row(case, "FAIL", f"Z ended at {end[2]:.3f}, the top is {top_z:g}", **measured)
    for i, axis in ((0, "X"), (1, "Y")):
        if known(end, i) and known(call, i) and abs(end[i] - call[i]) > RETURN_TOL:
            return _row(case, "FAIL", f"{axis} ended at {end[i]:.3f}, the call was at {call[i]:.3f}", **measured)
    if end_tool is not None and tool is not None and end_tool != tool:
        return _row(case, "FAIL", f"T{end_tool} in the spindle, T{tool} expected", **measured)
    if _finite(table, applied) and abs(table - applied) > SAME:
        return _row(case, "FAIL", f"{applied:.4f} applied, the stored length is {table:.4f}", **measured)
    if setting is None or not _finite(setting) or setting != 1:
        return _row(case, "incomplete", f"#3106 is {setting} — the return is not on", **measured)
    if not (all(known(end, i) and known(call, i) for i in range(3)) and _finite(call_offset, table, applied)
            and end_tool is not None and tool is not None):
        return _row(case, "incomplete", "a position, a tool or a length not read", **measured)
    if abs(call[2] - top_z) > RETURN_TOL:
        return _row(case, "incomplete", f"the call was at Z {call[2]:.3f}, not the top — no climb to prove", **measured)
    if not table > call_offset:
        return _row(case, "incomplete", f"T{tool} ({table:.3f} mm) is not longer than the applied {call_offset:.3f} mm"
                                        " — no climb to prove", **measured)
    return _row(case, "PASS", f"from the top, T{call_tool} {call_offset:.3f} mm → T{tool} {table:.4f} mm stored and"
                              " applied; back at the call's X/Y, Z stayed up", **measured)


def counter(case: str, inner: dict, base: dict) -> dict:
    """A planted wrong value re-judging a measurement: it holds only when
    the measurement passed against the TRUE value (`base`) and fails
    against the planted one (`inner`) — the plant is then the reason. A base
    that did not pass proves nothing (R292 FI-I27)."""
    if base["status"] != "PASS":
        return {"case": case, "status": "incomplete", "counter": True, "inner": inner,
                "detail": f"the measurement it re-judges did not pass: {base['detail']}"}
    status = {"FAIL": "PASS", "PASS": "FAIL"}.get(inner["status"], "incomplete")
    detail = {"PASS": "the planted value is refused", "FAIL": "the planted wrong value PASSED — the check does not hold"
              }.get(status, "the planted value was not decided")
    return {"case": case, "status": status, "detail": f"{detail}: {inner['detail']}", "counter": True, "inner": inner}


def eval_probe_z(case: str, contact, g54_z, expected: float, tol: float = PROBE_TOL, errors=()) -> dict:
    """Z probing writes G54 Z = the plate (expected, from the independent
    measure — the copy's HAL, never the table after the attempt) ± tol; the
    contact (#5070 = 1) is required; an error of the routine is a FAIL."""
    measured = {"expected": expected, "tol_mm": tol, "contact": contact, "g54_z": g54_z, "errors": list(errors)}
    failed = _failures(errors)
    if failed:
        return _row(case, "FAIL", f"the routine reported: {failed[0]}", **measured)
    if _finite(contact) and contact != 1:
        return _row(case, "FAIL", f"no contact recorded (#5070 = {contact:g})", **measured)
    if _finite(g54_z):
        measured["deviation_mm"] = round(g54_z - expected, 6)
        if abs(g54_z - expected) > tol:
            return _row(case, "FAIL", f"G54 Z {g54_z:.4f} — expected {expected:g} ± {tol:g}", **measured)
    if not _finite(contact):
        return _row(case, "incomplete", "#5070 not read", **measured)
    if not _finite(g54_z):
        return _row(case, "incomplete", "G54 Z not read", **measured)
    return _row(case, "PASS", f"G54 Z {g54_z:.4f} within {expected:g} ± {tol:g}", **measured)


def eval_probe_miss(case: str, contact, g54_before, g54_after, errors) -> dict:
    """No contact within the search depth: no contact recorded (#5070 = 0),
    G54 Z unchanged, LinuxCNC's own "without making contact" in the error
    channel — whose absence is incomplete (a skipped status tick loses its
    errors); another error is a FAIL."""
    measured = {"contact": contact, "g54_before": g54_before, "g54_after": g54_after, "errors": list(errors)}
    other = [x for x in _failures(errors) if NO_CONTACT not in x]
    if other:
        return _row(case, "FAIL", f"another error than the missing contact: {other[0]}", **measured)
    if _finite(contact) and contact != 0:
        return _row(case, "FAIL", f"a contact recorded (#5070 = {contact:g}) beyond the search depth", **measured)
    if _finite(g54_before, g54_after) and abs(g54_after - g54_before) > SAME:
        return _row(case, "FAIL", f"G54 Z changed {g54_before:.4f} → {g54_after:.4f} without a contact", **measured)
    if not _finite(contact, g54_before, g54_after):
        return _row(case, "incomplete", "#5070 or G54 Z not read", **measured)
    said = [x for _, x in errors if NO_CONTACT in x]
    if not said:
        return _row(case, "incomplete", f"no error saying \"{NO_CONTACT}\" received", **measured)
    return _row(case, "PASS", "no contact, nothing set, the error said so", error=said[0], **measured)


def eval_m600(case: str, l0, length, g43, tol: float = M600_TOL, errors=()) -> dict:
    """T<n> M600: the table length measured = L0 (recorded BEFORE) ± tol, and
    the applied G43 offset is that same length; an error of the routine is a
    FAIL."""
    measured = {"l0": l0, "length": length, "g43": g43, "tol_mm": tol, "errors": list(errors)}
    failed = _failures(errors)
    if failed:
        return _row(case, "FAIL", f"the routine reported: {failed[0]}", **measured)
    if _finite(l0, length):
        measured["deviation_mm"] = round(length - l0, 6)
        if abs(length - l0) > tol:
            return _row(case, "FAIL", f"length {length:.4f} — expected {l0:g} ± {tol:g}", **measured)
    if _finite(g43, length) and abs(g43 - length) > SAME:
        return _row(case, "FAIL", f"the applied G43 {g43:.4f} is not the measured {length:.4f}", **measured)
    if not _finite(l0, length, g43):
        return _row(case, "incomplete", "L0, the measured length or the applied offset not read", **measured)
    return _row(case, "PASS", f"length {length:.4f} within {l0:g} ± {tol:g}, applied as measured", **measured)


def eval_m600_counter(case: str, base, true_3102: float, planted_3102: float, length, g43, tool_after, tool: int,
                      errors=(), tol: float = M600_TOL) -> dict:
    """The #3102 counter-probe, its OWN run (R292 FI-I27): it ran clean (no
    error, the tool in the spindle, its measured length applied) and its
    length deviates from ITS base — the table length it started from, which
    the sim takes as the physical one (R293) — by exactly what the plant
    predicts: the routine takes ABS[#3102] + #5063 − offset, so base +
    |planted| − |true|, ± tol per measurement. A planted value that changes
    nothing, a failed run or any other length is this row's FAIL."""
    predicted = None if not _finite(base) else base + abs(planted_3102) - abs(true_3102)
    measured = {"base": base, "planted_3102": planted_3102, "predicted": predicted, "length": length, "g43": g43,
                "tool_after": tool_after, "errors": list(errors), "counter": True}
    failed = _failures(errors)
    if failed:
        return _row(case, "FAIL", f"the counter run failed: {failed[0]}", **measured)
    if tool_after is not None and tool_after != tool:
        return _row(case, "FAIL", f"T{tool_after} in the spindle after the counter run, T{tool} expected", **measured)
    if _finite(g43, length) and abs(g43 - length) > SAME:
        return _row(case, "FAIL", f"the counter run applied {g43:.4f}, measured {length:.4f}", **measured)
    if _finite(base, length):
        if abs(length - base) <= tol:
            return _row(case, "FAIL", f"the planted #3102 {planted_3102:g} changed nothing (length {length:.4f}) — "
                        f"the check would not see it", **measured)
        if abs(length - predicted) > tol:
            return _row(case, "FAIL", f"length {length:.4f} is neither its base {base:g} nor the planted "
                        f"{predicted:g}", **measured)
    if not _finite(base, length, g43) or tool_after is None:
        return _row(case, "incomplete", "the base, the length, the applied offset or the tool not read", **measured)
    return _row(case, "PASS", f"the planted #3102 gave {length:.4f} as predicted from {base:g} — refused against it",
                **measured)


#: the toolsetter section's keys as the booking names them (toolsetterVarMap)
TS_KEYS = tuple(str(k) for k in (3004, 3005, 3006, 3007, 3009, 3010, 3013) + tuple(range(3100, 3116)))


def eval_ts_sync(case: str, l0, old_3102: float, new_3102: float, length, g43, note, interp_before, interp_after,
                 errors=(), tol: float = M600_TOL) -> dict:
    """P2 on the real task (Codex R308–R309): the toolsetter section saved
    while the machine was OFF with #3102 moved reaches the interpreter at the
    PROGRAM start — a program's T<n> M600 measures with it. Expected from the
    table length before (l0) and the deliberate delta, never from an earlier
    measurement: l0 + |new| − |old| (the routine takes ABS[#3102], as the
    #3102 counter), ± tol per measurement. Only the NEW basis passes; a length
    at l0 is the old #3102 (the live red case, R309). The start's reply must
    say it wrote (`toolsetter.synced` — the booking held the old number), the
    applied G43 is the length, and the interpreter holds the new #3102 after.
    An error of the routine is a FAIL; an interpreter that held the new value
    before the start proves nothing (incomplete)."""
    expected = l0 + abs(new_3102) - abs(old_3102) if _finite(l0, new_3102, old_3102) else None
    measured = {"l0": l0, "old_3102": old_3102, "new_3102": new_3102, "expected": expected, "length": length,
                "g43": g43, "toolsetter": note, "interp_before": interp_before, "interp_after": interp_after,
                "tol_mm": tol, "errors": list(errors)}
    failed = _failures(errors)
    if failed:
        return _row(case, "FAIL", f"the program reported: {failed[0]}", **measured)
    if not _finite(interp_before) or abs(interp_before - old_3102) > SAME:
        return _row(case, "incomplete", f"the interpreter held #3102 {interp_before} before the start, not the old "
                    f"{old_3102:g} — the start would prove nothing", **measured)
    if not isinstance(note, dict):
        return _row(case, "FAIL", "the start's reply names no toolsetter sync", **measured)
    if note.get("synced") is not True:
        return _row(case, "FAIL", f"the start's reply says nothing was written ({note}) — the booking held the old "
                    f"#3102", **measured)
    if _finite(g43, length) and abs(g43 - length) > SAME:
        return _row(case, "FAIL", f"the applied G43 {g43:.4f} is not the measured {length:.4f}", **measured)
    if _finite(length, expected):
        measured["deviation_mm"] = round(length - expected, 6)
        if abs(length - expected) > tol:
            stale = _finite(l0) and abs(length - l0) <= tol
            return _row(case, "FAIL", (f"length {length:.4f} is the old #3102's ({l0:g}) — the saved section did "
                                       f"not reach the interpreter" if stale else
                                       f"length {length:.4f} — expected {expected:g} ± {tol:g}"), **measured)
    if _finite(interp_after) and abs(interp_after - new_3102) > SAME:
        return _row(case, "FAIL", f"the interpreter holds #3102 {interp_after:g} after the start, the section "
                    f"{new_3102:g}", **measured)
    if not _finite(length, g43, expected, interp_after):
        return _row(case, "incomplete", "the length, the applied offset, L0 or #3102 after the start not read",
                    **measured)
    return _row(case, "PASS", f"saved while off, applied at the start: #3102 {old_3102:g} → {new_3102:g}, length "
                f"{length:.4f} within {expected:g} ± {tol:g} (the old basis gives {l0:g})", **measured)


def eval_ts_booking(case: str, old: dict, new: dict, before, after, canon) -> dict:
    """What the form's machine line is projected from (P2, R309 FI308-04),
    as THIS connection received it, judged by the form's own equality — the
    six canonical digits (`canon`, the run tree's toolsetter_rules.canonical,
    = toFixed(6)), never a tolerance (R312 FI-I43). Before the start every
    one of the 23 keys is confirmed (applied or read) at the PREPARED numbers
    `old` — the form: saved, not yet in the machine, differing in exactly the
    keys the section moved; after it every key is confirmed at the section's
    numbers `new` — the form: confirmed — at a higher version. A confirmed
    number that is not the expected one (before or after) is a FAIL; a key
    missing, assumed or unknown is incomplete — no proven change of state."""
    measured = {"old": old, "new": new, "before": before, "after": after}
    if not isinstance(before, dict) or not isinstance(after, dict):
        return _row(case, "incomplete", "the booking was not received before and after the start", **measured)

    def state(booking, want):
        keys = booking.get("keys") or {}
        open_ = [k for k in TS_KEYS if (keys.get(k) or {}).get("origin") not in ("applied", "read")
                 or not _finite((keys.get(k) or {}).get("value"))]
        differ = [k for k in TS_KEYS if k not in open_ and canon(keys[k]["value"]) != want[k]]
        return open_, differ
    b_open, b_differ = state(before, old)
    a_open, a_differ = state(after, new)
    moved = [k for k in TS_KEYS if old[k] != new[k]]
    measured.update(moved=moved, before_unconfirmed=b_open, after_unconfirmed=a_open)
    if b_differ:
        return _row(case, "FAIL", f"before the start the booking holds other confirmed numbers than the prepared "
                    f"basis: {b_differ}", **measured)
    if a_differ:
        return _row(case, "FAIL", f"after the start the booking holds other numbers than the section: {a_differ}",
                    **measured)
    vb, va = before.get("version"), after.get("version")
    if isinstance(vb, int) and isinstance(va, int) and va <= vb:
        return _row(case, "FAIL", f"the booking's version did not rise ({vb} → {va}) with {moved} changed", **measured)
    if b_open:
        return _row(case, "incomplete", f"before the start {len(b_open)} of {len(TS_KEYS)} keys not confirmed: "
                    f"{b_open[:5]} — the change of state is not proven", **measured)
    if a_open:
        return _row(case, "incomplete", f"after the start {len(a_open)} of {len(TS_KEYS)} keys not confirmed: "
                    f"{a_open[:5]}", **measured)
    if not moved or not (isinstance(vb, int) and isinstance(va, int)):
        return _row(case, "incomplete", "no key moved, or a version not received", **measured)
    return _row(case, "PASS", f"before every key confirmed at the prepared numbers (the form: not yet in the "
                f"machine, {moved}), after every key at the section's (the form: confirmed); version {vb} → {va}",
                **measured)


def eval_ts_stable(case: str, note, version_before, version_after, errors=()) -> dict:
    """A second start with the same section writes nothing (the named P2
    decision): its reply says `synced: false` and the booking's version
    stays. A start that wrote again is a FAIL; so is an error of THIS
    attempt (R312 FI-I44: `errors` from the accepted start on — a DEBUG
    line is none)."""
    measured = {"toolsetter": note, "version_before": version_before, "version_after": version_after,
                "errors": list(errors)}
    failed = _failures(errors)
    if failed:
        return _row(case, "FAIL", f"the second start reported: {failed[0]}", **measured)
    if not isinstance(note, dict):
        return _row(case, "FAIL", "the start's reply names no toolsetter sync", **measured)
    if note.get("synced") is not False:
        return _row(case, "FAIL", f"the same section was written again ({note})", **measured)
    if not (isinstance(version_before, int) and isinstance(version_after, int)):
        return _row(case, "incomplete", "the booking's version not received around the start", **measured)
    if version_after != version_before:
        return _row(case, "FAIL", f"the booking changed ({version_before} → {version_after}) on a start that "
                    f"wrote nothing", **measured)
    return _row(case, "PASS", f"nothing written, the booking stayed at version {version_before}", **measured)


def eval_override_lock(case: str, frames: list[tuple], t_trigger: float) -> dict:
    """F-OVERRIDE.S2b (R285, R292 FI-I26): during M600's measuring phase the
    status says the feed override is LOCKED, after the routine's end it is
    FREE again. `frames` = (receipt time, status) as received. Required: (1)
    a frame received after the trigger showing it free before the lock; (2)
    locked in every frame from the first locked one through the LAST frame
    with known motion before the completion — the phase is the motion's,
    never the span between locked frames (free once the axis stands is
    allowed); (3) a frame received in [completion, completion + 2 s] showing
    it free — the completion frame itself may. A window not observed to its
    end is incomplete, a fully observed one with no release a FAIL."""
    fresh = [(t, st) for t, st in frames if t >= t_trigger]
    en = [st.get("feed_override_enabled") for _, st in fresh]
    locked = [i for i, e in enumerate(en) if e is False]
    if not locked:
        return _row(case, "incomplete", "no frame showed the override locked")
    first = locked[0]
    if True not in en[:first]:
        return _row(case, "incomplete", "no frame after the trigger showed it free before the lock",
                    locked_from_s=round(fresh[first][0] - t_trigger, 3))
    done = next((i for i in range(first, len(fresh)) if fresh[i][1].get("interp_state") == 1
                 and fresh[i][1].get("tool_change_seq") is None
                 and fresh[i][1].get("tool_change_requested") is False), None)
    stop = len(fresh) if done is None else done
    vel = [fresh[i][1].get("current_vel") for i in range(len(fresh))]
    measured = {"locked_from_s": round(fresh[first][0] - t_trigger, 3)}
    # a release before the completion is allowed only at a PROVEN standstill:
    # its frame and every one after it to the completion stand still, known
    # (R293 FI-I26 A — unread motion never shortens the phase)
    unproven = None
    for i in range(first, stop):
        if en[i] is not False:
            later = [j for j in range(i, stop) if _finite(vel[j]) and abs(vel[j]) > STANDSTILL]
            if en[i] is True and later:
                return _row(case, "FAIL", f"free at {fresh[i][0] - t_trigger:+.3f} s while the axis moves in the "
                            f"measuring phase (at {fresh[later[0]][0] - t_trigger:+.3f} s)", **measured)
            if unproven is None and (en[i] is None or any(not _finite(vel[j]) for j in range(i, stop))):
                unproven = i
    if unproven is not None:
        what = "the lock not read" if en[unproven] is None else "free with the motion unread"
        return _row(case, "incomplete", f"{what} at {fresh[unproven][0] - t_trigger:+.3f} s in the measuring phase",
                    **measured)
    if done is None:
        return _row(case, "incomplete", "no confirmed completion received", **measured)
    t_done = fresh[done][0]
    measured["done_s"] = round(t_done - t_trigger, 3)
    free = next((t for (t, _), e in zip(fresh[done:], en[done:]) if t <= t_done + RELEASE_WITHIN and e is True), None)
    if free is not None:
        return _row(case, "PASS", "locked through the measuring phase, free after the routine",
                    free_s=round(free - t_trigger, 3), **measured)
    # no release seen: a FAIL only if the window was SEEN — frames through
    # it with no gap past WINDOW_GAP_S (a frame after it is no coverage)
    # only frames that SAY the lock cover it (R294 FI-I26: an unread value is a gap)
    times = [t for (t, _), e in zip(fresh[done:], en[done:]) if e is not None]
    seen_to = t_done
    for t in times:
        if t - seen_to > WINDOW_GAP_S:
            break
        seen_to = max(seen_to, t)
    measured["window_seen_to_s"] = round(seen_to - t_trigger, 3)
    if seen_to >= t_done + RELEASE_WITHIN:
        return _row(case, "FAIL", f"not free within {RELEASE_WITHIN} s of the completion", **measured)
    return _row(case, "incomplete", f"the {RELEASE_WITHIN} s after the completion not seen: a gap after "
                f"{seen_to - t_done:.3f} s of them (frames at most {WINDOW_GAP_S} s apart)", **measured)


def eval_m6_hold(case: str, holds: list[dict], tool_before, tool_after, offset_after, tool: int, length: float,
                 hold_s: float) -> dict:
    """F-TOOLCHANGE.S2: M6 waited for the explicit confirmation — ONE hold of
    `hold_s` over RECEIVED frames (every one checked by the helper) — and
    went on with the new tool: in the spindle, its length applied. Fewer
    than 90 % of 20 Hz or a gap past 0.1 s leaves the hold unobserved
    (incomplete), never contradicted."""
    measured = {"tool_before": tool_before, "tool_after": tool_after, "offset_after": offset_after}
    if len(holds) != 1:
        return _row(case, "FAIL", f"{len(holds)} held requests — M6 raised none to hold" if not holds
                    else f"{len(holds)} held requests, one expected", **measured)
    h = holds[0]
    measured.update(samples=h["samples"], max_gap_s=round(h["max_gap_s"], 3),
                    held_s=round(h["last_t"] - h["t0"], 3), first_t=h["t0"], last_t=h["last_t"])
    if tool_after is not None and tool_after != tool:
        return _row(case, "FAIL", f"T{tool_after} in the spindle after the change, T{tool} expected", **measured)
    if _finite(offset_after) and abs(offset_after - length) > SAME:
        return _row(case, "FAIL", f"the applied offset {offset_after} is not T{tool}'s length {length}", **measured)
    if h["last_t"] - h["t0"] < hold_s:
        return _row(case, "FAIL", f"confirmed after {h['last_t'] - h['t0']:.3f} s of a {hold_s:g} s hold", **measured)
    if h["samples"] < 0.9 * hold_s * 20 or h["max_gap_s"] > 0.1:
        return _row(case, "incomplete", f"the hold not observed throughout: {h['samples']} frames, a gap up to "
                    f"{h['max_gap_s']:.3f} s", **measured)
    if not _finite(offset_after) or tool_after is None:
        return _row(case, "incomplete", "the tool or the applied offset after the change not read", **measured)
    return _row(case, "PASS", f"held {hold_s:g} s waiting, then T{tool} with its length", **measured)


def eval_unload(case: str, served: list[dict], tool_after, offset_after) -> dict:
    """T0 M600 (F-TOOLMEASURE.S6b): the spindle empty (T0) and no length
    applied afterwards; the change to T0 the only one confirmed."""
    measured = {"served": served, "tool_after": tool_after, "offset_after": offset_after}
    if any(c["tool"] != 0 for c in served):
        return _row(case, "FAIL", "a change to another tool than T0 confirmed", **measured)
    if tool_after is not None and tool_after != 0:
        return _row(case, "FAIL", f"T{tool_after} in the spindle after the unload", **measured)
    if _finite(offset_after) and abs(offset_after) > SAME:
        return _row(case, "FAIL", f"a length {offset_after} still applied after the unload", **measured)
    if not _finite(offset_after) or tool_after is None:
        return _row(case, "incomplete", "the tool or the applied offset after the unload not read", **measured)
    return _row(case, "PASS", "the spindle empty, no length applied", **measured)


# ── step 2b: run from line (Codex R292 FI292-01) ─────────────────────────
MODE_AUTO = 2
POS_TOL = 0.01                # mm: a position reached / an entry stood at
RFL_FAILED = {"measure_failed", "flag_failed", "flag_clear_failed", "safe_z_failed", "positioning_failed",
              "program_changed", "failed", "aborted"}
MODE_MDI = 3


def rfl_failed(phase: dict) -> bool:
    """A negative phase: every one the gateway sends (`ok: false`), named or
    not — the gateway sends its LAST phase, so none before it may be relied
    on (R296 FI-I31 C)."""
    return phase.get("phase") in RFL_FAILED or phase.get("ok") is False


def _main(st) -> bool:
    """A frame of the loaded program itself: AUTO, no subroutine or remap
    (call_level 0) — a remap's motion_line numbers ITS file (R292)."""
    return st.get("task_mode") == MODE_AUTO and st.get("call_level") == 0


def _moving(st) -> bool:
    return _finite(st.get("current_vel")) and abs(st["current_vel"]) > STANDSTILL


def _phases(history):
    """(phase, t start, t end) in order; the last runs to infinity."""
    out = []
    for i, (t, p) in enumerate(history):
        out.append((p.get("phase"), t, history[i + 1][0] if i + 1 < len(history) else math.inf))
    return out


def _started(history):
    bad = next(((t, p) for t, p in history if rfl_failed(p)), None)
    running = next((t for t, p in history if p.get("phase") == "running" and p.get("ok") is True), None)
    return bad, running


def _off(pos, target, n=None) -> float | None:
    """The largest deviation over the axes `target` names (None: not checked)."""
    if not isinstance(pos, list) or len(pos) < len(target):
        return None
    n = len(target) if n is None else n
    pairs = [(a, b) for a, b in zip(pos[:n], target[:n]) if b is not None]
    if not pairs or not _finite(*[a for a, _ in pairs]):
        return None
    return max(abs(a - b) for a, b in pairs)


def _axes(pos, target: dict):
    """Per axis (R294 FI-I30): the KNOWN deviations past POS_TOL and the
    axes not read — a wrong axis is never hidden by an unread one."""
    bad, missing = [], []
    for j, want in target.items():
        have = pos[j] if isinstance(pos, list) and len(pos) > j else None
        if not _finite(have):
            missing.append(j)
        elif abs(have - want) > POS_TOL:
            bad.append((j, have, want))
    return bad, missing


def _at_rest(st) -> bool:
    """The completion as the step's RoutineEnd has it: idle AND in position (R295)."""
    return st.get("interp_state") == 1 and st.get("inpos") is True


def eval_rfl_line(case: str, history, frames, line: int, tool: int, l0, spindle_speed: float, end_point,
                  final, line_holds=None, end_from=None, errors=(), ended_at=None, tol: float = M600_TOL) -> dict:
    """F-RFL.S3, its observable parts (FI292-01): `running` is only the start
    message; the WITNESS is the first frame of the program itself (AUTO,
    call_level 0) moving after it — its motion_line is `line` (an earlier
    line is a contradiction, a later one only shows the witness was missed),
    and with it the tool, its applied offset = the table's measured length =
    L0 ± tol, the spindle forward at its SET value. Line L moves only its
    axes (`line_holds` {joint: value}, each read at least once on its
    frames) and its end shows on the frames of `end_from` (default L + 1) —
    a line that holds those axes; then the program ends idle at `final`.
    The program's end is the completion the step confirmed (`ended_at`, or
    idle and in position — R295). Positions are judged per axis (R294
    FI-I30); an error of kind 1/11 in
    the attempt is a FAIL (FI-I31). A known contradiction is FAIL, a missing
    proof incomplete."""
    line_holds = line_holds or {}
    end_from = line + 1 if end_from is None else end_from
    measured = {"line": line, "end_point": list(end_point), "final": list(final), "line_holds": line_holds,
                "end_from": end_from, "errors": list(errors)}
    failed = _failures(errors)
    if failed:
        return _row(case, "FAIL", f"the attempt reported: {failed[0]}", **measured)
    bad, running = _started(history)
    if bad:
        return _row(case, "FAIL", f"the run from line failed in {bad[1].get('phase')}: {bad[1].get('error')}",
                    **measured)
    if running is None:
        return _row(case, "incomplete", "no `running` received", **measured)
    after = [(t, st) for t, st in frames if t >= running]
    wi = next((i for i, (_, st) in enumerate(after) if _main(st) and _moving(st)), None)
    if wi is None:
        return _row(case, "incomplete", "no motion of the program received after the start", **measured)
    tw, w = after[wi]
    measured.update(witness_t=tw, witness_line=w.get("motion_line"), tool_number=w.get("tool_number"),
                    offset=(w.get("tool_offset") or [None] * 3)[2], table=w.get("tool_table_z"),
                    spindle_direction=w.get("spindle_direction"), spindle_speed=w.get("spindle_speed"))
    if w.get("motion_line") is None:
        return _row(case, "incomplete", "the first motion's line not read", **measured)
    if w["motion_line"] < line:
        return _row(case, "FAIL", f"the first motion of the program is line {w['motion_line']}, before line {line}",
                    **measured)
    if w["motion_line"] > line:
        return _row(case, "incomplete", f"no frame of line {line} received — the first program motion seen is line "
                    f"{w['motion_line']}", **measured)
    off, table = measured["offset"], measured["table"]
    if w.get("tool_number") is not None and w["tool_number"] != tool:
        return _row(case, "FAIL", f"T{w['tool_number']} at the witness, T{tool} expected", **measured)
    if _finite(off, table) and abs(off - table) > SAME:
        return _row(case, "FAIL", f"the applied offset {off} is not the table's {table}", **measured)
    if _finite(table, l0) and abs(table - l0) > tol:
        return _row(case, "FAIL", f"the measured length {table} is not L0 {l0:g} ± {tol:g}", **measured)
    if w.get("spindle_direction") is not None and w["spindle_direction"] != 1:
        return _row(case, "FAIL", f"the spindle direction {w['spindle_direction']}, forward expected", **measured)
    if _finite(w.get("spindle_speed")) and abs(w["spindle_speed"] - spindle_speed) > SAME:
        return _row(case, "FAIL", f"the spindle set to {w['spindle_speed']}, {spindle_speed:g} expected", **measured)
    rest = [(t, st) for t, st in after[wi:]]
    own = [st for _, st in rest if _main(st) and st.get("motion_line") == line]
    held_seen = set()
    for st in own:
        moved, missing = _axes(st.get("joint_pos"), line_holds)
        if moved:
            j, have, want = moved[0]
            return _row(case, "FAIL", f"line {line} moved joint {j} to {have:.3f} (it holds {want:g})", **measured)
        held_seen |= set(line_holds) - set(missing)
    end_target = {j: v for j, v in enumerate(end_point) if v is not None}
    ends = [st for _, st in rest if _main(st) and st.get("motion_line") == end_from]
    end_seen = set()
    for st in ends:
        wrong, missing = _axes(st.get("joint_pos"), end_target)
        if wrong:
            j, have, want = wrong[0]
            return _row(case, "FAIL", f"line {line} did not reach its end: joint {j} at {have:.3f} on line {end_from}, "
                        f"{want:g} expected", **measured)
        end_seen |= set(end_target) - set(missing)
    # the program's end is the completion the step confirmed (`ended_at`) —
    # else the same rule: idle AND in position, never a first idle frame (R295)
    done = next((st for t, st in rest if t >= ended_at), None) if ended_at is not None else \
        next((st for _, st in rest if _at_rest(st)), None)
    final_seen = set()
    if done is not None:
        wrong, missing = _axes(done.get("joint_pos"), dict(enumerate(final)))
        if wrong:
            j, have, want = wrong[0]
            return _row(case, "FAIL", f"the program ended with joint {j} at {have:.3f}, {want:g} expected", **measured)
        final_seen = set(range(len(final))) - set(missing)
    open_ = []
    if held_seen != set(line_holds):
        open_.append(f"line {line}'s held joints {sorted(set(line_holds) - held_seen)} never read")
    if end_seen != set(end_target):
        open_.append(f"its end not shown by a frame of line {end_from}")
    if done is None or final_seen != set(range(len(final))):
        open_.append("the program's end not received in full")
    if not _finite(off, table, l0, w.get("spindle_speed")) or None in (w.get("tool_number"), w.get("spindle_direction")):
        open_.append("a part of the witness not read")
    if open_:
        return _row(case, "incomplete", "; ".join(open_), **measured)
    return _row(case, "PASS", f"the program started at line {line} with T{tool}, its length, the spindle at "
                f"{spindle_speed:g}; line {line} and the program ran to their ends", **measured)


def eval_rfl_no_earlier(case: str, history, frames, line: int) -> dict:
    """No line before L in the program's own frames after the start —
    limited to what was RECEIVED: a line run between two frames is not
    seen (FI292-01 3: the gap named, the MDI parts of the sequence apart)."""
    _, running = _started(history)
    seen = [st.get("motion_line") for t, st in frames if running is not None and t >= running and _main(st)]
    known = [x for x in seen if isinstance(x, int) and x > 0]
    measured = {"scope": "observed frames", "frames": len(seen), "lines": sorted(set(known))}
    early = [x for x in known if x < line]
    if early:
        return _row(case, "FAIL", f"line {early[0]} shown after the start from line {line}", **measured)
    if not known:
        return _row(case, "incomplete", "no frame of the program received after the start", **measured)
    return _row(case, "PASS", f"no line before {line} in {len(seen)} received frames of the program — a line "
                f"between two frames is not seen", **measured)


def _z(st):
    pos = st.get("joint_pos")
    return pos[2] if isinstance(pos, list) and len(pos) > 2 and _finite(pos[2]) else None


def eval_rfl_start_point(case: str, history, frames, entry_xy) -> dict:
    """The start point (FI292-01 5): the safe-Z stage never lowers Z below
    its own start, the XY entry moves at that height, and where the
    positioning ENDED the machine stands at the entry. Each phase on its own
    frames, by the phase times the same stream carried; each check needs
    only its own axes known (R295 FI-I30). The entry's proof is the ACTUAL
    last frame received up to the next phase, if it is an MDI frame at a
    known standstill — a standstill followed by motion, a frame of the
    started program or of unknown mode is none, and no earlier standstill
    takes its place (R295–R297 FI-I29 A). Status frames can show a contradiction, never prove the path
    between them: without one it stays incomplete until step 2c."""
    ph = {p: (a, b) for p, a, b in _phases(history)}
    measured = {"entry": list(entry_xy)}
    # the stages run as MDI: a frame of the started program (AUTO) is never
    # theirs — a phase may be skipped in transmission, so its boundary frame
    # can already be the program's (R296 FI-I29 A)
    mdi = lambda st: st.get("task_mode") == MODE_MDI  # noqa: E731
    z_safe = None
    if "safe_z" in ph:
        a, b = ph["safe_z"]
        zs = [z for t, st in frames if a <= t < b and mdi(st) for z in [_z(st)] if z is not None]
        if zs:
            z_safe = zs[-1]
            measured.update(safe_z_start=zs[0], safe_z_end=zs[-1])
            low = next((z for z in zs if z < zs[0] - POS_TOL), None)
            if low is not None:
                return _row(case, "FAIL", f"Z lowered to {low:.3f} in the safe-Z stage (from {zs[0]:.3f})", **measured)
    if "positioning" in ph:
        a, b = ph["positioning"]
        win = [(t, st) for t, st in frames if a <= t <= b]
        if z_safe is not None:
            low = next((z for _, st in win if mdi(st) for z in [_z(st)] if z is not None and z < z_safe - POS_TOL),
                       None)
            if low is not None:
                return _row(case, "FAIL", f"XY moved with Z at {low:.3f}, below the safe height {z_safe:.3f}",
                            **measured)
        # the ACTUAL last frame of the window decides (R297): the program's
        # or an unassigned one there is no proof, never an earlier standstill
        last = win[-1][1] if win and b != math.inf else None
        if last is not None and mdi(last) and _finite(last.get("current_vel")) \
                and abs(last["current_vel"]) <= STANDSTILL:
            wrong, _ = _axes(last.get("joint_pos"), {0: entry_xy[0], 1: entry_xy[1]})
            if wrong:
                j, have, want = wrong[0]
                return _row(case, "FAIL", f"the entry {list(entry_xy)} not reached: joint {j} stood at {have:.3f}",
                            **measured)
    return _row(case, "incomplete", "no contradiction in the received frames; the path between them needs the "
                "servo measurement (step 2c)", **measured)


# ── Package G2 (Codex R326): the workpiece, the scan, the compensation ─────

#: the 3-axis profile's WORKPIECE (hallib/sim_surface.hal) as a LITERAL — the
#: independent measure the scan and the compensation are held to (the HAL
#: chain computes the same f; test_sim_toolsetter.py keeps its constants equal)
SURFACE = {"cx": 550.0, "cy": 550.0, "half": 40.0, "c": -169.0, "a": 0.05, "b": -0.03, "k": 0.0024}
SURFACE_BASE = -175.0        # G54 Z of the scan: the map holds deviations from it
SCAN_AXIS = (518.0, 534.0, 550.0, 566.0, 582.0)     # 5 × 5, integer mm (the 1-mm map grid's nodes)
SCAN_TOL = 0.005             # mm: the slow probe (50 mm/min) moves 0.8 µm per servo period
GRID_TOL = 1e-6              # mm: X/Y of a probed point = the commanded node
COMP_TOL = 0.002             # mm: counts × 0.001, truncated or rounded
GAP_TOL = 0.01               # mm: the tip's distance to the surface (probe ± compensation)
METHOD_GAP = 0.05            # mm: the reference values at the test point at least this far apart
OFF_EOFFSET = 0.001          # mm: compensation off — the offset drained
SITE_TOL = 0.001             # mm: a readout's measured X/Y at its point (Codex R327 FI-I56)
METHODS = ("nearest", "linear", "cubic")


def surface_z(x: float, y: float, s: dict = SURFACE) -> float:
    """The workpiece's height (G53) at the control point's X/Y."""
    dx, dy = x - s["cx"], y - s["cy"]
    return s["c"] + s["a"] * dx + s["b"] * dy - s["k"] * (dx * dx + dy * dy)


def scan_order(xs=SCAN_AXIS, ys=SCAN_AXIS) -> list[tuple[float, float]]:
    """surface_scan.ngc's snake: row by row in Y, X forward, then back."""
    out = []
    for r, y in enumerate(ys):
        out += [(x, y) for x in (xs if r % 2 == 0 else xs[::-1])]
    return out


def eval_surface_scan(case: str, points, errors=(), base: float = SURFACE_BASE, expect=surface_z,
                      tol: float = SCAN_TOL) -> dict:
    """F-SURFACE.S2: the scan's result file holds exactly the grid, in the
    routine's snake order, each Z = the workpiece's height there − the G54 Z
    of the scan (the map holds deviations) ± tol. `points` = the rows read
    from the file (None: not read)."""
    measured = {"tol_mm": tol, "errors": list(errors)}
    failed = _failures(errors)
    if failed:
        return _row(case, "FAIL", f"the routine reported: {failed[0]}", **measured)
    if points is None:
        return _row(case, "incomplete", "the result file not read", **measured)
    grid = scan_order()
    measured["points"] = len(points)
    if len(points) != len(grid):
        return _row(case, "FAIL", f"{len(points)} points, the grid has {len(grid)}", **measured)
    worst = (0.0, None)
    for i, (p, (x, y)) in enumerate(zip(points, grid)):
        if len(p) < 3 or not _finite(*p[:3]):
            return _row(case, "FAIL", f"point {i + 1} not three numbers: {p}", **measured)
        if abs(p[0] - x) > GRID_TOL or abs(p[1] - y) > GRID_TOL:
            return _row(case, "FAIL", f"point {i + 1} at X{p[0]:g} Y{p[1]:g} — the snake's is X{x:g} Y{y:g}",
                        **measured)
        dev = p[2] - (expect(x, y) - base)
        if abs(dev) > abs(worst[0]):
            worst = (dev, (x, y))
    measured["worst_mm"] = round(worst[0], 6)
    measured["worst_at"] = worst[1]
    if abs(worst[0]) > tol:
        x, y = worst[1]
        return _row(case, "FAIL", f"Z at X{x:g} Y{y:g} off the surface by {worst[0]:+.4f} (± {tol:g})", **measured)
    return _row(case, "PASS", f"{len(grid)} points in the snake, each on the surface within ± {tol:g}", **measured)


def eval_map_reload(case: str, before, after) -> dict:
    """F-SURFACE.S2 "liefert die Punkte für die Kompensation": the
    compensation's map version (compensation.grid-version) advanced after
    the scan's end — the gateway's DONE → reload-req → compensation.py loaded
    the new file."""
    measured = {"version_before": before, "version_after": after}
    if not _finite(before, after):
        return _row(case, "incomplete", "the map version not read", **measured)
    if after == before:
        return _row(case, "FAIL", "the map version did not advance after the scan", **measured)
    return _row(case, "PASS", f"the map reloaded (version {before:g} → {after:g})", **measured)


def comp_reference(points, method: str, q, resolution: float = 1.0) -> float:
    """What compensation.py applies at `q` from the RECORDED points — its
    path written out here, no product code: X/Y rounded to 0.1, the grid
    from int(min)…int(max) at `resolution`, the node nearest to `q`,
    scipy.interpolate.griddata there with `method`, a NaN outside the hull
    filled by the nearest point; the value before the counts quantization."""
    import numpy as np
    from scipy.interpolate import griddata
    pts = np.asarray(points, dtype=float)
    xs, ys, zs = np.around(pts[:, 0], 1), np.around(pts[:, 1], 1), pts[:, 2]
    gx = np.linspace(int(xs.min()), int(xs.max()), int((int(xs.max()) - int(xs.min())) / resolution) + 1)
    gy = np.linspace(int(ys.min()), int(ys.max()), int((int(ys.max()) - int(ys.min())) / resolution) + 1)
    node = (gx[np.argmin(np.abs(gx - q[0]))], gy[np.argmin(np.abs(gy - q[1]))])
    v = float(griddata((xs, ys), zs, [node], method=method)[0])
    if math.isnan(v):
        v = float(griddata((xs, ys), zs, [node], method="nearest")[0])
    return v


def scipy_version() -> str:
    import scipy
    return scipy.__version__


def point_z(points, x: float, y: float):
    """A recorded point's Z at the node (x, y) — None if not recorded."""
    return next((p[2] for p in points if abs(p[0] - x) <= GRID_TOL and abs(p[1] - y) <= GRID_TOL), None)


def _settled_read(reading: dict, method=None, enabled=True):
    """The common conditions of a reading: settled, finite, the method and
    the on/off state confirmed in the frame read — None or the reason."""
    if not reading.get("settled"):
        return f"not settled: {reading.get('why', 'no reading')}"
    if not _finite(reading.get("eoffset"), reading.get("joint_z")):
        return "the offset or joint Z not read"
    if reading.get("enabled") is not enabled:
        return f"compensation {'on' if enabled else 'off'} not confirmed (status {reading.get('enabled')})"
    if method is not None and reading.get("method") != METHODS.index(method):
        return f"the method {method} not confirmed (status {reading.get('method')})"
    if reading.get("limited") is not False:
        return f"motion.eoffset-limited is {reading.get('limited')}"
    if not _finite(reading.get("version")):
        return f"the map version unknown (status {reading.get('version')})"
    return None


def _site(reading: dict, at):
    """The reading's MEASURED X/Y at the point it is judged for (Codex R327
    FI-I56): (status, reason) — unknown is incomplete, known elsewhere a
    FAIL — or None when it stood there."""
    x, y = reading.get("x"), reading.get("y")
    if not _finite(x, y):
        return "incomplete", "the position not read"
    if abs(x - at[0]) > SITE_TOL or abs(y - at[1]) > SITE_TOL:
        return "FAIL", f"measured at X{x:.4f} Y{y:.4f}, not at X{at[0]:g} Y{at[1]:g}"
    return None


def eval_comp_method(case: str, method: str, reading: dict, refs: dict, recorded: dict, f_dev: float,
                     z_control: float, at, tol: float = COMP_TOL) -> dict:
    """F-COMP.S4, one method at the test point Q on the edge (534,550)–(550,550)
    at a quarter (Codex R326 Q326-1): the applied offset = the method's
    reference from the recorded points (`refs`, before quantization) ± tol;
    independently of scipy: nearest = the nearer node's recorded Z, linear =
    0.75·z(534,550) + 0.25·z(550,550) (an axis-parallel edge of a regular grid
    is in every Delaunay triangulation), cubic at least METHOD_GAP from linear
    AND closer to the surface than linear; the joint Z minus the offset = the
    commanded control point; the reading measured AT Q. Reference values
    closer than METHOD_GAP leave the test point unfit: incomplete — unless
    the measured value already contradicts one."""
    e = reading.get("eoffset")
    measured = {"method": method, "at": list(at), "eoffset": e, "joint_z": reading.get("joint_z"),
                "z_control": z_control, "refs": {k: round(v, 6) for k, v in refs.items()}, "recorded": recorded,
                "f_dev": round(f_dev, 6), "tol_mm": tol, "reading": reading}
    why = _settled_read(reading, method)
    if why:
        return _row(case, "incomplete", why, **measured)
    site = _site(reading, at)
    if site:
        return _row(case, site[0], site[1], **measured)
    if abs((reading["joint_z"] - e) - z_control) > tol:
        return _row(case, "FAIL", f"joint Z − offset {reading['joint_z'] - e:.4f}, commanded {z_control:g}",
                    **measured)
    if abs(e - refs[method]) > tol:
        return _row(case, "FAIL", f"offset {e:.4f}, the {method} reference {refs[method]:.4f} ± {tol:g}", **measured)
    z0, z1 = recorded.get("near"), recorded.get("far")
    if not _finite(z0, z1):
        return _row(case, "incomplete", "the edge's recorded points not read", **measured)
    if method == "nearest" and abs(e - z0) > tol:
        return _row(case, "FAIL", f"nearest {e:.4f} is not the nearer node's {z0:.4f}", **measured)
    if method == "linear" and abs(e - (0.75 * z0 + 0.25 * z1)) > tol:
        return _row(case, "FAIL", f"linear {e:.4f} is not 0.75·{z0:.4f} + 0.25·{z1:.4f}", **measured)
    if method == "cubic":
        lin = 0.75 * z0 + 0.25 * z1
        if abs(e - lin) < METHOD_GAP:
            return _row(case, "FAIL", f"cubic {e:.4f} within {METHOD_GAP:g} of linear {lin:.4f}", **measured)
        if abs(e - f_dev) >= abs(lin - f_dev):
            return _row(case, "FAIL", f"cubic {e:.4f} not closer to the surface {f_dev:.4f} than linear {lin:.4f}",
                        **measured)
    gaps = [abs(refs[a] - refs[b]) for i, a in enumerate(METHODS) for b in METHODS[i + 1:]]
    measured["min_ref_gap_mm"] = round(min(gaps), 6)
    if min(gaps) < METHOD_GAP:
        return _row(case, "incomplete", f"the references lie {min(gaps):.4f} apart (< {METHOD_GAP:g}): the test "
                    "point does not tell the methods apart", **measured)
    return _row(case, "PASS", f"{method}: offset {e:.4f} = the reference within ± {tol:g}", **measured)


def eval_comp_reading(case: str, reading: dict, enabled: bool, map_z, gap_expected: float, z_control: float,
                      length: float, at, gap_tol: float = GAP_TOL, tol: float = COMP_TOL) -> dict:
    """F-COMP.S4 ON/OFF at a node (Codex R326): ON — the offset = the node's
    recorded Z ± tol; OFF — drained (|offset| < OFF_EOFFSET). Either way the
    joint Z minus the offset = the commanded control point, and the tip's
    distance to the workpiece (joint Z − length − f at the MEASURED X/Y) =
    `gap_expected` ± gap_tol, the reading measured at `at` (Codex R327 FI-I56)."""
    e = reading.get("eoffset")
    measured = {"enabled": enabled, "at": list(at), "eoffset": e, "joint_z": reading.get("joint_z"),
                "map_z": map_z, "gap_expected": gap_expected, "z_control": z_control, "reading": reading}
    why = _settled_read(reading, enabled=enabled)
    if why:
        return _row(case, "incomplete", why, **measured)
    site = _site(reading, at)
    if site:
        return _row(case, site[0], site[1], **measured)
    if abs((reading["joint_z"] - e) - z_control) > tol:
        return _row(case, "FAIL", f"joint Z − offset {reading['joint_z'] - e:.4f}, commanded {z_control:g}",
                    **measured)
    if enabled:
        if not _finite(map_z):
            return _row(case, "incomplete", "the node's recorded Z not read", **measured)
        if abs(e - map_z) > tol:
            return _row(case, "FAIL", f"offset {e:.4f}, the node's map value {map_z:.4f} ± {tol:g}", **measured)
    elif abs(e) >= OFF_EOFFSET:
        return _row(case, "FAIL", f"compensation off but the offset is {e:.4f}", **measured)
    gap = reading["joint_z"] - length - surface_z(reading["x"], reading["y"])
    measured["gap_mm"] = round(gap, 6)
    if abs(gap - gap_expected) > gap_tol:
        return _row(case, "FAIL", f"the tip stands {gap:.4f} above the workpiece, expected {gap_expected:.4f}",
                    **measured)
    return _row(case, "PASS", f"{'on' if enabled else 'off'}: the tip {gap:.4f} above the workpiece", **measured)


def eval_comp_pair(case: str, *parts: dict) -> dict:
    """Readings of one case (ON and OFF at a place; ON before an XY move, ON
    after it, OFF there) as ONE row: PASS only with all; a FAIL before a
    missing reading."""
    for want in ("FAIL", "incomplete"):
        r = next((r for r in parts if r["status"] == want), None)
        if r is not None:
            return {**_row(case, want, r["detail"]), "readings": list(parts)}
    return {**_row(case, "PASS", "; ".join(r["detail"] for r in parts)), "readings": list(parts)}


SETTLE_S, SETTLE_TOL, SETTLE_GAP_S = 0.5, 0.0005, 0.2


def settled_window(frames: list[tuple], cond, span: float = SETTLE_S, tol: float = SETTLE_TOL,
                   gap: float = SETTLE_GAP_S):
    """The newest frames as a SETTLED reading (Codex R326): fresh frames — at
    most `gap` s apart — covering `span` s back from the newest, each with
    `cond` true, a finite offset and joint Z within `tol` of the newest's and
    the same KNOWN map version — an unknown one carries no reading (Codex
    R327 FI-I57) — and the joint X/Y within `tol` too. None otherwise:
    missing frames are no standstill. The accepted window is returned with
    its frames (time and the values judged) as the reading's record."""
    if not frames:
        return None

    def vals(st):
        jp = list(st.get("joint_pos") or [])[:3]
        jp += [None] * (3 - len(jp))
        return st.get("eoffset_z"), jp[0], jp[1], jp[2], st.get("comp_grid_version")
    t_last, last = frames[-1]
    first = vals(last)
    if not (_finite(*first) and cond(last)):
        return None
    t_prev, kept = t_last, []
    for t, st in reversed(frames):
        if t_prev - t > gap:
            return None
        v = vals(st)
        if not (cond(st) and _finite(*v) and all(abs(a - b) <= tol for a, b in zip(v[:4], first[:4]))
                and v[4] == first[4]):
            return None
        kept.append([round(t, 4), *v, st.get("eoffset_enabled"), st.get("comp_method")])
        if t_last - t >= span:
            return {"t_from": t, "t_to": t_last, "status": last,
                    "frames": kept[::-1], "frame_fields": ["t", "eoffset_z", "x", "y", "z", "version", "enabled",
                                                           "method"]}
        t_prev = t
    return None
