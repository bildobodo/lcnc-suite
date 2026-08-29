#!/usr/bin/env python3
"""Pure, dependency-light helpers shared by the gateway.

This module deliberately imports NOTHING from ``linuxcnc`` (or any other
machine-coupled binding) so it can be imported and unit-tested on a plain
developer machine — ``gateway.py`` itself does ``import linuxcnc`` at module
top and is therefore unimportable under pytest without the binding.

Keep this file pure: stdlib only, no side effects at import time.
"""

import json
import math
import os
import re
import tempfile
import hmac
from urllib.parse import urlsplit
from typing import Iterable, Optional


# File-upload allow-list. Lives here (not gateway.py) so validate_extension is
# self-contained and testable.
ALLOWED_EXTENSIONS = {".ngc", ".nc", ".gcode", ".tap", ".txt"}

# Preview wire-format generation. Single source for the parse worker (stamps
# every payload as `preview_schema` + a `__SCHEMA__\t<n>` stderr line), the
# gateway poller (auto-reparses a published payload whose stamp disagrees with
# the schema this process was started with), and — mirrored as
# EXPECTED_PREVIEW_SCHEMA in ws/bulkData.ts — the client, which banners a
# payload with an absent or different stamp and offers Reparse. The stamp
# exists because the gateway cache keys on file+mtime only: a gateway process
# that outlives a code upgrade keeps serving pre-upgrade payloads to
# hot-reloaded clients with nothing saying so. Absence ≡ legacy payload,
# bannered — never silently accepted. Bump on EVERY preview wire-shape change
# (adding/removing/renaming fields or changing field semantics), and bump the
# client constant in the same commit.
#
# Log: 1 = stamp introduced (W2 P1); 2 = feed_abc/rapid_abc ship on
# pose-dependence (should_ship_abc), not only on a peeled-stream sweep (W2
# P3 — a pre-2 payload of a TWP program lacks the abc channel entirely);
# 3 = parse_tlos snapshot rides the wire and the gateway auto-reparses on
# tool-table drift (W2 P4 — pre-3 payloads keep per-line limit flags baked
# with a re-measured-away tool length); 4 = per-point line trust
# (feed_lineok/rapid_lineok) + subroutine spans (feed_sub/rapid_sub +
# sub_names), and lines_untrusted means "NO point trusts" instead of "any
# point is doubtful" (W2 P6 — pre-4 payloads disable the whole run
# highlight the moment one subroutine call appears); 5 = uncommanded
# rotaries rebased to the LIVE machine pose (the offline interp assumed
# program-zero of the active fixture — a pre-5 TWP payload can pose a
# parked rotary a whole fixture-offset wrong; the bump forces warm caches
# to reparse the wrong pose away); 6 = suppressed first-move endpoints ship
# as zero-length unknown-start rapids (`rapid_ustart`, W3 P1) plus the
# `unmarked_subs` advisory (W3 P5) — pre-6 the program's own first rapid
# vanished entirely, so the sim entry lerped straight to remap-internal
# motion (the collapsed two-stage TWP approach) and preamble kins flips
# fell before the first recorded segment (the 962 mm phantom); 7 =
# call-site line attribution (`feed_cline`/`rapid_cline` u16, W4): points
# inside a marked sub span whose UNIQUE main-file call/trigger line is
# text-verified carry that line, so the highlight tracks the o-call or
# remap trigger instead of going dark — pre-7 payloads show chip-only.
PREVIEW_SCHEMA = 7


def sanitize_filename(name: str) -> str:
    name = os.path.basename(name)
    name = name.replace("\x00", "")
    name = name.lstrip(".")
    if not name:
        name = "uploaded.ngc"
    return name


def validate_extension(filename: str) -> bool:
    _, ext = os.path.splitext(filename)
    return ext.lower() in ALLOWED_EXTENSIONS


def validate_path_within(path: str, root: str) -> bool:
    # realpath resolves symlinks on BOTH the candidate and the root (issue #20).
    # Resolving the root too keeps an intentionally symlinked NC-files root
    # working (a common setup), while a symlink *inside* the root that points
    # outside now resolves out and is correctly rejected. realpath also collapses
    # `..`, and on a not-yet-existing upload target it resolves the existing
    # parent and appends the literal tail — exactly what containment needs.
    real_path = os.path.realpath(path)
    real_root = os.path.realpath(root)
    return real_path == real_root or real_path.startswith(real_root + os.sep)


def token_ok(presented: Optional[str], configured: str) -> bool:
    """Constant-time pre-shared-token check.

    When no token is configured (empty string) auth is disabled and every
    caller is allowed — this keeps loopback/dev setups frictionless. When a
    token IS configured, the caller must present a matching one.
    """
    if not configured:
        return True  # auth disabled
    if not presented:
        return False
    return hmac.compare_digest(str(presented), str(configured))


def _origin_host_matches(origin: str, host: Optional[str]) -> bool:
    """True if the Origin header's host[:port] equals the request Host header."""
    if not host:
        return False
    netloc = urlsplit(origin).netloc
    return bool(netloc) and netloc.lower() == host.lower()


def origin_allowed(
    origin: Optional[str],
    host: Optional[str],
    allowlist: Optional[Iterable[str]] = None,
    extra_allowed: Optional[Iterable[str]] = None,
) -> bool:
    """Decide whether a WebSocket/CORS Origin is acceptable.

    Policy (Origin defends against *browser* drive-by; the token is the real
    gate for everything else):

    - No Origin header  → allow. Browsers ALWAYS send Origin on WS handshakes,
      so a missing one means a non-browser client, which the token gates.
    - Same host as the request (Origin host[:port] == Host header) → allow.
      This is the gateway's own served page on whatever LAN IP was browsed to,
      and needs no configuration.
    - Origin listed in the explicit allowlist or dev extras → allow.
    - Otherwise → reject.

    The explicit allowlist ADDS to the same-host default rather than replacing
    it, so configuring it can never lock out the gateway's own page.
    """
    if not origin:
        return True
    if _origin_host_matches(origin, host):
        return True
    if allowlist and origin in set(allowlist):
        return True
    if extra_allowed and origin in set(extra_allowed):
        return True
    return False


def finite_float(x, default=0.0, lo=None, hi=None) -> float:
    """float() that rejects NaN/Infinity and (optionally) out-of-range values.

    Used for machine-motion values (velocity, distance, override scale, tool
    offsets) where a non-finite number is dangerous — and silently dangerous,
    since ``float("inf")`` does NOT raise and would otherwise flow straight into
    the tool table or a motion command. Raises ValueError/TypeError on bad input
    so the dispatch-boundary handler can turn it into a structured error reply.
    """
    if x is None:
        x = default
    v = float(x)
    if not math.isfinite(v):
        raise ValueError(f"non-finite numeric value: {x!r}")
    if lo is not None and v < lo:
        raise ValueError(f"value {v} below minimum {lo}")
    if hi is not None and v > hi:
        raise ValueError(f"value {v} above maximum {hi}")
    return v


def finite_int(x, default=None, lo=None, hi=None) -> int:
    """int() that rejects NaN/Infinity, missing values, and out-of-range values.

    A bare ``int()`` on a websocket field is unsafe in two ways the dispatch
    boundary does not cover: JSON can deliver ``inf`` (``json.loads("1e999")``)
    and ``int(inf)`` raises OverflowError (NOT caught by the boundary, so it
    tears the socket down); and ``int(None)`` on a missing field silently
    becomes a default elsewhere. This coerces safely and raises ValueError on
    anything non-finite, missing, non-numeric, or outside ``[lo, hi]``.

    Unlike :func:`finite_float`, a ``None`` value with no explicit ``default``
    is an error (missing required field) rather than ``0`` — so callers cannot
    accidentally turn an absent axis/joint into index 0. Floats are truncated
    toward zero (``int(1.9) == 1``), matching prior bare-``int()`` behaviour.
    """
    if x is None:
        if default is None:
            raise ValueError("missing required integer value")
        x = default
    f = float(x)
    if not math.isfinite(f):
        raise ValueError(f"non-finite integer value: {x!r}")
    v = int(f)
    if lo is not None and v < lo:
        raise ValueError(f"integer {v} below minimum {lo}")
    if hi is not None and v > hi:
        raise ValueError(f"integer {v} above maximum {hi}")
    return v


def evaluate_trip_latch(fault_latched, last_latched, baseline_seen) -> dict:
    """Pure state machine deriving the operator trip banner from the HAL latch.

    Issue #34: the heartbeat trip latch now lives in HAL (``estop_latch`` in the
    servo thread) so it latches in the same ~1 ms cycle as the trip, instead of
    a 100 ms Python poller that loses the race against a ~1 ms oneshot re-arm and
    can silently auto-recover from ESTOP. The gateway therefore reads the latch
    *level* (``webui-hb-latch.fault-out``, TRUE while latched) rather than a
    poller-incremented counter.

    Because the level is sticky and read by a poller that can itself be frozen,
    we edge-detect it, with one wrinkle: the latch boots faulted (LinuxCNC starts
    in ESTOP), so a first-seen TRUE is ambiguous (fresh boot vs. a trip that
    occurred while the gateway was absent). We surface that honestly as a
    ``faulted_on_connect`` audit signal but do NOT raise the operator banner for
    it — the real ESTOP state is already visible via STAT. Only a clean
    FALSE→TRUE transition *after* a known-good baseline is a bannered trip.

    Args:
        fault_latched: current latch level — ``True``/``False``, or ``None`` when
            the reader has pushed no snapshot yet (no data → no decision).
        last_latched: previously observed level (``None`` if none yet).
        baseline_seen: have we ever observed the latch *clear* (level ``False``)?

    Returns a dict the caller applies verbatim:
        ``tripped``            — a fresh trip just occurred → set the banner.
        ``faulted_on_connect`` — first-sight TRUE (boot/absent ambiguity) → emit
                                 an audit trace, no banner.
        ``last_latched`` / ``baseline_seen`` — carry forward to the next call.
    """
    out = {
        "tripped": False,
        "faulted_on_connect": False,
        "last_latched": last_latched,
        "baseline_seen": baseline_seen,
    }
    if fault_latched is None:
        return out  # reader has no snapshot yet — make no decision
    if not fault_latched:
        # Latch clear — establish/refresh the known-good baseline.
        out["last_latched"] = False
        out["baseline_seen"] = True
        return out
    # fault_latched is True from here.
    out["last_latched"] = True
    if not baseline_seen and not last_latched:
        # First time we see the latch, and we never saw it clear: ambiguous
        # boot-faulted vs. tripped-while-absent. Audit it; do not banner.
        out["faulted_on_connect"] = True
    elif baseline_seen and not last_latched:
        # Clean FALSE→TRUE after a known-good baseline = a genuine trip.
        out["tripped"] = True
    # else: already latched (no change) — no banner.
    return out


def resolve_loaded_file(raw_file, interp_idle: bool, prev, prev_seen: bool = True):
    """Pure resolver for the "loaded program" the UI should report.

    ``STAT.file`` follows the interpreter's *currently open* file, which flips
    to subroutine paths mid-execution (M6 remap → tool_touch_off.ngc, o-word
    CALLs into probe routines, …) and back again. Mirroring it raw made the
    poller's file-change edge re-parse the subroutine as if the operator had
    loaded it — replacing the preview, G-code text, and stats mid-run (the
    "Stats button vanishes while running" bug) and paying two full re-parses
    of the main program per tool change.

    A file can only be legitimately (un)loaded while the interpreter is idle
    (task + gateway both reject loads during AUTO), so: accept ``raw_file``
    only when ``interp_idle`` — otherwise hold ``prev`` and report the ignored
    flip so the caller can trace it (no silent decisions).

    Args:
        raw_file: current ``STAT.file`` ("" and None both mean "none").
        interp_idle: interpreter is idle (a ``None`` interp_state should be
            passed as idle — no data → keep the legit-load path open).
        prev: previously resolved loaded file (``None`` = no file loaded).
        prev_seen: whether ``prev`` is an established baseline. False only on
            the very first poll (gateway restarted, possibly under a running
            program): adopt raw rather than showing nothing; it self-corrects
            to the main file at the next idle tick. Must be True afterwards —
            ``prev is None`` then honestly means "no file loaded" and is held
            through busy states like any other value (an MDI o-word probe with
            no program loaded must not adopt the probe sub as loaded file).

    Returns ``(loaded_file, flip_ignored)`` — ``flip_ignored`` is the raw
    value we refused to adopt, or ``None`` when nothing was ignored.
    """
    f = raw_file or None
    if interp_idle or not prev_seen:
        return f, None
    return prev, (f if f != prev else None)


def atomic_write_bytes(path: str, data: bytes, fsync: bool = False) -> None:
    """Atomically write ``data`` to ``path`` via tempfile + os.replace.

    Cleans up the temp file if anything fails. Used everywhere we persist user
    data (settings, tool table, var file, uploads); the atomic primitive stays
    single-purpose, with caller-side text/JSON encoding done before the call.

    ``fsync=True`` flushes the data to stable storage before the rename, so a
    crash/power-loss can't leave the renamed file pointing at unflushed (zeroed)
    blocks — required for durable atomic publication of machine-control files.
    fsync blocks on the disk, so on-event-loop callers must run this via an
    executor (``run_in_executor``/``to_thread``); the default stays ``False`` so
    small/offloaded callers don't pay for it unasked.
    """
    dir_name = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            if fsync:
                f.flush()
                os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass  # safe-silent: best-effort temp cleanup, already-gone is fine
        raise


# ---- Browser telemetry ingestion (M1: pure, bounded validation) ----

TELEMETRY_BODY_MAX = 256 * 1024   # bytes — far above legit ~1 KB/s/tab batches
TELEMETRY_EVENTS_MAX = 500        # events per batch


def parse_telemetry_batch(raw: bytes, max_events: int = TELEMETRY_EVENTS_MAX):
    """Parse an untrusted NDJSON telemetry batch into (kind, fields) pairs.

    Pure and bounded: a malformed line is dropped (counted, not 500'd), a
    non-object line is dropped, and events beyond ``max_events`` are rejected —
    a hostile or buggy client can't expand one POST into unbounded parse work.
    The caller owns transport concerns (body-size cap, peer labeling, trace
    emission). Returns ``(events, rejected)`` with events as
    ``list[(kind, fields_dict)]``; ``kind`` falls back tag → "event".
    """
    events = []
    rejected = 0
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if len(events) >= max_events:
            rejected += 1
            continue
        try:
            evt = json.loads(line)
        except Exception:
            rejected += 1
            continue
        if not isinstance(evt, dict):
            rejected += 1
            continue
        kind = str(evt.get("kind") or evt.get("tag") or "event")
        fields = {k: v for k, v in evt.items() if k not in ("kind", "tag")}
        events.append((kind, fields))
    return events, rejected


# ---- Textual tool-change scan (program stats) ----
#
# Python port of the frontend's scanToolchangesBefore word matchers
# (lcnc-webui/src/gcodeRfl.ts) applied to the WHOLE program: M6, and this
# machine's remapped M600/M601, all count as tool changes. M0*6 must not match
# M60/M66/M600 — (?!\d) guards the tail; M600/M601 are removed before the M6
# test so RE_M6 needs no lookahead gymnastics.

