# Checks run through — plan v1 (operator decision 2026-11-26)

**Status:** a plan. Nothing is built yet. All code is read at `origin/development` `dbd14cab` (worktree `/home/cnc/lcnc-suite-gates`); the start package is read at `feat/start-ask` `224b3402` (worktree `/home/cnc/lcnc-suite-start`). Line numbers refer to those trees.

**The decision** (`docs/reviews/maschinentag.review.md:10684` on `feat/backlog-integration`, commit db98176f; follow-up answers in this session):
- When the check is on, it runs **through**: no pause while a program runs, while a dialog is open, while the view rotates or moves, or while the tab is in the background.
- The rotary-jog **park stays**: that is a pose change, not a compute pause.
- The advice "don't switch it on for a weak machine PC" goes in the **README only**, not the UI.

## 1. What "enabled in the settings" is today

- **ONE switch per device:** Settings › Devices › "Simulation: timeline, collision check, Sim tab" (`DevicesSettings.vue:164-165`), saved as the device section `simulation` (`defaults.ts:103, 110, 730-747`).
  - New devices start with it OFF (`defaults.ts:734`).
  - It acts only once the server holds it: `simulationOn = serverSettingsReady && enabled` (`defaults.ts:792-795`, `CONFIRMED_DEVICE_SECTIONS`).
- **Off means no check at all:**
  - every start path reads `simulationOn`: `runCollisionCheck` :4244, `_colPostSide` :4300, `continueCollisionCheck` :3869, `_colScheduleAuto` :4347/4355, `_startRunCheck` :4433;
  - switching it off terminates the worker with its pool and resident model and drops every result (`_simulationOff` :4516ff, watcher :4546).
- **Nothing new is needed.** "Enabled" is this switch. The package only changes what happens while it is ON.

## 2. Every pause, throttle, park, budget and deferral — classified

**Key:** (a) a compute pause or throttle → REMOVE; (b) a correctness hold → STAYS; (c) unclear → question. All `ThreeViewer.vue` lines unless another file is named.

### (a) Remove

