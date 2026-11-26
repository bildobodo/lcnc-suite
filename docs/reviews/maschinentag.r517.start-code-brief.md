# Start message (F14 + P2b-F2): brief for the code review

**Head:** `87bf2435` on `feat/start-ask` (worktree `~/lcnc-suite-start`).
- The code is the gated `224b3402`; `87bf2435` adds only the native page probe under `docs/reviews/`.
- Base `dbd14cab`. Not pushed.
- **Round gate PASS:** `/home/cnc/gate-tmp/start-r4.json` at `224b3402` — unit-light 3506, backend, browser-full 1188, replay, Firefox core 94.
- **Natives N1–N7 plus run from line:** PASS on the VM. Runs are in `~/claude-work/start/natives/runs/` (start2, start3, startN1N7, smoke224c at `224b3402`).

## Diff stat against `dbd14cab`

| Area | Files | + / − |
|---|---|---|
| Product (gateway + page) | 25 | +1886 / −89 |
| Gateway tests + fixture | 11 | +993 / −5 |
| Unit tests | 11 | +430 / −12 |
| e2e | 5 | +391 / −2 |
| Docs | 7 | +170 / −1 |
| `scripts` + inventory | 6 | +69 / −7 |
| `docs/reviews` (probe drivers, evidence) | 20 | +3735 |

New product modules:
- gateway: `start_ask.py` (300);
- page: `startCheck.ts` (218), `startAttempt.ts` (191), `StartCheckDialog.vue` (60), `viewer/colJobKey.ts` (87).

Largest edits: `gateway.py` +466/−45, `ThreeViewer.vue` +118/−19, `App.vue` +111/−5, `gateway_util.py` +77.

## Where each plan section is built

Line numbers are at `224b3402`. G = `lcnc-gateway/`, W = `lcnc-webui/src/`.

