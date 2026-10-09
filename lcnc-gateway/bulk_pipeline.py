"""Bulk data pipeline (M4).

Owns the heavy, versioned, immutable cached payloads and the parse-subprocess
lifecycle behind them:

- **G-code preview**: parsed once per file/mtime change in an isolated
  subprocess (gcode_parse_worker.py — own interpreter, own GIL), published as
  PASSTHROUGH bytes (never decoded in the gateway: decoding inflated the
  multi-MB polylines into hundreds of thousands of tracked objects and drove
  the gen-0/1 GC stalls), gzip-compressed once, served via GET /preview.
- **Surface points / compensation grid**: file readers + msgpack-encoded
  cached bytes served via GET /surface_points and GET /comp_grid.
- **CAM tool-library decode**: size-routed offload (thread for small
  blobs, subprocess for large — the harness proved in-thread decode of a
  near-cap library trips the HAL watchdog).

Publication contract (the plan's wording, enforced in every publish path
here): build ALL data first, swap payload and metadata together, increment
the version LAST — so a reader that sees version N always sees N's bytes.

Orchestration stays in gateway.py (the poller decides WHEN to refresh;
routes serve the bytes; the ws loop pings versions). Dependencies are
injected: STAT accessor, machine-units resolver, WCS rotation patch builder.
This module never imports gateway.
"""
import asyncio
import copy
import gzip
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from typing import Any, Callable, Optional

import msgspec as _msgspec

import lcnc_trace as _trace
from tool_import import decode_tool_blob
from gateway_util import (AXIS_LETTERS, PIN_UNSUPPORTED_EXIT, evaluate_limits_drift,
                          evaluate_start_drift, evaluate_tlo_drift, evaluate_wcs_offset_drift,
                          program_source, rotary_seed_values, start_tlo_seed)

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GCODE_WORKER_PATH = os.path.join(_BASE_DIR, "gcode_parse_worker.py")
TOOL_IMPORT_WORKER_PATH = os.path.join(_BASE_DIR, "tool_import.py")
TOOL_IMPORT_INLINE_MAX = 1 << 20   # <=1 MiB decodes in ~15 ms — a thread is fine


def ctx_digest(ctx: Optional[dict]) -> Optional[str]:
    """A parse context's fingerprint — its start basis; the tool TABLE is
    read live by the worker and bound apart (plan „Prüfung im Lauf“ 1b).
    Canonical JSON, `nice` left out (a priority, no input)."""
    if ctx is None:
        return None
    body = {k: v for k, v in ctx.items() if k != "nice"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=repr).encode()).hexdigest()


async def terminate_parse_proc(proc) -> None:
    """Terminate an in-flight parse subprocess, bounded so a stuck child can't
    hang the deterministic shutdown: SIGTERM, wait ≤1 s, then SIGKILL. wait() is a
    blocking stdlib Popen call (B7), so it's offloaded via to_thread. No-op when the
    proc is None or already exited. Callers pass a LOCAL handle (captured before any
    concurrent refresh's finally can clear the published attribute), so the child is
    always either live (terminate works) or already reaped (poll short-circuits)."""
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=1.0)
    except asyncio.TimeoutError:
        proc.kill()
        await asyncio.to_thread(proc.wait)


def _write_verify_blob(blob: bytes) -> str:
    """The published payload as a temp file for a VERIFY parse (VP-I20): the
    worker reads and decodes it — the gateway never decodes a payload."""
    fd, path = tempfile.mkstemp(prefix="lcnc-preview-verify-", suffix=".mpk")
    with os.fdopen(fd, "wb") as f:
        f.write(blob)
    return path