_RE_TC_M600 = re.compile(r"(?<![A-Z0-9.])M0*60[01](?!\d)", re.IGNORECASE)
_RE_TC_M6 = re.compile(r"(?<![A-Z0-9.])M0*6(?!\d)", re.IGNORECASE)
_RE_TC_T = re.compile(r"(?<![A-Z0-9.])T0*(\d+)(?!\d)", re.IGNORECASE)
_RE_TC_PAREN = re.compile(r"\([^)]*\)")


def scan_tool_stats(text: str):
    """Count tool-change statements (M6 / M600 / M601) in program text.

    Returns ``(changes, tools)`` — total change count and the set of T numbers
    in modal effect at each change (T0 = unload is counted as a change but not
    a tool, matching PreviewCanon.change_tool). A change whose T number is
    unknown (no T word yet, or a T[expr]/T#var the scanner can't evaluate)
    still counts but contributes no tool.
    """
    changes = 0
    tools = set()
    pending = None  # last T word seen (modal prepare), None = unknown
    for raw in text.splitlines():
        if "T" not in raw and "t" not in raw and "M" not in raw and "m" not in raw:
            continue
        semi = raw.find(";")
        line = raw if semi == -1 else raw[:semi]
        line = _RE_TC_PAREN.sub(" ", line)
        if not line.strip():
            continue
        t_words = _RE_TC_T.findall(line)
        if t_words:
            pending = int(t_words[-1])
        hits = len(_RE_TC_M600.findall(line))
        hits += len(_RE_TC_M6.findall(_RE_TC_M600.sub(" ", line)))
        if hits:
            changes += hits
            if pending:
                tools.add(pending)
    return changes, tools


# ---------------------------------------------------------------------------
# Per-line soft-limit validation (Stage 1 of the offline dry run).
#
# Pure so it unit-tests without linuxcnc: the parse worker feeds it canon
# segments + INI limits; the result rides the preview wire to the G-code
# panel as line-anchored violation markers.
# ---------------------------------------------------------------------------

AXIS_LETTERS = "XYZABCUVW"
_ROTARY_AXES = frozenset("ABC")

# Float-noise guard in machine units (mm/inch for linear, degrees for rotary).
# Canon trig can land ~1e-9 past an exactly-at-limit move; 1e-6 is far below
# any physical resolution while never masking a real overtravel.
_LIMIT_EPS = 1e-6


def canonical_to_joint_order(values, axis_mask):
    """Re-index a CANONICAL per-axis array into trivkins JOINT order.

    STAT's offset vectors (g5x_offset, g92_offset, tool_offset) and
    position/actual_position are canonical 9-wide: X Y Z A B C U V W at
    fixed indices. joint_actual_position is JOINT-indexed: the machine's
    configured axes in ascending canonical order (= [TRAJ]COORDINATES for
    trivkins), compacted. On XYZAC the two layouts agree through A and
    silently diverge at C (joint 4, canonical 5); on XYZBC both rotaries
    land wrong (B: joint 3 vs canonical 4). Mixing them subtracted B's
    work offset from C's angle — the "Zero B does nothing" bug.

    Returns a list with one element per set axis_mask bit (ascending),
    values pulled from their canonical slots (0.0 when absent). None in →
    None out.
    """
    if values is None:
        return None
    out = []
    for ci in range(9):
        if axis_mask & (1 << ci):
            out.append(float(values[ci]) if ci < len(values) else 0.0)
    return out


def rs274_effective_xy_offset(g5x_x, g5x_y, g92_x, g92_y, rotation_deg):
    """Single post-rotation XY offset equivalent to RS274's offset order.

    rs274.interpret.Translated.rotate_and_translate (the interpreter's own
    preview canon, and the semantics the running interp applies) is:

        machine = g5x + Rz(theta) . (program + g92)

    i.e. g92 is applied BEFORE the rotation, g5x after. Folding that into a
    single post-rotation offset gives  o = g5x + Rz(theta) . g92 , so that

        machine = o + Rz(theta) . program
        program = Rz(-theta) . (machine - o)

    hold exactly. The naive o = g5x + g92 (what this codebase used before)
    deviates by (Rz(theta) - I) . g92 whenever G92 and G10 L2 R rotation
    are both active. Z and rotary axes are never rotated — plain sums stay
    correct there. Pure; unit-tested against rotate_and_translate itself.

    Returns (ox, oy) in the same units as the inputs.
    """
    th = math.radians(rotation_deg or 0.0)
    c, s = math.cos(th), math.sin(th)
    return (g5x_x + g92_x * c - g92_y * s,
            g5x_y + g92_x * s + g92_y * c)


def evaluate_safety_chain(grace_expired, watchdog_connected, reader_fresh,
                          trip_latched_present, extra_reason=None):
    """Suite safety-chain completeness -> None (healthy/indeterminate) or a
    reason string for the operator banner.

    Closes the review's worst silent gap: a config missing lcnc_webui.hal
    runs completely normally with the advertised safety chain absent —
    heartbeats are dropped on the floor (hal_bridge send with no socket)
    and the only witness was a trace.ndjson line. Detections:

    - watchdog socket down: hal_watchdog.py (webui-safety) isn't reachable,
      so gateway heartbeats reach nothing. The heartbeat loop retries the
      connect continuously, making this a live, self-healing indicator.
    - trip latch absent: the reader snapshot is FRESH but has no
      trip_latched field — webui-hb-latch (the servo-thread estop_latch,
      #34) isn't loaded, so a heartbeat stall would trip nothing. Only
      asserted on a fresh snapshot: a stale/absent reader is its own
      banner (reader_stale), not evidence about the latch.
    - extra_reason: caller-supplied (e.g. the one-shot estop-loop
      writer check) — appended verbatim.

    grace_expired must be False during startup (processes come up
    concurrently); the helper returns None then. Pure; unit-tested.
    """
    if not grace_expired:
        return None
    reasons = []
    if not watchdog_connected:
        reasons.append("watchdog (webui-safety) not connected — heartbeat "
                       "safety inactive")
    if reader_fresh and not trip_latched_present:
        reasons.append("trip latch (webui-hb-latch) not in HAL — stall "
                       "would not trip ESTOP")
    if extra_reason:
        reasons.append(extra_reason)
    return "; ".join(reasons) if reasons else None


def unwritten_estop_signal(signals, name="estop-loop"):
    """Detect the stuck-in-ESTOP trap: `name` exists with NO writer pin.

    lcnc_webui.hal nets the sim's `estop-loop` signal into the enable
    chain (and2.0.in0). On a real config whose e-stop signal is named
    differently, HAL silently creates a NEW unwritten `estop-loop` —
    permanently FALSE — and the machine can never leave ESTOP with no
    message saying why. `signals` is the gateway's parsed
    `halcmd -s show sig` topology ({"name", "pins": [{"arrow", "pin"}]}):
    arrow "<==" marks a writer. Returns a reason string, or None when the
    signal is absent (user rewired it — their chain, their names) or has
    a writer. Pure; unit-tested.
    """
    for sig in signals or []:
        if sig.get("name") == name:
            if any(p.get("arrow") == "<==" for p in sig.get("pins", [])):
                return None
            return (f"'{name}' signal has no writer — e-stop input stuck "
                    f"FALSE (wire your machine's e-stop into it, or adapt "
                    f"lcnc_webui.hal)")
    return None


_KINS_FAMILY = {
    "trivkins": "trivkins",
    "xyzac-trt-kins": "xyzac-trt",
    "xyzbc-trt-kins": "xyzbc-trt",
    # upstream TWP machine (TCP+TWP plan phase 3): halcompiled from the
    # comp vendored at scripts/kins_oracle/xyzacb_trsrn.comp
    "xyzacb_trsrn": "xyzacb-trsrn",
}
_KINS_PARAM_PINS = (
    "x-rot-point", "y-rot-point", "z-rot-point",
    "x-offset", "y-offset", "z-offset",
)
# xyzacb_trsrn static geometry (NOT tool-offset-z: that pin is netted from
# motion.tooloffset.z - live TLO, carried as wcs.tool by the client).
# Snake_cased these become the TrsrnParams keys the twins consume.
_TRSRN_PARAM_PINS = (
    "y-pivot", "z-pivot", "x-offset", "y-offset",
    "y-rot-axis", "z-rot-axis", "nut-angle",
)


def parse_kins_config(kinematics_value, halcmd_values):
    """[KINS]KINEMATICS + [HAL]HALCMD lines -> viewer kins declaration.

    Single-source rule (v2 trunnion lesson): the INI already names the kins
    module and sets its pivot pins — machine.json never duplicates either.
    Parses the module token, the switchkins `sparm=identityfirst` flag
    (startup mode is identity => the whole-track preview stays trivkins
    until phase 2's per-segment modes), and any static pivot params set by
    direct `setp <module>.<pin> <value>` HALCMD lines.

    Deliberately NOT parsed: `tool-offset` — on real configs it is netted
    from motion.tooloffset.z (live TLO, already carried as wcs.tool by the
    client transform; a static copy here would double-count), and any pin
    driven via net/sets signals (dynamic by definition). Unknown modules
    ship verbatim as type=module so the client can refuse LOUDLY rather
    than silently posing trivkins.

    Returns None when kinematics_value is None/empty; otherwise
    {"module", "type", "identity_first", "params"} (params values float,
    machine units). Pure; unit-tested.
    """
    if not kinematics_value:
        return None
    tokens = str(kinematics_value).split()
    module = tokens[0]
    identity_first = any(
        t.startswith("sparm=") and "identityfirst" in t for t in tokens[1:]
    )
    ktype = _KINS_FAMILY.get(module, module)
    params = {}
    if ktype == "xyzacb-trsrn":
        # the trsrn comp creates its pins under "<module>_kins." (its C
        # body prefixes the comp name), unlike trt where prefix == module
        prefix = module + "_kins."
        param_pins = _TRSRN_PARAM_PINS
    else:
        prefix = module + "."
        param_pins = _KINS_PARAM_PINS
    for line in halcmd_values or []:
        parts = str(line).split()
        if len(parts) != 3 or parts[0] != "setp" or not parts[1].startswith(prefix):
            continue
        pin = parts[1][len(prefix):]
        if pin not in param_pins:
            continue
        try:
            params[pin.replace("-", "_")] = float(parts[2])
        except ValueError:
            continue
    return {
        "module": module,
        "type": ktype,
        "identity_first": identity_first,
        "params": params,
    }


def wcs_basis_terms(basis):
    """(g5x9, g929, rotation_deg) -> (ox, oy, oz, oa, ob, oc, theta_deg).

    The offset the preview extraction subtracts from every canon endpoint. XY
    goes through rs274_effective_xy_offset (g5x + Rz(theta)*g92 — a plain sum
    deviates when G92 and a G10 R rotation are both active, which the rs274
    golden fixtures pin); the remaining axes are plain sums, and theta rides
    along because the extraction also un-rotates XY by it.

    `basis` is what PreviewCanon.wcs_basis() returns, in CANON units (inches);
    the caller applies unit_scale to the resulting coordinates, not to these
    terms — same as the endpoints they are subtracted from. Pure.
    """
    g5x, g92, theta_deg = basis
    ox, oy = rs274_effective_xy_offset(g5x[0], g5x[1], g92[0], g92[1], theta_deg)
    return (ox, oy,
            g5x[2] + g92[2],      # Z
            g5x[3] + g92[3],      # A
            g5x[4] + g92[4],      # B
            g5x[5] + g92[5],      # C
            theta_deg)


_KINSTYPE_MARKER = re.compile(r"^\s*WEBUI_KINSTYPE\s*=\s*(\d+)\s*$", re.IGNORECASE)


def parse_kinstype_marker(text):
    """Comment text -> switchkins-type value, or None if not a marker.

    Convention (TCP+TWP plan phase 2): the switchkins toggle remaps emit
    `(WEBUI_KINSTYPE=<n>)` right where they set motion.switchkins-type —
    the component that PERFORMS the switch announces it. Comments are the
    one channel the preview canon receives in execution order (remapped
    M-codes never appear in active mcodes; M68 is swallowed by the C
    preview canon), and they are silent in task. Programs/configs that
    switch kins without the marker are invisible to the preview — tracked
    honestly as "no mode data" (absent wire fields), never guessed.
    """
    m = _KINSTYPE_MARKER.match(text or "")
    return int(m.group(1)) if m else None


_TWPFRAME_MARKER = re.compile(
    r"^\s*WEBUI_TWPFRAME\s*=\s*"
    r"([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*$",
    re.IGNORECASE)


def parse_twpframe_marker(text):
    """Comment text -> (pre_rot_rad, primary_deg, secondary_deg), or None.

    TCP+TWP plan phase 3: the forked TWP remap's g53x_core emits
    `(WEBUI_TWPFRAME=p,t1,t2)` right where it set_p's the kins comp's
    pre-rot / primary-angle / secondary-angle pins - the three values
    that pin the TOOL-kins (case 2) plane frame. Units mirror the pins
    (and the upstream remap's own asymmetry): pre-rot RADIANS,
    primary/secondary DEGREES - exactly the TrsrnParams the twins take.
    Same execution-ordered comment channel as WEBUI_KINSTYPE. Pure.
    """
    m = _TWPFRAME_MARKER.match(text or "")
    if not m:
        return None
    try:
        return (float(m.group(1)), float(m.group(2)), float(m.group(3)))
    except ValueError:
        return None


def kins_type_flags(seqs, events):
    """Per-segment RAW switchkins type from execution-ordered marker events.

    `seqs`: segment sequence numbers (any order); `events`: [(seq_at_marker,
    kinstype)] as recorded by the canon — a marker seen at canon seq N
    applies to segments with seq > N. Startup kinstype is 0 (switchkins
    boot default). Two markers can share a seq (back-to-back toggles with
    no motion between): the LAST recorded one governs, so the sort must
    key on seq alone — a plain tuple sort would reorder same-seq events by
    kinstype. Returns raw type ints aligned with `seqs` — the wire ships
    these (phase 3: type 1/TCP and type 2/TOOL have DIFFERENT joint
    mappings on trsrn, so a world/identity bool is not enough). Pure.
    """
    evs = sorted(events, key=lambda e: e[0])
    out = []
    for s in seqs:
        k = 0
        for es, ek in evs:
            if es < s:
                k = ek
            else:
                break
        out.append(k)
    return out


def kins_world_flags(seqs, events, identity_first):
    """Per-segment world-mode flags (trt families) from marker events.

    Mapping (matches the kins module's sparm semantics): identity_first
    => type 1 is the world kins; plain => type 0 is. Type 2 (userk)
    defaults to identity math in the stock trt template — treated as
    identity. Thin wrapper over kins_type_flags. Returns 0/1 ints
    aligned with `seqs`. Pure.
    """
    return [1 if (k == 1 if identity_first else k == 0) else 0
            for k in kins_type_flags(seqs, events)]


