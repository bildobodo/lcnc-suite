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
| eslint `export let` ban | pending | lands with commit 1 |
| src/ws/halshowStore.ts | pending | |
| src/ws/bulkData.ts | pending | worker URL becomes `new URL("../previewWorker.ts", …)`; verify worker chunk in build output |
| src/ws/telemetry.ts | pending | `_onVisibility` stays in lcncWs (orchestrator) |
| src/ws/wsTransport.ts | pending | RTT anchor crossed via `statusStore.noteHeartbeatSent()` function call only |
| src/ws/statusStore.ts | pending | hardest; `registerSettingsSaver` wiring stays in lcncWs body |

### A2 — Viewer disposal hazards (fixed BEFORE the A3 split)

| Item | State | Notes |
|---|---|---|
| Leak probe + viewer.spec.ts (RED first) | pending | `window.__viewerLeakProbe`; spec lands `test.fixme` proving it catches H1/H2 |
| H1 backplotGeom not disposed on applyGcode | pending | |
| H2 clearScene skips `userData._shared` geoms | pending | |
| H3 toolMarker dual ownership | pending | single-owner `replaceToolMarker()` |
| H4 material clones never disposed | pending | |
| H5 `_machineEdgeLines` accumulate | pending | |
| H6 surfaceGroup orphan parent assumption | pending | |

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

### WS-B / WS-C / WS-D / WS-E / WS-F

Tracked when reached. WS-B is the only gateway-touching phase (full perf-matrix gate).

## Flagged pre-existing oddities (flag-don't-fix; fixes get dedicated commits)

| # | Where | Oddity | Disposition |
|---|---|---|---|
| F1 | lcncWs.ts `_fetchBulk` sinks | `surface_points`/`comp_grid` merged into `status.value` are WIPED by the next full status frame (rAF flush replaces the whole object) | assert current behavior byte-for-byte in statusStore tests; decide fix separately |
| F2 | gateway ws_endpoint | viewer_init double-send per connect (inline NOTE marks both sites) | WS-B fixes on backend (user decision) |

## Adversarial proofs log

| Guard | Broken how | Red observed | Restored |
|---|---|---|---|
| lcncWs.exports.test.ts (runtime) | renamed `markMessagesRead`→`markMessagesReadX` in lcncWs.ts | 2 failures: name-set diff + fn-typeof undefined | git checkout |
| lcncWs.exports.test.ts (compile) | removed `export` from `interface HalSignalPin` | `vue-tsc -b` TS2724 no exported member (vitest alone canNOT catch — esbuild erases type imports; build gate is mandatory) | git checkout + tsbuildinfo purge |
| frames.spec halshow guard | killed `halshow_update` dispatch case in onFrame | halshow spec red (value stuck at "0") | git checkout + rebuild |
| frames.spec status_delta guard | killed `status_delta` dispatch case | FIRST attempt stayed GREEN — mock folded the delta into state, and the next 1 Hz full-status echo delivered the same value (a masking path in the GUARD itself). Added `/ctl` `quiet` op; spec silences status echoes around the delta assert. Re-broke: delta spec red, others green. | git checkout + rebuild |
