"""P6 "tool files read" red proofs (plan maschinentag.r465 v4 §10, Codex R465
MT465-01 / MT-TF1 / Q465-1, Codex R468 MT-I35..MT-I37 / TF-1): each mutation breaks ONE rule; its named guards
must fail AT that rule (`at`: a text the failing output must carry — the
failing test's name or its assertion message). Run from the tree's root;
every file is restored byte-identical. Page guards (pw) rebuild the page with
the mutation and run their spec — under the heavy lock (the page is rebuilt
from the restored tree afterwards).

  python3 scripts/test_support/heavy_lock.py --who p6tf -- python3 -I docs/reviews/p6tf.mutations.py [name ...]
"""
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
# the binaries themselves, never npx: it writes ~/.npm/_logs, and another tree's
# gate compares the home in its install probe ("home:.npm changed")
BIN = str(ROOT / "lcnc-webui/node_modules/.bin") + "/"
# Playwright's web server command is a bare `vite` (npx put the binaries on PATH)
ENV = {**os.environ, "PATH": BIN[:-1] + os.pathsep + os.environ.get("PATH", "")}
G = "lcnc-gateway/"
PROOF = G + "tool_proof.py"
TABLE = G + "tool_table.py"
GW = G + "gateway.py"
STORE = "lcnc-webui/src/toolTableRead.ts"
PANEL = "lcnc-webui/src/ToolTablePanel.vue"
TP = "test_tool_proof.py::"
TG = "test_tool_proof_gateway.py::"
TS = "test_tool_store.py::TestToolLibraryStore::"
STRICT = G + "tool_store.py"
VT = "src/toolTableRead.test.ts"
SPEC = "e2e/tool-table-read.spec.ts"
STATE_SPEC = "the read's proof"


def py(node, at):
    return ("pytest", [node, at])


def vt(name, at):
    return ("vitest", [VT, name, at])


def pw(grep, at):
    return ("pw", [SPEC, grep, at])


