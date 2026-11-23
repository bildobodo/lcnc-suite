"""P4 red proofs: each mutation breaks ONE rule of the agreed P4 plan (Codex
R433/R434); its named guards must fail. Run from the tree's root under the
heavy lock (a browser guard rebuilds the page and runs its spec); every file
is restored byte-identical in every case.

  python3 -I docs/reviews/p4.mutations.py [name …]   → one line per mutation
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PY = str(ROOT / "lcnc-gateway/.venv/bin/python3")
GW = "lcnc-gateway/"
WEB = "lcnc-webui/"

ER = "test_estop_reset_outcome.py::"
TE = "test_tool_edit_contract.py::TestAnEditOpenedOnAnotherRowWritesNothing::"
TW = "test_tool_table_watch.py::TestTheWatch::"


def py(*nodes):
    return ("pytest", list(nodes))


def vt(file, name):
    return ("vitest", [file, name])


def pw(spec, title):
    return ("pw", [spec, title])


MUTS = {
    # ---- P4-1: E-Stop Reset's observed outcome
    "reset_answers_at_once": (GW + "gateway.py", [(
        "        return await _estop_reset_outcome(conn, booked)\n",
        "        return {\"ok\": True}\n")],
        [py(ER + "TestTheHandler::test_not_confirmed_through_the_socket")]),
    "a_timeout_proves_estop": (GW + "gateway.py", [(
        '        if echo_at is not None and now > echo_at + ESTOP_RESET_SETTLE_S + ESTOP_RESET_LATE_S:\n'
        '            return unknown("no poll after the settle window")',
        '        if echo_at is not None and now > echo_at + ESTOP_RESET_SETTLE_S + ESTOP_RESET_LATE_S:\n'
        '            return {"ok": False, "confirmed": False, "error": ESTOP_RESET_NOT_CONFIRMED}')],
        [py(ER + "TestTheOutcome::test_no_poll_after_the_window_is_unknown")]),
    "a_poll_before_the_write_counts": (GW + "gateway.py", [(
        "            if began > t_w:\n", "            if True:\n")],
        [py(ER + "TestTheOutcome::test_a_poll_in_flight_during_the_write_proves_nothing")]),
    "decided_at_the_echo": (GW + "gateway.py", [(
        "                if echo_at is not None and began >= echo_at + ESTOP_RESET_SETTLE_S:",
        "                if echo_at is not None:")],
        [py(ER + "TestTheOutcome::test_a_bounce_back_into_estop_inside_the_window_is_not_confirmed",
            ER + "TestTheOutcome::test_the_task_left_estop_is_confirmed")]),
    "any_link": (GW + "gateway.py", [(
        "            if lk is not conn:\n                return unknown(\"the Link changed\")\n", "")],
        [py(ER + "TestTheOutcome::test_another_link_is_unknown")]),
    "the_reset_is_never_preempted": (GW + "gateway.py", [(
        '_WS_NO_PREEMPT = _WS_STOP_CMDS | {"arm"}', '_WS_NO_PREEMPT = _WS_STOP_CMDS | {"arm", "estop_reset"}')],
        [py(ER + "TestTheHandler::test_an_estop_from_another_client_displaces_the_wait")]),
    "the_page_ignores_the_outcome": (WEB + "src/App.vue", [(
        "    else if (r.ok === false) showBtnHint(estopButton, typeof r.error === \"string\" ? r.error : \"Reset refused\");\n",
        "")],
        [pw("e2e/setup-gates.spec.ts", "E-Stop Reset not confirmed: said at the Reset button")]),
    # ---- P4-7: a line only with its origin proven
    "seq_is_the_line": (GW + "gcode_parse_worker.py", [(
        "            error_line = proven_error_line(canon)\n", "            error_line = seq\n")],
        [py("test_error_line_golden.py::TestTheProvenErrorLine::test_each_program_names_only_its_proven_line")]),
    # the main context alone (R437): the offset agreement, the caller's frame
    # and the call-line text all removed. The offset agreement ALONE removed
    # stays green — for every golden program the frame and the text catch
    # what it caught (run 3, 2026-11-23): a deliberate third layer
    "the_main_context_alone": (GW + "gcode_parse_worker.py", [
        ("    if at != n or called_from_here:\n", "    if False:\n"),
        ("    if text is None or _CALL_LINE.search(_NGC_COMMENT.sub(\"\", text)):\n", "    if text is None:\n")],
        [py("test_error_line_golden.py::TestTheProvenErrorLine::test_each_program_names_only_its_proven_line")]),
    # ---- R437: the fixes, each its own mutation
    "mt_i20_a_late_poll_decides": (GW + "gateway.py", [(
        "                    if began > echo_at + ESTOP_RESET_SETTLE_S + ESTOP_RESET_LATE_S:\n"
        "                        return unknown(\"no poll after the settle window\")\n", "")],
        [py(ER + "TestTheDeadlinesJudgeTheBegin::test_a_deciding_poll_begun_after_the_final_deadline_is_unknown")]),
    "mt_i20_a_late_echo_opens_the_window": (GW + "gateway.py", [(
        "                    if began > t_w + ESTOP_RESET_ECHO_S:\n"
        "                        return unknown(\"no echo of the write\")\n", "")],
        [py(ER + "TestTheDeadlinesJudgeTheBegin::test_a_first_echo_begun_after_the_echo_deadline_is_unknown")]),
    # the caller's frame and the call-line text are two layers on purpose: an
    # o-word call is caught by either, so the mutation removes both
    "mt_i21_numbers_alone_name_a_called_files_error": (GW + "gcode_parse_worker.py", [
        ("    if at != n or called_from_here:\n", "    if at != n:\n"),
        ("    if text is None or _CALL_LINE.search(_NGC_COMMENT.sub(\"\", text)):\n", "    if text is None:\n")],
        [py("test_error_line_golden.py::TestTheProvenErrorLine::test_each_program_names_only_its_proven_line")]),
    "mt_i22_a_capture_is_not_discardable": (WEB + "src/ToolsetterSettings.vue", [(
        '(g30Dirty.value || g30Op.value === "capture") && g30Op.value !== "save"',
        'g30Dirty.value && g30Op.value !== "save"')],
        [pw("e2e/g30.spec.ts", "a capture from an unchanged draft can be discarded")]),
    "mt_i23_refresh_ignores_entries_since_its_request": (WEB + "src/ToolsetterSettings.vue", [(
        "    const keep = g30Dirty.value || entryRev !== e0;   // R437 MT-I23\n", "    const keep = g30Dirty.value;\n")],
        [pw("e2e/g30.spec.ts", "Refresh keeps an entry made during it that equals the old stored value")]),
    "mt_i23_the_file_read_ignores_entries_since_its_request": (WEB + "src/ToolsetterSettings.vue", [(
        "      const keep = g30Dirty.value || entryRev !== e0;\n", "      const keep = g30Dirty.value;\n")],
        [pw("e2e/g30.spec.ts", "the file read after a units change keeps an entry")]),
    "mt_i24_no_resting_pocket_note": (WEB + "src/ProbePanel.vue", [(
        '<div v-if="pocketNotes.length" class="settingDesc stack-micro">', '<div v-if="false" class="settingDesc stack-micro">')],
        [pw("e2e/probe-click.spec.ts", "a pocket at 0 says its limited search before any press")]),
    "the_page_prints_zero": (WEB + "src/ws/bulkData.ts", [(
        "typeof line === \"number\" && Number.isInteger(line) && line >= 1", "line != null")],
        [vt("src/ws/bulkData.test.ts", "leaves out a line that is no line")]),
    # ---- P4-3: the tool card
    "the_card_outlives_its_tab": (WEB + "src/ToolTablePanel.vue", [(
        "watch(() => props.active, on => { if (on === false) closePreview(); });\n", "")],
        [pw("e2e/tool-preview.spec.ts", "the tab alone closes the card")]),
    "a_pending_hover_opens_late": (WEB + "src/ToolTablePanel.vue", [
        ("  clearTimeout(hoverTimer);\n  hoverTimer = 0;\n  hoverTool.value = null;", "  hoverTool.value = null;"),
        ("    hoverTimer = 0;\n    if (!previewShown()) return;\n", "    hoverTimer = 0;\n")],
        [pw("e2e/tool-preview.spec.ts", "a hover still waiting for its 300 ms never opens after the tab was left")]),
    "no_close_on_an_outside_press": (WEB + "src/ToolTablePanel.vue", [(
        '  window.addEventListener("pointerdown", onPressOutsidePreview, true);\n', "")],
        [pw("e2e/tool-preview.spec.ts", "a tapped card closes on a press outside its row and on a scroll")]),
    # ---- P4-4: the calibration cells
    "the_boss_outside_start_again": (WEB + "src/ProbePanel.vue", [(
        'title="Round boss — above centre" aria-label="Round boss — above centre"',
        'title="Round boss — outside start"')],
        [pw("e2e/probe-click.spec.ts", "Calibrate: \"Round boss — above centre\" is named for its start")]),
    # ---- P4-2: the row the edit was opened on
    "no_row_check": (GW + "gateway.py", [(
        "        conflict = tool_row_conflict(expected, _tool_table_identity(tbl_path), rows, load_tool_library(), tool)\n",
        "        conflict = None\n")],
        [py(TE + "test_a_length_measured_after_the_dialog_opened_is_not_written_back",
            TE + "test_a_renumber_from_an_old_dialog", TE + "test_another_clients_save_since_the_dialog_opened")]),
    "no_table_base_check": (GW + "gateway.py", [(
        '        return None if rows == base else ["table"]\n', "        return None\n")],
        [py(TE + "test_another_row_changed_between_the_edits_read_and_its_write")]),
    "the_inode_is_the_table": (GW + "gateway.py", [(
        '    return {"path": os.path.realpath(tbl_path),\n',
        '    return {"path": f"{os.path.realpath(tbl_path)}@{os.stat(tbl_path).st_ino}",\n')],
        [py(TE + "test_another_tool_measured_after_the_dialog_opened_does_not_block_it")]),
    "the_watch_counts_the_own_write": (GW + "gateway.py", [(
        '            _tool_table_watch["sig"] = sig\n', "            pass\n")],
        [py(TW + "test_the_gateways_own_write_is_the_new_baseline")]),
    "unreadable_is_a_change": (GW + "gateway.py", [(
        "    if sig is None:\n        if not _tool_table_watch[\"failed\"]:",
        "    if sig is None:\n        _tool_table_watch[\"sig\"] = None\n        if not _tool_table_watch[\"failed\"]:")],
        [py(TW + "test_an_unreadable_file_claims_no_new_state")]),
    "the_page_sends_a_newer_read": (WEB + "src/ToolTablePanel.vue", [(
        "  const expected = editExpected;\n",
        "  const expected = rowExpect(tools.value.find(t => t.T === orig.T) ?? orig);\n")],
        [pw("e2e/tool-edit.spec.ts", "a save sends the row the dialog opened on — not a newer read")]),
    # ---- P4-6: G30 Discard
    "discard_during_a_sent_save": (WEB + "src/ToolsetterSettings.vue", [
        ('const g30DiscardWhy = computed(() => g30Op.value === "save" ? "Saving — wait for the answer" : undefined);',
         "const g30DiscardWhy = computed(() => undefined as string | undefined);"),
        ('(g30Dirty.value || g30Op.value === "capture") && g30Op.value !== "save"',
         '(g30Dirty.value || g30Op.value === "capture")')],
        [pw("e2e/g30.spec.ts", "Discard waits for a sent save; the save's outcome is shown")]),
    "refresh_resets_an_entry_typed_before": (WEB + "src/ToolsetterSettings.vue", [(
        "    const keep = g30Dirty.value || entryRev !== e0;   // R437 MT-I23\n",
        "    const keep = entryRev !== e0;\n")],
        [pw("e2e/g30.spec.ts", "Refresh keeps an entry typed BEFORE it (machine day F17)")]),
    # ---- P4-5: the size contract
    "a_boss_at_zero": (WEB + "src/probeFields.ts", [(
        "    return vals.every(v => isSize(v) && v > 0) ? null", "    return vals.every(v => isSize(v)) ? null")],
        [vt("src/probeFields.test.ts", "a Round Boss needs its diameter, a Rect Boss X and Y"),
         pw("e2e/probe-click.spec.ts", "Boss/Pocket: a boss needs its size")]),
    "empty_is_zero": (WEB + "src/probeFields.ts", [(
        'const isSize = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;',
        'const isSize = (v: unknown): v is number => v === "" || v == null || (typeof v === "number" && Number.isFinite(v) && v >= 0);')],
        [vt("src/probeFields.test.ts", "an empty or invalid size is never 0")]),
}


def run_guard(kind, args):
    if kind == "pytest":
        r = subprocess.run([PY, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-o", "addopts=", *args],
                           cwd=ROOT / "lcnc-gateway", capture_output=True, text=True, timeout=900)
        return r.returncode != 0, (r.stdout + r.stderr)[-300:]
    if kind == "vitest":
        r = subprocess.run(["npx", "vitest", "run", args[0], "-t", args[1]], cwd=ROOT / "lcnc-webui",
                           capture_output=True, text=True, timeout=900)
        return r.returncode != 0, (r.stdout + r.stderr)[-300:]
    b = subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900)
    if b.returncode != 0:
        return True, "the build failed: " + b.stdout[-300:]
    r = subprocess.run(["npx", "playwright", "test", args[0], "-g", args[1], "--workers=1", "--retries=0"],
                       cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900)
    return r.returncode != 0, (r.stdout + r.stderr)[-300:]


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
                    raise SystemExit(f"{name}: anchor not unique in {path}: {old[:60]!r}")
                text = text.replace(old, new)
            f.write_text(text)
            results = [run_guard(k, a) for k, a in guards]
        finally:
            f.write_bytes(orig)
        red = all(r for r, _t in results)
        out[name] = {"red": red, "guards": [f"{k}:{a}" for k, a in guards],
                     "tails": [t for r, t in results if not r]}
        print(json.dumps({"mutation": name, "red": red}), flush=True)
    if any(k == "pw" for _p, _r, g in MUTS.values() for k, _a in g):
        subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, timeout=900)
    print(json.dumps({"total": len(out), "red": sum(v["red"] for v in out.values())}))
    return 0 if all(v["red"] for v in out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
