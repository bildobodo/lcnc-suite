**Assessment of the comments on the TWP review — 14 September 2026**

Most comments are useful and should influence the implementation plan. I agree with using smaller fixes, separating development merge from physical-machine promotion, and treating the three-axis G59 regression as a first-wave blocker. I disagree with declaring several fixes complete from their apparent size, or moving all usability and responsiveness checks past the development merge. The merge recommendation remains **hold at `1aa0730`**.

This responds to the inline comments in the [original review](twp-review-2026-09-14.md), against the unchanged revision `1aa0730017ca022cba3271ce6c71c12b04e11027`. The comments are preserved verbatim. The original checklist has been clarified to reflect the accepted points below. No production code was changed, no controller was contacted, and no finding is closed by this response.

**Merge versus promotion: accept the distinction, keep a development usability baseline.**

The saved [main-promotion decision](/home/cnc/.claude/projects/-home-cnc-lcnc-suite/memory/project_main_promotion_requires_hardware_validation.md) explicitly requires real-hardware validation before `development → main`. The later status in the [touch-work memory](/home/cnc/.claude/projects/-home-cnc-lcnc-suite/memory/project_touch_friendly_branch.md) likewise leaves real-touchscreen validation for promotion. My original M-05/M-06 wording mixed those checks with development acceptance.

Before merging into **development**, require correct actions, clear frame/datum labels, understandable refusals, protection against a touch-off target changing during editing, honest preview/collision validity, and a focused desktop/layout/input walk-through in an isolated simulator. Retain existing controls that satisfy these criteria. A wholesale touch redesign is unnecessary. A disabled button also needs an accessible explanation: checking only the denial banner is insufficient if the disabled button cannot send a request that produces that banner.

Before promotion to **main**, require the operator's real-machine and real-touchscreen validation, including target-hardware responsiveness. For development, measure representative performance against the existing baseline and address material regressions. The original 100 ms interaction / 250 ms pause figures are proposed starting points, not established project gates. Deferring physical validation does not establish that the current UI is usable or responsive.

**Disposition of the individual comments.**

| Comment | Assessment and follow-up |
|---|---|
| **TWP-01** | Accept the small modal-save/restore subroutine approach. Establish distance mode and units, and verify that the clearance argument has the same unit contract. An interpreter error should stop the sequence, but the isolated abort/retract-failure test remains required evidence; it does not require inventing a separate recovery framework. |
| **TWP-02** | Accept `G53` for the physical A target and for explicitly documented physical B/C zero targets, with identity kinematics confirmed. Retain the offset and full return-sequence tests. |
| **TWP-03** | Accept a checked alternative-angle fallback instead of mandating enumeration, provided both limits, direction modes, asymmetric ranges and multi-turn cases are covered. Keep the no-solution/abort state test. A valid solver result and a coherent remaining plane/fixture/mode state are separate obligations. |
| **TWP-04** | Accept a conservative full A/B/C stamp for the shipped trsrn configuration instead of requiring tool-axis-vector comparison now. Associate it with the current plane definition, validate successful completion against actual joint readback, handle wrap/tolerance and unknown readings, and enforce alignment in backend admission. Capturing requested angles alone does not prove the move completed. |
| **TWP-05** | Accept the client-side index migration and monotonic event scan together. `Uint16Array` is acceptable only with an explicit supported limit and overflow handling; otherwise it moves the silent failure to a larger program. Prefer `Uint32Array` with a consistent sentinel if there is no justified 65,535-event limit. Preserve ordering and all downstream consumers. |
| **TWP-06** | Accept explicit tool/TLO invalidation. The proposed reset inside `applyTool` needs more design care than described; see below. TLO changes were already included in the original recommendation and acceptance list. |
| **TWP-07** | Accept investigating a local fix; reject the claim that the proposed two edits fully close the defect. A new offline experiment demonstrates incorrect resident-tool restoration even after those edits. See below. |
| **TWP-08** | Split tracking into **08a: three-axis reserved-fixture regression, P1**, and **08b: capability/raw-mode portability, P2 unless affected controls are exposed**. Test G59–G59.3 explicitly. A `kins_switchable` guard fixes the ordinary mill regression but does not establish TWP capability: a switchable TRT is not automatically this trsrn TWP implementation. A small supported-family/capability guard and semantic mode mapping are sufficient; a general capability framework can wait. |
| **TWP-09** | Accept comparing applied compensation with the compensation captured for the accepted parse, while retaining independent tool-table invalidation. Repeated parsing wastes CPU and can consume scheduling margin on a shared controller host. This review did not demonstrate a watchdog trip caused by this defect. |
| **TWP-10** | Accept the narrow prefilter fix. Do not reduce its exposure to the debounce interval: the correct result must also finish parsing, publishing and rebuilding. The review records a 13.1 s parse workload; correction is not necessarily available within a few seconds. |
| **TWP-11** | Accept scheduling this after correctness fixes. Reject “the UI stays responsive” as an inference from running in a worker. Worker acknowledgement latency and user-visible latency are distinct measurements, but host contention connects them. Measure both. |
| **TWP-12** | Accept a small conservative coverage fix if the UI represents it accurately. `entry.truncated ?? base.truncated` alone cannot express combined coverage correctly. The current worker explicitly overrides `maxMs` with `undefined` for both runs, so a side-run time budget is not a current production trigger. See below. |

