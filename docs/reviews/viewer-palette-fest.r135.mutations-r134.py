"""R134 mutations (VP-I84/I86 at K = 0, VP-I90): each must turn the named tests red.
Python files run pytest, TypeScript files run vitest. Restores from a byte copy."""
import os, shutil, subprocess, sys
R = "/home/cnc/lcnc-suite-stop"
G = R + "/lcnc-gateway"
W = R + "/lcnc-webui"
S = "/tmp/claude-1000/-home-cnc-lcnc-suite/b51e55ad-5023-4968-835e-f7e1362322ed/scratchpad"
SD = "src/viewer/startDepPayloads.test.ts"
M = [
 # --- VP-I84/I86 at K = 0 ---
 ("r134_begin_order", "lcnc-webui/src/viewer/startDep.ts",
  '  return unbound ? "unbound" : K <= 0 ? "none" : bound ? "bound" : joints ? "failed" : "nojoints";',
  '  return K <= 0 ? "none" : unbound ? "unbound" : bound ? "bound" : joints ? "failed" : "nojoints";',
  "ts", SD),
 ("r134_sd_k0", "lcnc-webui/src/viewer/collision.ts",
  "  if (depK > 0 || (unbound && track.count > 0)) {",
  "  if (depK > 0 || (unbound && track.count > 0 && false)) {",
  "ts", SD),
 ("r134_whole_k0", "lcnc-webui/src/viewer/collision.ts",
  "whole: depK > 0 ? depK >= track.count : track.count <= 1,",
  "whole: depK >= track.count,",
  "ts", SD),
 ("r134_idle_unbound", "lcnc-webui/src/ScrubBar.vue",
  "  if (sd?.unbound) {\n    return { state: \"done\", frac: 1, verdict: `${n ? found : \"Clear\"} · start not checked`",
  "  if (sd?.unbound && false) {\n    return { state: \"done\", frac: 1, verdict: `${n ? found : \"Clear\"} · start not checked`",
  "ts", SD),
 ("r134_idle_whole_words", "lcnc-webui/src/ScrubBar.vue",
  "    return { state: \"done\", frac: 1, verdict: sd.unbound ? \"Not checked\" : \"Depends on the machine's position\",",
  "    return { state: \"done\", frac: 1, verdict: \"Depends on the machine's position\",",
  "ts", SD),
 ("r134_run_whole_words", "lcnc-webui/src/ScrubBar.vue",
  "        verdict: sd.whole && !n ? (sd.unbound ? \"Not checked\" : \"Depends on the machine's position\")",
  "        verdict: sd.whole && !n ? (\"Depends on the machine's position\")",
  "ts", SD),
 # --- VP-I90 ---
 ("r134_view_fallback", "lcnc-webui/src/viewer/startDep.ts",
  '  return side?.state === "merged" ? "checked" : side?.state === "running" ? "checking" : "failed";',
  '  return side?.state === "merged" ? "checked" : "checking";',
  "ts", SD),
 ("r134_running", "lcnc-webui/src/ThreeViewer.vue",
  "    if (run) collisionRunSideState.value = { gen: run.gen, side: { state: \"running\" } };\n",
  "",
  "ts", SD),
 ("r134_err", "lcnc-webui/src/ThreeViewer.vue",
  "    if (side.run) _colRunSideFailed(side.run.gen, \"the check failed\");\n",
  "",
  "ts", SD),
 ("r134_bodies", "lcnc-webui/src/ThreeViewer.vue",
  "      if (side.run) _colRunSideFailed(side.run.gen, \"the machine model did not reach the check\");\n",
  "",
  "ts", SD),
 ("r134_cancelled", "lcnc-webui/src/ThreeViewer.vue",
  "    if (side.run) _colRunSideFailed(side.run.gen, \"it was cancelled\");\n",
  "",
  "ts", SD),
 ("r134_drop", "lcnc-webui/src/ThreeViewer.vue",
  "  if (_colSide.run) _colRunSideFailed(_colSide.run.gen, why);\n",
  "  void why;\n",
  "ts", SD),
 ("r134_nobuild", "lcnc-webui/src/ThreeViewer.vue",
  "    if (run) _colRunSideFailed(run.gen, \"the check could not be built\");\n",
  "",
  "ts", SD),
 ("r134_postthrow", "lcnc-webui/src/ThreeViewer.vue",
  "    if (run) _colRunSideFailed(run.gen, \"the check could not be sent\");\n",
  "",
  "ts", SD),
 ("r134_bindfail", "lcnc-webui/src/ThreeViewer.vue",
  "  const begin = runBeginOf(K, !!bound, !!track.startUnbound?.length, !!basis.startJoints);",
  "  const begin = runBeginOf(K, !!bound, !!track.startUnbound?.length);",
  "ts", SD),
 ("r134_sentence", "lcnc-webui/src/viewer/startDep.ts",
  "    : run.begin === \"failed\" ? `not checked: the check from the run's start position did not run to its end${run.beginWhy ? ` (${run.beginWhy})` : \"\"}`\n",
  "",
  "ts", SD),
 ("r134_why", "lcnc-webui/src/ThreeViewer.vue",
  "  return { begin, beginWhy: r.begin === \"bound\" ? (side?.state === \"failed\" ? side.why : null) : r.beginWhy };",
  "  return { begin, beginWhy: r.beginWhy };",
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
    bak = os.path.join(S, "ef", os.path.basename(f) + ".mutbak4")
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