def kins_frame_indices(seqs, frame_events):
    """Per-segment index into the TWP frame list, or None when no frame
    governs yet.

    `frame_events`: canon.kins_frames [(seq_at_marker, pre_rot, th1, th2)]
    in recorded order — the wire ships this list verbatim, so consumers
    key segments to frames by INDEX. Same resolution convention as the
    type markers (an event at seq N governs segments with seq > N; two
    events on one seq: the last recorded wins — sort keys on seq alone).
    A type-2 segment resolving to None is the bare-M430 case: the plane
    frame lives only in the kins pins, unknowable to a parse — those
    segments are counted UNCHECKED, never guessed. Pure.
    """
    evs = sorted(range(len(frame_events)), key=lambda i: frame_events[i][0])
    out = []
    for s in seqs:
        idx = None
        for i in evs:
            if frame_events[i][0] < s:
                idx = i
            else:
                break
        out.append(idx)
    return out


def kins_nonidentity_flags(types, kins_cfg):
    """Per-segment 'this is NOT the identity kins' flags, family-aware.

    The identity mapping is a property of the kins MODULE: trt families
    follow sparm (world = type 1 under identityfirst, else type 0; userk
    type 2 = identity in the stock template); xyzacb-trsrn boots identity
    as type 0 with types 1 (TCP) and 2 (TOOL) both non-identity — with
    DIFFERENT math, which is why the wire carries raw types. Consumers:
    identity-side limit check exclusion, and the unchecked-segment count
    for declared kins without a routed twin. Pure.
    """
    if kins_cfg and kins_cfg.get("type") == "xyzacb-trsrn":
        return [1 if t != 0 else 0 for t in types]
    idf = bool(kins_cfg and kins_cfg.get("identity_first"))
    return [1 if (t == 1 if idf else t == 0) else 0 for t in types]


def kins_marker_policy(kins_cfg):
    """What `(WEBUI_KINSTYPE=n)` markers mean under the declared kins.

    'ignore'    — trivkins or no [KINS] declaration: the machine cannot
                  switch kins, so markers are stale noise (a program
                  written for a TCP machine, or a hand-typed comment).
                  Emitting mode flags here would gut the identity limit
                  check and mislabel the whole track (startup type 0 maps
                  to "world" without sparm=identityfirst).
    'twin'      — a joint-side twin exists (trt families, xyzacb-trsrn):
                  full world/non-identity limit checking. (trsrn still
                  reports its frameless type-2 segments — bare M430 —
                  as an unchecked count.)
    'unchecked' — a declared non-trivial module without a twin: the
                  switches are real, so mode flags ship, but world
                  segments cannot be limit-checked and must be reported
                  as an explicit unchecked count, never as clean. Pure.
    """
    if kins_cfg is None or kins_cfg.get("type") == "trivkins":
        return "ignore"
    ktype = kins_cfg.get("type")
    return "twin" if (ktype in _TRT_LETTERS or ktype == "xyzacb-trsrn") else "unchecked"


def kins_pivot_warning(kins_cfg):
    """Reason string when a kins with a twin is declared without the full set
    of geometry pins parsed from [HAL]HALCMD (review D4).

    parse_kins_config reads setp lines from the INI's [HAL]HALCMD ONLY —
    the normal .hal-file `setp xyzac-trt-kins.y-offset …` idiom configures
    the real kins but is invisible here, so the viewer's TCP math would
    silently run with every pivot at zero. A machine genuinely pivoted at
    the origin silences this with explicit `HALCMD = setp … 0` lines.

    PARTIAL sets are reported too, and that is the load-bearing half:
    parse_kins_config skips any pin name it does not recognise, so ONE
    misspelling parses as ABSENT and the twin quietly substitutes 0. On the
    trsrn machine a mistyped `nut-angle` collapses the entire nutating
    solution with nothing else wrong anywhere — the all-or-nothing check
    that used to live here could not see it.

    None when the full expected set is present or the kins has no twin. Pure.
    """
    if not kins_cfg or kins_marker_policy(kins_cfg) != "twin":
        return None
    module = kins_cfg.get("module")
    params = kins_cfg.get("params") or {}
    expected = (_TRSRN_PARAM_PINS if kins_cfg.get("type") == "xyzacb-trsrn"
                else _KINS_PARAM_PINS)
    missing = [p for p in expected if p.replace("-", "_") not in params]
    if not missing:
        return None
    if not params:
        return (f"{module} declared but no pivot setp lines in "
                f"[HAL]HALCMD — viewer TCP math would use pivot zeros; put the "
                f"setp lines in the INI (README: 5-Axis and TCP)")
    return (f"{module}: [HAL]HALCMD sets only {len(params)} of {len(expected)} "
            f"kins geometry pins — missing {', '.join(missing)}. A misspelled "
            f"pin name parses as ABSENT and the viewer substitutes 0; set every "
            f"pin explicitly, including the ones that are 0")


def rotary_model_warning(axes, kinematics):
    """Reason string when the machine has rotary axes but the viewer model
    articulates none of them (review D5).

    The silently-wrong-3D case: a rotary config left on the default 3-axis
    model shows correct DRO numbers while the backplot/toolpath ride a
    workGroup that never rotates. `axes` is the viewer_init letter list
    (from axis_mask); `kinematics` is machine.json's entry list (absent
    `type` means translate). None when consistent — including the
    no-rotary machine and the model that articulates at least one rotary
    (partial models are a deliberate-simplification judgment call, not a
    provable misconfig). Pure.
    """
    rot = [a for a in (axes or []) if a in ("A", "B", "C")]
    if not rot:
        return None
    if any((k or {}).get("type") == "rotate" for k in (kinematics or [])):
        return None
    return (f"machine has rotary axes ({'/'.join(rot)}) but the machine model "
            f"articulates none — 3D backplot/preview will be wrong; point "
            f"[DISPLAY] WEBUI_MACHINE_DIR at a rotary model (README: Machine Model)")


def mode_boundary_indices(mode):
    """Vertex indices that must survive decimation at kins-mode flips.

    Mode is a per-segment flag carried on the segment's END vertex, so a
    flip at index i means vertex i-1 ENDS the old-mode span and i starts
    the new one. BOTH must be RDP anchors: keeping only i lets a
    collinear old-mode span collapse into one segment j->i that inherits
    the NEW mode — and mode drives joint derivation downstream, so a
    mislabeled span poses through the wrong kins. Pure.
    """
    out = set()
    for i in range(1, len(mode)):
        if mode[i] != mode[i - 1]:
            out.add(i - 1)
            out.add(i)
    return out


def should_ship_abc(kins_marked, raw_abc, peeled_abc, eps=1e-9):
    """Whether per-vertex A/B/C must ride the preview wire (W2 P3).

    True when the tool-vs-work POSE depends on abc — NOT merely when a
    rotary sweeps. Three sufficient conditions, OR'd:

    1. switchkins markers present — under TCP/TOOL modes the pose math
       consumes abc even when constant;
    2. any RAW canon rotary endpoint ≠ 0 — the per-epoch extraction PEELS
       fixture rotary offsets, so a constant tilt held in the fixture's
       ABC offsets (the TWP pattern: G54 carries A/B/C while canon abc
       never moves) leaves the PEELED stream at zero. Testing the peeled
       stream here is exactly the defect this replaces (flat-in-XY preview,
       sim head posed B0/C0): raw endpoints are the honest input;
    3. any PEELED value ≠ 0 — a client without the channel zero-fills abc
       and re-adds the epoch's rotary offsets, so a nonzero peeled value
       (however constant — e.g. a live-rebased parked rotary under a
       nonzero fixture offset, schema 5) reconstructs wrong without the
       wire data. Subsumes the earlier variation test: a varying stream
       cannot be identically zero.

    `raw_abc` may be a one-shot iterable (generator) of (a, b, c) — it is
    consumed at most once and short-circuits on the first hit. `peeled_abc`
    is a sequence of (a, b, c). Pure.
    """
    if kins_marked:
        return True
    for t in raw_abc:
        if abs(t[0]) > eps or abs(t[1]) > eps or abs(t[2]) > eps:
            return True
    for t in peeled_abc:
        if abs(t[0]) > eps or abs(t[1]) > eps or abs(t[2]) > eps:
            return True
    return False


def rotary_sync_initcode(axis_mask, actual_position):
    """The initcode that syncs the preview interp's ROTARY position to the
    live machine (schema 5 — the parity gate's wave-2 find).

    The offline interpreter starts every axis at program-zero of the
    active fixture, so an axis the program never commands is posed at the
    fixture's rotary offset while the real machine holds its parked pose
    (measured: derived A = 19.05° — exactly G54's A offset — machine A =
    0; the work-side faceplate 19° off in the sim, ~340 mm of tip error
    at the work radius). Task syncs its position from the machine at run
    start; this gives the preview interp the same sync, the same way a
    program would state it: one `G53 G0` carrying the live rotary values
    — no motion is recorded (the canon's first-move suppression eats it
    and re-arms at the first real program line), no value is guessed, and
    axes the program DOES command behave exactly as the run will (the
    command becomes a real recorded change from the live pose).

    XYZ are deliberately NOT synced: the linear entry move is run-time
    state that changes between parse and run, and the client already
    prepends it from the live position at sim entry — baking a parse-time
    copy would go stale. Rotary pose is equally run-time state, but the
    canon needs it to POSE every segment, so parse-time is the honest
    best (a re-parse refreshes it, same as WCS).

    Returns the initcode string, or None when the machine has no rotary
    axes or no live position is available (absence = no sync, the honest
    pre-5 behavior). Pure.
    """
    if actual_position is None:
        return None
    words = []
    for bit, slot, letter in ((3, 3, "A"), (4, 4, "B"), (5, 5, "C")):
        if axis_mask & (1 << bit):
            try:
                words.append(f"{letter}{float(actual_position[slot]):.9f}")
            except (TypeError, IndexError, ValueError):
                return None   # partial live data: no sync beats a wrong one
    if not words:
        return None
    return "G53 G0 " + " ".join(words)


# ── touch-off provenance (W1) ───────────────────────────────────────────
# NOTHING in LinuxCNC records the machine state an offset was established
# in. That is fine on a 3-axis mill and false on a rotary table: an offset
# touched off at A=20 is only true at A=20, and the same three numbers mean
# different things depending on whether TCP kinematics were active when
# they were set. The TWP stack read the active offset as a TABLE-frame
# point and therefore carried a STANDING PRECONDITION — "touch off with A
# at 0" — that no code could check. This is what makes it checkable.
#
# Storage: LinuxCNC's fixture table is 20 parameters wide but the
# interpreter defines only the first ten (G54 X..R = 5221..5230, then
# G55_X at 5241). The second ten are unassigned, and any parameter present
# in the var file persists across a restart. So every fixture has ten free,
# persistent, G-code-readable slots at 5231 + (i-1)*20 — verified against
# the var file's own layout, whose gaps (5230->5241, 5250->5261, ...) are
# exactly this stride.
WCS_PROV_BASE = 5231
WCS_PROV_STRIDE = 20
#: value of the `stamped` slot that means "this record is present".
PROV_STAMPED = 1.0


def wcs_prov_params(index):
    """Provenance parameter numbers for fixture `index` (1=G54 .. 9=G59.3).

    `stamped` is a PRESENCE FLAG, not a sentinel value in the data. That is
    deliberate and was learned the hard way: the first cut used -1e9 in the
    `kins` slot to mean "never recorded", and a var-file round-trip brought
    it back as 0.000000 — which is a perfectly valid kins type (identity).
    A never-stamped offset would have read as "touched off in identity kins
    at A=0", confidently and wrongly. A flag whose absent value is the 0
    that a fresh var file is already full of cannot fail that way.

    `kins` and `a` are the state at touch-off. `x`/`y`/`z` are the offset
    values AS WRITTEN, which is what makes the record falsifiable — see
    evaluate_wcs_provenance. Pure.
    """
    i = int(index)
    if not 1 <= i <= 9:
        raise ValueError(f"fixture index out of range: {index}")
    b = WCS_PROV_BASE + (i - 1) * WCS_PROV_STRIDE
    return {"stamped": b, "kins": b + 1, "a": b + 2,
            "x": b + 3, "y": b + 4, "z": b + 5}


def evaluate_wcs_provenance(prov, offset_xyz, eps=1e-6):
    """Is the recorded touch-off provenance still TRUE of this offset?

    We stamp only the writes we control (the gateway's own G10 L2). A
    program's `G10 L2`, another GUI, or a hand-typed MDI line changes the
    offset and leaves the stamp behind — and a STALE provenance is worse
    than none, because it reads as authoritative while describing an offset
    that no longer exists. So the stamp carries the values it was written
    for, and is believed only while they still match.

    `prov` is {kins, a, x, y, z} as read from the parameters; `offset_xyz`
    is the fixture's live X/Y/Z. Returns one of:

      ("valid", {"kins": int, "a": float})  -- trustworthy
      ("absent", None)                      -- never stamped (sentinel/missing)
      ("stale",  {...})                     -- stamped, but the offset moved
                                               underneath it; includes the
                                               recorded values so the caller
                                               can say what changed.

    Absence and staleness are DIFFERENT answers and callers must not
    collapse them: absent means "unknown, proceed by the old rules", stale
    means "someone changed this behind our back", which is worth saying out
    loud. Pure.
    """
    if not prov:
        return ("absent", None)
    try:
        stamped = float(prov["stamped"])
        kins = float(prov["kins"])
        a = float(prov["a"])
        rec = [float(prov["x"]), float(prov["y"]), float(prov["z"])]
    except (KeyError, TypeError, ValueError):
        return ("absent", None)
    # The flag is the ONLY presence test. A fresh var file is all zeros, so
    # "never stamped" needs no magic value that a round-trip could mangle.
    if abs(stamped - PROV_STAMPED) > 1e-9:
        return ("absent", None)
    live = [float(v) for v in (offset_xyz or [0.0, 0.0, 0.0])[:3]]
    if len(live) < 3:
        return ("absent", None)
    if any(abs(r - l) > eps for r, l in zip(rec, live)):
        return ("stale", {"kins": int(round(kins)), "a": a,
                          "recorded_xyz": rec, "live_xyz": live})
    return ("valid", {"kins": int(round(kins)), "a": a})


def override_rotary_position(actual_position, pose):
    """`actual_position` with its A/B/C slots replaced by `pose`.

    The preview seeds its rotary pose from the LIVE machine, which is right
    for the gateway and wrong for a GOLDEN: it makes the recorded payload a
    function of wherever the table happened to be parked when the gate ran.
    Observed here — a golden generated with the table at A=0 drifts as soon
    as a session leaves it at A=35, reported as `swept_axes [] -> ['B','C']`
    with nothing to say the cause was the machine and not the code.

    Substituting at the shared INPUT rather than at each call site is
    deliberate: `rotary_sync_initcode` (what the interp is seeded with) and
    `rotary_seed_values` (what the drift edge later compares against) must
    describe the same pose or the payload lies about its own baseline.

    `pose` is {letter: degrees}; letters absent from it keep their live
    value. Returns a list, or None if there is nothing to override. Pure.
    """
    if actual_position is None or not pose:
        return actual_position
    out = list(actual_position)
    for slot, letter in ((3, "A"), (4, "B"), (5, "C")):
        if letter in pose and slot < len(out):
            out[slot] = float(pose[letter])
    return out


