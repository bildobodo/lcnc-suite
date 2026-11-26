# Checks run through — plan v2 (a delta on v1, Codex R514 Part 1)

**Base:** `/home/cnc/claude-work/checks/plan-v1.md` (as archived in `docs/reviews/maschinentag.r514.plan-checks-v1.md`). Everything there stands unless this delta replaces it.

**Review:** `docs/reviews/maschinentag.review.md` "## Codex · Prüfungen laufen durch / Banner-Abort · Planreview R514" (:10702ff) and its evidence `maschinentag.r514.codex-*`. Code is still read at `dbd14cab` (`/home/cnc/lcnc-suite-gates`).

Still a plan: nothing built, no runs, no heavy lock.

## Change list

| Point | v1 | v2 |
|---|---|---|
| **MT514-01** | C1, the `reparse` pause of a running sweep, kept | **Removed.** No product code pauses a sweep at all; `diag` is the only hold reason and only the seam sends it (§1) |
| **MT514-02** | C3 left open whether a hidden tab gets anything besides status | A hidden tab gets **nothing** (`gateway.py:14665-14668` skips every producer). New: a bounded, version-bound path that delivers this device's confirmed settings to hidden clients, and no NEW check start while hidden (§2) |
| **MT514-03** | `sweep_done ms / sweep_ms ≈ 1` as the proof | Replaced by a phase-bound causal proof of work inside each phase, with the costs reported apart (§3) |
| **Q-C2** | drop the 20 ms run slices | **Kept** (a latency choice). Only the run shard cap goes. G4 = `maxShards: 3` and `sliceMs: 20` in a run; M5 removed |
| **Q-C3** | — | K stays: at least 1, at most cores − 2, at most 8 shards, within the 4 M-triangle copy budget. The README names the caps |
| **Q-C4** | cancel and re-post recommended | Agreed; start-ask is integrated first (§4) |
| **Q-C6** | `setSweepHold` / `diag` | Accepted. G7 is rebuilt to catch every producer (§1.3) |
| **Q-C7** | open | The VM measurement (§3) is a **precondition for this package's merge**. The machine reading stays owed before main, with the operator's go |
| **Q-C8** | open | Scope: the browser collision check and its side sweeps. The gateway checks are out (v1 B10 stands) |
| **README** | v1 §7 | Rewritten (§5): hidden-tab scope, K caps, no promise of immediate stop handling under load |

---

## 1. MT514-01 — no sweep pause in product code

### 1.1 Why C1 goes

- It was a load measure (v1 C1).
- **It is not bounded in a hidden tab:**
  - `holdStep` enters `parsing` with `deadline: null` (`viewer/bakeHold.ts:99-101`);
  - only `refreshGone` (6 s) and `arrival` (20 s) set a deadline (`:106-113`), and both come over the status / `viewer_gcode_ready` path that a hidden client does not get;
  - so a `reparse on` sent just before hiding has no end until the tab shows.
- **"Idle-only" is not true in a hidden tab either:** `_holdAdmission` (:4954-4967) reads the last local status, which stops at the hide.
- **The operator's "die Prüfungen sollen durchlaufen" answers Q514-1.** No operator question.

### 1.2 What changes (on top of v1 §3)

**`ThreeViewer.vue`**
- The reparse edge goes: `_holdApply` no longer calls `_colSetPaused` (:4931), and `_colApplyPauses` loses its `reparse` line (:4046).
- **Stays:** the bake hold itself (`viewer/bakeHold.ts`, the path re-bake); `checkHeld` as a start deferral (:4363, v1 B2); `_colOnRotarySettled`'s "no continue while a re-parse is in flight" (:4021) — part of the park.
- **`_colSetPaused` and `_colApplyPauses` become the seam's own:**
  - one flag `_diagHold`, set only by `__viewerDiag.setSweepHold`;
  - re-applied at post (:4282) and continue (:3876), because the specs set the hold before the check starts.