class BulkPipeline:
    def __init__(
        self,
        *,
        get_stat: Callable[[], Any],
        get_machine_units: Callable[[], str],
        build_wcs_rotation_patches: Callable[[], dict],
        get_live_kins: Optional[Callable[[], tuple]] = None,
        get_wcs_off_flat: Optional[Callable[[], Optional[list]]] = None,
        get_toolsetter_ctx: Optional[Callable[[], Optional[dict]]] = None,
        get_run_basis: Optional[Callable[[], Optional[dict]]] = None,
    ) -> None:
        self._get_stat = get_stat
        # The run in progress (the gateway's run_basis, plan „Prüfung im
        # Lauf“ 1a) — a pinned parse's run binding is checked against it
        # again at the publish. None: no run (tests, idle).
        self._get_run_basis = get_run_basis or (lambda: None)
        self._get_machine_units = get_machine_units
        self._build_wcs_rotation_patches = build_wcs_rotation_patches
        # Live WCS-offset snapshot in the worker's __WCSOFF__ shape (the
        # gateway's fixture cache + g92) — captured at spawn so a touch-off
        # DURING the parse can be recognised as staling it. None = no claim.
        self._get_wcs_off_flat = get_wcs_off_flat or (lambda: None)
        # (live switchkins type, live plane frame [p,t1,t2]) for the parse
        # ctx — the fifth freshness input. Default (None, None): untracked
        # (non-switchable configs, tests) — the worker then seeds nothing
        # and the drift edge makes no claim.
        self._get_live_kins = get_live_kins or (lambda: (None, None))
        # The toolsetter basis for the parse ctx (M600 plan, section 2:
        # gateway_util.toolsetter_ctx). None: the worker reads the file as
        # it is (tests, a gateway without the bookkeeping).
        self._get_toolsetter_ctx = get_toolsetter_ctx or (lambda: None)

        # ---- G-code preview (passthrough bytes; GET /preview) ----
        self.preview_pending: Optional[dict] = None   # {"file"} metadata only — consumers only read .get("file")
        # The RUNNING parse (2026-09-05, cancel-and-restart): its input
        # snapshot in the published seeds' shapes — {"file", "reason",
        # "t0" (monotonic), "started_ms" (wall), "expected_ms",
        # "rotary_seed" ({letter: deg} | None), "kins_seed" ({"type",
        # "frame"}), "wcs_off" (flat list | None)} — so the poller can tell
        # whether an edge raised DURING the parse stales it (then cancels
        # it instead of queueing a second full parse behind it). None when
        # nothing runs. Also the source of the status wire's
        # `preview_refresh` (the operator's banner).
        self.inflight: Optional[dict] = None
        # Live rotary pose hold {"abc", "since"} (rotary_hold_update, every
        # tick): a (re)parse may only START once the pose has held still —
        # and `reparse_wait_noted` keeps the deferral trace to one line.
        self.rotary_hold: Optional[dict] = None
        self.reparse_wait_noted = False
        # Set by cancel_inflight; read by refresh_gcode_preview after the
        # worker exits to trace the cancel instead of a worker failure.
        self.cancel_reason: Optional[str] = None
        # Last measured publish time per file path (ms) — the expected
        # duration the banner shows and the timeout scale.
        self.parse_ms_by_file: dict = {}
        self.superseded_total: int = 0
        # The edge that set reparse_pending from the in-flight supersede —
        # the restart is scheduled under it (banner + trace), not "reparse".
        self.reparse_pending_reason: Optional[str] = None
        # Versions seeded from startup time so ?v= URLs don't collide across restarts.
        self.preview_version: int = int(time.time())
        self.last_file: Optional[str] = None          # edge detection in poller
        # The text the published preview was parsed from (program_source), or
        # None: nothing published, or the file changed during that parse —
        # Run from line binds to it (Codex R17 XZ-07).
        self.published_source: Optional[str] = None
        self.last_mtime: Optional[float] = None       # re-parse on in-place edits of the same path
        # Wire-format stamp of the PUBLISHED payload (P1), parsed from the
        # worker's `__SCHEMA__` stderr line — the payload bytes are passthrough
        # and never decoded here. None = published by a worker that emitted no
        # stamp (pre-P1 code on disk) or nothing published yet. The poller
        # compares it against gateway_util.PREVIEW_SCHEMA and auto-reparses on
        # mismatch, latched via schema_reparse_attempted so a persistent
        # disagreement (gateway process older/newer than the worker on disk)
        # reparses ONCE per (file, mtime) and then leaves the loud client
        # banner standing instead of respawning workers every poll tick.
        self.published_schema: Optional[int] = None
        self.schema_reparse_attempted: Optional[tuple] = None
        # Parse-time TLO snapshot of the published payload (W2 P4), from the
        # worker's `__TLO__` stderr line: {"table_path", "table_mtime",
        # "tlos": [[tool, xo, yo, zo]…]}. The poller's idle-gated drift edge
        # (evaluate_tlo_drift) auto-reparses when the tool table moves after
        # a parse — the stale-flags defect (11,532 false Z-max flags after a
        # toolsetter re-measure). None = legacy worker / nothing published.
        self.published_tlo: Optional[dict] = None
        # The TOOL BASIS of the published payload (VP-I20, plan Fassungen
        # 4–6): {"xyz", "mode"} — its own start (`tlo_start`) when it was
        # published; the live start a VERIFY parse confirmed since (the
        # payload, normalised to it, gives every consumer the same inputs as
        # a fresh parse there). None = nothing published or an unknown start.
        # The idle start edge compares the live start with this; a pinned
        # parse seeds it.
        self.tool_basis: Optional[dict] = None
        # Bumped by every change of tool_basis — a verify confirms a basis
        # without a new payload version (Prüfung im Lauf, R113): the run
        # binding names the basis revision, not the version alone.
        self.tool_basis_rev: int = 0
        # Where the published payload comes from (plan „Prüfung im Lauf“ 1b):
        # version, file, source, reason, pinned, the run it was planned for,
        # the tool table it read. None: nothing published.
        self.published_origin: Optional[dict] = None
        # Parse-time rotary seed of the published payload (W6), from the
        # worker's `__ABCSEED__` stderr line: {letter: degrees} the sync
        # initcode posed uncommanded rotaries at. The same idle drift edge
        # auto-reparses when the live pose leaves it — the arc-vs-plunge
        # class (a run parks the table tilted; the cached preview still
        # orients from the parse-time pose). None = no rotary sync
        # (3-axis config) — no edge, honestly.
        self.published_rotary_seed: Optional[dict] = None
        # Rotary-command boundary of the published payload (2026-09-11),
        # from the worker's `__ROTCMD__` line: {"A": seq|None, ..,
        # "unknown": seq|None, "seed": {..}} — the hook for the follow-on
        # that skips the rotary reparse when the drifted axes are never
        # commanded. None = no rotary seed / legacy worker.
        self.published_rotary_cmd: Optional[dict] = None
        # Soft-limit window the published payload was checked against
        # (2026-09-12), from the worker's `__LIMITS__` line: {"source":
        # "live"|"ini", "limits": {letter: [min, max]}}. The limits drift
        # edge reparses when the LIVE joint window leaves a live-sourced
        # one. None = legacy worker / nothing published.
        self.published_limits: Optional[dict] = None
        # Parse-time switchkins state of the published payload (fifth
        # freshness input), from the worker's `__KINSSEED__` stderr line:
        # {"type": int|None, "frame": [p,t1,t2]|None} — what the parse
        # ASSUMED. The idle drift edge auto-reparses when the live
        # switchkins type (or, in TOOL kins, the plane-frame pins) leaves
        # it — the 855-unit class (M2 restores G54 but not the kins type).
        # None / type None = untracked — no edge, honestly.
        self.published_kins_seed: Optional[dict] = None
        # Parse-time WCS-offset snapshot (99-entry flat: 9 rows × xyzabc
        # uvw+r, then g92) from the worker's `__WCSOFF__` line. The
        # offset-drift edge reparses when a touch-off moves any of them —
        # offsets change with NO pose change, so no other edge sees it
        # (the rotary Zero-All double-count class). None = no claim.
        self.published_wcs_off: Optional[list] = None
        # The worker ctx the PUBLISHED payload was parsed with (operator
        # 2026-09-29): the mid-run tool-table edge re-parses with this start
        # state pinned — fixture, WCS patches, kins — plus the published
        # rotary seed and tool seed, so a run's own G10 / M428 / A moves never
        # leak into the program's start. None = nothing published.
        self.published_ctx: Optional[dict] = None
        # The parameter BASIS the published payload ran on, from the worker's
        # `__PARAMS__` line: {"text": the var file's raw text before the live
        # fixture patches, "g92": [..]} (Codex R40 MR-I02 — G92, G28/G30 and
        # every other numbered parameter a pinned re-parse must not re-read
        # from a file the running program has persisted since).
        self.published_params: Optional[dict] = None
        # The worker's `__TOOLSETTER__` line (M600 plan, section 2): {"routine":
        # the program runs the bundled tool_touch_off.ngc, "writes": the
        # toolsetter keys its text may write, null = any}. None = unknown.
        self.published_toolsetter: Optional[dict] = None
        # This config cannot pin a start state (random toolchanger — the
        # worker refused with PIN_UNSUPPORTED_EXIT): the mid-run edge stops
        # asking; the preview stays stale-marked until idle (MR-I01).
        self.pin_unsupported: bool = False
        # The published payload's tool table is known stale and no re-parse
        # can fix it before idle (Codex R41 MR-I04): {"reason": the drift
        # signal, "why": "unsupported" | "no-basis"}. Rides the status
        # envelope as `preview_table_stale`, so the viewer keeps the path
        # muted and says why — whichever tool changed. Cleared by the next
        # publish and by unload.
        self.table_stale: Optional[dict] = None
        # Previous drift check's live rotary sample — the settle guard
        # (rotary_drift_settled) compares consecutive 2 s samples so a
        # jog in progress never triggers a reparse.
        self.rotary_check_prev: Optional[list] = None
        # Previous drift check's live WCS-offset flat — burst settle for
        # multi-G10 touch-offs (Zero All writes six in a row).
        self.wcsoff_check_prev: Optional[list] = None
        self.tlo_check_ts: float = 0.0   # drift-edge debounce (monotonic)
        self.refresh_running: bool = False            # single-flight guard
        # Operator Reparse arrived while a parse was in flight: the finishing
        # parse rewrites last_file/last_mtime, so a key-clearing request was
        # silently swallowed (replied ok, nothing respawned). The poller
        # schedules one more refresh when this is set and nothing is running.
        self.reparse_pending: bool = False
        self.preview_bytes: Optional[bytes] = None    # raw copy kept ONLY when no gz exists (<4 KiB payloads)
        self.preview_bytes_gz: Optional[bytes] = None # pre-compressed once per parse
        self.preview_raw_len: int = 0                 # uncompressed size (for traces)
        self.gcode_parse_proc: Optional[subprocess.Popen] = None  # for lifespan termination

        # ---- Surface points / comp grid (msgpack bytes; GET routes) ----
        self.surface_pending: Optional[list] = None   # latest surface scan points; None = never scanned
        self.surface_version: int = int(time.time())
        self.surface_initialized: bool = False        # True after startup file-read attempted
        self.surface_bytes: Optional[bytes] = None
        self.grid_pending: Optional[dict] = None      # latest parsed probe-results-grid.json
        self.grid_version: int = int(time.time())
        self.grid_initialized: bool = False
        self.grid_bytes: Optional[bytes] = None
        self.last_comp_hal_ver: Optional[int] = None  # last seen compensation.grid-version HAL value
        self.caches_ini: Optional[str] = None         # INI the caches were populated for (issue #29)

        # ---- CAM import worker ----
        self.tool_import_proc: Optional[subprocess.Popen] = None

    # ---- preview ----

    @staticmethod
    def basis_of(tlo_meta: Optional[dict]) -> Optional[dict]:
        """The start a parse was seeded with, from its __TLO__ meta, as a tool
        basis {"xyz", "mode"} — None for an unknown start or an older
        worker's meta (no start fields)."""
        if not tlo_meta or not tlo_meta.get("start_known") or tlo_meta.get("tlo_start") is None:
            return None
        return {"xyz": list(tlo_meta["tlo_start"]), "mode": tlo_meta.get("start_mode")}

    def tool_basis_status(self) -> Optional[dict]:
        """The status wire's `preview_tool_basis` (VP-I20): the verified tool
        basis, bound to the published file + version, while it differs from
        the payload's own `tlo_start` — absent otherwise (the client then
        resolves to `tlo_start`)."""
        tlo = self.published_tlo or {}
        b = self.tool_basis
        if not b or not self.preview_available() or not tlo.get("start_known"):
            return None
        if b.get("xyz") == tlo.get("tlo_start") and b.get("mode") == tlo.get("start_mode"):
            return None
        return {"file": self.last_file, "version": self.preview_version,
                "xyz": list(b["xyz"]), "mode": b.get("mode")}

    def live_start(self, stat=None) -> Optional[dict]:
        """The live start tool state (start_tlo_seed of the live STAT), or
        None without a status."""
        stat = stat if stat is not None else self._get_stat()
        if stat is None:
            return None
        return start_tlo_seed(getattr(stat, "tool_offset", None), getattr(stat, "gcodes", None),
                              getattr(stat, "axis_mask", 0))

    def preview_available(self) -> bool:
        """A preview is servable when either variant exists — the raw copy is
        dropped once the gz exists (every real browser sends Accept-Encoding:
        gzip; a rare non-gzip client gets an on-demand decompress in
        get_preview)."""
        return self.preview_bytes is not None or self.preview_bytes_gz is not None

    def schedule_refresh(self, filepath: str, reason: str, spawn, pinned: bool = False,
                         run: Optional[dict] = None) -> bool:
        """Single-flight scheduler — the ONE place refresh_running goes True.

        `spawn(coro) -> asyncio.Task` is supplied by the gateway (its
        register_bg_task + create_task). Exception-safe: a spawn that raises
        (loop shutting down) resets the flag and traces, and a task cancelled
        before it ever ran (lifespan teardown) resets it from the done
        callback — the coroutine's own `finally` never executes in that case.
        Previously four inline `flag = True; create_task(...)` sites could
        latch the flag forever and silently kill every preview edge.
        Returns True when a refresh was scheduled."""
        if self.refresh_running:
            return False
        self.refresh_running = True
        self.reparse_pending = False
        self.reparse_pending_reason = None
        try:
            task = spawn(self.refresh_gcode_preview(filepath, reason=reason, pinned=pinned, run=run))
        except BaseException as e:
            self.refresh_running = False
            _trace.emit("gcode.refresh_schedule_failed", level="warn",
                        file=filepath, reason=reason,
                        exc=type(e).__name__, msg=str(e))
            if not isinstance(e, Exception):
                raise
            return False

        def _done(t):
            if t.cancelled() and self.refresh_running:
                # Cancelled before its first step: no finally ran.
                self.refresh_running = False
                self.gcode_parse_proc = None
        try:
            task.add_done_callback(_done)
        except AttributeError:
            pass  # spawn returned no task handle — the coroutine's finally is the only reset
        _trace.emit("gcode.refresh_scheduled", file=filepath, reason=reason,
                    **({"pinned": True} if pinned else {}))
        return True

    def clear_preview(self) -> None:
        """Unload contract: drop all preview payloads together, THEN bump the
        version so every client's status loop sends an empty viewer_gcode."""
        self.preview_pending = None
        self.preview_bytes = None
        self.preview_bytes_gz = None
        self.preview_version += 1
        self.last_file = None
        self.last_mtime = None
        self.published_schema = None
        self.schema_reparse_attempted = None
        self.published_tlo = None
        self._set_tool_basis(None)
        self.published_origin = None
        self.published_rotary_seed = None
        self.published_kins_seed = None
        self.published_wcs_off = None
        self.published_source = None
        self.published_limits = None
        self.published_ctx = None
        self.published_params = None
        self.published_toolsetter = None
        self.table_stale = None
        self.rotary_check_prev = None
        self.wcsoff_check_prev = None

    def invalidate_caches_for_ini(self, cur_ini: Optional[str]) -> None:
        """INI-change invalidation (issue #29): if the active INI changed under
        a persistent gateway, the surface/comp caches hold the previous
        config's data. Reset the init flags + clear pending/bytes and bump
        versions so clients refetch — the poller's init blocks then reload
        from the new config's result files (or stay empty)."""
        if cur_ini and self.caches_ini is not None and self.caches_ini != cur_ini:
            self.surface_initialized = False
            self.grid_initialized = False
            self.surface_pending = None
            self.surface_bytes = None
            self.grid_pending = None
            self.grid_bytes = None
            self.surface_version += 1
            self.grid_version += 1
            _trace.emit("cache.ini_changed_invalidated", old=self.caches_ini, new=cur_ini)
        if cur_ini:
            self.caches_ini = cur_ini

    def _run_gcode_worker_blocking(self, ctx_bytes: bytes, timeout: float):
        """Spawn the parse worker and run it to completion. Runs in a worker thread
        (via asyncio.to_thread) so the fork happens OFF the event loop — B7.

        asyncio.create_subprocess_exec forks the (large) gateway process
        synchronously on the loop; under load that copy-on-write fork + pipe
        registration stalled the loop ~60 ms (#35 attribution: a 62 ms
        _SelectorTransport._add_reader). stdlib subprocess.Popen here forks inside
        the thread (the fork syscall releases the GIL, so the loop keeps running) and
        uses posix_spawn where the platform allows, which is cheaper still. The Popen
        handle is published to gcode_parse_proc so lifespan shutdown can terminate an
        in-flight parse. Returns (returncode, stdout, stderr); raises
        subprocess.TimeoutExpired on timeout (child already killed + reaped)."""
        proc = subprocess.Popen(
            [sys.executable, GCODE_WORKER_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.gcode_parse_proc = proc
        try:
            stdout, stderr = proc.communicate(input=ctx_bytes, timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()  # reap the killed child so it doesn't zombie
            raise
        return proc.returncode, stdout, stderr

    #: Size-based parse estimate when a file has no history: ~48 s for the
    #: 40 MB / 1.18 M-line perf-matrix program on the dev VM (machine
    #: frame, after the 2026-09-05 speed-ups it is well under that — the
    #: estimate only has to bound the timeout and seed the first banner).
    _PARSE_MS_PER_BYTE = 1.2e-3
    _PARSE_TIMEOUT_FLOOR_S = 60.0
    _PARSE_TIMEOUT_FACTOR = 3.0

    #: A pinned (mid-run) parse runs niced: on a real machine it yields CPU
    #: to LinuxCNC's task feeding the motion queue — a priority, no guarantee
    #: for real-time, memory or I/O latency. nice 19 rather than SCHED_IDLE
    #: (weaker still): a machine PC rendering its own HMI browser would give
    #: an idle-class parse very little.
    PINNED_NICE = 19
    #: ... and gets a longer leash: niced under a busy run it may take a
    #: multiple of its idle time. Its duration never enters the history.
    _PINNED_TIMEOUT_FACTOR = 3.0

    def _set_tool_basis(self, basis: Optional[dict]) -> None:
        if basis != self.tool_basis:
            self.tool_basis_rev += 1
        self.tool_basis = basis

    def start_ctx(self, filepath: str) -> Optional[dict]:
        """A run's start context (plan „Prüfung im Lauf“ 1b): what pinned_ctx
        would build NOW, copied whole — a pinned parse during the run is built
        from it, never from a publication made after the start. None when
        nothing is published for this file."""
        ctx = self.pinned_ctx(filepath)
        return copy.deepcopy(ctx) if ctx is not None else None

    def run_start_check(self, filepath: Optional[str], stat, source_now: Optional[str],
                        open_drift: Optional[str] = None) -> tuple:
        """Is the published preview this program's START, for a run about to
        start (plan 1a)? (verified, why). A direct comparison of the
        controller's state now with the published parse's start basis —
        fixture and its table, G92, kinematics, rotary seed, tool start —
        and every drift edge evaluated now, without its debounce or settle
        guard (the tool table, the WCS snapshot, the soft-limit window, and
        `open_drift`, the caller's own: the toolsetter book). Whatever cannot
        be compared is not verified."""
        if not filepath or self.last_file != filepath or not self.preview_available():
            return False, "no publication of this program"
        if self.refresh_running or self.reparse_pending:
            return False, "a parse runs or is pending"
        if open_drift:
            return False, f"drift open: {open_drift}"
        if self.published_source is None or source_now != self.published_source:
            return False, "the program text is not the published one"
        ctx = self.pinned_ctx(filepath)
        if ctx is None:
            return False, "no published start"
        if stat is None:
            return False, "no controller status"
        if getattr(stat, "g5x_index", None) != ctx.get("g5x_index"):
            return False, "another fixture"
        if self._build_wcs_rotation_patches() != ctx.get("var_patches"):
            return False, "another fixture table"
        g92 = getattr(stat, "g92_offset", None)
        pg = (self.published_params or {}).get("g92")
        if g92 is None or pg is None or len(g92) < len(pg) or any(abs(float(a) - float(b)) > 1e-9 for a, b in zip(g92, pg)):
            return False, "another G92"
        if tuple(self._get_live_kins()) != (ctx.get("kins_type"), ctx.get("kins_frame")):
            return False, "another kinematics state"
        live_rot = rotary_seed_values(getattr(stat, "axis_mask", 0) or 0, getattr(stat, "actual_position", None))
        pub_rot = self.published_rotary_seed
        if (live_rot is None) != (pub_rot is None) or (live_rot and (
                set(live_rot) != set(pub_rot) or any(abs(live_rot[k] - pub_rot[k]) > 0.01 for k in live_rot))):
            return False, "another rotary pose"
        live = self.live_start(stat)
        if live is None or self.tool_basis is None or evaluate_start_drift(self.published_tlo, self.tool_basis, live) is not None:
            return False, "another tool start"
        meta = self.published_tlo or {}
        tpath = meta.get("table_path")
        try:
            t_now = os.path.getmtime(tpath) if tpath else None
        except OSError:
            t_now = None
        if meta.get("table_mtime") is not None and t_now is None:
            return False, "tool table not readable"
        try:
            rows = [(int(t.id), float(t.zoffset)) for t in (getattr(stat, "tool_table", None) or [])]
        except (AttributeError, TypeError, ValueError):
            return False, "tool table rows not readable"
        d = evaluate_tlo_drift(meta, t_now, getattr(stat, "tool_in_spindle", None), table_rows=rows)
        if d:
            return False, f"drift open: {d}"
        d = evaluate_wcs_offset_drift(self.published_wcs_off, self._get_wcs_off_flat())
        if d:
            return False, f"drift open: {d}"
        mask = int(getattr(stat, "axis_mask", 0) or 0)
        letters = [AXIS_LETTERS[i] for i in range(9) if mask & (1 << i)]
        jl = []
        for j in getattr(stat, "joint", None) or ():
            mn = j.get("min_position_limit") if isinstance(j, dict) else None
            mx = j.get("max_position_limit") if isinstance(j, dict) else None
            jl.append([float(mn), float(mx)] if isinstance(mn, (int, float))
                      and isinstance(mx, (int, float)) else None)
        d = evaluate_limits_drift(self.published_limits, jl[:len(letters)], letters)
        if d:
            return False, f"drift open: {d}"
        return True, None

    def preview_origin_status(self) -> Optional[dict]:
        """The status wire's `preview_origin` (plan 1b): the published
        payload's origin, and the tool basis revision now — present while a
        preview is published."""
        if self.published_origin is None or not self.preview_available():
            return None
        return {**self.published_origin, "tool_basis_rev_now": self.tool_basis_rev}

    def pinned_ctx(self, filepath: str) -> Optional[dict]:
        """The worker ctx for a PINNED re-parse of `filepath`: the published
        parse's ctx (fixture index, WCS var patches, kins type/frame), its
        parameter basis (`param_text` + `g92_offset`, Codex R40 MR-I02), its
        rotary seed (`rotary_pose`, the golden override hook) and its tool
        seed (applied offset + loaded tool; the worker puts that tool in the
        interpreter's spindle pocket, MR-I01), niced. Read live: the tool
        TABLE — the reason for the parse — and the operator's run options
        (block delete) and the configuration (units, axis mask, limits). None
        when nothing, or no parameter basis, is published for this file."""
        base = self.published_ctx
        params = self.published_params
        if not base or base.get("file") != filepath or not params or params.get("text") is None:
            return None
        ctx = dict(base)
        ctx["param_text"] = params["text"]
        ctx["g92_offset"] = params.get("g92")
        if self.published_rotary_seed:
            ctx["rotary_pose"] = dict(self.published_rotary_seed)
        tlo = self.published_tlo or {}
        # The START tool state of the run (VP-I20) — the published payload's
        # tool basis (its own start, or the live start a verify confirmed
        # since: the start this run began with), never its reported live
        # offset. None (an older worker's meta, an unknown start) → the
        # pinned parse is unknown too.
        basis = self.tool_basis or {}
        ctx["seed_tool"] = {"applied_tlo": basis.get("xyz"),
                            "start_mode": basis.get("mode"),
                            "loaded_tool": tlo.get("loaded_tool")}
        ctx["nice"] = self.PINNED_NICE
        return ctx

    def mark_table_stale(self, reason: str, why: str) -> None:
        """The published payload's tool table is stale and stays so until
        the idle edge re-parses (MR-I04). Traced once per mark."""
        mark = {"reason": reason, "why": why}
        if self.table_stale != mark:
            _trace.emit("gcode.table_stale_midrun", reason=reason, why=why)
        self.table_stale = mark

    def expected_parse_ms(self, filepath: str) -> int:
        """Expected publish time for `filepath`: the last measured one for
        that path when known, else a size-based estimate (floor 1.5 s)."""
        hist = self.parse_ms_by_file.get(filepath)
        if hist:
            return int(hist)
        try:
            size = os.path.getsize(filepath)
        except OSError:
            size = 0
        return int(max(1500, size * self._PARSE_MS_PER_BYTE))

    def parse_timeout_s(self, filepath: str) -> float:
        """Worker timeout scaled to the file (2026-09-05): the flat 60 s
        sat 14 s above the plane-mode parse of the 1.18 M-line program —
        a slightly larger program would have silently stopped previewing
        (`gcode.parse_timeout`, nothing else). Floor 60 s, else 3x the
        expected time."""
        return max(self._PARSE_TIMEOUT_FLOOR_S,
                   self._PARSE_TIMEOUT_FACTOR * self.expected_parse_ms(filepath) / 1000.0)

    def inflight_ran_ms(self) -> Optional[int]:
        inf = self.inflight
        return None if inf is None else int((time.monotonic() - inf["t0"]) * 1000)

    def cancel_inflight(self, reason: str) -> bool:
        """Cancel the RUNNING parse because its inputs are already stale
        (a touch-off / rotary move / kins switch / new load during the
        parse). SIGTERM first — the worker exits through SystemExit so
        its temp var-file dir is removed — with a SIGKILL fallback 2 s
        later. Idempotent per parse (a second call while the first kill
        is in flight is a no-op, so the poll loop never re-traces).
        Returns True when a cancel was issued. The caller decides what
        restarts it (reparse_pending / the file edge)."""
        proc = self.gcode_parse_proc
        if proc is None or not self.refresh_running or self.cancel_reason is not None:
            return False
        self.cancel_reason = reason
        self.superseded_total += 1
        inf = self.inflight or {}
        _trace.emit("gcode.reparse_superseded", reason=reason,
                    file=os.path.basename(inf.get("file") or ""),
                    ran_ms=self.inflight_ran_ms(),
                    inflight_reason=inf.get("reason"))
        try:
            proc.terminate()
        except (ProcessLookupError, OSError):
            return True

        def _kill_if_alive():
            try:
                if proc.poll() is None:
                    proc.kill()
                    _trace.emit("gcode.reparse_superseded_killed", level="warn",
                                reason=reason)
            except (ProcessLookupError, OSError):
                pass
        import threading
        _t = threading.Timer(2.0, _kill_if_alive)
        _t.daemon = True
        _t.start()
        return True

    def preview_refresh_status(self) -> Optional[dict]:
        """The status wire's `preview_refresh` (2026-09-05): what the
        gateway is re-parsing and why, with the expected duration, so the
        operator sees the wait instead of a silently stale preview. None
        when no parse runs (the key is then absent from the frame)."""
        inf = self.inflight
        if inf is None or not self.refresh_running:
            return None
        return {"reason": inf.get("reason"), "file": os.path.basename(inf.get("file") or ""),
                "expected_ms": inf.get("expected_ms"), "started_ms": inf.get("started_ms"),
                "queued": bool(self.reparse_pending),
                "superseded": self.superseded_total}

    async def refresh_gcode_preview(self, filepath: str, reason: str = "file",
                                    pinned: bool = False, run: Optional[dict] = None):
        """Parse filepath in an isolated subprocess and publish the result.

        Called from the poller on file change. Single-flight via
        refresh_running — the caller sets the flag before scheduling, this
        coroutine clears it on exit. The subprocess has its own Python
        interpreter and its own GIL, so the heartbeat loop keeps ticking
        through the parse even for multi-second programs.
        """
        t_start = time.monotonic()
        _verify_path: Optional[str] = None
        # Snapshot mtime BEFORE the parse: if an edit lands while the subprocess is
        # running, we record the pre-parse mtime, so the poller's next tick still
        # sees a mismatch and re-parses the newest content rather than missing it.
        try:
            _mtime_at_parse: Optional[float] = os.path.getmtime(filepath)
        except OSError:
            _mtime_at_parse = None
        # The text this parse reads, fingerprinted BEFORE the worker and
        # checked after it: the publication names exactly the text it was
        # parsed from, or none (Codex R17 XZ-07). Off the loop — a 44 MB
        # program hashes in ~0.2 s, the GIL released.
        _source_at_parse = await asyncio.to_thread(program_source, filepath)
        try:
            stat = self._get_stat()
            ini_path = getattr(stat, "ini_filename", None) if stat is not None else None
            if not ini_path:
                # Was a bare return: indistinguishable in the trace from
                # "never scheduled" — the class of silent no-op a hang
                # report cannot be triaged against.
                _trace.emit("gcode.refresh_skipped", level="warn", file=filepath,
                            reason="no-stat" if stat is None else "no-ini")
                return
            # The run a pinned parse belongs to (plan „Prüfung im Lauf“ 1b):
            # built from the run's START context, copied at the start —
            # never from a publication made since — and bound to it only
            # when the context actually built is that one.
            for_run: Optional[dict] = None
            run_source: Optional[str] = None
            if pinned:
                if run is not None and run.get("ctx") is not None:
                    ctx = copy.deepcopy(run["ctx"])
                    if ctx_digest(ctx) == run.get("ctx_digest") and ctx.get("file") == filepath:
                        for_run = {"run_id": run.get("run_id"), "ctx_digest": run.get("ctx_digest"),
                                   "tool_basis_rev": run.get("tool_basis_rev")}
                        run_source = run.get("source")
                    else:
                        _trace.emit("gcode.run_ctx_mismatch", level="warn", file=filepath,
                                    run_id=run.get("run_id"))
                else:
                    ctx = self.pinned_ctx(filepath)
                if ctx is None:
                    _trace.emit("gcode.refresh_skipped", level="warn", file=filepath,
                                reason="no-published-ctx")
                    return
                active_idx = ctx.get("g5x_index")
                _live_kt, _live_kf = ctx.get("kins_type"), ctx.get("kins_frame")
            else:
                active_idx = getattr(stat, "g5x_index", None) if stat is not None else None
                patches = self._build_wcs_rotation_patches()
                _live_kt, _live_kf = self._get_live_kins()
                ctx = {
                    "file": filepath,
                    "ini_path": ini_path,
                    "units": self._get_machine_units(),
                    "var_patches": patches,
                    "g5x_index": active_idx if isinstance(active_idx, int) else 1,
                    # Fifth freshness input: live switchkins type + plane frame
                    # (None on untracked configs — worker seeds nothing).
                    "kins_type": _live_kt,
                    "kins_frame": _live_kf,
                }
                # The toolsetter values the routine reads (a pinned parse
                # keeps the published ctx's: the basis it ran with).
                _ts_ctx = self._get_toolsetter_ctx()
                if _ts_ctx:
                    ctx["toolsetter"] = _ts_ctx
            # VERIFY (VP-I20, plan Fassungen 4–6): the start tool state moved
            # since the publish. Parse at the actual offset as always, and let
            # the worker compare its payload with the published one — when
            # every consumer would get the same inputs (the published payload
            # normalised to the new start), nothing is published: no version
            # bump, no transfer, no client rebuild beyond the new tool basis.
            if (reason == "tool_offset" and not pinned and self.tool_basis is not None
                    and self.last_file == filepath and self.preview_available()):
                _blob = self.preview_bytes_gz if self.preview_bytes_gz is not None else self.preview_bytes
                _verify_path = await asyncio.to_thread(_write_verify_blob, _blob)
                ctx["verify_against"] = _verify_path
            ctx_bytes = _msgspec.msgpack.encode(ctx)
            # Input snapshot of THIS parse in the published seeds' shapes
            # (cancel-and-restart): rotary pose as the worker will seed it
            # (same STAT fields, ms apart — the drift edge's settle guard
            # absorbs that), the live kins type/frame the ctx carries, and
            # the fixture table + g92 the var-file patches were built from.
            expected_ms = self.expected_parse_ms(filepath)
            timeout_s = self.parse_timeout_s(filepath)
            if pinned:
                timeout_s *= self._PINNED_TIMEOUT_FACTOR
            if pinned:
                # A pinned parse's inputs ARE the published seeds.
                _seed_rot = dict(self.published_rotary_seed) if self.published_rotary_seed else None
                _seed_wcs = list(self.published_wcs_off) if self.published_wcs_off is not None else None
            else:
                _seed_rot = rotary_seed_values(getattr(stat, "axis_mask", 0) or 0,
                                               getattr(stat, "actual_position", None))
                _seed_wcs = self._get_wcs_off_flat()
            self.cancel_reason = None
            self.inflight = {
                "file": filepath, "mtime": _mtime_at_parse, "reason": reason,
                "t0": time.monotonic(), "started_ms": int(time.time() * 1000),
                "expected_ms": expected_ms,
                "rotary_seed": _seed_rot,
                "kins_seed": {"type": _live_kt, "frame": _live_kf},
                "wcs_off": _seed_wcs,
                # the start tool state the worker will seed (VP-I20) — a G43
                # by hand while it runs stales it (inflight_stale_reason)
                "tlo_seed": None if pinned else self.live_start(stat),
                **({"pinned": True} if pinned else {}),
                **({"verify": True} if _verify_path else {}),
            }
            _trace.emit("gcode.spawn_start",
                        file=os.path.basename(filepath), active_idx=active_idx,
                        reason=reason, expected_ms=expected_ms,
                        timeout_s=round(timeout_s, 1),
                        **({"pinned": True} if pinned else {}))

            t_spawn = time.monotonic()
            # Spawn + run the worker entirely off the event loop (B7): the fork no
            # longer stalls the loop. communicate() (write ctx, read stdout/stderr,
            # wait) and the timeout all run in the thread.
            try:
                returncode, stdout, stderr = await asyncio.to_thread(
                    self._run_gcode_worker_blocking, ctx_bytes, timeout_s)
            except subprocess.TimeoutExpired:
                _trace.emit("gcode.parse_timeout", level="warn", file=filepath,
                            timeout_s=round(timeout_s, 1), expected_ms=expected_ms)
                return
            t_communicated = time.monotonic()
            if self.cancel_reason is not None:
                # Superseded by cancel_inflight: the result (if any) was
                # computed from stale inputs — never publish it. The caller
                # that cancelled owns the restart (reparse_pending / file edge).
                _trace.emit("gcode.parse_cancelled", file=filepath,
                            reason=self.cancel_reason, rc=returncode,
                            ran_ms=round((t_communicated - t_spawn) * 1000),
                            stderr_tail=(stderr.decode(errors="replace")[-240:] if stderr else ""))
                return
            if pinned and returncode == PIN_UNSUPPORTED_EXIT:
                # This config cannot pin a start state: stop asking (MR-I01)
                # and say so — the preview is stale until idle (MR-I04).
                self.pin_unsupported = True
                self.mark_table_stale(reason.split(":", 1)[-1], "unsupported")
                _trace.emit("gcode.pinned_unsupported", level="warn", file=filepath,
                            stderr_tail=(stderr.decode(errors="replace")[-240:] if stderr else ""))
                return
            if returncode != 0:
                err_tail = stderr.decode(errors="replace")[:500] if stderr else ""
                _trace.emit("gcode.parse_worker_failed", level="warn",
                            rc=returncode, stderr_tail=err_tail)
                return
            # Surface worker-side timing + lift the partial-parse marker into a
            # structured event WITHOUT decoding the (multi-MB) stdout payload.
            # The __SCHEMA__ line is the payload's wire-format stamp riding the
            # same channel (P1) — None survives if the worker on disk predates
            # the stamp, and publishing None is deliberate: the client banners
            # it rather than this code guessing a value.
            worker_schema: Optional[int] = None
            worker_tlo: Optional[dict] = None
            worker_rotary_seed: Optional[dict] = None
            worker_rotary_cmd: Optional[dict] = None
            worker_limits: Optional[dict] = None
            worker_kins_seed: Optional[dict] = None
            worker_wcs_off: Optional[list] = None
            worker_params: Optional[dict] = None
            worker_toolsetter: Optional[dict] = None
            worker_same = False
            if stderr:
                for ln in stderr.decode(errors="replace").splitlines():
                    if not ln.strip():
                        continue
                    if ln.startswith("__PARTIAL__"):
                        _p = ln.split("\t", 2)
                        _trace.emit("gcode.parse_partial", level="warn", file=filepath,
                                    error=_p[2] if len(_p) > 2 else "",
                                    error_line=_p[1] if len(_p) > 1 else "")
                    elif ln.startswith("__REFUSED__"):
                        # A remap refused the program in preview (the
                        # payload is an EMPTY success carrying
                        # parse_refused) — the operator's banner comes
                        # from the payload; this is the trace twin.
                        _p = ln.split("\t", 2)
                        _trace.emit("gcode.parse_refused", level="warn", file=filepath,
                                    message=_p[2] if len(_p) > 2 else "",
                                    line=_p[1] if len(_p) > 1 else "")
                    elif ln.startswith("__SCHEMA__"):
                        _s = ln.split("\t", 1)
                        try:
                            worker_schema = int(_s[1])
                        except (IndexError, ValueError):
                            _trace.emit("gcode.schema_line_malformed", level="warn",
                                        line=ln[:120])
                    elif ln.startswith("__TLO__"):
                        # Parse-time TLO snapshot (W2 P4) for the poller's
                        # drift edge. Malformed → None, loudly — the edge
                        # then simply can't fire (unchecked ≠ clean, but the
                        # client-side parse_tlos hint still works).
                        _s = ln.split("\t", 1)
                        try:
                            worker_tlo = json.loads(_s[1])
                        except (IndexError, ValueError):
                            _trace.emit("gcode.tlo_line_malformed", level="warn",
                                        line=ln[:160])
                    elif ln.startswith("__ABCSEED__"):
                        # Parse-time rotary seed (W6) for the drift edge —
                        # same malformed-→-None-loudly contract as __TLO__.
                        _s = ln.split("\t", 1)
                        try:
                            worker_rotary_seed = json.loads(_s[1])
                        except (IndexError, ValueError):
                            _trace.emit("gcode.abcseed_line_malformed",
                                        level="warn", line=ln[:160])
                    elif ln.startswith("__LIMITS__"):
                        # Checked soft-limit window (2026-09-12) — same
                        # malformed-→-None-loudly contract as __ABCSEED__.
                        _s = ln.split("\t", 1)
                        try:
                            worker_limits = json.loads(_s[1])
                        except (IndexError, ValueError):
                            _trace.emit("gcode.limits_line_malformed",
                                        level="warn", line=ln[:160])
                    elif ln.startswith("__ROTCMD__"):
                        # Rotary-command boundary (2026-09-11) — same
                        # malformed-→-None-loudly contract as __ABCSEED__.
                        _s = ln.split("\t", 1)
                        try:
                            worker_rotary_cmd = json.loads(_s[1])
                        except (IndexError, ValueError):
                            _trace.emit("gcode.rotcmd_line_malformed",
                                        level="warn", line=ln[:160])
                    elif ln.startswith("__KINSSEED__"):
                        # Parse-time switchkins assumption (fifth input) —
                        # same malformed-→-None-loudly contract.
                        _s = ln.split("\t", 1)
                        try:
                            worker_kins_seed = json.loads(_s[1])
                        except (IndexError, ValueError):
                            _trace.emit("gcode.kinsseed_line_malformed",
                                        level="warn", line=ln[:160])
                    elif ln.startswith("__TOOLSETTER__"):
                        # same malformed-→-None-loudly contract
                        _s = ln.split("\t", 1)
                        try:
                            worker_toolsetter = json.loads(_s[1])
                        except (IndexError, ValueError):
                            _trace.emit("gcode.toolsetter_line_malformed",
                                        level="warn", line=ln[:160])
                    elif ln.startswith("__PARAMS__"):
                        # The parameter basis this parse ran on (MR-I02) —
                        # malformed → None: a pinned re-parse then refuses
                        # (pinned_ctx), never re-reads the live file.
                        _s = ln.split("\t", 1)
                        try:
                            worker_params = json.loads(_s[1])
                        except (IndexError, ValueError):
                            _trace.emit("gcode.params_line_malformed",
                                        level="warn", line=ln[:160])
                    elif ln == "__SAME__":
                        worker_same = True
                    elif ln.startswith("__VERIFY__"):
                        _s = ln.split("\t", 1)
                        try:
                            _v = json.loads(_s[1])
                        except (IndexError, ValueError):
                            _v = {"malformed": ln[:160]}
                        _trace.emit("gcode.verify", file=os.path.basename(filepath), **_v)
                    elif ln.startswith("__WCSOFF__"):
                        # Parse-time WCS-offset snapshot for the offset-
                        # drift edge — same malformed-→-None contract.
                        _s = ln.split("\t", 1)
                        try:
                            worker_wcs_off = json.loads(_s[1])
                        except (IndexError, ValueError):
                            _trace.emit("gcode.wcsoff_line_malformed",
                                        level="warn", line=ln[:160])
                    else:
                        _trace.emit("gcode.worker_log", line=ln)
            _trace.emit("gcode.worker_done",
                        parse_ms=round((t_communicated - t_spawn) * 1000, 1),
                        stdout_bytes=len(stdout))
            if worker_same and not stdout:
                # Verified at the actual offset: the published payload stays;
                # only its tool basis moves to the start the worker seeded.
                if self.basis_of(worker_tlo) is not None:
                    self._set_tool_basis(self.basis_of(worker_tlo))
                    _trace.emit("gcode.reparse_verified_same", file=os.path.basename(filepath),
                                basis=self.tool_basis, version=self.preview_version,
                                total_ms=round((time.monotonic() - t_start) * 1000, 1))
                else:
                    _trace.emit("gcode.verify_same_without_start", level="warn",
                                file=os.path.basename(filepath))
                return
            if not stdout:
                _trace.emit("gcode.preview_refresh_failed", level="warn",
                            file=filepath, exc="EmptyOutput", msg="worker emitted no bytes")
                return

            # PASSTHROUGH (mmw#4 / GC): the worker already emits the EXACT GET /preview
            # wire shape (incl. "file"), so we publish its bytes verbatim — no decode +
            # re-encode. Decoding inflated the payload into hundreds of thousands of
            # tiny [x,y,z] list objects purely to re-serialize them, and that fresh
            # live-object population is what drove gen-0/gen-1 GC scans to 50-120 ms
            # (the HB-WAKEs). Nothing in the gateway reads the polylines as Python
            # objects — both consumers only need `file` — so we keep just that. gzip
            # runs on the opaque bytes off-thread (GIL-releasing C, allocates no
            # tracked objects). Clients fetch over HTTP (GET /preview), off the WS writer.
            t_gz0 = time.monotonic()
            preview_bytes_gz: Optional[bytes] = None
            if len(stdout) >= 4096:
                preview_bytes_gz = await asyncio.to_thread(gzip.compress, stdout, 6)
            t_gz_done = time.monotonic()
            _source_after = await asyncio.to_thread(program_source, filepath)
            if _source_after != _source_at_parse:
                # Nothing can be bound to this publication; the next parse is
                # requested here — the poller's file edge sees the path and
                # the mtime only, which an edit can keep.
                _trace.emit("gcode.source_changed_during_parse", level="warn",
                            file=os.path.basename(filepath))
                self.reparse_pending = True
                self.reparse_pending_reason = "file"
            # Publish metadata + bytes together before bumping the version so
            # GET /preview readers never see stale bytes under a new version.
            self.published_source = _source_at_parse if _source_after == _source_at_parse else None
            self.preview_pending = {"file": filepath}
            self.preview_raw_len = len(stdout)
            # Keep the raw copy ONLY when no gz exists: every real browser accepts
            # gzip, so holding raw + gz resident (~22 MB on a heavy file) paid for a
            # variant that was practically never served.
            self.preview_bytes = None if preview_bytes_gz is not None else stdout
            self.preview_bytes_gz = preview_bytes_gz
            self.published_schema = worker_schema
            self.published_tlo = worker_tlo
            self._set_tool_basis(self.basis_of(worker_tlo))
            self.published_rotary_seed = worker_rotary_seed
            self.published_rotary_cmd = worker_rotary_cmd
            self.published_limits = worker_limits
            self.published_kins_seed = worker_kins_seed
            self.published_wcs_off = worker_wcs_off
            self.published_ctx = ctx
            self.table_stale = None
            # The run binding again at the publish: still the run in progress,
            # with the same start and the same text (plan 1b) — else this
            # payload has none.
            if for_run is not None:
                cur = self._get_run_basis() or {}
                if (cur.get("run_id"), cur.get("ctx_digest"), cur.get("tool_basis_rev")) != (
                        for_run["run_id"], for_run["ctx_digest"], for_run["tool_basis_rev"]) or (
                        self.published_source is None or self.published_source != run_source) or (
                        # this parse's own start moved the basis: not the run's start
                        self.tool_basis_rev != for_run["tool_basis_rev"]):
                    _trace.emit("gcode.run_binding_lost", level="warn", file=filepath,
                                run_id=for_run["run_id"], now=cur.get("run_id"))
                    for_run = None
            self.published_origin = {
                "version": self.preview_version + 1, "file": filepath,
                "source": self.published_source, "reason": reason, "pinned": bool(pinned),
                "for_run": for_run,
                # the tool table the parse actually read (its __TLO__ meta)
                "table": {"mtime": (worker_tlo or {}).get("table_mtime"),
                          "rows": hashlib.sha256(json.dumps((worker_tlo or {}).get("tlos"),
                                                            default=repr).encode()).hexdigest()[:16]},
                "tool_basis_rev": self.tool_basis_rev,
            }
            self.published_params = worker_params if isinstance(worker_params, dict) else None
            self.published_toolsetter = worker_toolsetter if isinstance(worker_toolsetter, dict) else None
            self.preview_version += 1
            self.last_file = filepath
            self.last_mtime = _mtime_at_parse
            if not pinned:
                # A niced mid-run parse is no estimate for the next idle one.
                self.parse_ms_by_file[filepath] = round((t_gz_done - t_start) * 1000)
            _trace.emit("gcode.publish",
                        **({"pinned": True} if pinned else {}),
                        version=self.preview_version,
                        schema=worker_schema,
                        gzip_ms=round((t_gz_done - t_gz0) * 1000, 1),
                        bytes=len(stdout),
                        bytes_gz=len(preview_bytes_gz) if preview_bytes_gz else 0,
                        total_ms=round((t_gz_done - t_start) * 1000, 1))
        except Exception as e:
            _trace.emit("gcode.preview_refresh_failed", level="warn",
                        file=filepath, exc=type(e).__name__, msg=str(e))
        finally:
            self.refresh_running = False
            self.gcode_parse_proc = None
            self.inflight = None
            if _verify_path:
                try:
                    os.unlink(_verify_path)
                except OSError:
                    pass

    # ---- surface / comp grid file loading ----

    def read_probe_results_file(self) -> list:
        """Read probe-results.txt and return list of [x, y, z] triples."""
        stat = self._get_stat()
        ini_path = getattr(stat, "ini_filename", None) if stat is not None else None
        if not ini_path:
            return []
        path = os.path.join(os.path.dirname(ini_path), "probe-results.txt")
        points = []
        skipped = 0
        sample_err: Optional[str] = None
        if os.path.isfile(path):
            with open(path) as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) >= 3:
                        try:
                            points.append([float(parts[0]), float(parts[1]), float(parts[2])])
                        except ValueError as e:
                            skipped += 1
                            if sample_err is None:
                                sample_err = str(e)[:200]
        if skipped:
            _trace.emit("surface.point_parse_failed", level="warn",
                        path=path, skipped=skipped, sample_err=sample_err,
                        parsed=len(points))
        return points

    def read_comp_grid_file(self) -> "dict | None":
        """Read probe-results-grid.json and return parsed dict, or None if unavailable."""
        import json
        stat = self._get_stat()
        ini_path = getattr(stat, "ini_filename", None) if stat is not None else None
        if not ini_path:
            return None
        path = os.path.join(os.path.dirname(ini_path), "probe-results-grid.json")
        if not os.path.isfile(path):
            return None
        with open(path) as f:
            try:
                return json.load(f)
            except json.JSONDecodeError as e:
                _trace.emit("probe.results_grid_corrupt", level="warn",
                            exc=type(e).__name__, msg=str(e))
                return None

    # ---- tool import offload ----

    def _run_tool_import_worker_blocking(self, raw: bytes, machine_unit: str, timeout: float):
        """Run the tool_import worker to completion in a SUBPROCESS (own GIL).

        The perf-matrix harness proved the in-thread path trips the HAL watchdog at
        the size cap: decode+transform of a near-16 MB library is ~243 ms of
        GIL-held CPU plus the GC pressure of ~60k fresh dicts — a thread cannot
        isolate that from the event loop. Same lifecycle pattern as the gcode parse
        worker (B7): Popen inside a to_thread, bounded communicate, handle published
        for lifespan termination. Raises ValueError for an invalid library (HTTP
        400 at the route), RuntimeError for worker failures (HTTP 500)."""
        proc = subprocess.Popen(
            [sys.executable, TOOL_IMPORT_WORKER_PATH],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.tool_import_proc = proc
        try:
            ctx = _msgspec.msgpack.encode({"raw": raw, "unit": machine_unit})
            try:
                stdout, stderr = proc.communicate(input=ctx, timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate()
                raise RuntimeError(f"tool import worker timeout after {timeout:.0f}s")
            err_tail = (stderr or b"").decode(errors="replace").strip()[:500]
            if proc.returncode == 4:
                raise ValueError(err_tail or "Invalid tool library")
            if proc.returncode != 0:
                raise RuntimeError(f"tool import worker rc={proc.returncode}: {err_tail}")
            out = _msgspec.msgpack.decode(stdout)
            return out["parsed"], out["skipped"]
        finally:
            self.tool_import_proc = None

    async def decode_tool_offloaded(self, raw: bytes, machine_unit: str):
        """Size-routed offload: small blobs in a thread (cheap, common case); large
        blobs in the subprocess worker (the only true GIL isolation)."""
        # Small compressed archives can expand substantially; always isolate ZIP.
        if len(raw) <= TOOL_IMPORT_INLINE_MAX and not raw.startswith(b'PK'):
            return await asyncio.to_thread(decode_tool_blob, raw, machine_unit)
        _trace.emit("tool_import.worker_offload", bytes=len(raw))
        return await asyncio.to_thread(self._run_tool_import_worker_blocking, raw, machine_unit, 60.0)