def rotary_seed_values(axis_mask, actual_position):
    """The rotary {letter: value} the sync initcode seeds (schema 5) — the
    parse-time snapshot the gateway's drift edge compares against the live
    pose (W6). Same mask/slot/failure rules as rotary_sync_initcode: None
    when no sync happens (no rotary axes, or partial live data). Pure."""
    if actual_position is None:
        return None
    out = {}
    for bit, slot, letter in ((3, 3, "A"), (4, 4, "B"), (5, 5, "C")):
        if axis_mask & (1 << bit):
            try:
                out[letter] = float(actual_position[slot])
            except (TypeError, IndexError, ValueError):
                return None
    return out or None


def evaluate_rotary_drift(seed, rotary_abc, eps=0.01):
    """Has the machine's ROTARY pose moved since the preview was parsed?
    (W6 — the arc-vs-plunge class: a run leaves the table tilted, `;g69`
    style programs restore nothing, and the cached preview still poses
    every uncommanded-rotary segment at the parse-time values — the sim
    then shows an orient sweep from a pose the next run never visits,
    while the real machine plunges straight.)

    seed       -- the worker's __ABCSEED__ snapshot {letter: degrees}.
    rotary_abc -- live canonical [A, B, C] degrees (status snapshot).

    Returns "rotary:<letters>" naming the drifted axes, or None. Absent
    live data makes no claim. The CALLER owns idle-gating and debounce
    (same contract as evaluate_tlo_drift). Pure."""
    if not seed or not rotary_abc:
        return None
    drifted = ""
    for i, letter in enumerate("ABC"):
        v = seed.get(letter)
        if v is None or i >= len(rotary_abc) or rotary_abc[i] is None:
            continue
        if abs(float(rotary_abc[i]) - float(v)) > eps:
            drifted += letter
    return ("rotary:" + drifted) if drifted else None


def seed_kins_events(events, frames, live_type, live_frame):
    """Seed the parse-time kins state from the LIVE machine (the FIFTH
    run-time freshness input — the 855-unit class: a plain-G54 program run
    after the TWP demo executes under TOOL kins because M2 restores G54
    but NOT the switchkins type, while the parse hard-assumed startup
    type 0).

    Prepends a synthetic marker event at seq -1 (strictly before every
    canon seq, and still strictly before after the relabel pass doubles
    seqs) so the ONE existing resolution path (kins_type_flags /
    kins_frame_indices) applies it — no second code path. A type-2 seed
    also prepends the live plane frame when the reader supplied one; a
    frameless type-2 seed degrades exactly like a bare M430 (segments ride
    the wire as unchecked, honestly). A program whose own first marker
    fires before any motion simply overrides the seed.

    live_type None (untracked/absent) or 0 (identity — the flags' default)
    seeds nothing. Returns (events, frames) as NEW lists. Pure."""
    if live_type in (None, 0):
        return list(events), list(frames)
    ev = [(-1, int(live_type))] + list(events)
    fr = list(frames)
    if int(live_type) == 2 and live_frame is not None and len(live_frame) == 3 \
            and all(isinstance(v, (int, float)) for v in live_frame):
        fr = [(-1, float(live_frame[0]), float(live_frame[1]),
               float(live_frame[2]))] + fr
    return ev, fr


def evaluate_kins_drift(seed, live_type, live_frame, eps=1e-4):
    """Has the machine's switchkins STATE moved since the preview was
    parsed? (Fifth freshness input, drift side.)

    seed       -- the worker's __KINSSEED__ snapshot
                  {"type": int|None, "frame": [p,t1,t2]|None}: what the
                  parse ASSUMED (ctx values, echoed verbatim).
    live_type  -- current motion.switchkins-type (status snapshot).
    live_frame -- current [pre_rot, primary, secondary] pins, or None.

    Returns "kins:type" when the live type left the seeded one,
    "kins:frame" when both sit in TOOL kins (2) but the plane frame pins
    moved past eps, else None. Either side absent makes no claim (an
    untracked config must never develop a drift edge). The CALLER owns
    idle-gating and debounce, same contract as evaluate_rotary_drift.
    Pure."""
    if not seed or live_type is None:
        return None
    seed_type = seed.get("type")
    if seed_type is None:
        return None
    if int(live_type) != int(seed_type):
        return "kins:type"
    if int(live_type) == 2:
        sf = seed.get("frame")
        if sf is None or live_frame is None or len(sf) != 3 \
                or len(live_frame) != 3:
            return None
        for a, b in zip(sf, live_frame):
            if a is None or b is None:
                return None
            if abs(float(a) - float(b)) > eps:
                return "kins:frame"
#: Flat WCS-offset snapshot layout: 9 rows (G54..G59.3) × 10 slots
#: (x y z a b c u v w r) + 9 g92 slots = 99 entries.
_WCSOFF_ROW_KEYS = ("x", "y", "z", "a", "b", "c", "u", "v", "w", "r")
_WCSOFF_NAMES = ("G54", "G55", "G56", "G57", "G58", "G59",
                 "G59.1", "G59.2", "G59.3")


def wcs_offset_flat_from_var(var_rows, g92_offset):
    """Parse-time WCS-offset snapshot from read_var_wcs_rows' dict + the
    canonical g92, flattened to the 99-entry layout. The abc peel and the
    per-line soft-limit flags bake these values into the payload — an
    operator touch-off afterwards makes them stale with NO pose change,
    so the drift edge needs this snapshot to compare against. None when
    the rows are unreadable/incomplete (no claim). Pure."""
    if not var_rows:
        return None
    out = []
    for i in range(1, 10):
        ent = var_rows.get(i)
        if ent is None:
            return None
        offs, rot = ent
        if offs is None or len(offs) < 9:
            return None
        out.extend(float(v) for v in offs[:9])
        out.append(float(rot))
    for j in range(9):
        try:
            out.append(float(g92_offset[j]))
        except (TypeError, IndexError, ValueError):
            out.append(None)
    return out


def wcs_offset_flat_from_table(wcs_table, g92_offset):
    """The LIVE side of the same snapshot, from the status wcs_table rows
    (list of dicts keyed x..w + r). None when the table is absent or
    short (no claim). Pure."""
    if not wcs_table or len(wcs_table) < 9:
        return None
    out = []
    for i in range(9):
        row = wcs_table[i]
        for k in _WCSOFF_ROW_KEYS:
            v = row.get(k)
            out.append(None if v is None else float(v))
    for j in range(9):
        try:
            out.append(float(g92_offset[j]))
        except (TypeError, IndexError, ValueError):
            out.append(None)
    return out


def evaluate_wcs_offset_drift(snap_flat, live_flat, eps=1e-3):
    """Has any WCS offset (all nine rows incl. rotation, plus g92) moved
    since the preview was parsed? The class the rotary Zero All exposed:
    the payload's rotary channel is peeled with the PARSE-time offsets and
    the client re-adds the LIVE ones — a touch-off with no pose change
    double-counts the rotary offset (A jogged to 116°, zeroed, sim derives
    233°), and the per-line soft-limit flags go stale the same silent way.

    Returns "wcsoff:<row>:<letter>" naming the first drifted slot, or
    None. Absent data on either side (or a None slot) makes no claim.
    The CALLER owns idle-gating, debounce, and burst-settling. Pure."""
    if not snap_flat or not live_flat or len(snap_flat) != len(live_flat):
        return None
    for i, (a, b) in enumerate(zip(snap_flat, live_flat)):
        if a is None or b is None:
            continue
        if abs(float(a) - float(b)) > eps:
            if i < 90:
                return (f"wcsoff:{_WCSOFF_NAMES[i // 10]}:"
                        f"{_WCSOFF_ROW_KEYS[i % 10]}")
            return f"wcsoff:g92:{_WCSOFF_ROW_KEYS[i - 90]}"
    return None


def rotary_drift_settled(prev_abc, rotary_abc, eps=0.01):
    """Is the live rotary pose STATIONARY between two consecutive drift
    checks? The drift edge must never fire mid-jog: interp is IDLE while
    jogging, so without this guard every 2 s check reparses against a pose
    that is still moving and the preview visibly chases the jog in laggy
    snaps (operator-caught on the trsrn A axis). The caller passes the
    PREVIOUS check's live sample; only a pose unchanged (<= eps per axis)
    across the full debounce interval may trigger a reparse.

    Returns False when either sample is absent or malformed — a pose we
    cannot prove settled is not settled (no silent go). Pure."""
    if not prev_abc or not rotary_abc or len(prev_abc) != len(rotary_abc):
        return False
    for a, b in zip(prev_abc, rotary_abc):
        if a is None or b is None:
            return False
        if abs(float(a) - float(b)) > eps:
            return False
    return True


def evaluate_tlo_drift(meta, cur_mtime, tool_number, applied_tlo_z, eps=1e-4):
    """Has the tool-length picture moved since the preview was parsed? (W2 P4)

    The per-line limit validator bakes the PARSE-TIME tool table into its
    flags; a toolsetter re-measure afterwards leaves them stale (live
    defect: 11,532 false Z-max flags after tool_touch_off re-measured
    156.56 → 56.63 mm). Two drift signals, first hit wins:

    - "table_mtime": the tool-table FILE changed since the parse snapshot
      (G10 L1 writes through to disk) — the broad signal, catches every
      tool.
    - "tool_offset": the APPLIED offset of the loaded tool differs from the
      parse-time row. Guarded to a loaded tool with a non-trivially-applied
      offset — G49 zeroes the applied vector and must not read as drift.

    `meta` is the worker's parse-time snapshot {"table_mtime": float|None,
    "tlos": [[tool, xo, yo, zo], ...]}. Returns the reason string or None.
    The CALLER owns idle-gating and debounce. Pure.
    """
    if not meta:
        return None
    m0 = meta.get("table_mtime")
    if m0 is not None and cur_mtime is not None and cur_mtime != m0:
        return "table_mtime"
    if tool_number and applied_tlo_z is not None and abs(applied_tlo_z) > eps:
        for row in meta.get("tlos") or []:
            if row and row[0] == tool_number:
                if abs(float(row[3]) - applied_tlo_z) > eps:
                    return "tool_offset"
                break
    return None


#: Var-file numbered-parameter bases for the nine fixtures (G54 … G59.3):
#: axis offsets at base+1..+9, rotation at base+10. MACHINE units on disk
#: (settled by experiment — see gateway._build_wcs_rotation_patches).
WCS_VAR_BASES = (5220, 5240, 5260, 5280, 5300, 5320, 5340, 5360, 5380)


def read_var_wcs_rows(path):
    """WCS fixture rows from a LinuxCNC var file.

    Returns {g5x_index: ([9 axis offsets], rotation_deg)} for indices 1..9,
    absent params read as 0.0 (LinuxCNC's own default for unset numbered
    parameters). The parse worker reads the TEMP var file it just patched
    with the live table, so these are the fixture values the machine
    actually holds at parse time — the comparison baseline that exposes a
    program REWRITING its fixtures (G10 L2 mid-program, the normal TWP
    path). Unreadable file -> {} (the caller must treat that as "cannot
    tell", never as "not rewritten"). Pure aside from the read."""
    params = {}
    try:
        with open(path, "r") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    try:
                        params[int(parts[0])] = float(parts[1])
                    except ValueError:
                        continue
    except OSError:
        return {}
    rows = {}
    for i, base in enumerate(WCS_VAR_BASES):
        rows[i + 1] = ([params.get(base + 1 + j, 0.0) for j in range(9)],
                       params.get(base + 10, 0.0))
    return rows


#: `G10 L2|L20 P<n>` — the program writing a work offset. L2 sets the offset
#: directly, L20 sets it so the current position takes the given value; both
#: make the live var-file row non-authoritative for that fixture.
_G10_WCS_RE = re.compile(r"\bG\s*10\b[^\n]*?\bL\s*(2|20)\b[^\n]*?\bP\s*(\d+)",
                         re.IGNORECASE)


def wcs_rewrite_targets(text):
    """Fixtures the PROGRAM TEXT writes: (explicit_indices, writes_active).

    The value comparison in `wcs_event_rewritten` cannot see a G10 L2 that
    writes the SAME numbers the var file already holds — and a program that
    re-asserts its own offsets every run (the corpus does exactly this) then
    looks operator-owned, so the client re-adds the LIVE row and a touch-off
    between parse and display moves the preview somewhere the machine will
    never go. The source text settles it: a fixture the program writes is
    program-owned whatever the numbers say.

    `P0` means "the active fixture", which is not statically knowable, so it
    returns writes_active=True and the caller must treat EVERY epoch as
    rewritten — cannot tell degrades to the snapshot, never to the live row.
    Pure; comments stripped first so a commented-out G10 does not count."""
    explicit, active = set(), False
    for raw in (text or "").splitlines():
        for m in _G10_WCS_RE.finditer(strip_gcode_comments(raw)):
            p = int(m.group(2))
            if p == 0:
                active = True
            else:
                explicit.add(p)
    return explicit, active


def wcs_event_rewritten(basis, g5x_index, var_rows, epoch0_g92, unit_scale,
                        eps=1e-3):
    """Did the PROGRAM write this epoch's offsets, rather than the operator?

    Compares the epoch's captured basis against the parse-time var-file row
    for its fixture (g5x axes + rotation — what G10 L2 writes), plus the
    epoch's g92 against EPOCH 0's g92 (a mid-program G92 change; the var
    file can't referee g92 — it is not patched with live values). True
    means the client must re-add the PARSE snapshot for this epoch's
    segments: the live table row is not authoritative for a fixture the
    program overwrites at run time. Empty var_rows (unreadable file) ->
    True — "cannot tell" must degrade to the snapshot, never to trusting
    a table we could not read. Pure."""
    if not var_rows or g5x_index not in var_rows:
        return True
    g5x_m = _basis_to_machine_units(basis[0], unit_scale)
    var_g5x, var_rot = var_rows[g5x_index]
    if any(abs(a - b) > eps for a, b in zip(g5x_m, var_g5x)):
        return True
    if abs(float(basis[2]) - var_rot) > eps:
        return True
    return any(abs(float(a) - float(b)) > 1e-9
               for a, b in zip(basis[1], epoch0_g92))


#: Canonical 9-slot offset indices holding LENGTHS (X Y Z U V W) — A B C are
#: angles and never scale with the linear unit. (Twin of the parse worker's
#: _LINEAR_OFFSET_SLOTS — needed here for the var-file comparison.)
_LINEAR_SLOTS = frozenset((0, 1, 2, 6, 7, 8))


def _basis_to_machine_units(vals, unit_scale):
    return [v * unit_scale if i in _LINEAR_SLOTS else v
            for i, v in enumerate(vals)]


