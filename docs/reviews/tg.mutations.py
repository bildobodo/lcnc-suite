"""Tool guard red proofs (Codex R476 answers 2 and 6, MT476-02 / MT476-03):
each mutation breaks ONE rule; its named guards must fail AT that rule (`at`:
the failing test's name, which the output must carry as failed). Run from the
tree's root; every file is restored byte-identical. pytest only, no bytecode
(a .pyc is valid by mtime SECOND and size — two mutations of one length in one
second ran the first one's, 2026-11-25).

  python3 scripts/test_support/heavy_lock.py --who tg -- python3 -I docs/reviews/tg.mutations.py [name ...]
"""
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
G = "lcnc-gateway/"
TABLE, PROOF, GW, READER = G + "tool_table.py", G + "tool_proof.py", G + "gateway.py", G + "hal_reader.py"
P = "test_tool_guard.py::"
W = P + "TestTheWritersLine::"
I = P + "TestLinuxCNCsOwnIndices::"
R = P + "TestPreparedRefusal::"
X = "test_tool_guard_gateway.py::"
POCKET = X + "TestTheSameIndexAndToolInAnotherPocket::"
SHIFT = X + "TestTheIndexShifted::"
BLUNT = X + "TestNotABluntLock::"
KNOWN = X + "TestWhatIsNotKnown::"
STILL = X + "TestStandstillAtTheSend::"
LAST = X + "TestTheWriterAfterTheNewReads::"
LINE = X + "TestTheLineLinuxCNCReads::"

