"""TF-2 red proofs (plan v3 §5, Codex R479): each mutation breaks ONE rule; its
named guard must fail AT that rule (`at`: what the failure must show). Run from
the tree's root; every file is restored byte-identical. `py` a backend guard
(pytest), `vi` a unit guard (vitest), `pw` a browser guard (the page is built
with the mutation; a mutation that does not build is no proof). No bytecode (a
.pyc is valid by mtime SECOND and size).

  python3 scripts/test_support/heavy_lock.py --who tf2 -- python3 -I docs/reviews/tf2.mutations.py [name ...]

Not mutated, equivalent by construction: sending on `link()` instead of
`owner.link` — inside the command's pin both are that Link or
NotConnected(LINK_CHANGED), and the owner's refusal says the same words.
"""
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
BIN = ROOT / "lcnc-webui/node_modules/.bin"
ENV = {**os.environ, "PATH": f"{BIN}:{os.environ['PATH']}", "NO_COLOR": "1", "PYTHONDONTWRITEBYTECODE": "1",
       "LCNC_E2E_WORKERS": "1"}
G, S = "lcnc-gateway/", "lcnc-webui/src/"
PROOF, GW, POL = G + "tool_proof.py", G + "gateway.py", G + "command_policy.py"
READ, LOAD, DIALOG, PANEL = S + "toolTableRead.ts", S + "toolLoad.ts", S + "ToolLoadDialog.vue", S + "ToolTablePanel.vue"
T = "test_tool_load.py::"
ROWS = T + "TestEveryRow::test_each_row_has_its_words"
ORDER = T + "TestTheOrder::test_by_pairs"
X = "test_tool_load_gateway.py::"
PRE, FOUR, COMP, ENDS, AGAIN = (X + c + "::" for c in ("TestThePreview", "TestTheFourSequences", "TestACompleteBasis",
                                                       "TestWhatEndsTheObservation", "TestNothingIsSentAgain"))
CMP, REM, READS, LINK, STOP, RD = (X + c + "::" for c in ("TestTheComparison", "TestRemoval", "TestTheGuardsReads",
                                                          "TestTheOwnersLink", "TestAStopFromAnotherClient", "TestTheRead"))


def py(node, at=None):
    """`at`: what a failing line must name (a subtest's words); default the test's name."""
    return ("py", [node, at or node.split("::")[-1]])


def vi(file, at):
    return ("vi", [file, at])


def pw(grep, at="Error:"):
    return ("pw", ["e2e/tool-load.spec.ts", grep, at])


GROUPS = ("    for group in (_load_under_the_read, _load_cut, _load_form, _load_scope, _load_content, _load_unknown,\n"
          "                  _load_against_linuxcnc):")


def groups(*names):
    return [(GROUPS, "    for group in (" + ", ".join(names) + "):")]


ALL = ("_load_under_the_read", "_load_cut", "_load_form", "_load_scope", "_load_content", "_load_unknown",
       "_load_against_linuxcnc")


def without(name):
    return groups(*[n for n in ALL if n != name])


def swapped(i):
    n = list(ALL)
    n[i], n[i + 1] = n[i + 1], n[i]
    return groups(*n)


