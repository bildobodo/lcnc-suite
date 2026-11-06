"""The step 2c evaluators on servo sections (plan Codex R299–R301): each
takes a section (`samples` (receipt time, n, values), `problems`) and
returns PASS / FAIL / incomplete. A contradiction seen in the read samples
is a FAIL even in a flawed section; without one, a flaw or a missing proof
is incomplete. Times only by receipt; positions in mm, velocities in mm/s."""
from __future__ import annotations

import math
import re
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
    """F-GOTO.S1c (R284, R302/R303 FI-I32): from the first sample with a
    KNOWN axis 0.005 mm off the start to the END of the section, every sample
    judged on its own KNOWN values — never on a phase it is only assumed to
    be in: Z known below −0.010 while a known X/Y is off its start AND a known
    X/Y is off the target (X/Y moved with Z down — before the rise, or Z sank
    during the travel); an up target with Z known below the top while X/Y
    are known on it; a G30 target's Z undershot in its descent; after X/Y were PROVEN on
    the target (the one remembered fact), a known X/Y off it. The end at rest
    on the target ± 0.010. A violation is FAIL; an unread position anywhere
    on the path, a rise or an arrival not shown, or the rest missing leaves it
    incomplete — an unknown transition is unproven, never a failure."""
    samples, problems = sec["samples"], list(sec["problems"])
    m = {"start": list(start), "target": list(target), "problems": problems}
    P = lambda s, j: s[2][j]            # noqa: E731
    bi = next((i for i, s in enumerate(samples)
               if any(_f(P(s, j)) and abs(P(s, j) - start[j]) > MOVE_EPS for j in range(3))), None)
    if bi is None:
        return _row(case, "incomplete", "no motion of the routine in the section", **m)
    up_target = target[2] >= Z_TOP
    arrived = z_up = unread = False
    for s in samples[bi:]:
        x, y, z = P(s, 0), P(s, 1), P(s, 2)
        unread = unread or not _f(x, y, z)
        off_start = [(j, v) for j, v in ((0, x), (1, y)) if _f(v) and abs(v - start[j]) > PATH_TOL]
        off_target = [(j, v) for j, v in ((0, x), (1, y)) if _f(v) and abs(v - target[j]) > PATH_TOL]
        on_target = _f(x, y) and not off_target
        z_low = _f(z) and z < Z_TOP
        if arrived and off_target:
            j, v = off_target[0]
            return _row(case, "FAIL", f"{'XY'[j]} left the target ({v:.3f}) after arriving (sample {s[1]})", **m)
        if z_low and off_start and off_target:
            j, v = off_start[0]
            return _row(case, "FAIL", f"{'XY'[j]} moved {v - start[j]:+.3f} mm with Z at {z:.3f} (sample {s[1]})",
                        **m)
        if up_target and z_low and (on_target or arrived):
            # after the PROVEN arrival the known Z alone decides (R304)
            return _row(case, "FAIL", f"Z at {z:.3f} on the target — an up target keeps Z up (sample {s[1]})", **m)
        if arrived and not up_target and _f(z) and z < target[2] - PATH_TOL:
            return _row(case, "FAIL", f"Z at {z:.3f} below the target's {target[2]:g} (sample {s[1]})", **m)
        z_up = z_up or (_f(z) and z >= Z_TOP)
        arrived = arrived or on_target
    last = samples[-1]
    at_rest = all(_f(v) and abs(v) <= VEL_ZERO for v in last[2][3:6])
    if at_rest:
        for j in range(3):
            v = P(last, j)
            if _f(v) and abs(v - target[j]) > PATH_TOL:
                m["end_off_mm"] = round(abs(v - target[j]), 4)
                return _row(case, "FAIL", f"ended {abs(v - target[j]):.3f} mm off its target on {'XYZ'[j]}", **m)
    if problems:
        return _row(case, "incomplete", f"the section is flawed: {problems[0]}", **m)
    if unread:
        return _row(case, "incomplete", "a position unread on the path — its order not shown", **m)
    if not (z_up and arrived and at_rest and _f(*[P(last, j) for j in range(3)])):
        return _row(case, "incomplete", "the rise, the arrival or the rest at the end not shown", **m)
    descent = "no descent (the target's Z is up)" if up_target else "the descent after X/Y arrived"
    return _row(case, "PASS", f"Z up first, then X/Y; {descent}; at rest on the target", **m)


