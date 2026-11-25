"""P5 red proofs (plan v6, Codex R444; operator 2026-11-23/24): each mutation breaks ONE
rule; its named guard must fail AT that rule. Run from the tree's root; every file is
restored byte-identical. `py` = a backend guard (pytest; the mutated file must compile),
`vi` = a unit guard (vitest), `pw` = a browser guard; for `vi` and `pw` the build must be
green with the mutation (an unused binding fails vue-tsc and the old page would be tested).

  python3 scripts/test_support/heavy_lock.py --who p5 -- python3 -I docs/reviews/p5.mutations.py [name ...]
"""
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
# never the shared home (an install probe's isolation check reads it, 2026-11-24): the
# binaries directly, npm with its own cache
BIN = ROOT / "lcnc-webui/node_modules/.bin"
CACHE = pathlib.Path.home() / "claude-work/p5/npm-cache"
ENV = {**os.environ, "PATH": f"{BIN}:{os.environ['PATH']}", "npm_config_cache": str(CACHE), "npm_config_logs_dir": str(CACHE / "_logs"),
       "npm_config_update_notifier": "false", "NO_COLOR": "1"}
G, W, S, N = "lcnc-gateway/", "lcnc-webui/", "lcnc-webui/src/", "subroutines/probe_basic/"


def py(file, test, at):
    """A pytest guard: `test` is its -k expression, `at` what its failure must show."""
    return ("py", [file, test, at])


def vi(file, at):
    return ("vi", [file, at])


def pw(grep, at, spec="e2e/probe-calibration.spec.ts"):
    return ("pw", [spec, grep, at])


