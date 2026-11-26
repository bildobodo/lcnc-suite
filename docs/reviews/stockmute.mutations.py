"""Stock rule red proofs (2026-11-26; stock-mute plan v2 + v3, Codex R484 /
R488 / R490): each mutation breaks ONE rule of the cutting state, the own hole
or its checkpoint; its named guards must fail AT that rule (`at`: a text the
failing output must carry). Run from the tree's root; every file is restored
byte-identical. Single vitest files only (`STOCKMUTE_VITEST_CONFIG` names
another vitest config — node_modules here may be hard links).

Two protections apart (Codex R490): where a second check would answer for the
mutated one, the guard reads what the first one decides — the own-hole
QUESTIONS (HoleWork.questions, before the open body's free-side test), not the
fed-path asks — and the other check stays. EQUIVALENT names the mutations no
behaviour can show, with the reason; the runner applies each and requires the
guards GREEN (the text must still be there once).

  python3 -I docs/reviews/stockmute.mutations.py [name ...]
"""
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
V = "lcnc-webui/src/viewer/"
C, R, F, W, H = V + "collision.ts", V + "cutRule.ts", V + "fedPath.ts", V + "collisionWorker.ts", V + "stockMuteHarness.ts"
SM, CR, FP = "src/viewer/stockMute.test.ts", "src/viewer/cutRule.test.ts", "src/viewer/fedPath.test.ts"
SMP = "src/viewer/stockMutePaths.test.ts"