| Plan | What | Where |
|---|---|---|
| v2 §2.1–2.2 | the page's claim: calculation and result apart | W `startCheck.ts:56` `claimOf`, `:64` `pageCheck`; the class W `ScrubBar.vue:1178` (`klass`), W `simPanelStore.ts:41` |
| v2 §3.1 | wire: `attempt`, `check`, `consent` | G `command_policy.py:1430–1440`; W `lcnc.ts:84–98` (`StartAskFields`) |
| v2 §3.2 | ONE rule, three points | G `start_ask.py:233` `decide`. Entry: G `gateway.py:5395` `_start_entry`, called from Cycle Start `:10033`, Step from idle `:9666`, RFL `:9772`. Record: `:5434` `_start_at_record`. Write: `:5474` `_start_write_term`. |
| v2 §3.3 + v3 §E | the publication fence and its lifetime | G `calc_lifetime.py:130–141` (`publish_if` why "start", `fence_if`); G `gateway.py:5492` / `:5513` (set); `:5647` `_fenced_admit` (the write's last admission in `_cmd_blocking`); `:5721` `fence_release` |
| v3 §A (replaces v2 §3.4) | consent redeemed once into a proof | G `start_ask.py:97` `OpenAsk`, `:116` `StartProof`, `:192` `redeem`, `:212` `proof_matches`, `:248` `AskBook`; G `gateway.py:5244` `_StartCtx`, `:5262` `_start_ctx_from` |
| v2 §3.5 | predictions after the entry (#7) | G `gateway.py:5288` `_ts_predicted_open_drift`, `:5331` `_ts_program_may_write` |
| v2 §3.6 | old clients | G `start_ask.py:52` `OLD_CLIENT_ERROR`, `:291` `ask_reply`; `old_client` at G `gateway.py:5271` |
| v2 §4.1 + v3 §D.4 | one attempt, owned from the send; the reply rule by kind | W `startAttempt.ts:91` `request`, `:132` `onReply`, `:180` `onRflStatus` (status before the reply, R504 point 6); App wiring W `App.vue:1854–1870` (`START_GATE`, deps), `:1897` `requestStart` |
| v2 §4.2 | the press that caused it | W `App.vue:1904` `heldThroughPress` |
| v2 §4.3–4.6 | dialog, lines, consequence | W `StartCheckDialog.vue`; W `App.vue:1906` `startAskView`, `:2898`; W `startCheck.ts:195` `startLines`, `:141` `CONSEQUENCE` |
| v3 §C (replaces v2 §4.4) | one action priority | W `startCheck.ts:170` `startAction`; offers on the gateway side G `start_ask.py:176` `offers_for` |
| v2 §4.7 | simulation off | W `startCheck.ts:151` `pageNeedsNone` (claim `none`) |
| v2 §5.1 (Q-C5) | an unverified run from 0 is named | W `viewer/checkBasis.ts:150` `uncheckedRun`; W `ThreeViewer.vue:3346`; W `ScrubBar.vue:1314`; W `SimPanel.vue:31` |
| v2 §5.2 + v3 §B + R504 | path 2 and the reuse key | W `viewer/checkBasis.ts:200` `admitVerifiedStart`; W `viewer/colJobKey.ts:79` `jobKey`; W `ThreeViewer.vue:4519` `_colReuseFinishedMain`, `:4556` `_colOnRunEntry`; the record's `accepted` / `verified_against` at G `gateway.py:5107` / `:5164`, W `runBasis.ts` |
| v3 §D (replaces v2 §6) | run from line: an accepted sequence, its end through `rfl_status` | G `gateway.py:9810` (`rfl: "accepted"`, `seq_id`), `:7315` `_rfl_start(start_ctx=)`, `:7436` `_rfl_phase`; W `App.vue:1937` `runFromLine`; W `ws/statusStore.ts:166` |
| v3 §D.3 | Cycle Start and Step are the only asks after the entry | G `gateway.py:10027` / `:9666` |
| v2 §7 | words | W `startCheck.ts:96` `startWhyWords`, `:140` `START_ASK_HELP`, `:147` `RFL_NOTE`; G `start_ask.py:50` `ASK_ERROR` |
| R505 S1 | Abort / E-Stop void every open ask | G `gateway.py:15928–15936` (reader branch, `_WS_PREEMPT_CMDS`), `:5349` `_void_start_asks` |
| R505 S3 | owners hear of it | G `gateway.py:5363` `_tell_start_asks_voided`; W `ws/statusStore.ts:159`; W `startAttempt.ts:173` `onVoided`, `:57` `VOIDED_WORDS` |
| R507 | coordinate contradiction term | G `gateway_util.py:1782` `coordinate_state_contradiction`; G `bulk_pipeline.py:667`; G `gateway.py:5465` `_coord_start_reason`, `:5474` (write term, `:5514` unchecked downgrade); **the seam** `:5454` `_coord_basis_unconfirmed` |
| Gestures | Space and the gamepad | W `useKeyboardShortcuts.ts`, W `useGamepad.ts:247` (`requestStart`) |

## Guards made green by changing the guard (for review)

1. **`e2e/collisions.viewer.spec.ts` (P6-d0, R464 test).**
   - Before: "a run from 0: nothing of the kind".
   - Now: "This run is not checked (started before the check)." for its record `verified: false`, why "no preview".
   - Basis: R503 Q-C5 / plan v2 §5.1.
2. **`realTimeHolds.test.ts`.**
   - `start-cost.spec.ts` joins `STALL_GUARDS`, so the whole file is exempt from the scan. It holds only the real-time cost measurement.
   - A hold stalled by the runner is taken again, at most 3 times; the branch was proven with an injected block.
   - `start-ask.spec` stays scanned.
3. **`commandPath.test.ts` VARIABLE_SENDS.**
   - The attempt's send is declared `fired` for `cycle_start` / `auto_step` / `auto_run`.
   - `START_GATE` is re-checked, but there is no busy latch: the attempt is the latch.

## Deviations (named earlier)

1. **The S1 hook** sits in today's reader branch for `abort` / `estop` (G `gateway.py:15928`), right before the stop is queued. The Abort package's `_stop_arrival` would take it over.
2. **Four test modules neutralise the question's hooks** (`start_ask_fixture.neutral()`).
   - One class puts them back and asserts an old client's raw start: `test_command_dispatch.py` `TestAnOldClientsStartWithTheQuestionInPlace` — the reload words, nothing written, red when neutralised.
3. **Small test adaptations:** `test_rfl_guard`'s stub takes `start_ctx`; one wiring test's indentation string.
4. **The fence's refusal reason** in `publish_if` is `"start"`, so the discarded parse restarts named `discarded:start`.
5. **The Q-S6 switch** is `start_ask.ASK_RESTRICTED`, carried in each ask as `ask_restricted`.
6. **Reuse at run entry** covers a finished main only. A running or parked main is re-posted under the run budget; there is no live re-budget.
7. **(Changed since first named.) The entry reads no var file.**
   - A program whose text may write a toolsetter basis key asks: why "toolsetter values the program writes"; an unknown write set asks "toolsetter inputs cannot be confirmed before start".
   - The lock order at the entry is `_cmd_lock` only.

## Owed

- **Live checks before main:** `live-twp`, `perf-matrix`, `twp-buttons` (Start and Step are motion buttons). `unit-heavy` and coverage go to the merge gate.
- **The coordinate seam:** `_coord_basis_unconfirmed()` returns None.
  - F-G5X step 1 (`feat/fg5x`) provides `coordinate_basis_reason(NEED_START, stat)`.
  - **At the integration the stub must be DELETED.** Git keeps both definitions without a conflict.
  - The start merge also waits for Q509-2.
- **Coming package that touches this branch (operator decision): collision checks run through.**
  - No pauses during a run, for a dialog, for camera interaction or in a hidden tab.
  - The 2-shard run cap goes (W `ThreeViewer.vue:4188`); the 20 ms slices stay (`:4190`).
  - It rebases on start-ask and rewords this branch's "under the run budget" texts (W `ThreeViewer.vue:4554`, `docs/architecture/scrub-and-run.md:1140`, deviation 6) and mutation M11c (plan v2 §8.4: "reuse of a running job without the run budget").
- **Observed on the VM:** while the browser's collision check runs, headless Chromium has main-thread gaps of 280–630 ms. A Start hold landing in one is refused by design (R397, "Page delayed — hold again"). This is pre-existing, but it is exactly N3's situation on a slow browser PC.
