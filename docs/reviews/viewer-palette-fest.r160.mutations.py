"""R159 findings (VP-I119, VP-I115 rests B/C) and the publication's own task: each mutation must
turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
e2e = build, then Playwright -g. Restores from a byte copy. `--dry` checks the anchors only."""
import os, shutil, subprocess, sys, time
R = "/home/cnc/lcnc-suite-mut"
W = R + "/lcnc-webui"
S = os.path.expanduser("~/claude-work/form1/bak")
CP = "lcnc-webui/src/viewer/contactPublisher.ts"
CV = "lcnc-webui/src/viewer/contactView.ts"
CS = "lcnc-webui/src/viewer/contactStore.ts"
SW = "lcnc-webui/src/viewer/simWindow.ts"
ST = "lcnc-webui/src/viewer/steps.ts"
SH = "lcnc-webui/src/stickyHead.ts"
SF = "lcnc-webui/src/scrollFade.ts"
TV = "lcnc-webui/src/ThreeViewer.vue"
T_P = "src/viewer/contactPublisher.test.ts"
T_W = "src/viewer/checkWiring.test.ts"
T_CV = "src/viewer/contactView.test.ts"
T_CS = "src/viewer/contactStore.test.ts"
T_SW = "src/viewer/simWindow.test.ts"
T_ST = "src/viewer/steps.test.ts"
T_U = "src/viewer/contactUnion.test.ts"
T_M = "src/viewer/contactMeter.test.ts"
T_IX = "src/viewer/contactViewIndexed.test.ts"
T_VU = "src/viewer/contactViewUnion.test.ts"
CP_T = "src/viewer/contactPublisher.test.ts"
CU = "lcnc-webui/src/viewer/contactUnion.ts"
M = [
 # VP-I119: the tint by each interval's own coverage
 ("t_tint_start_coverage", CV, "  // one pair (a piece is one group's): once lit, nothing more to ask\n  const pre = preimage(", "  if (pos > t.cov) return;\n  // one pair (a piece is one group's): once lit, nothing more to ask\n  const pre = preimage(", "ts", T_IX),
 # rest C: the lists grow by blocks, an array made a block a step
 ("g_done_at_once", ST, "      out.set(m === blk.length ? blk : blk.subarray(0, m), b * GROW_BLOCK);\n      if ((c.n += m) >= STEP_OPS) { c.n = 0; yield; }", "      out.set(m === blk.length ? blk : blk.subarray(0, m), b * GROW_BLOCK);\n      if ((c.n += m) >= STEP_OPS) { c.n = 0; }", "ts", T_M),
 # rest B: a key's target by its reference; the earlier event's piece from the indexes; the steps at ties
 ("k_ref_scan", CV, "  return lo < v.n && v.tgt.refs[lo] === ref ? lo : -1;", "  for (let i = 0; i < v.n; i++) if (v.tgt.refs[i] === ref) return i;\n  return -1 + 0 * lo;", "ts", T_IX),
 ("k_heir_piece_by_piece", CU, "  if (!sides.every(x => !x || x.comp)) {\n    for (let p = pieceFrom(", "  if (!sides.every(x => !x || x.comp) || w === w) {\n    for (let p = pieceFrom(", "ts", T_IX),
 ("k_prev_free_scan", CV, "    if (pb !== b) { if (pb === NO_BLOCK) return start - 1;", "    if (pb !== b && k < 0) { if (pb === NO_BLOCK) return start - 1;", "ts", T_IX),
 ("k_after_ties_scan", CV, "    if (sMax && !(sMax[b]! > s)) { i = (b + 1) * BLOCK - 1; continue; }", "    if (sMax && !(sMax[b]! > s) && i < 0) { i = (b + 1) * BLOCK - 1; continue; }", "ts", T_IX),
 ("k_before_ties_scan", CV, "    if (sMin && !(sMin[b]! < s)) { i = b * BLOCK; continue; }", "    if (sMin && !(sMin[b]! < s) && i < 0) { i = b * BLOCK; continue; }", "ts", T_IX),
 ("k_free_end_ignored", CU, "      if (f.b > y || (f.b === y && f.bo && incl)) { y = f.b; incl = f.bo; }", "      if (f.b > y && f.b < y) { y = f.b; incl = f.bo; }", "ts", T_U),
 # the publication begins its own task
 ("p_publish_in_slice", CP, "      this.sliceEnd = true;\n      yield;", "      this.sliceEnd = false;\n      yield;", "ts", CP_T),
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
    if only and name not in only: continue
    if os.environ.get("MUT_KIND") and kind != os.environ["MUT_KIND"]: continue
    path = os.path.join(R, f)
    src = open(path).read()
    olds, news = (old, new) if isinstance(old, list) else ([old], [new])
    bad = [src.count(o) for o in olds if src.count(o) != 1]
    if bad: add((name, "ANCHOR %s" % bad)); continue
    if dry: add((name, "ok")); continue
    bak = os.path.join(S, os.path.basename(f) + ".mutbak160")
    shutil.copyfile(path, bak)
    try:
        mutated = src
        for o, nw in zip(olds, news): mutated = mutated.replace(o, nw)
        open(path, "w").write(mutated)
        c = subprocess.run(["npx", "vue-tsc", "--noEmit", "-p", "tsconfig.app.json"], cwd=W, capture_output=True, text=True, timeout=900)
        if c.returncode: add((name, "NOCOMPILE", (c.stdout + c.stderr).strip().splitlines()[:1])); continue
        if kind == "ts":
            try:
                p = subprocess.run(["npx", "vitest", "run", "--reporter=dot", *sel.split()], cwd=W, capture_output=True, text=True, timeout=300)
            except subprocess.TimeoutExpired:
                add((name, "RED (timeout: the run never ended)")); continue
            out = p.stdout + p.stderr
            why = [ln.strip() for ln in out.splitlines() if "AssertionError" in ln or ln.strip().startswith("FAIL")][:2]
            tail = [ln for ln in out.splitlines() if "Tests " in ln][-1:]
        else:
            b = subprocess.run(["npm", "run", "build"], cwd=W, capture_output=True, text=True, timeout=900)
            built_mutant = True
            if b.returncode: add((name, "NOBUILD")); continue
            spec, pat = sel.split("::")
            p = subprocess.run(["npx", "playwright", "test", "--project", "serial-viewer", "--trace", "off", "--reporter=line", "--no-deps", "-g", pat, spec],
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
