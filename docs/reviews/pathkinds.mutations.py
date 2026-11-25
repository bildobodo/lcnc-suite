"""Step 0 "path kinds" red proofs (2026-11-25): each mutation breaks ONE rule of
how a change between feed and rapid reaches the client's consumers; its named
guards must fail AT that rule (`at`: a text the failing output must carry).
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
    "rapid_anchors_dropped": (W, "r_anchors = [0, len(rapid) - 1, *_rapid_changes]", "r_anchors = [0, len(rapid) - 1]",
                              [("py", PY + "::TestTheProgramsThatLostTheirChanges", "the runs of one kind, in order"),
                               ("py", PY + "::TestRandomPrograms", "the runs of one kind, in order")]),
    "only_before_the_change": (U, "return set(flips.tolist()) | set((flips + 1).tolist())", "return set(flips.tolist())",
                               [("py", PY + "::TestTheAnchors", "test_both_sides_of_every_change"),
                                ("py", PY + "::TestRandomPrograms", "run")]),
    "only_after_the_change": (U, "return set(flips.tolist()) | set((flips + 1).tolist())", "return set((flips + 1).tolist())",
                              [("py", PY + "::TestTheAnchors", "test_both_sides_of_every_change"),
                               ("py", PY + "::TestTheProgramsThatLostTheirChanges", "run")]),
    "adjacency_instead_of_order": (U, "flips = np.flatnonzero(np.diff(before) != 0)", "flips = np.flatnonzero(np.diff(np.asarray(seqs, dtype=np.int64)) != 1)",
                                   [("py", PY + "::TestTheAnchors", "test_execution_order_not_adjacency")]),
    # (a relabel vertex counted as no change of stream is no mutation of its own:
    # its neighbours are anchored by the line, event and predecessor rules)
    "feeds_are_no_change_for_rapids_after_an_arc": (W, "_rapid_changes = list_change_indices(rapid_seq, feed_seq)",
                                                    "_rapid_changes = list_change_indices(rapid_seq, feed_seq[:1])",
                                                    [("py", PY + "::TestEveryCycleAndBasis", "run")]),
    "a_coarser_tolerance": (W, "_RDP_EPS_MM = 0.005", "_RDP_EPS_MM = 0.5",
                            [("py", PY + "::TestEveryCycleAndBasis", "not less than or equal to")]),
    "rapid_time_not_thinned_with_it": (W, "            rapid_tcum = [rapid_tcum[i] for i in keep]\n", "",
                                       [("py", PY + "::TestEveryCycleAndBasis", "channels not thinned with their stream")]),
    "outside_flags_not_reduced_per_run": (W, "            rapid_out = reduce_outside_flags(rapid_out, keep)\n", "            rapid_out = [0 for _ in keep]\n",
                                          [("py", PY + "::TestEveryCycleAndBasis::test_other_channels_cases", "outside at seq")]),
    "the_committed_payloads_stale": (G + "native_start_probe.py", '"pk_hidden_rapid": _pk("G0 X50 Y30\\nG0 Z15', '"pk_hidden_rapid": _pk("G0 X50 Y30\\nG0 Z14',
                                     [("py", PY + "::TestTheClientsPayloadsAreFresh", "regenerate")]),
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