| # | What | Where | Its recorded reason |
|---|---|---|---|
| A1 | **Camera hold**: OrbitControls `start`/`end` post `pause`/`resume` `why:"camera"`; 30 s auto-expiry | listeners :5513-5517; `_camMoving` :4030; re-applied at post and continue (`_colApplyPauses` :4043, called :4282, :3876); worker: `PauseWhy` `collisionWorker.ts:119`, `PAUSE_MAX_MS` :131-133, `setHold` default branch :256-257, pump :414-422 | "a busy worker starved the GPU side of the browser (2026-09-10)" (:5513-5515, `collision.md:450-453`, decisions 2026-09-13 `decisions.md:4914-4920`) |
| A2 | **Hidden-tab hold** `why:"hidden"` | :4044, `_colOnVisibility` :4050-4052, listener :5461 / :5598; worker `setHold` :253 | "a sweep must not burn a core behind another window" (:4025-4029, `collisionWorker.ts:18-22`) |
| A3 | **Decode hold** `why:"decode"`, while a preview payload decodes, in a run and at idle | :4045, watcher :4048-4049; flag `ws/bulkData.ts:693-696`; worker `setHold` :254 | "the decode and a sweep would compete for the cores" (`bulkData.ts:694-695`; plan „Prüfung im Lauf" Paket 4, `docs/reviews/restpruefung-lauf.plan.md:152-157`) |
| A4 | **Run shard cap**: a check posted in a run gets `maxShards = min(2, seam ?? 2)` | :4189-4191 | "the machine is cutting; the check must not take the cores from the page" (:4189-4190). **A no-op on the N100**: `hardwareConcurrency` = 2 there (isolcpus is respected, `~/claude-work/p4/machine-day-results.md:78`), so `shardCount` = max(1, 2 − 2) = 1 shard anyway (`collisionWorker.ts:575-582`). It only matters on browsers with ≥ 5 reported cores. |

### (b) Stays — not a compute pause

| # | What | Where | Why it stays |
|---|---|---|---|
| B1 | **Rotary-jog park** (`stop` → `continue` after 4.5 s settled) | watcher :4005-4017, `_colOnRotarySettled` :4018-4023, `stopCollisionCheck` :3861, `continueCollisionCheck` :3868, `ROTARY_STOP_DEG`/`ROTARY_SETTLE_MS` :3253-3254 | The operator's exception: the pose changes and the track is re-parsed. A run's own rotary motion parks nothing (:4010-4011). |
| B2 | **Start deferrals at idle**: the re-parse hold notes a re-check instead of starting it (`checkHeld`); the drift wait; `previewBasisPending`; `machineReady`; sim mode (ScrubBar checks the entry track) | :4363 (`_holdApply({kind:"check"})`), `_colDriftReady` :4370/4392-4425, :4361, :4360, :4359 | The basis is in flux: a check started now would be cancelled by the next publication (P2b-2, E1). These delay a START; they never pause a running check. |
| B3 | **Run admission**: no check for a run the preview does not cover (P6-d0); a publish in a run that is not a pinned parse for this run waits for idle (MR-I03); `admitRunCheck`; discard on origin/run/connection/idle | `_colNotChecked` :3342-3344, `_colEnterNotChecked` :4565-4598, `_colHeldByRun` :4334-4337/:4365/:4612, `_startRunCheck` :4433-4441, `_discardRunCheck` :4485-4503 | Correctness. **"No pause in a run" does not mean "every run is checked".** A run without an admissible basis stays "not checked". |
| B4 | **Supersede, never queue**; the 400 ms debounce of the re-check | `collisionWorker.ts:8-10`; :4352 | A changed input starts ONE new check (touch-off sequences change several values quickly). Not a pause. |
| B5 | **Page-side steps**: the contact publisher drives its passes in ~8 ms slices with a macrotask between them; a starved slice runs in a frame | `contactPublisher.ts:220-243`, `steps.ts:108-160` | Not a pause: the work goes on as fast as the page answers, and it runs in a hidden tab too (MessageChannel, `steps.ts:117-121`). Taking the yields out would bring back the 0.3–1.2 s single tasks that held the Escape and E-Stop handlers (`collision.md:851-855`; CLAUDE.md "no long task on the page"). **Must stay.** |
| B6 | **Contact acknowledgements**: one unacknowledged delta per path | `collisionWorker.ts:455-460`: `sendContacts` then `setTimeout(pump, 0)` unconditionally | The sweep never waits for an ack; deltas coalesce. Only the final result waits for the last ack. Not a pause. |
| B7 | **Bounds**: the sample backstop (coarser from 4 M samples, stop past 16 M) and a full contact store (`truncated.reason "budget"`) | `collision.md:196-199`, `:699-700` | Limits on a runaway, not pauses. Out of scope. |
| B8 | **K = cores − 2** (at most 8, at most 4 M triangles of copies) | `collisionWorker.ts:518-519, 575-582` | A sizing invariant (CLAUDE.md:333; Codex R90): it leaves the page and the browser two cores. It is not a pause. Recommendation: keep (Q-C3). |
| B9 | **Side sweeps** (the entry move, a run's start-dependent beginning) | `collisionWorker.ts:28-30` | They never pause or park today. Nothing changes. |
| B10 | **Gateway-side checks**: the soft-limit validation runs in the gateway's parse (not behind the device switch); a pinned mid-run parse runs at nice 19 | `bulk_pipeline.py:563-568` | Out of scope. They are no browser check, and the nice level only orders the parse behind LinuxCNC and the gateway. It delays the run check's START by the parse's length (33 s on the machine, `machine-day-results.md:48`) but pauses nothing (Q-C8). |

### (c) Unclear — questions

| # | What | Where | Reading |
|---|---|---|---|
| C1 | **Re-parse hold on a RUNNING check** (`pause`/`resume` `why:"reparse"` at the hold's free ↔ held edges) | :4931; worker :255; `bakeHold.ts:29, 32` (windows 6 s / 20 s) | **Recorded reason was load:** "the check beside the parse took the browser's frames" (VP188-02 E1, `scrub-and-run.md:368-378`, `collisionWorker.ts:116-118`). **But:** it is idle-only — `_holdAdmission` returns "a run" / "the interpreter is busy" (:4961-4967) — so it never acts during a program. What it holds is a check of a preview the gateway is re-parsing. **Cost either way:** after an adoption the check is cancelled anyway (the adoption schedules the new version's check), so running on is wasted compute (the operator's W2: "verschwendete Rechenleistung"). Without an adoption it goes on and stands (`bake-hold.viewer.spec.ts:648-680`, "without one the paused check goes on"). **Recommendation: keep** (Q-C1). |
| C2 | **20 ms slices in a run** (default 40 ms) | :4192-4193 | **Not a throttle:** slices run back to back, with `setTimeout(pump, 0)` between them (`collisionWorker.ts:460`). The slice length only sets how soon a cancel, stop or witness tick lands, and how often progress is posted. **Recommendation: drop it with A4,** so a check posted in a run is the idle request: one request shape, and "the run budget" is gone as a concept (Q-C2). |
| C3 | **The browser's own hidden-tab behaviour** | `gateway.py:14656-14668` + `lcncWs.ts:91-105`; `stallWindow.ts:15` | (1) **No status while hidden:** a hidden client gets no status frames (the storm guard). So the page's view of the machine freezes until the tab shows, and its STATUS-DRIVEN edges wait: the rotary park, the input-change re-check, the run's entry and end. They catch up at the first status after showing. (Only the status skip is verified here; whether other broadcasts, e.g. a publication, still reach a hidden client is not read.) (2) **Page timers** (the 400 ms re-check, the 4.5 s settle) are clamped by the browser to ≥ 1 s. (3) **Worker throttling unknown:** whether Chromium or Firefox throttle a hidden page's dedicated-worker timers (the pump's `setTimeout(pump, 0)`) is not known here. It must be measured (§4.6). **Scope this package promises:** a check that is running continues in a hidden tab. Starting follows the status as today. |

### No dialog pause exists

- **Nothing to remove:**
  - `modalOpen` (`modalRegistry.ts:24`) is read only by the shortcut map (`App.vue:1988` → `useKeyboardShortcuts.ts:47, 138`) and the registry's diagnostics (`modalRegistry.ts:237`);
  - no check path reads it, and the same holds on `feat/start-ask` (`grep _colSetPaused` there: camera / hidden / decode / reparse only, `ThreeViewer.vue:4043-4059, 5030, 5615-5616`).
- **One negative guard (G3) is added** so that no dialog, the start dialog included, can introduce a pause later.

## 3. The change

**`viewer/collisionWorker.ts`**
- `PauseWhy` becomes `"reparse" | "diag"` (`diag` = the test seam below, never sent by product code).
- Remove: `pausedCam`/`pausedCamAt`/`pausedHidden`/`pausedDecode` (Run :144-148, PoolRun :539-543, Holds/HoldFlags :246-250, fall back :789-790, init :930-931) and `PAUSE_MAX_MS` (:131-133).
- `setHold` (:252-258): an unknown `why` holds NOTHING. Today the default branch is the camera hold.
- The pump's pause branch (:414-422) keeps `reparse` + `diag`. A stop during a pause parks at once (:420). Today it clears camera, hidden and decode and KEEPS `reparse` (R197). **`diag` follows the camera's behaviour** (cleared by the stop, parks at once), because the specs that use the seam were written against the camera hold.
- Header comment :18-24, :114-119.

**`ThreeViewer.vue`**
- Remove:
  - the camera listeners and their comment (:5513-5517);
  - `_camMoving` (:4030);
  - `_colOnVisibility` and its listener (:4050-4052, :5461, :5598);
  - the decode watcher (:4048-4049);
  - the camera, hidden and decode lines of `_colApplyPauses` (:4043-4045).
- The request becomes `maxShards: _colMaxShards` (seam only) and no `sliceMs` (:4189-4193).
- Rewrite the comment at :4025-4029.
- The render loop's own `visibilitychange` (`_onVisibilityChange` :5139, :5521) is not the check. It stays.
- **Test seam:** `__viewerDiag.setCameraHold` (:2386-2391) → `setSweepHold(on)`, posting `why:"diag"`. Hold-log entries become `diag on/off`. The hold log (`getCollisionHoldLog`) stays.

**Elsewhere**
- `shims.d.ts:60` (the seam's type).
- Comments: `ws/bulkData.ts:693-695`, `ScrubBar.vue:673-675`.
- **No UI words change.** No word names a camera, hidden or decode pause; "Paused at … — a rotary moved" (`ScrubBar.vue:676-680`) is the park; the Devices switch label stays; no load hint in the UI (operator).

**Docs** (short form AND full entry, CLAUDE.md rule)
- **`CLAUDE.md:333`** → "open-ended and runs through (no pause for a run, a dialog, the camera or a hidden tab — operator 2026-11-26), parked by a rotary jog".
- **`CLAUDE.md:500`**, the lesson "let interaction (camera) and a hidden tab pause every background job". Keep its evidence ("a Web Worker is off the main thread, not off the machine"), add the operator's override for the check, and name the README advice.
- `collision.md:189-191, 450-453`; `scrub-and-run.md:281-284` ("Load: …") and :375-376 ("independent of camera / hidden / decode").
- A `decisions.md` entry 2026-11-26 recording the decision, the classification above and the measurements of §4.
- The README section (§7). `docs/testing.md` if a new spec file appears (none planned).

**Selector and inventory**
- No new source file.
- The inventory atom `listener:ThreeViewer.vue:document.visibilitychange` (`scripts/inventory/atoms.web.json:3720`) stays (the render loop keeps one listener). The inventory guard runs as always.
- The native build-count case reads `maxShards or MAX` (`scripts/test_support/native_cases.py:2043`): unchanged.

## 4. Risk — honest

### 4.1 What changes on the operator's machine (N100, isolcpus=2,3, Chromium on the panel)

- **The check there is ONE worker** (§2 A4). Lifting the run cap changes nothing on this machine.
- **What does change:** that worker keeps its core while the view rotates, while the panel's tab is hidden and while a payload decodes, in a run too. Today those moments freed the core for the page and the GPU.
- **The model build was never paused.** `buildCollisionModel` runs synchronously in the request handler (`collisionWorker.ts:334-340`), before the run and its pause flags exist (:361-367). On 2026-11-22 it was the heavy part: 62–94 s per tool change, since cached by P2b-1 (`collision.md:443-445`, `decisions.md:11954` — 25 of 38 windows with main-thread lateness > 150 ms overlapped those builds).

### 4.2 Evidence already on record

- **F31** (`machine-day-results.md:121`): simulation ON on the panel, a 73–76 s sweep after every tool change. The panel's status gaps rose to 160–370 ms (otherwise 50–70 ms) and a hold press was refused ("Page delayed — hold again"). The record names the mitigation then: "simulation off on the panel (per device)". It does not show that the operator switched it.
- **10.1** (`:101-102`): cores 0+1 at 89–95 %, page long tasks of 504 / 576 ms, no HB-WAKE and no `lag.window` during the load.
- **6.2** (`:48`): the run check took 11.5 s, "no HB-WAKE during the run so far".
- **:40 vs :48 — not verified.** "Last HB-WAKE ~11:01" falls INSIDE the first check's window (11:00:11–11:01:41). Whether that HB-WAKE came from the check is not verified; the HB-WAKE lines are in the machine's `gateway.log`, not read here. **The build reads it before anything claims either way.**
- **2026-11-22 trace** (`~/claude-work/p4/machine-20261122/trace-1300.ndjson.gz`, read for this plan):
  - 177 min, two pages; the sweeps were the panel's, all with one shard, mostly idle checks dominated by the 62–94 s model builds; 12 min inside sweep windows, 165 min outside;
  - `browser.ws.hb_delivery_stall`: 49.8 / min inside (598) vs 30.7 / min outside (5068); per window 0–80 (0 in the 91 s sweep at 13:57:58);
  - `browser.viewer.perf` window `gap_p95`: median 51 vs 50 ms, p90 116 vs 101 ms, max 683 (a 6 s cancelled sweep at 13:42:14) vs 381 ms; `age_max` p90 154 vs 81 ms, max 551 vs 650 ms;
  - `hal_watchdog`'s select loop (`wd.tick_summary.max_select_ms`): max 100.1 inside vs 102.2 ms outside, i.e. nominal;
  - the run checks there swept in 68–257 ms;
  - **a correlation over pooled pages, no attribution.** The bulk of the stalls lies outside the sweeps; no camera or hidden phase was recorded.

### 4.3 What the operator will notice

- **On a weak PC with the simulation on:** rotation stutters while a check runs, and more holds are refused ("Page delayed — hold again"). That refuses a START, never a stop: stops are taps, and E-Stop acts on the press.
- **A jog** under a starved page ends by its lease (500 ms, renewed every 100 ms from the main thread): the safe direction, but visible.
- **Every open tab** of a device with the simulation on runs its own check, a hidden one too: two tabs on one PC, two checks.

### 4.4 The safety margin

- **The competition:** the gateway (its heartbeat loop) and `hal_watchdog` run at nice 0 on the same two cores. The gateway's own parse is niced (`bulk_pipeline.py:563-568`); a browser worker cannot be.
- **Why one busy core alone is unlikely to make a 500 ms gap:** CFS wakes a sleeping heartbeat loop ahead of a CPU-bound worker. The heartbeat to HAL is the gateway's, and the page's heartbeat runs in the WS worker.
- **This is NOT MEASURED** with a check running through a camera drag during a program on the N100. The project treats every HB-WAKE as margin (memory `feedback_hbwake_is_safety_margin_signal`). The operator accepts the cost through the README advice; the measurement below says what it is.

### 4.5 Instruments

**Gateway side:**
- `[HB-WAKE]` in `gateway.log` (> 100 ms; `gateway.py:1078-1092`);
- trace `lag.window` (`gateway.py:1393`);
- `wd.hb_edge` (`hal_watchdog.py:318-323`, best-effort forensics);
- `wd.tick_summary`;
- `safety` trip events and trip bundles.

**Browser side:**
- `browser.viewer.perf` (`gap_h`, `age_h`, `apply_h`, `raf_*`, `mt_*`, `gpu_*`, `in_delay_h`, `rt_net_h`, `hb_pairs`, `vis_changes`, `span_col_*`; `viewerPerf.ts:574`);
- `browser.stall` (the hold guard's stall histogram, `hidden_ms`; `viewerPerf.ts:679`, `stallWindow.ts`);
- `browser.longtask`, `browser.ws.hb_delivery_stall`;
- `browser.collision.sweep_start` (`max_shards`) and `sweep_done`. `ms` is wall time from the post (:3787) and `sweep_ms` is active time. **Their ratio is the pause share:** ≈ 1 in every phase is the proof that the check ran through.

`scripts/perf_matrix.py` measures the gateway alone, with its own WebSocket clients. It is useful only as a contention probe, `idle_baseline` with a browser check running beside it (optional).

### 4.6 Checks the build runs

1. **Offline:** the round gate (`round_gate.py --base dbd14cab`, or the start-ask head, §5), with the inverted guards and mutations of §6.
2. **VM, browser + native, under the heavy lock.** The browser-PC driver (`~/claude-work/bpc/drive2.py` + `bpc2.py report`):
   - **phases:** a HEAVY run check (owed since 2026-10-21: a long program that runs to the end), a camera-drag phase during the run, a hidden-tab phase in a REAL background tab (headful Chromium and the Firefox core: the worker-throttling question C3), a dialog open;
   - **targets** as recorded (`scrub-and-run.md:284-292`): status age p95 < 50 ms, heartbeat gap p99 < 300 ms, HAL watchdog receipt < 201 ms;
   - **plus:** no HB-WAKE, `lag.window`, `wd.hb_edge` or trip attributable to the check, and `sweep_done` `ms / sweep_ms` ≈ 1 in the camera and hidden phases.
   - If the hidden phase shows the browser throttling the worker, the remedy is a MessageChannel yield in the pump instead of `setTimeout(pump, 0)`. It is built only then, with its own guard.
3. **Machine (only with the operator at the machine and his go; owed before main, not a merge gate):**
   - one real program with the simulation ON on the panel, read for the same instruments;
   - the `[HB-WAKE]` lines of 2026-11-21 11:00–11:02 read first (§4.2).

## 5. Dependency: the start-message package (`feat/start-ask`, 224b3402)

**Where the start plan keeps the budget**
- Plan v2 §5.2 (`docs/reviews/maschinentag.r503.plan-start-v2.md:395-400, 409, 577, 603`):
  - "running or parked → cancel; `_startRunCheck` under the run budget. No live re-budget of a posted job";
  - the run's beginning "under the run budget";
  - N3 "re-posted under the run budget";
  - M11c "reuse of a running job without the run budget".
- Plan v3 (`maschinentag.r504.plan-start-v3.md:9, 23`) keeps "the run budget" and excludes the budget from the job key.

**What changes**
1. **The reason for "never adopt a running or parked main" is gone** (`ThreeViewer.vue:4517-4518` there: "its budget was set at its post"). The rule itself should stay. **Recommendation: keep cancel-and-re-post** (Q-C4). Reasons that remain:
   - the run's job is posted from the run's basis with a provisional range from the playhead;
   - only run checks carry the witness stamp;
   - a running job's in-flight deltas and acknowledgements belong to the idle owner — handing them over mid-flight would be a contract of its own.
2. **Rewording:**
   - M11c → "reuse of a running or parked job", red at the same guard;
   - N3 → "re-posted as the run's own job";
   - "under the run budget" goes from v2 §5.2, `ThreeViewer.vue:4554` (start tree), `scrub-and-run.md:1140` (start tree).
3. **`viewer/colJobKey.ts:5, 15`:** `maxShards` / `sliceMs` stay EXCLUDED from the key (the shard seam still sets `maxShards`); only the word "budget" in the comment changes. `colJobKey.test.ts:21` (the positive control for id and budget fields) stays valid.
4. **Seams:** the 7 `setCameraHold` uses on the start branch (`e2e/collisions.viewer.spec.ts:306, 318, 1048, 1066, 2228, 2247`, `e2e/bake-hold.viewer.spec.ts:132`) move to `setSweepHold`.
5. **The start dialog** (plan v2 §4.6, "the lines update live") gets its case in G3 once both are merged.

**Merge order (recommendation):** `feat/start-ask` first (agreed plan, in its round gates); this package then branches from it and makes the edits in 2–4. If this package lands first, start-ask rebases and makes them itself. Either way the code conflict is small: the budget lines `ThreeViewer.vue:4189-4193` are unchanged on the start branch, at :4187-4190 there.

## 6. Guards, tests and mutations

### 6.1 Inverted — never deleted silently

**`viewer/collisionWorker.test.ts`**
- :159-169 "a hidden-tab pause holds the run" → **"a camera, hidden or decode word holds nothing"** (casts; the run finishes as without it). The hold mechanism itself is re-proven with `diag`.
- :170-182 (decode vs hidden independence) → **reparse vs diag**.
- :183-190 (decode released during the pool) → `diag`.
- :241 (R91 VP-I49 "paused or not", `why:"hidden"`) → `reparse`.
- The re-parse block :295-304, :313, :330-337 → its `decode` partner becomes `diag`.

**`e2e/collisions.viewer.spec.ts`**
- :726 `["decode on","decode off"]` → **no `decode` entry** in the hold log during the run's decode.
- :730 `sliceMs toBe 20` → **null** in a run.
- :736 `maxShards ≤ 2` → **equals 3** after `setCollisionShards(3)` before the run (red under the old `min(2, …)`).
- :757 (idle default) stays.

### 6.2 Seam replaced, assertions unchanged

- `e2e/collisions.viewer.spec.ts:306-308, 318, 1048-1050, 1066, 2224, 2243`;
- `e2e/bake-hold.viewer.spec.ts:132, 595, 603, 666, 672, 718, 723`;
- "camera on" → "diag on" in the waits.

### 6.3 New guards

Each is red at `dbd14cab` or under its mutation.

- **G1 camera:** a real pointer drag on the canvas, held while a check runs. Progress rises during the drag, and the hold log has no `camera`. Red at the base: the hold lasts until release or 30 s, and the poll gives it 10 s.
- **G2 hidden:** the seam of `keyboard-guards.spec.ts:960-964` overrides `visibilityState` only, but `_colOnVisibility` reads `document.hidden` (:4050-4052), so the guard overrides **`document.hidden` too**. Hidden while a check runs, progress rises while hidden. **Its control:** the same steps at the base must show `hidden on` in the hold log and no progress, or the guard does not count (else G2 and M2 are green for the wrong reason).
- **G3 dialog:** Settings open (and, after the rebase, the start dialog) while a check runs. Progress rises. Red under M6.
- **G4 run request:** `setCollisionShards(3)`, then a run check. Meta `maxShards` 3, `sliceMs` null. Red at the base.
- **G5 park stays (keep-green control):** the rotary-park cases stay green — `collisions.viewer.spec.ts:850` ("at standstill a rotary move parks the check"), `:1075` (a parked check at a run from line) and `bake-hold.viewer.spec.ts:712` ("a check parked by a rotary jog under the hold goes on after the hold").
- **G6 reparse stays (keep-green, if Q-C1 = keep):** `bake-hold.viewer.spec.ts:589, 630, 648` (E1).
- **G7 static (unit):** product code posts `pause` only with `"reparse"`; `"diag"` only inside the `__viewerDiag` seam. A source scan of `ThreeViewer.vue` in the `propShadow.test.ts` manner.
- **G8 worker (unit):** an unknown `why` holds nothing.

### 6.4 Mutations — each red at its guard

| # | Mutation | Red at |
|---|---|---|
| M1 | camera pause restored | G1 |
| M2 | hidden pause restored | G2 |
| M3 | decode pause restored | inverted :726 |
| M4 | run cap `min(2, …)` restored | G4 |
| M5 | `sliceMs: 20` in a run restored (if Q-C2 = drop) | G4 |
| M6 | a pause on `modalOpen` | G3 |
| M7 | a product path posts `diag` (e.g. on camera start) | G7, G1 |
| M8 | `setHold`'s default branch holds | G8 |
| M9 | the rotary park removed | G5 |
| M10 | the reparse pause removed (if kept) | G6 |

## 7. README

**Where:** `README.md`, section `## Requirements`, after `### Reference UI` (README.md:283-284), as a new subsection.

**Draft:**

> ### Simulation and collision check (optional, per device)
>
> Each browser switches its own simulation in **Settings › Devices** ("Simulation: timeline, collision check, Sim tab"); a new device starts with it off. With it on, the collision check runs whenever a program is loaded and runs **through**: it does not pause while a program runs, while a dialog is open, while you rotate or move the 3D view, or while the tab is in the background. Only a rotary-axis jog parks it until the axis has settled, and a change of the program, an offset or the tool starts it again. Running through does not mean every run is checked: a run the preview does not cover (for example a run from a line) is shown as "not checked". The check runs in Web Workers on the computer the browser runs on — one worker per core except two, at least one — and every open tab of a device with the simulation on runs its own check, a hidden tab too.
>
> **Recommendation:** do not switch the simulation on for a browser on a weak machine PC — for example a mini PC whose real-time setup isolates cores (`isolcpus`) and leaves the desktop two. There the check keeps a core busy for minutes on a large program, beside the gateway, LinuxCNC's non-real-time side and the browser itself: the 3D view and the page react more slowly and a hold may be refused ("Page delayed — hold again"). Run the simulation on a second computer instead — any browser on the LAN with its own device profile — and leave it off on the machine panel.

## 8. Questions

### For Codex

- **Q-C1 (reparse hold, C1):** keep the `reparse` pause of a running check? It is idle-only (`:4961-4967`), it holds a check whose preview is being re-parsed, its result is cancelled at an adoption, and it is bounded by 6 s / 20 s. Recommendation: keep it, and say so in the decision entry. If you read it as a compute pause in the operator's sense, I ask him. And confirm A3: the decode hold (also mostly over a check about to be superseded, but recorded as a load measure and acting during a run) is (a) and goes.
- **Q-C2 (slices, C2):** drop the 20 ms slices in a run together with the shard cap (one request shape, no "run budget"), or keep them as a message-latency choice?
- **Q-C3 (K, B8):** keep "cores − 2" as the sizing invariant? The operator's words are about pauses, not about giving the check the page's cores.
- **Q-C4 (start-ask, §5):** with the budget gone, keep "never adopt a running or parked main; cancel and re-post"? The reasons are run basis + range, witness, in-flight ownership. And the merge order: start-ask first?
- **Q-C5 (hidden scope, C3):** is "a running check continues; starts, parks and run edges follow the status when the tab shows" the right reading, with the hidden client's status skip left as it is (the storm guard)? And is the MessageChannel pump fallback only on measured throttling acceptable?
- **Q-C6 (seam):** a diag-only hold (`why:"diag"`, `setSweepHold`) instead of the camera hold as the e2e seam, guarded by G7 — or should the specs hold the sweep through a Worker tap?
- **Q-C7 (measurement as a gate):** is the VM browser-PC run (§4.6 step 2) a merge precondition for this package, or owed before main with the machine reading?
- **Q-C8 ("Prüfungen", B10):** the operator said checks, plural. Is the reading right that only the browser's collision check (with its side sweeps) is meant, and that the gateway's soft-limit validation and the niced pinned parse are out of scope?

### For the operator

None needed now. Q-C1 goes to him only if Codex reads the re-parse hold as a compute pause.