_MOTION_WORD = re.compile(r"(?i)\bG0*[0-3](?![\d.])|\bG38\.[2-5]|\bG28(?![\d.])|\bG30(?![\d.])")


def motion_lines(text: str) -> frozenset:
    """The 1-based lines of a G-code text with a motion word outside comments
    (G0–G3, G38.2–.5, G28, G30) — the lines `motion.program-line` can show
    while the text moves. Taken from the TEXT, never from a path (R310)."""
    out = set()
    for i, raw in enumerate(text.splitlines(), 1):
        code = re.sub(r"\([^)]*\)", "", raw.split(";", 1)[0])
        if _MOTION_WORD.search(code):
            out.add(i)
    return frozenset(out)


def routine_sources(tree, texts: dict) -> tuple:
    """The routine texts the attribution reads, bound to the checked ones
    (Codex R311 FI-I42): {relative path: sha256} → (their motion lines, {path:
    sha read}, None) — or (None, {…}, why) when a text is missing,
    unreadable or not the checked text. A text that differs may move on a
    line the narrow word scan does not see (a modal axis word): no mapping."""
    import hashlib
    from pathlib import Path
    lines, read = frozenset(), {}
    for rel, want in texts.items():
        try:
            data = (Path(tree) / rel).read_bytes()
        except OSError as e:
            read[rel] = None
            return None, read, f"the routine text {rel} is not readable ({e.__class__.__name__})"
        read[rel] = hashlib.sha256(data).hexdigest()
        if read[rel] != want:
            return None, read, f"the routine text {rel} is not the checked one (sha {read[rel][:12]}…)"
        lines |= motion_lines(data.decode())
    return lines, read, None