**TWP-07: the proposed two edits repair one failure, leave another.**

Each iterator captures `baseVariant` from the tool currently installed in the shared body at [collision.ts:756](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:756). A side iterator can therefore capture the main iterator's temporary program-tool geometry as its own base. Completion then restores that incorrect base at [collision.ts:1483](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1483). Checking the currently installed geometry and moving the checkpoint do not change this ownership problem.

I extended the [existing tiny offline fixture](twp-review-2026-09-14.probes.ts) and ran two copies of its previously built diagnostic bundle: the reviewed implementation, and a temporary copy with exactly the proposed geometry check and checkpoint relocation. The 100,000-point timing probe was omitted. Both use the same two-point interleaving; this was not a build or a production implementation change. The added `residentToolAfterInterleaving` observation in the companion script preserves the new counterexample for follow-up.

| Observation | Reviewed implementation | With the two proposed edits | Correct result |
|---|---:|---:|---:|
| Large-tool main sweep contacts | 0 | 1 | 1 |
| Original resident tool geometry restored after both runs | No | No | Yes |
| Contacts in a subsequent sweep using the resident fallback tool | 1 | 1 | 0 |

The subsequent fallback sweep uses the original small-tool model without event overrides; an independent fresh model reports zero contacts. This extends the existing missed-contact example with a reproducible false-contact/cleanup failure. It does not prove every production request uses that fallback, but it disproves the proposed complete mutable-state contract.

Also, the original two-point probe suspends at the initial `yield 0`, before the sample loop. Its missed contact demonstrates the private `appliedTool` cache problem independently of the yield-after-pose hazard. Both defects need tests; the latter is not the direct mechanism of that particular probe.

Minimum closure: establish a stable model-owned base variant, correct installation on every resume/query path, and correct cleanup/fallback behavior across completion, cancellation and snapshots. A local implementation may satisfy this; a large refactor is not mandatory. Add regressions for the original interleaving, a sample-loop suspension, and the subsequent fallback sweep.

**TWP-06: invalidate at the correct logical transition.**

The proposed reset cannot simply reference `clear` and `sSafe` from the current `applyTool`: the initial [poseFirst call](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1132) invokes it before those arrays are initialized at [collision.ts:1251](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collision.ts:1251). It would need initialization/lifetime changes. `applyTool` also has no current sweep-parameter argument and participates in baseline/refinement/restoration work, not just forward segment transitions.

Distinguish a run's logical tool/TLO transition from reinstalling its tool after another run used the shared model. Invalidate the affected clearance and advancement bounds at a real geometry/pose discontinuity, and define what happens to existing contact/onset state. A low-level mesh swap alone is not the complete contract.

