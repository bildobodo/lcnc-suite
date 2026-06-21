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
    - A literal `*` in either list → allow any browser origin.
    - Otherwise → reject.

    The explicit allowlist ADDS to the same-host default rather than replacing
    it, so configuring it can never lock out the gateway's own page.
    """
    if not origin:
        return True
    if _origin_host_matches(origin, host):
        return True
    if allowlist:
        allowset = set(allowlist)
        if "*" in allowset or origin in allowset:
            return True
    if extra_allowed:
        extraset = set(extra_allowed)
        if "*" in extraset or origin in extraset:
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