**`viewer/collisionWorker.ts`**
- `PauseWhy = "diag"` (the type alone; `CollisionPause.why: "diag"`).
- `pausedReparse` → `pausedDiag`, with the **reparse semantics carried over unchanged**:
  - kept through a stop (the stop still parks at once, :420);
  - kept through park / continue, the pool, its fall back and a lost parked run (:789-797, :841-842, :893-896);
  - released only by its own resume.
  - v1 said "`diag` follows the camera". That is replaced: this way the worker's hold-carrying paths keep a test (Q-C6: single worker, pool / fall back, park / continue).
- **An unknown `why` holds nothing** (G8).

**Docs**
- `scrub-and-run.md:368-378` (E1): the check no longer pauses; it waits only to START.
- `CLAUDE.md:333` short form: "runs through — no pause for a run, a re-parse, a dialog, the camera or a hidden tab (operator 2026-11-26); parked by a rotary jog; in a hidden tab no new start (§2.3)".

### 1.3 Guards (replacing v1 §6 where named)

**E1 split** (`e2e/bake-hold.viewer.spec.ts`)

| Line | Test | v2 |
|---|---|---|
| :589 | "a running check pauses at the parse signal; later changes start none; the adoption starts ONE check" | Becomes two assertions. (i) **The owned job progresses through `parsing`:** witness words or progress inside the hold, as in §3.2; its own result may land; no `reparse` entry in the hold log. (ii) **Unchanged:** later changes start none in the hold; the adoption starts ONE check at the live offsets and cancels the old one. |
| :630 | "the supersede gap sends the check's hold once" | Becomes "the gaps send no hold at all; the noted re-check starts once". |
| :648 | "… without one the paused check goes on" | Becomes "without a publication the running check simply finishes". |
| :682, :712, :738 | — | Stay (start catch-up, park, help line); keep-green controls. |

**G6 inverted:** from "reparse stays" to "**no product pause**". In a browser run across every path (parse hold, decode, a run, a camera drag, hidden, a dialog, park / continue, a pool fall back), the page-side tap of the worker boundary records **zero** `pause` messages unless `setSweepHold` was called.

**G7 rebuilt (Q-C6: catch every producer, not one spelling)**
- **(a) Runtime, at the boundary:** an init script wraps `Worker.prototype.postMessage` (the `__lateTap` / `__b4` pattern of `collisions.viewer.spec.ts`) and logs every message carrying `pause` or `resume`, whoever posts it. G6 runs on that log.
- **(b) Types:** `CollisionPause.why` is `"diag"` only, so a product literal does not compile.
- **(c) Static scan,** as a cheap first line: `pause:` / `resume:` keys appear only inside the seam function.
- **(d) Worker unit:** the seam is held through the single path, the pool, the fall back and park / continue. These are the renamed reparse cases, `collisionWorker.test.ts:263-366`.

**G8 stays:** an unknown `why` holds nothing (casts in the unit test).

**Mutations**
- M10 becomes "a product path posts any pause (reparse restored)" → red at G6.
- M7 (a product path posts `diag`) → red at G6 and G7(a).

---

## 2. MT514-02 — a hidden tab must learn "simulation off"

### 2.1 The gap

- **The hidden-client `continue`** (`gateway.py:14665-14668`) skips every producer after it:
  - `settings_changed` (:14883-14912);
  - `devices_changed` (:14914-14920);
  - `viewer_gcode_ready` (:14927-14951);
  - and the envelope's `preview_refresh` / `preview_wait` / `run_basis` / origin (:14720-14736).
- **The failing case:** another device turns this device's simulation off (`DevicesSettings.vue:111-119`), or resets its profile.
  - The server holds OFF, but the hidden tab keeps `simulationOn` true, and `_simulationOff` (:4516) never runs.
  - With the hidden pause gone, the tab computes until it shows. Before, at least its main sweep was held.
  - Codex's model reproduces it (`maschinentag.r514.codex-probe.json`, `simulation_off_hidden`).

### 2.2 The gateway change: one bounded control path for hidden clients

- **One branch inside the hidden skip.** Before the `continue`, a hidden, device-bound client with no send in flight (`not send_pending`) runs ONLY the settings push:
  - the existing block (:14883-14912) is extracted into one helper used by both paths;
  - it is version-bound: `_last_settings_ver` against `_settings_store.version`;
  - it is change-only per connection: `client.settings_sent`, this device's own view, `settings_view(client.device_id)`.
