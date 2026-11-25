"""Step 0 "path kinds" red proofs (2026-11-25): each mutation breaks ONE rule of
how a change between feed and rapid — and (Codex R487 H1) the course inside a
run of one kind — reaches the client's consumers; its named guards must fail
AT that rule (`at`: a text the failing output must carry).
Run from the tree's root; every file is restored byte-identical. Nothing is
written into a __pycache__ (PYTHONPYCACHEPREFIX) and no lock is taken: single
pytest / vitest files only.

  python3 -I docs/reviews/pathkinds.mutations.py [name ...]
"""
import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
G, V = "lcnc-gateway/", "lcnc-webui/src/viewer/"
W, U = G + "gcode_parse_worker.py", G + "gateway_util.py"
PY = "test_path_kinds_worker.py"
TS = "src/viewer/pathKinds.test.ts"

# name: (file, old, new, [(kind, target, at)])
MUTATIONS = {
    "feed_anchors_dropped": (W, "        anchors.extend(_feed_changes) ", "        pass ",
                             [("py", PY + "::TestEveryCycleAndBasis", "the runs of one kind, in order"), ("py", PY + "::TestRandomPrograms", "run")]),
    "rapid_anchors_dropped": (W, "        r_anchors.extend(_rapid_changes)\n", "",
                              [("py", PY + "::TestTheProgramsThatLostTheirChanges", "the runs of one kind, in order"),
                               ("py", PY + "::TestRandomPrograms", "the runs of one kind, in order")]),
    "only_before_the_change": (U, "return {int(i) for i in flips} | {int(i) + 1 for i in flips}\n\n\ndef band", "return {int(i) for i in flips}\n\n\ndef band",
                               [("py", PY + "::TestTheAnchors", "test_both_sides_of_every_change"),
                                ("py", PY + "::TestRandomPrograms", "run")]),
    "only_after_the_change": (U, "return {int(i) for i in flips} | {int(i) + 1 for i in flips}\n\n\ndef band", "return {int(i) + 1 for i in flips}\n\n\ndef band",
                              [("py", PY + "::TestTheAnchors", "test_both_sides_of_every_change"),
                               ("py", PY + "::TestTheProgramsThatLostTheirChanges", "run")]),
    "adjacency_instead_of_order": (U, "flips = np.flatnonzero(np.diff(before) != 0)", "flips = np.flatnonzero(np.diff(np.asarray(seqs, dtype=np.int64)) != 1)",
                                   [("py", PY + "::TestTheAnchors", "test_execution_order_not_adjacency")]),
    # (a relabel vertex counted as no change of stream is no mutation of its own:
    # its neighbours are anchored by the line, event and predecessor rules)
    "feeds_are_no_change_for_rapids_after_an_arc": (W, "_rapid_changes = list_change_indices(_rapid_q, _feed_q)",
                                                    "_rapid_changes = list_change_indices(_rapid_q, _feed_q[:1])",
                                                    [("py", PY + "::TestEveryCycleAndBasis", "run")]),
    "a_coarser_tolerance": (W, "_RDP_EPS_MM = 0.005", "_RDP_EPS_MM = 0.5",
                            [("py", PY + "::TestEveryCycleAndBasis", "not less than or equal to")]),
    "rapid_time_not_thinned_with_it": (W, "            rapid_tcum = [rapid_tcum[i] for i in keep]\n", "",
                                       [("py", PY + "::TestTheCourseInsideARun::test_straight_and_even_is_still_thinned", "channels not thinned with their stream")]),
    "outside_flags_not_reduced_per_run": (W, "            rapid_out = reduce_outside_flags(rapid_out, keep)\n", "            rapid_out = [0 for _ in keep]\n",
                                          [("py", PY + "::TestEveryCycleAndBasis::test_other_channels_cases", "outside at seq")]),
    "the_committed_payloads_stale": (G + "native_start_probe.py", '"pk_hidden_rapid": _pk("G0 X50 Y30\\nG0 Z15', '"pk_hidden_rapid": _pk("G0 X50 Y30\\nG0 Z14',
                                     [("py", PY + "::TestTheClientsPayloadsAreFresh", "regenerate")]),
    # ── the course inside a run (Codex R487 H1)
    "a_way_back_on_the_chord": (W, "    if turns:\n        return [i0 + k for k in turns]\n", "",
                                [("py", PY + "::TestTheCourseInsideARun::test_codex_s_program_keeps_its_turns_and_its_two_controls_do", "runs back along it"),
                                 ("py", PY + "::TestTheCourseInsideARun::test_repeated_by_rapid_and_by_feeds_of_one_line", "runs back along it"),
                                 ("py", PY + "::TestTheCourseInsideARun::test_the_rotary_form", "runs back along it"),
                                 ("py", PY + "::TestRandomPrograms::test_random_programs_to_and_fro_keep_their_course", "runs back along it"),
                                 ("py", PY + "::TestTheChord::test_random_ways_keep_places_turns_and_times", "runs back")]),
    "one_turn_per_look": (W, "        return [i0 + k for k in turns]\n", "        return [i0 + k for k in turns][:1]\n",
                          [("py", PY + "::TestTheChord::test_to_and_fro_is_kept_in_one_pass", "not less than or equal to 3")]),
    "the_rotary_is_no_way_back": (W, "_turning_points(wire[i0:i1 + 1].astype(np.float64), w2)", "_turning_points(wire[i0:i1 + 1, :3].astype(np.float64), w2[:3])",
                                  [("py", PY + "::TestTheCourseInsideARun::test_the_rotary_form", "runs back along it"),
                                   ("py", PY + "::TestTheChord::test_a_rotary_s_way_back_is_a_way_back", "AssertionError")]),
    "the_rotary_counts_one_degree_one_unit": (W, "np.asarray(weights, dtype=np.float64) ** 2", "np.ones(wire.shape[1])",
                                              [("py", PY + "::TestTheChord::test_a_rotary_column_counts_in_pose_units", "AssertionError")]),
    "a_loop_to_its_first_point": (W, "        turns.add(int(np.argmax(((q - q[0]) ** 2 * w2).sum(axis=1))))", "        pass",
                                  [("py", PY + "::TestTheChord::test_a_hairpin_of_right_angles_turns_back", "AssertionError")]),
    "only_the_step_before_asked": (W, "    turns.update(int(k) + 1 for k in ahead[np.flatnonzero(np.diff(along[np.flatnonzero(along)]))])\n", "",
                                   [("py", PY + "::TestTheChord::test_a_hairpin_of_right_angles_turns_back", "AssertionError"),
                                    ("py", PY + "::TestTheChord::test_the_sign_of_a_step_is_exact", "AssertionError")]),
    "only_the_chord_asked": (W, "    turns = {int(k) + 1 for k in a[signs(q[a], q[a + 1], q[b], q[b + 1]) < 0]}", "    turns = set()",
                             [("py", PY + "::TestTheChord::test_a_short_chord_is_asked_too", "AssertionError"),
                              ("py", PY + "::TestTheChord::test_the_sign_of_a_step_is_exact", "AssertionError")]),
    "a_tolerance_on_the_way_back": (W, "        out = np.sign(t)\n", "        out = np.sign(np.where(np.abs(t) < 1e-3, 0.0, t))\n",
                                    [("py", PY + "::TestTheChord::test_a_way_back_the_wire_carries_is_one_however_small", "AssertionError"),
                                     ("py", PY + "::TestTheCourseInsideARun::test_repeated_by_rapid_and_by_feeds_of_one_line", "runs back along it")]),
    # (R489's own forms: a bound from the list's largest coordinate; a short chord not asked)
    "a_bound_from_the_whole_list": (W, "    turns = _turning_points(wire[i0:i1 + 1].astype(np.float64), w2)\n",
                                    "    turns = _turning_points(np.round(wire[i0:i1 + 1].astype(np.float64) / (b := 4 * float(np.spacing(np.float32(np.abs(wire).max())))) ) * b, w2)\n",
                                    [("py", PY + "::TestTheChord::test_a_way_back_the_wire_carries_is_one_however_small", "AssertionError")]),
    "a_short_chord_not_asked": (W, "    if turns:\n        return [i0 + k for k in turns]\n", "    if turns and float(seg @ seg) > 1e-6:\n        return [i0 + k for k in turns]\n",
                                [("py", PY + "::TestTheChord::test_a_short_chord_is_asked_too", "AssertionError"),
                                 ("py", PY + "::TestTheChord::test_random_ways_keep_places_turns_and_times", "runs back")]),
    "judged_before_the_wire": (W, "_turning_points(wire[i0:i1 + 1].astype(np.float64), w2)", "_turning_points(np.asarray(points[i0:i1 + 1]), np.ones(points.shape[1]))",
                               [("py", PY + "::TestTheChord::test_what_the_wire_does_not_carry_is_no_way_back", "AssertionError")]),
    "the_sign_by_f64_alone": (W, "        for k in (int(i) for i in np.flatnonzero(doubt)):", "        for k in ():",
                              [("py", PY + "::TestTheChord::test_the_sign_of_a_step_is_exact", "AssertionError")]),
    "the_feed_s_times_not_passed": (W, "eps_sq, _rdp_times(feed_tcum), *_rdp_wire(feed, feed_abc))", "eps_sq, None, *_rdp_wire(feed, feed_abc))",
                                    [("py", PY + "::TestTheCourseInsideARun::test_the_place_and_the_line_at_every_time", "was elsewhere at its time")]),
    "the_time_is_not_asked": (W, "    if times is not None:\n        t0, t1", "    if times is not None and False:\n        t0, t1",
                              [("py", PY + "::TestTheCourseInsideARun::test_the_place_and_the_line_at_every_time", "was elsewhere at its time"),
                               ("py", PY + "::TestTheChord::test_one_line_at_two_speeds", "AssertionError"),
                               ("py", PY + "::TestTheChord::test_random_ways_keep_places_turns_and_times", "at its time")]),
    "one_change_of_speed_per_look": (W, "return [i0 + 1 + int(k) for k in own] if len(own) else [i0 + 1 + worst]", "return [i0 + 1 + worst]",
                                     [("py", PY + "::TestTheChord::test_one_line_at_two_speeds", "not less than or equal to 2")]),
    "a_line_s_end_not_kept": (W, "np.concatenate((flips, flips + 1))", "(flips + 1)",
                              [("py", PY + "::TestTheCourseInsideARun::test_the_place_and_the_line_at_every_time", "line at its time"),
                               ("py", PY + "::TestRandomPrograms::test_random_programs_keep_their_runs", "line at its time")]),
    "a_subroutine_s_ends_not_kept": (W, "            out.extend(seq_boundary_indices(seqs, {int(e[0]) + 1 for e in canon.sub_events}))", "            pass",
                                     [("py", PY + "::TestTheCourseInsideARun::test_the_place_and_the_line_at_every_time", "line at its time"),
                                      ("py", PY + "::TestTheCourseInsideARun::test_a_rapid_s_line_on_a_straight_run_of_several", "line at its time")]),
    "a_rapid_s_lines_not_kept": (W, "r_anchors = _line_anchors(rapid_lines, rapid_seq)", "r_anchors = [0]",
                                 [("py", PY + "::TestTheCourseInsideARun::test_a_rapid_s_line_on_a_straight_run_of_several", "line at its time"),
                                  ("py", PY + "::TestRandomPrograms::test_random_programs_keep_their_runs", "line at its time")]),
    "a_feed_s_lines_not_kept": (W, "        anchors = _line_anchors(feed_lines, feed_seq)\n", "        anchors = [0]\n",
                                [("py", PY + "::TestTheCourseInsideARun::test_the_place_and_the_line_at_every_time", "line at its time")]),
    "merge_feeds_first": (V + "scrubTrack.ts", "else takeFeed = fseq![fi]! < rseq![ri]!;", "else takeFeed = true;",
                          [("ts", TS, "the merged track has the un-thinned path's runs")]),
    "slice_forgets_the_kind": (V + "scrubTrack.ts", "rapid: t.rapid.slice(a, a + n),\n    cum, timeBased", "rapid: new Uint8Array(n),\n    cum, timeBased",
                               [("ts", TS, "a slice, the entry track and the check's copy")]),
    "entry_forgets_the_kind": (V + "scrubTrack.ts", "  rapid.set(t.rapid, 1);\n", "",
                               [("ts", TS, "a slice, the entry track and the check's copy")]),
    "the_check_s_copy_forgets_the_kind": (V + "colTrackCopy.ts", "rapid: track.rapid.slice(), cum", "rapid: new Uint8Array(track.count), cum",
                                          [("ts", TS, "a slice, the entry track and the check's copy")]),
    "a_rapid_section_opens_nowhere": (V + "scrubTrack.ts", "      if (rLast !== i - 1) {", "      if (rLast === -2) {",
                                      [("ts", TS, "the drawn sections draw every move once")]),
    "a_feed_section_opens_nowhere": (V + "scrubTrack.ts", "      if (fLast !== i - 1) {", "      if (fLast === -2) {",
                                     [("ts", TS, "the drawn sections draw every move once")]),
    "the_levels_cross_sections": (V + "lineChunks.ts", "while (p < np && pairs[p * 2] === run[m - 1]) {", "while (p < np) {",
                                  [("ts", TS, "the display levels end where every section ends")]),
    "the_bake_drops_a_short_move": (V + "partFrame.ts", "    for (let s = 1; s <= steps; s++) {\n      const t = s / steps;",
                                    "    if (Math.abs(input.pos[j + 2]! - input.pos[k + 2]!) < 0.3 && i % 2) continue;\n    for (let s = 1; s <= steps; s++) {\n      const t = s / steps;",
                                    [("ts", TS, "the part-frame bake keeps every vertex")]),
    "the_packed_lines_drop_a_short_move": (V + "fatPaths.ts", "if (ax === bx && ay === by && az === bz) continue;", "if (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz) < 5) continue;",
                                           [("ts", TS, "the part-frame bake keeps every vertex")]),
}


