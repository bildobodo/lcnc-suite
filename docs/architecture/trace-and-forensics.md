# The trace, the trip bundle and the browser's measuring instrument

Package P3 of the machine-day plan (2026-11-21; plan and reviews in
`docs/reviews/maschinentag.review.md`, Codex R425 MT425-02..04, R426). The
short form is in CLAUDE.md "Log Locations"; the decision in
`docs/decisions.md` (2026-11-21, P3).

## Why

On the machine day the trace lay in three files: from about 12:21 the
gateway wrote `trace.ndjson.1`, hal_reader `trace.ndjson.2`, the watchdog, the
launcher and the parse worker `trace.ndjson` (F23). Every process had its own
`RotatingFileHandler`: the one that crossed 50 MB renamed the chain, the others
kept their descriptor and wrote on into the renamed file — and a later
rotation could delete a file a process still wrote. The module called this
"rare"; it is deterministic at every rollover. The trip bundles stayed empty
(F2): the bundler ran from a fixed `/home/cnc/lcnc-suite` path, read
`trace.ndjson` alone, and its rc 2 was traced as "done". And the browser's
hold refusals ("Page delayed — hold again", F18) were console-only; the new
browser profile sent no `browser.viewer.perf` rows at all (F20).

## One coordinated section per line

`lcnc_trace.CoordinatedFileHandler` (stdlib + `fcntl`: the HAL siblings run
under the system python) replaces the rotating handlers for both logs. Every
line is written in ONE short exclusive section under the log's STABLE lock —
`trace.lock` / `crash.lock`, never rotated, named so that no `trace.ndjson*` /
`crash.log*` glob of any reader matches it:

1. **Identity** — `os.stat(path)` against the descriptor's `(dev, ino)`: a
   rotation by another writer (or a missing file) reopens the path. Nothing
   is ever appended to a renamed generation.
2. **Size** — past `max_bytes` (50 MB trace, 5 MB crash) the chain
   `.N-1 → .N … path → .1` is renamed HERE, under the lock; a gap in the chain
   (a rotator that died between two renames) is skipped. A failed rotation is
   reported (`rotate_failed`) and the line goes into the file it has.
3. **The open end** — a last byte that is no newline is a FRAGMENT some writer
   left (a partial write under `EFBIG` / `ENOSPC`, a process killed mid-line):
   it is ended with a newline first, so the damage stays ONE damaged line and
   this record stays readable (Codex R426's cross-process case: A writes 64
   bytes and dies at its file-size limit, B's next record would otherwise be
   glued to the fragment and lost with it). The look at the last byte is
   skipped when the file still ends where this handler's last complete line
   ended (`_end`).
4. **The report** — a pending loss report (below) goes in first.
5. **The line** — written whole with `os.write` in a loop. A partial write
   ends its own fragment (best effort — else the next section does).