- **Bounded:**
  - at most one message per settings change, coalesced to the latest view (an intermediate version is never queued);
  - only when no send is pending — `_last_settings_ver` advances only after the attempt, so a skipped tick retries later;
  - sent through `ws_send_json` → `ws_send_measured` (`ws_fanout.py:342-349`), the same timed path as status.
- **Unchanged while hidden:**
  - the 30 Hz status;
  - `devices_changed` (device views only);
  - `viewer_gcode_ready`;
  - macros, surface points.
- **The page applies `settings_changed` as today.** `simulationOn` falls, and `_simulationOff` terminates the worker and its pool (:4516ff). A hidden page still runs message tasks and microtasks; only timers are clamped.
- **A frozen page is a separate limit:** a page the browser froze or discarded runs nothing, our handler included. It also computes nothing; that is no proof the change was taken over. Named in the decision entry and the README; not claimed as covered.

### 2.3 The page: no NEW start while hidden (the Q-C5 scope)

- **Accepted scope (Codex Q-C5):** the job already admitted keeps computing on its last adopted state. NEW starts follow the status, which a hidden page does not get.
- **The rule.** While `document.hidden`, every start choke point refuses and notes the refusal. The choke points:
  - `runCollisionCheck` :4244;
  - `_colPostSide` :4300 (except the re-post of the SAME request after `needBodies`, `_colPendingRun`);
  - `continueCollisionCheck` :3869, so a rotary-parked check stays parked: part of the park;
  - `_startRunCheck` :4433;
  - the `_colScheduleAuto` timer body :4355.
- **Why it is needed.** Without it, these would start a check on a stale state:
  - a 400 ms re-check timer armed before hiding;
  - a payload adopted while hidden;
  - a simulation switched ON from another device (the new path delivers ON too).

  A stale idle state during a real run is exactly what MR-I03 forbids.
- **The catch-up:** on the FIRST status frame after the tab shows — not the visibility event — one `_colScheduleAuto()` and one settle check of a parked check. The run / origin / connection watchers (:4552-4560, :4597-4616) judge every old result as today before it is reused or shown.
- **This is a start deferral (v1 B2 class), not a pause.** The running job is untouched.

### 2.4 Guards

**Gateway unit** (`lcnc-gateway`, fake_linuxcnc; the extracted helper):
- a hidden bound client gets ONE `settings_changed` per change of its own view and nothing else of the tick;
- with `send_pending` it gets nothing and the latest view on a later tick, never two;
- a client of another device gets nothing;
- a visible client is unchanged.

**Mock gateway** (`e2e/mock-gateway.mjs`): learns the hidden skip: on `tab_visibility hidden:true`, no status and no producer except the settings path. Without it the browser cases prove nothing.

**Browser** (`simulation-off.viewer.spec.ts`; the hidden seam with `document.hidden` and `visibilityState` overridden, v1 G2 fix):
- **S1:** a visible tab and a hidden tab of the SAME profile, a long check running in both. Simulation off from a third connection: both workers end (`getSimulationWork().worker === false`, `collision.simulation_off had_worker:true` from each page).
- **S2:** a tab of ANOTHER profile keeps its check.
- **S3:** late results start nothing (the existing pattern, :72).
- **S4:** a hidden tab starts nothing — not on the armed re-check timer, a payload adopted while hidden, or simulation ON from elsewhere. It starts ONE check at the first status after showing.

**Native case** on the VM (real gateway, real background tab): simulation off for device A from device B's Settings › Devices **during a heavy check** in A's hidden tab. A's worker ends while A is still hidden: `collision.simulation_off` from A's page, and A's `viewer.perf` `vis: hidden` around it.

**Mutations**
- M11: the hidden branch sends nothing → red at the gateway unit and S1.
- M12: it sends every tick / every version (no coalescing) → red at the gateway unit.
- M13: a start allowed while hidden → red at S4.
- M14: the catch-up on the visibility event instead of the first status → red at S4 (the stale-status start).

---

## 3. MT514-03 — the measurement contract (replaces v1 §4.5's ratio and §4.6 step 2)

### 3.1 Why the ratio goes