MUTS = {
    # ---- the line the writer emits (tool_table.py) -------------------------
    "a_byte_more": (TABLE, [("    if len(data) > LINE_BYTES_MAX:", "    if len(data) > LINE_BYTES_MAX + 1:")],
                    [W + "test_255_bytes_with_the_newline_is_one_line_one_more_is_not"]),
    # (the 255-byte line refused: the guard fails with the refusal itself)
    "a_byte_less": (TABLE, [("    if len(data) > LINE_BYTES_MAX:", "    if len(data) >= LINE_BYTES_MAX:")],
                    [(W + "test_255_bytes_with_the_newline_is_one_line_one_more_is_not", "ToolTableUnwritable: T5: line too long")]),
    "without_its_newline": (TABLE, [("    if len(data) > LINE_BYTES_MAX:", "    if len(data) - 1 > LINE_BYTES_MAX:")],
                            [W + "test_255_bytes_with_the_newline_is_one_line_one_more_is_not"]),
    "characters_not_bytes": (TABLE, [("    if len(data) > LINE_BYTES_MAX:", "    if len(line) + 1 > LINE_BYTES_MAX:")],
                             [W + "test_255_bytes_with_the_newline_is_one_line_one_more_is_not",
                              LINE + "test_the_bytes_count_not_the_characters"]),
    "no_length_check": (TABLE, [("    if len(data) > LINE_BYTES_MAX:", "    if False:")],
                        [W + "test_the_ghost_the_writer_made", LINE + "test_the_ghost_line_of_every_write"]),
    "shortened_silently": (TABLE, [(
        "    if len(data) > LINE_BYTES_MAX:\n",
        "    if len(data) > LINE_BYTES_MAX and remark:\n        return data[:LINE_BYTES_MAX - 1] + b\"\\n\"\n"
        "    if len(data) > LINE_BYTES_MAX:\n")],
        [W + "test_the_ghost_the_writer_made", LINE + "test_the_ghost_line_of_every_write"]),
    "the_remark_alone_counted": (TABLE, [("    if len(data) > LINE_BYTES_MAX:",
                                          "    if len(remark.encode()) > LINE_BYTES_MAX:")],
                                 [W + "test_the_ghost_the_writer_made", W + "test_the_numbers_of_every_field_count"]),
    "only_the_first_row": (TABLE, [(
        "    return _TABLE_HEAD + b\"\".join(_tool_line(t) for t in sorted(tools, key=lambda x: x[\"T\"]))\n",
        "    rows = sorted(tools, key=lambda x: x[\"T\"])\n    for t in rows[:1]:\n        _tool_line(t)\n"
        "    return _TABLE_HEAD + b\"\".join(_unchecked(t) for t in rows)\n\n\n"
        "def _unchecked(t):\n    try:\n        return _tool_line(t)\n    except ToolTableUnwritable:\n"
        "        return f\"T{t['T']} P{t.get('P', t['T'])} ; {t.get('remark')}\\n\".encode()\n")],
        [W + "test_one_bad_row_writes_no_row", LINE + "test_a_long_line_in_the_file_names_its_tool_and_its_way_out"]),
    "line_breaks_written": (TABLE, [("    if any(c in remark for c in \"\\n\\r\\0\"):", "    if False:")],
                            [W + "test_a_line_break_a_nul_no_text", LINE + "test_a_line_break_or_nul_in_the_text"]),
    "cr_written": (TABLE, [("    if any(c in remark for c in \"\\n\\r\\0\"):", "    if any(c in remark for c in \"\\n\\0\"):")],
                   [W + "test_a_line_break_a_nul_no_text", LINE + "test_a_line_break_or_nul_in_the_text"]),
    "nul_written": (TABLE, [("    if any(c in remark for c in \"\\n\\r\\0\"):", "    if any(c in remark for c in \"\\n\\r\"):")],
                    [W + "test_a_line_break_a_nul_no_text", LINE + "test_a_line_break_or_nul_in_the_text"]),
    "no_text_replaced": (TABLE, [("        data = (line + \"\\n\").encode(\"utf-8\")", "        data = (line + \"\\n\").encode(\"utf-8\", \"replace\")")],
                         [W + "test_a_line_break_a_nul_no_text", LINE + "test_a_text_that_is_no_utf_8"]),
    "t_unbounded": (TABLE, [("    if not _C_INT_MIN <= tn <= _C_INT_MAX:", "    if False:")],
                    [W + "test_the_integers", LINE + "test_a_number_past_linuxcncs_integers"]),
    "p_unbounded": (TABLE, [("    for k, v in ((\"P\", pn), (\"Q\", t.get(\"Q\", 0))):", "    for k, v in ((\"Q\", t.get(\"Q\", 0)),):")],
                    [W + "test_the_integers", LINE + "test_a_pocket_in_the_file_linuxcnc_reads_as_another"]),
    "q_unbounded": (TABLE, [("    for k, v in ((\"P\", pn), (\"Q\", t.get(\"Q\", 0))):", "    for k, v in ((\"P\", pn),):")],
                    [W + "test_the_integers"]),
    "unsigned_bound": (TABLE, [("_C_INT_MIN, _C_INT_MAX = -2 ** 31, 2 ** 31 - 1", "_C_INT_MIN, _C_INT_MAX = -2 ** 31, 2 ** 32 - 1")],
                       [W + "test_the_integers"]),
    "not_finite_written": (TABLE, [("        if k != \"Q\" and not math.isfinite(float(t.get(k, 0.0))):", "        if False:")],
                           [W + "test_a_number_that_is_none"]),
    "written_before_it_is_built": (TABLE, [(
        "    data = tool_table_bytes(tools)\n    atomic_write_bytes(path, data)\n",
        "    atomic_write_bytes(path, b\"\")\n    data = tool_table_bytes(tools)\n    atomic_write_bytes(path, data)\n")],
        [W + "test_the_ghost_the_writer_made"]),
    # ---- LinuxCNC's own indices (home_tools) --------------------------------
    "the_rows_position": (TABLE, [(
        "                    pocket = v\n                    if free < _INDEX_END:",
        "                    pocket = v\n                    if piece.startswith(b\"#\"):\n                        pass\n"
        "                    elif free < _INDEX_END:")],
        [I + "test_every_case_as_linuxcnc_reads_it", R + "test_linuxcncs_index_not_the_rows_position"]),
    "a_semicolon_line_counts": (TABLE, [("        if piece.startswith(b\";\"):\n            continue\n", "        piece = piece.lstrip(b\";\")\n")],
                                [I + "test_every_case_as_linuxcnc_reads_it", R + "test_linuxcncs_index_not_the_rows_position"]),
    "a_skipped_line_takes_none": (TABLE, [(
        "        if valid and index > 0 and tool != -1:", "        if not valid and index > 0:\n            free = index\n"
        "        if valid and index > 0 and tool != -1:")],
        [I + "test_every_case_as_linuxcnc_reads_it", I + "test_the_fuzzed_files"]),
    "a_long_line_is_one": (TABLE, [(
        "        nl = data.find(b\"\\n\", at, at + LINE_BYTES_MAX)\n        end = nl + 1 if nl >= 0 else min(at + LINE_BYTES_MAX, len(data))",
        "        nl = data.find(b\"\\n\", at)\n        end = nl + 1 if nl >= 0 else len(data)")],
        [I + "test_every_case_as_linuxcnc_reads_it"]),
    "integers_not_wrapped": (TABLE, [("    return (v + 2 ** 31) % 2 ** 32 - 2 ** 31", "    return v")],
                             [I + "test_every_case_as_linuxcnc_reads_it"]),
    "split_at_any_blank": (TABLE, [("        for token in part.split(b\" \"):", "        for token in part.split():")],
                           [I + "test_every_case_as_linuxcnc_reads_it"]),
    "t_minus_1_a_tool": (TABLE, [("        if valid and index > 0 and tool != -1:", "        if valid and index > 0:")],
                         [I + "test_every_case_as_linuxcnc_reads_it"]),
    "no_end_of_the_indices": (TABLE, [("_INDEX_END = 1001", "_INDEX_END = 10001")],
                              [I + "test_the_1001st_p_word_takes_no_index"]),
    "an_unknown_number_guessed": (TABLE, [("                if _C_REAL_OTHER_RE.match(rest):", "                if False:")],
                                  [I + "test_what_is_not_mirrored_is_named_never_guessed", R + "test_unknown_is_never_a_default"]),
    "a_nul_guessed": (TABLE, [("        if b\"\\0\" in piece:", "        if False:")],
                      [I + "test_what_is_not_mirrored_is_named_never_guessed"]),
    "pieces_counted_as_lines": (TABLE, [("        n += nl >= 0\n", "        n += 1\n")],
                                [I + "test_the_line_number_is_the_files_not_the_pieces"]),
    # ---- the prepared tool (tool_proof.py) ----------------------------------
    "pocket_not_compared": (PROOF, [("    return None if after == (tool, pocket) else", "    return None if after is not None and after[0] == tool else")],
                            [R + "test_another_row_pocket_or_none_at_the_index", POCKET + "test_save",
                             POCKET + "test_renumber_onto_its_own_number", POCKET + "test_import",
                             POCKET + "test_add_and_delete_write_the_pocket_the_file_got_meanwhile"]),
    "tool_not_compared": (PROOF, [("    return None if after == (tool, pocket) else", "    return None if after is not None and after[1] == pocket else")],
                          [R + "test_the_pins_decide_never_the_file"]),
    "any_index": (PROOF, [("    return None if after == (tool, pocket) else", "    return None if (tool, pocket) in home_tools(data).values() else")],
                  [R + "test_another_row_pocket_or_none_at_the_index", SHIFT + "test_refused_while_prepared",
                   SHIFT + "test_the_sorted_rewrite_of_a_hand_sorted_file", SHIFT + "test_a_hash_line_takes_an_index_the_rewrite_drops"]),
    "a_row_gone_admitted": (PROOF, [("    return None if after == (tool, pocket) else", "    return None if after is None or after == (tool, pocket) else")],
                            [SHIFT + "test_past_the_end_of_the_file"]),
    "nothing_judged": (PROOF, [("    return None if after == (tool, pocket) else", "    return None if True else")],
                       [SHIFT + "test_refused_while_prepared", POCKET + "test_save"]),
    "a_blunt_lock": (PROOF, [("    return None if after == (tool, pocket) else", "    return None if False else")],
                     [BLUNT + "test_a_length_a_diameter_a_text_of_any_tool", BLUNT + "test_add_delete_renumber_behind_it",
                      BLUNT + "test_an_import_that_keeps_it"]),
    "the_parsers_rows": (PROOF, [("        after = home_tools(data).get(index)\n",
                                  "        after = {n: (r[\"T\"], r[\"P\"]) for n, r in enumerate(parse_tool_table_bytes(data), 1)}.get(index)\n")],
                         [R + "test_linuxcncs_index_not_the_rows_position"]),
    "t0_is_prepared": (PROOF, [("    if index <= 0:\n        return None if", "    if index < 0:\n        return None if")],
                       [SHIFT + "test_admitted_when_nothing_is_prepared", R + "test_nothing_prepared"]),
    "unread_index_is_none_prepared": (PROOF, [("    if type(index) is not int or index < -1:\n        return PREPARED_UNREAD\n",
                                               "    if type(index) is not int or index < -1:\n        index = -1\n")],
                                      [KNOWN + "test_the_index_not_read", R + "test_unknown_is_never_a_default"]),
    "a_bool_is_an_index": (PROOF, [("    if type(index) is not int or index < -1:", "    if not isinstance(index, int) or index < -1:")],
                           [KNOWN + "test_the_index_not_read", R + "test_unknown_is_never_a_default"]),
    "under_way_ignored": (PROOF, [("    if preparing is True:\n        return PREPARING\n", "")],
                          [KNOWN + "test_a_preparation_under_way", R + "test_under_way"]),
    "older_reader_admitted": (PROOF, [("        return None if preparing is False or tool == 0 else PREPARED_UNKNOWN", "        return None")],
                              [KNOWN + "test_an_older_reader_admits_only_where_it_proves_nothing_is_prepared", R + "test_nothing_prepared"]),
    "older_reader_locked_out": (PROOF, [("        return None if preparing is False or tool == 0 else PREPARED_UNKNOWN",
                                         "        return None if preparing is False else PREPARED_UNKNOWN")],
                                [KNOWN + "test_an_older_reader_admits_only_where_it_proves_nothing_is_prepared", R + "test_nothing_prepared"]),
    "a_random_changer_judged": (PROOF, [("    if scope is not None:\n        return f\"Prepared tool not checked ({scope}) — send T0\"\n", "")],
                                [KNOWN + "test_a_random_changer_and_a_tool_database", R + "test_no_index_is_judged_outside_rule_rs_scope"]),
    "an_absent_pocket_is_0": (PROOF, [("    if preparing is not False or tool is None or type(pocket) is not int:\n        return PREPARED_UNKNOWN\n",
                                       "    tool, pocket = tool or 0, pocket if type(pocket) is int else 0\n")],
                              [KNOWN + "test_the_pins_absent_from_the_snapshot", R + "test_unknown_is_never_a_default"]),
    "cleared_pins_admitted": (PROOF, [("        return PREPARED_CLEARED\n", "        return None\n")],
                              [KNOWN + "test_the_pins_cleared_by_an_e_stop", R + "test_unknown_is_never_a_default"]),
    # ---- the gateway ---------------------------------------------------------
    "edits_not_asked": (GW, [(
        "    why = _write_admission_refusal(conn_key, tool_table=True, owner=owner, load=data)\n    if why:\n        _trace.emit(\"tools.edit_admission_lost\"",
        "    why = _write_admission_refusal(conn_key, tool_table=True, owner=owner)\n    if why:\n        _trace.emit(\"tools.edit_admission_lost\"")],
        [SHIFT + "test_refused_while_prepared", STILL + "test_moving"]),
    "import_not_asked": (GW, [(
        "        why = _write_admission_refusal(conn_key, tool_table=True, owner=owner, load=data)\n        if why:\n            raise HTTPException",
        "        why = _write_admission_refusal(conn_key, tool_table=True, owner=owner)\n        if why:\n            raise HTTPException")],
        [POCKET + "test_import", STILL + "test_moving"]),
    "asked_before_the_reads_only": (GW, [
        ("    why = _write_admission_refusal(conn_key, tool_table=True, owner=owner)\n    if why:\n        raise PermissionError(why)\n    conflict = check()",
         "    why = _write_admission_refusal(conn_key, tool_table=True, owner=owner, load=tool_table_bytes(tools))\n    if why:\n        raise PermissionError(why)\n    conflict = check()"),
        ("    why = _write_admission_refusal(conn_key, tool_table=True, owner=owner, load=data)\n    if why:\n        _trace.emit(\"tools.edit_admission_lost\"",
         "    why = _write_admission_refusal(conn_key, tool_table=True, owner=owner)\n    if why:\n        _trace.emit(\"tools.edit_admission_lost\"")],
        [STILL + "test_a_jog_begun_while_the_write_reads"]),
    "behind_the_writer": (GW, [(
        "        if load is not None:\n            why = _tool_load_refusal(stat, hal, load, owner.scope if owner is not None else _TOOL_SCOPE_UNKNOWN)\n"
        "            if why:\n                return why\n    return standing()\n",
        "    why = standing()\n    if why:\n        return why\n    if load is not None:\n"
        "        return _tool_load_refusal(stat, hal, load, owner.scope if owner is not None else _TOOL_SCOPE_UNKNOWN)\n    return None\n")],
        [LAST + "test_disarmed", LAST + "test_unregistered", LAST + "test_a_start_claimed", LAST + "test_another_link"]),
    "motion_read_before_the_poll": (GW, [
        ("        stat = link().stat\n        stat.poll()\n    except Exception as e:  # noqa: BLE001 - no fresh read, no write\n",
         "        stat = copy.copy(link().stat)\n        link().stat.poll()\n    except Exception as e:  # noqa: BLE001 - no fresh read, no write\n")],
        [STILL + "test_the_poll_decides_not_what_was_read_before"]),
    # ---- one snapshot, a known end of the preparation (Codex R481 MT-I44 / MT-I45)
    "no_known_end_of_the_preparation": (PROOF, [("    if preparing is not False or tool is None or", "    if tool is None or")],
                                        [R + "test_a_preparation_not_known_to_have_ended", KNOWN + "test_the_pins_absent_from_the_snapshot"]),
    "the_pins_of_a_later_snapshot": (GW, [(
        "    number, pocket = hal.get(\"tool_prep_number\"), hal.get(\"tool_prep_pocket\")\n",
        "    number, pocket = _reader_fresh_get(\"tool_prep_number\"), _reader_fresh_get(\"tool_prep_pocket\")\n")],
        [KNOWN + "test_one_snapshot_decides"]),
    "the_preparation_of_a_later_snapshot": (GW, [("None), hal.get(\"tool_prepare\")\n", "None), _reader_fresh_get(\"tool_prepare\")\n")],
                                            [KNOWN + "test_one_snapshot_decides"]),
    "the_request_of_another_snapshot": (GW, [(
        "        if hal is None or hal.get(\"tool_change\") is None:\n            return \"Tool change request unknown — HAL reader stale\"\n"
        "        if hal[\"tool_change\"]:\n",
        "        pending = _reader_fresh_get(\"tool_change\")\n        hal = _reader_fresh_snapshot() or {}\n        if pending is None:\n"
        "            return \"Tool change request unknown — HAL reader stale\"\n        if pending:\n")],
        [KNOWN + "test_one_snapshot_decides"]),
    "the_freshness_of_another_snapshot": (GW, [(
        "    state = _reader_state_now()\n    if state is None or time.monotonic() - state[1] > _hal_bridge.stale_sec:\n        return None\n",
        "    state = _reader_state_now()\n    if state is None or _reader_is_stale():\n        return None\n")],
        [KNOWN + "test_the_freshness_is_the_taken_snapshots"]),
    "a_stale_snapshot_counts": (GW, [(
        "    if state is None or time.monotonic() - state[1] > _hal_bridge.stale_sec:\n", "    if state is None:\n")],
        [KNOWN + "test_the_reader_stale", "test_button_gates_b.py::TestWriteAdmission::test_an_unknown_tool_change_refuses_the_table"]),
    "standstill_not_asked": (GW, [("    if not still:\n        return MACHINE_MOVING_WAIT\n    index, preparing =", "    index, preparing =")],
                             [STILL + "test_moving", STILL + "test_a_jog_begun_while_the_write_reads"]),
    "unread_motion_stands": (GW, [("    if still is None:\n        return MOTION_UNKNOWN\n    if not still:\n        return MACHINE_MOVING_WAIT\n    index, preparing =",
                                   "    if still is False:\n        return MACHINE_MOVING_WAIT\n    index, preparing =")],
                             [STILL + "test_unread"]),
    "e_stop_refuses": (GW, [("    if still is None:\n        return MOTION_UNKNOWN\n    if not still:\n        return MACHINE_MOVING_WAIT\n    index, preparing =",
                             "    if still is None:\n        return MOTION_UNKNOWN\n    if not still or getattr(stat, \"estop\", 0):\n        return MACHINE_MOVING_WAIT\n    index, preparing =")],
                       [STILL + "test_e_stop_and_machine_off_stand"]),
    "a_write_without_a_reload_asked": (GW, [("        if load is not None:\n            why = _tool_load_refusal(stat, hal, load,",
                                             "        if tool_table:\n            load = load or b\"\"\n            why = _tool_load_refusal(stat, hal, load,")],
                                       [("test_tool_refresh.py::TestMetadataRefreshRoutes::test_it_sends_no_reload_so_nothing_of_one_is_asked",
                                         "HTTPException: 409: Machine moving")]),
    "the_line_inside_the_effect": (GW, [(
        "    try:\n        data = tool_table_bytes(tools)\n    except ToolTableUnwritable as e:\n"
        "        _trace.emit(\"tools.line_refused\", level=\"warn\", reason=str(e))\n        raise PermissionError(str(e)) from None\n    why =",
        "    data = b\"\"\n    why =")],
        [LINE + "test_the_refusal_comes_before_the_file_effect", LINE + "test_the_ghost_line_of_every_write"]),
    "the_import_line_a_500": (GW, [(
        "            raise HTTPException(status_code=400, detail=str(e)) from None\n        # Admitted at the write itself",
        "            raise\n        # Admitted at the write itself")],
        [(LINE + "test_the_ghost_line_of_every_write", "ToolTableUnwritable: T2: line too long")]),
    # ---- the reader ----------------------------------------------------------
    "pocket_pin_not_read": (READER, [("    (\"iocontrol.0.tool-prep-pocket\", \"tool_prep_pocket\",  int),\n", "")],
                            [P + "TestTheReadersPins::test_the_preparation_on_the_snapshot_and_absent_when_unread"]),
    "prepare_pin_not_read": (READER, [("    (\"iocontrol.0.tool-prepare\",     \"tool_prepare\",      bool),\n", "")],
                             [P + "TestTheReadersPins::test_the_preparation_on_the_snapshot_and_absent_when_unread"]),
    "the_pocket_from_the_number": (READER, [("(\"iocontrol.0.tool-prep-pocket\", \"tool_prep_pocket\"", "(\"iocontrol.0.tool-prep-number\", \"tool_prep_pocket\"")],
                                   [P + "TestTheReadersPins::test_the_preparation_on_the_snapshot_and_absent_when_unread"]),
    "an_unread_pin_is_0": (READER, [(
        "                snap[field] = coerce(hal.get_value(source))\n            _note_pin_ok(source)\n        except Exception as e:\n",
        "                snap[field] = coerce(hal.get_value(source))\n            _note_pin_ok(source)\n        except Exception as e:\n            snap[field] = coerce(0)\n")],
        [P + "TestTheReadersPins::test_the_preparation_on_the_snapshot_and_absent_when_unread"]),
}


