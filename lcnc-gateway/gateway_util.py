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
}
_KINS_PARAM_PINS = (
    "x-rot-point", "y-rot-point", "z-rot-point",
    "x-offset", "y-offset", "z-offset",
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
    params = {}
    prefix = module + "."
    for line in halcmd_values or []:
        parts = str(line).split()
        if len(parts) != 3 or parts[0] != "setp" or not parts[1].startswith(prefix):
            continue
        pin = parts[1][len(prefix):]
        if pin not in _KINS_PARAM_PINS:
            continue
        try:
            params[pin.replace("-", "_")] = float(parts[2])
        except ValueError:
            continue
    return {
        "module": module,
        "type": _KINS_FAMILY.get(module, module),
        "identity_first": identity_first,
        "params": params,
    }


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


def kins_world_flags(seqs, events, identity_first):
    """Per-segment world-mode flags from execution-ordered marker events.

    `seqs`: segment sequence numbers (any order); `events`: [(seq_at_marker,
    kinstype)] as recorded by the canon — a marker seen at canon seq N
    applies to segments with seq > N. Startup kinstype is 0 (switchkins
    boot default). Mapping (matches the kins module's sparm semantics):
    identity_first => type 1 is the world kins; plain => type 0 is. Type 2
    (userk) defaults to identity math in the stock template — treated as
    identity. Two markers can share a seq (back-to-back toggles with no
    motion between): the LAST recorded one governs, so the sort must key
    on seq alone — a plain tuple sort would reorder same-seq events by
    kinstype. Returns a list of 0/1 ints aligned with `seqs`. Pure.
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
        out.append(1 if (k == 1 if identity_first else k == 0) else 0)
    return out


def kins_marker_policy(kins_cfg):
    """What `(WEBUI_KINSTYPE=n)` markers mean under the declared kins.

    'ignore'    — trivkins or no [KINS] declaration: the machine cannot
                  switch kins, so markers are stale noise (a program
                  written for a TCP machine, or a hand-typed comment).
                  Emitting mode flags here would gut the identity limit
                  check and mislabel the whole track (startup type 0 maps
                  to "world" without sparm=identityfirst).
    'twin'      — a world twin exists (_TRT_LETTERS): full joint-side
                  world checking.
    'unchecked' — a declared non-trivial module without a twin: the
                  switches are real, so mode flags ship, but world
                  segments cannot be limit-checked and must be reported
                  as an explicit unchecked count, never as clean. Pure.
    """
    if kins_cfg is None or kins_cfg.get("type") == "trivkins":
        return "ignore"
    return "twin" if kins_cfg.get("type") in _TRT_LETTERS else "unchecked"


def kins_pivot_warning(kins_cfg):
    """Reason string when a trt-family kins is declared with ZERO pivot
    params parsed from [HAL]HALCMD (review D4).

    parse_kins_config reads setp lines from the INI's [HAL]HALCMD ONLY —
    the normal .hal-file `setp xyzac-trt-kins.y-offset …` idiom configures
    the real kins but is invisible here, so the viewer's TCP math would
    silently run with every pivot at zero. A machine genuinely pivoted at
    the origin silences this with explicit `HALCMD = setp … 0` lines.
    None when params are present or the kins has no twin. Pure.
    """
    if kins_cfg and kins_marker_policy(kins_cfg) == "twin" and not kins_cfg.get("params"):
        return (f"{kins_cfg.get('module')} declared but no pivot setp lines in "
                f"[HAL]HALCMD — viewer TCP math would use pivot zeros; put the "
                f"setp lines in the INI (README: 5-Axis and TCP)")
    return None


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
            if jmax[jno] - jmin[jno] <= _JOINT_MOVE_EPS:
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
                "limit": worst[(ln, ax)][1], "kind": worst[(ln, ax)][2]}
               for ln, ax in keys[:max_report]]
    return records, len(keys)


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
            if idx < len(start) and start[idx] == v:
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
