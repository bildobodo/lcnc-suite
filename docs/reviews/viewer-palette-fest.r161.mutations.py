"""R160 findings (VP-I115 rests D/E): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
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
 # rest D: the free index holds the samples whose stretch the union keeps
 ("d_index_any_sample", CV, "      yield* freeBlocks(g, k => (g.comp[k]! & FREE_HOLDS) !== 0, c);\n      g.freeHeld = true;",
  "      g.freeHeld = g.freeHeld && false;", "ts", T_IX + "::refuted"),
 # the searches' windows: the kept stretches' reach, never a raw radius
 ("d_reach_raw", CV, "      g.freeHeld = true; g.back = reach[sd]!.back; g.front = reach[sd]!.front;", "      g.freeHeld = true; g.back = Math.max(g.back, reach[sd]!.back); g.front = Math.max(g.front, reach[sd]!.front);", "ts", T_IX + "::wideRadius"),
 ("d_holds_not_written", CV, "      cp[i] = cp[i]! | FREE_HOLDS;\n      if (front > r.front)",
  "      cp[i] = cp[i]!;\n      if (front > r.front)", "ts", T_IX + "::random generations"),
 ("d_comp_clears_holds", CV, "cp[i] = (cp[i]! & FREE_HOLDS) | value; },", "cp[i] = value; },", "ts", T_IX + "::random generations"),
 ("d_comp_unmasked", CV, "comp: (k: number) => g.comp[lo + k]! & COMP_VALUE }", "comp: (k: number) => g.comp[lo + k]! & (COMP_VALUE | FREE_HOLDS) }", "ts", T_IX + "::random generations"),
 # rest E: every sample counted, the predecessor search galloping
 ("e_absent_uncounted", CU, "    if (Number.isNaN(p)) { if (++c.n >= STEP_OPS) { c.n = 0; yield; } continue; }", "    if (Number.isNaN(p)) continue;", "ts", T_M + "::no free samples"),
 ("e_refuted_uncounted", CU, "    c.n += 2 + 4 * 3 * xs.length;", "    if (d !== 0) c.n += 2 + 4 * 3 * xs.length;", "ts", T_M + "::each refuted"),
 ("e_pred_walk", CU, "      while (lo + step < t.n && t.enter[lo + step]! <= p) { lo += step; step *= 2; c.n++; }",
  "      while (lo + step < t.n && t.enter[lo + step]! <= p) { lo += step; }", "ts", T_M + "::one late free sample"),
 # the contradictions: each sample once, its first deep point by bisections
 ("e_wide_enumerated", CU, "    const w = first(t.witness), e = first(t.enter), m = first(t.end);",
  "    const w = first(t.witness), e = first(t.enter), m = first(t.end);\n    for (let k = 0; k < t.n && t.enter[k]! <= b; k++) { c.n++; if (t.witness[k]! - a > PROTECT && b - t.witness[k]! > PROTECT) x = Math.min(x, t.witness[k]!); }",
  "ts", T_M + "::a raw radius"),
 ("e_first_deep_no_end", CU, "    if (m < t.n && (t.flags[m]! & F_XD)", "    if (m < 0 && (t.flags[m]! & F_XD)", "ts", T_U),
 ("e_first_deep_no_enter", CU, "    if (e < t.n && (t.flags[e]! & F_ED))", "    if (e < 0 && (t.flags[e]! & F_ED))", "ts", T_U),
 ("e_gallop_no_bisection", CU, "      let a = lo + 1, b = Math.min(lo + step, t.n);", "      let a = lo + 1, b = Math.min(lo + 1, t.n);", "ts", T_U),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak161")
    shutil.copyfile(path, bak)
    try:
        mutated = src
        for o, nw in zip(olds, news): mutated = mutated.replace(o, nw)
        open(path, "w").write(mutated)
        c = subprocess.run(["npx", "vue-tsc", "--noEmit", "-p", "tsconfig.app.json"], cwd=W, capture_output=True, text=True, timeout=900)
        if c.returncode: add((name, "NOCOMPILE", (c.stdout + c.stderr).strip().splitlines()[:1])); continue
        if kind == "ts":
            try:
                files, _, pat = sel.partition("::")
                p = subprocess.run(["npx", "vitest", "run", "--reporter=dot", *files.split(), *(["-t", pat] if pat else [])], cwd=W, capture_output=True, text=True, timeout=900)
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