def eval_rfl_start_servo(case: str, sec: dict, line: int, entry_xy, safe_z: float,
                         routine_lines, program_lines: frozenset, sources=None, source_problem=None) -> dict:
    """F-RFL.S3's start point from the servo stream (2c-b, Codex R309–R310).
    Each sample is attributed by `motion.program-line` (the executing
    segment's line) through the TEXTS' line sets — the pre-measurement
    routine's motion lines, the program's lines, 0 for an MDI line or rest —
    never by a receipt time. The program runs with G61.1 (exact stop), so a
    line's axes are its own.
    FAIL (a known contradiction, whatever else is unread):
    1. a program line 1…L−1 moving — anywhere in the attempt;
    2. in the entry (after the last routine sample before L) a known Z below
       the highest known Z before it by more than STILL_POS (a descent; small
       steps add up);
    3. L's first sample off the entry X/Y (PATH_TOL) or below the safe height;
    4. a known motion after the FIRST confirmed rest at the entry (the
       anchor — STILL_BLOCK samples at rest, in position, at the entry, on
       the safe height) before L;
    5. L moving Y or Z.
    incomplete: line sets that meet, no sample of L, the start unread, no
    anchor, a moving sample on a line no text names, a routine line after the
    program began (the phase order), a section problem, the self-check (L+1
    moves only Y, L+2 only Z) failing — never over a FAIL.
    The fixed case has a pre-measurement (R311): no routine sample before L
    leaves the boundary unproven — rules 2 and 4 are not judged, the row
    incomplete unless 1, 3 or 5 fails; the descent of rule 2 starts at the
    routine's last known Z (FI-I40), an unread one is no proven step. Routine
    texts not the checked ones (`source_problem`, routine_sources) map
    nothing: incomplete, no claim either way (FI-I42)."""
    samples = sec.get("samples") or []
    measured = {"line": line, "entry_xy": list(entry_xy), "safe_z": safe_z, "samples": len(samples)}
    if sources is not None:
        measured["sources"] = sources
    if source_problem or routine_lines is None:
        return _row(case, "incomplete", source_problem or "the routine texts not read — no mapping", **measured)
    meet = routine_lines & program_lines
    if meet:
        return _row(case, "incomplete", f"the routine's lines meet the program's ({sorted(meet)[:5]}) — no mapping",
                    **measured)

    def ln(v):
        return int(v[6]) if len(v) > 6 and _f(v[6]) else None

    def kv(v, i):
        return v[i] if len(v) > i and _f(v[i]) else None

    def moving(v):
        return any(kv(v, i) is not None and abs(v[i]) > VEL_ZERO for i in (3, 4, 5))

    fails, gaps = [], []
    for _t, n, v in samples:                                            # 1
        if ln(v) is not None and 1 <= ln(v) < line and ln(v) in program_lines and moving(v):
            fails.append(f"line {ln(v)} moved before line {line} (sample {n})")
            break
    first_prog = next((i for i, (_t, _n, v) in enumerate(samples) if ln(v) in program_lines), None)
    if first_prog is not None and any(ln(v) in routine_lines for _t, _n, v in samples[first_prog:]):
        gaps.append("a routine line after the program began — the phase order is not explained")
    for _t, n, v in samples:
        if ln(v) not in (None, 0) and ln(v) not in routine_lines and ln(v) not in program_lines and moving(v):
            gaps.append(f"a motion on line {ln(v)}, which no text names — not attributed (sample {n})")
            break
    first_l = next((i for i, (_t, _n, v) in enumerate(samples) if ln(v) == line), None)
    if first_l is None:
        if fails:
            return _row(case, "FAIL", fails[0], **measured)
        return _row(case, "incomplete", f"no sample of line {line}", **measured)
    last_r = max((i for i in range(first_l) if ln(samples[i][2]) in routine_lines), default=None)
    if last_r is None:
        # no routine sample: the boundary is not proven, so neither is an
        # entry — 2 and 4 are not judged (R311 FI-I41)
        gaps.append(f"no sample of the pre-measurement's routine before line {line} — the boundary is not proven")
        entry, zmax = [], None
    else:
        entry = samples[last_r + 1:first_l]
        # the step out of the routine counts: from its last known Z (FI-I40)
        zmax = kv(samples[last_r][2], 2)
        if zmax is None:
            gaps.append("Z at the routine's last sample not read — the step into the entry is not proven")
    for _t, n, v in entry:                                              # 2
        z = kv(v, 2)
        if z is None:
            continue
        if zmax is not None and z < zmax - STILL_POS:
            fails.append(f"a descent before line {line}: Z {z:.3f} below the earlier {zmax:.3f} (sample {n})")
            break
        zmax = z if zmax is None else max(zmax, z)
    _t0, n0, v0 = samples[first_l]                                      # 3
    x0, y0, z0 = kv(v0, 0), kv(v0, 1), kv(v0, 2)
    if (x0 is not None and abs(x0 - entry_xy[0]) > PATH_TOL) or (y0 is not None and abs(y0 - entry_xy[1]) > PATH_TOL):
        fails.append(f"line {line} started at X {x0} Y {y0}, not the entry X {entry_xy[0]:g} Y {entry_xy[1]:g}")
    if z0 is not None and z0 < safe_z - PATH_TOL:
        fails.append(f"line {line} started at Z {z0:.3f}, below the safe height")
    if None in (x0, y0, z0):
        gaps.append(f"line {line}'s first sample not read")
    measured["start"] = [x0, y0, z0]
    anchor = None                                                       # 4
    for i in range(len(entry) - STILL_BLOCK + 1):
        block = [v for _t, _n, v in entry[i:i + STILL_BLOCK]]
        if not all(all(kv(v, k) is not None for k in range(6)) and not moving(v) and kv(v, 7) == 1 for v in block):
            continue
        p0 = block[0]
        if any(abs(v[k] - p0[k]) > STILL_POS for v in block for k in (0, 1, 2)):
            continue
        if abs(p0[0] - entry_xy[0]) > PATH_TOL or abs(p0[1] - entry_xy[1]) > PATH_TOL or p0[2] < safe_z - PATH_TOL:
            continue
        anchor = i
        break
    if anchor is None:
        if last_r is not None:          # without a boundary its gap is already named
            gaps.append("no confirmed rest at the entry before the start")
    else:
        p0 = entry[anchor][2]
        measured["anchor_n"] = entry[anchor][1]
        for _t, n, v in entry[anchor:]:
            if moving(v) or any(kv(v, k) is not None and abs(v[k] - p0[k]) > STILL_POS for k in (0, 1, 2)):
                fails.append(f"moved after reaching the entry (sample {n})")
                break
    for _t, n, v in samples[first_l:]:                                  # 5
        if ln(v) != line:
            continue
        hit = [ax for k, ax in ((1, "Y"), (2, "Z")) if kv(v, k) is not None and kv(v0, k) is not None
               and abs(v[k] - v0[k]) > STILL_POS]
        if hit:
            fails.append(f"line {line} moved {hit[0]} (sample {n})")
            break
    if sec.get("problems"):
        gaps.append("the section: " + "; ".join(sec["problems"]))
    for nxt, fixed in ((line + 1, (0, 2)), (line + 2, (0, 1))):        # the mapping's self-check
        seg = [v for _t, _n, v in samples if ln(v) == nxt]
        if not seg:
            gaps.append(f"self-check: no sample of line {nxt}")
            continue
        b = seg[0]
        if any(kv(v, k) is not None and kv(b, k) is not None and abs(v[k] - b[k]) > STILL_POS
               for v in seg for k in fixed):
            gaps.append(f"self-check: line {nxt} moved an axis not its own — program-line not as expected")
    if fails:
        return _row(case, "FAIL", fails[0], **measured)
    if gaps:
        return _row(case, "incomplete", gaps[0], **measured)
    return _row(case, "PASS", f"line {line} started at the entry X/Y on the safe height, at rest since reaching it;"
                              " no earlier line moved", **measured)