def run_guard(guard):
    node, words = guard if isinstance(guard, tuple) else (guard, "AssertionError")
    r = subprocess.run([str(ROOT / "lcnc-gateway/.venv/bin/python3"), "-m", "pytest", "-q", "-p", "no:cacheprovider",
                        "-o", "addopts=", node], cwd=ROOT / "lcnc-gateway", capture_output=True, text=True,
                       timeout=900, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    out = r.stdout + r.stderr
    name = node.split("::")[-1]
    # red AT the rule: that very test failed (or a subtest of it) on an
    # assertion (or with the named refusal) — not an import or a collection error
    failed = any(ln.startswith(("FAILED", "SUBFAILED")) and name in ln for ln in out.splitlines())
    asserted = any(words in ln for ln in out.splitlines())
    first = next((ln.strip()[:200] for ln in out.splitlines() if ln.startswith("E ") and "Error" in ln), "")
    return r.returncode == 1 and failed and asserted, r.returncode, first


def main(names):
    out = {}
    for name in names or list(MUTS):
        path, reps, guards = MUTS[name]
        f = ROOT / path
        orig = f.read_bytes()
        text = orig.decode()
        for old, new in reps:
            if text.count(old) != 1:
                raise SystemExit(f"{name}: anchor not unique in {path} ({text.count(old)}): {old[:70]!r}")
            text = text.replace(old, new)
        try:
            f.write_text(text)
            results = [(g, *run_guard(g)) for g in guards]
        finally:
            f.write_bytes(orig)
        results = [(g[0] if isinstance(g, tuple) else g, *rest) for g, *rest in results]
        out[name] = all(r[1] for r in results)
        print(json.dumps({"mutation": name, "red_at_rule": out[name],
                          "guards": [{"guard": g.split("::")[-1], "red": red, "rc": rc, "first": first}
                                     for g, red, rc, first in results]}, ensure_ascii=False), flush=True)
    print(json.dumps({"total": len(out), "red_at_rule": sum(out.values()),
                      "not": [n for n, ok in out.items() if not ok]}))
    return 0 if all(out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