MUTS = {
    # ---- the run, its token and its proofs (P5-1 b)
    "a_message_of_any_run_counts": (G + "cal_runs.py", [(
        "        if r is None or m.run != r.run:", "        if r is None:")],
        [py("test_cal_runs.py", "late_message_never_becomes_run_b_s", "test_run_a_s_late_message_never_becomes_run_b_s")]),
    "offered_before_the_channel_is_proven_empty": (G + "cal_runs.py", [(
        "            if c.drained is not None:\n                return                  # the end is not proven: a message may still be in the channel\n", "")],
        [py("test_cal_runs.py", "channel_read_empty_after_the_rest", "test_the_end_needs_the_channel_read_empty_after_the_rest")]),
    "idle_alone_is_rest": (G + "cal_runs.py", [(
        "    return (fields.get(\"state\") == c.get(\"RCS_DONE\", 1) and fields.get(\"interp_state\") == c.get(\"INTERP_IDLE\", 1)\n"
        "            and fields.get(\"queued\") == 0 and fields.get(\"exec_state\") == c.get(\"EXEC_DONE\", 2))",
        "    return fields.get(\"interp_state\") == c.get(\"INTERP_IDLE\", 1)")],
        [py("test_cal_runs.py", "rest_is_more_than_idle", "test_the_rest_is_more_than_idle"),
         py("test_cal_gateway.py", "no_proof_no_start", "test_no_proof_no_start")]),
    "an_abort_is_not_booked": (G + "gateway.py", [(
        "        await _cmd_blocking(link(), op(linuxcnc.command.abort), wait=None,\n"
        "                            began=lambda: _cal.note_end_of_machine(WHY_ABORT))",
        "        await _cmd_blocking(link(), op(linuxcnc.command.abort), wait=None)")],
        [py("test_cal_gateway.py", "abort_in_the_retract", "test_abort_in_the_retract_gives_no_candidate")]),
    "an_error_in_the_window_passes": (G + "cal_runs.py", [(
        "            if r is not None and kind not in NOT_ERRORS and r.fault is None:",
        "            if r is not None and kind not in NOT_ERRORS and r.fault == \"\":")],
        [py("test_cal_runs.py", "error_estop_or_power_off", "test_an_error_estop_or_power_off_in_the_window_is_not_offered")]),
    "an_estop_passes": (G + "cal_runs.py", [("        if r.fault is None and c.estop:", "        if r.fault is None and c.estop is None:")],
        [py("test_cal_runs.py", "error_estop_or_power_off", "test_an_error_estop_or_power_off_in_the_window_is_not_offered")]),
    "a_result_on_another_link_counts": (G + "cal_runs.py", [(
        "        if link_seq is None or link_seq != r.link_seq:\n            self._emit(\"cal.message_other_link\"",
        "        if link_seq is None:\n            self._emit(\"cal.message_other_link\""), (
        "        if c.link_seq != r.link_seq:\n            self._end(r, WHY_LINK)\n            return\n", "")],
        [py("test_cal_runs.py", "link_change_in_the_run", "test_a_link_change_in_the_run_is_not_offered")]),
    "an_idle_interpreter_is_a_start": (G + "cal_runs.py", [(
        "WHY_NOT_STARTED if not r.started else", "WHY_NOT_STARTED if r.started is None else")],
        [py("test_cal_runs.py", "only_stays_idle", "test_an_interpreter_that_only_stays_idle_did_not_start")]),
    "an_old_routine_s_value_is_no_fault": (G + "cal_runs.py", [(
        "                if self.run is not None and self.run.fault is None:\n                    self.run.fault = WHY_ROUTINE\n", "")],
        [py("test_cal_runs.py", "old_routine_is_a_warning", "test_an_old_routine_is_a_warning_never_a_candidate")]),
    "the_base_revision_is_not_compared": (G + "cal_runs.py", [(
        "                                     WHY_BASE if base_rev != r.base_rev else None))",
        "                                     None))"), (
        "        elif base_rev is not None and base_rev != cand.base_rev:\n            self._stale(cand, WHY_BASE)\n", "")],
        [py("test_cal_runs.py", "active_offset_changed_since", "test_the_active_offset_changed_since_the_start")]),
    "the_running_cycle_answers_the_drain": (G + "cal_runs.py", [(
        "        if number <= self.cycle:", "        if number < self.cycle:")],
        [py("test_cal_runs.py", "cycle_already_running", "test_a_cycle_already_running_does_not_serve_it"),
         py("test_cal_gateway.py", "cycle_already_running", "test_the_cycle_already_running_does_not_answer")]),
    "a_bounded_read_counts_as_empty": (G + "status_runtime.py", [(
        "        return out, \"more messages than one read takes\"", "        return out, None")],
        [py("test_cal_gateway.py", "no_proof_no_start", "test_no_proof_no_start")]),
    "a_failed_read_counts_as_empty": (G + "status_runtime.py", [(
        "            return out, f\"error channel not read ({type(e).__name__})\"", "            return out, None")],
        [py("test_cal_gateway.py", "no_proof_no_start", "test_no_proof_no_start")]),
    "the_token_before_the_disk": (G + "cal_runs.py", [("        _write_through(path, data)\n", "        pass\n")],
        [py("test_cal_runs.py", "on_the_disk_before", "test_the_next_token_is_on_the_disk_before_the_token_is_given")]),
    "a_fraction_is_a_token": (G + "cal_runs.py", [(
        "    if isinstance(nxt, bool) or not isinstance(nxt, int) or not 1 <= nxt <= MAX_RUN + 1:",
        "    if isinstance(nxt, bool) or not isinstance(nxt, (int, float)) or not 1 <= nxt <= MAX_RUN + 1:")],
        [py("test_cal_runs.py", "no_token_is_refused", "test_a_value_that_is_no_token_is_refused_never_rounded")]),
    "the_used_up_counter_starts_again": (G + "cal_runs.py", [(
        "    if n > MAX_RUN:\n        raise CounterError(\"Calibration run ids used up\")", "    if n > MAX_RUN:\n        n = 1")],
        [py("test_cal_runs.py", "last_token_then_used_up", "test_the_last_token_then_used_up_by_name_also_after_a_restart")]),
    "one_counter_for_every_ini": (G + "cal_runs.py", [(
        "    if ini not in data:\n        return None\n    entry = data[ini]",
        "    if not data:\n        return None\n    entry = next(iter(data.values()))")],
        [py("test_cal_runs.py", "two_inis", "test_two_inis_of_one_folder_count_for_themselves")]),
    "the_candidate_goes_before_the_call_begins": (G + "gateway.py", [(
        "            _cal_last_reserved = n\n", "            _cal_last_reserved = n\n            _cal.supersede(\"a start\")\n")],
        [py("test_cal_gateway.py", "refused_chunk_opens_no_run", "test_a_refused_chunk_opens_no_run_and_keeps_the_candidate")]),
    "a_call_that_raised_is_a_run": (G + "gateway.py", [(
        "                    _cal.call_failed(run)       # its effect is unknown: nothing is offered\n", "                    pass\n")],
        [py("test_cal_gateway.py", "call_that_raises", "test_a_call_that_raises_offers_nothing")]),
    # ---- Apply / Discard / Reset (P5-1 d)
    "the_commit_without_the_writer": (G + "gateway.py", [(
        "        why = _writer_refusal(conn_key)\n        if not why and not switches[\"probing\"]:",
        "        why = None\n        if not why and not switches[\"probing\"]:")],
        [py("test_cal_gateway.py", "commit_admits", "test_the_commit_admits_arm_switch_revision_and_link_at_the_write")]),
    "the_commit_without_the_switch": (G + "gateway.py", [(
        "        if not why and not switches[\"probing\"]:\n            why = _features.off_reason(\"probing\")\n", "")],
        [py("test_cal_gateway.py", "commit_admits", "test_the_commit_admits_arm_switch_revision_and_link_at_the_write")]),
    "the_commit_without_the_candidate": (G + "gateway.py", [(
        "            why = _cal.refusal(run, _cal_rev_of(record), owner.seq if owner is not None else None)\n        if why:\n            raise PermissionError(why)",
        "            assert owner is not None or True\n        if why:\n            raise PermissionError(why)")],
        [py("test_cal_gateway.py", "commit_admits", "test_the_commit_admits_arm_switch_revision_and_link_at_the_write")]),
    "a_stored_apply_may_be_open_again": (G + "gateway.py", [(
        "        _cal.decided(run, \"applied\")\n        if out.get(\"cancelled\"):", "        if out.get(\"cancelled\"):")],
        [py("test_cal_gateway.py", "cancel_before_the_write_began", "test_a_cancel_before_the_write_began_is_saved_not_written"),
         py("test_cal_gateway.py", "repeat_answers", "test_a_repeat_answers_already_applied_without_a_second_write")]),
    "a_refused_store_takes_the_result": (G + "gateway.py", [(
        "        if stored is None:\n            _cal.undecided(run)\n", "        if stored is None:\n            _cal.decided(run, \"applied\")\n")],
        [py("test_cal_gateway.py", "store_s_refusal", "test_the_store_s_refusal_keeps_the_result_open")]),
    "the_machine_write_without_its_admission": (G + "gateway.py", [(
        "        return (_writer_refusal(conn_key) or _feature_refusal(\"probing\") or _controller_gate_refusal(\"ready\", True)\n",
        "        return (_controller_gate_refusal(\"ready\", True)\n")],
        [py("test_cal_gateway.py", "disarmed_or_switched_off", "test_disarmed_or_switched_off_between_the_store_and_the_write")]),
    "another_value_is_applied": (G + "gateway.py", [(
        "        if cand is None or cand.value is None or canonical_param(cand.value) != value:",
        "        if cand is None or cand.value is None:")],
        [py("test_cal_gateway.py", "another_value", "test_another_value_than_the_result_is_refused")]),
    "reset_leaves_the_candidate_open": (G + "gateway.py", [("        _cal.supersede(\"reset\")\n", "")],
        [py("test_cal_gateway.py", "reset_supersedes", "test_reset_supersedes_and_a_late_apply_meets_it")]),
    "a_client_may_save_the_record": (G + "settings_store.py", [(
        "        if section in GATEWAY_SECTIONS:\n            raise PermissionError(GATEWAY_SECTION_REFUSAL)\n", "")],
        [py("test_settings_store.py", "every_client_save", "test_every_client_save_is_refused")]),
    # ---- the chunk states (the begin hook)
    "a_chunk_without_its_begin": (G + "gateway.py", [(
        "                    st[\"state\"] = \"written_unknown\"     # from here: an effect, until its end is proven\n",
        "                    st.get(\"state\")\n")],
        [py("test_cal_gateway.py", "sent_then_timed_out", "test_sent_then_timed_out"),
         py("test_cal_gateway.py", "call_raised_after_its_begin", "test_the_call_raised_after_its_begin")]),
    "a_timed_out_chunk_is_taken": (G + "gateway.py", [(
        "                inflight = None\n                if _cmd_rc_failed(ret):   # success is RCS_DONE (1), not 0\n                    mdi_ok = False\n",
        "                inflight = None\n                if _cmd_rc_failed(ret):   # success is RCS_DONE (1), not 0\n                    mdi_ok = False\n                    state[\"state\"] = \"taken\"\n")],
        [py("test_cal_gateway.py", "sent_then_timed_out", "test_sent_then_timed_out")]),
    "a_refused_chunk_is_unknown": (G + "gateway.py", [(
        "        chunk_states = [{\"keys\": sorted(str(k) for k in b), \"state\": \"not_written\"} for _c, b in chunks]",
        "        chunk_states = [{\"keys\": sorted(str(k) for k in b), \"state\": \"written_unknown\"} for _c, b in chunks]")],
        [py("test_cal_gateway.py", "refused_at_the_mode_switch", "test_refused_at_the_mode_switch"),
         py("test_cal_gateway.py", "refused_right_before", "test_refused_right_before_the_write")]),
    # ---- #3032's one writer, the units, the migration (P5-1 c)
    "a_probe_without_the_active_offset": (G + "gateway.py", [(
        "            vars_to_set = {**vars_to_set, str(OFFSET_KEY): value}\n", "            vars_to_set = {**vars_to_set}\n")],
        [py("test_cal_gateway.py", "gets_the_active_value", "test_a_probing_job_gets_the_active_value_from_the_gateway")]),
    "no_offset_is_zero": (G + "gateway.py", [("        return None, _CAL_NONE\n", "        return 0.0, None\n")],
        [py("test_cal_gateway.py", "no_offset_is_refused", "test_no_offset_is_refused_by_name")]),
    "the_page_s_offset_is_taken": (G + "command_policy.py", [("GATEWAY_VARS = frozenset({3032})", "GATEWAY_VARS = frozenset()")],
        [py("test_feature_switches.py", "offset_from_the_page", "test_an_offset_from_the_page_is_refused_for_every_purpose")]),
    "the_unit_only_before_the_queue": (G + "gateway.py", [(
        "                or _interp_idle_refusal() or (_probe_unit_refusal() if in_form_unit else None))\n    if purpose == \"calibration\"",
        "                or _interp_idle_refusal())\n    if purpose == \"calibration\"")],
        [py("test_cal_gateway.py", "switch_to_g20_between", "test_a_switch_to_g20_between_the_admission_and_the_call_is_seen")]),
    "an_unread_unit_is_mm": (G + "gateway.py", [(
        "    return _LENGTH_UNIT_NAMES.get(str(raw).strip().lower()) if raw else None",
        "    return _LENGTH_UNIT_NAMES.get(str(raw).strip().lower(), \"mm\") if raw else \"mm\"")],
        [py("test_cal_gateway.py", "declared_unit_is_never_a_default", "test_a_declared_unit_is_never_a_default")]),
    "a_migration_runs_again": (G + "settings_store.py", [(
        "            if isinstance(found, dict):\n                return copy.deepcopy(found), False\n            all_data",
        "            all_data")],
        [py("test_settings_store.py", "migration_is_one_write", "test_the_migration_is_one_write_and_happens_once")]),
    "a_page_save_brings_the_offset_back": (G + "settings_store.py", [(
        "        if section == \"probe\" and \"calOffset\" in data:", "        if section == \"probe\" and \"calOffset\" in data and not data:")],
        [py("test_settings_store.py", "loses_the_key", "test_the_probe_section_loses_the_key_on_every_save"),
         py("test_cal_gateway.py", "another_client_s_form", "test_another_client_s_form_never_brings_an_old_offset_back")]),
    # ---- the booking (P5-2 b)
    "a_booking_survives_its_link": (G + "probe_book.py", [(
        "        if out[\"outcome\"] in (\"applied\", \"read\") and (link_seq is None or out[\"link\"] != link_seq):",
        "        if out[\"outcome\"] in (\"applied\", \"read\") and link_seq is None:")],
        [py("test_probe_book.py", "link_change_makes", "test_a_link_change_makes_every_entry_unknown")]),
    "no_invalidation_at_the_begin": (G + "gateway.py", [(
        "        if touches_probe:\n            _probe_book.invalidate(probe_keys, probe_job or kind or command.name)\n", "")],
        [py("test_cal_gateway.py", "unknown_before_the_possible_effect", "test_it_is_unknown_before_the_possible_effect"),
         py("test_cal_gateway.py", "reinitialised_interpreter", "test_a_reinitialised_interpreter_is_all")]),
    "invalidated_before_the_queue": (G + "gateway.py", [(
        "    touches_probe = kind is not None or command.name == \"reset_interpreter\"\n",
        "    touches_probe = kind is not None or command.name == \"reset_interpreter\"\n"
        "    if kind == \"mdi\":\n        _probe_book.invalidate(None, \"early\")\n")],
        [py("test_cal_gateway.py", "own_job_books_exactly", "test_the_own_job_books_exactly_its_chunks")]),
    "a_found_file_is_proof": (G + "gateway_util.py", [(
        "    want = frozenset(keys)\n    if not want <= env.keys:\n        return None\n    _, mode = position_write_lines(text or \"\")\n    if mode == \"foreign\":\n        return None\n",
        "    want = frozenset(keys)\n    if not want <= env.keys:\n        return None\n")],
        [py("test_probe_book.py", "call_into_another_file", "test_a_call_into_another_file_is_any_even_when_it_is_found")]),
    "the_remap_reader_knows_only_the_toolsetter": (G + "gateway_util.py", [(
        "                if k in self.keys:\n                    writes.add(k)", "                if k in TOOLSETTER_BASIS_KEYS:\n                    writes.add(k)")],
        [py("test_probe_book.py", "remapped_code_carries", "test_a_remapped_code_carries_its_body")]),
    "any_file_of_the_name_is_the_bundled_one": (G + "probe_book.py", [(
        "        if row is None or raw is None or hashlib.sha256(raw).hexdigest() != row[0]:", "        if row is None or raw is None or not hashlib.sha256(raw).hexdigest():")],
        [py("test_probe_book.py", "needs_the_bundled_file", "test_a_proven_effect_needs_the_bundled_file_and_its_calls")]),
    "a_chunk_lifts_the_call_s_invalidation": (G + "probe_book.py", [(
        "                self._e[k] = {\"value\": None, \"outcome\": \"unknown\", \"t\": now, \"link\": None, \"job\": why,\n"
        "                              \"persisted\": None, \"refused\": None}",
        "                self._e[k] = {**(old or {\"value\": None, \"link\": None}), \"outcome\": \"unknown\", \"t\": now, \"job\": why,\n"
        "                              \"persisted\": None, \"refused\": None}"), (
        "                if e is not None and e[\"outcome\"] == \"applied\":\n                    e[\"persisted\"] = bool(ok)",
        "                if e is not None:\n                    e.update(outcome=\"applied\", persisted=bool(ok))")],
        [py("test_probe_book.py", "restores_a_key", "test_only_the_next_write_or_a_read_restores_a_key")]),
    # ---- the bundled routines (P5-1 a), on the real interpreter
    "the_routine_zeroes_3032": (N + "probe_cal_round_pocket.ngc", [("  #1014 = #1\n", "  #1014 = #1\n  #3032 = 0\n")],
        [py("test_cal_routines.py", "abort_at_the_first_probe", "test_an_abort_at_the_first_probe_leaves_the_active_offset"),
         py("test_probe_book.py", "table_follows", "test_the_table_follows_the_files")]),
    "the_result_line_before_its_value": (N + "probe_cal_round_boss.ngc", [(
        "  o150 endif\n\n  (LCNC Suite: the result with its run token, consumed by the gateway)\n  (DEBUG, LCNC_CAL_CANDIDATE run=#1014 value=#1013 axis=#3036)\n",
        "  o150 endif\n"), ("  #<new_avg_cal_offset> = [", "  (DEBUG, LCNC_CAL_CANDIDATE run=#1014 value=#1013 axis=#3036)\n  #<new_avg_cal_offset> = [")],
        [py("test_cal_routines.py", "computes_what_upstream", "test_each_routine_computes_what_upstream_did_and_leaves_3032")]),
    "one_probing_call_keeps_the_offset": (N + "probe_cal_square_boss.ngc", [(
        "  (Call sub \"probe_x_plus\" to Probe x+ side of Workpiece)\n  o<probe_x_plus> call [#3014][#3015][#3016][#3017][#3018][#3019][0]",
        "  (Call sub \"probe_x_plus\" to Probe x+ side of Workpiece)\n  o<probe_x_plus> call [#3014][#3015][#3016][#3017][#3018][#3019][#3032]")],
        [py("test_cal_routines.py", "computes_what_upstream", "test_each_routine_computes_what_upstream_did_and_leaves_3032")]),
    # ---- the page: the field states (P5-2 a)
    "a_refusal_marks_the_value": (S + "fieldState.ts", [(
        "    if (c && c.id === id) c.refused = ok ? null : why;", "    if (c && id) c.refused = ok ? null : why;")],
        [vi("src/fieldState.test.ts", "a late refusal of the first 50 belongs to change 1, not to the second 50")]),
    "a_value_entered_again_is_no_change": (S + "defaults.ts", [(
        "  const keys = [...new Set([...edited, ...changedKeys(key, data)])];", "  const keys = edited.length < 0 ? [...edited] : changedKeys(key, data);")],
        [vi("src/fieldState.test.ts", "a refusal marks the refused change; the next edit is a draft")]),
    "every_field_of_a_refused_save_is_red": (S + "fieldState.ts", [(
        "    out[k] = same(v, h[k]) ? null : m?.get(k)?.refused ? \"refused\" : \"draft\";",
        "    out[k] = m?.get(k)?.refused ? \"refused\" : same(v, h[k]) ? null : \"draft\";")],
        [vi("src/fieldState.test.ts", "a stale refusal: the form shows the server's state")]),
    "a_red_bar_about_arming": (S + "fieldState.ts", [(
        "  if (!ok && why.startsWith(ARM_REFUSAL)) return;\n", "")],
        [vi("src/fieldState.test.ts", "a writer without arm is no refused field")]),
    "a_draft_is_part_of_the_claim": (S + "probeMachine.ts", [(
        "    if (states[fields[k] ?? \"\"]) continue;          // a draft or a refused change: its own bar\n", "    void states;\n    void fields;\n")],
        [vi("src/probeMachine.test.ts", "a field with a bar is no part of the claim")]),
    "an_unknown_value_is_on_the_machine": (S + "probeMachine.ts", [(
        "  if (unknown) return { kind: \"unknown\" };\n", "  if (unknown && !taken) return { kind: \"unknown\" };\n")],
        [vi("src/probeMachine.test.ts", "one unknown value makes the line unknown")]),
    "no_candidate_is_not_carried": (S + "ws/statusStore.ts", [(
        "    if (msg[k] !== undefined) _probeState[k] = msg[k];", "    if (msg[k]) _probeState[k] = msg[k];")],
        [vi("src/ws/statusStore.test.ts", "a candidate that ended is null, not the last one")]),
    "a_refusal_of_another_run_shows": (S + "calibrationView.ts", [(
        "refusal.kind !== \"cal_reset\" && refusal.run === candidate.run)", "refusal.kind !== \"cal_reset\")")],
        [vi("src/calibrationView.test.ts", "a refusal is shown only for the run it was given for")]),
    # ---- the page, read from the DOM
    "a_text_under_the_field": (S + "FormField.vue", [(
        "    <span v-if=\"state\" :id=\"stateId\" hidden>", "    <span v-if=\"state\" :id=\"stateId\">")],
        [pw("fields at desktop", "the draft keeps every cell's size")]),
    "the_section_line_wraps": (S + "style.css", [(
        "  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.sectionLine.refused", "  overflow: hidden;\n}\n.sectionLine.refused")],
        [pw("fields at narrow-150", "the longest text is still one line")]),
    "the_light_bar_is_warn": (S + "style.css", [(
        "  box-shadow: inset 3px 0 0 var(--field-draft);", "  box-shadow: inset 3px 0 0 var(--warn);")],
        [pw("the bars hold 3 : 1 against their field and its surroundings \\(light\\)", "light draft against its field")]),
    "the_reason_not_in_the_row": (S + "ProbePanel.vue", [(
        "data-cal=\"detail\">{{ calView.refusal ?? calView.note.detail }}</span>", "data-cal=\"detail\">{{ calView.note.detail }}</span>")],
        [pw("no answer claims no outcome", "the row says why")]),
    "apply_without_arm": (S + "machineControls.ts", [(
        "  calApply:       { gate: 'armed', ", "  calApply:       { gate: 'always', ")],
        [pw("disarmed: Apply, Discard, Reset", "Apply is closed while disarmed")]),
    "the_page_shows_its_own_reply": (S + "ProbePanel.vue", [(
        "        <div v-if=\"calView.note?.kind === 'pending'\" class=\"statusNote warn\"",
        "        <div v-if=\"calView.note?.kind === 'pending' && !calDone\" class=\"statusNote warn\""), (
        "  if (why !== undefined) calRefusal.value = { kind, run: note.run, why };\n",
        "  if (why !== undefined) calRefusal.value = { kind, run: note.run, why };\n  else calDone.value = true;\n"), (
        "const calRefusal = ref<CalRefusal | null>(null);\n", "const calRefusal = ref<CalRefusal | null>(null);\nconst calDone = ref(false);\n")],
        [pw("Apply names its run and value", "the candidate stays until the status says otherwise")]),
}


