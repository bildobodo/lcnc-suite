"""E1 mutations: each must turn the named tests red. Restores from a byte copy."""
import os, shutil, subprocess, sys
G = "/home/cnc/lcnc-suite-stop/lcnc-gateway"
S = "/tmp/claude-1000/-home-cnc-lcnc-suite/b51e55ad-5023-4968-835e-f7e1362322ed/scratchpad"
M = [
 ("rdp_anchor", "gcode_parse_worker.py", "            r_anchors = sorted(set(r_anchors) | mode_boundary_indices(rapid_depp))", "            pass", "test_start_dep_worker.py::TestTheCanonBooksTheMask::test_codex_s_rdp_counterexample_keeps_both_corners"),
 ("dep_nan_off", "gateway_util.py", "    if point is None or not mask:\n        return point", "    if True:\n        return point", "test_start_dep_worker.py::TestLimits"),
 ("read_gate_off", "gcode_canon.py", "        if not (self.read_remaps or self.read_lines):\n            return\n        held", "        if True:\n            return\n        held", "test_start_dep_worker.py::TestPositionReads::test_reads_in_the_main_text"),
 ("walk_read_off", "gcode_canon.py", "                if self.read_lines and line in self.read_lines and line not in self._read_done:", "                if False:", "test_start_dep_worker.py::TestPositionReads::test_reads_in_the_main_text"),
 ("return_readd_off", "gcode_canon.py", "                elif st_a == \"dep\":\n                    known.discard(a)\n                    readd.add(a)", "                elif st_a == \"dep\":\n                    pass", "test_start_dep_worker.py::TestTheRoutine::test_the_return_takes_the_saved_state"),
 ("foreign_excuse_off", "gcode_canon.py", "                or (self.write_mode == \"foreign\" and inm is True)):", "                or False):", "test_tool_change_motion_worker.py::TestUnknownStartAfterAToolChange::test_a_call_into_another_file_spelled_any_way"),
 ("code_eq_off", "gateway_util.py", "            if (name not in codes or code is None or code != codes[name]", "            if (name not in codes or code is None", "test_start_dep_worker.py::TestSuitePythonBinding::test_an_entry_bound_to_another_body_is_not"),
 ("hook_union_off", "gateway_util.py", "                        hr = self.python_reads.get(h)\n                        if hr is None:\n                            return None", "                        hr = self.python_reads.get(h, frozenset())", "test_start_dep_worker.py::TestSuitePythonBinding::test_hooks_each_and_unions"),
 ("rotary_maybe_off", "gcode_parse_worker.py", "        _maybe = {0, 1, 2} | (set(canon.tool_change_axes) if canon.tool_change_moves else set())", "        _maybe = {0, 1, 2}", "test_start_dep_worker.py::TestPositionReads::test_a_bound_python_reader_of_the_rotaries"),
 ("leg3_off", "gcode_canon.py", "                if leg > 2:\n                    out |= before ", "                if leg > 99:\n                    out |= before ", "test_start_dep_worker.py::TestTheCanonUnits::test_a_third_callback_of_a_g28_is_never_the_stored_position"),
 ("first_g1_feed", "gcode_canon.py", "        elif self.first_move and self._program_line():\n            # The program's first move is a feed", "        elif False:\n            # The program's first move is a feed", "test_start_dep_worker.py::TestTimeBasis::test_a_first_g1_is_an_endpoint_with_its_feed"),
 ("feed_basis_always2", "gcode_canon.py", "        return (2, float(self.feedrate)) if mode == 0 and self.feedrate > 0 else (3, 0.0)", "        return (2, float(self.feedrate))", "test_start_dep_worker.py::TestTimeBasis::test_inverse_time_and_per_revolution_say_unknown"),
 ("m600_hook_off", "gateway_util.py", "        if re.search(r\"\\b(?:python|prolog|epilog)\\s*=\", str(raw), re.IGNORECASE):", "        if False:", "test_start_dep_worker.py::TestSuitePythonBinding::test_a_hook_on_the_suites_m600_makes_it_foreign"),
 ("named_read_off", "gateway_util.py", "            ax = _POS_READ_NAMES.get(n[j + 1:k])", "            ax = None", "test_start_dep_worker.py::TestPositionReads::test_reads_in_the_main_text"),
 ("marked_bypass", "gateway_util.py", "        if hashlib.sha256(raw).hexdigest() in self.marked_files:", "        if True:", "test_start_dep_worker.py::TestTheRoutine::test_a_routine_that_differs_reads_for_the_text"),
 ("probe_unknown_keeps_dep", "gcode_canon.py", "            self.dep = frozenset()          # unknown to the end outranks start-dependent", "            pass", "test_start_dep_worker.py::TestPositionReads::test_reads_in_the_main_text"),
 ("word_not_value", "gcode_canon.py", "            words = {i for i, f in enumerate((b.x_flag, b.y_flag, b.z_flag)) if f}", "            words = {i for i, f in enumerate((b.x_flag, b.y_flag, b.z_flag)) if f and abs(self._program(self.lo)[i]) > 1e-9}", "test_start_dep_worker.py::TestTheCanonBooksTheMask::test_the_word_not_the_value"),
 ("verify_sb_off", "gateway_util.py", "    special = VERIFY_BASIS_KEYS | set(VERIFY_POINT_KEYS) | set(VERIFY_BOX_KEYS) | {\"start_believed\"}", "    special = VERIFY_BASIS_KEYS | set(VERIFY_POINT_KEYS) | set(VERIFY_BOX_KEYS)", "test_start_tlo_worker.py::TestVerifyNative"),
]
only = sys.argv[1:]
res = []
env = dict(os.environ, LCNC_LOG_DIR=S + "/testlogs")
env.pop("PYTHONPATH", None)
for name, f, old, new, sel in M:
    if only and name not in only:
        continue
    path = os.path.join(G, f)
    bak = os.path.join(S, "ef", f + ".mutbak")
    shutil.copyfile(path, bak)
    try:
        src = open(path).read()
        if src.count(old) != 1:
            res.append((name, "ANCHOR %d" % src.count(old)))
            continue
        open(path, "w").write(src.replace(old, new))
        c = subprocess.run([sys.executable, "-c", f"import ast;ast.parse(open('{path}').read())"])
        if c.returncode:
            res.append((name, "NOCOMPILE"))
            continue
        p = subprocess.run([G + "/.venv/bin/python", "-m", "pytest", "-o", "addopts=", "-q", "-p", "no:cacheprovider", "-x", sel],
                           cwd=G, capture_output=True, text=True, env=env, timeout=900)
        tail = [ln for ln in p.stdout.splitlines() if "passed" in ln or "failed" in ln][-1:]
        why = [ln.strip() for ln in p.stdout.splitlines() if ln.startswith("E ")][:2]
        res.append((name, "RED" if p.returncode else "GREEN!", tail[0] if tail else p.stdout[-200:], " | ".join(why)[:230]))
    finally:
        shutil.copyfile(bak, path)
for r in res:
    print(*r)