# name: (file, old, new, [(target, at)])
MUTATIONS = {
    # ── the step function
    "the_hole_asked_from_unresolved": (R, "if (state === CUT_NONE && ownHole())", "if (ownHole())",
                                       [(CR, "asks the own hole from NONE only"), (SM, "never asked from UNRESOLVED")]),
    "an_open_body_apart_without_boxes": (R, "return excluded() ? SAMPLE_APART : SAMPLE_UNRESOLVED;", "return SAMPLE_APART;",
                                         [(CR, "a sample's class"), (SM, "never asked from UNRESOLVED")]),
    "a_flicker_is_a_separation": (R, "  if (d <= CUT_SEP) return SAMPLE_NOTHING;\n", "",
                                  [(CR, "a sample's class"), (SM, "across at it and down")]),
    "a_break_ends_unresolved": (R, "return state === CUT_MACHINING ? CUT_NONE : state;", "return state === CUT_RAPID ? state : CUT_NONE;",
                                [(CR, "a discontinuity ends machining")]),
    "machining_ends_on_touch_from_rapid_entry": (R, "      return { state, begins: BEGIN_NONE };            // MACHINING stays; RAPID as today",
                                                 "      return state === CUT_MACHINING ? { state: CUT_RAPID, begins: BEGIN_RAPID } : { state, begins: BEGIN_NONE };",
                                                 [(CR, "is the table")]),
    # ── the cutting state in the sweep
    "the_hole_never_excuses": (C, "() => known && !bandEntry && ownHole(pi, free)", "() => false",
                               [(SM, "re-entry above the fed depth")]),
    "the_contact_side_as_the_top": (C, "                free = bz.free;\n", "                free = bz.at;\n",
                                    [(SM, "must reach the entry's FREE side")]),
    "the_axis_not_asked": (C, "        && alongToolAxis(g, pi);", "        && true;",
                           [(SM, "the tool's axis refuses")]),
    "no_discontinuity": (C, "        if (toolBoundary || ustartAt) sink?.discontinuity(pi, c0);\n", "",
                         [(SM, "T1 fed in, T2 rapid down in the stock")]),
    "a_relabel_is_a_discontinuity": (C, "if (toolBoundary || ustartAt) sink?.discontinuity", "if (toolBoundary || breakBoundary) sink?.discontinuity",
                                     [(SM, "a stationary relabel, rapid down")]),
    "the_discontinuity_at_once": (C, "      discontinuity(pi: number, s: number) {\n        if (pairCutting[pi]) cutBreakAt[pi] = s;\n      },",
                                  "      discontinuity(pi: number, s: number) {\n        if (pairCutting[pi]) { cutState[pi] = cutBreak(cutState[pi]! as CutState); cutFloor[pi] = s; }\n      },",
                                  [(SM, "a rapid inside it, T2 rapid up out"), (SM, "no note below a discontinuity")]),
    "the_entry_across_a_discontinuity": (C, ",\n                                   cutting ? cutFloor[pi]! : -Infinity);", ");",
                                         [(SM, "T1 fed in, T2 rapid down in the stock")]),
    "the_old_free_sample_as_floor": (C, " && f >= cutFloor[pi]! && f >= jump", " && f >= jump",
                                     [(SM, "T1 fed in, T2 rapid down in the stock")]),
    "the_band_entry_as_feed": (C, "                if (track.band?.[g] === 1) {", "                if (false) {",
                               [(SM, "traced into a braking range")]),
    "r88_only_for_feed_begun": (C, "(pairCutting[pi] && rapidBetween(lastTouch[pi]!, s))", "(pairCutting[pi] && !onsetRapid[pi] && rapidBetween(lastTouch[pi]!, s))",
                                [(SM, "rapid 0.05 below the fed depth, feed on")]),
    "the_entry_by_the_sample_s_kind": (C, "const step = cutStep(was, cls, () => !entryRapid || boundary,", "const step = cutStep(was, cls, () => !isRapid || boundary,",
                                       [(SM, "first seen on the feed after it")]),
    "an_open_free_side_not_asked": (C, "        if (!wholeBoxesApart(pi)) return false;\n", "",
                                    [(SM, "free side inside the whole box")]),
    # ── the own hole
    "a_lateral_tolerance": (F, "return p[q + o1] === c1 && p[q + o2] === c2", "return Math.abs(p[q + o1]! - c1) < 1e-3 && Math.abs(p[q + o2]! - c2) < 1e-3",
                            [(FP, "refuses any lateral offset"), (SM, "on bit-identical poses only")]),
    "the_basis_after_the_length": (F, "    if (!usable(t, i, seg) || !on(i) || !on(i - 1)) break;\n    if (t.rapid[i] === 1) continue;\n",
                                   "    if (t.rapid[i] === 1) continue;\n    if (!usable(t, i, seg) || !on(i) || !on(i - 1)) break;\n",
                                   [(FP, "refuses every change of basis")]),
    "following_rapids_ignored": (F, "  for (let i = seg + 1; i < t.count && t.rapid[i] === 1; i++) {", "  for (let i = seg + 1; false; i++) {",
                                 [(FP, "a following rapid leaves the line"), (SM, "then sideways at depth")]),
    "the_beginning_read": (F, "first = (t.depEnd ?? 0) + 1", "first = 1",
                           [(FP, "the start-dependent beginning")]),
    "no_cap": (F, "    if (++m > FED_CAP) break;\n", "    ++m;\n",
               [(FP, "reads at most FED_CAP segments")]),
    "the_union_jumps_a_gap": (F, "else if (hi >= low && lo < low) low = lo;", "else if (lo < low) low = lo;",
                              [(FP, "integer union")]),
    # ── the checkpoint
    "no_checkpoint_in_the_main_loop": (C, "          const hc = yield* holeCheck(0);\n", "          const hc = null as \"end\" | \"yielded\" | null;\n",
                                       [(SM, "asks at most 4 times between two yields"), (SM, "a cancel raised by the first ask"),
                                        (SMP, "through the worker's own run"), (SMP, "an abort sent after the first ask")]),
    "no_checkpoint_in_the_re_sampling": (C, "              if ((yield* holeCheck(1)) === \"end\") break outer;   // the next x poses itself\n", "",
                                         [(SM, "at the re-sampling after a touch too")]),
    "the_floor_tied_to_the_pose_counter": (C, "    if (holeSince < HOLE_ASKS_PER_YIELD && clock() - lastYield < yieldMs) return null;",
                                           "    if ((done & 511) !== 0 && clock() - lastYield < yieldMs) return null;",
                                           [(SM, "asks at most 4 times between two yields"), (SM, "a cancel raised by the first ask"),
                                            (SMP, "through the worker's own run"), (SMP, "an abort sent after the first ask")]),
    "the_hole_refused_past_a_count": (C, "      return fedOver(track, g,", "      return holeSince < 2 && fedOver(track, g,",
                                      [(SM, "the same tables with yields")]),
    "the_pose_not_restored": (C, "if (sink?.moved || hc === \"yielded\") { if (sink) sink.moved = false; interpPose(i, (s - c0) / L); }",
                              "if (sink?.moved) { sink.moved = false; interpPose(i, (s - c0) / L); }",
                              [(SM, "the same tables with yields")]),
    # ── the pool, its fallback generation and the publication (Codex R497 MT-I53 B)
    "the_fallback_keeps_its_generation": (W, "generation: req.contacts.generation + 1", "generation: req.contacts.generation",
                                          [(SMP, "the earlier keys stay")]),
    "the_pool_coverage_zeroed": (W, "covered: run.progress.slice() } });", "covered: run.progress.map(() => 0) } });",
                                 [(SMP, "the earlier keys stay")]),
    "the_pool_coverage_complete_early": (W, "covered: run.progress.slice() } });", "covered: run.progress.map(() => 1) } });",
                                         [(SMP, "the earlier keys stay")]),
    # ── the comparison's own strength (Codex R500 MT-I53 A): the structure of the references
    "the_comparison_ignores_the_structure": (H, "  const out: string[] = [...ca.broken.map(x => `the first: ${x}`), ...cb.broken.map(x => `the second: ${x}`)];",
                                             "  const out: string[] = [];",
                                             [(SM, "a broken reference")]),
    "the_back_reference_unchecked": (H, "        if (I.get(iv, \"episode\") !== e) broken.push", "        if (false) broken.push",
                                     [(SM, "a broken reference")]),
    "the_pool_coverage_not_handed_over": (W, "    self.postMessage({ id: run.id, heldCoverage: { generation: run.stores[0]!.generation, covered: run.progress.slice() } });\n", "",
                                          [(SMP, "the earlier keys stay")]),
    # ── the copy
    "the_copy_drops_a_channel": (V + "colTrackCopy.ts", "    cond: track.cond?.slice(),", "    cond: undefined,",
                                 [(FP, "every channel of FED_CHANNELS")]),
}