# ── Step 3: the HAL latch (F-ESTOP S4/S4b, plan Codex R283–R285, R313–R316) ──
from test_support.servo import HB_IN, HB_OK, LATCH  # noqa: E402


def _bit(v, ch):
    return v[ch] if len(v) > ch and v[ch] in (0, 1) else None


def falling_edge(samples):
    """The assigned falling edge of the own outage: the index of the first
    sample with oneshot.0.out FALSE after a TRUE in the section — None
    without a TRUE before it or without a FALSE."""
    seen_true = False
    for i, (_t, _n, v) in enumerate(samples):
        ok = _bit(v, HB_OK)
        if ok == 1:
            seen_true = True
        elif ok == 0 and seen_true:
            return i
    return None


def eval_latch_same_cycle(case: str, sec: dict, delayed: bool = False) -> dict:
    """S4b: at the assigned falling edge of oneshot.0.out the servo-thread
    latch's fault-out is TRUE in the SAME sample (the sampler runs after
    oneshot.0 and webui-hb-latch in the same invocation), FALSE in every
    sample before it. No tolerance; a section problem, no TRUE before the
    edge or no edge: incomplete. `delayed` (the variant with webui-hb-latch
    moved before oneshot.0): PASS only for exactly one cycle late — FALSE at
    the edge, TRUE in the next sample; never a production PASS."""
    samples = sec.get("samples") or []
    measured = {"samples": len(samples), "delayed": delayed}
    if sec.get("problems"):
        return _row(case, "incomplete", "the section: " + "; ".join(sec["problems"]), **measured)
    e = falling_edge(samples)
    if e is None:
        return _row(case, "incomplete", "no falling edge of oneshot.0.out after a TRUE in the section", **measured)
    measured.update(edge_n=samples[e][1], edge_index=e)
    early = next((n for _t, n, v in samples[:e] if _bit(v, LATCH) != 0), None)
    if early is not None:
        return _row(case, "FAIL", f"fault-out not FALSE before the expiry (sample {early})", **measured)
    at = _bit(samples[e][2], LATCH)
    nxt = _bit(samples[e + 1][2], LATCH) if e + 1 < len(samples) else None
    measured.update(latch_at_edge=at, latch_next=nxt)
    if delayed:
        if at == 0 and nxt == 1:
            return _row(case, "PASS", f"the delayed order latched exactly one cycle late (sample {samples[e + 1][1]})",
                        **measured)
        return _row(case, "FAIL", f"the delayed order did not show the one-cycle delay (at the edge {at}, next {nxt})",
                    **measured)
    if at == 1:
        return _row(case, "PASS", f"fault-out TRUE in the sample oneshot.0.out fell (sample {samples[e][1]})",
                    **measured)
    return _row(case, "FAIL", "fault-out FALSE in the sample oneshot.0.out fell" +
                (" — one cycle late" if nxt == 1 else ""), **measured)


