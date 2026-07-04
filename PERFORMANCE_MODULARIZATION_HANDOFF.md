# Performance and Modularization Handoff

> **STATUS 2026-06-12: backend modularization M1–M6 COMPLETE.** All six
> modules extracted, unit-tested, and perf-matrix-gated before merge:
> M1 telemetry (7a1b809, into gateway_util), M5 camera_broker (13536c2),
> M6 hal_bridge (0f6ed80), M2 status_runtime (0a29f76), M3 ws_fanout
> (dd80e79), M4 bulk_pipeline (c2097e0). gateway.py 7100 → 5715 lines;
> backend suite 180 → 233 tests. Final clean artifact:
> runlogs/perf-matrix/20260612T183249Z-fd2ac48.json. Remaining from this
> doc: the frontend splits (lcncWs.ts / ThreeViewer.vue) only.

## Execution Lessons (recorded 2026-06-12, after completing M1–M6)

### Ledger — done vs deferred-by-design

| Module | Shipped | Deliberately left |
|---|---|---|
| M1 telemetry | ingestion validation + body/event caps → `gateway_util` | no separate `telemetry_runtime.py` — `lcnc_trace` already IS the runtime |
| M5 camera_broker | single-producer fan-out module | — |
| M6 hal_bridge | watchdog + reader sockets, RPC, freshness | heartbeat COROUTINE stays in gateway (bridge transports values, never produces) |
| M2 status_runtime | sampling/serialization, WCS + var-file caches, program timer, poll-timing decision, ERR reads | **status generation/version publication (`_status_gen`/`_status_event`/`_shared_*`) still lives in the gateway poller** — it sits at the M2/M3 seam; move it only if the poller orchestration itself is ever extracted |
| M3 ws_fanout | de-closure (ClientState = single source of truth, incl. `armed`), wire format, registry, send/timeout/drop policy, delta diff, tick stats, named-safety-args envelope builder | the per-client status loop stays in gateway: connection lifecycle, settings side effects, version-ping orchestration, and the hb-stall disarm safety action (deliberately un-abstracted) |
| M4 bulk_pipeline | preview/surface/grid payloads + publication contract, parse/fusion subprocess lifecycle | the poller still decides WHEN to refresh (orchestration) |

### What stays in gateway.py on purpose