MUTS = {
    # ---- rule R (tool_proof.py) -------------------------------------------
    "no_newline_clause": (PROOF, [(
        "                or (nl and file_ts == mem_ts and len(proven) == len(rows) and not unread))",
        "                or (file_ts == mem_ts and len(proven) == len(rows) and not unread))")],
        [py(TP + "TestTF1EveryCutIsNotComplete::test_a_last_line_remark_cut", "test_a_last_line_remark_cut"),
         py(TP + "TestTF1EveryCutIsNotComplete::test_every_cut_of_150_tools", "cut at")]),
    "no_tool_set_clause": (PROOF, [(
        "                or (nl and file_ts == mem_ts and len(proven) == len(rows) and not unread))",
        "                or (nl and len(proven) == len(rows) and not unread))")],
        [py(TP + "TestTF1EveryCutIsNotComplete::test_a_cut_at_a_line_end", "test_a_cut_at_a_line_end"),
         py(TP + "TestTF1EveryCutIsNotComplete::test_every_cut_of_50_tools", "cut at")]),
    "exact_comparison": (PROOF, [(
        "        elif not abs(float(have) - float(want)) <= TOL:",
        "        elif not abs(float(have) - float(want)) <= 0.0:")],
        [py(TP + "TestTF3Rounding::test_the_printed_digits_are_proven_a_micron_is_not",
            "test_the_printed_digits_are_proven_a_micron_is_not"),
         py(TP + "TestTheRealStatDumps::test_every_checkpoint_is_complete", "test_every_checkpoint_is_complete")]),
    "the_file_against_itself": (PROOF, [(
        "    memory = home_entries(table)\n",
        "    memory = {int(r['T']): [{k: float(r.get(k, 0)) for k, _a in STAT_FIELDS}] for r in rows}\n")],
        [py(TP + "TestTF1EveryCutIsNotComplete::test_every_cut_of_50_tools", "cut at"),
         py(TP + "TestTF2OldFileNewMemory::test_the_changed_tool_differs", "test_the_changed_tool_differs")]),
    "index_0_compared": (PROOF, [(
        "        if idx < 1:\n            continue\n        tid = int(t.id)",
        "        if idx < 0:\n            continue\n        tid = int(t.id)")],
        [py(TP + "TestTF5Scope::test_index_0_is_the_spindle_copy_and_ignored",
            "test_index_0_is_the_spindle_copy_and_ignored"),
         py(TP + "TestTheRealStatDumps::test_every_checkpoint_is_complete", "test_every_checkpoint_is_complete")]),
    "t0_skipped_as_in_the_plan": (PROOF, [(
        "        if tid == -1:\n", "        if tid <= 0:\n")],
        [py(TP + "TestTF5Scope::test_t0_is_a_home_entry_like_io_saves_it", "test_t0_is_a_home_entry_like_io_saves_it")]),
    "an_empty_controller_table_is_no_tools": (PROOF, [(
        "    if not table:\n        proof[\"why\"] = NOT_READ\n",
        "    if table is None:\n        proof[\"why\"] = NOT_READ\n")],
        [py(TP + "TestTF5Scope::test_an_unread_or_empty_controller_table_is_not_read_never_no_tools", "controller not read"),
         py(TG + "TestTheReadReply::test_an_empty_controller_table_is_not_read_never_no_tools",
            "test_an_empty_controller_table_is_not_read_never_no_tools")]),
    "the_signature_rule_of_v3": (GW, [(
        "    return data, scan, _tool_compare(scan, None if scope is not None else _stat_tool_table(), scope)\n",
        "    return data, scan, {**_tool_compare(scan, None if scope is not None else _stat_tool_table(), scope),\n"
        "                        \"state\": \"complete\", \"why\": None}\n")],
        [py(TG + "TestTheReadReply::test_partial_after_the_attempts_with_the_tools_named",
            "test_partial_after_the_attempts_with_the_tools_named"),
         py(TG + "TestMTTF1TheBasisMustBeComplete::test_a_clean_prefix_is_refused_at_the_basis_read",
            "test_a_clean_prefix_is_refused_at_the_basis_read")]),
    # ---- unread lines (tool_table.py) ---------------------------------------
    "unread_attached_to_the_first_t": (TABLE, [(
        "    return int(found[0].split(\".\")[0]) if len(found) == 1 else None\n",
        "    return int(found[0].split(\".\")[0]) if found else None\n")],
        [py(TP + "TestTF4Unread::test_a_line_without_a_whole_t_is_attached_to_nothing",
            "test_a_line_without_a_whole_t_is_attached_to_nothing")]),
    # ---- the library read strictly -----------------------------------------
    "the_library_read_not_strict": (GW, [(
        "        library = await asyncio.to_thread(_tool_lib_store.load, True)\n",
        "        library = await asyncio.to_thread(_tool_lib_store.load)\n")],
        [py(TG + "TestTheReadReply::test_a_corrupt_library_is_no_read_never_cached_rows",
            "test_a_corrupt_library_is_no_read_never_cached_rows")]),
    "the_library_cache_keyed_on_mtime": (G + "tool_store.py", [(
        "            sig = (st.st_ino, st.st_mtime_ns, st.st_size)\n", "            sig = st.st_mtime\n")],
        [py("test_tool_store.py::TestToolLibraryStore::test_a_write_in_the_same_mtime_is_no_cache_hit",
            "test_a_write_in_the_same_mtime_is_no_cache_hit"),
         py("test_tool_store.py::TestToolLibraryStore::test_a_strict_load_raises_never_the_cache",
            "test_a_strict_load_raises_never_the_cache")]),
    "an_unreadable_changer_is_nonrandom": (GW, [(
        "        except ValueError:\n            scope = _TOOL_SCOPE_UNKNOWN\n",
        "        except ValueError:\n            scope = None\n")],
        [py(TG + "TestTheScopeFromTheIni::test_the_scopes", "a value that does not read is never nonrandom")]),
    # ---- MT465-01: the post-write job ---------------------------------------
    "no_post_write_wait": (GW, [(
        "    if jobs and isinstance(reply, dict) and reply.get(\"ok\"):\n        reply = await _after_tool_write(jobs[-1], reply)\n",
        "")],
        [py(TG + "TestThePostWriteWait::test_the_reply_follows_linuxcnc_showing_the_write",
            "test_the_reply_follows_linuxcnc_showing_the_write")]),
    "the_wait_under_cmd_lock": (GW, [(
        "            with _pinned_link():\n                reply = await _handle_command_impl(msg, armed, conn_key)\n"
        "    finally:\n        _tool_jobs_of_command.reset(token)\n",
        "            with _pinned_link():\n                reply = await _handle_command_impl(msg, armed, conn_key)\n"
        "            if jobs and isinstance(reply, dict) and reply.get(\"ok\"):\n"
        "                await asyncio.shield(jobs[-1].task)\n"
        "    finally:\n        _tool_jobs_of_command.reset(token)\n")],
        [py(TG + "TestTheWaitIsNotInAStopsWay::test_a_ws_edit_abort_from_another_client", "the wait holds no _cmd_lock"),
         py(TG + "TestThePostWriteWait::test_the_reply_follows_linuxcnc_showing_the_write", "_cmd_lock FREE")]),
    "the_wait_inside_the_shield": (GW, [(
        "    job.task = register_bg_task(asyncio.ensure_future(_confirm_tool_write(job)))\n",
        "    job.task = register_bg_task(asyncio.ensure_future(_confirm_tool_write(job)))\n"
        "    await asyncio.shield(job.task)\n")],
        [py(TG + "TestTheWaitIsNotInAStopsWay::test_a_ws_edit_e_stop_from_another_client", "the wait holds no _cmd_lock"),
         py(TG + "TestTheWaitIsNotInAStopsWay::test_a_rest_import_abort_from_another_client",
            "the import's wait holds no _cmd_lock")]),
    "the_rest_wait_under_cmd_lock": (GW, [(
        "        async with _get_cmd_lock():\n            await _thread_to_end(asyncio.ensure_future(section()))\n"
        "        how = \"ok\"\n",
        "        async with _get_cmd_lock():\n            await _thread_to_end(asyncio.ensure_future(section()))\n"
        "            await asyncio.shield(jobs[-1].task)\n        how = \"ok\"\n")],
        [py(TG + "TestTheWaitIsNotInAStopsWay::test_a_rest_import_e_stop_from_another_client",
            "the import's wait holds no _cmd_lock")]),
    "a_superseded_wait_publishes": (GW, [(
        "        if job.outcome != \"superseded\" and job.seq == _tool_write_seq:\n",
        "        if True:\n")],
        [py(TG + "TestThePostWriteWait::test_a_newer_write_supersedes_an_old_wait_which_writes_nothing_back",
            "the old job published nothing")]),
    "the_wait_not_bound_to_its_write": (GW, [(
        "            if job.seq != _tool_write_seq:\n                job.outcome = \"superseded\"\n                return\n", "")],
        [py(TG + "TestThePostWriteWait::test_a_newer_write_supersedes_an_old_wait_which_writes_nothing_back",
            "bound to ITS write")]),
    "a_preempted_wait_answers_preempted": (GW, [(
        "            me = asyncio.current_task()\n            if me is not None:\n                me.uncancel()\n",
        "            raise\n")],
        [py(TG + "TestTheWaitIsNotInAStopsWay::test_a_ws_edit_abort_from_another_client", "never 'Preempted'")]),
    # (self-review before gate round 1: the comparison runs in a thread — its
    # binding is judged AFTER it; a wait never raises for a committed write)
    "the_binding_judged_before_the_comparison": (GW, [(
        "            proof = await asyncio.to_thread(_tool_job_compare, job)\n"
        "            if job.seq != _tool_write_seq:\n                job.outcome = \"superseded\"\n                return\n"
        "            if _link is not job.link:\n                job.outcome = \"controller changed\"\n"
        "                _trace.emit(\"tools.reload_controller_changed\", level=\"warn\", seq=job.seq)\n                return\n",
        "            if job.seq != _tool_write_seq:\n                job.outcome = \"superseded\"\n                return\n"
        "            if _link is not job.link:\n                job.outcome = \"controller changed\"\n"
        "                _trace.emit(\"tools.reload_controller_changed\", level=\"warn\", seq=job.seq)\n                return\n"
        "            proof = await asyncio.to_thread(_tool_job_compare, job)\n")],
        [py(TG + "TestThePostWriteWait::test_a_controller_that_changes_during_the_comparison_confirms_nothing",
            "never 'confirmed' by another controller's wait"),
         py(TG + "TestThePostWriteWait::test_a_newer_write_during_the_comparison_supersedes", "judged after the comparison")]),
    "a_failing_wait_raises": (GW, [(
        "        job.outcome = \"failed\"\n        _trace.emit_exc(\"tools.reload_wait_failed\", e, seq=job.seq)\n",
        "        job.outcome = \"failed\"\n        raise e\n")],
        [py(TG + "TestThePostWriteWait::test_a_wait_that_fails_answers_no_error_for_a_committed_write",
            "test_a_wait_that_fails_answers_no_error_for_a_committed_write")]),
    "another_controller_never_pings": (GW, [(
        "        if job.outcome != \"superseded\" and job.seq == _tool_write_seq:\n",
        "        if job.outcome not in (\"superseded\", \"controller changed\") and job.seq == _tool_write_seq:\n")],
        [py(TG + "TestThePostWriteWait::test_another_controller_ends_the_wait", "the ping goes")]),
    # ---- MT-TF1 --------------------------------------------------------------
    "no_basis_admission": (GW, [(
        "    why = _tool_basis_refusal(proof, scan)\n    if why is not None:\n",
        "    why = None\n    if why is not None:\n")],
        [py(TG + "TestMTTF1TheBasisMustBeComplete::test_a_clean_prefix_is_refused_at_the_basis_read",
            "test_a_clean_prefix_is_refused_at_the_basis_read")]),
    "the_basis_checked_only_early": (GW, [(
        "        try:\n            rows = _tool_edit_basis(tbl_path)\n        except ToolTableUnreadable:\n",
        "        try:\n            rows = parse_tool_table(tbl_path, True)\n        except ToolTableUnreadable:\n")],
        [py(TG + "TestMTTF1TheBasisMustBeComplete::test_the_basis_changed_in_the_write_thread_is_refused_there",
            "old file, new memory"),
         py(TG + "TestMTTF1TheBasisMustBeComplete::test_an_early_check_alone_is_not_the_admission",
            "the write thread's own admission")]),
    "add_without_a_base_compare": (GW, [(
        "        check = _tool_edit_check(tbl_path, tbl_tools, owner)\n        tbl_tools.append({",
        "        check = lambda: None   # noqa: E731\n        tbl_tools.append({")],
        [py(TG + "TestMTTF1TheBasisMustBeComplete::test_an_add_or_delete_compares_its_base_in_the_write_thread",
            "add_tool")]),
    # ---- Q465-1 --------------------------------------------------------------
    "the_switch_ignored": (PROOF, [(
        "        if why in (SCOPE_RANDOM, SCOPE_DATABASE) and not UNCHECKED_EDITS_BLOCKED:\n"
        "            return _line_reason(scan[1]) if scan[1] else None\n", "")],
        [py(TP + "TestTheEditAdmissionAndTheQ4651Switch::test_the_switch_off_admits_only_the_two_scopes",
            "test_the_switch_off_admits_only_the_two_scopes"),
         py(TG + "TestQ4651TheSwitchPoint::test_switched_off_it_edits", "test_switched_off_it_edits")]),
    "unchecked_edits_admitted_by_default": (PROOF, [(
        "UNCHECKED_EDITS_BLOCKED = True\n", "UNCHECKED_EDITS_BLOCKED = False\n")],
        [py(TP + "TestTheEditAdmissionAndTheQ4651Switch::test_the_switch_blocks_by_default_and_names_why",
            "default until the operator answers"),
         py(TG + "TestQ4651TheSwitchPoint::test_blocked_by_default_reading_stays", "test_blocked_by_default_reading_stays")]),
    # ---- Codex R468 MT-I35: the admission again after the check -------------
    "no_admission_after_the_check": (GW, [(
        "    why = _write_admission_refusal(conn_key, tool_table=True, owner=owner)\n    if why:\n"
        "        _trace.emit(\"tools.edit_admission_lost\", level=\"warn\", reason=why)\n        raise PermissionError(why)\n",
        "")],
        [py(TG + "TestMTI35TheAdmissionAfterTheCheck::test_a_disarm_while_the_check_reads", "Not armed"),
         py(TG + "TestMTI35TheAdmissionAfterTheCheck::test_a_disarm_by_the_event_loop_while_the_check_thread_waits",
            "Not armed"),
         py(TG + "TestMTI35TheAdmissionAfterTheCheck::test_a_connection_lost_while_the_check_reads",
            "Connection unknown"),
         py(TG + "TestMTI35TheAdmissionAfterTheCheck::test_a_program_started_while_the_check_reads",
            "A program or MDI runs"),
         py(TG + "TestMTI37TheEditIsOneOwners::test_after_the_write_threads_compare", "Connection to LinuxCNC changed")]),
    "only_the_writer_again_after_the_check": (GW, [(
        "    why = _write_admission_refusal(conn_key, tool_table=True, owner=owner)\n    if why:\n"
        "        _trace.emit(\"tools.edit_admission_lost\"",
        "    why = _writer_refusal(conn_key)\n    if why:\n        _trace.emit(\"tools.edit_admission_lost\"")],
        [py(TG + "TestMTI35TheAdmissionAfterTheCheck::test_a_program_started_while_the_check_reads",
            "A program or MDI runs")]),
    "no_admission_before_the_check": (GW, [(
        "    why = _write_admission_refusal(conn_key, tool_table=True, owner=owner)\n    if why:\n"
        "        raise PermissionError(why)\n    conflict = check()\n",
        "    conflict = check()\n")],
        [py(TG + "TestMTI35TheAdmissionAfterTheCheck::test_the_early_admission_stays_no_reads_for_a_refused_writer",
            "refused before the check's reads")]),
    "a_begun_write_is_taken_back": (GW, [(
        "        await _reload_tool_table(data)\n        library = await asyncio.to_thread(load_tool_library)\n",
        "        why = _write_admission_refusal(conn_key, tool_table=True)\n        if why:\n            raise PermissionError(why)\n"
        "        await _reload_tool_table(data)\n        library = await asyncio.to_thread(load_tool_library)\n")],
        [py(TG + "TestMTI35TheAdmissionAfterTheCheck::test_a_write_begun_is_not_taken_back",
            "test_a_write_begun_is_not_taken_back")]),
    # ---- MT-I36: a cache hit is no proof of the form -------------------------
    "a_cache_hit_skips_the_form": (STRICT, [(
        "            if strict:\n                self._require_object(self._cache[1])\n            return self._cache[1]\n",
        "            return self._cache[1]\n")],
        [py(TS + "test_a_warm_cache_is_no_proof_of_the_form", "test_a_warm_cache_is_no_proof_of_the_form")]),
    "a_list_is_migrated_as_a_flat_library": (STRICT, [(
        "            if (isinstance(all_data, dict) and all_data and not", "            if (all_data and not")],
        [py(TS + "test_the_tolerant_reader_keeps_its_answer_and_never_rewrites_a_list", "the flat-format migration")]),
    "the_tolerant_reader_refuses_too": (STRICT, [(
        "            if strict:\n                self._require_object(self._cache[1])\n",
        "            self._require_object(self._cache[1])\n"),
        ("        if strict:\n            self._require_object(data)\n", "        self._require_object(data)\n")],
        [py(TS + "test_the_tolerant_reader_keeps_its_answer_and_never_rewrites_a_list",
            "test_the_tolerant_reader_keeps_its_answer_and_never_rewrites_a_list")]),
    # ---- MT-I37: a read and an edit are ONE owner's --------------------------
    "the_reply_not_judged_at_its_end": (GW, [(
        "    why = owner.refusal()      # last: all of the above is this owner's, or nothing is published\n",
        "    why = None\n")],
        [py(TG + "TestMTI37TheReadIsOneOwners::test_before_the_stat_read", "discarded, named"),
         py(TG + "TestMTI37TheReadIsOneOwners::test_after_the_stat_read", "discarded, named"),
         py(TG + "TestMTI37TheReadIsOneOwners::test_during_the_library_read", "discarded, named")]),
    "judged_before_the_library_read": (GW, [(
        "    try:\n        library = await asyncio.to_thread(_tool_lib_store.load, True)\n",
        "    judged = owner.refusal()\n    try:\n        library = await asyncio.to_thread(_tool_lib_store.load, True)\n"),
        ("    why = owner.refusal()      # last: all of the above is this owner's, or nothing is published\n",
         "    why = judged\n")],
        [py(TG + "TestMTI37TheReadIsOneOwners::test_during_the_library_read", "discarded, named")]),
    "judged_before_the_reply_is_built": (GW, [(
        "    reply = {\"ok\": True, \"tools\": _merge_tool_data(rows, library), \"current_tool\": current_tool,\n",
        "    judged = owner.refusal()\n"
        "    reply = {\"ok\": True, \"tools\": _merge_tool_data(rows, library), \"current_tool\": current_tool,\n"),
        ("    why = owner.refusal()      # last: all of the above is this owner's, or nothing is published\n",
         "    why = judged\n")],
        [py(TG + "TestMTI37TheReadIsOneOwners::test_while_the_reply_is_built", "discarded, named")]),
    "the_instance_not_the_owners": (GW, [(
        "        if (_link is self.link and _bound_instance == self.instance\n", "        if (_link is self.link\n")],
        [py(TG + "TestMTI37TheReadIsOneOwners::test_after_the_stat_read", "rebound, its Link not yet published"),
         py(TG + "TestMTI37TheEditIsOneOwners::test_after_the_write_threads_compare",
            "rebound, its Link not yet published")]),
    "the_link_not_the_owners": (GW, [(
        "        if (_link is self.link and _bound_instance == self.instance\n",
        "        if (_bound_instance == self.instance\n")],
        [py(TG + "TestMTI37TheReadIsOneOwners::test_during_the_library_read", "replaced, the same table")]),
    "the_owner_judged_by_the_commands_pin": (GW, [(
        "        if (_link is self.link and _bound_instance == self.instance\n",
        "        if (current_link() is self.link and _bound_instance == self.instance\n")],
        [py(TG + "TestMTI37TheReadIsOneOwners::test_a_read_begun_without_a_connection_is_no_later_ones",
            "test_a_read_begun_without_a_connection_is_no_later_ones")]),
    "the_configuration_not_the_owners": (GW, [(
        "                and _current_ini_path() == self.ini_key):\n", "                ):\n")],
        [py(TG + "TestMTI37TheReadIsOneOwners::test_another_configurations_library_is_none_of_this_read",
            "test_another_configurations_library_is_none_of_this_read")]),
    "the_write_under_another_owner": (GW, [(
        "    why = _writer_refusal(conn_key) or (owner.refusal() if owner is not None else None)\n",
        "    why = _writer_refusal(conn_key)\n"),
        ("    return owner.refusal() if owner is not None else None\n", "    return None\n")],
        [py(TG + "TestMTI37TheEditIsOneOwners::test_after_the_write_threads_compare",
            "rebound, its Link not yet published"),
         py(TG + "TestMTI37TheEditIsOneOwners::test_after_the_basis_compare", "rebound, its Link not yet published")]),
    "the_owner_not_asked_after_the_poll": (GW, [(
        "    return owner.refusal() if owner is not None else None\n", "    return None\n")],
        [py(TG + "TestMTI37TheEditIsOneOwners::test_at_the_admissions_own_poll", "test_at_the_admissions_own_poll")]),
    # ---- TF-1: the refusal names the cause and the way out -------------------
    "the_old_words_for_every_cause": (PROOF, [(
        "    return partial_reason(proof, scan, loading)\n", "    return EDIT_NOT_CONFIRMED\n")],
        [py(TP + "TestTheRefusalNamesTheCauseAndTheWayOut::test_each_cause", "test_each_cause"),
         py(TP + "TestTheRefusalNamesTheCauseAndTheWayOut::test_read_again_only_where_it_may_help", "again")]),
    "a_cut_file_names_a_line": (PROOF, [(
        "    if not nl:\n        if proof[\"missing\"] or extra or differs or unread or twice or loaded_twice:\n"
        "            return EDIT_INCOMPLETE\n        return EDIT_NO_LINE_END\n",
        "    if not nl and not (proof[\"missing\"] or extra or differs or unread or twice or loaded_twice):\n"
        "        return EDIT_NO_LINE_END\n")],
        [py(TP + "TestTheRefusalNamesTheCauseAndTheWayOut::"
            "test_a_cause_in_a_file_that_ends_inside_a_line_is_not_named",
            "test_a_cause_in_a_file_that_ends_inside_a_line_is_not_named")]),
    "a_row_removed_is_enough": (PROOF, [(
        "    if loaded_twice:\n        return f\"LinuxCNC holds T{loaded_twice[0]} twice — restart it\"\n", "")],
        [py(TP + "TestTheRefusalNamesTheCauseAndTheWayOut::test_the_way_out_taken_leaves_the_next_cause_or_none",
            "LinuxCNC holds T1 twice")]),
    "a_missing_tool_says_restart": (PROOF, [(
        "    if gone and not extra:\n", "    if False:\n")],
        [py(TP + "TestTheRefusalNamesTheCauseAndTheWayOut::test_each_cause", "not in the file"),
         py(TG + "TestMTTF1TheBasisMustBeComplete::test_a_clean_prefix_is_refused_at_the_basis_read", "not in the file")]),
    "an_awaited_load_says_restart": (GW, [(
        "    loading = job is not None and job.outcome is None and job.scan == scan\n", "    loading = False\n")],
        [py(TG + "TestMTTF1TheBasisMustBeComplete::test_while_linuxcnc_still_loads_the_last_write_the_refusal_says_so",
            "still loads")]),
    "an_ended_wait_still_loads": (GW, [(
        "    loading = job is not None and job.outcome is None and job.scan == scan\n",
        "    loading = job is not None and job.scan == scan\n")],
        [py(TG + "TestMTTF1TheBasisMustBeComplete::test_while_linuxcnc_still_loads_the_last_write_the_refusal_says_so",
            "T1 differs from LinuxCNC")]),
    "the_read_names_no_refusal": (GW, [(
        "             \"edit_refusal\": _tool_basis_refusal(proof, scan),\n", "             \"edit_refusal\": None,\n")],
        [py(TG + "TestMTTF1TheBasisMustBeComplete::test_the_refusal_and_the_read_name_the_same_cause",
            "test_the_refusal_and_the_read_name_the_same_cause")]),
    "a_change_meanwhile_says_restart": (GW, [(
        "            why = owner.refusal() or (_TOOL_EDIT_CHANGED if e.state == \"partial\" else str(e))\n",
        "            why = owner.refusal() or str(e)\n")],
        [py(TG + "TestMTTF1TheBasisMustBeComplete::test_the_basis_changed_in_the_write_thread_is_refused_there",
            "old file, new memory")]),
    "an_unread_line_passes_where_r_does_not_apply": (PROOF, [(
        "            return _line_reason(scan[1]) if scan[1] else None\n", "            return None\n")],
        [py(TP + "TestTheEditAdmissionAndTheQ4651Switch::test_the_switch_off_admits_only_the_two_scopes",
            "test_the_switch_off_admits_only_the_two_scopes")]),
    "store_the_note_names_no_refusal": (STORE, [(
        "    + (editRefusal ? ` Edits refused: ${editRefusal}.` : \"\");\n", "    + (editRefusal ? \"\" : \"\");\n")],
        [vt("a partial note ends with the gateway's own refusal", "a partial note ends with the gateway's own refusal")]),
    # ---- the store (toolTableRead.ts) ----------------------------------------
    "store_an_old_epoch_applies": (STORE, [(
        "  applies(t: ToolReadTicket): boolean { return this.open && t.epoch === this.epoch && t.seq === this.seq; }",
        "  applies(t: ToolReadTicket): boolean { return this.open && t.seq === this.seq; }")],
        [vt("is dropped after a sequence restart", "is dropped after a sequence restart")]),
    "store_partial_empty_is_no_tools": (STORE, [(
        "  return { kind: \"partial\", rows, error: null, note: partialNote(proof, unread, refusal), empty: TOOL_TABLE_NOT_CONFIRMED,",
        "  return { kind: \"partial\", rows, error: null, note: partialNote(proof, unread, refusal), empty: TOOL_TABLE_NO_TOOLS,")],
        [vt("each state against rows and zero rows", "each state against rows and zero rows")]),
    "store_a_reply_without_proof_is_complete": (STORE, [(
        "  const proof = readProof(reply.proof);\n  if (!proof) {\n",
        "  const proof = readProof(reply.proof) ?? { state: \"complete\", proven: [], differs: [], missing: [], extra: [],"
        " duplicates: [], why: null };\n  if (!proof) {\n")],
        [vt("never complete", "never complete")]),
    "store_unread_attached_to_the_previous_tool": (STORE, [(
        "    if (u.T === null) unreadLoose.push(u.line);\n",
        "    if (u.T === null) { const prev = rows.filter(r => true).at(-1); if (prev) unreadByTool.set(prev.T, [...(unreadByTool.get(prev.T) ?? []), u.line]); else unreadLoose.push(u.line); }\n")],
        [vt("only a readable T names its tool", "only a readable T names its tool")]),
    "store_the_note_says_being_written": (STORE, [(
        "  return `File incomplete or differs from LinuxCNC${parts.length ? \" — \" + parts.join(\"; \") : \"\"}.`\n",
        "  return `${proof.missing.length ? \"File is being written\" : \"File incomplete or differs from LinuxCNC\"}"
        "${parts.length ? \" — \" + parts.join(\"; \") : \"\"}.`\n")],
        [vt("a partial note is neutral", "a partial note is neutral")]),
    # ---- the page (ToolTablePanel.vue) ---------------------------------------
    "page_no_tools_for_every_empty_table": (PANEL, [(
        "const emptyText = computed(() => readView.value?.empty ?? TOOL_TABLE_NOT_READ);",
        "const emptyText = computed(() => readView.value ? \"No tools in the table. Add tools manually or import a Fusion"
        " 360 or FreeCAD library.\" : TOOL_TABLE_NOT_READ);")],
        [pw(STATE_SPEC, "a partial read without rows is not 'No tools'")]),
    "page_not_connected_while_connected": (PANEL, [(
        "  reads.opened();\n  loading.value = true;\n  tableError.value = null;\n  setTimeout(fetchTools, FETCH_DELAY_MS);\n",
        "  reads.opened();\n  setTimeout(fetchTools, FETCH_DELAY_MS);\n")],
        [pw("a connection that opens", "connected again: the tab loads")]),
    "page_a_close_keeps_the_rows": (PANEL, [(
        "  loading.value = false;\n  tools.value = [];\n  readView.value = null;\n",
        "  loading.value = false;\n  readView.value = null;\n")],
        [pw("a connection that opens", "a closed connection's rows are gone")]),
    "page_a_failed_read_keeps_its_rows": (PANEL, [(
        "  tools.value = view.rows;\n",
        "  if (view.kind !== \"failed\") tools.value = view.rows;\n")],
        [pw(STATE_SPEC, "a failed read shows no rows, never an empty table")]),
}


