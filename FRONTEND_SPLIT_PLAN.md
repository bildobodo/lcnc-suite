# Frontend Program — Working Ledger

Working ledger for the frontend architecture + UI-quality program (approved plan:
WS-A architecture splits → WS-B viewer_init backend fix → WS-C consistency audit →
WS-D 9-axis layouts → WS-E performance finish → WS-F silent-fallback sweep).
Delete this file at program end; the handoff doc gets the completion status block.

Branch per phase (`refactor/fe-…`), merge to `development` on green gate.
**Never promote development → main** — that requires the user's real-hardware
validation pass (policy 2026-06-12).

Standard gate per commit: `npm run build` (vue-tsc -b, zero TS) + `npm run lint`
+ `npx vitest run`. Phase end: `npm run test:e2e` + user manual smoke on the sim.
WS-B additionally: backend suite + suite restart + full perf matrix.

## Review checklist (every split commit)

- [ ] No `export let` anywhere (eslint rule enforces; the backend-M4 aliasing class —
      a re-exported binding that the owner reassigns goes stale/aliased across modules).
- [ ] Reassigned scalars stay PRIVATE to their owning module; cross-module access via
      function call only (e.g. `noteHeartbeatSent()`), never shared mutable state.
- [ ] Bulk renames via `\b` word-boundary regex ONLY; post-grep for mangle signatures;
      review the diff hunk-by-hunk (the M4 lesson: `str.replace` corrupted
      `_last_comp_grid_version` → dead fan-out that every gate missed).
- [ ] `src/ws/*` modules are leaves: never import `./lcncWs` or each other
      (`grep -rn 'from "\.\./lcncWs"\|from "\./' src/ws/` reviewed per commit).
- [ ] Viewer controllers take `ctx` per call; NEVER cache ctx fields (scene/workRotGroup/
      workOrigin/toolMarker are reassigned per build — a cached pointer renders into an
      orphaned graph: invisible objects + leaks, no error).
- [ ] Every new regression guard proven adversarially: re-introduce the bug, watch the
      guard go red, restore. Record the proof in this ledger.
- [ ] Module side-effect ORDER preserved in lcncWs body (registerSettingsSaver, window
      listeners, loadStoredMessages) — wiring stays in the orchestrator.

## Export surface (lcncWs.ts at split start — guarded by src/lcncWs.exports.test.ts)

33 value exports (23 refs/computed + 10 functions) + 12 type exports
(LcncMessage, WsStatus, TimingComponentStats, TimingStats, HalPin, HalSignalPin,
HalSignal, HalParam, ViewerPart, KinematicsList, ViewerInit, ViewerGcode).
The snapshot test asserts the exact name set — additions are conscious edits to
the snapshot, never accidents.

## Phase ledger

### A0 — Guards (branch `refactor/fe-a0-guards`)

| Item | State | Notes |
|---|---|---|
| A0.1 ledger file | done | this file |
| A0.2 export-surface snapshot test | done | `src/lcncWs.exports.test.ts` (33 value exports: 23 refs + 10 fns; 12 type exports compile-guarded) + `src/testGlobals.ts` (defaults.ts touches `document` at import; vue runtime-dom probes `createElement` once `document` exists) |
| A0.3 e2e liveness guards (frames.spec.ts, scripted mock-gateway) | done | mock got mutable state + `/ctl` scripting channel + viewer_init/halshow fixtures + `quiet` op; specs pin status / status_delta / pong / halshow_snapshot / halshow_update → rendered DOM. Green on monolith. |

### A1 — lcncWs split (5 commits, easy→hard)