def eval_latch_sticky(case: str, sec: dict, reset_reply, trip_frames) -> dict:
    """S4: after the falling edge the heartbeat returns — edges on
    oneshot.0.in again, oneshot.0.out TRUE again — while fault-out stays TRUE
    to the section's end (a FALSE after it latched is a premature release:
    FAIL); the E-Stop Reset asked BEFORE the acknowledgement is refused
    (`reset_reply`: the reply, or {"ok": False, …} from a refusal) — an
    accepted one is a FAIL; a frame received after the resume shows the
    unacknowledged trip (`trip_frames`: the safety_trip of each frame
    received after the resume). No resume or no frame: incomplete."""
    samples = sec.get("samples") or []
    measured = {"samples": len(samples), "reset_reply": reset_reply}
    if sec.get("problems"):
        return _row(case, "incomplete", "the section: " + "; ".join(sec["problems"]), **measured)
    e = falling_edge(samples)
    if e is None:
        return _row(case, "incomplete", "no falling edge of oneshot.0.out after a TRUE in the section", **measured)
    latched = next((i for i in range(e, len(samples)) if _bit(samples[i][2], LATCH) == 1), None)
    if latched is None:
        return _row(case, "FAIL", "fault-out never TRUE after the expiry", **measured)
    released = next((samples[i][1] for i in range(latched, len(samples)) if _bit(samples[i][2], LATCH) != 1), None)
    if released is not None:
        return _row(case, "FAIL", f"fault-out released before the reset (sample {released})", **measured)
    if isinstance(reset_reply, dict) and reset_reply.get("ok") is not False:
        return _row(case, "FAIL", "E-Stop Reset was accepted before the trip was acknowledged", **measured)
    hb_back = next((i for i in range(e + 1, len(samples)) if _bit(samples[i][2], HB_OK) == 1), None)
    in_edges = [i for i in range(max(e, 1), len(samples)) if samples[i][2][HB_IN] != samples[i - 1][2][HB_IN]]
    measured.update(resume_index=hb_back, heartbeat_edges_after=len(in_edges))
    if hb_back is None or not in_edges:
        return _row(case, "incomplete", "the heartbeat did not return in the section", **measured)
    if not isinstance(reset_reply, dict):
        return _row(case, "incomplete", "the E-Stop Reset before the acknowledgement was not asked", **measured)
    if not trip_frames or not all(trip_frames):
        return _row(case, "incomplete" if not trip_frames else "FAIL",
                    "no frame after the resume" if not trip_frames else
                    "a frame after the resume showed no unacknowledged trip", **measured)
    return _row(case, "PASS", f"the heartbeat returned (sample {samples[hb_back][1]}), fault-out stayed TRUE, "
                "the reset before the acknowledgement was refused", **measured)


def eval_latch_recovered(case: str, sec: dict, frames) -> dict:
    """S4 recovery, its OWN section (acknowledge → arm → E-Stop Reset →
    Machine On): fault-out goes FALSE and stays FALSE to the section's end;
    the frames received after its start mark end with no unacknowledged trip,
    E-Stop clear and the machine on (`frames`: (safety_trip, is_estop,
    is_enabled) per frame). A broken or missing section: incomplete."""
    samples = sec.get("samples") or []
    measured = {"samples": len(samples)}
    if sec.get("problems") or not samples:
        return _row(case, "incomplete", "the recovery section: " + ("; ".join(sec.get("problems") or []) or "empty"),
                    **measured)
    cleared = next((i for i, (_t, _n, v) in enumerate(samples) if _bit(v, LATCH) == 0), None)
    if cleared is None:
        return _row(case, "FAIL", "fault-out stayed TRUE through the recovery", **measured)
    again = next((samples[i][1] for i in range(cleared, len(samples)) if _bit(samples[i][2], LATCH) != 0), None)
    if again is not None:
        return _row(case, "FAIL", f"fault-out TRUE again after the reset (sample {again})", **measured)
    measured["cleared_n"] = samples[cleared][1]
    if not frames:
        return _row(case, "incomplete", "no frame received in the recovery", **measured)
    trip, estop, enabled = frames[-1]
    measured["last_frame"] = {"safety_trip": trip, "is_estop": estop, "is_enabled": enabled}
    if trip or estop is not False or enabled is not True:
        return _row(case, "FAIL", "the last frame of the recovery is not clear and on", **measured)
    return _row(case, "PASS", f"fault-out FALSE from sample {samples[cleared][1]} to the end; no trip, E-Stop clear, "
                "machine on", **measured)