def failures(text):
    lines = text.splitlines()
    return [" | ".join(x.strip() for x in lines[i:i + 3] if x.strip())[:300]
            for i, ln in enumerate(lines) if "AssertionError" in ln or "FAIL" in ln or "Error:" in ln]


def build():
    """`npm run build`'s two steps, by the binaries (no ~/.npm)."""
    for cmd in (["vue-tsc", "-b"], ["vite", "build"]):
        r = subprocess.run([BIN + cmd[0], *cmd[1:]], cwd=ROOT / "lcnc-webui", capture_output=True, text=True,
                           timeout=900, env=ENV)
        if r.returncode != 0:
            return r
    return r


def run_guard(kind, args):
    if kind == "pytest":
        r = subprocess.run([str(ROOT / "lcnc-gateway/.venv/bin/python3"), "-m", "pytest", "-q", "-p", "no:cacheprovider",
                            "-o", "addopts=", args[0]], cwd=ROOT / "lcnc-gateway", capture_output=True, text=True,
                           timeout=900)
        return r.returncode != 0, r.stdout + r.stderr, args[1]
    if kind == "vitest":
        r = subprocess.run([BIN + "vitest", "run", args[0], "-t", args[1]], cwd=ROOT / "lcnc-webui",
                           capture_output=True, text=True, timeout=900)
        return r.returncode != 0, r.stdout + r.stderr, args[2]
    if kind == "pw":
        b = build()
        if b.returncode != 0:
            return False, b.stdout + b.stderr, args[2]
        # never under a timeout: a killed runner orphans its web server (4173)
        r = subprocess.run([BIN + "playwright", "test", args[0], "-g", args[1], "--workers=1", "--reporter=list"],
                           cwd=ROOT / "lcnc-webui", capture_output=True, text=True, env=ENV)
        return r.returncode != 0, r.stdout + r.stderr, args[2]
    raise SystemExit(f"unknown guard kind {kind}")


def main(names):
    out = {}
    for name in names or list(MUTS):
        path, reps, guards = MUTS[name]
        f = ROOT / path
        orig = f.read_bytes()
        text = orig.decode()
        try:
            for old, new in reps:
                if text.count(old) != 1:
                    raise SystemExit(f"{name}: anchor not unique in {path}: {old[:70]!r}")
                text = text.replace(old, new)
            f.write_text(text)
            results = [run_guard(k, a) for k, a in guards]
        finally:
            f.write_bytes(orig)
            if any(k == "pw" for k, _a in guards):
                build().check_returncode()
        red = all(r for r, _o, _a in results)
        at_rule = red and all(at in o for _r, o, at in results)
        out[name] = {"red": red, "at_rule": at_rule}
        print(json.dumps({"mutation": name, "red": red, "at_rule": at_rule,
                          "failures": [failures(o)[:3] for _r, o, _a in results]}), flush=True)
    print(json.dumps({"total": len(out), "red": sum(v["red"] for v in out.values()),
                      "red_at_rule": sum(v["at_rule"] for v in out.values())}))
    return 0 if all(v["at_rule"] for v in out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