Orchestration loops (`_status_poller`, per-client `status_loop`, heartbeat +
disconnect-grace), command dispatch (this doc's original call — still right),
connection lifecycle + arm/hello/armed-resume policy, and safety actions.
That is why gateway.py is still ~5,700 lines; it is not unfinished extraction.

### Process lessons — apply these when writing the frontend-split handoff

1. **Obstacle inventory beats more target design.** The unplanned half of M3
   was discovering the status loop is a closure inside `ws_endpoint` with
   `nonlocal armed` duplicated into ClientState at every write site. Read the
   code and list what currently ENTANGLES each boundary before estimating.
2. **State-mutability inventory per module.** Stable-object state (dicts,
   lists, bound methods) → legacy-name rebinds, near-zero call-site churn
   (M2/M3/M6). Reassigned scalars/bytes → every call site edits (M4, ~90
   sites). This is the dominant effort variable and it's knowable up front.
3. **Prescribe execution order by seam consumption.** We ran M6 → M2 → M3 →
   M4 because each consumes the previous module's seam.
4. **Track each plan line item at merge time**: done / deferred-by-design /
   dropped. An unmarked partial reads as complete later (see M2 publication).
5. **Per-module working plan file in the repo root** (the M3_WS_FANOUT_PLAN.md
   pattern; delete on merge) — cheap insurance against context loss mid-refactor.

### Gate checklist (operational — this is the part that actually goes wrong)

1. Suite restart required (uvicorn does NOT hot-reload). Verify the gateway
   process start time POSTDATES the commit under test before trusting a run.
2. **Exactly one suite owner at a time.** A colliding `linuxcnc` start tears
   down the shared realtime layer on its way out and kills HAL under the
   running gateway — this voided one gate run mid-matrix.
3. Pristine latch before `sigstop_trip`: fresh boot leaves it faulted TRUE;
   clear via WS `safety_trip_ack → arm(true) → estop_reset → arm(false)`.
4. No parallel CPU-heavy work on the dev box during the matrix.
5. Trailing trace pad ≥ 3.5 s — trip events land late via the reader pipeline
   (a 1 s pad once produced a false PASS).
6. Before calling PASS: confirm the evidence channel was alive for the WHOLE
   run (sigstop `direct` keys non-null, latch readable afterwards). Silence
   without a live evidence channel is not a pass.
6b. The matrix hard-fails (exit 1, LIVENESS FAIL) when a scenario's viewers
   receive zero status frames — added after the M4 sweep regression shipped a
   dead fan-out THROUGH a green gate (0d36338): a gate that doesn't assert
   the product's basic function is a blind gate. test_ws_smoke.py guards the
   same property at unit level; new guards get proven adversarially
   (re-introduce the bug, watch them fail).
7. Reference the artifact (`runlogs/perf-matrix/<utc>-<gitrev>.json`) in the
   merge commit.

### Conventions adopted during execution

- Refactors **flag, don't fix** pre-existing oddities — inline NOTE at the
  site (e.g. the always-firing post-poll `viewer_init` re-send in
  `ws_endpoint`; decision deferred to the frontend-split session).
- New test modules must assume `fake_linuxcnc` is installed process-wide in
  full-suite order (test_rfl_guard / test_command_dispatch import it first) —
  stub `linuxcnc.ini` etc. explicitly; two status_runtime tests passed
  standalone and failed in suite order before this was understood.

## Baseline

- Branch: `development`
- Audited commit: `103d662cd4318afc6b393de997350b4b757ea8fd`
- At audit time, `HEAD` matched `origin/development`.
- Existing extractions are complete: `command_policy.py`, `tool_table.py`,
  `settings_store.py`, and `tool_store.py`.
- Command dispatch was deliberately not extracted because it remains tightly
  coupled to LinuxCNC globals and safety-sensitive locking.

Verification at this baseline:

- Backend: 113 tests passed.
- Frontend: 14 tests passed.
- `npm run build`: passed.

This handoff proposes no relaxation of the HAL watchdog, command serialization,
path validation, upload limits, or atomic persistence.

## Executive Summary

The current branch already contains several important performance fixes:

- One global LinuxCNC status poll instead of one poll per client.
- Shared pre-encoded status data for WebSocket fanout.
- Hidden-tab suppression and one outstanding send per client.
- Bulk preview, surface, and grid payloads moved from WebSocket to HTTP.
- G-code parsing isolated in a subprocess.
- Browser WebSocket and client heartbeat owned by a worker.
- Render-on-demand, shared Three.js geometry, virtualized G-code text, and a
  circular backplot buffer without per-point `copyWithin`.

The next work should focus on actual remaining costs rather than repeating
historical fixes. The highest-value areas are:

1. Reduce diagnostic traffic that currently creates measurable load.
2. Remove synchronous file and parsing work from async request handlers.
3. Use one camera producer instead of capture and JPEG encode per viewer.
4. Move bulk frontend decode and geometry preparation off the UI thread.
5. Improve surface-map and HALshow scaling.
6. Extract runtime modules along ownership boundaries.

The retained traces do not contain current `ws.encode_slow` or
`stat.poll_slow` events. Do not describe the historical upload-adjacent stall
as conclusively caused by WebSocket encoding. The event loop stall is proven;
the exact CPU owner still requires correlated measurement.

## Implementation Review - 2026-06-07

This review compares the recommendations below with
`perf/heartbeat-margin-offload` at commit
`16638f5de8da650b44e552ca219c313d508c8eac`. The reviewed range also includes
the issue #34 HAL trip-latch fix and the recent installer change after the
original `103d662` audit baseline.

### Implemented Well

- **P0.1 WebSocket pressure telemetry:** pressure now uses a meaningful
  threshold and transition reporting, while browser telemetry is batched.
  This substantially reduces the observer load that originally obscured the
  real stalls.
- **P0.3 trace and HTTP filtering:** routine telemetry traffic no longer pays
  the same request-tracing and access-log cost as normal API traffic.
- **P1.1 upload path:** `POST /upload` now streams bounded chunks into a
  same-directory temporary file, offloads blocking disk operations, rejects
  oversized input during the stream, and publishes only with an atomic rename.
  Normal and oversized behavior have unit coverage.
- **P1.3 NC path initialization:** stable NC-file paths are warmed during
  lifespan startup and no longer require a first-request `STAT.poll()`.
- **G-code parser launch:** subprocess creation and `communicate()` have moved
  off the event-loop thread. This addresses the measured process-launch stall
  without moving parsing back into the gateway process.
- **WebSocket encoding direction:** the unused `_status_encode_executor` was
  removed. This correctly preserves the existing inline envelope design rather
  than reintroducing a thread pool that cannot solve GIL contention.
- **Frontend P4.1 core work:** preview fetch, msgpack decode, and nested-to-flat
  conversion now run in a browser worker. Transferable typed arrays avoid the
  previous main-thread `flat()` and copy path.
- **Diagnostic controls:** asyncio slow-callback logging and `gc.freeze()` are
  opt-in. Keeping `gc.freeze()` default-off matches the recommendation to treat
  it as an A/B experiment rather than a proven production fix.
- **Safety preservation:** the heartbeat trip latch now runs in the HAL servo
  thread, and an unhealthy client disconnect requires explicit re-arm. The HAL
  regression test confirms that a short heartbeat loss remains latched until a
  valid live reset.
- **WebSocket compression:** disabling per-message deflate is a reasonable LAN
  optimization for this already compact, high-frequency msgpack stream.

### Partially Implemented

- **P1.1 save path:** atomic disk persistence is offloaded, but
  `content.encode("utf-8")` still runs inline in the async route. FastAPI also
  materializes the large JSON request before the handler executes. A maximum
  size save can therefore still create event-loop GIL and allocation pressure.
  Prefer a raw or multipart streaming endpoint; at minimum, move encoding into
  the blocking worker.
- **P1.2 Fusion import:** reads are bounded and JSON/transformation work is
  dispatched to a thread. However, `json.loads` can hold the process GIL, so a
  thread does not guarantee heartbeat isolation near the 50 MB limit. Measure
  the largest accepted workload and use a process or a smaller realistic limit
  if it threatens the heartbeat margin.
- **P4.1 preview format:** browser decode and flattening are off the main
  thread, but the Python worker and gateway still create, decode, and re-encode
  nested point arrays. Bounds, feed-line ranges, and rapid line-distance work
  also remain on the browser main thread.
- **GC experiment:** the guarded implementation is appropriate, but no
  committed A/B evidence yet demonstrates improved heartbeat margin with
  stable long-run RSS.
- **Fanout attribution:** phase timing has improved, but no result yet justifies
  pre-encoding multiple client-envelope variants or changing the deliberate
  inline encode design.

### Incomplete

- **P0.2 diagnostic quieting:** `hal_watchdog.py` still writes every received
  heartbeat to a line-buffered file. Replace this with a bounded in-memory ring
  and persist it only on a threshold breach or trip.
- **P2.1 status polling:** parameter-file path resolution and related INI work
  still need the proposed cache and explicit invalidation.
- **P2.2 adaptive polling:** the feature remains experimental. Transition and
  stale-state characterization must be added before enabling it by default.
- **P3 shared camera producer:** each viewer can still cause duplicate queued
  capture/encode work.
- **P4.2 surface processing:** invalid-cell lookup and per-point rendering costs
  remain.
- **P4.3 hot allocations:** tool metadata signatures and other status-side
  allocation reductions remain.
- **P5 HALshow:** topology caching and frontend name-to-index maps remain.
- **Priority 6 startup/bundle work:** production build output still reports
  large chunks and ineffective dynamic imports for modules that are also
  statically imported.
- **M1-M6 modularization:** the proposed backend ownership modules have not
  been extracted. `previewWorker.ts` is a useful frontend extraction, but
  `gateway.py`, `lcncWs.ts`, and `ThreeViewer.vue` still own most of the mixed
  runtime responsibilities described below.
- **Performance acceptance matrix:** maximum-size upload/save, near-limit
  Fusion import, low-power preview, multi-viewer camera, HALshow scale, and
  long-duration RSS/GC scenarios have not been captured as repeatable tests or
  before/after trace artifacts.

### Review Findings to Resolve

1. **G-code worker shutdown ownership:** cancelling the coroutine awaiting
   `asyncio.to_thread()` does not stop the thread or child process. Its
   `finally` block clears `_gcode_parse_proc`, so lifespan shutdown can lose the
   handle before terminating the child. Keep ownership until worker completion
   and test shutdown during an active parse.
2. **Preview work is not bounded/latest-wins:** stale results are discarded,
   but superseded worker fetch/decode operations continue concurrently. Add a
   worker-owned `AbortController` or serialize requests so only the newest
   version consumes network, memory, and CPU.
3. **Upload cancellation needs coverage:** executor-backed file writes are not
   cancelled when the awaiting coroutine is cancelled. Ensure an in-flight
   write finishes before close/unlink and add a slow-write cancellation test.
4. **Installer can overwrite local safety configuration:** the installer says
   an existing sim configuration is retained, then unconditionally uses
   `ln -sf` for `lcnc_webui.hal`. Preserve an existing regular file or require an
   explicit migration instead of silently replacing it.
5. **Lint regression:** `lcnc-webui/src/lcncWs.ts` contains an irregular
   whitespace character in the new preview comment, causing `npm run lint` to
   fail.

### Verification at Reviewed Commit

- Backend: 128 tests passed.
- Frontend: 14 tests passed.
- Production build: passed, with large-chunk and ineffective dynamic-import
  warnings.
- HAL trip-latch integration: passed.
- Frontend lint: failed on one irregular-whitespace error in `lcncWs.ts`.
- No visual large-program preview smoke test or target-hardware performance
  matrix was performed as part of this review.

## Follow-Up Implementation Review - 2026-06-09

This review compares the handoff recommendations with
`perf/heartbeat-margin-offload` at commit
`cc79ed9ee0c13af807665c3ce0c2b2d3e56f59ae`.

### Scope Decision

The M1-M6 backend/frontend modularization plan is intentionally deferred. That
is not treated as an implementation deficiency in this review. The current
priority is to prove the performance and safety behavior before moving runtime
ownership across module boundaries.

The remaining comments below concern correctness, concurrency, lifecycle
ownership, residual hot paths, and missing performance evidence.

### Implemented Since The 2026-06-07 Review

- **P0.2 diagnostic quieting:** heartbeat arrivals now use a bounded in-memory
  ring and are persisted only for forensic events. Missing-pin reporting is
  edge-triggered with a slow reminder.
- **P1.1 save path:** UTF-8 encoding, size validation, atomic persistence, and
  `fsync` now run off the event loop.
- **P1.2 Fusion import:** the accepted payload was reduced to a realistic
  16 MiB ceiling. Decode/transformation remains off the event loop.
- **P2.1 status polling:** parameter-file resolution is cached by INI identity
  and invalidated during reconnect/config reset.
- **P3 camera direction:** a latest-frame `CameraBroker` now shares one encoded
  frame stream between viewers instead of scheduling capture and JPEG encoding
  per viewer.
- **P4.1 preview path:** worker output is published by the gateway without
  decode/re-encode; browser fetch/decode/flatten is off-thread; bounds are
  emitted by the parser; superseded preview fetches are aborted.
- **P4.2 surface rendering:** the color buffer is a `Float32Array`, and probe
  dots use one `InstancedMesh` instead of one mesh per point.
- **P4.3 hot allocations:** normalized kinematics are cached by source identity
  and tool metadata changes use reference comparison instead of repeated
  `JSON.stringify`.
- **P5 HALshow backend:** topology is cached and can be explicitly invalidated
  through `halshow_refresh`.
- **P6 startup:** `ThreeViewer.vue` and Three.js now load through an async
  component boundary. The initial application chunk is approximately 395 KiB
  minified; the approximately 866 KiB Three.js chunk is no longer part of the
  initial application chunk.
- **Review follow-ups:** preview fetch cancellation, installer backup behavior,
  upload-cancellation coverage, parse-process termination helpers, and the lint
  error all received follow-up commits.

### Findings To Resolve

1. **High - clean armed reconnect resume is disabled by cleanup ordering.**
   `ws_endpoint` removes the client from `_clients` before calculating heartbeat
   age. The later lookup therefore always misses and substitutes `1e9`, so even a
   healthy Ctrl-R/Wi-Fi reconnect cannot register an armed-resume hold.
   Capture `last_hb` or heartbeat age before `_clients.pop(client_id, None)`.

   Relevant code:

   - `lcnc-gateway/gateway.py:6730`
   - `lcnc-gateway/gateway.py:6764`

2. **High - parse-process shutdown ownership remains racy.**
   Lifespan cancels registered background tasks before it captures
   `_gcode_parse_proc`. Cancelling `_refresh_gcode_preview()` runs its `finally`
   and clears the global handle, while the `asyncio.to_thread()` worker and
   subprocess may continue. The new `_terminate_parse_proc()` tests verify the
   termination helper in isolation, but not shutdown during a live parse.

   Keep process ownership until the blocking worker completes, or capture the
   process handle before cancelling its owner. Add a lifespan-ordering test that
   starts a real/stub parse, initiates shutdown, and proves the child is reaped.

   Relevant code:

   - `lcnc-gateway/gateway.py:4632`
   - `lcnc-gateway/gateway.py:4769`
   - `lcnc-gateway/gateway.py:4805`

3. **Medium - simultaneous first camera subscribers can start two producers.**
   `CameraBroker.subscribe()` increments the count, observes `_task is None`,
   awaits `_camera_init`, and only then assigns `_task`. Two concurrent requests
   can both enter that window. An isolated cooperative scheduling check at this
   commit produced two camera-init calls and two producer tasks.

   Serialize start/stop transitions with an async lock or retain a shared
   startup task. Add a test using `asyncio.gather(b.subscribe(), b.subscribe())`.

   Relevant code:

   - `lcnc-gateway/gateway.py:6877`
   - `lcnc-gateway/test_camera_broker.py:56`

4. **Medium - camera release is fire-and-forget and races loop shutdown/reuse.**
   `_stop()` cancels the producer and creates an unawaited `to_thread` release
   task. The camera unit test emitted `Task exception was never retrieved:
   Executor shutdown has been called`. A subscriber arriving while release is
   pending can also cancel the timer but cannot cancel or await the already
   scheduled release, allowing the release to close a newly reused device.

   Give the broker an awaitable `close()`/`stop()` operation, track its release
   task, and call it explicitly from lifespan shutdown. Await release before a
   new start completes.

   Relevant code:

   - `lcnc-gateway/gateway.py:6897`
   - `lcnc-gateway/gateway.py:4813`
   - `lcnc-gateway/test_camera_broker.py:73`

5. **Medium - upload cancellation coverage does not exercise cancellation
   during a disk write.**
   Executor-backed writes continue independently if the awaiting coroutine is
   cancelled. The current cancellation test cancels while `UploadFile.read()` is
   sleeping, after prior writes have completed. It therefore does not prove
   close/unlink waits for an in-flight write.

   Add a controlled slow `f.write` or injectable blocking-writer seam; cancel
   while that operation is active and assert close/unlink happen only after the
   write completes.

   Relevant code:

   - `lcnc-gateway/gateway.py:5013`
   - `lcnc-gateway/test_command_dispatch.py:371`

6. **Medium - adaptive polling is enabled in the sim config without the
   recommended characterization.**
   Unknown/stale fields currently fall through as inactive and select the idle
   rate. The handoff requires unknown or stale state to select 30 Hz. No tests
   were found for idle-to-motion, MDI, AUTO, tool-change, fault, or stale-reader
   transitions.

   Treat incomplete/stale status as active, add transition tests, and retain the
   feature flag until command-to-status latency has been measured.

   Relevant code:

   - `lcnc-gateway/gateway.py:1840`
   - `examples/sim_config/lcnc_suite_sim.ini:61`

7. **Medium - P5 HALshow frontend scaling remains incomplete.**
   Backend topology caching is complete, but every value update still allocates
   three `Set`s and scans every pin, signal, and parameter array. Build persistent
   name-to-index maps when a snapshot arrives and update only delta keys.

   Relevant code:

   - `lcnc-webui/src/lcncWs.ts:901`
   - `lcnc-webui/src/lcncWs.ts:906`

### Residual Partial Work

- **P1.2 Fusion import:** the 16 MiB cap materially reduces risk, but
  `json.loads` remains GIL-bound in a thread. The source comments estimate about
  100 ms at the limit; no committed near-limit heartbeat trace currently proves
  the remaining margin on target hardware.
- **P2.3 fanout:** useful attribution and shared-body work exist, but no evidence
  yet justifies further envelope grouping/pre-encoding.
- **P4.1 frontend geometry:** feed-line range maps and dashed line-distance
  attributes are still computed on the browser main thread.
- **P4.2 surface completion:** invalid grid cells still perform
  `O(invalid cells * probe points)` nearest-point scans on the main thread.
- **P4.3 reactive allocations:** `safetyTrip` and `configWarning` still create
  fresh objects on repeated equivalent status messages.
- **P6 bundle cleanup:** viewer lazy loading is successful, but Vite still
  reports ineffective dynamic imports for `lcncWs.ts` and `lcncApi.ts`, and the
  Three.js async chunk remains above the generic 500 KiB warning threshold.

### Acceptance Evidence Still Needed

The implementation now covers most of the recommended performance directions,
but the handoff's repeatable acceptance matrix is still absent. Capture and
retain comparable results for:

- maximum-size upload and save
- near-limit Fusion import
- low-power/target-hardware preview load
- simultaneous multi-viewer camera startup and teardown
- large HALshow topology/value updates
- idle-to-active adaptive polling transitions
- long-duration RSS and GC behavior, with and without `WEBUI_GC_FREEZE`
- maximum expected visible-client fanout
- deliberate event-loop blockage proving the HAL trip latch still fails closed

For each workload, retain maximum heartbeat gap, event-loop lag, slow callback
owner, RSS, GC duration, queue depth, and before/after commit identity.

### Verification At Follow-Up Commit

- Exact commit:
  `cc79ed9ee0c13af807665c3ce0c2b2d3e56f59ae`
- Frontend unit tests: 14 passed.
- Frontend lint: passed.
- Frontend production build: passed.
- Python compilation of changed gateway modules: passed.
- Backend suite was not certifiable in this environment:
  - the camera test completed under `unittest` but emitted an unhandled
    executor-shutdown task exception;
  - broader `pytest`/`unittest` runs did not complete within the bounded review
    window, including a command-handler execution test hanging while awaiting
    executor work.
- No LinuxCNC simulation, visual preview smoke test, or target-hardware
  performance matrix was run during this follow-up.

## Safety Invariants

Every performance change must preserve these rules:

1. HAL heartbeat generation remains in the gateway event loop and process.
   Moving it to an independent worker would mask a frozen gateway.
2. Do not increase the 500 ms watchdog timeout to hide latency.
3. `hal_watchdog.py` remains independent, fail-closed, and minimal.
4. All `CMD.*` access remains serialized by `_cmd_lock`.
5. Do not concurrently use LinuxCNC NML handles unless their thread-safety has
   been explicitly established.
6. Slow clients receive bounded/latest-wins work; queues must not grow without
   limit.
7. Uploaded and edited files remain path-validated, size-bounded, and
   atomically published.
8. Browser heartbeat is client authorization/liveness, not the physical safety
   watchdog.
9. Diagnostic failure must never alter machine-control behavior.

## Priority 0: Correct the Measurement Load

### P0.1 WebSocket buffer-pressure telemetry

Relevant code:

- `lcnc-webui/src/wsWorker.ts`, `startBufferSampler()`
- `lcnc-webui/src/lcncWs.ts`, telemetry batching
- `lcnc-gateway/gateway.py`, `POST /telemetry`

The worker currently reports whenever `WebSocket.bufferedAmount > 0`. Normal
small writes, commonly 19 bytes, therefore produce one event per second per
tab. Retained traces contained:

- 30,836 `browser.ws.send_buffer_pressure` events.
- 39,208 telemetry POST requests.

Recommended change:

- Treat pressure as a state transition, not a nonzero sample.
- Use a meaningful threshold, initially 64 KiB.
- Emit once when crossing the threshold and once when recovering.
- Optionally emit a periodic summary only while pressure remains sustained.
- Increase ordinary telemetry batching latency to approximately 1-3 seconds.
- Keep unload/error events eligible for immediate beacon delivery.

Acceptance:

- An idle healthy tab emits no buffer-pressure events.
- Sustained pressure is still visible with peak bytes and duration.
- A multi-tab idle test produces near-zero telemetry request traffic.

### P0.2 Temporary heartbeat and pin diagnostics

Relevant code:

- `lcnc-gateway/hal_watchdog.py`, the `HB-RECV` probe
- `lcnc-gateway/hal_reader.py`, missing-pin prints
- `lcnc-gateway/gateway.py`, temporary GC/HB/status probes

The watchdog writes every received heartbeat to a line-buffered file. Missing
HAL pins can print every 30 Hz tick. This can perturb the processes being
measured and make real faults harder to identify.

Recommended change:

- Replace per-heartbeat writes with an in-memory fixed-size ring of timestamps.
- Persist the ring only on a threshold breach or safety trip.
- Edge-trigger missing-pin warnings and add a slow periodic reminder.
- Keep aggregate one-second timing summaries.
- Remove completed temporary probes after issue #35 has sufficient evidence.

Acceptance:

- Healthy operation produces no per-heartbeat disk writes.
- A trip bundle still contains the preceding heartbeat timing history.
- Missing pins remain visible without 30 log lines per second.

### P0.3 Trace filtering and HTTP middleware

`lcnc_trace._CrashFilter` parses each already-encoded trace line using
`json.loads` to reject nearly every event. HTTP middleware also emits start and
end records for each telemetry request.

Recommended change:

- Attach the trace tag to the `LogRecord` and filter without decoding JSON.
- Skip routine `http.start` records for `/telemetry`, or record only slow/error
  completions and aggregate request counts.
- Preserve complete records for mutations and safety-relevant endpoints.

## Priority 1: Keep Blocking Work Out of Async Handlers

### P1.1 Upload and save

Relevant routes:

- `POST /upload`
- `PUT /save`

Current behavior reads the entire body before checking the 50 MB limit and
calls `atomic_write_bytes` synchronously from an async route.

Recommended design:

- Stream upload chunks into a temporary file in the destination directory.
- Enforce the size limit while reading.
- Flush and optionally `fsync` off the event loop.
- Atomically rename only after validation and successful completion.
- Remove the temporary file on disconnect, cancellation, or failure.
- For `/save`, move UTF-8 encoding and atomic persistence to a worker. Consider
  a streaming text endpoint later only if large editor saves remain costly.

Thread offload is appropriate for blocking file I/O. If a large pure-Python
transformation is later proven to monopolize the GIL, use a process instead.

Acceptance:

- Oversized requests stop near the limit rather than being fully buffered.
- Interrupted uploads never expose partial destination files.
- Heartbeat timing remains healthy during a maximum-size upload.
- Existing path and extension checks remain unchanged.

### P1.2 Fusion tool-library import

Both import routes read up to 50 MB, decode JSON, transform it, and inspect the
tool table from an async handler.

Recommended design:

- Apply bounded upload handling.
- Run decode and Fusion transformation off the event loop.
- Use a process only when profiling shows the parser holds the GIL long enough
  to threaten the heartbeat budget.
- Keep final persistence under `_cmd_lock` through the existing store APIs.
- Do not pass live LinuxCNC handles into a process.

### P1.3 First-use initialization

`get_nc_files_dir()` can perform `STAT.poll`, INI parsing, and directory
creation on its first request.

Recommended change:

- Resolve and validate stable machine paths during lifespan startup.
- Cache paths by active INI identity.
- Invalidate them explicitly when the active INI changes.

## Priority 2: Runtime Fanout and Polling

### P2.1 Status poll cost

`poll_status()` resolves the parameter-file path through `linuxcnc.ini` and
stats its mtime on every 30 Hz poll.

Recommended change:

- Cache the resolved parameter-file path by INI filename.
- Continue checking mtime if needed, but avoid reconstructing the INI parser.
- Invalidate the cache on INI change.
- Measure before optimizing small list copies or active-tool lookup.

The status and error-channel reads currently use two sequential executor
dispatches. A single worker call may reduce scheduling overhead, but only
combine them after confirming use of the two NML handles in one worker thread
is valid.

### P2.2 Adaptive polling

Adaptive idle polling already exists behind `WEBUI_ADAPTIVE_POLL`.

Recommended rollout:

- Add characterization tests for transitions into motion, MDI, AUTO, tool
  change, fault, and stale/unknown state.
- Unknown or stale state must select 30 Hz.
- Active motion remains 30 Hz.
- Enable 5 Hz only for confidently idle machines.
- Measure command-to-first-updated-status latency before making it default.

### P2.3 WebSocket fanout

The shared status body is already encoded once. Remaining work is primarily
per-client envelope construction and sending.

Potential later optimization:

- Separate shared high-frequency machine state from low-frequency client and
  safety metadata.
- Pre-encode common envelope variants only if multi-client traces demonstrate
  material envelope cost.

Do not restore the status encode thread pool. The current inline design is
deliberate, and retained traces show no current `ws.encode_slow` events.
Remove the unused `_status_encode_executor` and contradictory comments after
the issue #35 instrumentation period ends.

## Priority 3: Shared Camera Producer

Every `/camera/stream` client currently schedules its own capture and JPEG
encoding. A lock serializes those operations, so additional viewers add queued
duplicate work rather than throughput.

Recommended `CameraBroker`:

- One producer task captures and encodes at configured FPS.
- Store only the latest immutable JPEG and a monotonically increasing sequence.
- Consumers await the next sequence and stream the same bytes.
- Start the producer on the first subscriber.
- Stop and release the device after the last subscriber and a short grace.
- Use a dedicated one-worker executor or capture thread.
- Drop stale frames; never queue an unbounded frame history.

Acceptance:

- One and ten viewers produce approximately the same capture/encode rate.
- A slow viewer does not delay other viewers or the producer.
- Camera shutdown remains deterministic.

## Priority 4: Frontend Bulk Processing

### P4.1 Preview decode and geometry format

`lcncWs.ts` decodes multi-megabyte msgpack preview payloads on the main thread.
`ThreeViewer.makeLine()` then performs `points.flat()` and copies into a
`Float32Array`. The line-number map and dashed-line distances are also built on
the UI thread.

Recommended protocol:

- Have the parser worker produce flat position arrays.
- Include bounds and feed line ranges in the worker result.
- Transfer `ArrayBuffer`s from a dedicated browser bulk worker.
- Construct `BufferAttribute` directly from transferred arrays.
- Avoid nested arrays and `points.flat()`.
- Compute rapid line-distance attributes off-thread, or avoid dashing very
  large rapid paths if visual requirements permit.

This removes repeated nested-list creation and copying across:

1. Python parse worker output.
2. Gateway msgpack decode.
3. Gateway msgpack re-encode.
4. Browser msgpack decode.
5. JavaScript `flat()`.
6. `Float32Array` construction.

### P4.2 Surface mesh

For each invalid grid cell, the viewer scans every raw probe point. It also
creates one mesh per probe point.

Recommended change:

- Fill missing grid values in the processing worker using a spatial index, or
  publish a complete grid from the backend.
- Allocate the color buffer as `Float32Array`.
- Render points with `THREE.Points` or `InstancedMesh`.
- Build the complete surface object off the status hot path and swap it in
  atomically.

### P4.3 Small hot-path allocations

- Replace `JSON.stringify(meta)` on every status with a tool metadata version or
  stable signature.
- Cache normalized kinematics during viewer initialization.
- Update `safetyTrip` and `configWarning` refs only when their actual fields
  change.
- Measure Vue update time before splitting the global status ref.

## Priority 5: HALshow

Backend:

- Cache topology produced by the three `halcmd` subprocesses.
- Invalidate only on explicit refresh or detected HAL graph change.
- Keep the 5 Hz value path in `hal_reader`, not the safety watchdog.

Frontend:

- Build name-to-index maps when a snapshot arrives.
- Apply only keys present in each delta.
- Avoid rebuilding three full `Set`s and scanning all arrays per update.
- Consider shallow reactive arrays plus one version bump after a batch.
- Virtualize large expanded groups if DOM profiling shows rendering cost.

## Priority 6: Startup and Bundle Cost

The production build succeeds but reports:

- Main application chunk: approximately 440 KB minified.
- Three.js chunk: approximately 866 KB minified.

Recommended change:

- Lazy-load the viewer and Three.js when the viewer surface first becomes
  active.
- Move the relevant static imports behind a real route/component boundary.
- Do not rely on dynamic imports from modules that are also imported statically;
  Vite correctly keeps those in the original chunk.

This is primarily startup responsiveness, not machine-control latency.

## GC Guidance

`gc.freeze()` is a candidate experiment, not a confirmed fix.

Observed test-process generation-2 collections were approximately 7-13 ms.
Retained operational traces did not contain structured GC events proving that
GC caused the historical upload-adjacent stall.

Safe experiment:

1. Complete stable startup and long-lived cache construction.
2. Run an explicit collection.
3. Freeze only long-lived startup objects.
4. Record generation, duration, RSS, object growth, and heartbeat gaps.
5. Compare identical reconnect/upload workloads with and without freezing.

Do not use GC changes as a substitute for removing avoidable allocations,
diagnostic spam, or synchronous request work.

## Modularization Plan

The extraction should follow state ownership and concurrency boundaries.

### M1: `telemetry_runtime.py`

Own:

- Trace sampling policy.
- Aggregators and rate limits.
- HTTP telemetry ingestion validation.
- Temporary diagnostic enablement.

Do not own:

- Machine control.
- Watchdog state.

This is a low-risk first extraction and immediately supports P0.

### M2: `status_runtime.py`

Own:

- Status sampling and serialization.
- WCS and parameter-file caches.
- Program timer state.
- Status generation/version publication.
- Poll timing.

Dependencies should be injected:

- `STAT`/`ERR` accessors.
- INI/path resolver.
- reader snapshot accessor.
- trace callback.

Publish immutable snapshots. Do not expose mutable internal caches to client
tasks.

### M3: `ws_fanout.py`

Own:

- Per-client state.
- Hidden/slow-client suppression.
- Envelope construction.
- Send timeout and disconnect policy.
- Version pings for preview, surface, grid, settings, and tool table.

Receive status snapshots from `status_runtime`; do not call `STAT.poll()`.

Keep authorization and safety metadata explicit in the interface. Avoid a
generic event bus that obscures when `armed`, trip state, or stale-reader state
is attached.

### M4: `bulk_pipeline.py`

Own:

- G-code parse subprocess lifecycle.
- Preview publication and compression.
- Surface/grid file loading and encoding.
- Versioned immutable cached payloads.

Publication contract:

- Build all data first.
- Swap payload and metadata together.
- Increment version last.

### M5: `camera_broker.py`

Own the single-producer design described in P3.

### M6: `hal_bridge.py`

Own:

- Reader socket connection and request/reply correlation.
- Watchdog socket connection and bounded nonblocking sends.
- Reader snapshot freshness.

Important boundary:

- The gateway heartbeat coroutine remains in `gateway.py` or a gateway-runtime
  module running on the same event loop.
- `hal_bridge` transports a heartbeat value but must not independently produce
  one.

### Frontend modules

Split `lcncWs.ts` into:

- `wsTransport.ts`: worker lifecycle and raw message transport.
- `statusStore.ts`: status buffering, safety banners, timing samples.
- `telemetry.ts`: batching, sampling, unload delivery.
- `halshowStore.ts`: topology maps and value deltas.
- `bulkData.ts`: preview/surface/grid fetch and decode worker.

Split `ThreeViewer.vue` logic into:

- `toolpathController.ts`
- `surfaceController.ts`
- `backplotController.ts`
- `machineAssetCache.ts`

Keep Three.js object ownership explicit so geometry and material disposal does
not become ambiguous.

## Command Dispatch Boundary

Do not extract command dispatch in this work.

Before reconsidering it:

1. Wrap LinuxCNC command/status/error handles behind a characterized adapter.
2. Make `_cmd_lock` ownership explicit in that adapter.
3. Add tests for command ordering, wait timeouts, disconnect jog-stop, ESTOP
   reset, tool reload, and stale-state rejection.
4. Ensure no extracted helper silently acquires `_cmd_lock` recursively.

The current monolithic dispatch is large, but an unsafe abstraction would be
worse than its size.

## Suggested Delivery Sequence

1. Fix telemetry thresholds and remove per-heartbeat disk writes.
2. Add upload/import stall benchmarks and structured request-phase timings.
3. Implement bounded atomic upload/save.
4. Implement the shared camera producer.
5. Cache parameter-file resolution and HALshow topology.
6. Add the frontend bulk decode/geometry worker.
7. Optimize surface rendering.
8. Extract `telemetry_runtime`.
9. Extract `status_runtime`.
10. Extract `ws_fanout`.
11. Extract `bulk_pipeline`, `camera_broker`, and `hal_bridge`.
12. Enable adaptive idle polling only after transition tests pass.
13. Evaluate `gc.freeze()` with an A/B workload.

Each step should land independently with tests and trace evidence.

## Performance Test Matrix

Use at least these scenarios:

1. One visible idle tab for 30 minutes.
2. Twelve tabs reconnecting simultaneously.
3. Visible and hidden tab mixture.
4. Maximum-size upload during active status streaming.
5. Fusion import near the accepted size limit.
6. Large G-code preview load on a low-power client.
7. Long-running program after the backplot ring becomes full.
8. Surface map with many probe points and invalid grid cells.
9. HALshow open with a large HAL graph.
10. One and ten camera viewers.
11. Slow/non-reading WebSocket client.
12. Gateway freeze and process termination to confirm the HAL chain still trips.

Record:

- Heartbeat pre-send and watchdog receive gaps.
- Event-loop lag.
- Status poll, shared encode, envelope encode, and send duration.
- Executor queue depth.
- Browser decode, apply, and render duration.
- Telemetry request/event rate.
- RSS and generation-2 GC duration.
- Camera capture/encode rate independent of viewer count.

## Definition of Done

- No performance fix weakens a safety invariant.
- Healthy operation is diagnostically quiet.
- Async handlers contain no unbounded blocking file or CPU work.
- Maximum-size uploads do not expose partial files or threaten heartbeat timing.
- Camera cost is independent of viewer count.
- Large preview and surface processing does not monopolize the browser UI thread.
- Modularized components have explicit ownership and injected dependencies.
- Backend and frontend test suites remain green.
- Production build remains free of TypeScript errors.
- Improvements are supported by before/after traces, not assumptions alone.
