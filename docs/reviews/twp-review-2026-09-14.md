**TWP pre-merge review — correctness, operator usability and performance — 14 September 2026**

**Merged foundation (16 September):** `feat/twp` at `f221763` is merged locally into `development` as `9a52016`, following the user's explicit approval. The [merge record](#foundation-merge-9a52016) documents the integration and agreed scope. M-05/M-06 remain open for the guided-setup milestone, with its final M-07 acceptance record; they were not marked passed by this merge.

**Latest implementation assessment (16 September, follow-up):** the [review at `f221763`](#implementation-review-f221763) found no new merge-blocking code defects. R-06/R-07 and the browser assertion failure are resolved; 803 unit tests, all 24 committed browser tests, build and lint pass, as do the original review probes. The remaining acceptance work is the M-05 operator walkthrough and M-06 browser responsiveness measurements, followed by the final M-07 record. Dated findings and inline replies remain below for traceability.

The TWP implementation has a sound foundation: LinuxCNC interprets the program, kinematics are compared against C implementations, plane touch-off updates a persistent datum, and preview, playback, and collision checking share coordinate conversions. Keep that foundation. The next work should correct motion-targeting and simulation-validity defects, then make the operator's working frame and the validity of each displayed result explicit.

**Response to the inline comments:** [assessment and follow-up decisions](twp-review-2026-09-14.comments-response.md). The checklist and recommendations below have been clarified following that assessment; the second reader's comments remain verbatim. The response includes an additional collision-state counterexample against the proposed TWP-07 fix.

> **Comments (2026-09-14, inline).** Blockquotes marked **Comment:** are a second reader's response to this review, written against the same pinned revision `1aa0730` in the same worktree. Verification behind them: the Python probes were run against the pinned checkout and all six observations reproduce (Plane Go-to-Zero `["G0 Z25.0000", "G0 X0 Y0"]`; 3-axis G59 X touch-off refused; raw type 0 admitted by `machine_frame_required`; solver `(150.0, 150.0)` at ±100; `tool_offset` three times running; bare G30 helper `ABC` / scanner `{}` / boundary `A: null`). The TypeScript probes were NOT run: a LinuxCNC session (gantry sim) was live on this host and the project rule forbids builds while the HAL safety chain is up; each TypeScript claim was checked by reading the cited source at the pinned revision instead. No machine or simulator was touched.
>
> **Overall:** the review is accurate; every finding is real. Disagreements are about framing: M-05 and M-06 are main-promotion criteria in this project, not development-merge criteria; TWP-04, TWP-07 and TWP-11 prescribe more than the defect needs; TWP-08 hides a P1 regression for every 3-axis configuration under a P2 label. Missing: an adversarial test for that G59 regression, and TLO events as a second discontinuity in TWP-06. Suggested sequence: wave 1 (small, unit-testable) TWP-01, 02, 03, 08-G59, 06, 07, 10, 12; wave 2: 04, 09, 05; wave 3: 11. Gateway-side items land at the next suite stop as usual; the client-side items (05, 06, 07, 12) need no restart and no schema bump.
>
> **Reply (after the [response](twp-review-2026-09-14.comments-response.md)):** the TypeScript probes were run after the response (esbuild bundle at low priority, output kept in the session scratchpad): every observation reproduces, including the response's added `residentToolAfterInterleaving` (original geometry restored: false; fallback sweep 1 hit vs 0 on a fresh model). The build caution above was broader than the saved policy, which permits ordinary work against a simulator session and reserves the ban for real hardware and evidence runs. Of the three "prescribes more than needed" items, TWP-07 is withdrawn (see its reply); TWP-04 and TWP-11 stand in the reduced forms the response accepts. The response's follow-up order (motion + 08a first, then 06/07 together and 12, then 05/09/10, then development acceptance) supersedes the wave list above.

**Merge status: technical foundation integrated at `9a52016`; guided-setup acceptance remains open.** The user approved separating the development foundation merge from the remaining operator workflow and responsiveness work. The checklist below retains those requirements for the next milestone. User friendliness is part of that bar: an operator should be able to predict an action's effect, understand a refusal, and recover without reading remap source or development logs. The detailed findings later in this document explain the evidence and fixes. The original findings describe `1aa0730`; dated reviews assessed [584083b](#implementation-review-2026-09-15) and [926dc6d](#implementation-review-2026-09-16). The [latest review at f221763](#implementation-review-f221763) verifies closure of the remaining keyboard findings. The ordinary three-axis fixture regression, TWP-08a, is now addressed.

| Merge gate | Required before merge | Closure evidence |
|---|---|---|
| **M-01 — Predictable motion** | Resolve [TWP-01](#twp-01) through [TWP-04](#twp-04): modal state, physical rotary targets, orient limits and actual head alignment. | Regression tests plus isolated-simulator exercises of touch-off, Orient, → Zero, → Home and → G30 in their admitted modes. |
| **M-02 — Correct preview and refresh** | Resolve [TWP-05](#twp-05), [TWP-09](#twp-09) and [TWP-10](#twp-10): no event saturation, compensation-driven reparse loop, or incorrect rotary-command boundary. | Counterexamples become regression tests; a current-parser end-to-end check covers frame/fixture/tool changes. |
| **M-03 — Trustworthy collision results** | Resolve [TWP-06](#twp-06), [TWP-07](#twp-07) and [TWP-12](#twp-12): tool changes, concurrent sweeps and incomplete entry coverage. If an affected case remains unsupported, prevent the enabled UI from presenting a checked/clear verdict for it. | Standalone and interleaved runs agree; incomplete coverage remains visible. Calling the existing incorrect result “advisory” alone does not close these defects. |
| **M-04 — No regression to other configurations** | Resolve [TWP-08](#twp-08) sufficiently to preserve ordinary three-axis fixtures and gate TWP controls by declared capability. Correctly map any other kinematics families exposed by the merged UI. | Three-axis G54–G59.3 touch-off works; unsupported families cannot enter TWP-specific routines by accident. Full TWP support for every machine family is unnecessary for this merge. |
| **M-05 — Usable operator workflow** | Verify the focused TWP behavior in U-01 through U-09 below, retaining existing controls that already meet the criteria. Include labels, refusal explanations, touch-off target changes during editing, validity and a supported-viewport/input smoke check. | A recorded desktop and simulated-touch walk-through in an isolated simulator, with observations and fix commits for failures. Real-device acceptance belongs to main promotion. A broad visual redesign is unnecessary. |
| **M-06 — Responsive under representative load** | Measure cold/warm setup, pause/cancel acknowledgement, and control/camera interaction during parsing, sweeping and sim entry against the development performance baseline. Resolve material regressions. Close [TWP-11](#twp-11) with a fix or an explicitly accepted measured limit. | Record the workload, browser, hardware and timings. The earlier 100 ms interaction / 250 ms pause figures are proposed starting points, not established project gates. Measure before adopting a budget; target-machine acceptance belongs to main promotion. |
| **M-07 — Evidence on the final merge candidate** | Run build, lint, unit tests, mock browser tests, current-parser goldens, the isolated live-simulator corpus, and the operator walk-through after the fixes. | Attach results to the exact candidate hash, describe remaining supported-use limits, and link named owners/issues for deferred work. The green tests from this review are a baseline, not acceptance of later changes. |

**Separate main-promotion gate:** the operator validates the final implementation on the physical machine and actual touchscreen, including target-hardware responsiveness. Simulator/development evidence does not replace that acceptance. The project-policy sources and the reason for retaining a development usability baseline are recorded in the [comments response](twp-review-2026-09-14.comments-response.md).

**Current gate status after foundation merge `9a52016` (16 September).** The user-approved split carries M-05/M-06 and final operator-readiness acceptance into the next milestone. See the [latest assessment](#implementation-review-f221763). The [previous checklist and implementation replies](#gate-snapshot-926dc6d) are preserved below.

- [x] M-01 — Prior motion fixes and recorded adverse-path simulator evidence remain applicable: this round changes no motion, gateway or remap implementation.
- [x] M-02 — Prior preview/index/compensation/boundary closure remains applicable; parser and preview implementation are unchanged.
- [x] M-03 — Prior tool/TLO, interleaving, unknown-gap and coverage fixes remain applicable; collision implementation is unchanged.
- [x] M-04 — Prior shipped TWP/TRT mode-mapping and ordinary three-axis fixture evidence remain applicable; no configuration or mode-command mapping changed.
- [ ] M-05 — R-05/R-06/R-07 are now closed: original probes and expanded browser tests pass at f221763. The desktop/simulated-touch operator walkthrough remains outstanding; include the existing pointer-only hold actions.
- [ ] M-06 — The per-vertex initialization defect remains fixed. Representative browser worker acknowledgement and control/camera responsiveness still need measurements; target-hardware acceptance remains at main promotion.
- [ ] M-07 — Automated frontend evidence is green at f221763: build/lint, 803 unit tests, all 24 committed browser tests, both unchanged review probes and two additional shortcut-preservation checks pass. Complete M-05/M-06 and assemble the final acceptance record with the original hashes of unchanged backend/simulator evidence.


> **Comment (gates):** M-01 to M-04 and M-07: agree for a development merge; M-04 should name the 3-axis G59 case explicitly (see TWP-08) and cite its test. M-05 and M-06 belong to main promotion, which this project already reserves for the operator's hardware validation; keep them, as the promotion bar. Two objections to M-06 as written: "pause/cancel acknowledgement within 250 ms including cold setup" includes the BVH build of the machine STLs, which on the trsrn and DMU models is probably above that on its own, so measure before adopting a number; and "visible interaction feedback within 100 ms" is a main-thread property that none of TWP-01 to TWP-12 touches, so measure it with the existing perf matrix rather than tie it to this branch.
>
> **Reply:** the 250 ms remark was unsupported: the recorded trsrn profile measured an 8 ms BVH build ([decisions.md:3855](/home/cnc/twp-checkout/docs/decisions.md:3855)). The reduced M-05/M-06 wording now in the table (simulated-touch walk-through in an isolated simulator; measurement against the development baseline; physical validation at promotion) is accepted.

**User friendliness required for merge.** These are observable acceptance criteria, not a claim that every row describes a missing feature today. Preserve the existing equal-size action rows, explicit numeric-keypad confirmation and actual-mode indication where they already work. The important information must be available during normal use, including touch and keyboard use; long mouse-hover titles are insufficient on their own.

| ID | Operator should be able to… | Acceptance check |
|---|---|---|
| **U-01 — Know the active frame** | Immediately identify Machine/TCP/Plane, the active fixture, and whether the head is aligned with the plane. | Keep these states visible together. Make clear that selecting the working frame also affects MDI/program coordinates. Separate Manual/MDI/Auto task mode from kinematics selection. Unknown state has a visible unknown indication. |
| **U-02 — Predict each button** | Distinguish a datum write, a stationary frame change, an orient move, reference homing and a return move. | Use clear verbs and destinations: for example Set/Zero XYZ, Orient head, Home axes, Move to machine zero, Move to G30 XYZ and Move to work XY zero. Exact wording can vary; the meaning cannot depend on knowing that an arrow implies motion or on reading a tooltip. |
| **U-03 — Touch off deliberately** | See which axis and datum will change, enter a complete value, and cancel before applying it. | Keep the existing keypad's explicit Confirm/Cancel behavior. Name the target in its context, e.g. “Touch off Z · Plane · updates G54”. Never submit partial keystrokes. If the mode/fixture changes while editing, do not silently apply the value to a different target. Confirmed success follows controller readback. |
| **U-04 — Understand Capture / Orient / Clear** | Know what changes and whether an action moves the machine. | Show concise nearby help: Capture defines the plane and establishes the G54 datum at the tip; Orient moves the head; Clear cancels the plane and restores the stated frame/fixture while preserving the established datum. Keep ordinary operations direct instead of adding a confirmation dialog to every button. |
| **U-05 — Recover from invalid state** | Get one understandable next step when the head moved, the datum changed, the wrong fixture is active, or mode data is unavailable. | Messages distinguish these conditions and offer the applicable action, such as Orient again or select the Plane frame again. Do not auto-rotate the head or overwrite a captured datum as a hidden recovery action. |
| **U-06 — Understand disabled controls** | Learn why an action is unavailable using a mouse, touch or keyboard. | Show a reachable reason beside the control or in a shared status area, with the required next step. TCP → Zero refusal, reserved plane fixtures, and an unoriented plane are explicit. Recovery does not require typing an unexplained G/M code. |
| **U-07 — Read result validity** | Tell live machine state from simulation, an updating preview from a current preview, and an incomplete collision sweep from a completed one. | Distinguish preview rebuild and collision-check progress; show checked coverage and unchecked spans. Use text/symbols as well as colour. A slow operation keeps useful previous information with the correct validity label. |
| **U-08 — Understand execution and failure** | Tell whether an operation was requested, is executing, completed, or was refused/aborted. | Avoid showing completion merely because a command was queued. On Orient/return failure, show the actual remaining frame, fixture and pose state. Keep the existing stop/E-stop controls reachable during background work. |
| **U-09 — Operate the supported layouts** | Complete the same setup on the normal desktop view and the smallest supported touch layout. | No clipped coordinates or critical controls, disappearing refusal reasons, colour-only state, or hover-only instructions. Check keyboard focus, numeric entry, selected-mode readability, and the established action-row layout. |

> **Comment (U-01 to U-09):**
> - U-01: largely exists (kins chip with stale / datum-moved / wrong-fixture states, explicit jog-frame selector, `twpOriented` gate). Agree the selector's heading should say it switches kinematics machine-wide, not only jogging; renaming "Jog frame" is enough.
> - U-02: agree; see D-02.
> - U-03: the "mode or fixture changes while editing" case is a real gap. `touchoff_route` decides from live state; the missing piece is the keypad capturing the route (mode, fixture) at open and the request carrying it, so the server refuses when the live route differs at confirm.
> - U-04: agree; short nearby help, no confirmation dialogs.
> - U-05 / U-06: valid, and app-wide rather than TWP-specific: refusal reasons live in `title` tooltips and in the denial reply, and the tooltip path is dead on touch. Tie to the open touch-validation item. For this branch, confirm every denied Go-to-Zero, touch-off and capture surfaces its reason in the status banner (not verified on a live UI here).
> - U-07 / U-08: agree; largely covered by the scrub bar's sweep states (checked, unchecked span, declined, uncertified) and the preview-refresh banner. Gaps: the entry-truncation case (TWP-12) and coverage wording (D-07).
> - U-09: agree, as a promotion criterion.
>
> **Reply:** U-06 correction accepted: a fieldset-disabled control never sends a request, so the denial banner cannot explain it; the reason has to be reachable beside the control or in the status area without a press.

**Minimum operator walk-through.** Run this against an isolated simulator at the final candidate, checking mouse/keyboard and simulated touch at supported viewports. Repeat with actual touch hardware for main promotion. Have an operator familiar with CNC but unfamiliar with these implementation details state the expected effect before each action. Record any point requiring an explanation from the developer; that is a usability follow-up, even if the final joint position is correct.

1. Start without a plane, home, select Machine and establish G54. Identify the difference between homing, zeroing a datum and moving to zero.
2. Select TCP, align the head and position the tip; Capture a plane. Identify the changed datum, selected fixture and current working frame from the screen.
3. Enter a nonzero Plane touch-off value, cancel once, then confirm it. Verify the DRO and G54 result. Exercise the permitted return-to-zero path with both G90 and G91 as starting modal states.
4. Move A, then independently B/C in an appropriate mode. Recognize lost alignment, find the recovery action, and Orient again. Change G54 after capture and distinguish datum staleness from head misalignment.
5. Exercise disabled G30/Home/Zero actions in TCP/Plane, Clear the plane, and use the permitted machine-frame return routines. Abort an orient/return in the simulator and recover from the displayed state.
6. Load a representative large, multi-tool TWP program. Orbit/zoom during refresh and collision checking; enter/exit simulation while a sweep runs. Identify partial results and live versus simulated pose. Finish a program and reconnect/restart the UI to check that mode/fixture state remains understandable.

**Work that can follow the merge.** Do not make the merge depend on a complete architecture rewrite. Full frame-tagged types, a general immutable parse-context refactor, additional machine families, TCP touch-off at arbitrary table angles, more advanced reach/stock visualization, cosmetic restyling, and further throughput optimization can be separate work once the gates above pass. The minimal state/validity fixes needed to satisfy those gates still belong before merge. Keep scope and sampling limitations visible; expanding a collision or reachability guarantee is a separate acceptance task.

This is a review and follow-up backlog, not a machine acceptance certificate. Source inspection and offline counterexamples substantiate the findings below. No machine motion, homing, datum change, HAL write, or simulator restart was performed for this review.

| Review scope | Value |
|---|---|
| Branch / worktree | `feat/twp`, `/home/cnc/twp-checkout` |
| Pinned revision | `1aa0730017ca022cba3271ce6c71c12b04e11027` |
| Previous review baseline | `1935c805863cdbd8bc5a1b46d14f3d65519daf7b` |
| Worktree at inspection | Clean |
| Configuration primarily assessed | Shipped `xyzacb-trsrn` TWP simulator: XYZ slides, A work-side table, B/C head rotaries |
| Additional scope | Shared WebUI/gateway behavior that this TWP workflow depends on; cross-family assumptions are identified separately |
| Exclusions | Physical-machine calibration, servo dynamics, exhaustive G-code semantics, full session-binding/security audit, and the separate wall-gantry branch/model |
| Implementation changes | None; this report and its offline probe scripts are review artifacts |

Source links point to the reviewed worktree and line numbers at the pinned revision. If the branch advances, inspect the pinned commit before closing a finding. This document is stored in the main workspace's `docs/reviews/`; that does not mean the older `development` implementation was the review target.

**Follow-up tracking.** P1 means resolve before relying on the affected motion routine or simulation verdict. A simulation P1 concerns an incorrect displayed result; the viewer does not provide a controller interlock. P2 means a reproducible correctness or responsiveness issue with a narrower trigger. Design recommendations are listed separately from defects. All items start open and unassigned; close them with a fix commit and the stated acceptance evidence.

| ID | Priority | Finding | Evidence | Status / owner / fix |
|---|---|---|---|---|
| [TWP-01](#twp-01) | P1 | Plane → Zero inherits distance mode | Generated-command probe + dispatch inspection | Fixed offline / Claude / 6840f77 (o<twp_goto_zero>); live: pending |
| [TWP-02](#twp-02) | P1 | Machine → Zero applies work offsets to a physical A target | Joint-stamp and subroutine inspection | Fixed offline / Claude / a6058f8 (G53 rotaries); live: pending |
| [TWP-03](#twp-03) | P1 | Orient solver returns an out-of-limit fallback | Extracted-function probe | Fixed offline / Claude / 684c510 (twp_transform, probe → [null, null]); live: pending |
| [TWP-04](#twp-04) | P1 | Head orientation validity ignores B/C movement | Predicate probe + UI/policy inspection | Fixed offline / Claude / 88809f2 (A/B/C stamp, planeFrame gate, set_kins_mode); live: pending |
| [TWP-05](#twp-05) | P1 | Frame/WCS/TLO event indices silently saturate | Decoder probe: 257 events | Fixed / Claude / 5a02441 (Uint32 indices + O(V+E) merge; probe 256/256/256); client-only |
| [TWP-06](#twp-06) | P1 | Collision clearance survives a tool-geometry change | Synthetic tool-change sweep misses contact | Fixed / Claude / 785ffee (invalidation at tool/TLO transitions + reference-sweep test); client-only |
| [TWP-07](#twp-07) | P1 | Concurrent sweeps share mutable tool geometry | Interleaved-iterator probe misses contact | Fixed / Claude / 785ffee (model-owned base tool, identity install, checkpoint before pose; restoration counterexample pinned); client-only |
| [TWP-08](#twp-08) | P1 / P2* | 08a: ordinary three-axis fixtures refused; 08b: capability/raw-mode assumptions | Policy probes + family-aware kinematics comparison | Fixed offline / Claude / 9fdb21e (08a) + 230a2e9 (08b); probe g59 → ["mdi", null]; live: pending |
| [TWP-09](#twp-09) | P2 | Valid tool compensation can repeatedly trigger reparsing | Repeated drift-predicate probe | Fixed offline / Claude / d626a66 (applied-vs-applied, tool_loaded); live: pending |
| [TWP-10](#twp-10) | P2 | Rotary-command prefilter misses bare G28/G30 | Scanner + boundary probe | Fixed offline / Claude / 52d210f (probe scanner → {1: ABC}); live: pending |
| [TWP-11](#twp-11) | P2 | Sweep initialization has no scheduling checkpoints | Source + first-yield timing probe | Fixed / Claude / 0bc4245 (checkpoints every 4096 vertices / 256 pairs; 100 k-point probe: first checkpoint was the whole scan (~50–65 ms); now 25 checkpoints, the first after 3–6 ms warm / ~36 ms cold JIT (the probe measures cold), see decisions.md); client-only |
| [TWP-12](#twp-12) | P2 | Entry/base result merge drops entry truncation | Constructed-result probe; conditional gap | Fixed / Claude / 40ef49c (merged-axis conservative prefix, route wording); client-only |

*TWP-08a is P1 for the existing three-axis fixture regression. TWP-08b is P2 for portability, becoming P1 before enabling incorrectly mapped movement controls on another family. It is not a mode-number mismatch on the shipped trsrn configuration.*

<a id="twp-01"></a>
**TWP-01 — Establish and restore modal state for Plane → Zero.** With an active plane/G59, `goto_zero_plan(..., work_z=5, clearance=25)` returns `G0 Z25.0000`, then `G0 X0 Y0`. The gateway submits those lines directly; neither establishes G90. Under G91 the operator gets another +25 Z and no X/Y motion. This is an incorrect target, not just a label issue. The clearance number is selected in machine units, so interpreter units also need an explicit contract.

Sources: [plan](/home/cnc/twp-checkout/lcnc-gateway/command_policy.py:236), [dispatch](/home/cnc/twp-checkout/lcnc-gateway/gateway.py:3586).

Recommendation: execute a dedicated routine with modal save/restore, explicit absolute distance mode and supported units. Validate its current frame immediately before execution and define what happens if its retract fails.

- [ ] From G90 and G91, the same physical starting pose reaches the same plane X0/Y0 and clearance Z; caller modes are restored.
- [ ] G20 on this metric TWP stack either produces the correct converted physical move or is refused before motion with a clear reason.
- [ ] An unsuccessful retract prevents the XY leg; abort is exercised between the two legs in an isolated simulator.

> **Comment (TWP-01): agree, P1.** The Machine branch already solves this: [go_to_zero.ngc](/home/cnc/twp-checkout/subroutines/probe_basic/go_to_zero.ngc:19) opens with `M73` + `G90`, so the interpreter saves and restores modal state. Minimal fix: move the Plane branch into a sub of the same shape (`M73`, `G90`, the machine's native `G20`/`G21` from `get_machine_units`, clearance as `#1`) and have `goto_zero_plan` return the `O<...> CALL` line. `G0` is not remapped, so the "remapped G-codes are dead inside MDI subs" finding does not apply. The third acceptance item (a failed retract prevents the XY leg) comes free: an interpreter error aborts the sub. No separate retract-failure design is needed.

<a id="twp-02"></a>
**TWP-02 — Return to the stamped A angle in physical coordinates.** Provenance records A from the joint, but `go_to_zero.ngc` uses `G0 A#1`. For a physical A20 stamp and G54 A+10, the requested work-coordinate A20 targets physical A30. Rotary touch-off in G54 is explicitly allowed, so the trigger is part of the supported Machine-mode workflow.

Sources: [joint provenance](/home/cnc/twp-checkout/lcnc-gateway/gateway.py:4894), [rotary moves](/home/cnc/twp-checkout/subroutines/probe_basic/go_to_zero.ngc:30).

Recommendation: use machine-coordinate semantics for the physical table target while identity kinematics is verified. Decide explicitly whether B/C should also return to physical zero; their current plain `G0 B0/C0` commands are work-coordinate targets too.

- [ ] With positive/negative G54 A and G92 rotary offsets, the final physical A equals the stored stamp.
- [ ] Exercise unstamped fixtures, stamps made at tilted A, and return targets near rotary limits.
- [ ] Record and test the intended B/C targets and the complete retract/rotate/XY sequence.

> **Comment (TWP-02): agree, P1.** [go_to_home.ngc](/home/cnc/twp-checkout/subroutines/probe_basic/go_to_home.ngc:25) already uses `G53 G0 A0` for the same axes; the fix is `G53` on the three rotary lines of go_to_zero.ngc. For B and C the stamp records nothing, and under identity kinematics machine zero is the only target the routine can promise, so `G53 G0 B0` / `G53 G0 C0` is the consistent choice; record it in the sub header. The Machine-branch stamp check that refuses TCP/Plane-stamped fixtures is right and unaffected.

<a id="twp-03"></a>
**TWP-03 — Validate every orient solution against both rotary limits.** The extracted current `calc_rotary_move_with_joint_limits(0 rad, 150° in radians, 100, -100, mode=0)` returns target 150° and distance 150°. Its fallback returns the original target without proving that target is legal. A downstream controller refusal does not make this a valid orient plan.

Source: [rotary solver](/home/cnc/twp-checkout/examples/sim_config/twp/python/remap.py:812).

Recommendation: select only equivalent angles within the configured interval and requested direction constraint. Enumeration is one approach; a checked alternative-angle fallback is acceptable if it covers the supported ranges and direction modes. Return an explicit no-solution result when none exists. Audit the adjacent angle filtering for consistent degree/radian units and correct primary/secondary limit selection.

- [ ] Every returned target lies within both limits and its returned travel matches that target.
- [ ] Cover ±180° wrapping, asymmetric and multi-turn limits, endpoints, and all direction modes.
- [ ] An impossible orient leaves the plane/fixture/kinematics state coherent and produces no partial orient motion.

> **Comment (TWP-03): agree, P1; inherited from upstream.** The comment above the fallback ("go the longer way") describes a computation the function never makes; it returns `trgt` untested on both the [max](/home/cnc/twp-checkout/examples/sim_config/twp/python/remap.py:825) and [min](/home/cnc/twp-checkout/examples/sim_config/twp/python/remap.py:836) side. Minimal fix inside the function: when `pos + dist` breaks a limit in mode 0, compute the other-direction candidate (`dist ∓ 360`), accept it if inside both limits, else return `(None, None)`. `calc_angle_pairs_and_distances` already drops `None` pairs and `calc_optimal_joint_move` handles an empty list, so the no-solution path exists downstream. The third acceptance item is the one to watch in the simulator: `G53.3` switches to kins 2 before the orient `G0` (spike record), so a soft-limit abort at the orient leaves kins 2 with an unoriented plane; the "TOOL without plane" chip covers the display, what the abort handler restores is the open question.

<a id="twp-04"></a>
**TWP-04 — Validate the actual tool direction, not just the A stamp.** `twpPoseStale` sees only the last orient's A, current A, and plane-defined flag. `twpPoseOriented` only establishes that an orient once happened. Moving B/C in Machine or TCP mode while A stays fixed leaves these predicates reporting oriented/not-stale. Plane selection remains available although the head can be off-normal. A-stale detection currently also acts as a warning rather than a backend admission rule for → Zero.

Sources: [predicates](/home/cnc/twp-checkout/lcnc-webui/src/twpPose.ts:27), [live inputs](/home/cnc/twp-checkout/lcnc-webui/src/App.vue:594), [Plane selector](/home/cnc/twp-checkout/lcnc-webui/src/JogStrip.vue:437).

Recommendation: validate actual head alignment. A conservative full A/B/C stamp is acceptable for the shipped trsrn configuration if tied to the current plane definition and verified after successful completion against joint readback, with wrap/tolerance and unknown-state handling. Tool-axis-vector comparison against the transformed plane normal is the more general option. Keep a frozen-plane coordinate frame distinguishable from an aligned tool. Gate routines that promise retraction along the tool axis using that validity, or describe their actual frozen-frame motion explicitly.

- [ ] Independent A, B and C moves invalidate alignment when they change the relative direction; equivalent wrapped poses do not falsely invalidate it.
- [ ] Missing readings yield unknown validity; they never imply confirmed alignment.
- [ ] Orient restores validity only after completion/readback, including failure and abort paths.

> **Comment (TWP-04): agree on the defect; recommend the cheaper fix.** The remap stamps only `twp_pose_a` ([remap.py:1477](/home/cnc/twp-checkout/examples/sim_config/twp/python/remap.py:1477)). On this kinematics the head solve is a function of the three rotary joints, so stamping B and C at the head solve alongside A, publishing them the same way (`twp-pose-b-in`, `twp-pose-c-in`) and comparing all three wrap-aware closes the operator scenario (jog B or C in Machine or TCP mode after an orient) with the existing pattern: three pins, one predicate. The live tool-axis-vector comparison is the principled form; do it only if a case appears the three-angle stamp cannot express. Agree that staleness must be an admission rule, not a chip: add `twp_stale` to `MachineState` and refuse in the [Plane branch of `goto_zero_plan`](/home/cnc/twp-checkout/lcnc-gateway/command_policy.py:281) with the Orient message, since the routine promises retraction along the tool axis and a stale frame's Z is no longer that axis.
>
> **Reply:** accepted: full A/B/C stamp tied to the current plane definition, verified against joint readback, unknown-state handling, enforced in backend admission. One point in favour of the stamp shape: the remap already writes `twp_pose_a` only after `yield INTERP_EXECUTE_FINISH` ([remap.py:1471](/home/cnc/twp-checkout/examples/sim_config/twp/python/remap.py:1471)), and an abort never resumes the generator, so a B/C stamp written at the same place inherits completion semantics; the readback comparison belongs there too.

<a id="twp-05"></a>
**TWP-05 — Remove the 254 event-index ceiling.** With 257 distinct events, the latest vertex should refer to index 256. The decoder returns 254 for all three channels: plane frame, WCS and TLO. `Math.min(ei, 0xfe)` silently substitutes an earlier event. This can put geometry and collision poses in the wrong coordinate frame or use the wrong tool.

Source: [event indexing](/home/cnc/twp-checkout/lcnc-webui/src/previewDecode.ts:127).

Recommendation: use adequately sized event indices and an explicit missing sentinel through decoding, worker messages, tracks, splits, and collision inputs. Replace the nested per-vertex scan over all events with a monotonic merge or binary search while preserving strict sequence ordering.

- [ ] 257+ and 1,000+ distinct frame/WCS/TLO events preserve the exact event at every vertex through the complete consumer chain.
- [ ] Before-first, equal-sequence and duplicate-sequence rules remain correct.
- [ ] Benchmark a large path with many events; the present one-epoch large-file benchmark does not cover this scaling dimension.

> **Comment (TWP-05): agree, P1; fold the scan cost into the same fix.** 254 events per stream is not exotic: a multi-fixture program alternating G54 to G57 per operation makes one WCS epoch per switch, so 64 operations across four fixtures cross the cap, and long multi-tool programs do the same with TLO events. The failure is silent. The per-vertex indices are derived client-side from the event seq lists, so the fix is client-only: `Uint16Array` with `0xffff` as none through `ScrubStream` / `ScrubTrack`, `splitTrackStreams`, both worker inputs and `tloForIndex` / `termFor` / `frameFor`; no schema bump, no suite restart. The nested scan at [previewDecode.ts:133](/home/cnc/twp-checkout/lcnc-webui/src/previewDecode.ts:133) is O(vertices × events); per-stream seq is monotonic (global canon counter), so a two-pointer merge over the sorted event list is O(V + E) and keeps the "event at seq N governs seq > N, last recorded wins on ties" rule. Do both together so the benchmark item has something to measure.
>
> **Reply:** accepted: `Uint32Array` with a consistent sentinel rather than a 16-bit index with an overflow branch; correct by construction beats a second silent ceiling.

<a id="twp-06"></a>
**TWP-06 — Invalidate collision clearance when geometry or a discontinuous pose changes.** The new carried-clearance optimization retains `clear[]` across segments. Changing the active tool swaps its mesh and bounds, but does not invalidate the old clearance. The probe moves a tool toward a fixture from X20 to X5, switching diameter 2 to diameter 20 early in a 40-point path. It reports zero hits. The diameter-20-only sweep of the same approach reports a tool/fixture intersection. The switch happens before that intersection: clearance obtained with the small tool hides the later large-tool contact.

Sources: [tool swap](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:748), [carried clearance reuse](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1631).

Recommendation: invalidate and re-query affected pair certificates at tool-geometry changes. Audit TLO, WCS and kinematics boundaries too: carrying a bound requires continuous relative geometry or a proven bound on the discontinuity. Update contact/onset state deliberately at those transitions.

- [ ] The supplied small-to-large-tool case finds the same later contact as independently sweeping the large-tool suffix.
- [ ] Add diameter, length and TLO changes in both directions, including zero-length event boundaries.
- [ ] A reference sweep that queries every segment boundary agrees with the optimized sweep on adversarial multi-tool/TWP programs.

> **Comment (TWP-06): agree, P1; the most consequential finding in the review.** Confirmed by source: [`applyTool`](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:775) swaps geometry, BVH, sphere and extent inside [`poseAt`](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:877); [`clear[]`](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1261) is written only at [query time](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1701) and [decayed per chunk](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1721), never reset on a variant change. Minimal fix inside `applyTool`: when the variant actually changes, zero `clear` and pull every `sSafe` back to the current parameter so each non-skipped pair re-queries at the next sample; one query round per tool change. The audit item I would make part of the fix: a TLO event moves the tool body by `-TLO` in the tool node's frame ([collision.ts:883](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:883)), the same class of discontinuity, same reset. WCS epochs and kins-frame relabels do not need it: relabel vertices are zero-width and the joints hold still across them (capture-g536). The reference-sweep acceptance item is the right regression shape; the probe's small-to-large fixture should become that test.
>
> **Reply:** correct: `clear` and `sSafe` are declared after the first-pose call ([collision.ts:1132](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1132) vs [:1251](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1251)), so a reset inside `applyTool` would hit a temporal dead zone. The invalidation belongs at the segment transition in the sample loop (when the segment's tool or TLO index differs from the previous segment's), together with an explicit rule for existing contact/onset state at that transition. TLO changes were already in the acceptance list above; the point stands only as "part of the fix, not an audit".

<a id="twp-07"></a>
**TWP-07 — Preserve correct mutable state across concurrent collision runs.** Main and entry sweeps can use the same resident `CollisionModel`. Each iterator mutates the model's tool body, while `appliedTool` is cached privately in that iterator. When another iterator changes the shared body, the first iterator still believes its selected tool is installed. An offline interleaving of two iterators with the same tool table and different active tools changes the large-tool sweep from one intersection to zero.

Sources: [resident model and main/side runs](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collisionWorker.ts:117), [tool-state cache](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:775).

Recommendation: share immutable meshes/BVHs while keeping mutable state per run, or establish a complete installation/save/restore contract around shared state. A local fix is acceptable if it satisfies that contract. Keep a stable model-owned base tool: capturing another run's temporary tool as `baseVariant` also corrupts cleanup and later fallback sweeps, as the [comments-response experiment](twp-review-2026-09-14.comments-response.md) demonstrates. Simply caching the selected tool independently is insufficient. Inspect suspension after `interpPose` as well as suspension between segments.

- [ ] Standalone, sequential and interleaved main/entry runs produce identical findings for their respective inputs.
- [ ] Cover different active tools, TLOs, poses, and interruption during contact refinement.
- [ ] Cancel, error and completion restore no stale or disposed tool geometry into the resident model.
- [ ] After interleaved runs finish, a subsequent fallback-tool sweep agrees with a fresh model and the resident base geometry is unchanged.

> **Comment (TWP-07): agree; two one-line fixes, the refactor is not needed.** The "inspect suspension after `interpPose`" note is the direct mechanism, not a side audit: the sample-loop [checkpoint](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1640) sits after [`interpPose`](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1637) and before the [distance queries](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1663), so a main run that yields there and resumes after a side-run slice queries at the side run's pose. Fixes: (1) replace the `tn === appliedTool` short-circuit with a check on the body itself (`tb.geom === v.geom`), true only if this run installed the variant last; (2) move the checkpoint above `interpPose`, or re-pose after a yield returns. Node matrices need nothing else: every sample re-poses the whole tree before querying, so the applied tool and the just-posed matrices are the only state that survives a yield, and the two edits cover both. Immutable meshes plus per-run pose state, or serialized access with save/restore, both cost more than the defect. Acceptance: the probe's interleaving as a regression test, plus one where the side run arrives between `interpPose` and the queries.
>
> **Reply:** withdrawn as stated. The base variant is captured from whatever the shared body wears at iterator creation ([collision.ts:756](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:756)) and restored at completion ([:1483](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1483)), so a side run started mid-sweep adopts the main run's program tool as its base; the response's counterexample reproduces here (restored false, fallback 1 vs 0). The fix is still local but has three parts: a base variant owned by the model at build time, the geometry-identity check, and the checkpoint above `interpPose`. Also correct that the original probe suspends at the initial yield, so the private cache alone explains it; the yield-after-pose hazard is a second defect that needs its own test.

<a id="twp-08"></a>
**TWP-08 — Declare machine capabilities and resolve raw modes by family.** Policy treats raw 0/1/2 as identity/TCP/Plane for every switchable machine. The viewer's kinematics layer already understands that other families can have a different raw-mode mapping. In addition, the reserved-G59 check applies even when `kins_switchable=False`: an ordinary three-axis G59 X touch-off is refused as a TWP scratch-row write.

Sources: [policy](/home/cnc/twp-checkout/lcnc-gateway/command_policy.py:137), [family-aware interpretation](/home/cnc/twp-checkout/lcnc-webui/src/viewer/kins.ts:650).

Recommendation: immediately restore ordinary fixtures on non-TWP machines (08a). For 08b, gate TWP-specific routines by actual supported capability/family and resolve raw modes semantically in the trusted backend policy and UI. A small explicit mapping is sufficient for merge; a general declaration of modes, rotary roles, reserved fixtures and touch-off routes can follow. Keep unknown mode distinct from unsupported TWP capability.

- [ ] Three-axis machines retain their ordinary G54–G59.3 workflows.
- [ ] Add a parameterized non-switchable G59–G59.3 linear touch-off regression test; each route returns `("mdi", None)` under otherwise admitted state. The existing G54-only test is insufficient.
- [ ] Test trsrn and TRT with/without `identityfirst`; machine-coordinate routines are admitted only under the actual identity mode.
- [ ] Unsupported capabilities are clearly absent/refused; a stale mode reader cannot masquerade as a machine without TWP.

> **Comment (TWP-08): split it; the G59 half is P1, the raw-mode half is correctly P2\*.** G59: the refusal reaches the default 3-axis sim config and the PM-25MV, and lands the moment feat/twp merges. [`test_non_switchable_machine_is_identity`](/home/cnc/twp-checkout/lcnc-gateway/test_command_policy.py:344) exercises only `g5x_index=1`, so it is untested; the frontend has no independent rule (nothing reserved-fixture-related in `permissions.ts`) and dims from the gateway's permission broadcast, so the DRO touch-off dims in G59 on a plain mill too. Fix: guard the reserved-fixture check and `_R_TOUCHOFF_LINEAR`'s message with `s.kins_switchable`; write the failing test first (`touchoff_route(state(kins_switchable=False), ("X",))` at `g5x_index` 6 to 9 returns `("mdi", None)`). Raw mode: no shipped configuration is mis-mapped today ([lcnc_suite_sim_5axis_tcp.ini:149](/home/cnc/twp-checkout/examples/sim_config/lcnc_suite_sim_5axis_tcp.ini:149) declares `sparm=identityfirst`; `xyzacb_trsrn` is identity at type 0), and the gateway already reads `identity_first` in [`parse_kins_config`](/home/cnc/twp-checkout/lcnc-gateway/gateway_util.py:594) for [`kins_nonidentity_flags`](/home/cnc/twp-checkout/lcnc-gateway/gateway_util.py:759). Cheap to close anyway: add `identity_first` to `MachineState` from the kins declaration and resolve the semantic mode there. The per-machine capability declaration is the right long-term shape, not a merge requirement.
>
> **Reply:** accepted: the 08a/08b split, the parameterized G59–G59.3 test, and a capability guard beyond `kins_switchable` (the TCP trunnion sim is switchable and has no TWP stack, so Capture must not be offered there).

<a id="twp-09"></a>
**TWP-09 — Compare applied tool compensation with its parse context.** `evaluate_tlo_drift` compares applied Z compensation with the table row for the spindle tool. A valid `T1` with `G43 H2`, or a dynamic `G43.1`, need not match that row. With unchanged table metadata and T1 row Z10 but applied Z20, the probe repeatedly returns `tool_offset`; reparsing the same table cannot resolve the mismatch.

Source: [drift predicate](/home/cnc/twp-checkout/lcnc-gateway/gateway_util.py:1530).

Recommendation: keep tool-table revision and applied-compensation context as separate parse inputs. Compare like with like, preserving the legitimate need to refresh when either changes.

- [ ] G43 H matching T, G43 H differing from T, G43.1, and G49 all settle without a reparse loop.
- [ ] Changing a loaded or later-program tool still causes the required refresh.
- [ ] Demonstrate one accepted publish remains current across subsequent unchanged status polls.

> **Comment (TWP-09): agree, P2, but state the consequence.** The [caller](/home/cnc/twp-checkout/lcnc-gateway/gateway.py:1698) runs under `drift_gate_open` (idle plus debounce) with no memory of having already reparsed for this state, so with `G43 H` not matching `T`, or `G43.1`, in effect at idle this is one reparse per debounce interval for as long as the machine sits there. On a large program (the 13 s parse in the performance table) that is the parse worker permanently busy on the host that also runs the watchdog and reader: the cost is safety margin, not preview freshness. Fix: record the applied tool offset at parse time in the worker's meta (it already seeds from live stat) and compare applied-now to applied-at-parse; keep `table_mtime` and `table_row` as they are.
>
> **Reply:** accepted wording: repeated parsing wastes CPU and can consume scheduling margin on the shared host; no trip was demonstrated.

<a id="twp-10"></a>
**TWP-10 — Include implicit rotary commands in the source prefilter.** `rotary_letters_on_line('G30')` correctly returns `ABC`, but `rotary_word_lines('G30')` returns an empty map because its prefilter searches only for A/B/C words. The line classifier does trust bare G30 as rapid motion. If its reference rotary target equals the parse seed, the endpoint test also sees no change: the boundary probe returns `A: null, unknown: null`. The client can consequently treat later path geometry as inheriting live A when the program actually restores a stored reference angle.

Sources: [source prefilter](/home/cnc/twp-checkout/lcnc-gateway/gateway_util.py:3242), [boundary derivation](/home/cnc/twp-checkout/lcnc-gateway/gateway_util.py:3263).

Recommendation: admit bare G28/G30 to the candidate scan or record this semantic fact directly from the interpreter. Continue distinguishing G28.1/G30.1 storage from reference motion.

- [ ] Equal-to-seed bare G28/G30 establish the commanded rotary boundary.
- [ ] Explicit-axis forms, parameterized words, comments and storage-only forms remain correct.
- [ ] After a live A change, the immediate preview and the subsequent reparse agree about which sections return the table and ride the part.

> **Comment (TWP-10): agree; trivial, low impact.** Add `_BARE_HOME_RE`'s alternative to [`_ROT_CANDIDATE_RE`](/home/cnc/twp-checkout/lcnc-gateway/gateway_util.py:3206). Impact is small because the rotary-drift auto-reparse re-seeds within seconds of a settled jog, after which test (a) in `first_rotary_commands` catches the moved axis; the exposure is the debounce interval.
>
> **Reply:** exposure corrected: debounce plus parse, publish and rebuild (a 13 s parse is on record), not the debounce interval alone.

<a id="twp-11"></a>
**TWP-11 — Yield during collision initialization and prescreening.** The iterator builds per-vertex state and scans every segment's joint range before its first `yield`. Those phases cannot process pause/cancel messages. A synthetic 100,000-point, one-pair probe took roughly 50–100 ms to reach the first checkpoint on this review host, already exceeding the documented 8 ms checkpoint interval. Complex TWP inversion and larger tracks can cost more. This measurement is a small synthetic probe, not a Mac UI benchmark.

Sources: [initialization](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:665), [whole-program prescreen](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:942), [first checkpoint](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1516).

Recommendation: make expensive setup phases incremental or cache them by their real dependencies. Measure acknowledgement latency from cold requests, not only within the main segment loop. Keep the user-selected open-ended sweep behavior; bounded scheduling does not require restoring a total sweep timeout.

- [ ] Cold model load, per-vertex setup, prescreen and refinement each respond to pause/cancel within a documented target on the supported browser/hardware.
- [ ] Test camera interaction and hidden-tab transitions immediately after posting a large sweep, plus a side sweep arriving during a main sweep.
- [ ] Record CPU/RAF tail latency as well as total sweep time.

> **Comment (TWP-11): real; rank it last.** This is worker-thread latency for pause and cancel acknowledgement; the main thread never blocks on it and the UI stays responsive. What it affects is how quickly a camera-interaction pause takes effect in the first fraction of a second of a sweep, and how quickly a superseded sweep dies. Worth doing (yield every N vertices inside the prescreen), after everything above. M-06 should not treat it as a UI-responsiveness item.
>
> **Reply:** "the UI stays responsive" withdrawn: the branch's own record ([decisions.md:3826](/home/cnc/twp-checkout/docs/decisions.md:3826)) shows camera lag with a clean main thread while the worker starved the WebGL host. Rank unchanged, with the corrected justification: the exposure is bounded by the initialization duration, which should be measured on the big program before deciding whether this item really is last.

<a id="twp-12"></a>
**TWP-12 — Preserve incomplete coverage when merging entry and program results.** `mergeEntryResult` always adopts `base.truncated` and assumes the entry was swept completely. A constructed entry result truncated at 25%, merged with a complete base result, reports `truncated: null`. Both run types use an iterator that can return a sample-limit truncation. This is a demonstrated merge-contract gap; this review did not produce entry truncation on the shipped machine's normal travel range.

Source: [result merge](/home/cnc/twp-checkout/lcnc-webui/src/viewer/sweepMerge.ts:63).

Recommendation: preserve the completeness and checked intervals of each component explicitly. A complete program sweep cannot certify an incomplete entry move.

- [ ] Complete/partial/stopped entry and base combinations never discard unchecked spans.
- [ ] The timeline and verdict identify the unchecked entry portion and never describe the combined route as completely checked.

> **Comment (TWP-12): agree; trivial, conditional as stated.** A two-point entry track reaches a sample truncation only through the [runaway backstop](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1712) (four times `maxSamples` inside contact stepping), not a realistic entry move; a time truncation is possible if the side run carries a `maxMs`. Fix: `truncated: entry.truncated ?? base.truncated`, with `covered` rescaled onto the merged axis when it is the entry's. Do it with TWP-06 and TWP-07.
>
> **Reply:** both corrections accepted: the worker sets `maxMs` to undefined for both runs ([collisionWorker.ts:217](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collisionWorker.ts:217)), so there is no time truncation in production; and a partial entry is not a prefix of the merged axis, so the merge needs the base length and either checked intervals or a conservative prefix with matching wording.

**Operator workflow recommendations.** The current shipped configuration implements the following contract. This table describes behavior, not a claim that the routines are correct in every modal state; TWP-01 through TWP-04 qualify it.

| Selected kinematics | Touch-off / Zero All | → Zero | → G30 / → Home |
|---|---|---|---|
| Machine | Linear axes into G54–G58; rotary touch-off only in G54 | Conditional Z retract; A toward stamped pose; B/C toward zero; then work X0/Y0 | Allowed by identity gate |
| TCP | Linear touch-off only with A approximately zero; rotary refused | Refused | Refused |
| Plane | XYZ through plane remap into persistent G54; temporary G59 rows refreshed | Retract in frozen plane Z, then plane X0/Y0; no rotary move | Refused |

Plane touch-off's persistent-datum design is worth keeping. [M535](/home/cnc/twp-checkout/examples/sim_config/twp/python/remap.py:1486) converts the touched coordinates back into G54 and refreshes the remap-owned plane fixtures. Its G21/G92/fixture checks and the datum-publication sequence avoid several common offset races. Machine-mode edits to G54 after plane definition still leave the plane's captured datum unchanged until an explicit refresh/redefinition; the existing stale-datum indicator is useful.

- [ ] **D-01: Make the selector's scope visible.** “Jog frame” changes machine-wide kinematics and sometimes the active fixture; it affects subsequent MDI/program execution. Present it as kinematics/working-frame selection, with the actual active fixture beside it. Keep stationary frame selection separate from Orient, which moves the head.
- [ ] **D-02: Distinguish datum writes and destinations.** Label the TWP linear-only “Zero All” action as “Zero XYZ” or name its actual axis set. Make “Plane touch-off updates G54” visible where values are entered. “Home All” performs reference homing; “→ Home” moves toward machine zero, not arbitrary INI HOME coordinates; “→ G30” currently restores XYZ only. Label these destinations accordingly. Sources: [setup controls](/home/cnc/twp-checkout/lcnc-webui/src/SetupStrip.vue:137), [Home](/home/cnc/twp-checkout/subroutines/probe_basic/go_to_home.ngc:19), [G30](/home/cnc/twp-checkout/subroutines/tool_length_probe/go_to_g30.ngc:17).
- [ ] **D-03: Configure clearance and return sequences.** The shipped routines assume machine Z0 is an appropriate retract location. Their no-downward guard is useful but does not establish clearance for a tilted holder or a rotary sweep. Record the machine's retract reference, rotary return policy and fixture/tool envelope assumptions. Explain the selected routine's destination and rotation behavior before initiation without adding confirmations to every ordinary operation.
- [ ] **D-04: Publish one frame/state contract.** Distinguish physical joint pose, active command coordinates, persistent workpiece datum, captured plane definition, current tool alignment, and preview revision. Preserve the existing part-datum marker and machine-zero ghost if desired, but label which one a motion command actually targets. Use frame-tagged values at conversion boundaries rather than interchangeable numeric arrays. This can be introduced incrementally at existing module boundaries.

> **Comment (D-01 to D-04):** D-01: see U-01; a heading rename covers it. D-02: agree and cheap. Checked: the Home button is `G53 G0 X0 Y0` plus rotaries to machine zero ([go_to_home.ngc:22](/home/cnc/twp-checkout/subroutines/probe_basic/go_to_home.ngc:22)); the G30 button moves XY then Z from `#5181..#5183`, XYZ only ([go_to_g30.ngc:20](/home/cnc/twp-checkout/subroutines/tool_length_probe/go_to_g30.ngc:20)). "Zero All" under TWP being linear-only should read "Zero XYZ"; "updates G54" belongs in the keypad title in Plane mode. D-03: agree the retract reference should be recorded per machine; the "never lowers Z" guard is the right invariant and the Z0-at-top convention is documented; not a merge blocker. D-04: agree, post-merge; large.

**Parsing and simulation recommendations.** Keep LinuxCNC as the interpreter and retain the execution-ordered event stream, relabel discontinuities, per-segment TLO, worker-based bulk processing and shared kinematics interface. The new gateway-generated outside-limit flags also remove a source of disagreement between the code panel and viewer. They remain a sampled validator result, not proof that all intermediate poses satisfy a continuous bound.

- [ ] **D-05: Give every derived result an explicit context revision.** Include program content, interpreter seed/modal state, WCS/G92, rotary seed, plane/kinematics state, applied compensation, tool-table revision, joint limits and machine-model revision where relevant. Geometry, limits and collision results can become stale for different reasons; show those validity states independently. Preserve cancel/restart and stale-result rejection, but make their dependency rules reviewable in one place.
- [ ] **D-06: Separate geometric agreement from physical-machine accuracy.** The recorded replay exercises the client chain on saved payloads; it does not rerun the current parser. The corpus distance metric combines linear and angular joint components numerically. Add separate tool-tip position and tool-axis-angle tolerances, forward and reverse trajectory comparisons, and a current-parser end-to-end gate. Keep the documented G68.3 seed discrepancy visible rather than interpreting the relaxed tolerance as normal machining accuracy. Source: [replay scope and metric](/home/cnc/twp-checkout/lcnc-webui/src/viewer/simReplay.corpus.test.ts:17).
- [ ] **D-07: State collision coverage precisely.** The minimum advancement is 0.25 in a mixed distance/angle path parameter, not a uniform 0.25 mm tool-surface error. At a 2 m lever, 0.25° spans about 8.7 mm. Validate narrow rotary contacts against the desired physical tolerance. Mechanical-neighbor exclusion inferred from contact at rest/first pose also needs a documented envelope; preferably declare intended exclusions and test that they cannot hide a later crash. Source: [collision parameterization](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:679).
- [ ] **D-08: Keep reach outlines and collision proxies within their proven role.** The reach hull can fill concavities and loses the orientation required to reach a point. It is a workspace illustration, not an orientation-specific or collision-free reachability certificate. For proxy meshes, require per-asset validation and ensure the query's treatment of closed-volume containment supports the claimed conservative behavior; containment of display vertices alone does not establish every triangle-surface-distance claim. The separate gantry model's proxy-generation implementation was outside this review. Source: [reach assumptions](/home/cnc/twp-checkout/lcnc-webui/src/viewer/reachEnvelope.ts:1).

> **Comment (D-05 to D-08):** D-05: agree in principle. The freshness inputs are enumerated in the design record (WCS epochs, TLO drift, XYZ entry, rotary seed, kins type, in-program G43) but not in one place in code; a single parse-context record the drift block compares against would also close TWP-09 structurally. D-06: agree. The corpus gate replays the running gateway's cached payload on purpose (staleness is in scope), so a current-parser end-to-end check is the complement, not a replacement; separate tip-position and tool-axis-angle tolerances are cheap and worth adding. D-07: the 0.25-unit floor and the 1° ≙ 1 mm parameterization are already in decisions.md; agree they belong in the operator-facing sweep result text and the README. D-08: agree; the reach hull's layer tooltip should say it is illustrative. Proxy validation belongs to the gantry evaluation branch.

**Performance assessment.** Several recommendations from the previous review are now implemented: opaque stale-path colouring, spatial draw chunks, display LOD, avoiding unnecessary full-path limit overlays, a resident pausable collision worker, carried clearance, live findings, and whole-program pair prescreening. These are substantial improvements. TWP-06 and TWP-07 show why geometry/certificate lifetime needs to be tested alongside throughput.

| Evidence available in the branch | What it establishes | What it does not establish |
|---|---|---|
| Opaque muting and sweep-context telemetry, 9–10 September | The earlier transparency and competing-worker costs were measured and addressed | That every later build/workload has the same frame latency |
| Recorded complete trsrn sweeps of 37 and 54 s, 11 September | The earlier multi-hour sweep behavior was substantially improved on that workload | A universal sweep-time bound |
| Latest performance note: 13.1 s gateway parse; 20,000-point gantry slice reduced to 5.1 s with proxies/query changes | Parsing and collision checking are distinct costs; query-side work matters | Full-program performance on current `1aa0730`, or equivalence to the different 199 s trsrn sweep mentioned in that note |
| This review's 100,000-point initialization probe | Work before the first yield exceeds the stated small checkpoint interval | End-user FPS on the operator's Mac |

Recorded sources: [sweep measurements](/home/cnc/twp-checkout/docs/decisions.md:3851), [chunking/LOD](/home/cnc/twp-checkout/docs/decisions.md:3960), [latest proxy/query measurements](/home/cnc/twp-checkout/docs/decisions.md:5002).

- [ ] **D-09: Rebaseline a small repeatable performance matrix at the fix commit.** Include cold load, warm load, rotary jog, XYZ touch-off, tool/TLO change, mode switch, camera interaction during parsing/sweeping, sim entry during a multi-tool sweep, and hidden-tab resume. Use both many-short-segment and many-frame/tool-event programs. Record machine/browser, hash, payload bytes, parse/transfer/decode/rebuild time, time-to-first-result, sweep completion/coverage, RAF p95/p99, longest task, pause acknowledgement and memory after repeated reloads. Do not infer GPU execution time from WebGL-fence wall time alone: the browser's GPU process can also be delayed by host CPU contention.

> **Comment (D-09):** agree, kept small: the existing perf matrix plus a short browser-side table with the measurement method recorded. The project has retracted a browser frame-rate claim before, so the method matters more than the numbers.

**Verification performed for this review.** Tests ran in an isolated archive of the pinned commit with existing dependencies. The original sandboxed gateway invocation hung in asyncio cleanup; the fake-LinuxCNC suite passed when rerun with local socket access. That initial environment failure is not counted as a product defect.

| Check | Result |
|---|---|
| Frontend Vitest | 54 files, 764 tests passed |
| Gateway pytest | 786 tests and 11 subtests passed; default config excludes `test_viewer_init.py` |
| Production build | Passed, including `vue-tsc -b`; Vite reported its existing large-chunk advisory |
| ESLint / CSS audit | Both passed; ESLint in the isolated snapshot, read-only CSS audit in the unchanged feature worktree because that script requires Git metadata |
| Playwright against isolated mock servers | 16 tests passed; CI mode prevented server reuse |
| Diagnostic probes | Event saturation, mode plan/policy, limit fallback, TLO drift, rotary scan, collision tool changes/interleaving, first-yield timing, and entry-result truncation |
| Live LinuxCNC / physical machine | Not run |

The branch records a 12 September live-simulator corpus gate as 21/21 checks across eleven runs, including a relaxed tolerance for the G68.3 seed case. That is historical evidence, not a fresh live gate performed by this review. The current passing unit tests do not invalidate the counterexamples above. Source: [recorded live gate](/home/cnc/twp-checkout/docs/decisions.md:4522).

**Acceptance sequence for the fixes.** Owners should use the following order and attach results to the corresponding IDs; these simulator operations are proposed follow-up, not actions executed during this review.

1. Fix TWP-01–04 and TWP-08a, with the minimum capability/mode guard from 08b, and exercise mode selection, Capture, Orient, Clear, touch-off and return motion on an isolated simulator. Include G90/G91, G20/G21, G54/G59, G92, positive/negative rotary offsets, A/B/C movement, tool compensation and near-limit orientations.
2. Fix TWP-05–07 before relying on collision clearance or large multi-event program replay. Promote the diagnostic fixtures into regression tests, including interleaved worker messages and independent reference comparisons.
3. Close the merge gates for TWP-08–12, including the portability, refresh and incomplete-coverage cases and measured scheduling responsiveness. Re-run current-parser goldens and the live simulator corpus after fixes to parse/coordinate behavior.
4. Run the performance matrix and operator workflow walk-through. Record expected final joint pose, active fixture, kinematics mode, restored modal state and displayed validity for each action. Include M2/M30, abort during Orient/touch-off/return, and restart with a defined plane.

**Reproducing the offline counterexamples.** The companion scripts are diagnostic fixtures, not production changes or passing regression tests. They print the reviewed behavior; after fixes, several printed results should change. They import pure code and do not connect to a gateway or command LinuxCNC. They can be pointed at an isolated checkout of the pinned revision.

- [Python policy/solver/parser probes](twp-review-2026-09-14.probes.py)
- [TypeScript decoder/collision probes](twp-review-2026-09-14.probes.ts)

Run from the workspace containing this report, with the reviewed checkout and its existing dependencies available:

```bash
TWP_ROOT=/home/cnc/twp-checkout
TWP_APP="$TWP_ROOT/lcnc-webui"
"$TWP_ROOT/lcnc-gateway/.venv/bin/python" \
  docs/reviews/twp-review-2026-09-14.probes.py "$TWP_ROOT"

"$TWP_APP/node_modules/.bin/esbuild" \
  docs/reviews/twp-review-2026-09-14.probes.ts \
  --bundle --platform=node --format=cjs \
  --alias:reviewed-ui="$TWP_APP/src" \
  --alias:three="$TWP_APP/node_modules/three" \
  --outfile=/tmp/twp-review-2026-09-14-probes.cjs
node /tmp/twp-review-2026-09-14-probes.cjs
```

Expected defect observations at `1aa0730`: event indices `254/254/254` instead of 256; rotary solver target 150 outside ±100; repeated `tool_offset`; bare-G30 scanner `{}` with no commanded-A boundary; small-to-large-tool sweep zero hits versus one with the large tool throughout; interleaved large-tool sweep zero hits versus one standalone; merged entry truncation `null`. The comments follow-up adds `restoredOriginalGeometry: false` and a subsequent fallback sweep reporting one contact versus zero on a fresh model. First-checkpoint timing varies by host and should not be treated as a deterministic test assertion.

> **Comment (omissions):** four things the review does not say. (1) No adversarial test is named for the G59 regression; write it before the fix. (2) TLO events are a second discontinuity in TWP-06. (3) The yield-after-pose in TWP-07 is the direct mechanism of the probe's result and belongs in the fix, not an audit list. (4) TWP-09's reparse loop costs safety margin on the host that runs the safety chain.
>
> **Reply:** (2) withdrawn as an omission: TLO changes were in the recommendation and acceptance list; the point is only that they belong in the fix. (3) withdrawn: the probe's mechanism is the private cache; the yield-after-pose hazard is a separate defect needing its own test. (1) and (4) stand as accepted in the response.

**Closure record.** For each item, append the owner, decision, fix commit, regression test names, simulator evidence where applicable, and any remaining limitation. A changed comment or a green pre-existing suite alone does not close a reproduced defect. Keep changes to the operating contract explicit so the implementation and operator documentation stay aligned.

---

<a id="implementation-review-2026-09-15"></a>
**TWP implementation review — 15 September 2026 — `584083b`**

**Recommendation: hold `feat/twp → development` at `584083b`.** The fix waves address most original counterexamples and add useful regression coverage. Three correctness blockers remain: reversed mode commands on the shipped TCP trunnion, touch-off accepting a stale target, and collision clearance surviving an unknown-motion gap. Initialization responsiveness and keyboard access to refusal explanations are also incomplete.

Reviewed revision: `584083b3a6e13569710ab453cb7362b3b9f67206`, compared with `1aa0730017ca022cba3271ce6c71c12b04e11027`, in `/home/cnc/twp-checkout`. The worktree remained clean. This updates the original review above and the [assessment of its comments](twp-review-2026-09-14.comments-response.md). Source links below refer to the current pinned revision.

This review changed only review artifacts. Verification used an isolated source archive, fake-LinuxCNC dispatch tests, pure geometry probes and mock browser servers. It did not command, restart or exercise the live LinuxCNC session. The branch's live-simulator results are credited as recorded evidence, not as runs performed by this review.

| ID | Priority | Remaining finding | Previous item / gate |
|---|---|---|---|
| [R-01](#r-01) | P1 | Machine/TCP selection sends the opposite command on the shipped TRT configuration | TWP-08b / M-04 |
| [R-02](#r-02) | P1 | Touch-off target verification can accept G54, then write to G55 | U-03 / M-05 |
| [R-03](#r-03) | P1 | Clearance carried across an unknown-start gap hides contact in subsequent known motion | TWP-06 boundary audit / M-03 |
| [R-04](#r-04) | P2 | TWP per-vertex initialization still blocks the first checkpoint for hundreds of milliseconds | TWP-11 / M-06 |
| [R-05](#r-05) | P2 | Disabled-control explanations are unavailable through keyboard focus/activation | U-06 / M-05 |

All five findings are open. R-01/R-03 are remaining cases in the reviewed implementation, not claims that these underlying problems first appeared in the fix wave.

> **Fixed (2026-09-15 evening, second reader).** All five findings are fixed on `feat/twp` `2fcf501..926dc6d`, each with its counterexample as a regression test, and live-verified on both simulators. Per finding: **R-01** `f3c93fc` — the frame → command mapping is resolved from the machine's own remaps (`kins_mode_commands` scrapes `#<kinstype> = N` from each REMAP'd .ngc through SUBROUTINE_PATH) and the raw ↔ semantic half from the family (`raw_kins_for_semantic`, the tested inverse of `semantic_kins`, checked against 2.9.4 `xyzac-trt-kins.c` switchkinsSetup); the pin is read back after the MDI and a disagreement is an error; client-side `semanticKinsMode` gives the radios, the mode chips, the touch-off label and the end-of-program kins warning the FRAME instead of the raw number. **R-02** `2fcf501` — the expect check moved to the write boundary and re-derives its fields from the controller (STAT poll + reader pin), re-running the route rule so a request without an expectation is still refused when the route changed; the write names its fixture (`G10 L20 P<n>`, verified against `interp_convert.cc convert_setup` to be the identical write when that row is active) and a readback from a different row is no longer adopted. **R-03** `72ceeb1` — every pair's certificate is invalidated at every break, not just the tool's. **R-04** `959e097` — the pre-prescreen passes yield every 65536 vertices and the per-vertex kins model resolves once per (type, frame, TLO) context: first checkpoint 397 ms → 17 ms at a million points, whole initialization 608 ms → 256 ms. **R-05** `84024bf` — while disabled with a reason the wrapper is a focusable help affordance (Enter/Space → the message center), the control itself still disabled. One proposal was NOT implemented and says so in its commit: R-02's interpreter-side o-sub guard, because `handle_command` holds `_cmd_lock` for the whole dispatch and no shipped config declares a `[HALUI]MDI_COMMAND`, so the explicit `P` covers the only writer left in that window. Live: `scripts/twp_adverse_check.py` (new) 14/14 — Plane → Zero under G91 and under G20, the never-lower case, a retract past the Z soft limit refusing before the X/Y leg, an abort mid-Z leg leaving X/Y untouched with plane/fixture/kinematics intact and recoverable, and an unreachable plane (`q121 i0 j120`) refusing with the plane still DEFINED, kinematics demoted to identity and no rotary motion; plus buttons 40/4, reorient/capture/plane touch-off ALL PASS, preview_gate CLEAN, sim_parity 21/21, perf_matrix clean over two runs. R-01's other half needed the TCP trunnion simulator: there Machine now sends M429 → switchkins-type 0 and TCP sends M428 → type 1, both twice, with Plane refused — the reversal the review reported. Offline: 801 vitest, the gateway suite, 20 Playwright, strict build, lint. Full record: `docs/decisions.md` "2026-09-15 evening".

> **Reply (2026-09-15, second reader, after the implementation review):** all five findings reproduce on this host with the supplied probes, run against the worktree at `584083b` (gateway venv; esbuild bundle at low priority into the session scratchpad): R-01 in both directions (`M428` → raw 1, `M429` → raw 0 on the shipped TRT remaps); R-02 `ok: true, index: 2` with `G10 L20 P0 X1.500000` recorded while the expectation said G54; R-03 combined sweep 0 hits against 1 tool/vise contact on the suffix alone, `truncated` and `uncertified` both null; R-04 first checkpoint 68/44 ms at 100 k and 396/357 ms at 1 M points (`nice -n 19`, same Node, this VM — below the review's numbers, same class). The hold at `584083b` is right: R-01, R-02 and R-03 are correctness defects, and each has a small, unit-testable fix. R-01 and R-03 predate the fix waves — the mode table was `_KINS_MODE_MDI = {0: M428, 1: M429, 2: M430}` in `App.vue` at `1aa0730` and the wave moved it server-side unchanged; the `brk`/`ustart` union and the carried certificates both shipped before the first review — while R-02 is a gap in the new U-03 code. Proposed order: R-02 and R-03 (each a contained change with the probe as its regression), R-01 (gateway + client + a restart onto the TCP simulator for its live half), then R-04 and R-05 (client only), then the adverse-path simulator exercises listed at the end. Per-finding replies below; the maintainer decides whether this becomes a fifth wave.

<a id="r-01"></a>
**R-01 — Resolve the command as well as the mode by machine configuration.**

The new typed handler unconditionally maps mode 0 to M428 and mode 1 to M429 at [gateway.py:3617](/home/cnc/twp-checkout/lcnc-gateway/gateway.py:3617). That is correct for the TWP remaps. The shipped TCP trunnion uses the opposite convention: [428remap.ngc:11](/home/cnc/twp-checkout/examples/sim_config/remap_subs/428remap.ngc:11) selects raw 1, TCP; [429remap.ngc:6](/home/cnc/twp-checkout/examples/sim_config/remap_subs/429remap.ngc:6) selects raw 0, identity. Its INI explicitly declares `identityfirst`.

The offline dispatch probe reproduces both directions:

| Operator selects | Handler sends | Shipped TRT result |
|---|---|---|
| Machine, mode 0 | M428 | Raw 1: TCP |
| TCP, mode 1 | M429 | Raw 0: Machine |

The operator cannot reliably select the intended working frame. Backend G53 admission now understands the family, but that does not repair the selector or its recovery instructions. The new browser test uses a TRT declaration to check that Plane/Capture disappear; it never exercises either remaining selector command.

Also carry semantic mode mapping into the selected radio and frame labels for configurations without `identityfirst`; [JogStrip.vue:467](/home/cnc/twp-checkout/lcnc-webui/src/JogStrip.vue:467) still binds Machine/TCP directly to raw 0/1.

- [ ] Resolve supported frame → configured command and raw readback → displayed frame together. Correct the corresponding M428 recovery messages.
- [ ] Exercise both selections against the shipped trsrn and TRT remaps, asserting the resulting semantic mode. Cover supported TRT mappings with/without `identityfirst`, or explicitly refuse unsupported mappings.

> **Reply (R-01): agree, P1.** Verified: `lcnc_suite_sim_5axis_tcp.ini` declares `xyzac-trt-kins sparm=identityfirst` and remaps `M428 → 428remap` (`#<kinstype> = 1`, TCP) and `M429 → 429remap` (`#<kinstype> = 0`, identity); the TWP fork's files set the opposite (`428remap` → 0, `429remap` → 1). The gateway has no REMAP awareness at all — nothing reads `[RS274NGC] REMAP` — so the typed handler's table is a family guess that fits one family. Fix shape: resolve the command from the configuration. Read `[RS274NGC] REMAP=M4xx … ngc=<name>` from the INI, locate the file on `SUBROUTINE_PATH` (the `GET /subfile` resolver already does this), scrape its `#<kinstype> = N` assignment, map raw N → semantic through the same family rule `semantic_kins` uses (trsrn raw; trt via `identity_first`), and hand the handler `{identity: "M429", tcp: "M428"}` for the TRT. A semantic mode with no scraped command refuses loudly ("no remap on this machine switches to TCP") — never a default. The scrape is checked against ground truth at execution: after the MDI the handler waits, bounded, for the reader's `kins_type` to read the expected raw type (the datum-settle pattern) and returns an error naming the pin value if it does not. Display side: the JogStrip radio binds to a client-derived semantic mode (`worldModeForSpec` in `viewer/kins.ts` already encodes the family; trsrn passes raw through), so a TRT without `identityfirst` shows Machine/TCP correctly; the recovery texts that hardcode M428 (`command_policy.py` ×5, `ThreeViewer.vue:226`, `twpPose.ts:215`, the JogStrip titles, the App.vue M2 hint) say "the Machine frame" and let the typed command own the number. Tests: the scraper against both shipped remap sets under `examples/` (the probe's assertion, as a test); mapping cases with and without `identityfirst`; a dispatch test that the TRT declaration sends `M429` for Machine and `M428` for TCP and refuses a missing remap; the readback-mismatch path. Live: the TWP simulator cannot exercise the TRT remaps — this needs one restart onto `lcnc_suite_sim_5axis_tcp.ini` with the buttons check asserting `motion.switchkins-type` after each radio, then the TWP run re-certifies the trsrn side. Considered and rejected: an explicit `[DISPLAY] WEBUI_KINS_MODES` declaration — a second thing to keep in sync, while the remap file is the truth and the readback guards the scrape.

> **Fixed (R-01):** `f3c93fc`. Tests: `TestRawKinsForSemantic` (6, incl. a round-trip against `semantic_kins` over every family), `TestKinsModeCommands` (5), `TestShippedRemapsDeclareTheirKinsTypes` (2 — the scrape against the real files), six dispatch tests whose command maps are READ from the shipped remap subs rather than restated, `semanticKinsMode` (6), and a browser test that a trt without `identityfirst` shows the frame the pin means and emits frames. Live on `lcnc_suite_sim_5axis_tcp`: Machine → M429 → type 0, TCP → M428 → type 1, twice each; Plane refused. The recovery texts that hardcoded M428 now name the frame.

<a id="r-02"></a>
**R-02 — Verify the touch-off target at the controller write boundary.**

The request's `expect` is checked against `_shared_status` at [gateway.py:4439](/home/cnc/twp-checkout/lcnc-gateway/gateway.py:4439). After awaiting the mode change, the handler polls STAT, reads the actual active fixture, and sends `G10 L20 P0` without comparing that fixture with `expect` again at [gateway.py:4490](/home/cnc/twp-checkout/lcnc-gateway/gateway.py:4490).

In the fake-controller probe, the keypad expectation and last status snapshot both say G54, while STAT has already reached G55. The handler observes G55 and nevertheless returns `ok: true, index: 2`, recording `G10 L20 P0 X1.500000`. The intended G54 touch-off therefore targets G55. No contrived concurrent coroutine is needed: one stale published status snapshot is sufficient. A change during the awaited mode switch creates the same window.

The new test only checks cases where the expected target already differs from `_shared_status`. The UI's cancellation watcher cannot protect a change it has not received yet.

- [ ] Validate the captured target against fresh controller state at execution, including the kinematics route. Prevent a mode/fixture change between validation and the write through an appropriate command/interpreter guard; checking another cached snapshot alone is insufficient.
- [ ] Avoid an unguarded `P0` write after accepting a specific expected fixture. Use an explicit target with the correct coordinate semantics, or refuse if the active target changed.
- [ ] Add regressions for stale published status and for a fixture/mode change during `await set_mode`; require refusal with no datum-writing MDI.

> **Reply (R-02): agree, P1, and the diagnosis is exact.** `_live_policy_state` builds from `_shared_status`, the last PUBLISHED snapshot, and after `await set_mode` the handler polls STAT for the fixture index only to report it. Fix shape, three parts. (1) The `expect` check moves to the write boundary: after `set_mode`, compare `expect` with a fresh `STAT.poll()` fixture index and a fresh `_reader_get("kins_type")`, not the published snapshot, and refuse on any difference. (2) The datum write names its target: `G10 L20 P<expect.g5x_index>` — L20 sets system n from the current position whether or not n is active, so a fixture flip after the check can no longer redirect the write; if the active index differs after the write, the offset readback into `_wcs_cache` is skipped instead of copying the wrong row. (3) The kinematics window between the check and the write — another client's `set_kins_mode` queued in between — is closed inside the interpreter on switchable configurations: the MDI becomes `o<webui_touchoff> call [P] [expected raw kins] [mask] [x] [y] [z]`, an o-sub shipped in both `remap_subs` directories that aborts when `#<_hal[motion.switchkins-type]>` (HAL_PIN_VARS=1 is already required by the remaps) differs from the expectation and otherwise issues the `G10 L20 Pn` words; an MDI o-call runs to completion before task takes the next MDI line, so nothing interleaves between the guard and the write. Non-switchable machines have no kinematics window and keep the direct `G10 L20 Pn`. The plane route is unaffected — `o<twp_touchoff>` runs under the plane's own guards. Regressions: the probe's stale-snapshot case (refuse, no MDI); a fixture flip and a kins flip injected into `set_mode` (refuse, no MDI); the explicit `Pn` on the recorded line; the sub's contract in `test_ngc_fixtures.py` (guard precedes any `G10`); the `expect`-absent path unchanged.

> **Fixed (R-02):** `2fcf501`. The probe's scenario now refuses with no MDI recorded. Tests: `TestTouchoffExpectCheck` (6) plus five dispatch tests — stale published fixture, stale published kins, a route change with no expectation carried, the explicit `P<n>` on the recorded line, and a fixture that changes across the write (the readback is not adopted). The o-sub guard was deliberately not added; the reason is in the commit and in the fix note above.

<a id="r-03"></a>
**R-03 — Discard clearance across unknown motion, not only tool/TLO changes.**

The new invalidation at [collision.ts:1603](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1603) assumes `brk` vertices are stationary relabels. However, [scrubTrack.ts:220](/home/cnc/twp-checkout/lcnc-webui/src/viewer/scrubTrack.ts:220) combines relabel and `ustart` flags into `brk`, and [ThreeViewer.vue:2490](/home/cnc/twp-checkout/lcnc-webui/src/ThreeViewer.vue:2490) forwards only that combined channel to the collision worker. The parser explicitly describes unknown starts as endpoints reached through an unknown path, including post-M6/G43 cases at [gcode_parse_worker.py:767](/home/cnc/twp-checkout/lcnc-gateway/gcode_parse_worker.py:767).

The gap gets zero distance and is skipped. Clearance measured before it survives unless the subsequent tool/TLO value changes. That clearance says nothing about the new physical position.

The companion probe uses the actual stream merger, the same small tool/vise fixture as the earlier review, and this X trajectory:

```text
20 → 19    [unknown connection]    5 → 0
```

The merged track has `brk = [0, 0, 1, 0]`. The combined sweep reports **zero hits**, `truncated: null`, `uncertified: null`. Independently sweeping the known suffix `5 → 0` reports **one tool/vise contact**. This is a missed collision in motion the checker does claim to sweep; it is not a request to reconstruct the unknown connection.

- [ ] Preserve the distinction between stationary relabel and unknown-start motion through the collision request, or conservatively invalidate at every break.
- [ ] At an unknown-start endpoint, re-establish affected clearance/contact state before sweeping the next known segment. Include non-tool pairs when their relative pose can have changed.
- [ ] Add the supplied gap/suffix comparison, same-tool re-entry and a non-tool-body case to the regression suite. Retain the successful tool/TLO-boundary and interleaving tests.

> **Reply (R-03): agree, P1 — the second discontinuity class the TWP-06 reply missed.** Confirmed in code: `scrubTrack.ts:220` ORs `ustart` into `brk`, the worker request forwards only `brk`, and in the segment loop the zero-length break segment hits `if (L <= 1e-9) continue` BEFORE the tool/TLO boundary block, so no invalidation could run there even if one existed. Fix shape: invalidate at every break, conservatively and for every non-skipped pair, not only tool pairs — after an unknown gap any relative pose can have changed (an M6 sequence moves the table, not just the spindle). A `pendingBreak` flag is set when `track.brk[i]` is seen before the `continue` and honored at the next non-zero segment by zeroing `clear[]` for all pairs; the chunk-start block then re-queries at that segment's start, the mechanism TWP-06 already uses. In-contact pairs re-verify through the `d > 2·margin` rule; a stock contact re-established after the gap is classified by the segment it appears in — a rapid there reports, the honest answer when the gap is unknown. Relabel breaks pay the same single re-query; they number a handful per program, so the request format need not change and `ustart` stays merged. Tests: the probe's gap/suffix comparison as an equality of hit sets; same-tool re-entry (contact, leave, gap, contact); a non-tool pair across a rotary DOF that moves during the gap; the TWP-06/07 suites retained. No wire or schema change.

> **Fixed (R-03):** `72ceeb1`. The probe's combined sweep now reports the same hit as the suffix swept alone. Tests: the supplied gap/suffix comparison built through the real stream merger, a non-tool pair across the gap (both fail at the previous commit), same-tool re-entry, and a relabel-break guard that the findings are unchanged. The motion INSIDE the gap is still not swept, because it is not known — that is the entry move's domain, and the commit says so.

<a id="r-04"></a>
**R-04 — Add checkpoints before the expensive per-vertex model-selection pass finishes.**

The added checkpoints begin inside the joint-range scan at [collision.ts:1055](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1055). The distance array construction and full `modeWorld`/`vertModel` passes still finish first. In particular, [collision.ts:851](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:851) resolves a kinematics model for every vertex before any yield.

The new initialization test uses a simple track without per-vertex TWP modes. I measured the first `next()` with actual trsrn mode-2 model selection, one frame, and just two cheap bodies:

| Points | First run | Second run |
|---|---:|---:|
| 100,000 | 113 ms | 73 ms |
| 1,000,000 | 656 ms | 563 ms |

Method: Node `v22.23.2`, aarch64 review environment, `nice -n 19`; track and collision-model construction excluded from timing. Each run aborts at the first checkpoint, and that abort completes. These are synthetic scheduling observations, not browser FPS or target-machine acceptance measurements. They nevertheless show that a pause/cancel request cannot be serviced during a substantial part of setup. This delay cannot be attributed to the machine-STL BVH build, which is outside the measured interval.

- [ ] Chunk or cache the earlier per-vertex phases as well, preferably resolving repeated frame/TLO contexts once instead of repeating lookup/key construction at every vertex.
- [ ] Measure cold and warm first acknowledgement with a representative TWP track. Retain separate browser interaction measurements; the headless gateway performance matrix does not establish worker or camera latency.
- [ ] Keep TWP-11/M-06 open until the remaining measured limit is fixed or explicitly accepted.

> **Reply (R-04): agree, P2, and worth fixing rather than accepting.** Reproduced at 396/357 ms for 1 M points here. Two contributions run before the first yield: the `dcum` / `modeWorld` / `vertModel` array passes, and inside the last of them one `kinsForSegment` call per vertex that builds a memo-key string for `_trsrnFor` every time — memoized construction, unmemoized lookup. Fix shape: resolve the model once per distinct (raw type, frame index, TLO event index) — an integer-keyed table, since frames and TLO events are short lists — so the per-vertex pass is an array lookup; and put `yield 0` checkpoints every 64 k vertices in the three pre-prescreen loops (they already run inside the generator; an abort there folds into `abortedEarly`, nothing has been posed). Measure with the review's `--timing` probe before and after, cold and warm, and record in `docs/decisions.md`. Agreed that the headless perf matrix says nothing about worker acknowledgement or camera latency: the browser measurement with the big TWP program (time to first progress, pause acknowledgement during a camera drag) stays on the live list for M-06.

> **Fixed (R-04):** `959e097`, measured before and after on this host with a companion probe (`twp-implementation-review-2026-09-15.fix-probes.ts`): first checkpoint 65 → 18 ms at 100 k and 397 → 17 ms at 1 M points; through initialization 83 → 67 ms and 608 → 256 ms. The remaining ~250 ms is the prescreen's own joint-range scan, interruptible throughout. The regression test counts frame-table reads before the first checkpoint (200,000 then, ≤64 now). The browser-side measurement stays owed for M-06.

<a id="r-05"></a>
**R-05 — Make the new refusal explanation reachable by keyboard.**

The wrapper at [MachineBtn.vue:162](/home/cnc/twp-checkout/lcnc-webui/src/MachineBtn.vue:162) is a plain `span` with a title and click handler. Its child is disabled. Neither provides a keyboard focus/activation path to `explain()`. Mouse and touch users can now obtain the reason, but a keyboard user tabs past the control and its explanation. The added browser test exercises `tip.click()` only.

- [ ] Provide a focusable help affordance with a clear accessible name and Enter/Space activation, or an adjacent accessible reason. Preserve the disabled machine action.
- [ ] Verify obtaining the refusal and recovery instruction with the keyboard, without sending a machine command.

> **Reply (R-05): agree.** The wrapper is a plain `span`; a keyboard user never reaches it. Fix shape: while wrapped (disabled with a reason) the wrapper becomes the focusable help affordance — `tabindex="0"`, `role="button"`, an accessible name of the form "Why is this unavailable? <reason>", Enter and Space calling the same `explain()` that pushes the reason to the message center, and a visible ring by generalizing the existing `.helpIcon:focus-visible` rule to `.btnTip:focus-visible` (no new style). The inner `<button disabled>` and the fieldset cascade stay exactly as they are — the default-deny path is untouched — and the wrapper exists only while the control is disabled with a reason, so the tab order of an enabled strip does not change. The two disabled radio labels that explain on click (Plane, reserved fixtures) get the same treatment. Trade-off stated: while disarmed every control is disabled, so every control becomes a tab stop carrying its reason; accepted, since one per-strip "why?" would lose the per-control message. Test: Playwright tabs to the wrapper, presses Enter, asserts the message-center text and that the mock gateway recorded no command.

> **Fixed (R-05):** `84024bf`. Test: focus the wrapper, Enter → the reason in the message center; focus, Space → a second message; the mock gateway recorded no command either time. The same treatment for the two disabled radio labels. Noted in passing: Escape is the E-Stop shortcut and fires from anywhere by design, so the specs no longer use it to dismiss anything.

**Disposition of the earlier findings.** “Addressed” here concerns the reviewed code and offline evidence; it does not certify physical-machine acceptance.

| Earlier item | Current assessment |
|---|---|
| TWP-01 | Dedicated M73/G90 routine and explicit machine-unit selection address the generated-command defect. The adverse modal/abort checks below remain outstanding evidence. |
| TWP-02 | Physical A/B/C targets now use G53; structural tests and recorded simulator evidence support the change. |
| TWP-03 | Checked fallback rejects the original illegal target; direction/limit tests pass. Full no-solution orient/abort state still needs its stated integration evidence. |
| TWP-04 | Full A/B/C stamp, wrap-aware readback comparison and backend Plane/Zero admission address the original defect. Recorded reorient tests cover the new stamps. |
| TWP-05 | 32-bit indices and ordered event resolution are implemented through the consumers; regression tests pass. |
| TWP-06 | Original diameter/TLO counterexamples are fixed. The remaining discontinuity case R-03 prevents full closure of collision validity. |
| TWP-07 | Model-owned base tool, geometry-identity installation and checkpoint relocation address both the original interleaving case and the subsequent restoration counterexample. Tests pass. |
| TWP-08a / 08b | Ordinary three-axis G59–G59.3 is repaired. TWP capability gating is improved; mode-selection behavior remains incomplete under R-01. |
| TWP-09 | Applied compensation is compared with its captured context; unit tests pass and the branch records a successful live no-loop check. |
| TWP-10 | Bare G28/G30 reach the source scan; unit tests and the recorded live boundary check support closure. |
| TWP-11 | Prescreen checkpoints help, but R-04 shows substantial earlier work still runs without a checkpoint. |
| TWP-12 | Entry/base lengths and conservative-prefix semantics now preserve incomplete coverage. The rescaling tests pass. |
| U-03 / U-06 | Keypad labels/cancellation and pointer-accessible reasons improve the workflow. R-02/R-05 remain; the operator walk-through is still owed. |

**Verification and remaining acceptance evidence.**

| Check performed at the pinned revision | Result |
|---|---|
| Frontend unit suite, one worker | 54 files, 788 tests passed |
| Gateway suite with fake LinuxCNC | 840 tests and 11 subtests passed; standard exclusion of `test_viewer_init.py` |
| Production build | Passed: `vue-tsc -b` and Vite |
| ESLint / scoped-CSS audit | Passed |
| Playwright, isolated mock servers, no server reuse | 19 tests passed |
| Additional offline probes | Reproduced R-01, R-02, R-03 and measured R-04 |
| R-05 | Component/DOM-contract inspection; keyboard acceptance is not covered by the existing pointer test |
| Live simulator / physical machine | Not run by this review |

Tests/build ran from an archive under `/tmp`; existing dependencies were reused with writable caches isolated. An initial build attempt encountered a read-only dependency-cache link; correcting the isolated cache layout produced the passing build above. No source change was needed. The CSS audit read the unchanged feature worktree because its script requires Git metadata.

The [recorded live-gate report](/home/cnc/twp-checkout/docs/decisions.md:5162) is useful evidence. It does not close every acceptance condition: `twp_buttons_check.py` does not deliberately establish G91/G20, and the report explicitly says abort-between-legs and a true no-solution orient were not forced live. A motion sequence interrupted by abort is not atomic; observing its remaining modal/frame/fixture state is precisely the missing check.

- [x] Update the current merge-gate checklist: M-03 is reopened for R-03, M-04 for R-01, and M-06 for R-04. M-05 remains open for R-02/R-05 and the operator walk-through; M-01 and M-07 retain the outstanding evidence requirements.
- [ ] Add the counterexamples as regression tests, fix them, and rerun affected tests plus the final-candidate gates.
- [ ] Exercise Plane → Zero from G90/G91 and G20/G21, retract refusal and abort between legs in an isolated simulator; record final position and remaining modal state.
- [ ] Exercise an actual impossible orient and record the surviving plane definition, selected fixture, kinematics and alignment state.
- [ ] Complete the desktop/simulated-touch workflow check. Real-machine and actual-touchscreen acceptance remain the separate main-promotion gate.

M-01 has its code fixes but still lacks the stated adverse-path evidence. M-07 has a green automated baseline at this revision; it cannot be treated as final acceptance while those exercises and M-05 remain outstanding.

> **Done (acceptance evidence):** `scripts/twp_adverse_check.py`, 14 pass / 0 fail, committed with the wave (`926dc6d`) so the exercises are repeatable rather than a one-off transcript. It covers every bullet above except the operator walk-through: G91 and G20 callers, the never-lower case, the retract refusal, the abort between legs (with the surviving modal state RECORDED — an aborted o-sub never reaches M73's restore, which is inherent to G-code and true of `probe_basic/go_to_zero` too), and a genuinely unreachable orient with the surviving plane, fixture, kinematics and rotary positions. Two findings in the first run were the harness, not the product, and are fixed in the script: plane-frame moves must not use G53 (under TOOL kins G53 addresses the plane), and the plane pins need a settle before comparison (the 20 Hz passthrough — the same early-snapshot class as 62e8cae).

> **Reply (acceptance evidence): agree on every item.** The simulator exercises are cheap and the TWP suite is still up: `twp_buttons_check.py` gains preamble variants (MDI `G91`, MDI `G20`) around Plane → Zero and asserts the final position plus `#5220`, G90 and G21 afterwards; abort between legs via MDI `o<twp_goto_zero> call [200] [1]` from far below with an abort during the Z leg, asserting no X/Y motion and the modal state; a retract refusal (clearance past the Z soft limit — the sub aborts before X/Y, position unchanged); an impossible orient (`G68.2` with a normal that needs C beyond `[AXIS_C]`), asserting kins 0, `twp-status` 1 and unchanged plane pins. R-01's live half needs the TCP simulator, a separate restart. The desktop/simulated-touch walk-through remains the operator's. One framing note carried from the first round: R-02 is a correctness defect and belongs with M-01–M-04 regardless of its U-03 label; R-05 belongs to the U-06 scope the maintainer chose, so it sits inside the development-merge bar here.

**Reproduction artifacts.**

- [Fake-controller dispatch probes](twp-implementation-review-2026-09-15.probes.py): reversed TRT commands and stale touch-off target. Gateway startup diagnostics may accompany the JSON observations.
- [Geometry and initialization probes](twp-implementation-review-2026-09-15.probes.ts): unknown-start gap and optional TWP initialization timing.

From the workspace containing this report, with `TWP_ROOT` pointing to the reviewed or an isolated checkout:

```bash
TWP_ROOT=/home/cnc/twp-checkout
TWP_APP="$TWP_ROOT/lcnc-webui"
"$TWP_ROOT/lcnc-gateway/.venv/bin/python" \
  docs/reviews/twp-implementation-review-2026-09-15.probes.py "$TWP_ROOT"
"$TWP_APP/node_modules/.bin/esbuild" \
  docs/reviews/twp-implementation-review-2026-09-15.probes.ts \
  --bundle --platform=node --format=cjs \
  --alias:reviewed-ui="$TWP_APP/src" \
  --alias:three="$TWP_APP/node_modules/three" \
  --outfile=/tmp/twp-implementation-review-probes.cjs
node /tmp/twp-implementation-review-probes.cjs
node /tmp/twp-implementation-review-probes.cjs --timing
```

The probes print observations rather than asserting current defects as desired behavior. Timing varies with the execution environment. After a fix, the commanded semantic modes should match the request, the mismatched touch-off should refuse, and the full/suffix collision findings should agree.

---

<a id="gate-snapshot-2026-09-15"></a>
**Historical gate snapshot at `584083b` (15 September).** Earlier live results below are branch-recorded evidence; the latest review independently ran the offline checks described in the addendum.

- [ ] M-01 — **Code fixes present; acceptance evidence incomplete.** Earlier recorded evidence: fixed 6840f77 (01) a6058f8 (02) 684c510 (03) 88809f2 (04); LIVE 2026-09-15 on lcnc_suite_sim_twp: twp_buttons_check 40 pass/4 skip (Plane→Zero retract, A returns to stamp), twp_reorient/capture/plane-touchoff ALL PASS incl. B/C pose stamp (62e8cae harness settle). TWP-03 no-solution: covered by the pure-solver unit grid + the reorient refusal-plumbing check. Outstanding: deliberately exercise G90/G91 and G20/G21, retract refusal, abort between legs and an actual impossible orient; record the surviving modal/frame/fixture state. See the latest acceptance checklist below. **UPDATE 2026-09-15 evening: the adverse-path evidence is now recorded** — `scripts/twp_adverse_check.py` 14/14 on lcnc_suite_sim_twp (926dc6d): G91 and G20 callers, never-lower, retract refusal before the X/Y leg, abort between the legs with plane/fixture/kinematics intact and recoverable, and a genuinely unreachable orient (`q121 i0 j120`) refusing with the plane still defined, kinematics demoted to identity, rotaries unmoved.
- [x] M-02 — fixed 5a02441 (05) d626a66 (09) 52d210f (10); LIVE 2026-09-15: preview_gate check CLEAN, sim_parity 21/21 GREEN; TWP-10 bare-G30 rotary_cmd boundary PASS on the wire; TWP-09 one reparse_tlo_drift then 16 s quiet (no loop); TWP-05 client-only (32-bit index unit tests 257/1200 events)
- [ ] M-03 — **Reopened for [R-03](#r-03).** Earlier recorded evidence: fixed 785ffee (06/07) 40ef49c (12); client-only, pinned by collision.test.ts (small→large tool, interleave at every checkpoint, resident-base restore, reference sweep) + sweepMerge.test.ts; operator browser look owed at the walk-through. The successful tool/TLO and interleaving fixes do not cover clearance carried across an unknown-start gap; the supplied probe misses contact in the subsequent known segment. **UPDATE: R-03 fixed (72ceeb1)** — clearance is invalidated at EVERY break for every pair; the review's gap/suffix probe now agrees with the suffix swept alone, and both counterexamples are regression tests that fail at the previous commit.
- [ ] M-04 — **Reopened for [R-01](#r-01).** Earlier recorded evidence: fixed 9fdb21e (08a) 230a2e9 (08b); LIVE 2026-09-15: twp_buttons_check gate matrix Machine/TCP/Plane all correct; the plain-mill G59 regression pinned by the parameterized policy test. The TWP gate matrix and three-axis fixture tests do not cover executing Machine/TCP selection on the shipped TRT configuration, where the commands are reversed. **UPDATE: R-01 fixed (f3c93fc)** and live-verified on lcnc_suite_sim_5axis_tcp — Machine → M429 → switchkins-type 0, TCP → M428 → type 1, Plane refused. The command is resolved from the machine's own remaps and the pin is read back.
- [ ] M-05 — labels/keypad/reasons shipped 6e0320b (D-01/D-02) 7f7450f (U-03) 14345bb (U-06), e2e green; the operator's desktop + simulated-touch walk-through is OWED (their call). Also open: stale touch-off target protection ([R-02](#r-02)) and keyboard access to refusal explanations ([R-05](#r-05)). **UPDATE: R-02 fixed (2fcf501)** — the touch-off target is verified against the controller at the write boundary and the datum write names its fixture; **R-05 fixed (84024bf)** — the refusal explanation is keyboard-reachable. The operator's desktop + simulated-touch walk-through remains OWED (their call).
- [ ] M-06 — **Partial; [R-04](#r-04) remains open.** Earlier recorded evidence: 0bc4245 (TWP-11); LIVE 2026-09-15: perf_matrix all headless scenarios n=0 lag / 0 safety events; permission_reasons adds 160 B to a 4190 B status frame (3 closed gates only); artifact 20260915T180409Z. Target-hardware responsiveness stays a main-promotion item. The headless matrix does not establish collision-worker acknowledgement or browser interaction latency. Earlier TWP per-vertex initialization still delays the first checkpoint; fix or explicitly accept the measured limit. **UPDATE: R-04 fixed (959e097)** — first checkpoint 397 → 17 ms and whole initialization 608 → 256 ms at a million points (measured before/after on this host). Still owed: the browser-side measurement of worker acknowledgement and camera latency.
- [ ] M-07 — **Automated baseline green; final-candidate acceptance pending.** Earlier recorded evidence: candidate feat/twp 62e8cae; offline build/lint/vitest(788)/pytest/e2e(19) green; live gates GREEN 2026-09-15 (preview_gate, sim_parity 21/21, buttons 40/4, reorient/capture/plane, TWP-09/10, perf_matrix). Deferred: operator walk-through (M-05), target-hardware perf (M-06). Independent offline review at 584083b passed frontend 788 tests, gateway 840 tests plus 11 subtests, 19 mock browser tests, build and lint. Complete the remaining fixes, adverse-path simulator checks and M-05 walk-through, then record gates against the final candidate. **UPDATE: candidate is now feat/twp 926dc6d** — offline build/lint/vitest(801)/gateway pytest/e2e(20) green; live on both simulators (adverse paths 14/14, buttons 40/4, reorient/capture/plane touch-off ALL PASS, preview_gate CLEAN, sim_parity 21/21, perf_matrix clean over two runs, typed mode selection verified on trsrn AND trt). Remaining: M-05's walk-through and M-06's browser measurement.

---

<a id="implementation-review-2026-09-16"></a>
**TWP implementation review — 16 September 2026 — `926dc6d`**

**Recommendation: hold `feat/twp → development` for the keyboard regressions below.** R-01 through R-04 address the earlier counterexamples, and the branch now records the missing adverse-path simulator exercises. R-05 makes explanations reachable, but its event handling introduces an unintended Cycle Start path and breaks keyboard selection of an enabled Plane radio. These are two new functional findings, not a repetition of the earlier five.

Reviewed `584083b3a6e13569710ab453cb7362b3b9f67206` → `926dc6d528702d6df668fca5e9b9adee2aa5af9a`: six commits, 20 files. Source links in this addendum refer to `926dc6d`. Verification used an isolated source archive under `/tmp`, fake LinuxCNC, pure geometry probes and local mock browser servers. This review issued no commands to the live controller and did not rerun the branch's live simulator exercises. Production source is unchanged.

| ID | Priority | Finding | Gate |
|---|---|---|---|
| [R-06](#r-06) | P1 | Space on a refusal explanation can start the loaded program | M-05 / U-06 |
| [R-07](#r-07) | P2 | Space cannot select the enabled Plane radio | M-05 / U-01, U-09 |

> **Reply + fixed (2026-09-16, second reader):** both findings are real, both are mine, and both are fixed on `feat/twp` `ec9b662`. I reproduced them first with the supplied spec, unchanged, in this worktree: `cycle_start` recorded on the help affordance, and no `set_kins_mode` from Space on an enabled Plane radio. **R-06 is worse than reported, and older than R-05.** With any ENABLED button focused, Space already ran Cycle Start — and the button itself never fired, because the shortcut's own `preventDefault` suppressed the native activation: a probe on "Go to WCS 0" recorded one `cycle_start` and no `go_to_zero`. The help affordance did not introduce the hazard, it added a focusable element that exposed it. So the rule is fixed where it belongs, in `useKeyboardShortcuts`: Space and Enter ACTIVATE the focused control and are not shortcuts while one has focus, and an event a component already handled (`defaultPrevented`) is left alone; E-Stop is checked before both and stays global. `explainKeydown` also stops propagation, so asking for an explanation can never be a machine action — belt and braces, since the two protect different things. **R-07** is fixed by installing the Plane label's handler only while the gate is closed, as suggested; the reserved-fixture labels already guarded that way. **The browser assertion** is corrected as you describe: machine actions are denied by name and a named read-only set is allowed, so a background `get_tool_table` no longer fails the test or skips the dependent viewer test — the full suite is 26 passed, that viewer test included. One limit I am NOT changing, stated so it is a decision rather than an oversight: hold-to-fire motion buttons (→ Zero, → Home, probe, spindle) have no keyboard activation at all, because the hold is the intent; a keyboard user cannot start those moves.

<a id="r-06"></a>
**R-06 — Consume help activation before it reaches machine shortcuts.**

The new [explainKeydown at permissions.ts:245](/home/cnc/twp-checkout/lcnc-webui/src/permissions.ts:245) calls `preventDefault()` and displays the reason, but the event still bubbles to the window. The global [keyboard handler at useKeyboardShortcuts.ts:68](/home/cnc/twp-checkout/lcnc-webui/src/useKeyboardShortcuts.ts:68) neither checks `defaultPrevented` nor treats a focused `span[role=button]`/label as an input. Space is the default Cycle Start/Pause/Resume key, with command shortcuts enabled by default.

Reproduced in Chromium against the mock gateway:

1. Publish a loaded program, `ready: true`, `goZero: false` and its refusal reason.
2. Focus the new help wrapper around the disabled “Go to WCS 0” button.
3. Press Space to obtain the explanation.
4. The explanation appears **and the mock records `{"cmd":"cycle_start"}`**.

The disabled action remains disabled, but a different machine action is sent. The same event reaches the pause/resume branches when those permissions are active. Those branches are source-confirmed; the additional browser probe exercised Cycle Start. Reserved-fixture and disabled-Plane explanations share this helper and need the same protection.

The shipped keyboard test has no loaded program and grants neither pause nor resume. Consequently, it cannot detect this interaction even when it passes.

- [ ] Consume handled help keys, for example by stopping propagation, and/or make ordinary global shortcuts honor already-handled events. Preserve the deliberately global E-stop behavior.
- [ ] Test Space with a loaded program and with paused/running states; obtaining an explanation must send no start, resume, pause or jog command. Cover the button wrapper and radio-label explanations.
- [ ] Include Enter when it is configured as a machine shortcut, and retain ordinary shortcut operation away from controls.

> **Fixed (R-06):** `ec9b662`. Tests: `asking why never starts, pauses or resumes a program` — the loaded-program, paused and running states you named, with both Space and Enter, asserting no machine action each time; `Space on a focused control never reaches the Cycle Start shortcut`, which also pins that ordinary activation still works; and a unit test that `explainKeydown` consumes the key (`preventDefault` + `stopPropagation`) for Enter/Space and ignores every other key, so shortcuts away from controls are untouched. All fail against the pre-fix build. Your probe passes unchanged.

<a id="r-07"></a>
**R-07 — Install the Plane explanation handler only while the radio is unavailable.**

At [JogStrip.vue:475](/home/cnc/twp-checkout/lcnc-webui/src/JogStrip.vue:475), the label's `keydown` handler calls `explainKeydown()` unconditionally. Although `tabindex` and `role` disappear when Plane becomes available, the listener remains. Space from the focused, enabled child radio bubbles into it and is default-prevented. `explainPlane()` then does nothing because the gate is open, leaving both the selection and command unchanged.

The browser probe starts in Machine mode with Plane enabled: focus Plane, press Space → **no `set_kins_mode` command**. Clicking the same radio immediately afterward sends **mode 2**. Machine/TCP retain their ordinary radio behavior; Plane is the inconsistent one.

- [ ] Call the help handler only when `!can.planeFrame`, or give the explanation its own focusable element. Allow native radio activation when enabled.
- [ ] Keep a regression for keyboard selection of an enabled Plane radio as well as keyboard explanation of a disabled one. The two paths must remain distinct.

> **Fixed (R-07):** `ec9b662`. The handler is installed only when `!can.planeFrame`. Test: `Space selects an ENABLED Plane radio; the explanation is only for the disabled one` — Space sends mode 2 while enabled, and explains with no command once the gate closes, so the two paths stay distinct. Fails against the pre-fix build.

**Disposition of the previous implementation findings.**

| Earlier finding | Assessment at `926dc6d` |
|---|---|
| R-01 — mode mapping | Addressed for the shipped TWP and TRT configurations. Semantic/raw conversion and remap-derived commands now agree; missing mappings refuse, available readback is checked, and the UI displays semantic modes. Dispatch tests exercise the actual shipped remap sources. The branch also records live selection in both configurations. |
| R-02 — stale touch-off target | The original stale-fixture case is addressed. After the mode switch the handler polls STAT, refreshes the kinematics reading, checks expectation and route again, and names the fixture in `G10 L20 P<n>`. Dispatch tests cover controller/snapshot disagreement, route changes and avoiding adoption of a different fixture's readback. |
| R-03 — clearance across a gap | Addressed. Every break invalidates all affected pairs before the next known segment, including non-tool pairs. Rerunning the original stream-merger probe gives one contact both for the complete track and for its independently swept suffix. The added same-tool/non-tool tests also pass. |
| R-04 — initialization checkpoints | The reported uninterruptible per-vertex passes are addressed: distance and model-selection loops yield, and model lookup is reused by context. The original timing probe reaches the first checkpoint in 18 ms / less than 1 ms at 100,000 points and 10 ms / less than 1 ms at 1,000,000 points; abort completes at each checkpoint. These rounded Node timings establish improvement, not browser interaction acceptance. |
| R-05 — keyboard explanations | Focus and Enter/Space access are implemented. Full closure is blocked by R-06/R-07; merely reaching the explanation is insufficient when doing so can also issue a machine command. |

Timing environment: Node `v22.23.2`, aarch64, `nice -n 19`; the prior probe's cheap bodies and actual TWP model selection, with track/model construction outside the measured interval. Cold/warm observations are sensitive to JIT state and scheduling. No end-to-end worker round-trip or camera latency is inferred from them.

**Adverse-path and merge-gate assessment.** The [new recorded live evidence](/home/cnc/twp-checkout/docs/decisions.md:5203) credits `84024bf` with 14 passing adverse checks, the existing TWP button/reorient/capture/touch-off checks, preview and 21/21 parity checks, plus mode selection on the shipped TRT. The only later commit in this reviewed range records those results. Inspection of [twp_adverse_check.py](/home/cnc/twp-checkout/scripts/twp_adverse_check.py:1) shows explicit G91 and G20 callers, a never-lower case, retract refusal, abort during the Z leg, surviving state and recovery, and an unreachable orientation. This supplies the previously missing M-01 evidence; it is credited as the implementer's run.

M-02 remains closed for the original findings. M-03 and M-04 can close on the corrected collision and configuration cases. M-05 stays open for R-06/R-07 and the desktop/simulated-touch workflow check. R-04 no longer blocks M-06, but representative browser responsiveness remains unmeasured. M-07 needs a clean final-candidate run after the remaining fixes. Physical-machine and actual-touchscreen acceptance remain the separate main-promotion gate.

**Independent validation.**

| Check | Result |
|---|---|
| Frontend unit tests | 54 files, 801 tests passed |
| Gateway tests, fake LinuxCNC | 870 collected tests passed; standard exclusion of `test_viewer_init.py` |
| Production build | `vue-tsc -b` and Vite passed |
| ESLint and scoped-CSS audit | Passed |
| Existing Playwright suite | Two runs: each 19 passed, one failed, one dependent viewer test did not run |
| Additional review browser regressions | Both fail as expected at this revision: unintended `cycle_start`; missing keyboard Plane selection |
| Original geometry/timing probe | Gap/suffix findings agree; first-checkpoint delay substantially reduced |
| Live simulator / hardware | Not run by this review |

The existing browser failure is a separate test issue: [touchoff.spec.ts:238](/home/cnc/twp-checkout/lcnc-webui/e2e/touchoff.spec.ts:238) asserts that **all** recorded commands are absent, while [mock-gateway.mjs:201](/home/cnc/twp-checkout/lcnc-webui/e2e/mock-gateway.mjs:201) records read-only requests too. Both runs received `get_tool_table` during that assertion. This does not demonstrate machine motion, and removing that test noise does not resolve R-06. Assert the absence of machine actions while allowing expected background reads, then add the loaded-program case above. The branch's earlier browser result does not supersede these two reproduced failures.

Tests/build used the archive `/tmp/twp-review-20260916-trmzehqm` with writable dependency caches isolated. The CSS audit read the unchanged feature worktree for Git metadata. Python asyncio tests and mock browser servers required local socket access outside the restricted sandbox; those runs still used fake LinuxCNC and mock endpoints.

**Follow-up before merge.**

- [ ] Fix R-06 before enabling the new help activation in a merge candidate.
- [ ] Fix R-07 and retain both enabled-selection and disabled-explanation keyboard coverage.
- [ ] Correct the browser assertion's treatment of background reads; rerun the complete suite, including the currently skipped dependent viewer test.

> **Fixed (the browser assertion):** `ec9b662`. You are right that `toEqual([])` over the raw log was the wrong assertion, and that removing the noise does not touch R-06 — it is why the run skipped the dependent viewer test, not why Space started a program. The spec now denies machine actions by name and allows a named read-only set, so it fails closed when a new command appears. Full suite: 26 passed, `serial-viewer` included. I did not commit your probe file; my regression tests cover the same two cases plus the paused/running states, Enter, and the enabled-button case, and I would rather not carry two copies of the same assertions.
- [ ] Complete the agreed desktop/simulated-touch workflow and browser responsiveness evidence; record any explicitly accepted scope or measured limit.
- [ ] Attach the final automated and simulator gate results to the resulting candidate hash.

**Reproduction artifact:** [keyboard regression probes](twp-implementation-review-2026-09-16.probes.spec.ts). These assert desired behavior and therefore fail at `926dc6d`. Copy the file as `e2e/review-20260916.spec.ts` into an isolated, built checkout's `lcnc-webui`, beside the existing `ctl.ts`, and run there:

```bash
CI=1 npm run test:e2e -- review-20260916.spec.ts --project=chromium --workers=1
```

Use the repository's mock servers with no existing-server reuse. The probe records only mock WebSocket traffic. The previous [geometry/timing probe](twp-implementation-review-2026-09-15.probes.ts) also remains usable against this revision.

---

<a id="gate-snapshot-926dc6d"></a>
**Historical gate snapshot at `926dc6d`, with implementation replies (16 September).** The [latest addendum](#implementation-review-2026-09-16) separates independently run checks from the branch's recorded simulator results. The [previous checklist](#gate-snapshot-2026-09-15) is preserved below.

- [x] M-01 — Code fixes and the previously missing adverse-path evidence are present. The branch records 14 passing checks at 84024bf for G91/G20 callers, retract refusal, abort/recovery and impossible orientation; 926dc6d adds the results record. This review inspected the harness and credits that recorded run.
- [x] M-02 — Original preview/index/compensation/boundary findings remain addressed. The current unit suites pass; the branch records CLEAN preview and GREEN 21/21 parity results.
- [x] M-03 — 72ceeb1 resolves [R-03](#r-03). The independent unknown-gap/suffix probe now finds one contact in both runs; same-tool, non-tool, tool/TLO, interleaving and coverage regression tests pass.
- [x] M-04 — f3c93fc resolves [R-01](#r-01) for the shipped TWP/TRT configurations. Semantic display/command mapping, actual-remap dispatch tests and recorded live selection in both configurations support closure; the ordinary three-axis fixture repair remains covered.
- [ ] M-05 — [R-06](#r-06), P1: help activation can send Cycle Start. [R-07](#r-07), P2: enabled Plane radio loses Space activation. The original stale-fixture touch-off is repaired by 2fcf501; the desktop/simulated-touch workflow check remains outstanding. **UPDATE 2026-09-16 evening: both fixed (ec9b662)** — Space and Enter now activate the focused control instead of reaching the global shortcut map (which also fixes the same hazard on ordinary enabled buttons, where it predates the help affordance), `explainKeydown` consumes the key, and the Plane label's handler is installed only while the gate is closed. Four regressions added, all failing against the pre-fix build; the review's own probe passes unchanged. The desktop + simulated-touch walk-through remains OWED (the operator's).
- [ ] M-06 — 959e097 addresses [R-04](#r-04): the earlier per-vertex phases now yield and reuse kinematics contexts. The independent million-point probe reaches its first checkpoint in 10 ms / less than 1 ms. Browser worker acknowledgement and control/camera interaction still need representative measurements; target-hardware acceptance stays at main promotion. **UPDATE: unchanged by this round** — browser-side responsiveness (worker acknowledgement, camera latency) is still the owed measurement, and is the operator's.
- [ ] M-07 — Current build/lint, 801 frontend tests and 870 gateway tests pass. Two existing-browser-suite runs each report 19 passed / one assertion failure / one dependent test not run; both additional keyboard regressions reproduce. Correct the product/test issues, complete the outstanding workflow/performance evidence, and record all final gates against the resulting candidate. **UPDATE: candidate is now feat/twp ec9b662** — 803 vitest, the gateway suite, build, lint, and the FULL browser suite 26 passed with no failures and nothing skipped (the background-read assertion that caused the 19+1 split is corrected). Live gates were re-run at 84024bf/926dc6d and this round changed client keyboard handling only; the remaining items are M-05's walk-through and M-06's browser measurement.

---

<a id="implementation-review-f221763"></a>
**TWP implementation review — 16 September 2026, follow-up — `f221763`**

**No new merge-blocking code findings in this change. R-06, R-07 and the browser assertion failure are resolved.** The code-review hold for those defects can be lifted. Full merge acceptance still depends on the existing M-05 operator workflow check and M-06 browser responsiveness evidence; neither was supplied by this keyboard-only fix.

Reviewed `926dc6d528702d6df668fca5e9b9adee2aa5af9a` → `f221763aa6d7216073f1d13151a531d355b2d4ae`: implementation commit `ec9b662` plus its results record. Six files changed. Gateway, remaps, parser and collision implementation are unchanged from the previous review. All source links in this addendum refer to the new revision.

**Assessment of the fixes and replies.**

| Item | Current disposition | Evidence |
|---|---|---|
| R-06 — unintended Cycle Start from help | Closed | [permissions.ts:249](/home/cnc/twp-checkout/lcnc-webui/src/permissions.ts:249) consumes help activation. The [global shortcut handler:81](/home/cnc/twp-checkout/lcnc-webui/src/useKeyboardShortcuts.ts:81) also leaves Space/Enter to focused controls and respects previously handled events. The original loaded-program probe now records only a background `get_tool_table`, with no cycle command. New committed tests cover ready, paused and running states. |
| R-07 — enabled Plane keyboard selection | Closed | [JogStrip.vue:475](/home/cnc/twp-checkout/lcnc-webui/src/JogStrip.vue:475) runs the explanation handler only while Plane is unavailable. The unchanged original probe now records mode 2 from Space. The committed test also covers returning to the disabled explanation path. |
| Browser assertion failure | Closed | The test now allows named read-only background requests and rejects other commands. It does not suppress the motion-command assertion. The complete committed browser suite passes, including the previously skipped viewer test. |
| R-05 — keyboard-accessible explanation | Closed for the reported defect | The focusable help affordance is reachable, its activation is contained, and enabled radio activation remains available. The broader operator workflow check is still outstanding. |

The reply's root-cause correction is accepted: the ordinary-button Space hazard predated R-05. Adding the help affordance exposed the existing shortcut/focus interaction. Fixing both the helper and the global handler is appropriate; a helper-only patch would have left ordinary focused buttons affected.

I also checked two cases not established by simply pressing Enter under the default shortcut mapping: **with Cycle Start explicitly remapped to Enter**, Enter on the help control only explains, while Enter away from controls still records Cycle Start; **Escape from the focused help control** still records E-stop. These were mock-gateway observations, not commands to the machine.

The documented pointer requirement for hold-to-fire buttons is consistent with their unchanged implementation: native keyboard activation does not bypass the hold. It remains a limitation to make clear during the operator walkthrough, not a new regression in this patch.

**Independent verification at `f221763`.**

| Check | Result |
|---|---|
| Frontend unit suite | 54 files, 803 tests passed |
| Production build | `vue-tsc -b` and Vite passed |
| ESLint / scoped-CSS audit / diff whitespace check | Passed |
| Complete committed Playwright suite | 24 passed; no failures or skipped dependent tests |
| Original R-06/R-07 review probes, unchanged | Both passed |
| Additional shortcut-preservation checks | Remapped Enter and global Escape checks both passed |
| Gateway / parser / geometry suites | Not repeated: their code and dependencies are unchanged; previous results remain baseline evidence |
| Live simulator / physical machine | Not exercised by this review |

The supplemental browser invocation passed 11 tests: the four review checks and seven existing Chromium-project tests selected by the path filter. These are not 11 additional distinct tests. Likewise, the committed suite has **24** tests at this hash; with the two original review probes the count is **26**, which separates repository coverage from review fixtures.

Build/tests used `/tmp/twp-review-f221763-qp_ob3ub` with isolated writable caches and existing dependencies. Browser checks used local mock servers with `CI=1` and no server reuse. The CSS audit read the feature worktree for Git metadata. The reviewed worktree remained clean; only review documentation changed in the shared workspace.

**Remaining acceptance work.** M-01 through M-04 retain their previous closure evidence. R-05 through R-07 and the browser failure no longer block M-05/M-07. The current automated frontend evidence is green; the remaining work is specific:

- [ ] M-05: complete and record the desktop/simulated-touch operator walkthrough, including the pointer-only hold actions and explanation/selection behavior.
- [ ] M-06: record representative browser worker acknowledgement and control/camera responsiveness, or an explicitly accepted measured limit. The earlier Node first-checkpoint measurements do not establish those results.
- [ ] M-07: assemble the resulting candidate's acceptance record, carrying forward the unchanged backend/simulator evidence with its original hashes and attaching the outstanding M-05/M-06 results. Rerun affected checks if subsequent fixes change the code.

Physical-machine and actual-touchscreen acceptance remain the separate main-promotion gate. This review found no additional code fix to require before that remaining acceptance work.

---

<a id="foundation-merge-9a52016"></a>
**Foundation merged — 16 September 2026 — `9a52016`**

At the user's request, `feat/twp` (`f221763`) was merged into `development`
(`bd660c2`) with merge commit `9a520165f198c09f190cce7db6caa9963b88098d`.
The scope is the technical foundation. M-05/M-06 remain explicitly open for
`feat/twp-guided-setup`, followed by its final acceptance record; physical
validation continues to gate promotion to `main`.

There were no divergent code changes: the old development tip was already an
ancestor of the feature. The final product source matches `f221763`. The only
merge differences are the tracked decision record and exclusion of an
accidentally tracked absolute `lcnc-gateway/.venv` symlink, which would conflict
with the development checkout's existing Python environment. That environment
was preserved, and its gateway dependency imports succeed.

The existing frontend installation gained the one missing lockfile dependency,
`@types/ws` 8.18.1, from the local npm cache, with install scripts disabled.
A fresh isolated production build using those development-checkout dependencies
passed. The unchanged product code retains the reviewed 803-unit-test and
24-browser-test baseline, the independent keyboard probes, and earlier backend
and simulator evidence with their original hashes. No source conflict or
product-code change required a broader test rerun.

Nine pre-existing local parity artifacts overlapped files tracked by the
feature. Their originals were preserved and hash-verified in
[the local backup manifest](../../runlogs/merge-backups/twp-20260916-bd660c2/manifest.json).
Existing review files and the downloaded source archive were preserved.

The merge was local; it did not push branches or deploy/restart the controller.
The committed scope and next-milestone requirements are recorded in
[docs/decisions.md](../decisions.md).