| Module | State | Notes |
|---|---|---|
| eslint `export let` ban | done | `no-restricted-syntax` on export let/var, all src |
| src/ws/halshowStore.ts | done | 6 unit tests; halshow e2e liveness green through the new module |
| src/ws/bulkData.ts | done | 9 unit tests (stubbed fetch + FakeWorker); previewWorker chunk verified in build output; full e2e green. Test lesson: undici Response bodies settle across MACROtasks — flush with setTimeout(0), not Promise.resolve() |
| src/ws/telemetry.ts | done | 4 unit tests (fake timers); `_onVisibility` stayed in lcncWs; telemetry owns its 4 listeners + own HMR dispose; wakeLock.ts now imports emitTelemetry from the leaf (breaks the lcncWs↔wakeLock cycle — the one intentional consumer edit) |
| src/ws/wsTransport.ts | done | 7 unit tests (FakeWorker lifecycle, buildWsUrl, session stability); wsWorker chunk verified; e2e connects through the real transport. RTT anchors still in lcncWs until A1.5 (then crossed via noteHeartbeatSent() only) |
| src/ws/statusStore.ts | done | 18 unit tests incl. F1 pinned byte-for-byte; RTT anchors crossed via noteHeartbeatSent()/notePong() only; `registerSettingsSaver` wiring stayed in lcncWs body. Final lcncWs = 314 ln (from 1,096). Test lessons: drain fake timers BEFORE useRealTimers (else the module's _flushScheduled flag deadlocks — destroyed timer, surviving flag); fake clock starts performance.now() at 0, which defeats `> 0` anchor guards |

### A1.6 — Smoke findings (both PRE-EXISTING, not split regressions; trace-proven)

| Finding | Evidence | Fix |
|---|---|---|
| Reload-disarm: a reloaded page never REQUESTS armed-resume (gateway checks its hold only when hello carries resume_armed=true; holds were registered, requests never sent) | trace: `session.resume_hold_registered` with no `session.resume_*` after reload | frontend: wsTransport persists server-confirmed armed in sessionStorage (change-only writes), boots the resume request from it; gateway hold/trip gates stay authoritative. e2e lifecycle.spec asserts the hello contract |
| No shutdown banner: uvicorn cancels WS tasks BEFORE lifespan shutdown → `_clients` empty → broadcast silently skipped (`if snapshot:`) → browser saw bare close 1006 | gateway.log: no `broadcast server_shutdown` line; trace: `browser.ws.close code:1006` | frontend belt-and-braces NOW: close codes 1001/1012 → shutdown banner. Gateway-side fix (server_shutdown send + close(1001) on task-cancel) → **DONE in WS-B** |

### A2 — Viewer disposal hazards (fixed BEFORE the A3 split)

**Key finding (A2.0):** the overloaded `userData._shared` flag meant two things —
(a) STL-cache geometries reused across viewer instances (must survive), and
(b) per-program toolpath geometries (must die on rebuild). And `disposeObject`
NEVER disposed materials at all. So the genuinely UNBOUNDED leaks are MATERIALS
(edge materials, colour clones orphaned per reconnect) — and `renderer.info` does
NOT count material instances. Therefore: the e2e probe guards the geometry class
(H2 toolpath); `src/viewer/disposal.test.ts` (dispose spies, headless THREE)
guards the material class. The unifying fix makes `_shared` mean uniformly
"externally owned — never dispose here" (applied to the 7 MAT.* + cache geoms),
removes it from per-program toolpath geoms, and makes `disposeObject` dispose
private materials too.

| Item | State | Notes |
|---|---|---|
| Leak probe + viewer.spec.ts | done | `window.__viewerLeakProbe` (renderer.info); delta-based spec (load→rebuild must free toolpath geom) — troika global glyph atlas (+3 geoms/+1 tex, once) cancels in the delta. Race-hardened (poll-for-rise after async load). Proven RED adversarially (re-tag toolpath `_shared` → delta collapses to 1). Serial `serial` project. |
| disposal.ts extraction + unit tests | done | 5 dispose-spy tests, proven RED (old behavior fails 4/5) |
| H1 backplot geom/material on teardown | done | not _shared → disposeObject frees geom; material now freed too |
| H2 clearScene skipped toolpath `_shared` geoms | done | toolpath geoms un-tagged; disposeObject frees them on rebuild |
| H3 toolMarker dual ownership | done | single-owner `replaceToolMarker()` (parent?.remove + disposeObject prior); both sites routed through it; `toolMarker` nulled on rebuild. NOT e2e-guarded — renderer.info can't see tool-marker geom (visibility/upload-dependent; verified count held flat even with dispose removed). Covered by disposal.test.ts + structural single-owner + A3 toolController units + manual smoke |
| H4 material clones never disposed | done | both clone sites (buildFromInit per-part colour + setMachinePartColor) clear the `_shared` that clone() copied from MAT.* so disposeObject frees them on teardown (latent A2.1 hole: custom-coloured parts would have leaked per rebuild); setMachinePartColor now disposes the replaced private clone (skips shared base). disposal.test.ts pins the clone gotcha. Material leaks aren't renderer.info-visible → precise per-site guard deferred to A3 parts controller |
| H5 `_machineEdgeLines` materials accumulate | done | covered by A2.1 (disposeObject frees edge geom+material on teardown) + array reset in ensureCoreGroups + `_edgesBuilt`-guarded buildEdgesLazy (no in-session accumulation). No new code needed |
| H6 surfaceGroup orphan parent assumption | done | `surfaceGroup` nulled on rebuild (clearScene already disposed it) so buildSurfaceLayer can't double-dispose a freed stale ref; build path uses parent?.remove |

**e2e flakiness (A2.2):** the single shared mock-gateway process + per-test
broadcasts caused intermittent serial-project failures (viewer toolpath delta;
lifecycle shutdown banner) — a one-shot `ctl` broadcast can race page WS
readiness. Fixes: a `reset` ctl op + `beforeEach` in both serial specs (kills
state bleed — frames.spec's status_delta had been mutating shared work_pos);
broadcast-driven assertions now POLL-RETRY the send (delivery-robust, still RED
if the UI logic is broken). 10/10 full runs green after.

### A3 — ThreeViewer split (4 commits)

| Module | State | Notes |
|---|---|---|
| src/viewer/viewerContext.ts (ViewerCtx) | pending | |
| src/viewer/machineAssetCache.ts | pending | |
| src/viewer/backplotController.ts | pending | adversarial stale-pointer test |
| src/viewer/surfaceController.ts | pending | |
| src/viewer/toolpathController.ts | pending | hardest |

Stays in ThreeViewer BY DESIGN: MAT shared materials; kinematics groups +
ensureCoreGroups + buildFromInit/applyState orchestration; scene/camera/controls
lifecycle; layer-visibility orchestration; view/tween/gizmo.

### WS-B — gateway ws_endpoint lifecycle (branch `fix/be-ws-b-viewer-init`)

The only gateway-touching phase (full perf-matrix gate). Two fixes, one commit:

1. **viewer_init single-send (F2).** Connect-time send + dead `viewer_init_sent
   = True` + unconditional `= False` reset removed; the post-poll send in
   status_loop is THE one send per connect (fires on first successful poll →
   always carries live axis data; `viewer_init_sent` defaults False on
   ClientState). The not-connected reset stays → re-send after LinuxCNC
   reconnect. Both sends called the same `build_viewer_init(stl_base_url)`, so
   the surviving payload is identical to the removed one. Trace tag renamed
   `ws.conn.viewer_init_late` → `ws.conn.viewer_init` (no tooling consumed it).
2. **server_shutdown at task-cancel (A1.6 smoke finding #2).** ws_endpoint
   gains an `except asyncio.CancelledError` handler: best-effort
   `server_shutdown` frame + `close(1001)`, each `wait_for`-bounded to 0.25 s,
   `ws.shutdown_goodbye_sent/_failed` traced, CancelledError re-raised. This is
   the only window a goodbye can reach clients — uvicorn cancels WS handler
   tasks BEFORE lifespan runs, so the lifespan broadcast always saw zero
   clients (browser got bare 1006).

Tests: new `test_ws_lifecycle.py` (viewer_init exactly-once over a pumped
session; cancel → server_shutdown recorded at the ws_send_json seam — client-
side receipt is untestable under TestClient because the cancel tears down the
session's own portal task; wire delivery is covered by lifecycle.spec.ts frame
+ 1001 paths). `fake_linuxcnc._Stat` gained `axis_mask = 7` — without it
build_viewer_init raised every tick and NO viewer_init was ever deliverable in
the test harness (pre-existing; hid the double-send from tests).

Gate: 236 backend ✓, 11 e2e ✓, suite restart + full perf_matrix ✓
(`20260704T080619Z-081e2f6` vs baseline `20260612T190402Z-0d36338`: all
steady scenarios 0 lag windows, fusion_near_limit improved 2→0, RSS well
under baseline). First run's sigstop_trip had `latch_before=TRUE` (boot-
faulted latch after restart — first-sight fault, audited not bannered) →
sticky evidence inconclusive; single-scenario rerun with pristine latch
(`20260704T080726Z-081e2f6`) reproduced the full baseline trip signature:
FALSE → trip → sticky TRUE → reset FALSE, safety.tripped +
trip_snapshot_done on trace. Live-trace check: every ws.connect.accept has
exactly ONE ws.conn.viewer_init (incl. the reconnect-storm clients — the
path where the double-send used to fire). User smoke pending: UI shutdown
→ banner (not bare disconnect).

### WS-C — consistency audit (branch `audit/fe-ws-c-consistency`)

Discovery: codebase largely compliant already (zero hardcoded spacing/
opacity/fs/radius tokens, no raw hex in CSS, no raw <Btn>, no permission
:class antipattern — KeyboardTab .inactive is the documented non-permission
case; native inputs are hidden file pickers; dialogs conform to tiers; all
:deep() layout-only). Three real drift families, three commits:

1. `ee183ba` — audit-scoped-css.py token-drift checks (TOKEN/HOVER/DEEP/
   STACK categories, brace/segment parser, audit-ok escape hatch). Proven
   adversarially: planted 7 TOKEN + 2 DEEP violations in a scratch style
   block — the FIRST parser (line-based) missed ALL single-line planted
   rules; rewritten segment-driven, all flagged, keyframes/audit-ok/deep-
   layout exemptions verified. NOT wired into lint in this commit.
2. `a651150` — 14 scoped stack-trio rules → stack-* utility classes across
   9 files (visual-neutral by construction; SafetyStrip.safetyBtn kept
   scoped + audit-ok: lands on a MachineBtn root where Btn.vue's scoped .b
   would beat a global utility).
3. `79e896f` — user-approved: new --hl-surface/--hl-surface-info tokens
   (surface hovers where button-bg --hl-* tiers can't apply; 5 sites
   converged), GamepadTab/KeyboardTab map tables → .dataTable, and
   `npm run lint` now chains lint:css → drift fails the gate from here on.

User visual check pending (see smoke list in the WS-C merge notes).
Deferred to later phases: per-panel label/value column-width alignment
(fold into WS-D — the 9-axis grid rework touches those layouts anyway).

### WS-D — dynamic 9-axis layouts (branch `refactor/fe-ws-d-9axis`)

Discovery (Explore pass): canonical source already existed (viewer_init.axes
→ App.axes computed) but grouping logic was copy-pasted in 5+ files, three
positional bugs, keyboard type-capped at x/y/z/a/b, gamepad XYZ-only.
User decisions: DELETE the unused ManualPanel/DroPanel/JogPanel/JogButton
cluster (superseded by strips since Feb 2026, zero importers); gamepad gets
the by-letter fix now, full stick→any-axis remap model DEFERRED (→ F7).

- D1 `651886e` — dead cluster deleted (4 files, ~1500 ln) + CLAUDE.md.
- D2 `f5ef4c7` — src/useAxes.ts (entries/groups/by-letter resolvers,
  isRotaryAxis) subsumes the 5 copies; POSITIONAL BUGS FIXED: JogStrip XY
  pad axis 0/1 + Z column index 2 → by letter (pad/column hidden when the
  machine lacks the axis); useTouchoffMath.setAxis mapped through canonical
  "XYZABCUVW" (lathe [X,Z]: setAxis(1) emitted G10 … Y!) + eoffset guard on
  index===2 → machine list + letter; ToolsetterSettings G30 position[0/1/2]
  → by letter. Tests: useAxes.test.ts + useTouchoffMath.test.ts; proof:
  reverting setAxis → 3 red.
- D3 `9665d7f` — KeyboardAction = template-literal union over all 9 axes;
  labels/defaults generated (c/u/v/w unbound); KeyboardTab jog rows
  generated from machine axes (XYZ fallback disconnected).
- D4 `4a4469b` — gamepad resolves X/Y/Z machine indices by letter; missing
  axes drop their stick/D-pad pair; App passes axes not axisCount.
- D5 `0e17553` — mock setAxes op + nine-axis.spec.ts (9-axis grid rows +
  HUD letters + ° on rotary + non-overlap bounding boxes; lathe no-phantom-Y;
  reset baseline). F6 done (shared e2e/ctl.ts). Proof: SetupStrip
  re-hardcoded to XYZ → 2 red — first attempt was INVALID (break didn't
  compile → playwright ran stale dist → green); e2e proofs must verify the
  break built.
- D6 `06213ed` — examples/sim_config 5-axis (XYZAC) + 9-axis (XYZABCUVW)
  INI/HAL variants, instant-homing extra joints.

Smoke (4 rounds, all user-driven on the real 5/9-axis sims):
- R1 `a6169ca` — jog pad flex regression (WS-C stack conversion missed the
  DYNAMIC :class site; .jogInner direction varies per modifier — never a
  stack-* candidate) + SetupStrip >3-axis overflow → chunked grids.
- R2 `86a3905` — jog ABC/UVW tight clusters; setup 6-row packing;
  OffsetPanel --val-cols min-width (10 columns scroll, don't collide);
  portrait axis grid. Mock setAxes now ships wcs_table/g92/tool_offset.
- R3 `e312441` — uniform 32px setup rows (catalog touchoff input md→sm —
  measured, the md INLINE size style beat scoped CSS); portrait single
  setup grid (isPortrait inject); portrait big-Z zone.
- R4 `f9ffc44` — portrait Z column width = other axis columns.
- R5 `b9c3a18` — GATEWAY BUG user-caught on XYZAC: teleop CMD.jog wants
  CANONICAL axis numbers (X=0…W=8), wire sends machine-list indices — C
  (list 4) jogged nonexistent B → silent no-motion, and the disarm
  jog-stop sweep missed C identically. _jog_axis_arg translates at all 7
  jog sites (jf==1 passes through). Gap-free axis sets (XYZ, 9-axis)
  masked the class entirely. Dispatch tests + adversarial proof.
Perf-matrix gate (gateway change): `20260704T134452Z-b9c3a18` vs baseline
— all load scenarios 0 lag (fusion 2→0), sigstop_trip full pristine-latch
trip signature, RSS below baseline; single 107.8ms idle receive blip, far
under budget, command-path-unrelated. C jog user-verified on 5-axis.

| F7 | useGamepad.ts | Stick/D-pad→machine-axis mapping is fixed XY/Z semantics; machines wanting rotary jog on a stick need a real remap model (settings UI: per stick axis/D-pad pair → any machine axis, per-axis invert, config migration) | deferred by user decision (WS-D scope call) |

### WS-E — performance verify-and-finish (branch `perf/fe-ws-e-finish`)

1. `e8e85a1` — F10 FINISH: the async-ThreeViewer + manual three chunk had
   landed earlier but the payoff never materialized — ToolTablePanel's
   static ToolPreview import kept a static edge from the entry chunk to
   the 865.7 kB (237.9 kB gzip) three chunk, and index.html modulepreloaded
   it on every first paint. ToolPreview is now async; NO index chunk
   imports three statically, no modulepreload — three/ThreeViewer/
   ToolPreview/toolGeometry all load post-paint. Entry 404.4 → 397.6 kB;
   critical path −237.9 kB gzip.
2. statusStore rAF-path allocation review (M2-style, by-construction):
   delta rebase allocates ONE merged object per tick — inherent to
   rebasing (in-place mutation of the live reactive object would corrupt
   Vue change tracking); timing samples ride only 1 Hz heartbeat frames;
   safetyTrip/readerStale/configWarning already change-only (P4.3). One
   micro-fix applied: the per-flush rAF closure hoisted to a module fn.
   No other per-frame allocations introduced by the A1 split — verdict:
   already performant by construction, no manufactured churn.
3. viewerPerf evidence record (live sim, Firefox on host, 1.18M-feed-seg
   program loaded; 200 consecutive 3 s windows): 30 Hz steady (gap p50
   33 ms, p95 ≤51 ms, absolute worst 84 ms), jank frames ≈1.5/window (50 ms
   threshold), applyState mean 0.08 ms / max 2 ms, renders 0 while idle
   (render-on-demand holding), geometries flat at 21 (no growth).

4. e2e flake ROOT-CAUSED and fixed (was misdiagnosed as a post-build
   dist-swap race): the `serial` playwright project's fullyParallel:false
   only serializes WITHIN a file — lifecycle/nine-axis/viewer still ran on
   parallel workers, and nine-axis's mock-global setAxes/reset broadcasts
   swapped the axis set mid-assertion in sibling specs (HUD A-row vanished
   under the °-check; leak-probe geometry counts perturbed — the source of
   every intermittent 13/14). Latent since A2 with two files; nine-axis
   made it frequent. Fix: three dependency-CHAINED single-file projects
   (lifecycle → nine-axis → viewer). 4 consecutive full-suite runs 14/14.
   Viewer-spec poll budgets also widened 8→15 s (async three shifts the
   first geometry rise later — correct hardening, but not the flake).

### WS-F

Tracked when reached.

## Flagged pre-existing oddities (flag-don't-fix; fixes get dedicated commits)

| # | Where | Oddity | Disposition |
|---|---|---|---|
| F1 | lcncWs.ts `_fetchBulk` sinks | `surface_points`/`comp_grid` merged into `status.value` are WIPED by the next full status frame (rAF flush replaces the whole object) | assert current behavior byte-for-byte in statusStore tests; decide fix separately |
| F2 | gateway ws_endpoint | viewer_init double-send per connect (inline NOTE marks both sites) | **FIXED in WS-B** — post-poll send is the single send; guarded by test_ws_lifecycle.py |
| F3 | ws/telemetry.ts | 200-event queue cap is unreachable via the public API (the >=32 early flush is synchronous, so the queue never exceeds one batch) — defensive invariant only | documented in telemetry.test.ts; keep |
| F4 | viewer/machineAssetCache.ts | No load-generation token: a superseded slow load's late completion can race duplicate STL fetches/IDB writes against a newer load, overwrite `failedParts` with the OLD load's failures, and last-writer-win the geometry cache per part id. Scene staleness IS guarded (caller buildToken); this is cache-level only. Review finding #7 (PLAUSIBLE). | deferred — needs a generation-token design, not a fix-commit patch. The `_loadedInitJson === json` guards added in fix/fe-review-findings stop the *dedup-slot clobber* half; fetch/failedParts races remain |
| F5 | e2e/mock-gateway.mjs | `reset` op restores only quiet/refuseWs/work_pos while `status_delta` can Object.assign arbitrary fields; `hellos[]` never cleared. Latent (only work_pos is delta'd today). | PARTIAL in D5: reset now also restores the axis baseline; arbitrary-field restore + hellos[] still open |
| F6 | e2e specs | `ctl`/`ctlSend`/`ctlQuery` helper triplicated across frames/lifecycle/viewer specs; poll-retry-broadcast pattern papers over an undiagnosed one-shot mock delivery race (idempotent frames only) | consolidate on next e2e-touching change |

## Post-WS-A review fix batch (fix/fe-review-findings)

Code review of 439847d..5ab5c92 → 10 findings; 9 fixed here, F4 deferred:
machineEdges live-apply via setMachineEdges (ordered before layer loop);
isOrtho defineExpose-unwrap blind toggle (App.vue); shared MAT.* tint →
setMachinePartColor clone-on-write (+ buildFromInit clone tagged _clonedFor,
cleared overrides now revert); toolpath.forgetAfterSceneClear() in
ensureCoreGroups + gcode re-apply at end of buildFromInit; tool anchors
(_currentToolNum/_lastToolMeta) reset on rebuild so the marker recreates;
assetCache partial-failure retry (+ guarded catch); toolpathController
teardown unified on disposeObject (stale comment gone, dispose() now frees
bounds EdgesGeometry); backplot dispose frees its material; toolpathCtx
reuses one object (per-tick alloc).

Follow-up 2ff5484: the batch's setMachineEdges-in-applyViewerDefaults ran
during buildFromInit's STL-await window (machineMeshes empty) → the empty
buildEdgesLazy run marked _edgesBuilt=true → outlines never built and
toggle/reset were dead (user-caught in smoke). Fixed: empty-mesh bail
(no mark) + sweep of aborted-run partial lines. NOT e2e-coverable (mock
ships parts:[]) — guarded by user smoke only. Smoke sign-off: outlines from
boot + toggle + reset ✓, projection reset stays parallel ✓, part colour
set/reset live ✓, reconnect with loaded program re-renders preview ✓.

## Adversarial proofs log

| Guard | Broken how | Red observed | Restored |
|---|---|---|---|
| lcncWs.exports.test.ts (runtime) | renamed `markMessagesRead`→`markMessagesReadX` in lcncWs.ts | 2 failures: name-set diff + fn-typeof undefined | git checkout |
| lcncWs.exports.test.ts (compile) | removed `export` from `interface HalSignalPin` | `vue-tsc -b` TS2724 no exported member (vitest alone canNOT catch — esbuild erases type imports; build gate is mandatory) | git checkout + tsbuildinfo purge |
| frames.spec halshow guard | killed `halshow_update` dispatch case in onFrame | halshow spec red (value stuck at "0") | git checkout + rebuild |
| eslint export-let ban | appended `export let _banProbe = 1` to halshowStore.ts | lint error no-restricted-syntax at the exact line | line removed |
| lifecycle reload-resume guard | `_prevArmed = false` (boot-from-storage dead) | FIRST run stayed GREEN — fullyParallel ran the sibling shutdownClose test concurrently, whose global close triggered a same-page reconnect hello with resume_armed=true (masking). Set lifecycle project fullyParallel:false; re-broke: exactly the reload spec red | sed restore + rebuild |
| disposal.test.ts (A2) | reverted disposeObject to old (skip _shared geom, never dispose materials) | 4/5 RED (private material + array + recursion + instanced) | restore |
| viewer.spec.ts geom probe (A2) | re-tagged toolpath geom `userData._shared` (reproduces H2) | load→rebuild delta collapsed 3→1 (<2) → RED; GREEN restored, stable ×3 full-suite runs | sed delete + rebuild |
| frames.spec status_delta guard | killed `status_delta` dispatch case | FIRST attempt stayed GREEN — mock folded the delta into state, and the next 1 Hz full-status echo delivered the same value (a masking path in the GUARD itself). Added `/ctl` `quiet` op; spec silences status echoes around the delta assert. Re-broke: delta spec red, others green. | git checkout + rebuild |
| test_ws_lifecycle viewer_init exactly-once (WS-B) | re-added a connect-time `ws_send_json(viewer_init)` before status_loop (the old double-send) | assertEqual 2 != 1 red | cp-restore from scratchpad backup |
| test_ws_lifecycle cancel-goodbye (WS-B) | replaced the CancelledError handler's frame+close sends with `pass` | assertIn "server_shutdown" red | cp-restore from scratchpad backup |
