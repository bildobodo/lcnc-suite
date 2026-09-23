**TWP implementation follow-up review — 15 September 2026**

**Recommendation: hold `feat/twp → development` at `584083b`.** The fix waves address most original counterexamples and add useful regression coverage. Three correctness blockers remain: reversed mode commands on the shipped TCP trunnion, touch-off accepting a stale target, and collision clearance surviving an unknown-motion gap. Initialization responsiveness and keyboard access to refusal explanations are also incomplete.

Reviewed revision: `584083b3a6e13569710ab453cb7362b3b9f67206`, compared with `1aa0730017ca022cba3271ce6c71c12b04e11027`, in `/home/cnc/twp-checkout`. The worktree remained clean. This follows the [original review](twp-review-2026-09-14.md) and [assessment of its comments](twp-review-2026-09-14.comments-response.md). Source links below refer to the current pinned revision.

This review changed only review artifacts. Verification used an isolated source archive, fake-LinuxCNC dispatch tests, pure geometry probes and mock browser servers. It did not command, restart or exercise the live LinuxCNC session. The branch's live-simulator results are credited as recorded evidence, not as runs performed by this review.

| ID | Priority | Remaining finding | Previous item / gate |
|---|---|---|---|
| [R-01](#r-01) | P1 | Machine/TCP selection sends the opposite command on the shipped TRT configuration | TWP-08b / M-04 |
| [R-02](#r-02) | P1 | Touch-off target verification can accept G54, then write to G55 | U-03 / M-05 |
| [R-03](#r-03) | P1 | Clearance carried across an unknown-start gap hides contact in subsequent known motion | TWP-06 boundary audit / M-03 |
| [R-04](#r-04) | P2 | TWP per-vertex initialization still blocks the first checkpoint for hundreds of milliseconds | TWP-11 / M-06 |
| [R-05](#r-05) | P2 | Disabled-control explanations are unavailable through keyboard focus/activation | U-06 / M-05 |

All five findings are open. R-01/R-03 are remaining cases in the reviewed implementation, not claims that these underlying problems first appeared in the fix wave.

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

<a id="r-02"></a>
**R-02 — Verify the touch-off target at the controller write boundary.**

The request's `expect` is checked against `_shared_status` at [gateway.py:4439](/home/cnc/twp-checkout/lcnc-gateway/gateway.py:4439). After awaiting the mode change, the handler polls STAT, reads the actual active fixture, and sends `G10 L20 P0` without comparing that fixture with `expect` again at [gateway.py:4490](/home/cnc/twp-checkout/lcnc-gateway/gateway.py:4490).

In the fake-controller probe, the keypad expectation and last status snapshot both say G54, while STAT has already reached G55. The handler observes G55 and nevertheless returns `ok: true, index: 2`, recording `G10 L20 P0 X1.500000`. The intended G54 touch-off therefore targets G55. No contrived concurrent coroutine is needed: one stale published status snapshot is sufficient. A change during the awaited mode switch creates the same window.

The new test only checks cases where the expected target already differs from `_shared_status`. The UI's cancellation watcher cannot protect a change it has not received yet.

- [ ] Validate the captured target against fresh controller state at execution, including the kinematics route. Prevent a mode/fixture change between validation and the write through an appropriate command/interpreter guard; checking another cached snapshot alone is insufficient.
- [ ] Avoid an unguarded `P0` write after accepting a specific expected fixture. Use an explicit target with the correct coordinate semantics, or refuse if the active target changed.
- [ ] Add regressions for stale published status and for a fixture/mode change during `await set_mode`; require refusal with no datum-writing MDI.

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

<a id="r-05"></a>
**R-05 — Make the new refusal explanation reachable by keyboard.**

The wrapper at [MachineBtn.vue:162](/home/cnc/twp-checkout/lcnc-webui/src/MachineBtn.vue:162) is a plain `span` with a title and click handler. Its child is disabled. Neither provides a keyboard focus/activation path to `explain()`. Mouse and touch users can now obtain the reason, but a keyboard user tabs past the control and its explanation. The added browser test exercises `tip.click()` only.

- [ ] Provide a focusable help affordance with a clear accessible name and Enter/Space activation, or an adjacent accessible reason. Preserve the disabled machine action.
- [ ] Verify obtaining the refusal and recovery instruction with the keyboard, without sending a machine command.

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

- [ ] Reopen M-03 for R-03, M-04 for R-01, and M-06 for R-04. Keep M-05 open for R-02/R-05 and the operator walk-through.
- [ ] Add the counterexamples as regression tests, fix them, and rerun affected tests plus the final-candidate gates.
- [ ] Exercise Plane → Zero from G90/G91 and G20/G21, retract refusal and abort between legs in an isolated simulator; record final position and remaining modal state.
- [ ] Exercise an actual impossible orient and record the surviving plane definition, selected fixture, kinematics and alignment state.
- [ ] Complete the desktop/simulated-touch workflow check. Real-machine and actual-touchscreen acceptance remain the separate main-promotion gate.

M-01 has its code fixes but still lacks the stated adverse-path evidence. M-07 has a green automated baseline at this revision; it cannot be treated as final acceptance while those exercises and M-05 remain outstanding.

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
