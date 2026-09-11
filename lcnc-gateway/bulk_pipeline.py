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
- **Fusion tool-library decode**: size-routed offload (thread for small
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
import gzip
import json
import os
import subprocess
import sys
import time
from typing import Any, Callable, Optional

import msgspec as _msgspec

import lcnc_trace as _trace
from fusion_import import decode_fusion_blob
from gateway_util import rotary_seed_values

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GCODE_WORKER_PATH = os.path.join(_BASE_DIR, "gcode_parse_worker.py")
FUSION_WORKER_PATH = os.path.join(_BASE_DIR, "fusion_import.py")
FUSION_INLINE_MAX = 1 << 20   # <=1 MiB decodes in ~15 ms — a thread is fine


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


class BulkPipeline:
    def __init__(
        self,
        *,
        get_stat: Callable[[], Any],
        get_machine_units: Callable[[], str],
        build_wcs_rotation_patches: Callable[[], dict],
        get_live_kins: Optional[Callable[[], tuple]] = None,
        get_wcs_off_flat: Optional[Callable[[], Optional[list]]] = None,
    ) -> None:
        self._get_stat = get_stat
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

        # ---- Fusion import worker ----
        self.fusion_import_proc: Optional[subprocess.Popen] = None

    # ---- preview ----

    def preview_available(self) -> bool:
        """A preview is servable when either variant exists — the raw copy is
        dropped once the gz exists (every real browser sends Accept-Encoding:
        gzip; a rare non-gzip client gets an on-demand decompress in
        get_preview)."""
        return self.preview_bytes is not None or self.preview_bytes_gz is not None

    def schedule_refresh(self, filepath: str, reason: str, spawn) -> bool:
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
            task = spawn(self.refresh_gcode_preview(filepath, reason=reason))
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
        _trace.emit("gcode.refresh_scheduled", file=filepath, reason=reason)
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
        self.published_rotary_seed = None
        self.published_kins_seed = None
        self.published_wcs_off = None
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

    async def refresh_gcode_preview(self, filepath: str, reason: str = "file"):
        """Parse filepath in an isolated subprocess and publish the result.

        Called from the poller on file change. Single-flight via
        refresh_running — the caller sets the flag before scheduling, this
        coroutine clears it on exit. The subprocess has its own Python
        interpreter and its own GIL, so the heartbeat loop keeps ticking
        through the parse even for multi-second programs.
        """
        t_start = time.monotonic()
        # Snapshot mtime BEFORE the parse: if an edit lands while the subprocess is
        # running, we record the pre-parse mtime, so the poller's next tick still
        # sees a mismatch and re-parses the newest content rather than missing it.
        try:
            _mtime_at_parse: Optional[float] = os.path.getmtime(filepath)
        except OSError:
            _mtime_at_parse = None
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
            ctx_bytes = _msgspec.msgpack.encode(ctx)
            # Input snapshot of THIS parse in the published seeds' shapes
            # (cancel-and-restart): rotary pose as the worker will seed it
            # (same STAT fields, ms apart — the drift edge's settle guard
            # absorbs that), the live kins type/frame the ctx carries, and
            # the fixture table + g92 the var-file patches were built from.
            expected_ms = self.expected_parse_ms(filepath)
            timeout_s = self.parse_timeout_s(filepath)
            self.cancel_reason = None
            self.inflight = {
                "file": filepath, "mtime": _mtime_at_parse, "reason": reason,
                "t0": time.monotonic(), "started_ms": int(time.time() * 1000),
                "expected_ms": expected_ms,
                "rotary_seed": rotary_seed_values(
                    getattr(stat, "axis_mask", 0) or 0,
                    getattr(stat, "actual_position", None)),
                "kins_seed": {"type": _live_kt, "frame": _live_kf},
                "wcs_off": self._get_wcs_off_flat(),
            }
            _trace.emit("gcode.spawn_start",
                        file=os.path.basename(filepath), active_idx=active_idx,
                        reason=reason, expected_ms=expected_ms,
                        timeout_s=round(timeout_s, 1))

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
            worker_kins_seed: Optional[dict] = None
            worker_wcs_off: Optional[list] = None
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
            # Publish metadata + bytes together before bumping the version so
            # GET /preview readers never see stale bytes under a new version.
            self.preview_pending = {"file": filepath}
            self.preview_raw_len = len(stdout)
            # Keep the raw copy ONLY when no gz exists: every real browser accepts
            # gzip, so holding raw + gz resident (~22 MB on a heavy file) paid for a
            # variant that was practically never served.
            self.preview_bytes = None if preview_bytes_gz is not None else stdout
            self.preview_bytes_gz = preview_bytes_gz
            self.published_schema = worker_schema
            self.published_tlo = worker_tlo
            self.published_rotary_seed = worker_rotary_seed
            self.published_rotary_cmd = worker_rotary_cmd
            self.published_kins_seed = worker_kins_seed
            self.published_wcs_off = worker_wcs_off
            self.preview_version += 1
            self.last_file = filepath
            self.last_mtime = _mtime_at_parse
            self.parse_ms_by_file[filepath] = round((t_gz_done - t_start) * 1000)
            _trace.emit("gcode.publish",
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

    # ---- fusion import offload ----

    def _run_fusion_worker_blocking(self, raw: bytes, machine_unit: str, timeout: float):
        """Run the fusion_import worker to completion in a SUBPROCESS (own GIL).

        The perf-matrix harness proved the in-thread path trips the HAL watchdog at
        the size cap: decode+transform of a near-16 MB library is ~243 ms of
        GIL-held CPU plus the GC pressure of ~60k fresh dicts — a thread cannot
        isolate that from the event loop. Same lifecycle pattern as the gcode parse
        worker (B7): Popen inside a to_thread, bounded communicate, handle published
        for lifespan termination. Raises ValueError for an invalid library (HTTP
        400 at the route), RuntimeError for worker failures (HTTP 500)."""
        proc = subprocess.Popen(
            [sys.executable, FUSION_WORKER_PATH],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.fusion_import_proc = proc
        try:
            ctx = _msgspec.msgpack.encode({"raw": raw, "unit": machine_unit})
            try:
                stdout, stderr = proc.communicate(input=ctx, timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate()
                raise RuntimeError(f"fusion import worker timeout after {timeout:.0f}s")
            err_tail = (stderr or b"").decode(errors="replace").strip()[:500]
            if proc.returncode == 4:
                raise ValueError(err_tail or "Invalid tool library")
            if proc.returncode != 0:
                raise RuntimeError(f"fusion import worker rc={proc.returncode}: {err_tail}")
            out = _msgspec.msgpack.decode(stdout)
            return out["parsed"], out["skipped"]
        finally:
            self.fusion_import_proc = None

    async def decode_fusion_offloaded(self, raw: bytes, machine_unit: str):
        """Size-routed offload: small blobs in a thread (cheap, common case); large
        blobs in the subprocess worker (the only true GIL isolation)."""
        if len(raw) <= FUSION_INLINE_MAX:
            return await asyncio.to_thread(decode_fusion_blob, raw, machine_unit)
        _trace.emit("fusion.worker_offload", bytes=len(raw))
        return await asyncio.to_thread(self._run_fusion_worker_blocking, raw, machine_unit, 60.0)