def failures(out):
    return [line.strip()[:200] for line in out.splitlines()
            if "FAILED" in line or "✘" in line or line.lstrip().startswith(("FAIL ", "× ", "Error: "))]


def at_failing(name, out):
    """`name` only where a FAILING test's line says it: vitest and Playwright
    list the passing tests of the file too."""
    return name if any(name in line for line in failures(out)) else "\0"


def build():
    b = subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900, env=ENV)
    return b.returncode == 0, b.stdout + b.stderr


def run_guard(kind, args):
    if kind == "py":
        r = subprocess.run([".venv/bin/python3", "-m", "pytest", "-q", "-p", "no:cacheprovider", "-x", args[0], "-k", args[1]],
                           cwd=ROOT / "lcnc-gateway", capture_output=True, text=True, timeout=600)
        # 1 = tests failed; 5 = none collected (the guard is gone) is no red proof
        return r.returncode == 1, r.stdout + r.stderr, f"FAILED {args[0]}::" if args[2] in (r.stdout + r.stderr) else "\0"
    if kind == "vi":
        r = subprocess.run([str(BIN / "vitest"), "run", args[0]], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=600, env=ENV)
        return r.returncode != 0, r.stdout + r.stderr, at_failing(args[1], r.stdout + r.stderr)
    if kind == "pw":
        r = subprocess.run([str(BIN / "playwright"), "test", args[0], "-g", args[1], "--workers=1", "--reporter=list"],
                           cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=1800, env=ENV)
        return r.returncode != 0, r.stdout + r.stderr, at_failing(args[2], r.stdout + r.stderr)
    raise SystemExit(f"unknown guard kind {kind}")