- `ms` (:3787) is the page's post → result.
- `sweep_ms` is the worker's slice clock (`collisionWorker.ts:388, 428-431`):
  - without the model build, the timer gaps, the contact / ack close and the delivery (:335-340, 460, 467-471);
  - in a pool it is the MAXIMUM over shards (`sweepShards.ts:53`);
  - a slice the OS does not run still counts inside it.
- **Codex's three models give the same two numbers for different things** (`r514.codex-probe.json`, `ratio`): a pause and a timer wait both give 2.0; a cold job unheld gives 3.4; a long job idle through a short phase gives 1.001.

### 3.2 The proof per phase

**Binding.** Each phase (camera drag, dialog, hidden-synthetic, hidden-real, a run) is bound to:
- the page and its connection;
- the request id and generation (`run_gen`, the contact generation);
- the worker instances and shards (`collision.model_built` instance ids, the shard index).

**A long job, still open at both edges.** The fixture is long enough that the job is open at phase entry AND at phase exit: its result must not have arrived before the exit, checked on the page.

**Causal work inside the phase.** This extends the R186 witness: no cross-clock arithmetic.
- **Ticks from the driver:** a seam `__viewerDiag.collisionTick()` posts `{tick}` (`collisionWorker.ts:848-853` forwards to every shard). Status heartbeats do not reach a hidden page, so the heartbeat-driven ticks (:3369-3370) cannot serve.
- **Witness on idle checks too:** a seam `setCollisionWitness(true)` makes every main request carry `witness` (today only run checks, :4248).
- **Words carry progress:** the witness word adds the shard's own progress, so a finished shard (last word at progress 1, or its result) is told apart from a shard still owing work.
- **Inside the phase means:** a word for a tick issued AFTER the phase entry and received BEFORE the phase exit, both on the page clock. That proves a slice began after the entry and ended before the exit.
- **Bounded gaps:** every shard still owing work gives words inside the phase with gaps ≤ 1 s on the page's receipt clock. A shard that finished before the entry is reported as finished, not as working.
- **Not enough on its own:** a result after showing again.

**The costs, apart.** Small telemetry additions:
- the cold build: `collision.model_built` ms per instance, exists;
- the sweep: per-shard `sweep_ms` in `sweep_done`, new `shard_sweep_ms` beside the max;
- the yield / timer wait: per shard, wall since its run start minus its active ms, both on THAT worker's clock (new `shard_wait_ms`);
- the final delivery: page clock, from the last word / progress to the result.

No page-clock minus worker-clock subtraction anywhere.

**Hidden, two ways, reported apart.**
- **G2 synthetic** (`document.hidden` + `visibilityState` overridden): the application wiring.
- **A real background tab** (headful Chromium and the Firefox core on the VM, the page hidden by another tab in the same window): the browser's scheduling. A phase shorter than 5 min, and one past 5 min for Chromium's intensive throttling of chained timers.
- If the real run shows the worker's `setTimeout(pump, 0)` throttled, the MessageChannel yield is built, then **proven by the same real background run**. It does not make a frozen page run.

### 3.3 The load acceptance (VM, the merge precondition, Q-C7)

**The operator page and the hidden computer, apart.**
- **The visible operator page:** status age / gap (`age_h`, `gap_h`), input delay under load (`in_delay_h`, Event Timing `ev_*`), hold refusals (`browser.stall`), and the handling delay of a stop tap (Pause / Abort in a sim run). Measured, not promised.
- **A hidden page:** its status is intentionally not supplied. Its age is not measurable: neither a PASS nor part of any visible percentile. It is reported only by its §3.2 work proof.

**Targets on the visible page,** as recorded (`scrub-and-run.md:284-292`): status age p95 < 50 ms, heartbeat gap p99 < 300 ms, HAL watchdog receipt < 201 ms. Plus the input and stop delays reported as measured.

**Attribution.**
- A **baseline run:** the same phases with the check not running (the simulation off on that device).
- **Every** HB-WAKE, `lag.window`, `wd.hb_edge` or trip in the check run is investigated (its `lag.window` culprit, the trace around it). An unattributed one keeps the proof OPEN; it is never "not the check, so passed".
- v1 §4.2's machine numbers stay correlations, never this proof.

**The machine reading** (N100, simulation on at the panel; the HB-WAKE lines of 2026-11-21 11:00–11:02 read first) stays owed before main, with the operator at the machine and his go.