def run(kind, target):
    if kind == "py":
        env = {"PATH": "/usr/bin:/bin", "HOME": str(pathlib.Path.home()), "LANG": "C.UTF-8",
               "PYTHONPYCACHEPREFIX": tempfile.gettempdir() + "/pathkinds-pyc"}
        p = subprocess.run([str(ROOT / G / ".venv/bin/python"), "-m", "pytest", "-q", "-p", "no:cacheprovider", target],
                           cwd=ROOT / G, env=env, capture_output=True, text=True, timeout=300)
    else:
        config = os.environ.get("PATHKINDS_VITEST_CONFIG")
        p = subprocess.run(["node", "node_modules/vitest/vitest.mjs", "run", *(["--config", config] if config else []), target],
                           cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=300)
    return p.returncode, p.stdout + p.stderr


def main():
    names = sys.argv[1:] or list(MUTATIONS)
    bad = []
    for name in names:
        file, old, new, guards = MUTATIONS[name]
        path = ROOT / file
        before = path.read_bytes()
        text = before.decode()
        if text.count(old) != 1:
            bad.append(f"{name}: its text is in {file} {text.count(old)} times")
            continue
        path.write_text(text.replace(old, new))
        try:
            for kind, target, at in guards:
                rc, out = run(kind, target)
                red = rc == 1 and at in out
                print(f"{name}: {target} -> {'red at its rule' if red else f'NOT red (rc {rc})'}", flush=True)
                if not red:
                    bad.append(f"{name}: {target}")
                    print(out[-1500:])
        finally:
            path.write_bytes(before)
    for target, kind in ((PY, "py"), (TS, "ts")):
        rc, out = run(kind, target)
        print(f"restored: {target} -> {'green' if rc == 0 else 'RED'}", flush=True)
        if rc:
            bad.append(f"restored {target}")
    print(f"{len(names)} mutations, {len(bad)} problems" + ("" if not bad else ": " + "; ".join(bad)))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
