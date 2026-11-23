"""P2b red proofs (plan v4, Codex R439–R442): each mutation breaks ONE rule;
its named guard must fail AT that rule. Run from the tree's root; every file
is restored byte-identical. Unit guards run light; a browser guard (pw)
rebuilds the page and runs its spec — under the heavy lock (the page is
rebuilt from the restored tree afterwards).

  python3 -I docs/reviews/p2b.mutations.py [name …]
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = "lcnc-webui/"
V = WEB + "src/viewer/"


def vt(file, name, at):
    return ("vitest", [file, name, at])


def py(node, at):
    return ("pytest", [node, at])


def pw(spec, grep, at):
    """A browser guard: the page rebuilt with the mutation, its spec run."""
    return ("pw", [spec, grep, at])


GW = "lcnc-gateway/"
CD = "test_controller_done.py::"
CL = "test_calc_lifetime.py::"
CG = "test_calc_lifetime_gateway.py::"
CW = "test_calc_lifetime_wiring.py::"


MUTS = {
    # ---- P2b-1: the collision model survives a tool change
    "the_model_base_not_the_runs": (V + "collision.ts", [(
        "(opts.baseTool ?? model.baseTool)", "(model.baseTool)")],
        [vt("src/viewer/collision.test.ts", "sweeps with the run's tool", "on the resident model")]),
    "the_tool_installed_once_not_per_pose": (V + "collision.ts", [(
        "    applyTool(toolSeg);\n    liftJoints(px, py, pz, pa, pb, pc, model, oSeg, tloSeg);",
        "    liftJoints(px, py, pz, pa, pb, pc, model, oSeg, tloSeg);")],
        [vt("src/viewer/collision.test.ts", "two runs interleaved", "interleaved, order")]),
    "a_tool_change_rebuilds": (V + "collisionWorker.ts", [(
        "    } else if (_resident && _resident.key === modelKey && (_resident.model.toolBodyIdx >= 0) === !!tool) {",
        "    } else if (_resident && _resident.key === modelKey + JSON.stringify(tool)) {")],
        [vt("src/viewer/collisionWorker.test.ts", "a tool change rebuilds no model", "another tool: the resident model")]),
    "the_structure_ignored": (V + "collisionWorker.ts", [(
        "    } else if (_resident && _resident.key === modelKey && (_resident.model.toolBodyIdx >= 0) === !!tool) {",
        "    } else if (_resident && _resident.key === modelKey) {")],
        [vt("src/viewer/collisionWorker.test.ts", "a tool change rebuilds no model", "needBodies")]),
    "the_key_ignores_a_reloaded_mesh": (V + "collisionModelKey.ts", [(
        "p.rotate ?? null, p.stock ? 1 : 0, p.mesh, p.proxy]", "p.rotate ?? null, p.stock ? 1 : 0, p.proxy]")],
        [vt("src/viewer/collisionModelKey.test.ts", "changes with every input", "a reloaded mesh")]),
    "the_key_ignores_the_machine": (V + "collisionModelKey.ts", [(
        "  return JSON.stringify([machine, parts.map(", "  return JSON.stringify([null, parts.map(")],
        [vt("src/viewer/collisionModelKey.test.ts", "changes with every input", "kinematics")]),
    "the_page_key_carries_the_tool": (WEB + "src/ThreeViewer.vue", [(
        "  return collisionModelKey(_pfMachine(init), parts, _unitScale);",
        "  return collisionModelKey(_pfMachine(init), parts, _unitScale) + JSON.stringify(_toolVisual(_basis.toolDiam, _basis.toolLen));")],
        [pw("e2e/collisions.viewer.spec.ts", "tool change re-checks on the resident model", "no bodies: the resident model")]),
    # ---- P2b-3 (Rest A, Codex R441): ONE completion decision
    "a_later_echo_ends_the_command": (GW + "gateway_util.py", [(
        "    if seen and done and echo is not None and serial is not None and echo >= serial:\n        return \"done\", (since, proof_now)",
        "    if seen and (done or echo > serial):\n        return \"done\", (since, proof_now)")],
        [py(CD + "TestCodexR441Table::test_a_later_echo_still_reading_is_no_end", "AssertionError")]),
    "one_poll_proves_the_own_error": (GW + "gateway_util.py", [(
        "        if polled_at - since >= proof_window_s:\n            return \"error\", (since, proof_now)",
        "        if polled_at - since >= 0:\n            return \"error\", (since, proof_now)")],
        [py(CD + "TestCodexR441Table::test_the_own_error_needs_two_polls_apart", "nor two within the window")]),
    "a_later_error_is_ours": (GW + "gateway_util.py", [(
        "    if seen and err_quiet and echo == serial:", "    if seen and idle and state == rcs_error and echo >= serial:")],
        [py(CD + "TestCodexR441Table::test_a_later_error_even_quiet_is_not_the_own", "AssertionError")]),
    # ---- P2b-3 rest (plan v4): the begin, the generation, the actions
    "the_begin_after_the_write": (GW + "gateway.py", [(
        "        if obs is not None:\n            _calc_gen.began(command.name)\n        if began is not None:\n            began()\n        try:\n            getattr(conn.cmd, command.name)(*args)",
        "        if began is not None:\n            began()\n        try:\n            getattr(conn.cmd, command.name)(*args)\n            if obs is not None:\n                _calc_gen.began(command.name)")],
        [py(CG + "TheBeginIsBeforeTheEffect::test_a_publication_during_a_blocked_write_is_discarded", "AssertionError")]),
    "the_publication_ignores_the_generation": (GW + "calc_lifetime.py", [(
        "            if now != snap:\n                return False, now, self._last_why", "            if False:\n                return False, now, self._last_why")],
        [py(CL + "TestGeneration::test_a_publication_after_a_begin_is_discarded", "AssertionError")]),
    "the_handler_return_ends_the_action": (GW + "calc_lifetime.py", [(
        "        if a.outcome is not None or a.held or any(o.outcome is None for o in a.observers):",
        "        if a.outcome is not None or a.held:")],
        [py(CG + "TheObserverOwnsTheAction::test_the_handler_return_is_no_end_and_the_proof_is", "AssertionError")]),
    "the_restart_ignores_the_actions": (GW + "gateway.py", [(
        "    q = _actions.quiet_s()\n    return q is not None and q >= ACTION_QUIET_S", "    return True")],
        [py(CG + "TheObserverOwnsTheAction::test_the_handler_return_is_no_end_and_the_proof_is", "AssertionError")]),
    "a_manual_switch_invalidates": (GW + "calc_lifetime.py", [(
        "        return \"mode\" if target in (m.get(\"MODE_MDI\", MODE_MDI), m.get(\"MODE_AUTO\", MODE_AUTO)) else None",
        "        return \"mode\"")],
        [py(CG + "TheModeSwitchByItsEffect::test_no_switch_and_manual_invalidate_nothing", "AssertionError")]),
    "a_failed_write_is_unwritten": (GW + "gateway.py", [(
        "                _actions.failed(obs)   # its effect is unknown", "                _actions.refused(obs)   # its effect is unknown")],
        [py(CG + "TheBeginIsBeforeTheEffect::test_a_write_that_raised_keeps_its_observer_unknown", "AssertionError")]),
    "abort_leaves_the_observers": (GW + "gateway.py", [(
        "        _settle_leases_ended_by((\"abort\",))   # written: the jogs stop with it (MT-I08)\n        _actions.end_all(\"aborted\")",
        "        _settle_leases_ended_by((\"abort\",))   # written: the jogs stop with it (MT-I08)\n        None")],
        [py(CG + "TheObserverOwnsTheAction::test_abort_after_the_return_is_aborted", "AssertionError")]),
    "a_relinked_command_is_done": (GW + "calc_lifetime.py", [(
        "            if how == \"relinked\":\n                how = \"link_lost\"", "            if how == \"relinked\":\n                how = \"done\"")],
        [py(CG + "TheObserverOwnsTheAction::test_a_lost_link_is_named", "AssertionError")]),
    "a_handler_error_drops_the_observer": (GW + "calc_lifetime.py", [(
        "            action.held = False\n            if action.handler is None:\n                action.handler = handler",
        "            action.held = False\n            if handler == \"error\":\n                action.observers.clear()\n            if action.handler is None:\n                action.handler = handler")],
        [py(CG + "TheObserverOwnsTheAction::test_a_handler_error_after_its_write_keeps_the_observer", "AssertionError")]),
    "the_mode_target_unchecked": (GW + "calc_lifetime.py", [(
        "                how = ((\"done\" if tm == o.mode_target else \"unknown\") if seen and tm is not None else None)",
        "                how = (\"done\" if seen else None)")],
        [py(CL + "TestActionOwnership::test_a_mode_switch_needs_its_target", "AssertionError")]),
    "the_tool_file_begins_after": (GW + "gateway.py", [(
        "    with _file_effect(\"tool_table_file\"):   # begun right before the file is replaced, ended at its end (P2b-3)\n        write_tool_table(tbl_path, tools)",
        "    write_tool_table(tbl_path, tools)\n    with _file_effect(\"tool_table_file\"):\n        pass")],
        [py(CG + "TheFileWritersBegin::test_the_tool_table_begins_before_its_file_is_replaced", "AssertionError")]),
    "a_command_unclassified": (GW + "command_policy.py", [(
        "    \"simulate_probe_trip\": \"none\",\n}", "}")],
        [py(CW + "TestEveryCommandHasAnEffect::test_the_two_lists_are_one", "AssertionError")]),
    "the_unload_restarts_the_old_program": (GW + "bulk_pipeline.py", [(
        "        if now[0] == gen_at[0]:\n            self.reparse_pending = True", "        if True:\n            self.reparse_pending = True")],
        [py(CG + "TheUnload::test_an_unload_during_a_parse_publishes_nothing_and_restarts_nothing", "AssertionError")]),
    "the_hold_only_for_the_toolsetter": (GW + "gateway.py", [(
        "    if drift != \"toolsetter\" and _ts_hold_reason(st) is not None:", "    if False:")],
        [py("test_toolsetter_basis.py::TestHoldAndAttempt::test_every_idle_edge_waits_for_the_one_confirmation", "AssertionError")]),
    "a_stopped_handler_is_done": (GW + "calc_lifetime.py", [(
        "    if handler not in (None, \"ok\"):\n        return \"partial\"", "    if handler not in (None, \"ok\", \"stopped\"):\n        return \"partial\"")],
        [py(CL + "TestActionOwnership::test_a_handler_that_stops_short_after_a_write_is_partial", "AssertionError")]),
    # ---- P2b-3 after the advisor's check: the outdated parse, the restart, the holds, the routine class
    "an_outdated_parse_runs_on": (GW + "calc_lifetime.py", [(
        "    return inflight_gen is not None and tuple(inflight_gen) != tuple(now)", "    return False")],
        [py(CL + "TestInflightOutdated::test_a_running_parse_of_an_older_generation", "AssertionError")]),
    "a_discarded_restart_under_the_run": (GW + "gateway.py", [(
        "    if not (st.interp_state == linuxcnc.INTERP_IDLE and not st.current_vel):\n        return \"not_idle\"",
        "    if False:\n        return \"not_idle\"")],
        [py(CG + "TheRestartWaits::test_a_discarded_parse_restarts_only_at_idle", "AssertionError")]),
    "a_superseded_hold_leaks": (GW + "gateway.py", [(
        "                        _release_action(_qa, \"superseded\")   # never run: only its hold ends",
        "                        None   # never run: only its hold ends")],
        [py(CW + "TestTheBeginIsAtEveryWriter::test_every_queue_hold_ends", "AssertionError")]),
    "a_dropped_hold_leaks": (GW + "gateway.py", [(
        "            _release_action(_da, \"dropped\")   # never run: only its hold ends",
        "            None   # never run: only its hold ends")],
        [py(CW + "TestTheBeginIsAtEveryWriter::test_every_queue_hold_ends", "AssertionError")]),
    "the_handler_end_keeps_the_hold": (GW + "gateway.py", [(
        "                    inflight.add_done_callback(lambda _t, _a=_wact: _release_action(_a, _handler_end(_t)))",
        "                    None")],
        [py(CW + "TestTheBeginIsAtEveryWriter::test_every_queue_hold_ends", "AssertionError")]),
    "a_routine_is_an_mdi": (GW + "calc_lifetime.py", [(
        "        return \"routine\" if _ROUTINE_LINE.search(text) else \"mdi\"", "        return \"mdi\"")],
        [py(CL + "TestInputWriteClass::test_by_effect", "AssertionError")]),
    # ---- P2b-3: the publication gate on its real path (refresh_gcode_preview)
    "the_gateway_never_wires_the_generation": (GW + "gateway.py", [(
        "_bulk.generation = _calc_gen   # the publication checks it (bulk_pipeline)", "None   # the publication checks it (bulk_pipeline)")],
        [py(CW + "TestTheBeginIsAtEveryWriter::test_the_publication_reads_the_gateways_generation", "AssertionError")]),
    "the_snapshot_at_the_publication": (GW + "bulk_pipeline.py", [(
        "        ok, now, why = self.generation.publish_if(gen_at, apply)",
        "        ok, now, why = self.generation.publish_if(self.generation.snapshot(), apply)")],
        [py("test_bulk_pipeline.py::TestGenerationAtThePublication::test_a_begin_while_the_worker_runs_discards_the_publication",
            "nothing published")]),
    "the_verify_path_ungated": (GW + "bulk_pipeline.py", [(
        "                    if not self._publish_in_generation(_gen_at, lambda: self._set_tool_basis(self.basis_of(worker_tlo)),",
        "                    if not self._publish_in_generation(None, lambda: self._set_tool_basis(self.basis_of(worker_tlo)),")],
        [py("test_bulk_pipeline.py::TestGenerationAtThePublication::test_the_verify_path_is_gated_too",
            "the verified basis is not taken")]),
    "a_parse_starts_while_unloading": (GW + "gateway.py", [(
        "    if _bulk.unloading:\n        return \"unloading\"", "    if False:\n        return \"unloading\"")],
        [py(CG + "TheRestartWaits::test_no_parse_of_an_unloaded_program_starts_before_the_unload_settles", "AssertionError")]),
    # ---- Codex R446: MT-I25 the file writers' end, MT-I27 the kept job end, MT-I28 the first load's restart
    "a_file_end_at_its_begin": (GW + "gateway.py", [(
        "    o = _actions.begin_file(_current_action.get(), why)\n    _calc_gen.began(why)\n    try:\n        yield",
        "    o = _actions.begin_file(_current_action.get(), why)\n    _calc_gen.began(why)\n    _actions.end_file(o, \"done\")\n    try:\n        yield")],
        [py(CG + "TheFileWritersOwnTheirEnd::test_a_slow_commit_is_never_quiet_and_its_end_starts_the_debounce", "AssertionError")]),
    "a_failed_file_write_is_done": (GW + "gateway.py", [(
        "    except BaseException:\n        _actions.end_file(o, \"unknown\")\n        raise",
        "    except BaseException:\n        _actions.end_file(o, \"done\")\n        raise")],
        [py(CG + "TheFileWritersOwnTheirEnd::test_a_failed_commit_ends_named_never_done", "AssertionError")]),
    "the_tool_import_unowned": (GW + "gateway.py", [(
        "    act = _actions.internal(\"tool_import\")", "    act = None")],
        [py(CG + "TheFileWritersOwnTheirEnd::test_the_http_tool_import_is_one_action_to_its_metadata", "AssertionError")]),
    "the_decision_forgets_its_jobs_end": (GW + "gateway.py", [(
        "    if d is not None and d.get(\"state\") == \"parse\" and d.get(\"job\") == job:\n        d.update(end)",
        "    if False:\n        d.update(end)")],
        [py(CG + "TheDriftDecision::test_the_decision_keeps_its_jobs_end_past_the_store", "AssertionError")]),
    "the_round_never_moves": (GW + "gateway.py", [(
        "    _dd_round += 1\n", "    _dd_round += 0\n")],
        [py(CG + "TheDriftDecision::test_a_new_round_of_the_same_generation_has_its_own_number", "a new round")]),
    "a_round_inherits_the_deadline": (V + "driftWait.ts", [(
        "  if (d.round !== undefined && w.round !== null) return d.round - w.round;", "  if (false) return 0;")],
        [vt("src/viewer/driftWait.test.ts", "a new round after", "AssertionError")]),
    "the_page_ignores_the_round": (V + "driftWait.ts", [(
        "  if (d.round !== undefined && w.round !== null) return d.round - w.round;", "  if (false) return 0;")],
        [pw("e2e/collisions.viewer.spec.ts", "a fresh pending round after none", "the wait belongs to the new round")]),
    "a_first_load_restart_never_waits": (GW + "gateway.py", [(
        "    if file_changed and _bulk.spawned_program_gen != _calc_gen.snapshot()[0]:\n        return None",
        "    if file_changed:\n        return None")],
        [py(CG + "TheFirstLoadsRestart::test_a_discarded_first_load_never_restarts_unpinned_under_the_run", "AssertionError")]),
    "the_read_back_judge_ignores_the_order": ("scripts/test_support/native_cases.py", [(
        "    early = [e for e in spawns if idx[id(e)] < t_rb]", "    early = []")],
        [py("../scripts/test_native_stage.py::test_the_read_back_half_needs_an_open_confirmation", "AssertionError")]),
    # ---- Codex R447: MT-I25 A/B the running file writer, MT-I28 A the restart by identity
    "an_abort_ends_file_work": (GW + "calc_lifetime.py", [(
        "                    if o.outcome is None and o.state != \"file\":", "                    if o.outcome is None:")],
        [py(CG + "TheRunningFileWriterHoldsToItsEnd::test_a_controller_abort_never_ends_a_running_file_writer", "AssertionError")]),
    "the_limit_releases_a_file_writer": (GW + "calc_lifetime.py", [(
        "                out.append((o, None, (o.err_since, o.err_proof)))\n                continue\n            if o.state == \"pending\":",
        "                out.append((o, \"unknown\" if t - o.t >= o.limit_s else None, (o.err_since, o.err_proof)))\n                continue\n            if o.state == \"pending\":")],
        [py(CG + "TheRunningFileWriterHoldsToItsEnd::test_the_observer_limit_never_releases_a_running_file_writer", "AssertionError")]),
    "the_rollback_outside_the_commit": (GW + "gateway.py", [(
        "                    if after_publish is not None:\n                        try:\n                            after_publish()\n                        except OSError as e:\n                            _safe_unlink(dest_path)\n                            raise HTTPException(status_code=500, detail=f\"Not renamed — {e.strerror or e}\")",
        "                    pass\n                if after_publish is not None:\n                    try:\n                        after_publish()\n                    except OSError as e:\n                        _safe_unlink(dest_path)\n                        raise HTTPException(status_code=500, detail=f\"Not renamed — {e.strerror or e}\")")],
        [py(CG + "TheRunningFileWriterHoldsToItsEnd::test_publish_rename_and_rollback_are_one_held_commit", "AssertionError")]),
    "a_restart_by_reason_text": (GW + "gateway.py", [(
        "    if file_changed and _bulk.spawned_program_gen != _calc_gen.snapshot()[0]:\n        return None",
        "    if file_changed and not str(_bulk.reparse_pending_reason or \"\").startswith(\"discarded:\"):\n        return None")],
        [py(CG + "TheRotaryCancelOfTheFirstLoad::test_a_rotary_cancel_does_not_hide_the_restart", "AssertionError")]),
    # ---- P2b-2 (plan v4 variant 1): the idle check waits for the drift decision
    "the_decision_wait_never_falls_back": (V + "driftWait.ts", [(
        "    if (waited >= fallbackMs) {", "    if (false) {")],
        [vt("src/viewer/driftWait.test.ts", "no decision within 3 s", "AssertionError")]),
    "a_named_parse_falls_back_too": (V + "driftWait.ts", [(
        "  if (d.published === undefined) return { verdict: { go: false, why: \"parse\", retryInMs: null }, wait: w };",
        "  if (d.published === undefined) return { verdict: { go: now - w.since < fallbackMs ? false : true, named: null, why: \"parse\", retryInMs: null } as never, wait: w };")],
        [vt("src/viewer/driftWait.test.ts", "a parse decided early", "a parse decided early")]),
    "published_is_adopted": (V + "driftWait.ts", [(
        "  return adopted(d.published)", "  return true")],
        [vt("src/viewer/driftWait.test.ts", "a parse decided early", "published, not adopted")]),
    "an_older_status_counts": (V + "driftWait.ts", [(
        "  if (w && cmpRound(d, w) < 0) {", "  if (false) {")],
        [vt("src/viewer/driftWait.test.ts", "a newer generation", "an older generation")]),
    "an_action_end_opens_no_decision": (GW + "gateway.py", [(
        "            _dd_pending(f\"action:{a.what}\")", "            pass")],
        [py(CG + "TheDriftDecision::test_an_action_end_opens_a_decision_of_its_generation", "AssertionError")]),
    "the_page_ignores_the_decision": (WEB + "src/ThreeViewer.vue", [(
        "    if (!_colDriftReady()) return;", "    void _colDriftReady;")],
        [pw("e2e/collisions.viewer.spec.ts", "a parse decided early holds the idle check", "the idle check still waits past the 3 s fallback")]),
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