Agree that a proven stationary relabel need not discard a valid geometric bound. The capture-G53.6 example supports that case; it does not exempt every WCS/kinematics event without checking physical continuity. Retain the reference-sweep and diameter/length/TLO boundary tests already requested.

**TWP-12: preserve what portion was checked.**

[mergeEntryResult](/home/cnc/twp-checkout/lcnc-webui/src/viewer/sweepMerge.ts:14) receives the entry length as `shift`, but no base-track length. It therefore lacks the denominator needed to convert component fractions into a combined fraction. The UI treats `covered` as a checked prefix at [ScrubBar.vue:739](/home/cnc/twp-checkout/lcnc-webui/src/ScrubBar.vue:739).

For an entry of length 10 and a base of length 90, a 25%-checked entry followed by a fully checked base means checked intervals `[0, 2.5]` and `[10, 100]`. Neither 25% nor a combined 92.5% is a valid checked-prefix boundary. A complete entry plus a 50%-checked base has a combined prefix of 55%, requiring rescaling even when only the base is truncated.

Pass the needed lengths/context and either represent checked intervals, or deliberately expose only a conservative checked prefix with matching wording. Test complete, partial and stopped combinations, including both components partial. Keep the finding conditional: normal shipped entry travel has not reproduced sample-backstop truncation, and [the worker](/home/cnc/twp-checkout/lcnc-webui/src/viewer/collisionWorker.ts:217) disables the iterator's time budget for side runs too.

**Performance and evidence corrections.**

The branch's [recorded investigation](/home/cnc/twp-checkout/docs/decisions.md:3826) describes slow camera interaction while the main thread remained free of long tasks and a collision worker competed for host resources. That directly contradicts treating worker placement as proof of responsiveness. It is historical evidence for what to measure, not proof that the current revision has the same latency.

The claim that the trsrn BVH build is probably over 250 ms is also unsupported: the [recorded trsrn profile](/home/cnc/twp-checkout/docs/decisions.md:3855) measured an 8 ms build. This does not establish current cold-load time or DMU performance. Agree with measuring before adopting a budget; do not replace one unmeasured assumption with another.

The comment's decision not to run TypeScript probes limits its independent verification. Source inspection remains useful, and no full-suite rerun was needed for this response. The stated blanket ban on builds with a live HAL chain is broader than the saved [load policy](/home/cnc/.claude/projects/-home-cnc-lcnc-suite/memory/feedback_no_heavy_builds_while_suite_live.md), which distinguishes real hardware/evidence runs from ordinary simulator work. This response used only the small existing offline bundle and did not exercise the live session.

**Recommended follow-up order.**

1. **Motion and existing-machine regressions:** TWP-01–04 and 08a, plus the minimum supported-capability/mode guard from 08b. Treat the full A/B/C validity fix as part of motion correctness even if it requires a gateway/HAL update.
2. **Collision correctness:** TWP-06/07 together, because logical geometry changes and temporary shared-model installation interact; then TWP-12 coverage. Keep the new restoration counterexample in the acceptance tests.
3. **Preview correctness and refresh:** TWP-05/09/10. Small independent fixes can land earlier; ordering is not permission to leave an enabled incorrect verdict exposed.
4. **Development acceptance:** resolve the focused label/refusal/editing-state issues, verify remaining U-01–U-09 behavior at supported viewports, measure responsiveness/TWP-11, and run final-candidate automated and isolated-simulator gates. Add a parameterized non-switchable G59–G59.3 touch-off test; the current G54-only test does not cover the regression.
5. **Main promotion:** the operator's physical-machine, real-touchscreen and target-hardware validation. Broader frame types, parse-context consolidation, general capabilities and additional visualization guarantees remain separate follow-up work.

The design comments D-01–D-09 are largely accepted: clear labels and validity wording are small improvements; replay and current-parser checks complement each other; broader typing, capability and visualization work can follow. The important change to the comments' plan is to close defects with behavioral evidence, without assuming either a major redesign or an untested one-line patch is necessary.