# ── Step 3: a client goes away, the program runs on (SYS-CONN.S4, plan Codex R313–R316) ──
from test_support import servo_time as st  # noqa: E402

DISC_WINDOW_NS = 2_000_000_000     # the run on after the event, at least
DISC_TRAVEL = 10.0                 # mm of X travel in it, at least (a reversal's halt allowed)
INTERP_IDLE, MODE_AUTO = 1, 2


def eval_disconnect(case: str, sec: dict, w_mark, event, frames_after, program_lines) -> dict:
    """SYS-CONN.S4: the gateway's OWN event for exactly this client — its
    disconnect or its heartbeat timeout (`event`, from the trace, bound to the
    client id) — is read, THEN the mark W is set: every W sample is captured
    after it. From W the program runs on for at least 2 s (the lower bound of
    the controller's periods, servo_time), X travels at least 10 mm, no trip
    (fault-out FALSE in the whole section), and the frames the remaining
    client B received after W show the interpreter running in AUTO.
    FAIL: a trip, a frame of B idle or out of AUTO, the motion ended in W
    (less travel, or program-line 0 and no motion after it to W's end).
    incomplete: no event, a section problem, no W, the time unproven or under
    2 s, no frame of B after W."""
    samples = sec.get("samples") or []
    measured = {"samples": len(samples), "event": event, "frames_after": len(frames_after or [])}
    if event is None:
        return _row(case, "incomplete", "no traced disconnect or timeout of this client", **measured)
    trip = next((n for _t, n, v in samples if _bit(v, LATCH) == 1), None)
    if trip is not None:
        return _row(case, "FAIL", f"a trip: fault-out TRUE (sample {trip})", **measured)
    if sec.get("problems"):
        return _row(case, "incomplete", "the section: " + "; ".join(sec["problems"]), **measured)
    a = (sec.get("phase_first") or {}).get(w_mark)
    if a is None:
        return _row(case, "incomplete", "no sample after the event's mark W", **measured)
    rng = st.proven(samples, sec.get("recv_ns") or {}, sec.get("t0_ns"))
    if not rng.get("ok"):
        return _row(case, "incomplete", f"the window's time unproven: {rng.get('why')}", **measured)
    w = samples[a:]
    xs = [v[0] for _t, _n, v in w if _f(v[0])]
    travel = sum(abs(b - c) for b, c in zip(xs[1:], xs))
    last_line0 = max((i for i, (_t, _n, v) in enumerate(w) if v[6] == 0), default=None)
    moved_after = last_line0 is not None and any(abs(w[k][2][0] - w[last_line0][2][0]) > 0.001
                                                 for k in range(last_line0, len(w)))
    measured.update(w_n=w[0][1], travel_mm=round(travel, 3))
    idle = next(((t, s) for t, s in frames_after or [] if s.get("interp_state") == INTERP_IDLE
                 or s.get("task_mode") not in (None, MODE_AUTO)), None)
    if idle is not None:
        return _row(case, "FAIL", f"the remaining client saw the program stop (interp {idle[1].get('interp_state')}, "
                    f"mode {idle[1].get('task_mode')})", **measured)
    if last_line0 is not None and not moved_after:
        return _row(case, "FAIL", f"the program stopped after the event (line 0 from sample {w[last_line0][1]}, "
                    "no motion after it)", **measured)
    dur = st.duration_lower(samples, rng, a, len(samples) - 1)
    measured["window_ns_lower"] = dur
    if dur is None or dur < DISC_WINDOW_NS:
        return _row(case, "incomplete", f"the window after the event is not proven 2 s long ({dur} ns)", **measured)
    if travel < DISC_TRAVEL:
        # a 2 s window proven: a running program at F6000 travels far more
        return _row(case, "FAIL", f"the motion ended after the event (X {travel:.1f} mm in ≥ 2 s)", **measured)
    if not frames_after:
        return _row(case, "incomplete", "no frame of the remaining client after the event", **measured)
    if any(_f(v[0]) and v[6] not in program_lines and v[6] != 0 for _t, _n, v in w):
        return _row(case, "incomplete", "a line in the window no program text names", **measured)
    return _row(case, "PASS", f"the program ran on for ≥ {dur / 1e9:.2f} s after the event, X {travel:.0f} mm, "
                "no trip; the remaining client saw it running", **measured)


