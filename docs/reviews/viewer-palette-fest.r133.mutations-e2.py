"""E2/E3 and R132-point-8 mutations: each must turn the named tests red.
Python files run pytest, TypeScript files run vitest. Restores from a byte copy."""
import os, shutil, subprocess, sys
R = "/home/cnc/lcnc-suite-stop"
G = R + "/lcnc-gateway"
W = R + "/lcnc-webui"
S = "/tmp/claude-1000/-home-cnc-lcnc-suite/b51e55ad-5023-4968-835e-f7e1362322ed/scratchpad"
SD = "src/viewer/startDepPayloads.test.ts"
M = [
 # --- R132 point 8 (worker) ---
 ("p8_flag_off", "lcnc-gateway/gcode_parse_worker.py",
  "                 and (canon.write_lines is None or canon.write_mode != \"ordered\") else {}),",
  "                 and False else {}),",
  "py", "test_start_dep_worker.py::TestCodexR132::test_writes_in_a_beginning_out_of_order_are_named"),
 ("p8_no_beginning", "lcnc-gateway/gcode_parse_worker.py",
  "                 if any(a for _b, a in canon.dep_seg.values())\n",
  "                 if True\n",
  "py", "test_start_dep_worker.py::TestCodexR132::test_writes_in_a_beginning_out_of_order_are_named"),
 # --- E3 (gateway) ---
 ("e3_after_await", "lcnc-gateway/gateway.py",
  "    start_joints, joints_why = _start_joints_now(STAT)\n    try:\n        file = _status_runtime.program.loaded\n        source = await asyncio.to_thread(program_source, file) if file else None\n",
  "    try:\n        file = _status_runtime.program.loaded\n        source = await asyncio.to_thread(program_source, file) if file else None\n        start_joints, joints_why = _start_joints_now(STAT)\n",
  "py", "test_command_dispatch.py::TestHandlerExecution::test_the_start_joints_are_this_poll_s"),
 ("e3_inpos_off", "lcnc-gateway/gateway.py",
  "        if not getattr(stat, \"inpos\", False):\n            return None, \"not in position\"\n",
  "",
  "py", "test_command_dispatch.py::TestHandlerExecution::test_the_start_joints_are_this_poll_s"),
 ("e3_count_off", "lcnc-gateway/gateway.py",
  "        if n <= 0 or len(vals) != n or not all(math.isfinite(v) for v in vals):",
  "        if not vals:",
  "py", "test_command_dispatch.py::TestHandlerExecution::test_the_start_joints_are_this_poll_s"),
 # --- E3 (client: the run's start joints reach the check basis) ---
 ("e3_client_drop", "lcnc-webui/src/runBasis.ts",
  "    joints: Array.isArray(s.joints) && s.joints.length ? vec(s.joints) : null, jointsWhy: str(s.joints_why),",
  "    joints: null, jointsWhy: str(s.joints_why),",
  "ts", "src/viewer/checkBasis.test.ts"),
 # --- E2 (client) ---
 ("e2_base_breaks_off", "lcnc-webui/src/viewer/scrubTrack.ts",
  "    for (let i = 1; i <= last; i++) brk[i] = 1;\n",
  "",
  "ts", SD),
 ("e2_delta_sign", "lcnc-webui/src/viewer/startDep.ts",
  "  const delta = [start[0]! - sb[0], start[1]! - sb[1], start[2]! - sb[2]];",
  "  const delta = [sb[0] - start[0]!, sb[1] - start[1]!, sb[2] - start[2]!];",
  "ts", SD),
 ("e2_old_payload_shift", "lcnc-webui/src/viewer/startDep.ts",
  "  if (!sb || !dep || !base.depBrk || !base.depDur) return null;",
  "  if (!dep || !base.depBrk || !base.depDur) return null;\n  if (!sb) return base;",
  "ts", SD),
 ("e2_times_kept", "lcnc-webui/src/viewer/startDep.ts",
  "    else if (b === 0) dur = base.depDur[i]!;",
  "    else if (b >= 0) dur = base.depDur[i]!;",
  "ts", SD),
 ("e2_limit_invented", "lcnc-webui/src/viewer/startDep.ts",
  "      if (!(vk != null && vk > 0)) return [0, 2];",
  "      if (!(vk != null && vk > 0)) continue;",
  "ts", SD),
 ("e2_baseline_assumed", "lcnc-webui/src/viewer/collision.ts",
  "  const p0 = Math.max(0, Math.min(track.depEnd ?? 0, n - 1));",
  "  const p0 = 0;",
  "ts", SD),
 ("e2_start_dependent_off", "lcnc-webui/src/viewer/collision.ts",
  "    startDependent = { fromLine: from, toLine: to, whole: depK >= track.count };",
  "    startDependent = undefined;",
  "ts", SD + " src/viewer/simRows.test.ts"),
 ("e2_run_merge_axis", "lcnc-webui/src/viewer/sweepMerge.ts",
  "  const at = (c: number) => Math.max(0, c - shift);",
  "  const at = (c: number) => c;",
  "ts", SD),
 ("e2_entry_move_flag", "lcnc-webui/src/viewer/sweepMerge.ts",
  "    ...(entryMoveEnd == null || h.cum <= entryMoveEnd + 1e-9 ? { entryMove: true as const } : {}) }));",
  "    ...(entryMoveEnd == null || entryMoveEnd >= 0 ? { entryMove: true as const } : {}) }));",
  "ts", SD + " src/viewer/simRows.test.ts src/viewer/collision.test.ts"),
 ("e2_writes_note_off", "lcnc-webui/src/viewer/collision.ts",
  "    if (startDependent) startDependent.untracked = true;\n    noteParts.push(\"in the program's start-dependent beginning",
  "    if (startDependent) startDependent.untracked = true;\n    if (false) noteParts.push(\"in the program's start-dependent beginning",
  "ts", SD + " src/viewer/simRows.test.ts src/viewer/collision.test.ts"),
 ("e2_writes_flag_off", "lcnc-webui/src/viewer/collision.ts",
  "    if (startDependent) startDependent.untracked = true;\n    noteParts.push(",
  "    noteParts.push(",
  "ts", SD),
]
only = sys.argv[1:]
res = []
env = dict(os.environ, LCNC_LOG_DIR=S + "/testlogs")
env.pop("PYTHONPATH", None)
for name, f, old, new, kind, sel in M:
    if only and name not in only:
        continue
    path = os.path.join(R, f)
    bak = os.path.join(S, "ef", os.path.basename(f) + ".mutbak2")
    shutil.copyfile(path, bak)
    try:
        src = open(path).read()
        if src.count(old) != 1:
            res.append((name, "ANCHOR %d" % src.count(old)))
            continue
        open(path, "w").write(src.replace(old, new))
        if kind == "py":
            c = subprocess.run([sys.executable, "-c", f"import ast;ast.parse(open('{path}').read())"])
            if c.returncode:
                res.append((name, "NOCOMPILE"))
                continue
            p = subprocess.run([G + "/.venv/bin/python", "-m", "pytest", "-o", "addopts=", "-q", "-p", "no:cacheprovider", "-x", sel],
                               cwd=G, capture_output=True, text=True, env=env, timeout=900)
            out = p.stdout
            why = [ln.strip() for ln in out.splitlines() if ln.startswith("E ")][:2]
        else:
            c = subprocess.run(["npx", "vue-tsc", "--noEmit", "-p", "tsconfig.app.json"], cwd=W, capture_output=True, text=True, timeout=900)
            if c.returncode:
                res.append((name, "NOCOMPILE", (c.stdout + c.stderr).strip().splitlines()[:1]))
                continue
            p = subprocess.run(["npx", "vitest", "run", "--reporter=dot", *sel.split()], cwd=W, capture_output=True, text=True,
                               timeout=900)
            out = p.stdout + p.stderr
            why = [ln.strip() for ln in out.splitlines() if "AssertionError" in ln or ln.strip().startswith("FAIL")][:2]
        tail = [ln for ln in out.splitlines() if "passed" in ln or "failed" in ln][-1:]
        res.append((name, "RED" if p.returncode else "GREEN!", tail[0].strip() if tail else out[-200:], " | ".join(why)[:230]))
    finally:
        shutil.copyfile(bak, path)
for r in res:
    print(*r)