**The lock budget**: `LOCK_EX | LOCK_NB`, retried every 1 ms for at most
`_LOCK_BUDGET_S` (20 ms). It bounds the WAIT for the lock, not the file I/O;
no hard heartbeat promise follows from it. Without the lock nothing is
written unlocked: the record is DROPPED and COUNTED per process and log
(`why`: `lock_busy`, `lock_open:<errno>`, the write's errno …), said once per
reason on the console (ConsoleGuard), and the next section that gets through
writes `trace.write_lost {log, count, since_ns, why}` (crash log:
`crash.write_lost`, level error — a lost crash record is a finding for
`native_run`) directly, never through `emit()`: a failing report cannot
recurse. A report that fails keeps its counts (the line it preceded is
counted too). Nothing is printed inside the section — a new reason's
console note is said after the unlock — and a record that reaches the
handler again while its own section runs (a console failure traced through
`emit()`) is counted as `reentrant`, never written and never unlocks: the
lock belongs to the open file description, a nested unlock would release
the outer section. A fragment closed without an own loss is
`trace.fragment_closed`. `close()` (logging's shutdown) tries the pending
report once more; a process that ends first cannot report its loss — the
named limit.

A forked child (none today) closes its inherited descriptors unlocked and
opens its own: an unlock through a shared open file description would release
the parent's lock. `doRollover()` keeps the stdlib's name (tests and tools
rotate through it) and rotates inside a coordinated section.

### The launcher

The launcher's two trace lines (`_preflight_trace`, the proc.status loop)
take the same section through `_trace_append` (the block between `# >>>
trace-append` and `# <<< trace-append`, which `test_trace_rotation.py`
extracts): `flock -w 0.02` on `trace.lock`, the open end (`tail -c1`), a
pending report, the line. The launcher never rotates — a Python writer does,
under the same lock; the file may run a few launcher lines past its size until
then. The loss counter lives in the LONG-LIVED caller's shell (the main shell;
the proc.status loop's own subshell, which starts with `_trace_reset_counts`),
never only in the short `( flock …; printf … )` section; the section's exit
code says what happened (20 lock open, 21 lock busy, 22 the fragment not
ended, 23 the report, 24 the line, 30 written after ending a fragment, 153
SIGXFSZ — `EFBIG`, the report's fate unknown: counted again). The first loss
of each reason is a line in `launcher.log`; without `flock(1)` every line is
`no_flock`.

## The trip bundle

`_snapshot_trip` runs `scripts/trace-bundle.py` from beside the gateway's own
module (`_TRACE_BUNDLER`, `sys.executable`) with `--log-dir` = the directory
the gateway writes; rc ≠ 0 is `safety.trip_snapshot_failed {rc, stderr_tail}`.

The bundler reads each log as ONE SNAPSHOT: under the writers' lock it opens
every generation (`<log>` and `<log>.<n>` only — no lock file) and records
`(dev, ino, size)`, releases the lock, then reads only those descriptors up to
those sizes. A slow reader holds up no writer, and a rotation after the
snapshot renames files the snapshot already holds — reading by name one after
another could read a file twice (A, A, B) or miss one. A lock it cannot get in
2 s is named in the bundle (`lock: "not_acquired: …"`), never silent.

For a trip it first waits until the wall clock passes trip + 1 s + 0.2 s —
at most `TAIL_WAIT_MAX_S` (1.2 s) on the MONOTONIC clock, so a trip stamped
ahead of a stepped wall clock never stretches the wait (it runs in the
bundler's own process, outside every command and heartbeat path).

The bundle (`trips/<trip_ts_ns>/`): `trace-merged.ndjson` / `.log` (the
window, wall-time order — display order, not causality), `crash-snapshot.log`
(crash.log's generations from its OWN snapshot under `crash.lock`, never
merged into the timeline: the trace already carries every `crash.*` event, so
nothing is counted twice and nothing deduplicated by content) and
`bundle.json`: the requested window, `capture_bound_ns`, the sources (name,
dev, ino, size, records, damaged, `cut_last_line`), the generation gaps, the
damaged lines, `truncated_before` (the window starts before the oldest record
kept — a RETENTION bound, no proof of lost events) and `tail_missing` (the
capture came before the window's end).

## The browser's measuring instrument (P2's)

- **`browser.stall`** (`stallWindow.ts`, fed and flushed by `viewerPerf.ts`):
  gaps in the TIMER OBSERVATION past `HOLD_STALL_MS` (150 ms) — the quantity
  and the limit the hold guard decides on. The observations are viewerPerf's
  main-thread probe (an 8 ms timer chain — one chain for both, no second timer
  on the weak panel PC; the hold's own chain is 20 ms: another phase, so this
  histogram is never the evidence of one refusal). Per row: `observed`, `n`,
  `max_ms`, `h` (150–250, 250–500, 500–1000, > 1000), `hidden_ms` and
  `anchor_resets` (a hidden page's clamped timers are no stall: hiding stops
  the count, showing re-anchors), `limit_ms`. Long tasks are a separate
  quantity: `lt_n` / `lt_max_ms` only where the Long Tasks API exists (absent
  in Firefox — never a 0), and each task past 500 ms its own
  `browser.longtask` record as before (the observer moved here from
  `ws/telemetry.ts`). A row per 3 s window with a stall, else one per 30 s, on
  EVERY page — viewer or not — chained by `seq` and its window edges, so a
  missing row is a gap, never "no stall".
- **`browser.hold.refused {type, why, held_ms, gap_ms?}`** (MachineBtn): every
  refused hold. `HoldCallbacks.ended` carries the deciding gap for `stalled`
  only (`holdGesture.ts`); every other end has no `gap_ms` (never derived
  from `held_ms`). One end per gesture: a release or cancel after it reports
  nothing.
- **`browser.telemetry.dropped {events, batches, why, since_ms}`**
  (`ws/telemetry.ts`): the transport stays best effort, but a loss is
  counted — a queue overflow, a refused POST (network, the keepalive quota),
  a non-2xx answer, the gateway's `ok: false` or rejected lines, a refused
  beacon — and reported in front of the next batch. A report IN FLIGHT is
  taken out of the pending count (the next batch never says it again) and
  comes back only when its own batch is lost (non-2xx, a refusal, a network
  error), with that batch's events added: a loss is said once. A record is
  there exactly once only when its batch was delivered.

**F20 is a diagnosis, not a proven cause.** The three layers are separated:
capture (the probe and the observers run on every page), the window close
(`flushViewerPerf` still skips windows without status, render, input or span —
the timer windows now ride `browser.stall` instead) and the transport (now
counted). Which one lost the new profile's rows shows at the next machine
visit.

## Tests

- `lcnc-gateway/test_trace_rotation.py` — real processes: two writers across
  ~25 rotations (every record exactly once), a foreign rotation followed at
  the next line, a held lock (dropped, counted, reported), a rotator killed
  holding the lock, a half-done chain, an injected `ENOSPC` mid-line, a failed
  report, `close()`, the crash log's error-level report, Codex's cross-process
  fragment (a writer dead at its `RLIMIT_FSIZE`), the same writer resuming
  after `EFBIG`, and the launcher block (its sites, a held lock, a fragment,
  SIGXFSZ, the loop's own count). `--red <dir>` runs the two-writer and the
  fragment scenario against another `lcnc_trace.py` (the pre-P3 one: records
  missing, B's first record swallowed).
- `lcnc-gateway/test_trace_bundle.py` — a rotation during the read, the lock
  held only while opening, a busy lock named, damage / gaps / lock files, the
  bounded tail wait, the window across a rotation, a capture before the tail,
  crash.log in both channels, rc 2, and the gateway's call.
- `src/stallWindow.test.ts`, `src/holdGesture.test.ts` ("the refusal's
  evidence"), `src/ws/telemetry.test.ts` ("the transport's losses") — the
  definitions; `e2e/telemetry-metrics.spec.ts` — the real page: a block
  becomes a stall row, the two hold refusals, a lost batch reported.