# ── Step 3: many clients fetch the preview (SYS-CONN.S1, plan Codex R283, R313–R316) ──
PRE_POST_NS = 1_000_000_000        # the sections before and after the window, at least


def eval_clients(case: str, sec: dict, w_start, w_end, n: int, hellos, results, published) -> dict:
    """SYS-CONN.S1: while `n` unarmed protocol clients fetch /preview at once
    (behind a barrier) after a big program is loaded and published, the HAL
    heartbeat keeps its edges: every gap between edges of oneshot.0.in that
    touches the window [w_start, w_end) is judged by its bounds (servo_time,
    three ways: upper ≤ 250 ms PASS, lower > 250 ms FAIL, else incomplete);
    an edge before the window and one after it, the sections before and
    after ≥ 1 s (lower bound); fault-out never TRUE (a trip: FAIL). All n
    connections unarmed, all n fetches 200 with the same body, the expected
    program published — else incomplete (no n-client case was shown)."""
    samples = sec.get("samples") or []
    measured = {"n": n, "hellos": hellos, "fetches": results, "published": published, "samples": len(samples)}
    trip = next((s[1] for s in samples if _bit(s[2], LATCH) == 1), None)
    if trip is not None:
        return _row(case, "FAIL", f"a trip: fault-out TRUE (sample {trip})", **measured)
    if sec.get("problems"):
        return _row(case, "incomplete", "the section: " + "; ".join(sec["problems"]), **measured)
    if len(hellos or []) != n or any((h or {}).get("armed") is not False for h in hellos):
        return _row(case, "incomplete", f"not {n} unarmed connections", **measured)
    if len(results or []) != n or any(r.get("status") != 200 for r in results) or \
            len({r.get("sha256") for r in results}) != 1:
        return _row(case, "incomplete", f"not {n} fetches of one preview", **measured)
    if not (published or {}).get("ok"):
        return _row(case, "incomplete", "the expected program was not published", **measured)
    pf = sec.get("phase_first") or {}
    a1, a2 = pf.get(w_start), pf.get(w_end)
    if a1 is None or a2 is None:
        return _row(case, "incomplete", "the window's marks not in the section", **measured)
    rng = st.proven(samples, sec.get("recv_ns") or {}, sec.get("t0_ns"))
    if not rng.get("ok"):
        return _row(case, "incomplete", f"the time unproven: {rng.get('why')}", **measured)
    pre, post = st.duration_lower(samples, rng, 0, a1 - 1), st.duration_lower(samples, rng, a2, len(samples) - 1)
    measured.update(pre_ns=pre, post_ns=post)
    e = st.edges(samples, HB_IN)
    pairs = [(i, j) for i, j in zip(e, e[1:]) if j >= a1 and i < a2]
    judged = [(i, j, st.gap_bounds(samples, rng, i, j)) for i, j in pairs]
    verdicts = [st.judge(b) for _i, _j, b in judged]
    worst = max((b for _i, _j, b in judged if b), default=None, key=lambda b: b[0])
    measured.update(edges=len(e), pairs=len(pairs), worst_upper_ns=worst[0] if worst else None,
                    worst_lower_ns=max((b[1] for _i, _j, b in judged if b), default=None))
    if "FAIL" in verdicts:
        i, j, b = judged[verdicts.index("FAIL")]
        return _row(case, "FAIL", f"a heartbeat gap of at least {b[1] / 1e6:.1f} ms (samples {samples[i][1]}–"
                    f"{samples[j][1]})", **measured)
    if pre is None or post is None or pre < PRE_POST_NS or post < PRE_POST_NS:
        return _row(case, "incomplete", "the sections before and after the window are not proven 1 s", **measured)
    if not e or e[0] >= a1 or e[-1] < a2:
        return _row(case, "incomplete", "no heartbeat edge before the window or none after it", **measured)
    if "incomplete" in verdicts:
        i, j, b = judged[verdicts.index("incomplete")]
        return _row(case, "incomplete", f"a heartbeat gap not decided: {b}", **measured)
    return _row(case, "PASS", f"{n} clients, {len(pairs)} heartbeat gaps across the window, the longest "
                f"≤ {worst[0] / 1e6:.1f} ms", **measured)
