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
RG = "scripts/test_select/round_gate.py"
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
            '                        st = verdict([tests[project][k]["status"] for k in bound]) if not why else "not collected"',
            '                        st = verdict([next((v["status"] for v in tests["firefox-core"].values() if (v["file"], v["path"]) == (tests[project][k]["file"], tests[project][k]["path"])), tests[project][k]["status"]) for k in bound]) if not why else "not collected"')],
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
            '        return [install_probe(logs, head), coverage_check(logs, head, checks)], []',
            '        return [install_probe(logs, head)], []')],
            T_COV, "test_a_merge_ends_with_the_install_probe_then_the_coverage_and_a_round_omits_it"),
    "C16": ("triggering merged across the projects again", [(COV,
            '                    sent[project][key.split(":")[0]][key] += valid',
            '                    sent["e2e"][key.split(":")[0]][key] += valid')],
            T_COV, "test_triggering_is_kept_per_project"),
    # ── Codex R396: VM-I33..VM-I37 and their siblings ──
    "C17": ("a report's result joins the listing's set (VM-I33)", [(COV,
            '            if have is None:\n                errors.append(f"{report}: {x[\'file\']} › {x[\'path\'][:80]} [{key[0]}] — a result for a test the "\n                              "listing does not hold")\n',
            '            if have is None:\n                listed[key] = x\n')],
            T_COV, "test_the_listing_bounds_the_results_and_every_record_is_this_runs"),
    "C18": ("another run's listing or report accepted (VM-I33)", [(COV,
            '            if doc is not None and run_of(doc) != ref:', '            if False:')],
            T_COV, "test_the_listing_bounds_the_results_and_every_record_is_this_runs"),
    "C19": ("another run's JUnit accepted (VM-I33's class)", [(COV,
            '    elif runs is not None and junit_suites(junit) != {runs.get("backend")}:', '    elif False:')],
            T_COV, "test_the_listing_bounds_the_results_and_every_record_is_this_runs"),
    "C20": ("a red replay a source of triggers (VM-I33)", [(COV,
            '    if r.get("verdict") != "PASS" or r.get("findings"):', '    if False:')],
            T_COV, "test_a_replay_attempt_counts_only_as_a_passed_listed_instance_of_this_run"),
    "C21": ("a replay attempt not bound to a listed test (VM-I33)", [(COV,
            '        t = listed.get((a.get("test"), a.get("project")))\n        if a.get("project") != project or t is None:',
            '        t = listed.get((a.get("test"), a.get("project"))) or {"results": {a.get("retry"): "passed"}}\n        if False:')],
            T_COV, "test_a_replay_attempt_counts_only_as_a_passed_listed_instance_of_this_run"),
    "C22": ("the report's result at the attempt's retry unchecked (VM-I33)", [(COV,
            '        if got != "passed":', '        if False:')],
            T_COV, "test_a_replay_attempt_counts_only_as_a_passed_listed_instance_of_this_run"),
    "C23": ("an expected failure read as passed (VM-I34)", [(COV,
            '    if exp == "failed":\n        return "expected to fail"\n    if st == "expected":',
            '    if st == "expected":\n        return "passed"\n    if st == "expected":')],
            T_COV, "test_the_real_reporter_forms_an_expected_failure_is_no_pass_and_every_repeat_counts"),
    "C24": ("the instances of a repeat collapse by title (VM-I34)", [(COV,
            '                key = (sp.get("id"), t.get("projectName"))\n                if key in out:\n                    # an id twice: neither instance is evidence (R400 — reported AND withheld)\n                    errors.append(f"{label}: test id {key[0]} [{key[1]}] twice — one instance would hide another")\n                    out[key] = {**out[key], "status": "contradictory (the id twice)", "results": {}}\n                    continue\n',
            '                key = (sp.get("file") + " › ".join(path + [sp.get("title", "")]), t.get("projectName"))\n')],
            T_COV, "test_the_real_reporter_forms_an_expected_failure_is_no_pass_and_every_repeat_counts"),
    "C25": ("the same id twice: the later overwrites (VM-I34's class)", [(COV,
            '                if key in out:\n                    # an id twice: neither instance is evidence (R400 — reported AND withheld)\n                    errors.append(f"{label}: test id {key[0]} [{key[1]}] twice — one instance would hide another")\n                    out[key] = {**out[key], "status": "contradictory (the id twice)", "results": {}}\n                    continue\n',
            '')],
            T_COV, "test_the_same_test_id_twice_in_one_record_is_an_error_never_an_overwrite"),
    "C26": ("a Vitest result outside its listing accepted (VM-I33)", [(COV,
            '            if key not in out:\n                errors.append(f"{label}: {key[0]} › {key[1][:80]} — a result for a test the listing does not hold")\n                continue\n',
            '')],
            T_COV, "test_a_vitest_result_outside_its_listing_is_an_error_and_a_repeated_name_keeps_the_worst"),
    "C27": ("native evidence binds without the declared set (VM-I35)", [(COV,
            '                    why = ("" if e["title"] in declared.get(v, ()) and e.get("profile") in profiles',
            '                    why = ("" if True')],
            T_COV, "test_native_evidence_binds_only_to_a_declared_case_of_its_variant_and_profile"),
    "C28": ("a native report's undeclared cases unchecked (VM-I35)", [(COV,
            '        if extra:', '        if False:')],
            T_COV, "test_a_native_report_of_this_commit_is_held_against_the_declared_set"),
    "C29": ("the last native row wins (VM-I34's class)", [(COV,
            '                    st = (_native_worst([rw.get("status") for rw in hits]) if hits',
            '                    st = (hits[-1].get("status") if hits')],
            T_COV, "test_a_native_case_is_its_worst_row_over_every_report_of_this_commit"),
    "C30": ("a present null scenario read as absent (VM-I36)", [(LIVE,
            '    if scenario not in report["scenarios"]:', '    if report["scenarios"].get(scenario) is None:')],
            T_COV, "test_a_present_scenario_without_a_record_is_an_error_never_a_missing_run"),
    "C31": ("the latest live report wins (VM-I34's class)", [(LIVE,
            '        st, why, run = max(found, key=lambda x: _LIVE_RANK.get(x[0], len(_LIVE_RANK)))',
            '        st, why, run = found[-1]')],
            T_COV, "test_a_scenario_is_its_worst_over_every_report_of_this_commit"),
    "C32": ("the open variants left out of the report (VM-I37)", [(COV,
            '"variantsOpen": _sites(sides, "variantsOpen"),', '"variantsOpen": [],')],
            T_COV, "test_the_report_keeps_the_inventory_s_open_variants_and_exclusions_with_their_origin"),
    "C33": ("the merge gate's coverage without its run ids (VM-I33)", [(RG,
            'runs=coverage.gate_runs(checks))', 'runs=None)')],
            T_COV, "test_the_merge_gate_binds_the_coverage_to_the_run_ids_its_own_checks_made"),
    "C34": ("the backend step without the gate's run id (VM-I33's class)", [(RG,
            ', "--run-id", backend_run]', ']')],
            T_COV, "test_the_gate_names_the_backend_s_run_and_hands_it_to_the_step"),
    "C35": ("an expected refusal of an attempt that does not count counted (VM-I33's class)", [(COV,
            '            if x.get("where") in passed:\n                refused[x.get("cmd")].append(x)',
            '            if True:\n                refused[x.get("cmd")].append(x)')],
            T_COV, "test_an_expected_refusal_counts_only_from_an_attempt_that_counts"),
    "C36": ("a native report's rows unchecked (VM-I36's class)", [(COV,
            '        elif not isinstance(r["rows"], list) or not all(isinstance(x, dict) for x in r["rows"]):',
            '        elif False:')],
            T_COV, "test_a_native_report_whose_rows_are_no_objects_is_an_evaluation_error"),
    "C37": ("a bound unit test with an expected failure read as passed (R398 VM-I34)", [(COV,
            '                    if not why and "fails" in states:',
            '                    if False:')],
            T_COV, "test_a_bound_unit_test_that_declares_an_expected_failure_is_no_pass"),
    "C38": ("one attempt identity under two names counted twice (R398 VM-I33 A)", [(COV,
            '    for i, k in ident.items():\n        if k > 1:', '    for i, k in []:\n        if k > 1:'), (COV,
            '                or ident[(r.get("run"), a.get("test"), a.get("project"), a.get("retry"))] != 1):',
            '                or False):')],
            T_COV, "test_one_attempt_identity_under_two_names_counts_once_and_is_an_error"),
    "C39": ("two results for one retry overwrite (R398 VM-I33 B)", [(COV,
            '                if any(n > 1 for n in retries.values()):', '                if False:')],
            T_COV, "test_two_results_for_one_retry_are_an_error_never_an_overwrite"),
    "C40": ("a native report of an unknown profile accepted (R398 VM-I35)", [(COV,
            '        if r.get("profile") not in profiles:\n            errors.append(f"native report {r.get(\'run_id\', \'\')}: profile',
            '        if False:\n            errors.append(f"native report {r.get(\'run_id\', \'\')}: profile')],
            T_COV, "test_a_native_report_of_another_profile_or_with_rows_of_another_variant_is_an_error"),
    "C41": ("a native report's rows of another variant accepted (R398 VM-I35)", [(COV,
            '        if other:\n            errors.append(f"native report (variant {v}): rows of another variant',
            '        if False:\n            errors.append(f"native report (variant {v}): rows of another variant')],
            T_COV, "test_a_native_report_of_another_profile_or_with_rows_of_another_variant_is_an_error"),
    "C42": ("a unit test without its options record unchecked (R398 VM-I34)", [(COV,
            '        if key in broken or seen[key] != n:',
            '        if key in broken or (seen[key] != n and seen[key] > 0):')],
            T_COV, "test_a_bound_unit_test_that_declares_an_expected_failure_is_no_pass"),
    "C43": ("the gate's unit step without the options reporter (R398 VM-I34)", [(RG,
            ', f"--reporter={OPTIONS_REPORTER}"], WEB, logs,', '], WEB, logs,')],
            T_COV, "test_the_gate_s_unit_steps_write_each_test_s_options"),
    # ── R400: a reported invalid unit is withheld from positive evidence ──
    "C44": ("an options record's fails not checked as a boolean (R400 VM-I34 A)", [(COV,
            '        if not named or not isinstance(x.get("fails"), bool):', '        if not named:')],
            T_COV, "test_an_options_record_without_a_boolean_fails_leaves_the_test_unknown_never_passed"),
    "C45": ("a record outside the group's listing accepted silently (R400 VM-I34 B)", [(COV,
            '        if key not in listed:\n            errors.append(f"{label}: options of {key[0]} › {str(key[1])[:80]} — a test this group\'s listing does not hold")\n            continue\n',
            '')],
            T_COV, "test_a_foreign_options_record_never_lowers_a_known_expected_failure"),
    "C46": ("one record for a name listed twice (R400 VM-I34 B)", [(COV,
            '        if key in broken or seen[key] != n:', '        if key in broken or seen[key] == 0:')],
            T_COV, "test_a_name_listed_twice_needs_a_record_for_each"),
    "C47": ("a later group lowers an expected failure (R400 VM-I34 B)", [(COV,
            '            unit_fails[key] = max(unit_fails.get(key, "plain"), s, key=_FAILS_RANK.__getitem__)',
            '            unit_fails[key] = s')],
            T_COV, "test_across_the_groups_the_stricter_state_stays"),
    "C48": ("an unknown expected failure reads passed (R400 VM-I34 A)", [(COV,
            '                    elif not why and "unknown" in states:', '                    elif False:')],
            T_COV, "test_an_options_record_without_a_boolean_fails_leaves_the_test_unknown_never_passed"),
    "C49": ("a retry with two results still admits its attempt (R400 VM-I33 B)", [(COV,
            '                            "results": {r.get("retry"): r.get("status") for r in t.get("results") or []\n                                        if retries[r.get("retry")] == 1}}',
            '                            "results": {r.get("retry"): r.get("status") for r in t.get("results") or []}}')],
            T_COV, "test_a_retry_without_one_result_admits_no_attempt"),
    "C50": ("another run's report still feeds evidence (R400's class)", [(COV,
            '        ran = playwright_index(rep if rep is not None and report not in foreign else {}, report, errors)',
            '        ran = playwright_index(rep or {}, report, errors)')],
            T_COV, "test_another_run_s_record_or_a_renamed_id_feeds_no_evidence"),
    "C51": ("a renamed id keeps the report's status (R400's class)", [(COV,
            '                ran[key] = {**x, "status": "contradictory (the report names another test)", "results": {}}\n',
            '')],
            T_COV, "test_another_run_s_record_or_a_renamed_id_feeds_no_evidence"),
    "C52": ("an id twice keeps its first instance as evidence (R400's class)", [(COV,
            '                    out[key] = {**out[key], "status": "contradictory (the id twice)", "results": {}}\n',
            '')],
            T_COV, "test_another_run_s_record_or_a_renamed_id_feeds_no_evidence"),
    "C53": ("another run's JUnit still feeds evidence (R400's class)", [(COV,
            '        gw = {}                                    # reported AND withheld (R400)\n', '')],
            T_COV, "test_another_run_s_junit_feeds_no_gateway_evidence"),
    "C54": ("a rejected native report still feeds evidence (R400 VM-I35)", [(COV,
            '    natives = valid                    # the evidence search reads only what passed (R400)\n', '')],
            T_COV, "test_a_rejected_native_report_is_named_invalid_never_a_pass_source"),
    "C55": ("a rejected native report reads as not run (R400 VM-I35)", [(COV,
            '                          else "invalid report of this commit" if (e.get("profile"), v) in rejected\n', '')],
            T_COV, "test_a_rejected_native_report_is_named_invalid_never_a_pass_source"),
    "C56": ("a clean report replaces a contradictory listing (R401 VM-I33)", [(COV,
            '    if str(listed.get("status", "")).startswith("contradictory"):\n        return {**listed, "results": {}}\n', '')],
            T_COV, "test_a_contradictory_listing_survives_the_join_and_admits_no_attempt"),
    "C57": ("a unit name's result count unchecked against its listing (R401 VM-I34)", [(COV,
            '        if n != want[key]:\n', '        if False:\n')],
            T_COV, "test_a_missing_unit_result_or_a_passing_group_never_makes_a_failure_pass"),
    "C58": ("a later group's result overwrites an earlier group's (R401 VM-I34)", [(COV,
            '            unit[key] = st if key not in unit else _worst(unit[key], st)\n',
            '            unit[key] = st\n')],
            T_COV, "test_a_missing_unit_result_or_a_passing_group_never_makes_a_failure_pass"),
    "C59": ("a unit name's result count unchecked: the index guard (R401 VM-I34)", [(COV,
            '        if n != want[key]:\n', '        if False:\n')],
            T_COV, "test_a_unit_name_needs_exactly_as_many_results_as_the_listing_holds"),
    "C60": ("a repeated JSON key in a gate artefact keeps its last value (R402 class check)", [(COV,
            '        return live_drivers.loads_strict(path.read_text())\n', '        return json.loads(path.read_text())\n')],
            T_COV, "test_a_repeated_json_key_is_a_damaged_artefact_withheld_never_its_last_value"),
    "C61": ("a repeated JSON key in a live report keeps its last value (R402 class check)", [(LIVE,
            '        r = loads_strict(path.read_text())\n', '        r = json.loads(path.read_text())\n')],
            T_COV, "test_a_repeated_json_key_is_a_damaged_artefact_withheld_never_its_last_value"),
    "C62": ("a native case twice in one report accepted (R402 class check)", [(COV,
            '        if twice:\n', '        if False:\n')],
            T_COV, "test_a_native_case_twice_in_one_report_rejects_the_report"),
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