MUTS = {
    # ---- §1.2: each clause, red at its row (tool_proof.py) ------------------------
    "no_changed_under_the_read": (PROOF, without("_load_under_the_read"), [py(ROWS, "the file changed under the read")]),
    "no_cut_clause": (PROOF, without("_load_cut"), [py(ROWS, "cut, and something lacks")]),
    "a_cut_file_names_its_cause": (PROOF, [("    return EDIT_NO_LINE_END if only else EDIT_INCOMPLETE\n", "    return EDIT_NO_LINE_END\n")],
                                   [py(ROWS, "cut, a line unread"), py(ROWS, "cut, no comparison: unread controller")]),
    "0_bytes_are_a_cut_file": (PROOF, [("    if nl or empty:\n        return None\n", "    if nl:\n        return None\n")],
                               [py(ROWS, "0 bytes")]),
    "no_cr_clause": (PROOF, [('    if b"\\r" in r.data:\n', '    if b"\\r\\r\\r" in r.data:\n')], [py(ROWS, "a CR")]),
    "a_byte_more": (PROOF, [("        if len(line) + 1 > LINE_BYTES_MAX:", "        if len(line) > LINE_BYTES_MAX:")],
                    [py(ROWS, "a line too long")]),
    "no_control_clause": (PROOF, [('_NOT_PRINTABLE = re.compile(rb"[^ -~]")', '_NOT_PRINTABLE = re.compile(rb"[^\\x00-\\xff]")')],
                          [py(ROWS, "a tab in a tool line")]),
    "nul_only_in_the_data": (PROOF, [('if b"\\0" in line or _NOT', 'if b"\\0" in part or _NOT')], [py(ROWS, "NUL in a remark")]),
    "the_comment_is_no_tool_line": (PROOF, [('line.partition(b";")[0] if _tool_text(line) else b""', 'line.partition(b";")[0]')],
                                    [py(T + "TestEveryRow::test_the_loadable_file", "a tab in a comment")]),
    "no_hash_words": (PROOF, [("        if n is not None:\n            return f\"Line {n} is a #", "        if n == -1:\n            return f\"Line {n} is a #")],
                      [py(ROWS, "a # line with a P word")]),
    "a_hash_line_behind_the_last_tool_is_refused": (PROOF, [(
        "        if not tool_lines or n > tool_lines[-1]:\n            return None\n", ""), (
        "    if home is not None and home != want:\n        n = _hash", "    if home is not None:\n        n = _hash")],
        [py(T + "TestTheHashLineR479::test_the_nine_files", "hash pocket last")]),
    "no_unread_clause": (PROOF, [("    if unread:\n        return _line_reason(unread)\n    if unmirrored", "    if unmirrored")],
                         [py(ROWS, "an unread line")]),
    "what_the_mirror_does_not_read_is_fine": (PROOF, [("    if unmirrored is not None:\n        return unmirrored\n", "    if unmirrored is not None:\n        return None\n")],
                                              [py(ROWS, "a number the mirror does not read")]),
    "t_unbounded": (PROOF, [('        if not INT_MIN <= row["T"] <= INT_MAX:\n            return LOAD_T_INT\n', '        if row["T"] == "x":\n            return LOAD_T_INT\n')],
                    [py(ROWS, "T past int32")]),
    "q_unbounded": (PROOF, [('(("P", "pocket"), ("Q", "Q"))', '(("P", "pocket"),)')], [py(ROWS, "Q past int32")]),
    "p_unbounded": (PROOF, [('(("P", "pocket"), ("Q", "Q"))', '(("Q", "Q"),)')], [py(ROWS, "P past int32")]),
    "inf_is_fine": (PROOF, [("        if not all(math.isfinite(float(row.get(k, 0))) for k, _attr in STAT_FIELDS):", "        if row.get(\"Z\") == \"x\":")],
                    [py(ROWS, "not finite")]),
    "the_index_rule_dropped": (PROOF, [("    return LOAD_OTHERWISE if home != want else None\n", "    return None\n")],
                               [py(ROWS, "T -1, LinuxCNC's no tool")]),
    "a_spelled_out_number": (PROOF, [('    return f"T{t}" if 0 <= t <= TOOL_NUMBER_MAX else "A tool"\n', '    return f"T{t}"\n')],
                             [py(T + "TestEveryRow::test_every_reason_fits_and_names_a_way_out")]),
    "no_scope": (PROOF, without("_load_scope"), [py(ROWS, "random changer")]),
    "no_rows_is_fine": (PROOF, [("    if not rows:\n        return LOAD_NO_TOOLS\n", "")], [py(ROWS, "no tool row")]),
    "t_range_dropped": (PROOF, [('        if not 0 <= row["T"] <= TOOL_NUMBER_MAX:\n            return LOAD_T_RANGE\n', '        if row["T"] == "x":\n            return LOAD_T_RANGE\n')],
                        [py(ROWS, "T past 99999")]),
    "p_range_dropped": (PROOF, [('        if not 0 <= row["P"] <= TOOL_NUMBER_MAX:', '        if row["P"] == "x":')], [py(ROWS, "P past 99999")]),
    "negative_d_is_fine": (PROOF, [('        if row["D"] < 0:', '        if row["D"] < -1e9:')], [py(ROWS, "D below 0")]),
    "twice_in_the_file_is_fine": (PROOF, [("    if twice:\n        return f\"{_tname(twice[0])} twice in the file", "    if not twice:\n        return None\n    if False:\n        return f\"{_tname(twice[0])} twice in the file")],
                                  [py(ROWS, "twice in the file")]),
    "any_number_of_tools": (PROOF, [("    return EDIT_TOO_MANY if len(rows) > IO_TOOLS_MAX else None\n", "    return None\n")], [py(ROWS, "more than LinuxCNC keeps")]),
    "an_unread_table_is_empty": (PROOF, [('    if r.proof["why"] == NOT_READ:\n        return LOAD_TABLE_UNREAD\n', '')], [py(ROWS, "STAT.tool_table not read")]),
    "an_unread_spindle_is_none": (PROOF, [("    if not spindle_read(r.spindle):\n        return LOAD_SPINDLE_UNREAD\n", "")], [py(ROWS, "the spindle tool not read")]),
    "an_awaited_job_is_fine": (PROOF, [("    return EDIT_LOADING if r.awaited else None\n", "    return None\n")], [py(ROWS, "the last change still awaited")]),
    "twice_in_linuxcnc_is_fine": (PROOF, [("    if held_twice:\n        return f\"LinuxCNC holds", "    if held_twice == 0:\n        return f\"LinuxCNC holds")], [py(ROWS, "twice in LinuxCNC")]),
    "the_spindle_tool_may_go": (PROOF, [("    if r.spindle and r.spindle not in", "    if r.spindle == -5 and r.spindle not in")],
                                [py(ROWS, "the spindle tool not in the file"), py(REM + "test_never_the_tool_in_the_spindle")]),
    # ---- the order: neighbouring groups, and causes inside them ---------------------
    "order_changed_and_cut": (PROOF, swapped(0), [py(ORDER, "changed + everything")]),
    "order_cut_and_form": (PROOF, swapped(1), [py(ORDER, "cut file + everything")]),
    "order_form_and_scope": (PROOF, swapped(2), [py(ORDER, "long line + random changer")]),
    "order_scope_and_content": (PROOF, swapped(3), [py(ORDER, "random changer + no rows")]),
    "order_content_and_unknown": (PROOF, swapped(4), [py(ORDER, "no rows + unread controller")]),
    "order_unknown_and_linuxcnc": (PROOF, swapped(5), [py(ORDER, "job awaited + twice in LinuxCNC")]),
    "order_unread_before_the_hash": (PROOF, [("    if home is not None and home != want:\n        n = _hash", "    if unread:\n        return _line_reason(unread)\n    if home is not None and home != want:\n        n = _hash")],
                                     [py(ORDER, "# with P + unread")]),
    "order_otherwise_first": (PROOF, [("    if unread:\n        return _line_reason(unread)\n    if unmirrored", "    if home is not None and home != want:\n        return LOAD_OTHERWISE\n    if unread:\n        return _line_reason(unread)\n    if unmirrored")],
                              [py(ORDER, "T past int32 + P past int32"), py(ROWS, "P past int32")]),
    "order_awaited_before_the_spindle": (PROOF, [("    if not spindle_read(r.spindle):\n        return LOAD_SPINDLE_UNREAD\n", "    if r.awaited:\n        return EDIT_LOADING\n    if not spindle_read(r.spindle):\n        return LOAD_SPINDLE_UNREAD\n")],
                                         [py(ORDER, "unread spindle + job awaited")]),
    "order_spindle_before_twice": (PROOF, [("    if held_twice:\n        return f\"LinuxCNC holds {_tname(held_twice[0])} twice — restart it\"\n", "    if held_twice and not r.spindle:\n        return f\"LinuxCNC holds {_tname(held_twice[0])} twice — restart it\"\n")],
                                   [py(ORDER, "twice in LinuxCNC + spindle missing")]),
    "the_edit_never_asks_the_load_s_rule": (PROOF, [("    if load_why is not None:\n        return load_why\n", "")],
                                            [py(T + "TestTheEditsWords::test_what_is_wrong_with_the_file_comes_first"), py(RD + "test_an_edit_names_what_is_wrong_with_the_file")]),
    "both_sides_without_a_field": (PROOF, [("[[e[k] for k, _attr in STAT_FIELDS] for e in entries]", "[[e[k] for k, _attr in STAT_FIELDS if k != \"Q\"] for e in entries]")],
                                   [py(T + "TestBothSides::test_the_memory_rev_changes_with_every_field_a_tool_and_the_spindle")]),
    "both_sides_without_the_spindle": (PROOF, [("json.dumps([spindle, home]", "json.dumps([0, home]")],
                                       [py(T + "TestBothSides::test_the_memory_rev_changes_with_every_field_a_tool_and_the_spindle"), py(CMP + "test_between_the_preview_and_the_commit", "the spindle tool")]),
    # ---- the comparison at the commit (gateway.py) -----------------------------------
    "rev_not_compared": (GW, [('    if read.rev != base["rev"]:\n        return TOOL_LOAD_FILE_CHANGED\n', '')], [py(CMP + "test_between_the_preview_and_the_commit", "a remark only"), py(CMP + "test_a_revision_of_its_own")]),
    "memory_not_compared": (GW, [('    if memory is not None and memory != base["memory"]:', '    if memory is not None and memory == "":')], [py(CMP + "test_between_the_preview_and_the_commit", "LinuxCNC's table")]),
    "unread_is_changed": (GW, [('    if memory is not None and memory != base["memory"]:', '    if memory != base["memory"]:')], [py(CMP + "test_an_unread_side_is_no_change")]),
    "removed_not_compared": (GW, [('    if sorted(removed) != read.proof["missing"]:', '    if sorted(removed) == ["x"]:')], [py(REM + "test_too_few_too_many_or_other_numbers")]),
    "the_rule_not_asked_at_the_commit": (GW, [("    why = _tool_load_words(read.data, read.scan, read.proof, read.spindle)\n    if why:\n        return why\n    if memory is None:", "    if memory is None:")],
                                         [py(CMP + "test_the_rule_at_the_commit"), py(CMP + "test_a_job_awaited")]),
    "the_removal_switch_not_asked": (GW, [("    if removed and not _tool_proof_mod.REMOVAL_ALLOWED:", "    if removed and not removed:")], [py(REM + "test_the_switch_off_refuses_and_says_so")]),
    **{f"the_base_without_{k}": (GW, [('{k: base[k] for k in ("path", "instance", "ini", "link")}', f'{{**{{k: base[k] for k in ("path", "instance", "ini", "link")}}, "{k}": _tool_load_owner(owner)["{k}"]}}')],
                                 [py(CMP + "test_another_owner_of_the_comparison", k)]) for k in ("path", "instance", "ini", "link")},
    "the_admission_before_the_reads_only": (GW, [("        why = _write_admission_refusal(conn_key, tool_table=True, owner=owner, load=got[0].data)\n        return why or", "        return None or")],
                                            [py(READS + "test_at_each_read", "2b"), py(READS + "test_the_prepared_tool_is_judged_on_the_files_bytes")]),
    "standing_is_not_the_last_word": (GW, [(
        "        why = _tool_load_commit(owner, base, removed, got)\n        if why:\n            return why\n        why = _write_admission_refusal(conn_key, tool_table=True, owner=owner, load=got[0].data)\n        return why or",
        "        why = _write_admission_refusal(conn_key, tool_table=True, owner=owner, load=_read_table_bytes(owner.table or \"\")[0])\n        if why:\n            return why\n        why = _tool_load_commit(owner, base, removed, got)\n        return why or")],
        [py(READS + "test_the_last_word_is_the_writer_from_memory"), py(READS + "test_at_each_read", "2b")]),
    "the_early_admission_dropped": (GW, [("        why = _write_admission_refusal(conn_key, tool_table=True, owner=owner)\n        if why:\n            return why\n        why = _tool_load_commit", "        why = _tool_load_commit")],
                                    [py(READS + "test_a_refused_writer_reads_nothing")]),
    "reads_outside_the_admit": (GW, [(
        "        why = _tool_load_commit(owner, base, removed, got)\n        if why:\n            return why\n        why = _write_admission_refusal(conn_key, tool_table=True, owner=owner, load=got[0].data)",
        "        why = _write_admission_refusal(conn_key, tool_table=True, owner=owner, load=got[0].data)"), (
        "        began: List[bool] = []\n        unclear: Optional[str] = None\n        try:\n", "        began: List[bool] = []\n        unclear: Optional[str] = None\n        early = _tool_load_commit(owner, base, removed, got)\n        if early:\n            raise _WriteRefused(early)\n        try:\n")],
        [py(READS + "test_the_last_word_is_the_writer_from_memory")]),
    "load_left_out": (GW, [("owner=owner, load=got[0].data)\n        return why or", "owner=owner)\n        return why or")],
                      [py(READS + "test_the_prepared_tool_is_judged_on_the_files_bytes"), py(READS + "test_the_shared_admission", "moving")]),
    "other_bytes_judged":
                          (GW, [("owner=owner, load=got[0].data)\n        return why or", "owner=owner, load=got[0].data.replace(b\"P9\", b\"P5\"))\n        return why or")],
                           [py(READS + "test_the_bytes_judged_are_the_bytes_read_at_the_commit"), py(READS + "test_the_prepared_tool_is_judged_on_the_files_bytes")]),
    "the_command_s_stat_for_the_owner_s": (GW, [("    return None if owner.link is None else _stat_tool_table(owner.link)\n", "    return _stat_tool_table()\n")],
                                           [py(PRE + "test_the_file_then_the_owners_table_then_its_spindle")]),
    "the_spindle_not_polled": (GW, [("        conn.stat.poll()\n        raw = getattr(conn.stat, \"tool_in_spindle\", None)", "        raw = getattr(conn.stat, \"tool_in_spindle\", None)")],
                               [py(PRE + "test_the_file_then_the_owners_table_then_its_spindle")]),
    "the_preview_s_owner_not_judged": (GW, [("    why = owner.refusal()\n    return {\"ok\": False, \"error\": why} if why else reply\n", "    return reply\n")], [py(PRE + "test_its_owner_is_judged_last")]),
    "the_preview_three_attempts": (GW, [("        reply = await asyncio.to_thread(_tool_load_preview, owner)\n", "        await asyncio.to_thread(_tool_load_preview, owner)\n        reply = await asyncio.to_thread(_tool_load_preview, owner)\n")],
                                   [py(PRE + "test_it_is_a_free_read_of_one_attempt_that_sends_nothing")]),
    "the_read_without_its_load_refusal": (GW, [('"load_refusal": load_why,\n', '"load_refusal": None,\n')], [py(RD + "test_the_words_are_the_previews")]),
    "the_read_without_its_owner": (GW, [('             "owner": {"ini": owner.ini_key, "link": _link_name(owner.link)},\n', '')], [py(RD + "test_load_refusal_and_owner", "KeyError")]),
    # ---- one request, booked --------------------------------------------------------
    "an_abort_before_the_begin_still_sends": (GW, [("        return why or (TOOL_LOAD_PREEMPTED if preempted.is_set() else None)\n", "        return why\n")], [py(STOP + "test_before_the_write_nothing_is_requested")]),
    "preempted_after_the_write_is_raised": (GW, [("        if not jobs:\n            raise               # nothing reached LinuxCNC\n", "        raise\n")], [py(STOP + "test_in_the_write_the_request_stands", "CancelledError")]),
    "a_write_that_raised_is_a_refusal": (GW, [("            if not began:\n                _trace.emit(\"tools.load_refused\"", "            if True:\n                _trace.emit(\"tools.load_refused\"")], [py(ENDS + "test_the_nml_write_that_raised_once_begun")]),
    "ok_for_a_refusal": (GW, [("reason=str(e), exc=type(e).__name__)\n                raise\n            unclear", "reason=str(e), exc=type(e).__name__)\n                return\n            unclear")], [py(CMP + "test_between_the_preview_and_the_commit", "the file")]),
    "a_file_write_added": (GW, [("        read = got[0]\n        _tool_write_seq += 1\n", "        read = got[0]\n        write_tool_table(owner.table, read.scan[0])\n        _tool_write_seq += 1\n")], [py(FOUR + "test_the_load_runs")]),
    "a_library_write_added": (GW, [("        read = got[0]\n        _tool_write_seq += 1\n", "        read = got[0]\n        save_tool_library({}, ini_key=owner.ini_key)\n        _tool_write_seq += 1\n")], [py(FOUR + "test_the_load_runs")]),
    "the_watch_baseline_touched": (GW, [("        read = got[0]\n        _tool_write_seq += 1\n", "        read = got[0]\n        _tool_table_watch[\"sig\"] = _tool_table_file_sig(owner.table or \"\", owner)\n        _tool_write_seq += 1\n")], [py(FOUR + "test_the_load_runs")]),
    "not_an_input_action": (POL, [('"renumber_tool": "input_action", "tool_table_load": "input_action",', '"renumber_tool": "input_action", "tool_table_load": "none",')],
                            [py(LINK + "test_the_policy_of_the_two_commands")]),
    "the_hex_unchecked": (POL, [('        if not isinstance(val, str) or re.fullmatch(r"[0-9a-f]{64}", val) is None:', '        if not isinstance(val, str):')], [py("test_payload_contract.py::TestTheSchemaTable::test_a_tool_table_load_names_its_whole_comparison")]),
    "the_base_open": (POL, [("    if not isinstance(raw, dict) or frozenset(raw) != TOOL_LOAD_BASE_KEYS:", "    if not isinstance(raw, dict) or not frozenset(raw) >= TOOL_LOAD_BASE_KEYS:")], [py("test_payload_contract.py::TestTheSchemaTable::test_a_tool_table_load_names_its_whole_comparison")]),
    # ---- what is observed -----------------------------------------------------------
    "v_dropped":
                 (GW, [('        if _tool_job_compare(job)["state"] != "complete":\n            data, same, _mtime', '        if _tool_job_compare(job)["state"] == "complete":\n            return "shown"\n        if True:\n            data, same, _mtime')],
                  [py(ENDS + "test_shown_needs_v_and_then_s"), py(FOUR + "test_a_foreign_put_with_a_successful_save")]),
    "s_s_proof_dropped": (GW, [('    return "shown" if proof["state"] == "complete" else "not yet"\n', '    return "shown"\n')], [py(ENDS + "test_v_alone_does_not_show")]),
    "s_s_revision_dropped": (GW, [('    if _tool_content_rev(data) != load.rev:\n        return "file changed"\n    return "shown"', '    return "shown"')], [py(FOUR + "test_a_foreign_put_with_a_successful_save")]),
    "a_torn_read_decides": (GW, [('    if proof["why"] == _TOOL_CHANGED_WHILE_READ:\n        return "not yet"\n', '')], [py(ENDS + "test_a_file_changing_under_the_read_decides_nothing")]),
    "the_owner_not_judged": (GW, [('            elif job.owner.refusal() is not None:\n                load.why = "controller changed"\n', '')], [py(ENDS + "test_another_controller")]),
    "the_newest_not_judged": (GW, [('            if job.seq != _tool_write_seq:\n                load.why = "superseded"\n            elif job.owner', '            if job.owner')], [py(ENDS + "test_a_newer_write_or_load")]),
    "no_early_end": (GW, [('            return "file changed" if same and _tool_content_rev(data) != load.rev else "not yet"\n', '            return "not yet"\n')],
                     [py(FOUR + "test_the_file_changed_before_the_load_ran")]),
    "the_complete_job_ends_at_once": (GW, [('        if load.basis == "complete":\n            await asyncio.sleep(TOOL_RELOAD_WAIT_S)\n', '        if load.basis == "complete":\n            await asyncio.sleep(0)\n')], [py(COMP + "test_the_load_failed_and_left_the_table_empty", "TimeoutError")]),
    "the_complete_reply_waits": (GW, [('    waited = job.load is None or job.load.basis != "complete"\n', '    waited = True\n')], [py(COMP + "test_the_load_ran", "TimeoutError")]),
    "a_late_look_decides": (GW, [("            deadline = time.monotonic()     # one look, the last\n", "")], [py(COMP + "test_the_load_failed_and_left_the_table_empty")]),
    "a_retry_at_the_bound": (GW, [('                load.why = "in time"\n', '                load.why = "in time"\n                job.owner.link.cmd.load_tool_table()\n')], [py(AGAIN + "test_neither_at_the_bound_nor_after_a_reconnect")]),
    "a_second_request_on_the_new_link": (GW, [('                load.why = "controller changed"\n', '                load.why = "controller changed"\n                c = _cmd_now()\n                if c is not None:\n                    c.load_tool_table()\n')], [py(ENDS + "test_another_controller")]),
    "no_ping_at_the_end": (GW, [('        if load.why != "superseded" and job.seq == _tool_write_seq:\n            _tool_table_version += 1\n        ms', '        ms')], [py(FOUR + "test_the_load_runs")]),
    "a_superseded_job_pings": (GW, [('        if load.why != "superseded" and job.seq == _tool_write_seq:\n            _tool_table_version += 1\n        ms', '        _tool_table_version += 1\n        ms')], [py(ENDS + "test_a_newer_write_or_load")]),
    "the_word_loaded": (GW, [('_trace.emit("tools.load_values_shown"', '_trace.emit("tools.load_confirmed"')], [py(X + "TestTheVocabulary::test_the_gateways_words")]),
    "an_edit_s_word_in_the_reply": (GW, [('    if job.load is not None:\n        return _tool_load_outcome(job.load)\n', '')], [py(FOUR + "test_the_load_runs")]),
    # ---- the page: what is said, from the read (toolLoad.ts, toolTableRead.ts) -------
    **{f"shows_without_the_{k}": (READ, [("a.path === b.path && a.instance === b.instance && a.ini === b.ini && a.link === b.link", " && ".join(f"a.{x} === b.{x}" for x in ("path", "instance", "ini", "link") if x != k))],
                                  [vi("src/toolLoad.test.ts", "shows it: path, instance, INI, Link, revision and complete"), vi("src/toolTableRead.test.ts", "each part of an owner is compared")]) for k in ("path", "instance", "ini", "link")},
    "shows_without_the_revision": (LOAD, [(" && read.rev === base.rev", "")], [vi("src/toolLoad.test.ts", "shows it: path")]),
    "shows_without_complete": (LOAD, [('read.kind === "complete" && ', "")], [vi("src/toolLoad.test.ts", "shows it: path")]),
    "kept_over_a_read_that_does_not": (LOAD, [("  return r.shown ? null : r;\n", "  return r;\n")], [vi("src/toolLoad.test.ts", "once shown, a read that does not show it ends it")]),
    "a_foreign_owner_kept": (LOAD, [('    return !r.shown && r.why === "controller changed" ? { ...r, foreign: true } : null;', "    return r;")], [vi("src/toolLoad.test.ts", "another owner, by each part alone")]),
    "a_failed_read_is_a_foreign_owner": (LOAD, [("  if (read.owner && !sameToolOwner(read.owner, r.base))", "  if (!read.owner || !sameToolOwner(read.owner, r.base))")], [vi("src/toolLoad.test.ts", "a failed read names no owner")]),
    "the_reply_alone": (LOAD, [("  if (showsLoad(read, r.base)) {\n    const shows", "  if (showsLoad(read, r.base) || r.values === \"shown\") {\n    const shows")], [vi("src/toolLoad.test.ts", "the reply alone never gives the positive note")]),
    "an_unknown_why_is_shown": (LOAD, [('reply.values === "shown" || reply.values === "not awaited" ? reply.values : "not shown"', 'reply.values === "not shown" || reply.values === "not awaited" ? reply.values : "shown"')], [vi("src/toolLoad.test.ts", "only a received ok: true")]),
    "a_lost_reply_is_a_request": (LOAD, [('  if (!reply?.ok || reply.load !== "requested") return null;', '  if (reply && !reply.ok) return null;\n  reply ??= {};')], [vi("src/toolLoad.test.ts", "only a received ok: true")]),
    "absent_is_loadable": (READ, [("reply.load_refusal === null || isText(reply.load_refusal) ? reply.load_refusal as string | null : undefined", "isText(reply.load_refusal) ? reply.load_refusal as string | null : null")], [vi("src/toolTableRead.test.ts", "absent is an older gateway")]),
    "head_failed_after_a_request": (READ, [("  return o.earlier || o.lost || o.requested ? LOAD_UNCONFIRMED : LOAD_FAILED;", "  return o.earlier || o.lost ? LOAD_UNCONFIRMED : LOAD_FAILED;")], [vi("src/toolTableRead.test.ts", "every head with every tail")]),
    "head_requested_under_another_owner": (READ, [("  if (o.requested && last && sameToolOwner(o.requested, last)) return LOAD_REQUESTED;", "  if (o.requested) return LOAD_REQUESTED;")], [vi("src/toolTableRead.test.ts", "every head with every tail")]),
    "head_lost_is_requested": (READ, [("  if (!received || !o.of) return { ...o, lost: true };", "  if (!o.of) return { ...o, lost: true };")], [vi("src/toolTableRead.test.ts", "every head with every tail")]),
    "head_earlier_first": (READ, [("  if (o.requested && last &&", "  if (o.earlier) return LOAD_UNCONFIRMED;\n  if (o.requested && last &&")], [vi("src/toolTableRead.test.ts", "every head with every tail")]),
    "tail_loadable_before_the_cause": (READ, [("  if (typeof why === \"string\" && !LOAD_UNKNOWN.has(why)) return `. ${why}.`;\n", "  if (read.kind === \"complete\") return LOAD_OR_RESTART;\n  if (typeof why === \"string\" && !LOAD_UNKNOWN.has(why)) return `. ${why}.`;\n")], [vi("src/toolTableRead.test.ts", "every head with every tail")]),
    "tail_loadable_before_unknown": (READ, [("  if (read.kind === \"failed\" || typeof why === \"string\") return READ_AGAIN;", "  if (read.kind === \"failed\") return LOAD_OR_RESTART;\n  if (typeof why === \"string\") return READ_AGAIN;")], [vi("src/toolTableRead.test.ts", "every head with every tail")]),
    "tail_an_unknown_read_is_a_cause": (READ, [("  if (typeof why === \"string\" && !LOAD_UNKNOWN.has(why)) return", "  if (typeof why === \"string\") return")], [vi("src/toolTableRead.test.ts", "every head with every tail")]),
    "the_unknown_words_drift": (READ, [('  "Spindle tool not read — try again", "LinuxCNC still', '  "LinuxCNC still')], [vi("src/toolLoadWords.test.ts", "are the gateway's")]),
    "a_request_ends_the_write_note": (READ, [("  if (!o || (o.of && o.of.path !== base.path)) return o;\n", "  if (!o || (o.of && o.of.path !== base.path)) return o;\n  if (received) return null;\n")], [vi("src/toolTableRead.test.ts", "a request is never turned into failed")]),
    "values_hide_the_write_note": (READ, [("  return !!o?.notLoaded && read !== null && read.kind !== \"partial\";", "  return !!o?.notLoaded && !o.requested && read !== null && read.kind !== \"partial\";")], [vi("src/toolTableRead.test.ts", "every head with every tail")]),
    # ---- the page: the dialog and the tab (browser) -----------------------------------
    "the_acknowledgement_survives_staleness": (DIALOG, [("watch(stale, s => { if (s) acknowledged.value = false; }, { flush: \"sync\" });", "watch(stale, () => {}, { flush: \"sync\" });")], [pw("stale by a ping", "not.toBeChecked")]),
    "the_acknowledgement_survives_a_new_comparison": (DIALOG, [("  acknowledged.value = false;\n  dropped.value = !connected.value;", "  dropped.value = !connected.value;")], [pw("a refused request stays in the dialog", "not.toBeChecked")]),
    "the_confirm_is_open_while_stale": (DIALOG, [("  if (stale.value) return stale.value;\n  if (invalid.value)", "  if (invalid.value)")], [pw("stale by a lost connection", "toBeDisabled")]),
    "a_lost_connection_is_no_staleness": (DIALOG, [("watch(connected, up => { if (!up) dropped.value = true; });", "watch(connected, () => {});")], [pw("stale by a lost connection", "Connection lost")]),
    "the_confirm_open_after_a_lost_reply": (DIALOG, [("    invalid.value = true;\n    acknowledged.value = false;\n    error.value = writeUnknownWords", "    dropped.value = false;\n    acknowledged.value = false;\n    error.value = writeUnknownWords")], [pw("a lost reply: the outcome is unknown", "toBeDisabled")]),
    "offered_with_a_refusal": (PANEL, [('readView.value?.kind === "partial" && loadable.value);', 'readView.value?.kind === "partial");')], [pw("offered where the file may be loaded", "toHaveText")]),
    "offered_in_the_write_note_with_a_refusal": (PANEL, [("toolWriteLoadShows(written.value, readView.value) && loadable.value);", "toolWriteLoadShows(written.value, readView.value));")], [pw("the write note stands after shown values", "offered only for a loadable file")]),
    "both_notes_say_requested": (PANEL, [("  return toolLoadNote(loadResult.value, readView.value, !saysRequested);", "  return toolLoadNote(loadResult.value, readView.value, saysRequested || !saysRequested);")], [pw("the write note stands after shown values", "toHaveText")]),
    "the_write_note_ended_by_a_request": (PANEL, [("  noteLoadRequest(base, true);\n", "  written.value = null;\n")], [pw("the write note stands after shown values", "load requested but not confirmed")]),
    "a_lost_reply_counted_as_requested": (PANEL, [('@lost="base => noteLoadRequest(base, false)"', '@lost="base => noteLoadRequest(base, true)"')], [pw("a lost reply: the outcome is unknown", "load not confirmed")]),
    "the_result_gone_with_the_socket": (PANEL, [("  readView.value = null;\n  tableIdentity.value = null;\n  tableError.value = NOT_CONNECTED;", "  readView.value = null;\n  endLoadResult();\n  tableIdentity.value = null;\n  tableError.value = NOT_CONNECTED;")], [pw("the note is the read's: shown, kept over a socket loss", "now shows the file's tool values")]),
    "the_focus_dropped_while_it_compares": (PANEL, [("    if (held && (!a || a === document.body)) btn?.$el?.focus();\n", "    if (held && !a) btn?.$el?.focus();\n")], [pw("the focus stays at the button", "note")]),
    "no_portions": (DIALOG, [("rows.slice(0, limit)", "rows")], [pw("1000 removed and 1000 added", "toHaveCount")]),
}