def _kins_flip_pose(kins_cfg, ktype, frame, tlo, unit_scale, world=None, joints=None):
    """One side of a kins flip: world -> joints (pass `world`) or joints ->
    world (pass `joints`), routed through the family's Python twin with the
    same TLO conventions as the limit checkers (world coords TLO-inclusive;
    trsrn mode 1 folds TLO z into the pivot, mode 2 ignores it by upstream
    design; trt world folds it into `tool_offset`). Returns a 6-list in
    SCALED machine units, or None when this side cannot be evaluated (no
    twin for the family, or a type-2 segment with no governing frame —
    the bare-M430 case, never guessed). Pure."""
    family = (kins_cfg or {}).get("type")
    params0 = {k: float(v) for k, v in ((kins_cfg or {}).get("params") or {}).items()}
    tlz = (tlo[2] if tlo is not None else 0.0) * unit_scale
    if family == "xyzacb-trsrn":
        if ktype == 0:
            return list(world if world is not None else joints)
        params = dict(params0)
        if ktype == 1:
            params["tool_offset_z"] = tlz
        elif ktype == 2:
            if frame is None:
                return None
            params["pre_rot"] = frame[0]
            params["primary_angle"] = frame[1]
            params["secondary_angle"] = frame[2]
        else:
            return None
        if world is not None:
            return list(trsrn_kins_inverse(world, params, ktype))
        return list(trsrn_kins_forward(joints, params, ktype))
    if family in _TRT_LETTERS:
        world_type = 1 if (kins_cfg or {}).get("identity_first") else 0
        if ktype != world_type:
            return list(world if world is not None else joints)
        bc = family == "xyzbc-trt"
        params = params0
        if tlz:
            params = dict(params0)
            params["tool_offset"] = tlz
        if world is not None:
            j5 = trt_kins_inverse(world, params, bc=bc)
            # required-coordinates order back to the canonical 6-slot layout
            return ([j5[0], j5[1], j5[2], 0.0, j5[3], j5[4]] if bc
                    else [j5[0], j5[1], j5[2], j5[3], 0.0, j5[4]])
        j5 = ([joints[0], joints[1], joints[2], joints[4], joints[5]] if bc
              else [joints[0], joints[1], joints[2], joints[3], joints[5]])
        return list(trt_kins_forward(j5, params, bc=bc))
    return None


def insert_flip_relabels(feed, rapid, kins_events, kins_frames, wcs_events,
                         kins_cfg, unit_scale=1.0, ustart_seqs=frozenset(),
                         start_type=0, start_frame=None):
    """Insert the RELABELED start vertex at every kins or WCS-epoch flip.

    KINS flips (the W8 phantom-jump defect): a switchkins flip swaps the
    world<->joint mapping at a stationary pose — joints hold (G53.6
    capture: servo dither) while world coords jump. The offline interpreter
    has no motion controller so its position is never resynced — the
    canon's first post-flip segment therefore STARTS at the pre-flip
    position, bundling [frame relabel + the real entry move] into one
    segment ~931 units long on the recorded probe. Interpolating it is
    wrong in BOTH directions: phantom travel where the machine relabels,
    and the real entry move (the G53.3 rotary swing) swept along a path
    the machine never takes. The relabeled position is computed through
    the family twins: joints of the pre-flip endpoint under the OLD side,
    forward under the NEW side.

    WCS-EPOCH flips (the metre-off TWP preview, review P2): a fixture
    switch or G10 L2 rewrite changes which basis the extraction subtracts
    from subsequent endpoints (canon.wcs_events). The machine does NOT
    move at the switch, so the relabeled position is the following
    segment's own canon start verbatim (W2 P2: the interpreter's `lo`, not
    the previous tuple's end — canon-suppressed moves land only in the
    former) — but the vertex must EXIST so that pose gets re-expressed in
    the new epoch's frame on the wire, giving the drawn section, the scrub
    lerp, and the sweep a same-frame start for the following real move.
    No twins involved.

    Either way the inserted vertex is a zero-length rapid: the segment
    INTO it is the relabel (flagged via the returned seq set -> wire
    `brk` -> never drawn/swept/timed), the segment OUT of it is the real
    move with its true start (the next tuple's canon `start` is patched,
    so distance/time stats and the joint-side limit subdivision follow
    the real path too). A combined kins+epoch flip (TWP G53.x switches
    fixture and kins back-to-back) gets ONE vertex: twin-relabeled pose,
    new epoch.

    `feed`/`rapid` are the canon tuple lists; all OUTPUT seqs are DOUBLED
    (2*orig; inserted vertices take odd seqs 2*next-1) so an inserted
    vertex can sit between two previously-adjacent seqs — kins events,
    frames, and wcs events are returned re-keyed the same way, which
    preserves every strict seq comparison downstream (client and server
    both resolve markers with `event_seq < seq`).

    `ustart_seqs` = RAW canon seqs of unknown-start (zero-length) tuples
    (W3 P1/P2): the k=0 seed correction skips such a first tuple — its
    start is a synthetic copy of its end, and relabeling it would turn a
    zero-length vertex into a phantom segment.

    A relabel re-expresses a POSITION, so it must be CARRIED FORWARD: every
    axis the following blocks leave uncommanded keeps the pre-flip value in
    the un-resynced interpreter, and correcting only the post-flip segment's
    start manufactures motion the moment that segment holds an axis. See the
    carry block below. Relabel invariant, enforced by construction: a relabel
    may neither create nor destroy motion — an axis whose RAW segment delta is
    zero has a zero delta afterwards too.

    Returns (feed2, rapid2, events2, frames2, wcs_events2, relabel_seqs,
    unresolved, carry_spans): `relabel_seqs` = doubled seqs of the inserted
    vertices; `unresolved` counts kins flips this family/frame data could NOT
    evaluate — those keep the raw (wrong) segment and drop the carry, and the
    caller must ship the count rather than pretend the track is clean;
    `carry_spans` counts tuples whose shipped geometry the carry moved, which
    the caller ships too: canon-endpoint replay cannot tell "axis held" from
    "axis commanded to exactly the stale value", so the reach of every carry
    is reported rather than assumed. Pure.
    """
    feed = [list(t) for t in feed]
    rapid = [list(t) for t in rapid]
    events2 = [(e[0] * 2, e[1]) for e in kins_events]
    frames2 = [(f[0] * 2,) + tuple(f[1:]) for f in kins_frames]
    wcs_events2 = [(w[0] * 2,) + tuple(w[1:]) for w in wcs_events]
    for t in feed:
        t[5] *= 2
    for t in rapid:
        t[4] *= 2
    if (not kins_events and len(wcs_events) < 2) or (not feed and not rapid):
        return feed, rapid, events2, frames2, wcs_events2, set(), 0, 0

    # Execution-ordered view: (seq2, stream_list, index). Both lists are
    # seq-ascending (canon appends in execution order), so a plain merge
    # by seq reconstructs program order — same convention as the client.
    merged = sorted(
        [(t[5], feed, i) for i, t in enumerate(feed)]
        + [(t[4], rapid, i) for i, t in enumerate(rapid)])
    seqs2 = [m[0] for m in merged]
    types = kins_type_flags(seqs2, events2)
    fidx = kins_frame_indices(seqs2, frames2)
    eidx = kins_frame_indices(seqs2, wcs_events2)
    frames_vals = [tuple(f[1:]) for f in frames2]

    relabel_seqs = set()
    inserts = []  # (position-in-rapid, tuple) collected, applied afterwards
    unresolved = 0

    # ---- the relabel CARRY (the post-g69 phantom, 2026-08-29) --------------
    # A relabel re-expresses a POSITION, and the offline interpreter is never
    # resynced — so every axis the following blocks do not command keeps the
    # PRE-flip value for as long as it stays uncommanded. Patching only the
    # post-flip segment's start (what this function used to do) therefore
    # manufactures motion the moment that segment holds an axis: the trailing
    # `g0 a0` of a g69 tail is start==end, and moving only its start invented
    # 897 mm of travel. The k=0 branch already knew this hazard ("relabeling
    # it would turn a zero-length vertex into a phantom segment"); the k-loop
    # did not.
    #
    # So the correction is carried forward per axis until that axis is
    # re-commanded:
    #   corr[i]   raw -> true, in CANON units (a displacement: world/unit_scale,
    #             so it is invariant to any per-tuple TLO difference)
    #   live[i]   the correction still applies
    #   anchor[i] the RAW WORLD value when it was established. Retirement
    #             compares against this FIXED anchor, never a running
    #             position, so a later re-command to the same number cannot
    #             resurrect a retired axis.
    # Retirement is evaluated on the start AND on the end, against the same
    # anchor, which is what makes the relabel invariant hold by construction:
    # an axis with a zero raw delta gets the same treatment at both ends.
    corr = [0.0] * 6
    live = [False] * 6
    anchor = [0.0] * 6
    carry_spans = 0          # tuples whose shipped geometry the carry moved
    _EPS = 1e-9

    def _world(coords, tlo):
        out = [0.0] * 6
        for i in range(6):
            v = float(coords[i])
            if i < 3:
                v = (v + (tlo[i] if tlo is not None else 0.0)) * unit_scale
            out[i] = v
        return out

    def _retire(coords, tlo):
        """Drop the carry for every axis that has left its anchor."""
        w = _world(coords, tlo)
        for i in range(6):
            if live[i] and abs(w[i] - anchor[i]) > _EPS:
                live[i] = False

    def _apply(coords):
        if not any(live):
            return list(coords), False
        out = list(coords)
        moved = False
        for i in range(6):
            if live[i]:
                out[i] = float(coords[i]) + corr[i]
                moved = True
        return out, moved

    # k=0 seed correction (W3 P2 — the 962 mm phantom): markers that fire
    # BEFORE the first recorded segment produce no k-loop flip (types[] and
    # fidx[] are uniform from index 0), yet merged[0]'s canon start is still
    # expressed in the STARTUP labeling (type 0, no frame — the
    # initcode-seeded pose). On the TWP capture that allocated a ~962 mm /
    # ~4.8 s phantom to the first scrub segment and polluted the stats and
    # the joint-side limit subdivision. Re-express the start through the
    # twins exactly like the k-loop and PATCH in place — no vertex
    # insertion: the wire ships endpoints only, so this corrects time/dist/
    # limit subdivision without touching geometry. Skipped for an
    # unknown-start first tuple (start is a synthetic copy of its end —
    # relabeling it would fabricate a segment out of a zero-length vertex).
    # The FROM side of the k=0 correction is the PARSE-TIME LIVE labeling
    # (start_type/start_frame — the fifth freshness input), not a
    # hardcoded 0: the initcode pose comes from actual_position, which is
    # expressed under whatever kins the machine is parked in. Pre-seed
    # code assumed startup type 0 — correct only while the parse itself
    # assumed it. A seeded parse whose first segment carries the seed
    # labeling converts FROM==TO (identity, no patch), exactly right.
    _sfr = tuple(start_frame) if start_frame is not None else None
    ustart2 = {s * 2 for s in ustart_seqs}
    _fr0 = frames_vals[fidx[0]] if merged and fidx[0] is not None else None

    for k in range(len(merged)):
        seq_n, lst_n, i_n = merged[k]
        nxt = lst_n[i_n]
        nxt_start = nxt[1]
        nxt_end = nxt[2]
        tlo_n = nxt[4] if lst_n is feed else nxt[3]

        if k == 0:
            # k=0 is a PATCH IN PLACE, never an insertion: the wire ships
            # endpoints only, so re-expressing the very first start corrects
            # time/distance/limit subdivision without inventing geometry.
            kins_flip = ((types[0] != start_type or _fr0 != _sfr)
                         and seq_n not in ustart2)
            flip = kins_flip
            fr_p, fr_n = _sfr, _fr0
            type_p = start_type
        else:
            kins_flip = types[k] != types[k - 1] or fidx[k] != fidx[k - 1]
            flip = kins_flip or eidx[k] != eidx[k - 1]
            fr_p = frames_vals[fidx[k - 1]] if fidx[k - 1] is not None else None
            fr_n = frames_vals[fidx[k]] if fidx[k] is not None else None
            type_p = types[k - 1]

        # Retire first, so an axis this tuple has already left cannot be
        # corrected, then carry what survives into the start.
        _retire(nxt_start, tlo_n)
        start_c, start_moved = _apply(nxt_start)

        end = None
        if flip and kins_flip:
            # The FROM side is the TRUE pre-flip pose — raw PLUS any live
            # carry — so a relabel that follows another relabel composes.
            w0 = _world(start_c, tlo_n)
            j = _kins_flip_pose(kins_cfg, type_p, fr_p, tlo_n, unit_scale,
                                world=w0)
            w1 = None if j is None else \
                _kins_flip_pose(kins_cfg, types[k], fr_n, tlo_n, unit_scale,
                                joints=j)
            if w1 is None:
                # Never guess: drop the carry entirely and let the caller
                # ship the count rather than pretend the track is clean.
                unresolved += 1
                corr[:] = [0.0] * 6
                live[:] = [False] * 6
                continue
            end = list(nxt_start)
            for i in range(3):
                end[i] = w1[i] / unit_scale - (tlo_n[i] if tlo_n is not None else 0.0)
            for i in range(3, 6):
                end[i] = w1[i]
            # Establish the carry: raw -> true, anchored at the raw pose it
            # was computed from.
            _raw_w = _world(nxt_start, tlo_n)
            for i in range(6):
                corr[i] = end[i] - float(nxt_start[i])
                anchor[i] = _raw_w[i]
                live[i] = abs(corr[i]) > _EPS
            start_c = list(end)
        elif flip:
            # Epoch-only flip: the machine holds still at a fixture switch, so
            # the relabel is the post-flip start verbatim (carry included);
            # only its EPOCH differs.
            end = list(start_c)
        elif not any(live):
            continue          # nothing to relabel and nothing to carry

        # The tuple's own motion retires whatever it commands; an axis with a
        # zero raw delta keeps the same live state at both ends, so a relabel
        # can never create or destroy motion.
        _retire(nxt_end, tlo_n)
        end_c, end_moved = _apply(nxt_end)

        if start_moved or end_moved:
            carry_spans += 1

        if not flip:
            # Carry-only tuple: no vertex, no relabel — just the corrected
            # geometry.
            lst_n[i_n] = list(nxt)
            lst_n[i_n][1] = tuple(start_c)
            lst_n[i_n][2] = tuple(end_c)
            continue

        if k == 0:
            if max(abs(start_c[i] - float(nxt_start[i]))
                   for i in range(6)) >= _EPS:
                lst_n[i_n] = list(nxt)
                lst_n[i_n][1] = tuple(start_c)
                lst_n[i_n][2] = tuple(end_c)
            continue

        if kins_flip and eidx[k] == eidx[k - 1] and \
                max(abs(start_c[i] - float(nxt_start[i]))
                    for i in range(6)) < _EPS:
            continue  # relabel lands where the segment already starts
        end = tuple(start_c)
        # The relabel vertex is seeded from the TRUE canon start of the first
        # post-flip segment (W2 P2): the interpreter's own `lo` tracks through
        # moves the canon SUPPRESSES (a G43 shift, a deduped first move), which
        # the previous tuple's END never sees. nxt's start coords were TLO-peeled
        # with nxt's OWN tlo, so that same tlo un-peels them (and parameterizes
        # BOTH twin sides: the TLO fold makes the recovered joints invariant to
        # which consistent tlo is used, while mixing prev's tlo into nxt's coords
        # would shift the physical pose by any G43 delta at the boundary).
        rl_seq = seq_n - 1
        # Zero-length rapid AT the relabeled pose; the next segment now really
        # STARTS there — and, via the carry, ENDS where it truly ends instead
        # of snapping back to the un-relabeled position (the g69-tail phantom).
        inserts.append((i_n if lst_n is rapid else None,
                        [nxt[0], end, end, tlo_n, rl_seq]))
        lst_n[i_n] = list(nxt)
        lst_n[i_n][1] = end
        lst_n[i_n][2] = tuple(end_c)
        relabel_seqs.add(rl_seq)

    # Apply rapid insertions back-to-front so indices stay valid; flips whose
    # next segment is a FEED still insert into rapid, positioned by seq.
    for at, tup in sorted(inserts, key=lambda x: x[1][4], reverse=True):
        if at is not None:
            rapid.insert(at, tup)
        else:
            pos = 0
            while pos < len(rapid) and rapid[pos][4] < tup[4]:
                pos += 1
            rapid.insert(pos, tup)
    return ([tuple(t) for t in feed], [tuple(t) for t in rapid],
            events2, frames2, wcs_events2, relabel_seqs, unresolved,
            carry_spans)