**Guards G1 / G2 / G3** (v1 §6.3) take the §3.2 proof in the mock browser run:
- a fixture with work left at the phase exit;
- the driver's tick after the phase entry;
- a witness word for it before the exit.
- **Controls:** at `dbd14cab`, G1 and G2 get NO such word (the held job) → red. G3 is red under M6.

---

## 4. Start-ask (Q-C4)

- **Kept:** cancel and re-post a running or parked main. The reasons are the run's basis and range, the witness, and the ownership of the deltas in flight.
- `maxShards` / `sliceMs` stay outside the semantic job key (`colJobKey.ts:15`). The 20 ms run slices alone need no new key.
- **Rewording on that branch** (v1 §5): "under the run budget" becomes "as a run check (its 20 ms slices; the general shard rule)". M11c becomes "reuse of a running or parked job". N3 becomes "re-posted as the run's own job".
- **Order:** start-ask is integrated first; this package branches from that head. Its rewritten guards (M11c, the `setSweepHold` rename of its 7 seam uses) are proven at the common head in this package's round gate.

## 5. README (replaces v1 §7; same place: `## Requirements`, after `### Reference UI`, README.md:283-284)

> ### Simulation and collision check (optional, per device)
>
> Each browser switches its own simulation in **Settings › Devices** ("Simulation: timeline, collision check, Sim tab"); a new device starts with it off. With it on, the collision check runs **through**: it does not pause while a program runs, while a dialog is open, while you rotate or move the 3D view, or while the tab is in the background. Only a rotary-axis jog parks it until the axis has settled; a change of the program, an offset or the tool replaces it with a new check. Running through does not mean every run is checked: a run the preview does not cover (for example a run from a line) is shown as "not checked".
>
> In a background tab the check that is already running goes on with what the tab last received. The tab learns nothing new from the machine while it is hidden — no new program, no run start — so it starts no new check there; that happens when the tab is shown again. Switching the simulation off, here or for this device from another one, stops it in every tab of the device, a hidden one too — unless the browser has frozen that tab, which then computes nothing either. Every open tab of a device with the simulation on runs its own check.
>
> The check runs in Web Workers on the computer the browser runs on: one per core, keeping two cores free — at least one, at most eight, and fewer for very large machine models.
>
> **Recommendation:** do not switch the simulation on for a browser on a weak machine PC — for example a mini PC whose real-time setup isolates cores (`isolcpus`) and leaves the desktop two. There the check keeps a core busy for minutes on a large program, beside the gateway, LinuxCNC's non-real-time side and the browser itself. The page then reacts more slowly — to every input, stop buttons included — and a hold may be refused ("Page delayed — hold again"). Run the simulation on a second computer instead, any browser on the LAN with its own device profile, and leave it off on the machine panel.

The README promises no immediate stop handling under load (Codex). The physical E-stop and the HAL chain are untouched by the page and are not mentioned, so that no new promise is made.

## 6. v1 sections retired or changed

- **v1 C1, Q-C1:** closed by MT514-01. v1 C3 is closed by §2. The v1 G5 park controls stay. The v1 G6 "reparse stays" is inverted (§1.3).
- **v1 M5** (`sliceMs` 20 restored) is removed. G4 is `maxShards` 3 + `sliceMs` 20 in a run, so the inverted `collisions.viewer.spec.ts:730` stays `sliceMs toBe 20` (not inverted); only :736 is inverted, to 3.
- **v1 §4.6 step 2** is replaced by §3.

## 7. Remaining questions (Codex)

- **Q-C9 (§2.3):** no NEW start while hidden, with the catch-up on the first status after showing (not the visibility event). Is that the right deferral? It also keeps a rotary-parked check parked while hidden.
- **Q-C10 (§2.2):** only `settings_changed` on the hidden path (not `devices_changed`), gated by `send_pending`, coalesced, through the timed send. Enough?
- **Q-C11 (§3.2):** the driver-issued ticks + witness on idle checks + progress in the word + per-shard sweep / wait fields as the phase proof. Acceptable seams and telemetry for this package?

**For the operator:** none. Q514-1 is answered by his decision.