# name: (file, old, new, the guards that must stay GREEN, why no behaviour shows it)
EQUIVALENT = {
    "machining_ends_past_2_margin": (C, " && !(cutting && cutState[pi] === CUT_MACHINING)) {", ") {", [SM],
                                     "for the margins in use (2 x margin > CUT_SEP, mm and inch): the cutting block before it "
                                     "has classified this decided sample past 2 x margin (outside a braking range) as APART or "
                                     "UNRESOLVED and left MACHINING already; the interface does not force that premise, the "
                                     "cheap condition stays (Codex R497 Q2)"),
    "the_boundary_pose_not_restored": (C, '            if (hc === "yielded") poseVertex(lastReal);\n', "", [SM],
                                       "after this line only state and certificate changes follow: the next geometry "
                                       "query poses the model itself (distAtVertex, distAtCum, the next chunk's build); "
                                       "Codex R497 Q1 forced a yield at every holeCheck(3) with a whole other sweep between, "
                                       "without this line: every column equal (not: 'no ask reaches it')"),
}


def run(target):
    config = os.environ.get("STOCKMUTE_VITEST_CONFIG")
    p = subprocess.run(["node", "node_modules/vitest/vitest.mjs", "run", *(["--config", config] if config else []), target],
                       cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=600)
    return p.returncode, p.stdout + p.stderr


def main():
    names = sys.argv[1:] or list(MUTATIONS) + list(EQUIVALENT)
    bad = []
    for name in [n for n in names if n in EQUIVALENT]:
        file, old, new, targets, why = EQUIVALENT[name]
        path = ROOT / file
        before = path.read_bytes()
        text = before.decode()
        if text.count(old) != 1:
            bad.append(f"{name}: its text is in {file} {text.count(old)} times")
            continue
        path.write_text(text.replace(old, new))
        try:
            for target in targets:
                rc, out = run(target)
                print(f"{name} (equivalent: {why}): {target} -> {'green' if rc == 0 else f'RED (rc {rc})'}", flush=True)
                if rc:
                    bad.append(f"{name}: {target} not equivalent")
                    print(out[-1200:])
        finally:
            path.write_bytes(before)
    for name in [n for n in names if n not in EQUIVALENT]:
        file, old, new, guards = MUTATIONS[name]
        path = ROOT / file
        before = path.read_bytes()
        text = before.decode()
        if text.count(old) != 1:
            bad.append(f"{name}: its text is in {file} {text.count(old)} times")
            continue
        path.write_text(text.replace(old, new))
        try:
            for target, at in guards:
                rc, out = run(target)
                red = rc == 1 and at in out
                print(f"{name}: {target} -> {'red at its rule' if red else f'NOT red (rc {rc})'}", flush=True)
                if not red:
                    bad.append(f"{name}: {target}")
                    print(out[-1200:])
        finally:
            path.write_bytes(before)
    for target in (SM, CR, FP, SMP):
        rc, out = run(target)
        print(f"restored: {target} -> {'green' if rc == 0 else 'RED'}", flush=True)
        if rc:
            bad.append(f"restored {target}")
    print(f"{len(names)} mutations, {len(bad)} problems" + ("" if not bad else ": " + "; ".join(bad)))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