def trt_kins_forward(joints, params, bc=False):
    """xyzac/xyzbc-trt world kinematics, forward (joints -> world).

    Python twin of the TS mirror in lcnc-webui/src/viewer/kins.ts — BOTH
    are line-for-line mirrors of LinuxCNC v2.9.4 trtfuncs.c
    (xyzac/xyzbcKinematicsForward) and BOTH are pinned by the one fixture
    set scripts/gen_kins_fixtures.py generates from the compiled C oracle
    (scripts/kins_oracle/). Never edit one mirror without the other — the
    shared fixtures make divergence a red test.

    `joints` is the 5-tuple in required-coordinates order (X Y Z A C for
    xyzac, X Y Z B C for xyzbc). `params` maps the kins HAL pin names
    (x_rot_point, y_rot_point, z_rot_point, x_offset, y_offset, z_offset,
    tool_offset; missing keys = 0). Returns [x, y, z, a, b, c].
    Needed at parse time: TCP soft limits must check JOINTS, not program
    words (phase-0 capture: joint X hit -22.4 on a program whose X words
    never left -20..20).
    """
    xr = params.get("x_rot_point", 0.0)
    yr = params.get("y_rot_point", 0.0)
    zr = params.get("z_rot_point", 0.0)
    dx = params.get("x_offset", 0.0)
    dy = params.get("y_offset", 0.0)
    dz = params.get("z_offset", 0.0) + params.get("tool_offset", 0.0)
    jx, jy, jz, jr1, jc = (float(v) for v in joints)
    cc, sc = math.cos(math.radians(jc)), math.sin(math.radians(jc))
    if not bc:
        ca, sa = math.cos(math.radians(jr1)), math.sin(math.radians(jr1))
        return [
            cc * (jx - xr) + sc * ca * (jy - dy - yr)
            + sc * sa * (jz - dz - zr) + sc * dy + xr,
            -sc * (jx - xr) + cc * ca * (jy - dy - yr)
            + cc * sa * (jz - dz - zr) + cc * dy + yr,
            -sa * (jy - dy - yr) + ca * (jz - dz - zr) + dz + zr,
            jr1, 0.0, jc,
        ]
    cb, sb = math.cos(math.radians(jr1)), math.sin(math.radians(jr1))
    return [
        cc * cb * (jx - dx - xr) + sc * (jy - yr)
        - cc * sb * (jz - dz - zr) + cc * dx + xr,
        -sc * cb * (jx - dx - xr) + cc * (jy - yr)
        + sc * sb * (jz - dz - zr) - sc * dx + yr,
        sb * (jx - dx - xr) + cb * (jz - dz - zr) + dz + zr,
        0.0, jr1, jc,
    ]


def trt_kins_inverse(world, params, bc=False):
    """xyzac/xyzbc-trt world kinematics, inverse (world -> joints).

    Twin of trt_kins_forward (see its docstring for the mirror/oracle
    contract). `world` is [x, y, z, a, b, c]; returns the 5-list of
    joints in required-coordinates order.
    """
    xr = params.get("x_rot_point", 0.0)
    yr = params.get("y_rot_point", 0.0)
    zr = params.get("z_rot_point", 0.0)
    dx = params.get("x_offset", 0.0)
    dy = params.get("y_offset", 0.0)
    dz = params.get("z_offset", 0.0) + params.get("tool_offset", 0.0)
    wx, wy, wz = (float(world[i]) for i in range(3))
    r1 = float(world[4] if bc else world[3])
    c = float(world[5])
    cc, sc = math.cos(math.radians(c)), math.sin(math.radians(c))
    if not bc:
        ca, sa = math.cos(math.radians(r1)), math.sin(math.radians(r1))
        px = cc * (wx - xr) - sc * (wy - yr) + xr
        py = (sc * ca * (wx - xr) + cc * ca * (wy - yr)
              - sa * (wz - zr) - ca * dy + sa * dz + dy + yr)
        pz = (sc * sa * (wx - xr) + cc * sa * (wy - yr)
              + ca * (wz - zr) - sa * dy - ca * dz + dz + zr)
    else:
        cb, sb = math.cos(math.radians(r1)), math.sin(math.radians(r1))
        dpx = -cb * dx - sb * dz + dx
        dpz = sb * dx - cb * dz + dz
        px = (cc * cb * (wx - xr) - sc * cb * (wy - yr)
              + sb * (wz - zr) + dpx + xr)
        py = sc * (wx - xr) + cc * (wy - yr) + yr
        pz = (-cc * sb * (wx - xr) + sc * sb * (wy - yr)
              + cb * (wz - zr) + dpz + zr)
    return [px, py, pz, r1, c]


def _trsrn_terms(params, mode, rot_a, rot_b, rot_c):
    """Shared trig/frame terms for the trsrn twins (one place, two callers).

    Mirrors the comp's variable block: in TCP (mode 1) the frame comes from
    the CURRENT rotary values (world a/b/c == joints, rotary passthrough);
    in TOOL (mode 2) from the remap-written pins primary/secondary/pre-rot.
    UNIT ASYMMETRY (upstream remap.py set_p): pre_rot is RADIANS, the
    angles are DEGREES.
    """
    nu = params.get("nut_angle", 0.0)
    sv, cv = math.sin(math.radians(nu)), math.cos(math.radians(nu))
    tc = params.get("pre_rot", 0.0)  # radians
    stc, ctc = math.sin(tc), math.cos(tc)
    sw, cw = math.sin(math.radians(rot_a)), math.cos(math.radians(rot_a))
    if mode == 1:
        ss, cs = math.sin(math.radians(rot_b)), math.cos(math.radians(rot_b))
        sp, cp = math.sin(math.radians(rot_c)), math.cos(math.radians(rot_c))
    else:
        th1 = params.get("primary_angle", 0.0)
        th2 = params.get("secondary_angle", 0.0)
        ss, cs = math.sin(math.radians(th2)), math.cos(math.radians(th2))
        sp, cp = math.sin(math.radians(th1)), math.cos(math.radians(th1))
    cvss, svss = cv * ss, sv * ss
    r = cs + sv * sv * (1 - cs)
    s = cs + cv * cv * (1 - cs)
    t = sv * cv * (1 - cs)
    return sw, cw, ss, cs, sp, cp, stc, ctc, cvss, svss, r, s, t


def trsrn_kins_forward(joints, params, mode):
    """xyzacb_trsrn switchable kinematics, forward (6 joints -> world).

    Python twin of the TS mirror (lcnc-webui/src/viewer/kins.ts TrsrnKins)
    — BOTH are line-for-line mirrors of the upstream TWP machine's comp
    (master @493926b56c, vendored in scripts/kins_oracle/) and BOTH are
    pinned by the trsrn_sets fixtures gen_kins_fixtures.py generates from
    the compiled C, live-validated against the 2.9.4 spike captures.
    Never edit one mirror without the other.

    `joints` = 6 values j0..j5 = X Y Z A B C (the comp hardcodes indices).
    `params` maps the kins pin names: y_pivot, z_pivot, x_offset, y_offset,
    y_rot_axis, z_rot_axis, nut_angle (deg), tool_offset_z, pre_rot (RAD),
    primary_angle (deg, table C), secondary_angle (deg, spindle B); missing
    keys = 0. `mode` = switchkins type 0|1|2. Returns [x, y, z, a, b, c].
    TLO note: mode 2 ignores tool_offset_z by upstream design (motion
    applies TLO before the kins in plane mode).
    """
    ly = params.get("y_pivot", 0.0)
    lz = params.get("z_pivot", 0.0)
    dx = params.get("x_offset", 0.0)
    dy = params.get("y_offset", 0.0)
    dray = params.get("y_rot_axis", 0.0) - (dy + ly)
    draz = params.get("z_rot_axis", 0.0) - lz
    dt = params.get("tool_offset_z", 0.0)
    px, py, pz, j3, j4, j5 = (float(v) for v in joints[:6])
    if mode == 0:
        return [px, py, pz, j3, j4, j5]
    sw, cw, ss, cs, sp, cp, stc, ctc, cvss, svss, r, s, t = \
        _trsrn_terms(params, mode, j3, j4, j5)
    if mode == 1:
        wx = (-(cp * svss - sp * t) * (dt + lz) - cp * dx
              + (cp * cvss + sp * r) * ly + dy * sp + dx + px)
        wy = (-cp * cw * dy - cw * dx * sp - cw * (dray - py)
              - (cw * sp * svss + cp * cw * t - sw * s) * (dt + lz)
              + (cvss * cw * sp - cp * cw * r + sw * t) * ly
              + (draz - pz) * sw + dray + dy + ly)
        wz = (-cp * dy * sw - dx * sp * sw - cw * (draz - pz)
              - (sp * svss * sw + cp * sw * t + cw * s) * (dt + lz)
              + (cvss * sp * sw - cp * sw * r - cw * t) * ly
              - (dray - py) * sw + draz + dt + lz)
    else:
        wx = (((cs * ctc - cvss * stc) * cp - (ctc * cvss + stc * r) * sp) * (dx + px)
              - (cs * ctc - cvss * stc) * dx
              + ((ctc * cvss + stc * r) * cp
                 + (cs * ctc - cvss * stc) * sp) * (dy + ly + py)
              - (ctc * cvss + stc * r) * dy
              - (ctc * svss - stc * t) * (lz + pz) - ly * stc)
        wy = (-((ctc * cvss + cs * stc) * cp - (cvss * stc - ctc * r) * sp) * (dx + px)
              + (ctc * cvss + cs * stc) * dx
              - ((cvss * stc - ctc * r) * cp
                 + (ctc * cvss + cs * stc) * sp) * (dy + ly + py)
              + (cvss * stc - ctc * r) * dy
              - ctc * ly + (stc * svss + ctc * t) * (lz + pz))
        wz = ((cp * svss - sp * t) * (dx + px)
              + (sp * svss + cp * t) * (dy + ly + py)
              - dx * svss + (lz + pz) * s - dy * t - lz)
    return [wx, wy, wz, j3, j4, j5]


def trsrn_kins_inverse(world, params, mode):
    """xyzacb_trsrn switchable kinematics, inverse (world -> 6 joints).

    Twin of trsrn_kins_forward (see its docstring for the mirror/oracle
    contract). `world` is [x, y, z, a, b, c]; returns j0..j5. The comp
    reads the CURRENT rotary joints for the frame terms; motion seeds them
    with actuals, which in steady state equal world a/b/c (rotary
    passthrough) — mirrored here the same way the oracle harness seeds.
    """
    ly = params.get("y_pivot", 0.0)
    lz = params.get("z_pivot", 0.0)
    dx = params.get("x_offset", 0.0)
    dy = params.get("y_offset", 0.0)
    dray = params.get("y_rot_axis", 0.0) - (dy + ly)
    draz = params.get("z_rot_axis", 0.0) - lz
    dt = params.get("tool_offset_z", 0.0)
    qx, qy, qz, wa, wb, wc = (float(v) for v in world[:6])
    if mode == 0:
        return [qx, qy, qz, wa, wb, wc]
    sw, cw, ss, cs, sp, cp, stc, ctc, cvss, svss, r, s, t = \
        _trsrn_terms(params, mode, wa, wb, wc)
    if mode == 1:
        j0 = ((cp * svss - sp * t) * (dt + lz) + cp * dx
              - (cp * cvss + sp * r) * ly - dy * sp - dx + qx)
        j1 = (cp * dy + dx * sp - cw * (dray + dy + ly - qy)
              + (sp * svss + cp * t) * (dt + lz)
              - (cvss * sp - cp * r) * ly
              - (draz + dt + lz - qz) * sw + dray)
        j2 = ((dt + lz) * s + ly * t - cw * (draz + dt + lz - qz)
              + (dray + dy + ly - qy) * sw + draz)
    else:
        j0 = (cp * dx - (cp * cvss + sp * r) * ly + (cp * svss - sp * t) * lz
              + ((cp * cs - cvss * sp) * ctc
                 - (cp * cvss + sp * r) * stc) * qx
              - ((cp * cvss + sp * r) * ctc + (cp * cs - cvss * sp) * stc) * qy
              + (cp * svss - sp * t) * qz - dy * sp - dx)
        j1 = (cp * dy - (cvss * sp - cp * r) * ly + (sp * svss + cp * t) * lz
              + ((cp * cvss + cs * sp) * ctc - (cvss * sp - cp * r) * stc) * qx
              - ((cvss * sp - cp * r) * ctc + (cp * cvss + cs * sp) * stc) * qy
              + (sp * svss + cp * t) * qz + dx * sp - dy - ly)
        j2 = (-(ctc * svss - stc * t) * qx + (stc * svss + ctc * t) * qy
              + lz * s + qz * s + ly * t - lz)
    return [j0, j1, j2, wa, wb, wc]


_TRT_LETTERS = {"xyzac-trt": ("X", "Y", "Z", "A", "C"),
                "xyzbc-trt": ("X", "Y", "Z", "B", "C")}
_JOINT_MOVE_EPS = 1e-9