def main(names):
    out = {}
    for name in names or list(MUTS):
        path, reps, guards = MUTS[name]
        f = ROOT / path
        orig = f.read_bytes()
        text = orig.decode()
        kinds = {k for k, _a in guards}
        built, log = True, ""
        try:
            for old, new in reps:
                if text.count(old) != 1:
                    raise SystemExit(f"{name}: anchor not unique ({text.count(old)}) in {path}: {old[:70]!r}")
                text = text.replace(old, new)
            f.write_text(text)
            if path.endswith(".py"):
                compile(text, path, "exec")
            if kinds & {"vi", "pw"}:
                built, log = build()
            results = [run_guard(k, a) for k, a in guards] if built else [(False, log, "\0")]
        finally:
            f.write_bytes(orig)
        red = built and all(r for r, _o, _a in results)
        at_rule = red and all(at in o for _r, o, at in results)
        out[name] = {"red": red, "at_rule": at_rule}
        print(json.dumps({"mutation": name, "built": built, "red": red, "at_rule": at_rule,
                          "failures": [failures(o)[:3] for _r, o, _a in results]}, ensure_ascii=False), flush=True)
    if any(set(k for k, _a in MUTS[n][2]) & {"vi", "pw"} for n in out):
        build()     # the page back to the tree's own build
    print(json.dumps({"total": len(out), "red": sum(v["red"] for v in out.values()),
                      "red_at_rule": sum(v["at_rule"] for v in out.values())}))
    return 0 if all(v["at_rule"] for v in out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
