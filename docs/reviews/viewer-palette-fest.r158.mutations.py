"""R157 findings VP-I115..VP-I118 (plan 3.6 Form 1 (the stepped build, the publisher, the page's layout reads): each mutation must
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
M = [
 # VP-I116: a discarded build stops at its next step; a released request's apply too
 ("p_build_runs_on", CP, "      if (stop?.()) { job.return(undefined as never); return null; }", "      if (stop?.() && false) { job.return(undefined as never); return null; }", "ts", T_P),
 ("p_apply_runs_on", CP, "      if (!live()) { job.return(undefined as never); return null; }", "      if (!live() && false) { job.return(undefined as never); return null; }", "ts", f"{T_P} {T_W}"),
 # VP-I117: views die at the publication that replaces them, and with their request
 ("p_no_retire", CP, "    for (const p of old.values()) this.retire(p);", "    void old;", "ts", T_P),
 ("p_release_no_retire", CP, "if (p.ids.some(id => gone.has(id))) { this.views.delete(t); this.retire(p); }", "if (p.ids.some(id => gone.has(id))) { this.views.delete(t); }", "ts", T_P),
 ("v_retired_reads", CV, "  if (v.retired) throw new Error(", "  if (v.retired && v.n < 0) throw new Error(", "ts", T_P),
 # VP-I118: every live store once, the shown old copy too
 ("p_stats_no_shown", CP, "    for (const p of this.views.values()) for (const t of p.uses) add(t, \"shown\", false);", "    void add;", "ts", T_P),
 # VP-I115: the walk, a piece, the build's bulk work, the queries' reads
 ("u_scan_unbounded", "lcnc-webui/src/viewer/contactUnion.ts", "const SCAN = 64;", "const SCAN = 1 << 30;", "ts", T_U),
 ("u_absorb_at_once", "lcnc-webui/src/viewer/contactUnion.ts", "        if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }\n        const n0 = parts[0]", "        if ((c.n += 2) >= STEP_OPS) { c.n = 0; }\n        const n0 = parts[0]", "ts", T_U),
 ("u_emit_at_once", "lcnc-webui/src/viewer/contactUnion.ts", "      for (let k = rp[si]!; k < x.n && x.enter[k]! <= b; k++) {\n        if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }",
  "      for (let k = rp[si]!; k < x.n && x.enter[k]! <= b; k++) {\n        if ((c.n += 2) >= STEP_OPS) { c.n = 0; }", "ts", T_U),
 ("u_piece_rows_at_once", "lcnc-webui/src/viewer/contactUnion.ts", "      each(si, k, !!iv && iv.a === p.start && iv.ao === p.startOpen);\n      if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }",
  "      each(si, k, !!iv && iv.a === p.start && iv.ao === p.startOpen);\n      if ((c.n += 4) >= STEP_OPS) { c.n = 0; }", "ts", T_CV),
 ("u_zone_flat", "lcnc-webui/src/viewer/contactUnion.ts", "  const zone = 4 + 8 * Math.ceil(Math.log2(seps.count + 1));", "  const zone = 4 + 0 * seps.count;", "ts", T_CV),
 ("c_gaps_native_sort", CV, "        const go = yield* sortSteps(rows0.length, (x, y) => G.get(rows0[x]!, \"pair\") - G.get(rows0[y]!, \"pair\")",
  "        rows0.sort((x, y) => G.get(x, \"pair\") - G.get(y, \"pair\") || G.get(x, \"start\") - G.get(y, \"start\") || x - y);\n        const go = yield* sortSteps(rows0.length, (x, y) => G.get(rows0[x]!, \"pair\") - G.get(rows0[y]!, \"pair\")", "ts", T_CV),
 ("c_meter_off", CV, "const rd = (c: Col, row: number) => { viewWork.n++; return", "const rd = (c: Col, row: number) => { viewWork.n += 0; return", "ts", T_CV),
 ("c_starts_flat", CV, "      if ((ops.n += 16 + viewWork.n - w0) >= STEP_OPS) { ops.n = 0; yield; check(v); }", "      if ((ops.n += 16 + 0 * w0) >= STEP_OPS) { ops.n = 0; yield; check(v); }", "ts", T_CV),
 ("w_ticks_estimate", SW, "    work: () => viewWork.n,", "    work: () => 0 * viewWork.n,", "ts", T_CV),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak158")
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