def check_limit_violations_world(segments, limits, kins_cfg, unit_scale=1.0,
                                 rot_step_deg=4.0, max_report=200):
    """JOINT-side soft limits for WORLD-mode (TCP) segments.

    Under world kins the program/world words say nothing about the joints:
    phase-0 capture — joint X hit -22.36 on a program whose X words never
    left +/-20, MID-segment (a C sweep at fixed world XY: jx traces
    -sqrt(wx^2+wy^2); both endpoints were inside the limits). So each
    segment is SUBDIVIDED by its rotary sweep (rot_step_deg, the client's
    4-degree rule; capped 256) and every sample runs through the Python
    kins twin (trt_kins_inverse — oracle-pinned) before checking.

    segments: (lineno, start9, end9, tlo3) canon tuples of the WORLD
    segments only (canon inches / degrees). World coords are TLO-INCLUSIVE
    (limits act on joints; the kins' tool_offset param gets the same TLO z
    so the pivot math is right — the phase-1d/2b audit).
    Attribution: a joint is flagged only when it MOVES within the segment
    (min/max span > eps — endpoint comparison would call a full C turn
    "parked" while its X excursion is the whole point).

    Returns (records, total) shaped exactly like check_limit_violations,
    or (None, n_segments) when the declared kins type has no twin — those
    segments are UNCHECKED (never checked wrongly as identity).
    """
    ktype = (kins_cfg or {}).get("type")
    letters = _TRT_LETTERS.get(ktype)
    segments = list(segments)
    if letters is None:
        return None, len(segments)
    if not limits or not segments:
        return [], 0
    bc = ktype == "xyzbc-trt"
    params0 = {k: float(v) for k, v in ((kins_cfg.get("params") or {}).items())}
    bounds = []
    for jno, letter in enumerate(letters):
        b = limits.get(letter)
        if b is not None:
            bounds.append((jno, letter, b[0], b[1]))
    if not bounds:
        return [], 0

    worst = {}
    jmin = [0.0] * 5
    jmax = [0.0] * 5
    for lineno, start, end, tlo in segments:
        # start=None = UNKNOWN-PATH segment (W3 P1): only the endpoint is
        # known, so sample it alone and skip the joint-moved attribution —
        # the machine does move there, so an out-of-bounds endpoint joint
        # must flag its line.
        unknown = start is None
        if unknown:
            start = end
        rotd = max(abs(end[i] - start[i]) for i in (3, 4, 5))
        steps = min(256, max(1, math.ceil(rotd / rot_step_deg)))
        params = params0
        if tlo is not None and tlo[2]:
            params = dict(params0)
            params["tool_offset"] = tlo[2] * unit_scale
        for si in range(steps + 1):
            t = si / steps
            w = [0.0] * 6
            for i in range(6):
                v = start[i] + (end[i] - start[i]) * t
                if i < 3:
                    v = (v + (tlo[i] if tlo is not None else 0.0)) * unit_scale
                w[i] = v
            joints = trt_kins_inverse(w, params, bc=bc)
            if si == 0:
                for j in range(5):
                    jmin[j] = jmax[j] = joints[j]
            else:
                for j in range(5):
                    if joints[j] < jmin[j]:
                        jmin[j] = joints[j]
                    elif joints[j] > jmax[j]:
                        jmax[j] = joints[j]
        for jno, letter, mn, mx in bounds:
            if not unknown and jmax[jno] - jmin[jno] <= _JOINT_MOVE_EPS:
                continue  # joint parked this segment — culprit line already flagged
            if mn is not None and jmin[jno] < mn - _LIMIT_EPS:
                key = (lineno, letter)
                rec = worst.get(key)
                if rec is None or jmin[jno] < rec[0]:
                    worst[key] = [jmin[jno], mn, "min"]
            if mx is not None and jmax[jno] > mx + _LIMIT_EPS:
                key = (lineno, letter)
                rec = worst.get(key)
                if rec is None or jmax[jno] > rec[0]:
                    worst[key] = [jmax[jno], mx, "max"]

    order = {letter: i for i, letter in enumerate(AXIS_LETTERS)}
    keys = sorted(worst, key=lambda k: (k[0], order.get(k[1], 9)))
    records = [{"line": ln, "axis": ax, "value": round(worst[(ln, ax)][0], 4),
                "limit": round(worst[(ln, ax)][1], 4), "kind": worst[(ln, ax)][2]}
               for ln, ax in keys[:max_report]]
    return records, len(keys)


_TRSRN_LETTERS = ("X", "Y", "Z", "A", "B", "C")


def check_limit_violations_trsrn(segments, limits, kins_cfg, unit_scale=1.0,
                                 rot_step_deg=4.0, max_report=200):
    """JOINT-side soft limits for xyzacb-trsrn non-identity segments.

    Sibling of check_limit_violations_world with the trsrn twist: the raw
    switchkins TYPE picks the joint mapping per segment — type 1 (TCP)
    routes through trsrn_kins_inverse mode 1 with the live TLO folded
    into the pivot (`tool_offset_z`), type 2 (TOOL/plane) through mode 2
    with the governing WEBUI_TWPFRAME values (pre-rot rad, primary/
    secondary deg — the kins pin trio; mode-2 math ignores TLO by
    upstream design, capture-verified to the µm). A type-2 segment with
    NO governing frame (bare M430 — the frame lives only in the kins
    pins) is UNCHECKED, never guessed. World coords are TLO-INCLUSIVE
    like the trt path (canon subtracts TLO; both twins' live validation
    matched stat.position with TLO added back).

    segments: (lineno, start9, end9, tlo3, kinstype, frame) — frame is
    (pre_rot, th1, th2) or None. Rotary subdivision mirrors the trt rule
    (mode-1 orient sweeps bend the joint path mid-segment; parked-rotary
    plane moves get steps=1 for free). Attribution: only a joint that
    MOVES within the segment is flagged.

    Returns (records, total, unchecked) — records/total shaped like
    check_limit_violations; unchecked counts the frameless type-2
    segments (rides the wire as violations_world_unchecked). Pure.
    """
    segments = list(segments)
    if not limits or not segments:
        return [], 0, sum(1 for s in segments if s[4] == 2 and s[5] is None)
    params0 = {k: float(v) for k, v in ((kins_cfg or {}).get("params") or {}).items()}
    bounds = []
    for jno, letter in enumerate(_TRSRN_LETTERS):
        b = limits.get(letter)
        if b is not None:
            bounds.append((jno, letter, b[0], b[1]))

    unchecked = 0
    worst = {}
    jmin = [0.0] * 6
    jmax = [0.0] * 6
    for lineno, start, end, tlo, ktype, frame in segments:
        if ktype == 2 and frame is None:
            unchecked += 1
            continue
        if ktype not in (1, 2):
            continue  # identity segs belong to the caller's identity check
        # start=None = UNKNOWN-PATH (W3 P1): endpoint-only sample, no
        # joint-moved attribution skip — same convention as the identity
        # and trt checkers.
        unknown = start is None
        if unknown:
            start = end
        params = dict(params0)
        tz = (tlo[2] if tlo is not None else 0.0) * unit_scale
        if ktype == 1:
            params["tool_offset_z"] = tz
        else:
            params["pre_rot"] = frame[0]
            params["primary_angle"] = frame[1]
            params["secondary_angle"] = frame[2]
        if not bounds:
            continue
        rotd = max(abs(end[i] - start[i]) for i in (3, 4, 5))
        steps = min(256, max(1, math.ceil(rotd / rot_step_deg)))
        for si in range(steps + 1):
            t = si / steps
            w = [0.0] * 6
            for i in range(6):
                v = start[i] + (end[i] - start[i]) * t
                if i < 3:
                    v = (v + (tlo[i] if tlo is not None else 0.0)) * unit_scale
                w[i] = v
            joints = trsrn_kins_inverse(w, params, ktype)
            if si == 0:
                for j in range(6):
                    jmin[j] = jmax[j] = joints[j]
            else:
                for j in range(6):
                    if joints[j] < jmin[j]:
                        jmin[j] = joints[j]
                    elif joints[j] > jmax[j]:
                        jmax[j] = joints[j]
        for jno, letter, mn, mx in bounds:
            if not unknown and jmax[jno] - jmin[jno] <= _JOINT_MOVE_EPS:
                continue  # joint parked this segment — culprit line already flagged
            if mn is not None and jmin[jno] < mn - _LIMIT_EPS:
                key = (lineno, letter)
                rec = worst.get(key)
                if rec is None or jmin[jno] < rec[0]:
                    worst[key] = [jmin[jno], mn, "min"]
            if mx is not None and jmax[jno] > mx + _LIMIT_EPS:
                key = (lineno, letter)
                rec = worst.get(key)
                if rec is None or jmax[jno] > rec[0]:
                    worst[key] = [jmax[jno], mx, "max"]

    order = {letter: i for i, letter in enumerate(AXIS_LETTERS)}
    keys = sorted(worst, key=lambda k: (k[0], order.get(k[1], 9)))
    records = [{"line": ln, "axis": ax, "value": round(worst[(ln, ax)][0], 4),
                "limit": round(worst[(ln, ax)][1], 4), "kind": worst[(ln, ax)][2]}
               for ln, ax in keys[:max_report]]
    return records, len(keys), unchecked


def merge_violation_records(a, b, max_report=200):
    """Union of two violation reports (identity-checked + world-checked).

    Worst record wins per (line, axis) — measured by excursion beyond the
    limit. Returns (records, total distinct pairs). Pure.
    """
    worst = {}
    for rec in list(a or []) + list(b or []):
        key = (rec["line"], rec["axis"])
        cur = worst.get(key)
        if cur is None or abs(rec["value"] - rec["limit"]) > abs(cur["value"] - cur["limit"]):
            worst[key] = rec
    order = {letter: i for i, letter in enumerate(AXIS_LETTERS)}
    keys = sorted(worst, key=lambda k: (k[0], order.get(k[1], 9)))
    return [worst[k] for k in keys[:max_report]], len(keys)


#: G-codes that command motion on their own (the rest need an axis word).
#: G28/G30 move with no axis words (return to reference — common in headers;
#: flagging them disabled the highlight on clean single-file programs), but
#: G28.1/G30.1 only STORE the reference — hence the (?!\.). G80 CANCELS
#: motion, so the canned-cycle range starts at 81.
_MOTION_GCODES = re.compile(
    r"\bg\s*0*(?:0|1|2|3|28(?!\.)|30(?!\.)|33(?:\.1)?|38(?:\.[2-5])?"
    r"|73|76|8[1-9](?:\.\d)?|53\.[136])\b",
    re.I)
#: An axis word with a value — under a modal motion mode this moves the machine.
_AXIS_WORD = re.compile(r"[XYZABCUVW]\s*[-+]?[\d.]", re.I)
#: Settings codes whose axis words do NOT move the machine (G10 offset
#: writes, G92 offsets, G52 shifts). A line whose only G-codes are these
#: is not motion-capable even with axis words on it.
_SETTINGS_GCODES = re.compile(r"\bg\s*0*(?:10|92(?:\.[123])?|52)\b", re.I)


def strip_gcode_comments(line: str) -> str:
    """Drop ``;`` trailing comments and ``(...)`` inline comments."""
    out, depth = [], 0
    for ch in line:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif ch == ";" and depth == 0:
            break
        elif depth == 0:
            out.append(ch)
    return "".join(out)


def check_line_attribution(source_text, line_numbers):
    """Are these motion line numbers actually lines of THIS program?

    LinuxCNC reports a motion's line number as the line within whichever file
    was executing — a called subroutine or an ngc/python remap. Those numbers
    collide with the main program's own numbering (``square.ngc`` line 7 is
    indistinguishable from the main file's line 7), and nothing in the canon
    or in ``stat`` says which file a queued motion came from: ``call_level``
    and ``stat.file`` track where the interpreter is READING, which runs ahead
    and is routinely back at level 0 while the sub's motion is still executing.

    So the number cannot be corrected — but it CAN be caught. A motion
    attributed to a main-file line that is blank, comment-only, or carries no
    motion G-code and no axis word did not come from that line. Any such hit
    means the whole attribution is untrustworthy: highlighting it would point
    the operator at an unrelated line (the observed case parks the highlight on
    ``g53.3`` forever and never reaches the ``o<...> call`` that is really
    running).

    Returns ``(untrusted, bad_lines, reason)``. Conservative in the safe
    direction: it only ever reports MORE doubt, never less.
    """
    cls = classify_motion_lines(source_text)
    n = len(cls)
    bad, out_of_range = [], 0
    for ln in sorted({int(v) for v in (line_numbers or []) if int(v) > 0}):
        if ln > n:
            out_of_range += 1
            bad.append(ln)
            continue
        # classify_motion_lines is the single source of "can this line
        # move" (W2 P6): LINE_NONE covers blank/comment lines AND axis
        # words that are arguments to pure settings codes (G10 L2 P1 X0
        # writes an offset, it moves nothing) — without that, a sub line
        # colliding with such a line stays trusted and the wrong highlight
        # survives.
        if cls[ln - 1] == LINE_NONE:
            bad.append(ln)
    if not bad:
        return False, [], ""
    why = []
    if out_of_range:
        why.append(f"{out_of_range} beyond the file's {n} lines")
    inrange = len(bad) - out_of_range
    if inrange:
        why.append(f"{inrange} on lines that cannot move the machine")
    return True, bad, (
        "motion line numbers come from a called subroutine or remap, not this "
        "file (" + ", ".join(why) + ")")


#: Motion codes that emit RAPID canon segments. G53.x and canned cycles are
#: deliberately NOT here — see classify_motion_lines.
_RAPID_ONLY_GCODES = re.compile(r"\bg\s*0*(?:0|28(?!\.)|30(?!\.))\b", re.I)
#: Motion codes that emit FEED canon segments.
_FEED_ONLY_GCODES = re.compile(
    r"\bg\s*0*(?:1|2|3|33(?:\.1)?|38(?:\.[2-5])?|73|76)\b", re.I)

#: classify_motion_lines kinds.
LINE_NONE, LINE_RAPID, LINE_FEED, LINE_EITHER = 0, 1, 2, 3


def parse_sub_marker(text):
    """Comment text -> ("start", name, caller|None) / ("end", None, None),
    or None.

    W2 P6: our shipped subroutines and the TWP remap wrappers carry
    `(WEBUI_SUB=<name>)` after their `o<...> sub` line and `(WEBUI_SUB_END)`
    before `endsub`. Comments are the one execution-ordered channel the
    preview canon receives from CALLED files, so these spans are how the
    worker knows which motion belongs to a sub — whose line numbers collide
    with the main file's and must never be highlighted there. Unmarked subs
    stay invisible (their motion falls to the line-classification tests),
    never guessed.

    W4: an optional `CALLER=<token>` after the name declares the main-file
    text that invokes this sub (e.g. `CALLER=g53.3` for a remap wrapper) —
    the verification token for call-site line attribution. The name is the
    first whitespace-separated token; markers without CALLER parse as
    before. o-word subs need no token (`o<name> call` is verifiable from
    the name alone).
    """
    m = _SUB_MARKER.match(text or "")
    if m:
        parts = m.group(1).strip().split()
        caller = None
        for p in parts[1:]:
            if p.upper().startswith("CALLER="):
                caller = p[len("CALLER="):].strip() or None
        return ("start", parts[0], caller)
    if _SUB_END_MARKER.match(text or ""):
        return ("end", None, None)
    return None


_SUB_MARKER = re.compile(r"^\s*WEBUI_SUB\s*=\s*([^)]+?)\s*$", re.IGNORECASE)
_SUB_END_MARKER = re.compile(r"^\s*WEBUI_SUB_END\s*$", re.IGNORECASE)


