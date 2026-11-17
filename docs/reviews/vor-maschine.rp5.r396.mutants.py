#!/usr/bin/env python3
"""Replay 5c mutants: each applied in the tree, the named guard run, restored.
    mutants5c.py OUTDIR [NAME ...]
Red when the named test fails (pytest -q prints FAILED <file>::<name>[...])."""
import json, subprocess, sys
from pathlib import Path

TREE = Path.home() / "lcnc-suite-5c"
PY = str(Path.home() / "lcnc-suite-pl/lcnc-gateway/.venv/bin/python3")
COV = "scripts/inventory/coverage.py"
LIVE = "scripts/inventory/live_drivers.py"
REPLAY = "scripts/test_select/replay.py"
T_COV = "scripts/inventory/test_coverage.py"
T_REPLAY = "scripts/test_select/test_replay.py"

MUTANTS = {
    "C1": ("a listed test without a result counted as passed", [(COV,
            '            return {"listed": "not run", "flaky": "failed"}.get(s, s)',
            '            return {"listed": "passed", "flaky": "failed"}.get(s, s)')],
           T_COV, "test_every_bound_test_must_pass_and_a_listed_name_that_never_ran_is_no_run"),
    "C2": ("a template's instance matched as a substring of a capture", [(COV,
            '        missing = [i for i in (inst or []) if i not in caps]',
            '        missing = [i for i in (inst or []) if not any(i in c for c in caps)]')],
           T_COV, "test_a_template_binds_by_its_captures_never_a_substring"),
    "C3": ("a skipped scenario counted as passed", [(LIVE,
            '        return "skip", str(skipped)',
            '        return "passed", ""')],
           T_COV, "test_the_status_is_decided_by_result_kind_in_the_agreed_order"),
    "C4": ("an early error record without success fields an evaluation error (R391)", [(LIVE,
            '    if error is not None or fail is not None:\n        return "failed", str(fail or error)\n',
            '')],
           T_COV, "test_the_status_is_decided_by_result_kind_in_the_agreed_order"),
    "C5": ("a live report of another commit taken", [(LIVE,
            '    mine = [r for r in reports if r.get("commit") == head and r.get("dirty") is False]',
            '    mine = [r for r in reports if r.get("dirty") is False]')],
           T_COV, "test_a_report_of_another_commit_or_a_dirty_tree_is_no_run_at_this_commit"),
    "C6": ("a missing artefact of the run is no error", [(COV,
            '        missing.append(f"{path.name}: {type(e).__name__} — an artefact of the run is missing")',
            '        pass')],
           T_COV, "test_a_missing_artefact_is_red"),
    "C7": ("an expected refusal counted as a trigger", [(COV,
            '                valid = n - exp.get(att, {}).get(key, 0)',
            '                valid = n')],
           T_COV, "test_an_expected_refusal_is_no_trigger_of_its_command"),
    "C8": ("a route the fallback answered is no gap", [(COV,
            '                 for r, v in trig_r.items() if v["e2e"] == "not requested" or not (set(routes["e2e"].get(r, {})) & EVIDENCE)]',
            '                 for r, v in trig_r.items() if v["e2e"] == "not requested"]')],
           T_COV, "test_a_route_only_the_fallback_answered_is_a_gap_never_server_evidence"),
    "C9": ("a Firefox pass stands in for Chromium", [(COV,
            '                        st = verdict([tests[project][k] for k in bound]) if not why else "not collected"',
            '                        st = verdict([tests["firefox-core"].get(k[:2] + ("firefox-core",), tests[project][k]) for k in bound]) if not why else "not collected"')],
           T_COV, "test_a_firefox_pass_never_stands_in_for_chromium"),
    "C11": ("a status the report does not know counted as passed", [(COV,
            '    return f"unknown status {odd}" if odd else "passed"', '    return "passed"')],
            T_COV, "test_a_status_the_report_does_not_know_is_never_passed"),
    "C12": ("a title outside the Firefox core red again", [(COV,
            '                        if why and project == "firefox-core":', '                        if False:')],
            T_COV, "test_a_title_outside_the_firefox_core_is_named_never_red"),
    "C13": ("the JUnit keeps the last result of a node, not its worst", [(COV,
            '        out[key] = _worst(out.get(key, "passed"), st)', '        out[key] = st')],
            T_COV, "test_the_junit_keeps_the_worst_result_per_node"),
    "C14": ("a native report of another commit taken", [(COV,
            '                    hits = [rw for r in natives if r.get("commit") == head and r.get("profile") == e.get("profile")',
            '                    hits = [rw for r in natives if r.get("profile") == e.get("profile")')],
            T_COV, "test_a_native_report_counts_only_at_this_commit_and_its_counter_flag_decides"),
    "C15": ("a merge ends without the coverage", [("scripts/test_select/round_gate.py",
            '        return [install_probe(logs, head), coverage_check(logs, head)], []',
            '        return [install_probe(logs, head)], []')],
            T_COV, "test_a_merge_ends_with_the_install_probe_then_the_coverage_and_a_round_omits_it"),
    "C16": ("triggering merged across the projects again", [(COV,
            '                    sent[project][key.split(":")[0]][key] += valid',
            '                    sent["e2e"][key.split(":")[0]][key] += valid')],
            T_COV, "test_triggering_is_kept_per_project"),
    "C10": ("the replay counts an expected refusal as a valid frame of its own", [(REPLAY,
            '                    if cls == "test":\n                        per_attempt_expected[key][_variant(cmd, msg)] += 1',
            '                    pass')],
           T_REPLAY, "test_an_expected_refusal_is_counted_apart_with_its_variant_key"),
}


def run(cmd):
    return subprocess.run(cmd, cwd=TREE, text=True, capture_output=True)


def main():
    out = Path(sys.argv[1]); names = sys.argv[2:] or list(MUTANTS)
    out.mkdir(parents=True, exist_ok=True)
    if run(["git", "status", "--porcelain", "--untracked-files=no"]).stdout.strip():
        raise SystemExit("tree not clean")
    head = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    summary = {}
    base = run([PY, "-m", "pytest", "-q", "-p", "no:cacheprovider", T_COV, T_REPLAY])
    summary["baseline"] = {"exit": base.returncode, "tail": base.stdout.strip().splitlines()[-1:]}
    if base.returncode != 0:
        raise SystemExit("the baseline is not green")
    for n in names:
        what, edits, tfile, test = MUTANTS[n]
        for f, old, new in edits:
            p = TREE / f
            t = p.read_text()
            if t.count(old) != 1:
                raise SystemExit(f"{n}: anchor not found exactly once in {f}")
            p.write_text(t.replace(old, new))
        try:
            r = run([PY, "-m", "pytest", "-q", "-p", "no:cacheprovider", tfile])
            failed = [l for l in r.stdout.splitlines() if l.startswith("FAILED")]
            red = r.returncode != 0 and any(f"::{test}" in l for l in failed)
            summary[n] = {"what": what, "head": head, "red": red, "named": test, "failed": failed[:6]}
        finally:
            run(["git", "checkout", "--", "."])
        print(n, "RED" if red else "GREEN", "—", what, flush=True)
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    if run(["git", "status", "--porcelain", "--untracked-files=no"]).stdout.strip():
        raise SystemExit("tree not clean after the mutants")


if __name__ == "__main__":
    main()