def run_guard(kind, args):
    """(red at its rule, returncode, the first failing line)."""
    if kind == "py":
        node, at = args
        r = subprocess.run([str(ROOT / "lcnc-gateway/.venv/bin/python3"), "-m", "pytest", "-q", "-p", "no:cacheprovider", "-o", "addopts=", node],
                           cwd=ROOT / "lcnc-gateway", capture_output=True, text=True, timeout=900, env=ENV)
        out = r.stdout + r.stderr
        name = node.split("::")[-1]
        failed = [ln for ln in out.splitlines() if ln.startswith(("FAILED", "SUBFAILED")) and name in ln]
        asserted = any(re.search(r"AssertionError|TimeoutError|CancelledError|KeyError", ln) for ln in out.splitlines() if ln.startswith("E "))
        named = any(at in ln for ln in (failed if at == name or any(at in f for f in failed) else out.splitlines()))
        first = next((ln.strip()[:160] for ln in out.splitlines() if ln.startswith("E ")), "")
        return r.returncode == 1 and bool(failed) and asserted and named, r.returncode, first
    if kind == "vi":
        file, at = args
        r = subprocess.run([str(BIN / "vitest"), "run", file], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=600, env=ENV)
        out = r.stdout + r.stderr
        red = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("×") and at in ln]
        return r.returncode == 1 and bool(red) and "AssertionError" in out, r.returncode, red[0][:160] if red else out[-200:]
    spec, grep, at = args
    b = subprocess.run([str(BIN / "vue-tsc"), "-b"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=600, env=ENV)
    if b.returncode == 0:
        b = subprocess.run([str(BIN / "vite"), "build"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=600, env=ENV)
    if b.returncode:
        return False, b.returncode, "does not build: " + (b.stdout + b.stderr)[-300:]
    r = subprocess.run([str(BIN / "playwright"), "test", spec, "-g", grep, "--workers=1", "--retries=0", "--trace", "off", "--reporter=line"],
                       cwd=ROOT / "lcnc-webui", capture_output=True, text=True, env=ENV)
    out = re.sub(r"\x1b\[[0-9;]*m", "", r.stdout + r.stderr)
    first = next((ln.strip()[:160] for ln in out.splitlines() if "Error:" in ln), out[-200:])
    return r.returncode == 1 and "1 failed" in out and at in out, r.returncode, first


def main(names):
    out = {}
    only = [n for n in names if n not in ("py", "vi", "pw")]
    kinds = [n for n in names if n in ("py", "vi", "pw")]
    for name in only or list(MUTS):
        path, reps, guards = MUTS[name]
        if kinds and not any(k in kinds for k, _a in guards):
            continue
        f = ROOT / path
        orig = f.read_bytes()
        text = orig.decode()
        for old, new in reps:
            if text.count(old) != 1:
                raise SystemExit(f"{name}: anchor not unique in {path} ({text.count(old)}): {old[:90]!r}")
            text = text.replace(old, new)
        try:
            f.write_text(text)
            results = [(k, a, *run_guard(k, a)) for k, a in guards]
        finally:
            f.write_bytes(orig)
        out[name] = all(r[2] for r in results)
        print(json.dumps({"mutation": name, "red_at_rule": out[name],
                          "guards": [{"kind": k, "guard": str(a[0]).split("::")[-1] + (f" · {a[1]}" if len(a) > 1 else ""), "red": red, "rc": rc, "first": first}
                                     for k, a, red, rc, first in results]}, ensure_ascii=False), flush=True)
    if any(k == "pw" for n in out for k, _a in MUTS[n][2]):      # the page of the tree again
        subprocess.run([str(BIN / "vite"), "build"], cwd=ROOT / "lcnc-webui", capture_output=True, env=ENV)
    print(json.dumps({"total": len(out), "red_at_rule": sum(out.values()), "not": [n for n, ok in out.items() if not ok]}))
    return 0 if all(out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
