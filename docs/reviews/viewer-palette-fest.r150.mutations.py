"""Codex R149 findings VP-I108..VP-I110: each mutation must turn the named tests red.
ts = vue-tsc (app) must compile, then vitest on the named files. Restores from a byte copy.
`--dry` only checks that every anchor occurs exactly once."""
import os, shutil, subprocess, sys, time
R = os.environ.get("MUT_ROOT", "/home/cnc/lcnc-suite-p2")
W = R + "/lcnc-webui"
S = "/tmp/claude-1000/-home-cnc-lcnc-suite/b51e55ad-5023-4968-835e-f7e1362322ed/scratchpad"
SPEC = "e2e/collisions.viewer.spec.ts"
CV = "lcnc-webui/src/viewer/contactView.ts"
SC = "lcnc-webui/src/viewer/shownContacts.ts"
TV = "lcnc-webui/src/ThreeViewer.vue"
T_W = "src/viewer/checkWiring.test.ts"
T_SD = "src/viewer/startDepPayloads.test.ts"
M = [
 # VP-I110: a break is no checked move of its line
 ("i110_breaks_are_moves", CV, "    if (t.brk?.[i]) { broken = true; continue; }", "    if (t.brk?.[i] && t.count < 0) { broken = true; continue; }", "ts", T_SD),
 # VP-I108: the folded beginning's own coverage
 ("i108_running_own_dropped", TV, "coverage: Math.max(0, own - sf.shift), ownCoverage: own,", "coverage: Math.max(0, own - sf.shift),", "ts", T_W),
 ("i108_view_drops_own", SC, "                   ...(s.ownCoverage !== undefined ? { ownCoverage: s.ownCoverage } : {}),",
  "                   ...(s.ownCoverage !== undefined && s.id < -1e9 ? { ownCoverage: s.ownCoverage } : {}),", "ts", T_W),
 # VP-I109: a side result's coverage, and the join only after a whole side check
 ("i109_runside_cov_full", TV, "    const own = _sideCovered(rs.result) * rs.sliceEnd;", "    const own = rs.sliceEnd;", "ts", T_W),
 ("i109_entry_cov_full", TV, "covered: _sideCovered(e.result), whole: !e.result.truncated }", "covered: 1, whole: !e.result.truncated }", "ts", T_W),
 ("i109_runside_joins_any", TV, "sweptToEnd: !rs.result.truncated, track: rs.bound };", "sweptToEnd: true, track: rs.bound };", "ts", T_W),
 ("i109_entry_joins_any", TV, "covered: _sideCovered(e.result), whole: !e.result.truncated }", "covered: _sideCovered(e.result), whole: true }", "ts", T_W),
 ("i109_entry_cov_full_e2e", TV, "covered: _sideCovered(e.result), whole: !e.result.truncated }", "covered: 1, whole: !e.result.truncated }", "e2e", "stopped by its budget"),
 ("i109_view_joins_any", SC, "  if (bi >= 0 && si >= 0 && spec.side!.sweptToEnd && oneModel) {", "  if (bi >= 0 && si >= 0 && !!spec.side && oneModel) {", "ts", T_W),
]

dry = "--dry" in sys.argv
only = [a for a in sys.argv[1:] if not a.startswith("--")]
res = []
def add(t):
    res.append(t)
    print(*t, "%.0fs" % (time.time() - t0), flush=True)
built_mutant = False
for name, f, old, new, kind, sel in M:
    t0 = time.time()
    if only and name not in only:
        continue
    if os.environ.get("MUT_KIND") and kind != os.environ["MUT_KIND"]:
        continue
    path = os.path.join(R, f)
    src = open(path).read()
    olds, news = (old, new) if isinstance(old, list) else ([old], [new])
    bad = [src.count(o) for o in olds if src.count(o) != 1]
    if bad:
        add((name, "ANCHOR %s" % bad))
        continue
    if dry:
        add((name, "ok"))
        continue
    bak = os.path.join(S, "ef", os.path.basename(R) + "." + os.path.basename(f) + ".mutbakR150")
    shutil.copyfile(path, bak)
    try:
        mutated = src
        for o, nw in zip(olds, news): mutated = mutated.replace(o, nw)
        open(path, "w").write(mutated)
        c = subprocess.run(["npx", "vue-tsc", "--noEmit", "-p", "tsconfig.app.json"], cwd=W, capture_output=True, text=True, timeout=900)
        if c.returncode:
            add((name, "NOCOMPILE", (c.stdout + c.stderr).strip().splitlines()[:1]))
            continue
        if kind == "ts":
            p = subprocess.run(["npx", "vitest", "run", "--reporter=dot", *sel.split()], cwd=W, capture_output=True, text=True, timeout=900)
            out = p.stdout + p.stderr
            why = [ln.strip() for ln in out.splitlines() if "AssertionError" in ln or ln.strip().startswith("FAIL")][:2]
            tail = [ln for ln in out.splitlines() if "Tests " in ln][-1:]
        else:
            b = subprocess.run(["npm", "run", "build"], cwd=W, capture_output=True, text=True, timeout=900)
            built_mutant = True
            if b.returncode:
                add((name, "NOBUILD"))
                continue
            spec, pat = sel.split("::") if "::" in sel else (SPEC, sel)
            p = subprocess.run(["npx", "playwright", "test", "--trace", "off", "--reporter=line", "--no-deps", "-g", pat, spec],
                               cwd=W, capture_output=True, text=True, timeout=1500)
            out = p.stdout + p.stderr
            why = [ln.strip() for ln in out.splitlines() if "Error:" in ln or "Expected" in ln][:2]
            tail = [ln for ln in out.splitlines() if " passed" in ln or " failed" in ln][-1:]
        add((name, "RED" if p.returncode else "GREEN!", tail[0].strip() if tail else out[-200:], " | ".join(why)[:230]))
    finally:
        shutil.copyfile(bak, path)
if built_mutant:
    b = subprocess.run(["npm", "run", "build"], cwd=W, capture_output=True, text=True, timeout=900)
    add(("rebuild", "ok" if b.returncode == 0 else "FAILED"))
