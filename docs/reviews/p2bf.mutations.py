"""P2b-F1 red proofs (plan v3, Codex R449-R451; R452 MT-I29..MT-I31): each mutation breaks ONE
rule; its named guard must fail AT that rule. Run from the tree's root; every
file is restored byte-identical. Unit guards run light; a browser guard (pw)
rebuilds the page and runs its spec - under the heavy lock (the page is
rebuilt from the restored tree afterwards).

  python3 -I docs/reviews/p2bf.mutations.py [name ...]
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = "lcnc-webui/"
S = WEB + "src/"
GW = "lcnc-gateway/"


def vt(file, name, at):
    return ("vitest", [file, name, at])


def py(node, at):
    return ("pytest", [node, at])


def pw(spec, grep, at):
    """A browser guard: the page rebuilt with the mutation, its spec run."""
    return ("pw", [spec, grep, at])


PI = "test_program_identity.py::"
PW = "test_preview_wait.py::"
CG = "test_calc_lifetime_gateway.py::"
Q = '"'

MUTS = {
    # ---- F1-1: the program identity on the gateway
    "the_start_check_by_path": (GW + "bulk_pipeline.py", [(
        "        if (not filepath or self.last_file != filepath or not self.preview_available()\n"
        "                or not self.published_is_active()):\n",
        "        if (not filepath or self.last_file != filepath or not self.preview_available()):\n")],
        [py(PI + "ThePublicationNamesItsLoad::test_stamped_with_the_spawn_generation_and_foreign_after_a_reload",
            "no publication of this program")]),
    "a_reload_of_the_same_path_no_edge": (GW + "gateway_util.py", [(
        "        if program_id != published_program:\n            return True\n", "")],
        [py(PI + "TheIdentityEdge::test_the_edge_is_the_identity_then_the_path_and_mtime", "the same path reloaded")]),
    "a_null_identity_is_an_edge": (GW + "gateway_util.py", [(
        "        if not active_file or not program_id:\n            return False\n",
        "        if not active_file:\n            return False\n")],
        [py(PI + "TheIdentityEdge::test_the_edge_is_the_identity_then_the_path_and_mtime", "no program proven")]),
    "the_connect_schedules_again": (GW + "gateway.py", [(
        "                else:\n                    _gcode_path = " + Q + "awaiting-poller-edge" + Q,
        "                elif _bulk.schedule_refresh(initial_file, " + Q + "connect" + Q + ", _spawn_preview_task):\n"
        "                    _gcode_path = " + Q + "refresh-scheduled" + Q + "\n"
        "                else:\n                    _gcode_path = " + Q + "awaiting-poller-edge" + Q)],
        [py(PI + "TheConnectNeverSchedules::test_the_websocket_endpoint_plans_no_parse", "the one scheduler")]),
    "the_own_load_skips_the_run": (GW + "gateway.py", [(
        "    if not (file_changed and _own_load_unparsed()) and not _actions_quiet():",
        "    if file_changed and _own_load_unparsed():\n        return None\n    if not _actions_quiet():")],
        [py(CG + "TheFirstLoadsRestart::test_a_real_load_never_parses_under_a_run_or_a_move", "no unpinned parse")]),
    "a_restored_program_counts_as_own": (GW + "gateway.py", [(
        "    return (prog.loaded_own and prog.loaded_gen is not None",
        "    return (prog.loaded_gen is not None")],
        [py(PI + "TheRestoredProgramIsARestart::test_a_restored_program_under_a_run_waits", "restored: no own load")]),
    "no_begin_admission": (GW + "bulk_pipeline.py", [(
        "            if not pinned and self.admit_begin is not None:",
        "            if False and not pinned and self.admit_begin is not None:")],
        [py(PI + "TheBeginAdmission::test_a_begin_under_a_run_reads_no_basis", "no worker")]),
    "the_admission_after_the_basis": (GW + "bulk_pipeline.py", [(
        "            if not pinned and self.admit_begin is not None:",
        "            stat = self._get_stat()\n            if not pinned and self.admit_begin is not None:")],
        [py(PI + "TheBeginAdmission::test_a_begin_under_a_run_reads_no_basis", "no live-basis read")]),
    "a_failed_poll_admits": (GW + "gateway.py", [(
        "        _trace.emit_exc(" + Q + "gcode.begin_poll_failed" + Q + ", e)\n        return " + Q + "unread" + Q,
        "        _trace.emit_exc(" + Q + "gcode.begin_poll_failed" + Q + ", e)\n        return None")],
        [py(PI + "TheBeginAdmission::test_the_gateway_admission_reads_the_controller_now", "a failed poll is no read")]),
    "the_route_serves_another_pair": (GW + "gateway.py", [(
        "    if (v is not None and v != version) or (p is not None and p != (program or " + Q + Q + ")):",
        "    if False:")],
        [py(PI + "ThePreviewRouteServesOneTuple::test_the_asked_pair_or_409", "AssertionError")]),
    "auto_run_without_its_load": (GW + "gateway.py", [(
        "                or not isinstance(program_id, str) or program_id != _active_program_id()\n"
        "                or program_id != _bulk.published_program):",
        "                ):")],
        [py("test_command_dispatch.py::TestHandlerExecution::test_auto_run_is_bound_to_the_program_it_was_confirmed_on",
            "AssertionError")]),
    # ---- F1-3: the wait, named
    "only_the_first_action": (GW + "gateway_util.py", [(
        "            out.extend(busy)", "            out.append(busy[0])")],
        [py(PW + "EveryReasonIsNamed::test_combined_and_the_own_load", "AssertionError")]),
    "moving_is_running": (GW + "gateway_util.py", [(
        "        out.append(" + Q + "moving" + Q + ")", "        out.append(" + Q + "running" + Q + ")")],
        [py(PW + "EveryReasonIsNamed::test_each_reason_alone", "moving, not running")]),
    "an_overdue_writer_unnamed": (GW + "calc_lifetime.py", [(
        "                        out.append(f" + Q + "overdue:{o.what}" + Q + ")", "                        pass")],
        [py(PW + "EveryOpenActionIsNamed::test_an_open_action_after_its_handler_and_an_overdue_writer",
            "past its limit it still holds")]),
    "the_refresh_gap_again": (GW + "bulk_pipeline.py", [(
        "        if inf is None:\n            # scheduled, not begun yet",
        "        if inf is None:\n            return None\n            # scheduled, not begun yet")],
        [py(PW + "TheRefreshIsNamedFromItsSchedule::test_starting_then_running_and_a_refused_begin_named",
            "named from the schedule on")]),
    "a_foreign_schedule_ends_the_wait": (GW + "gateway.py", [(
        "or (inf is None and sch is not None and sch.get(" + Q + "program_id" + Q + ") == pid)):",
        "or (inf is None and sch is not None)):")],
        [py(PW + "TheRecordLivesWithItsProgram::test_a_new_load_replaces_it_its_schedule_and_its_publication_end_it",
            "AssertionError")]),
    "the_last_end_of_any_program": (GW + "gateway.py", [(
        "if end is not None and end.get(" + Q + "program_id" + Q + ") == pid else {}),", "if end is not None else {}),")],
        [py(PW + "TheRecordLivesWithItsProgram::test_a_job_ended_unpublished_is_named_for_its_program_only",
            "AssertionError")]),
    # ---- F1-2: the page's identity gate
    "the_gate_open": (S + "ws/bulkData.ts", [(
        "  const next = g && _matches(g.programId, activeProgramId.value) ? g : null;",
        "  const next = g;")],
        [vt("src/ws/bulkData.test.ts", "another program's payload is held", "A2's path is not C's")]),
    "null_matches_null": (S + "ws/bulkData.ts", [(
        "const _matches = (id: string | null | undefined, active: string | null) => !!id && !!active && id === active;",
        "const _matches = (id: string | null | undefined, active: string | null) => (id ?? null) === active;")],
        [vt("src/ws/bulkData.test.ts", "another program's payload is held", "AssertionError")]),
    "text_without_its_proof": (S + "ws/bulkData.ts", [(
        "      if (programId && originSource && source && source === originSource) {",
        "      if (programId) {")],
        [vt("src/ws/bulkData.test.ts", "text without its proof", "AssertionError")]),
    "hidden_is_a_load_in_flight": (S + "ws/bulkData.ts", [(
        "  gcodeRevision.value = ann ? ann.rev : " + Q + Q + ";",
        "  gcodeRevision.value = ann ? ann.rev : " + Q + "hidden" + Q + ";")],
        [vt("src/ws/bulkData.test.ts", "another program's payload is held", "no start lock")]),
    "a_late_text_of_the_old_load": (S + "ws/bulkData.ts", [(
        "    .then(({ text, source }) => {\n      if (_textAnn.value !== ann) return;\n",
        "    .then(({ text, source }) => {\n")],
        [vt("src/ws/bulkData.test.ts", "late answers of another load", "the old load's late text")]),
    "the_lines_bound_by_identity_only": (S + "ws/bulkData.ts", [(
        "  return !!g && gcodeContent.value != null && g.publishedVersion === _shownTextVersion.value;",
        "  return !!g && gcodeContent.value != null;")],
        [vt("src/ws/bulkData.test.ts", "the lines are bound only", "no marks")]),
    "a_409_leaves_loading": (S + "ws/bulkData.ts", [(
        "    previewDecoding.value = false;\n    if (m.superseded) {",
        "    if (m.superseded) {")],
        [vt("src/ws/bulkData.test.ts", "a 409 ends the load as superseded", "never a lasting loading state")]),
    "the_run_check_without_its_load": (S + "viewer/checkBasis.ts", [(
        "  if (o.programId == null || o.programId !== r.programId || (i.shownProgramId ?? null) !== o.programId) {",
        "  if (false) {")],
        [vt("src/viewer/checkBasis.test.ts", "every other case waits for idle", "another load")]),
    "after_the_run_at_idle": (S + "previewWait.ts", [(
        "  if (reasons.includes(" + Q + "running" + Q + ") && i.running && !i.runVerified) {",
        "  if (reasons.includes(" + Q + "running" + Q + ")) {")],
        [vt("src/previewWait.test.ts", "a run started before its preview", "AssertionError")]),
    "the_note_ends_with_the_payload": (S + "previewWait.ts", [(
        "  if (i.textState === " + Q + "loading" + Q + ") panel = " + Q + "Program text loading" + Q + ";",
        "  if (i.textState === " + Q + "loading" + Q + " && !i.previewShown) panel = " + Q + "Program text loading" + Q + ";")],
        [vt("src/previewWait.test.ts", "per kind of data", "AssertionError")]),
    "the_conflict_by_path": (S + "GcodePanel.vue", [(
        "  if (active == null || active === sessionProgramId.value) return false;",
        "  if (active == null || active === sessionProgramId.value || active !== null) return false;")],
        [pw("e2e/program-identity.spec.ts", "the editor's session is its load", "data-edit-conflict")]),
    # ---- Codex R452: MT-I29 the job bound at its schedule
    "the_job_rereads_its_load": (GW + "bulk_pipeline.py", [(
        "        if program_gen is None and _gen_at is not None:\n            program_gen = _gen_at[0]\n",
        "        if _gen_at is not None:\n            program_gen = _gen_at[0]\n")],
        [py(PI + "TheJobIsBoundAtItsSchedule::test_a_load_before_the_first_step_discards_the_job",
            "the new load's identity is never taken")]),
    "no_load_check_after_the_hash": (GW + "bulk_pipeline.py", [(
        "            if self._program_moved(program_gen, job, filepath, " + Q + "after_hash" + Q + "):\n"
        "                _gen_published[" + Q + "why" + Q + "] = " + Q + "discarded" + Q + "\n"
        "                return\n", "")],
        [py(PI + "TheJobIsBoundAtItsSchedule::test_a_load_during_the_hash_discards_the_job_before_its_worker",
            "no worker for a job whose load is gone")]),
    "the_discard_books_the_new_load": (GW + "bulk_pipeline.py", [(
        "        try:\n            # Another load began between the schedule and this first step:",
        "        try:\n            if _gen_at is not None:\n                self.spawned_program_gen = _gen_at[0]\n"
        "            # Another load began between the schedule and this first step:")],
        [py(PI + "TheJobIsBoundAtItsSchedule::test_a_load_before_the_first_step_discards_the_job",
            "the new load's first parse is not booked as spawned")]),
    "the_schedule_without_its_status_identity": (GW + "bulk_pipeline.py", [(
        "        if program_id is not None and _sched_gen is not None and _bound != program_id:",
        "        if False:")],
        [py(PI + "TheJobIsBoundAtItsSchedule::test_the_schedule_binds_the_path_to_its_status_identity",
            "not scheduled")]),
    # ---- Codex R452: MT-I31 a preview load error is its own load's
    "the_preview_error_unbound": (S + "ws/bulkData.ts", [(
        "  const own = job && _matches(job.programId, activeProgramId.value) ? job.text : null;",
        "  const own = job ? job.text : null;")],
        [vt("src/ws/bulkData.test.ts", "a preview load failure is its own load", "an old load's late failure is not the active program's")]),
    "the_error_tagged_by_the_active_load": (S + "ws/bulkData.ts", [(
        "      _previewErr.value = { programId: m.programId ?? null, text:",
        "      _previewErr.value = { programId: activeProgramId.value, text:")],
        [vt("src/ws/bulkData.test.ts", "a preview load failure is its own load", "an old load's late failure is not the active program's")]),
    "the_worker_failure_bound_to_a_load": (S + "ws/bulkData.ts", [(
        "    _previewWorkerErr.value = `preview worker error: ${ev.message}`;",
        "    _previewErr.value = { programId: _previewLastProgram, text: `preview worker error: ${ev.message}` };")],
        [vt("src/ws/bulkData.test.ts", "a preview load failure is its own load", "the worker's own failure under any load")]),
    # ---- Codex R452: MT-I30 the own reload in either order
    "the_adoption_on_the_status_only": (S + "GcodePanel.vue", [(
        "watch([() => props.activeProgramId, sessionOwnReload], _adoptOwnReload);",
        "watch(() => props.activeProgramId, _adoptOwnReload);"), (
        "          // the status may show that load already: adopted now (MT-I30)\n          _adoptOwnReload();\n", "")],
        [pw("e2e/program-identity.spec.ts", "own reload is its load, status-first",
            "the own reload is not a foreign program change")]),
    "the_session_keeps_its_old_load": (S + "GcodePanel.vue", [(
        "  s.programId = active;\n  sessionProgramId.value = active;\n",
        "  sessionProgramId.value = active;\n")],
        [pw("e2e/program-identity.spec.ts", "own reload is its load, status-first",
            "the next save ends the session")]),
    "an_old_reply_takes_any_load": (S + "GcodePanel.vue", [(
        "  if (!s || s.ownReload == null || active == null || active !== s.ownReload) return;",
        "  if (!s || s.ownReload == null || active == null) return;")],
        [pw("e2e/program-identity.spec.ts", "a foreign load shown before the own reload",
            "a foreign load is never the session's by an old reply")]),
    "the_reply_is_the_panels": (S + "GcodePanel.vue", [(
        "  if (!s || s.ownReload == null || active == null || active !== s.ownReload) return;",
        "  if (!s || sessionOwnReload.value == null || active == null || active !== sessionOwnReload.value) return;"), (
        "  sessionProgramId.value = session.programId;\n  sessionOwnReload.value = null;\n",
        "  sessionProgramId.value = session.programId;\n"), (
        "  sessionProgramId.value = null;\n  sessionOwnReload.value = null;\n",
        "  sessionProgramId.value = null;\n")],
        [pw("e2e/program-identity.spec.ts", "a session opened after the own reload",
            "a new session never takes an old session's reply")]),
    # ---- P2b-F1 scene (the pre-update check 2026-11-24): hidden is drawn as an unload
    "the_hidden_preview_stays_drawn": (S + "ThreeViewer.vue", [(
        # (the function kept referenced: an unused one fails vue-tsc and the page is not built)
        "    else _clearShownPreview();\n", "    else { _refreshWantKey(); void _clearShownPreview; }\n")],
        [pw("e2e/program-identity.spec.ts", "a run started before its preview",
            "case (c): nothing of A2 drawn through C's run"),
         pw("e2e/program-identity.spec.ts", "a new program at idle", "A2's path no longer rendered under C")]),
    "the_clear_keeps_the_old_payload": (S + "ThreeViewer.vue", [(
        "  _applyGcodeNow(noPreview());\n", "  toolpath.release(); void noPreview;\n")],
        [pw("e2e/program-identity.spec.ts", "same path loaded again",
            "the same path reloaded: nothing of the old load drawn")]),
    "the_drawn_key_kept": (S + "ThreeViewer.vue", [(
        "  _applyGcodeNow(noPreview());\n  drawnKey.value = null;\n", "  _applyGcodeNow(noPreview());\n")],
        [pw("e2e/program-identity.spec.ts", "same path loaded again",
            "the same path reloaded: nothing of the old load drawn")]),
    "the_empty_apply_without_a_frame": (S + "viewer/toolpathController.ts", [(
        "      _peak = held0 + d;\n\n      deps.requestRender();\n      return true;\n",
        "      _peak = held0 + d;\n\n      return true;\n")],
        [vt("src/viewer/toolpathController.test.ts", "the unload's empty payload leaves nothing",
            "the frame is drawn again")]),
    # ---- P2b-F1 scene guards (Fable on R455): the way back, the whole canvas,
    # the part frame, the run's playhead (every function kept referenced: vue-tsc)
    "the_shown_again_not_drawn": (S + "ThreeViewer.vue", [
        ("// Apply gcode preview when it arrives\nwatch(\n  () => viewerGcode.value,\n  (g) => {\n",
         "// Apply gcode preview when it arrives\nlet _mutHidden: ViewerGcode | null = null;\n"
         "watch(\n  () => viewerGcode.value,\n  (g, old) => {\n"),
        ("    if (g) applyGcode(g);\n    else _clearShownPreview();\n",
         "    if (g) { if (g !== _mutHidden) applyGcode(g); }\n"
         "    else { _mutHidden = old ?? null; _clearShownPreview(); }\n")],
        [pw("e2e/program-identity.spec.ts", "blink of its identity",
            "shown again: drawn again, as before the blink")]),
    "the_clear_keeps_the_rapids": (S + "ThreeViewer.vue", [
        ("function applyGcode(g: ViewerGcode) {\n",
         "let _mutLastG: ViewerGcode | null = null;\nfunction applyGcode(g: ViewerGcode) {\n  _mutLastG = g;\n"),
        ("  _applyGcodeNow(noPreview());\n  drawnKey.value = null;\n",
         "  _applyGcodeNow(_mutLastG ? { ..._mutLastG, feedPos: undefined, feed: [], feed_lines: [], feedOutside: undefined,\n"
         "                               feedLod: undefined, feedBreaks: undefined, feedSrc: undefined, feedRoom: undefined }\n"
         "                 : noPreview());\n  drawnKey.value = null;\n")],
        [pw("e2e/program-identity.spec.ts", "pixel for pixel",
            "the hidden canvas is the unloaded canvas, pixel for pixel")]),
    "the_programmed_apply_supersedes_nothing": (S + "ThreeViewer.vue", [(
        "  ++_pfReqId;  // invalidate any in-flight part-frame reply\n", "")],
        [pw("e2e/bake-hold.viewer.spec.ts", "PROGRAMMED drawing",
            "the old part-frame reply changed nothing of the programmed drawing")]),
    "the_empty_payload_in_the_part_frame": (S + "ThreeViewer.vue", [(
        "  _wantMode = _partFrameEligible(g) ? \"part\" : \"programmed\";\n",
        "  _wantMode = _partFrameEligible(g) || g.file == null ? \"part\" : \"programmed\";\n")],
        [pw("e2e/bake-hold.viewer.spec.ts", "a part-frame reply released while hidden",
            "hidden: nothing of the part-frame path drawn")]),
    "the_playhead_kept_with_its_track": (S + "viewer/runDisplay.ts", [(
        "    watcher.reset();\n    runPlayhead.value = null;\n    runOffPath.value = false;\n",
        "    watcher.reset();\n    runOffPath.value = false;\n")],
        [vt("src/viewer/runDisplay.test.ts", "the run's playhead goes with its track",
            "the old playhead is gone with its track")]),
    # ---- F1-4: the simulation switch's note
    "the_note_unreactive": (S + "DevicesSettings.vue", [(
        "  void settingsVersion.value;\n", "")],
        [pw("e2e/devices.spec.ts", "the switch's note follows the gateway", "held: the note ends in the open dialog")]),
}


def failures(text):
    lines = text.splitlines()
    return [" | ".join(x.strip() for x in lines[i:i + 3] if x.strip())[:300]
            for i, ln in enumerate(lines) if "AssertionError" in ln or "FAIL" in ln or "Error:" in ln]


def run_guard(kind, args):
    if kind == "vitest":
        r = subprocess.run(["npx", "vitest", "run", args[0], "-t", args[1]], cwd=ROOT / "lcnc-webui",
                           capture_output=True, text=True, timeout=900)
        out = r.stdout + r.stderr
        return r.returncode != 0, out, args[2]
    if kind == "pytest":
        r = subprocess.run([str(ROOT / "lcnc-gateway/.venv/bin/python3"), "-m", "pytest", "-q", "-p", "no:cacheprovider",
                            "-o", "addopts=", args[0]], cwd=ROOT / "lcnc-gateway", capture_output=True, text=True, timeout=900)
        return r.returncode != 0, r.stdout + r.stderr, args[1]
    if kind == "pw":
        b = subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900)
        if b.returncode != 0:
            return False, b.stdout + b.stderr, args[2]
        r = subprocess.run(["npx", "playwright", "test", args[0], "-g", args[1], "--workers=1", "--reporter=list"],
                           cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=1800)
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
                # the page back to the tree's own build
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
