"""R133 mutations (VP-I83..VP-I89): each must turn the named tests red.
Python files run pytest, TypeScript files run vitest. Restores from a byte copy."""
import os, shutil, subprocess, sys
R = "/home/cnc/lcnc-suite-stop"
G = R + "/lcnc-gateway"
W = R + "/lcnc-webui"
S = "/tmp/claude-1000/-home-cnc-lcnc-suite/b51e55ad-5023-4968-835e-f7e1362322ed/scratchpad"
SD = "src/viewer/startDepPayloads.test.ts"
M = [
 # --- VP-I84 (worker) ---
 ("i84_unbound_off", "lcnc-gateway/gcode_canon.py",
  "            self.start_unbound = tuple(a for a in (0, 1, 2) if a in self.stale)",
  "            self.start_unbound = ()",
  "py", "test_start_dep_worker.py::TestCodexR133::test_a_first_point_with_an_unknown_axis_is_unbound"),
 ("i84_wire_off", "lcnc-gateway/gcode_parse_worker.py",
  "              **({\"start_unbound\": list(canon.start_unbound)} if canon.start_unbound else {}),",
  "              **({}),",
  "py", "test_start_dep_worker.py::TestCodexR133::test_a_first_point_with_an_unknown_axis_is_unbound"),
 # --- VP-I88 (worker) ---
 ("i88_own_off", "lcnc-gateway/gcode_parse_worker.py",
  "_remap_env.pos_writes(_rtext, own=canon.write_lines is None or canon.write_mode != \"ordered\"))",
  "_remap_env.pos_writes(_rtext, own=False))",
  "py", "test_start_dep_worker.py::TestCodexR133::test_a_stored_position_is_named_by_existence"),
 ("i88_closure_off", "lcnc-gateway/gateway_util.py",
  "    def _pos_write_closure(self, keys, names):\n        seen_k, seen_n = set(), set()",
  "    def _pos_write_closure(self, keys, names):\n        return False\n        seen_k, seen_n = set(), set()",
  "py", "test_start_dep_worker.py::TestPosWrites"),
 ("i88_hook_unbound", "lcnc-gateway/gateway_util.py",
  "                    if not r[\"hooks\"] or any(self.python_reads.get(h) is None for h in r[\"hooks\"]):",
  "                    if not r[\"hooks\"]:",
  "py", "test_start_dep_worker.py::TestPosWrites::test_a_remap_body_and_a_hook"),
 ("i88_hook_bound", "lcnc-gateway/gateway_util.py",
  "                    if not r[\"hooks\"] or any(self.python_reads.get(h) is None for h in r[\"hooks\"]):",
  "                    if r[\"hooks\"] or not r[\"hooks\"]:",
  "py", "test_start_dep_worker.py::TestPosWrites::test_a_remap_body_and_a_hook"),
 ("i88_marked_off", "lcnc-gateway/gateway_util.py",
  "            return False\n        return _text_pos_writes(raw.decode(",
  "            pass\n        return _text_pos_writes(raw.decode(",
  "py", "test_start_dep_worker.py::TestPosWrites::test_the_marked_routine_stores_nothing_here"),
 ("i88_explicit", "lcnc-gateway/gateway_util.py",
  "    return any(t != \"explicit\" for t in wl.values())",
  "    return bool(wl)",
  "py", "test_start_dep_worker.py::TestPosWrites::test_own_lines"),
 # --- VP-I83 (client) ---
 ("i83_start_basis", "lcnc-webui/src/viewer/scrubTrack.ts",
  "  const startTlo = tloForIndex(null, base.tloEvents, wcs.tool);",
  "  const startTlo = entryTlo;",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 # --- VP-I84 (client) ---
 ("i84_entry_guard", "lcnc-webui/src/viewer/scrubTrack.ts",
  "  if (base.startUnbound?.length) return null;\n",
  "",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 ("i84_name", "lcnc-webui/src/viewer/collision.ts",
  "                       ...(unbound ? { unbound: true } : {}) };",
  "                       };",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 ("i84_decode", "lcnc-webui/src/previewDecode.ts",
  "  const startUnbound = Array.isArray(su) && su.length ? su.map((v: unknown) => Number(v)) : undefined;",
  "  const startUnbound = Array.isArray(su) && su.length > 99 ? su.map((v: unknown) => Number(v)) : undefined;",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 # --- VP-I85 ---
 ("i85_basis", "lcnc-webui/src/viewer/scrubTrack.ts",
  "           ...(depBasis ? { depBasis } : {}), ...(depF ? { depF } : {}),",
  "           ...(depEnd > 0 && depBasis ? { depBasis } : {}), ...(depEnd > 0 && depF ? { depF } : {}),",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 # --- VP-I86 ---
 ("i86_run_branch", "lcnc-webui/src/ScrubBar.vue",
  "    if (r && sd && !r.truncated && !r.range) {",
  "    if (r && sd && !r.truncated && !r.range && sd.fromLine < 0) {",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 ("i86_view", "lcnc-webui/src/viewer/startDep.ts",
  "  return side?.state === \"merged\" ? \"checked\" : side?.state === \"running\" ? \"checking\" : \"failed\";",
  "  return side?.state === \"merged\" || true ? \"checked\" : side?.state === \"running\" ? \"checking\" : \"failed\";",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 ("i86_sentence", "lcnc-webui/src/viewer/startDep.ts",
  "    : run.begin === \"nojoints\" ? `not checked: the run's start position was not read",
  "    : run.begin === \"unbound\" ? `not checked: the run's start position was not read",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 # --- VP-I87 ---
 ("i87_range", "lcnc-webui/src/viewer/sweepMerge.ts",
  "    ...(base.range ? { range: base.range } : {}),\n",
  "",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 ("i87_boundary", "lcnc-webui/src/viewer/sweepMerge.ts",
  "    ...(base.boundaryContacts ? { boundaryContacts: base.boundaryContacts } : {}),\n",
  "",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 # --- VP-I88 (client) ---
 ("i88_client_mask", "lcnc-webui/src/viewer/collision.ts",
  "  if (opts.startWritesUntracked) {",
  "  if (opts.startWritesUntracked && startDependent) {",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 ("i88_slice", "lcnc-webui/src/viewer/scrubTrack.ts",
  "  if (t.dep) out.dep = u8(t.dep);\n",
  "",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 # --- VP-I89 ---
 ("i89_entry_first", "lcnc-webui/src/viewer/scrubTrack.ts",
  "  const depTime = timeFlag ? earlierTime(",
  "  const depTime = timeFlag && !t.depTime ? earlierTime(",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 ("i89_unknown_merge", "lcnc-webui/src/viewer/startDep.ts",
  "  const unknownLine = a.unknownLine ?? b.unknownLine;",
  "  const unknownLine = a.unknownLine;",
  "ts", "src/viewer/startDepPayloads.test.ts"),
 ("i89_help", "lcnc-webui/src/ScrubBar.vue",
  "  return dt ? `${text} ${depTimeSentence(dt)}` : text;",
  "  return dt && !dt ? `${text} ${depTimeSentence(dt)}` : text;",
  "ts", "src/viewer/startDepPayloads.test.ts"),
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