def classify_motion_lines(source_text):
    """Per-line motion classification of the MAIN program (W2 P6).

    Returns a list where entry i classifies source line i+1:

      LINE_NONE    cannot move the machine (blank, comment, settings-only)
      LINE_RAPID   commands rapid motion only (G0/G28/G30)
      LINE_FEED    commands feed motion only (G1/2/3/33/38.x/73/76)
      LINE_EITHER  could produce either stream: both kinds on one line,
                   bare axis words under a modal motion mode, canned cycles
                   (G81-89 emit rapids AND feeds from one line), or motion
                   codes with no fixed stream (G53.x entries).

    Per-point trust ANDs this against the canon stream a point sits in: a
    FEED point attributed to a rapid-only line (or vice versa) is a sub's
    colliding line number, not that line. Conservative in the safe
    direction — uncertainty classifies EITHER, which can only under-report
    doubt for a line that genuinely moves. Pure.
    """
    out = []
    for raw in (source_text or "").splitlines():
        src = strip_gcode_comments(raw).strip()
        if not src:
            out.append(LINE_NONE)
            continue
        rapid = bool(_RAPID_ONLY_GCODES.search(src))
        feed = bool(_FEED_ONLY_GCODES.search(src))
        if rapid and feed:
            out.append(LINE_EITHER)
        elif rapid:
            out.append(LINE_RAPID)
        elif feed:
            out.append(LINE_FEED)
        elif bool(_MOTION_GCODES.search(src)) or (
                bool(_AXIS_WORD.search(src)) and not _SETTINGS_GCODES.search(src)):
            # Moves, but the stream is not determined by the text alone.
            out.append(LINE_EITHER)
        else:
            out.append(LINE_NONE)
    return out


def line_trust_flags(line_numbers, cls, is_rapid_stream):
    """Per-point trust of one canon stream's line numbers (W2 P6). Pure.

    A point trusts its line iff the line exists in the main file, can move
    the machine, and its classified kind is compatible with the stream the
    point came from. The caller ANDs in sub-span membership separately.
    """
    n = len(cls)
    out = []
    for ln in line_numbers:
        ln = int(ln)
        if ln < 1 or ln > n:
            out.append(0)
            continue
        k = cls[ln - 1]
        if k == LINE_EITHER:
            out.append(1)
        elif k == LINE_NONE:
            out.append(0)
        else:
            out.append(1 if (k == LINE_RAPID) == bool(is_rapid_stream) else 0)
    return out


def resolve_sub_indices(seqs, sub_events, name_index):
    """Per-point subroutine index for one canon stream (W2 P6). Pure.

    seqs       -- the stream's ascending per-point seq list.
    sub_events -- [(seq, name | None)] in execution order; None = span end.
                  Marker convention: an event at seq N governs points with
                  seq > N (strict — same rule as every other marker).
    name_index -- {name: index}; points outside any span get 0xff.

    Nesting is a stack (a marked sub calling another marked sub reports the
    INNER name); an unbalanced end pops nothing.
    """
    out = []
    stack = []
    ei = 0
    n_ev = len(sub_events)
    for s in seqs:
        while ei < n_ev and sub_events[ei][0] < s:
            nm = sub_events[ei][1]
            if nm is None:
                if stack:
                    stack.pop()
            else:
                stack.append(nm)
            ei += 1
        out.append(name_index.get(stack[-1], 0xff) if stack else 0xff)
    return out


def _caller_site_re(name, caller_token):
    """Regex matching a comment-stripped MAIN-file line that invokes sub
    `name`: its `o<name> call` statement, or the marker-declared CALLER
    token (word-guarded so `g53.3` never matches `g53.36` and `g69` never
    matches `g69.1`). Pure."""
    pats = [r"^\s*o<" + re.escape(name) + r">\s*call\b"]
    if caller_token:
        pats.append(r"(?<![a-z0-9_.])" + re.escape(caller_token) + r"(?![0-9.])")
    return re.compile("|".join(pats), re.IGNORECASE)


def attribute_sub_callers(sub_events, source_text):
    """Verified call-site MAIN-file line per sub-span START event (W4).

    sub_events  -- canon triples [(seq, name|None, caller_token|None)];
                   name None = span end.
    source_text -- the main program's text.

    Returns (caller_by_event, unattributed_names): caller_by_event maps
    the EVENT INDEX of a depth-0 start event to the verified main-file
    line; unattributed_names lists depth-0 span names (first-seen order,
    deduped) with no attribution — the worker's stderr note. The display
    degrades to the sub-name chip there, never a guessed line.

    Rule: UNIQUE-site text scan only. A main-file line attributes iff it
    is the ONLY comment-stripped line invoking the sub (`o<name> call`, or
    the marker-declared CALLER token); zero or several sites yield no
    claim. No positional signal exists to disambiguate multiple sites —
    the interpreter fires next_line only for plainly-executed blocks,
    never for the o-call/remap trigger lines themselves (verified
    empirically, W4). Nested spans (depth > 0) are never attributed:
    their caller line lives in the OUTER sub's file, the very collision
    this machinery exists to avoid. Pure.
    """
    lines = [strip_gcode_comments(ln) for ln in (source_text or "").splitlines()]
    out = {}
    unattributed = []
    site_cache = {}
    depth = 0
    for idx, ev in enumerate(sub_events):
        name = ev[1]
        if name is None:
            depth = max(0, depth - 1)
            continue
        if depth == 0:
            key = (name, ev[2])
            if key not in site_cache:
                rx = _caller_site_re(name, ev[2])
                hits = [i + 1 for i, ln in enumerate(lines) if rx.search(ln)]
                site_cache[key] = hits[0] if len(hits) == 1 else None
            line = site_cache[key]
            if line is not None:
                out[idx] = line
            elif name not in unattributed:
                unattributed.append(name)
        depth += 1
    return out, unattributed


def resolve_sub_callers(seqs, sub_events, caller_by_event):
    """Per-point call-site line for one canon stream (W4). Pure.

    Same span-walk as resolve_sub_indices (event at seq N governs points
    with seq > N, strict). A point takes its OUTERMOST open span's verified
    caller line — the ultimate main-file cause of the motion; only depth-0
    events ever appear in caller_by_event, so inner spans contribute 0.
    Points outside any span, or under unverified spans, get 0 (= none).
    """
    out = []
    stack = []
    ei = 0
    n_ev = len(sub_events)
    for s in seqs:
        while ei < n_ev and sub_events[ei][0] < s:
            if sub_events[ei][1] is None:
                if stack:
                    stack.pop()
            else:
                stack.append(caller_by_event.get(ei, 0))
            ei += 1
        out.append(stack[0] if stack else 0)
    return out


_OCALL_RE = re.compile(r"^\s*o<([a-z0-9_.\-]+)>\s*call\b", re.IGNORECASE | re.MULTILINE)
_OSUB_RE = re.compile(r"^\s*o<([a-z0-9_.\-]+)>\s*sub\b", re.IGNORECASE | re.MULTILINE)


def find_unmarked_subs(source_text, search_dirs, max_read=65536):
    """Names of EXTERNAL `o<name> call` subroutines whose files carry no
    `(WEBUI_SUB=…)` marker (W3 P5 — the unmarked-sub advisory).

    The offline interpreter exposes no file identity, so motion inside an
    unmarked external sub carries THAT file's line numbers, which collide
    with the main program's — and can false-positively trust (the square
    demo lit main lines 4/6/7 from the sub's own numbering). No robust
    point-level counter-signal exists (the W2 P6 no-monotonicity decision
    is precedent against guessing), so this is a FILE-level advisory only:
    which called files lack markers. No per-point behavior changes; markers
    remain the only trust mechanism.

    source_text -- the main program's text.
    search_dirs -- resolved INI [RS274NGC]SUBROUTINE_PATH entries, in
                   order; first hit wins (LinuxCNC's own rule). A name
                   whose file cannot be found or read yields NO claim.

    Returns the unmarked names in first-call order, deduped.
    """
    in_file = {m.group(1).lower() for m in _OSUB_RE.finditer(source_text)}
    out = []
    seen = set()
    for m in _OCALL_RE.finditer(source_text):
        name = m.group(1).lower()
        if name in in_file or name in seen:
            continue
        seen.add(name)
        for d in search_dirs:
            path = os.path.join(d, name + ".ngc")
            if not os.path.isfile(path):
                continue
            try:
                with open(path, "r", errors="replace") as f:
                    text = f.read(max_read)
            except OSError:
                break   # unreadable ≠ unmarked — no claim
            if "WEBUI_SUB" not in text:
                out.append(name)
            break
    return out


#: Bare o-word subroutine name — no path separators ever (W5 subfile route).
SUBFILE_NAME_RE = re.compile(r"^[a-z0-9_.\-]+$", re.IGNORECASE)


def resolve_subfile(name, search_dirs):
    """Absolute path of `<name>.ngc` through the resolved SUBROUTINE_PATH
    dirs, first hit wins — LinuxCNC's own lookup rule (W5: source for the
    inline sub view). None unless the name is a bare o-word token AND the
    hit's realpath stays inside the dir it was found in (symlink/traversal
    containment). A first-dir hit that escapes containment yields None —
    never a fallback to a later dir the interpreter would not have used.
    """
    if not name or not SUBFILE_NAME_RE.match(name):
        return None
    for d in search_dirs:
        path = os.path.join(d, name + ".ngc")
        if not os.path.isfile(path):
            continue
        real = os.path.realpath(path)
        droot = os.path.realpath(d)
        try:
            contained = os.path.commonpath([real, droot]) == droot
        except ValueError:
            contained = False
        return path if contained else None
    return None


def resolve_subroutine_dirs(sub_path, ini_path):
    """Split an INI SUBROUTINE_PATH into absolute dirs (W3 P5). Colon-
    separated; `~` expanded; relative entries resolve against the INI's
    directory (LinuxCNC resolves relative to PROGRAM_PREFIX/config dir —
    the config dir is the honest approximation available here). Pure
    string work; existence is the caller's lookup concern."""
    dirs = []
    base = os.path.dirname(os.path.abspath(ini_path)) if ini_path else "."
    for d in (sub_path or "").split(":"):
        d = os.path.expanduser(d.strip())
        if not d:
            continue
        if not os.path.isabs(d):
            d = os.path.normpath(os.path.join(base, d))
        dirs.append(d)
    return dirs


def read_axis_limits(ini_find, axis_mask: int):
    """Per-axis soft limits from the active INI, for every axis in the mask.

    ini_find   -- callable(section, var) -> str | None (linuxcnc.ini().find)
    axis_mask  -- STAT.axis_mask bitmask (bit i = AXIS_LETTERS[i])

    Returns {letter: (min | None, max | None)} in INI machine units (linear
    axes) / degrees (rotary). AXIS_<letter> is preferred, JOINT_<n> is the
    fallback (n = the axis's position among the set mask bits — trivkins
    joint order, same rule the viewer_init axes list uses). A bound absent
    from both sections is None = unbounded (LinuxCNC's own default is
    ±1e99); an axis with neither bound is omitted entirely.
    """
    letters = [AXIS_LETTERS[i] for i in range(9) if axis_mask & (1 << i)]
    limits = {}
    for joint_idx, letter in enumerate(letters):
        def bound(var):
            for section in (f"AXIS_{letter}", f"JOINT_{joint_idx}"):
                raw = ini_find(section, var)
                if raw is not None:
                    try:
                        return float(raw)
                    except (TypeError, ValueError):
                        continue
            return None
        mn = bound("MIN_LIMIT")
        mx = bound("MAX_LIMIT")
        if mn is not None or mx is not None:
            limits[letter] = (mn, mx)
    return limits


def check_limit_violations(segments, limits, unit_scale: float = 1.0,
                           max_report: int = 200):
    """Check canon motion segments against per-axis soft limits.

    segments   -- iterable of (lineno, start9, end9, tlo3): start9/end9 =
                  canon tuples in canon linear units (inches) / degrees,
                  machine frame (g5x + g92 + rotation applied); tlo3 =
                  (xo, yo, zo) tool offset in effect, added back to X/Y/Z
                  because soft limits act on the JOINT, not the tool tip
                  (G43 Z joint = tip + length).

    Attribution rule: a segment flags an axis only when that axis MOVES in
    the segment (start != end in the machine frame) — the line that parks A
    at -104 is the culprit; the 500 lines that follow with A still sitting
    there are not re-flagged. Exact comparison is safe: parked axes pass
    through rotate_and_translate deterministically, and under XY rotation a
    "parked" program axis that still produces machine-frame motion is real
    motion, correctly flagged.
    limits     -- {letter: (min | None, max | None)} in machine units, from
                  read_axis_limits(). Rotary bounds are degrees.
    unit_scale -- canon → machine-unit factor for LINEAR axes (25.4 on a mm
                  machine); rotary values are degrees on both sides.
    max_report -- cap on returned records. Aggregation is per (line, axis):
                  one record per source line per axis, keeping the worst
                  excursion, so an arc tessellated into 64 segments reports
                  once.

    Returns (records, total): records sorted by line then axis order, each
    {"line", "axis", "value", "limit", "kind": "min"|"max"} with values
    rounded to 4 decimals; total = distinct (line, axis) pairs in violation,
    which exceeds len(records) when max_report truncates.
    """
    if not limits:
        return [], 0
    # Dense per-axis plan so the inner loop does no dict/string work.
    plan = []
    for idx, letter in enumerate(AXIS_LETTERS):
        bounds = limits.get(letter)
        if bounds is None:
            continue
        mn, mx = bounds
        scale = 1.0 if letter in _ROTARY_AXES else unit_scale
        plan.append((idx, letter, scale,
                     None if mn is None else mn - _LIMIT_EPS,
                     None if mx is None else mx + _LIMIT_EPS,
                     mn, mx))
    worst = {}  # (line, axis_idx) -> [value, limit, kind, letter]
    for lineno, start, end, tlo in segments:
        n = len(end)
        for idx, letter, scale, mn_eps, mx_eps, mn, mx in plan:
            if idx >= n:
                continue
            v = end[idx]
            # start=None = UNKNOWN-PATH segment (W3 P1: a suppressed
            # first-move endpoint) — the machine moves there via a path no
            # parse can know, so every axis counts as moved-to and the
            # parked-axis attribution skip must not hide an out-of-bounds
            # endpoint.
            if start is not None and idx < len(start) and start[idx] == v:
                continue  # axis parked this segment — culprit line already flagged
            if idx < 3 and tlo is not None:
                v += tlo[idx]
            v *= scale
            if mn_eps is not None and v < mn_eps:
                key = (lineno, idx)
                rec = worst.get(key)
                if rec is None:
                    worst[key] = [v, mn, "min", letter]
                elif rec[2] == "min" and v < rec[0]:
                    rec[0] = v
            elif mx_eps is not None and v > mx_eps:
                key = (lineno, idx)
                rec = worst.get(key)
                if rec is None:
                    worst[key] = [v, mx, "max", letter]
                elif rec[2] == "max" and v > rec[0]:
                    rec[0] = v
    total = len(worst)
    records = [
        {"line": line, "axis": rec[3], "value": round(rec[0], 4),
         "limit": round(rec[1], 4), "kind": rec[2]}
        for (line, _idx), rec in sorted(worst.items())
    ]
    return records[:max_report], total
