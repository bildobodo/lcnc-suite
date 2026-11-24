"""P6 "tool files read" red proofs (plan maschinentag.r465 v4 §10, Codex R465
MT465-01 / MT-TF1 / Q465-1): each mutation breaks ONE rule; its named guards
must fail AT that rule (`at`: a text the failing output must carry — the
failing test's name or its assertion message). Run from the tree's root;
every file is restored byte-identical. Page guards (pw) rebuild the page with
the mutation and run their spec — under the heavy lock (the page is rebuilt
from the restored tree afterwards).

  python3 scripts/test_support/heavy_lock.py --who p6tf -- python3 -I docs/reviews/p6tf.mutations.py [name ...]
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
G = "lcnc-gateway/"
PROOF = G + "tool_proof.py"
TABLE = G + "tool_table.py"
GW = G + "gateway.py"
STORE = "lcnc-webui/src/toolTableRead.ts"
PANEL = "lcnc-webui/src/ToolTablePanel.vue"
TP = "test_tool_proof.py::"
TG = "test_tool_proof_gateway.py::"
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
    # ---- MT-TF1 --------------------------------------------------------------
    "no_basis_admission": (GW, [(
        "    why = _tool_edit_refusal(proof)\n    if why is not None:\n",
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
        "        check = _tool_edit_check(tbl_path, tbl_tools)\n        tbl_tools.append({",
        "        check = lambda: None   # noqa: E731\n        tbl_tools.append({")],
        [py(TG + "TestMTTF1TheBasisMustBeComplete::test_an_add_or_delete_compares_its_base_in_the_write_thread",
            "add_tool")]),
    # ---- Q465-1 --------------------------------------------------------------
    "the_switch_ignored": (PROOF, [(
        "        if why in (SCOPE_RANDOM, SCOPE_DATABASE) and not UNCHECKED_EDITS_BLOCKED:\n            return None\n", "")],
        [py(TP + "TestTheEditAdmissionAndTheQ4651Switch::test_the_switch_off_admits_only_the_two_scopes",
            "test_the_switch_off_admits_only_the_two_scopes"),
         py(TG + "TestQ4651TheSwitchPoint::test_switched_off_it_edits", "test_switched_off_it_edits")]),
    "unchecked_edits_admitted_by_default": (PROOF, [(
        "UNCHECKED_EDITS_BLOCKED = True\n", "UNCHECKED_EDITS_BLOCKED = False\n")],
        [py(TP + "TestTheEditAdmissionAndTheQ4651Switch::test_the_switch_blocks_by_default_and_names_why",
            "default until the operator answers"),
         py(TG + "TestQ4651TheSwitchPoint::test_blocked_by_default_reading_stays", "test_blocked_by_default_reading_stays")]),
    # ---- the store (toolTableRead.ts) ----------------------------------------
    "store_an_old_epoch_applies": (STORE, [(
        "  applies(t: ToolReadTicket): boolean { return this.open && t.epoch === this.epoch && t.seq === this.seq; }",
        "  applies(t: ToolReadTicket): boolean { return this.open && t.seq === this.seq; }")],
        [vt("is dropped after a sequence restart", "is dropped after a sequence restart")]),
    "store_partial_empty_is_no_tools": (STORE, [(
        "  return { kind: \"partial\", rows, error: null, note: partialNote(proof, unread), empty: TOOL_TABLE_NOT_CONFIRMED,",
        "  return { kind: \"partial\", rows, error: null, note: partialNote(proof, unread), empty: TOOL_TABLE_NO_TOOLS,")],
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
        "  return `File incomplete or differs from LinuxCNC${parts.length ? \" — \" + parts.join(\"; \") : \"\"}.`;",
        "  return `${proof.missing.length ? \"File is being written\" : \"File incomplete or differs from LinuxCNC\"}"
        "${parts.length ? \" — \" + parts.join(\"; \") : \"\"}.`;")],
        [vt("a partial note is neutral", "a partial note is neutral")]),
    # ---- the page (ToolTablePanel.vue) ---------------------------------------
    "page_no_tools_for_every_empty_table": (PANEL, [(
        "const emptyText = computed(() => readView.value?.empty ?? TOOL_TABLE_NOT_READ);",
        "const emptyText = computed(() => readView.value ? \"No tools in the table. Add tools manually or import a Fusion"
        " 360 or FreeCAD library.\" : TOOL_TABLE_NOT_READ);")],
        [pw(STATE_SPEC, "a partial read without rows is not 'No tools'")]),
    "page_a_failed_read_keeps_its_rows": (PANEL, [(
        "  tools.value = view.rows;\n",
        "  if (view.kind !== \"failed\") tools.value = view.rows;\n")],
        [pw(STATE_SPEC, "a failed read shows no rows, never an empty table")]),
}


def failures(text):
    lines = text.splitlines()
    return [" | ".join(x.strip() for x in lines[i:i + 3] if x.strip())[:300]
            for i, ln in enumerate(lines) if "AssertionError" in ln or "FAIL" in ln or "Error:" in ln]


def run_guard(kind, args):
    if kind == "pytest":
        r = subprocess.run([str(ROOT / "lcnc-gateway/.venv/bin/python3"), "-m", "pytest", "-q", "-p", "no:cacheprovider",
                            "-o", "addopts=", args[0]], cwd=ROOT / "lcnc-gateway", capture_output=True, text=True,
                           timeout=900)
        return r.returncode != 0, r.stdout + r.stderr, args[1]
    if kind == "vitest":
        r = subprocess.run(["npx", "vitest", "run", args[0], "-t", args[1]], cwd=ROOT / "lcnc-webui",
                           capture_output=True, text=True, timeout=900)
        return r.returncode != 0, r.stdout + r.stderr, args[2]
    if kind == "pw":
        b = subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900)
        if b.returncode != 0:
            return False, b.stdout + b.stderr, args[2]
        # never under a timeout: a killed runner orphans its web server (4173)
        r = subprocess.run(["npx", "playwright", "test", args[0], "-g", args[1], "--workers=1", "--reporter=list"],
                           cwd=ROOT / "lcnc-webui", capture_output=True, text=True)
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
                subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, timeout=900, check=True)
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
