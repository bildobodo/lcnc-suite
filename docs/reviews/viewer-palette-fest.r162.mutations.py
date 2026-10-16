"""R161 finding (VP-I115 rest F): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
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
 # rest F: the windows by the witnesses where the walk found the structure
 ("f_local_never", CV, "g.front = reach[sd]!.front; g.local = reach[sd]!.local;", "g.front = reach[sd]!.front; g.local = reach[sd]!.local && false;", "ts", T_IX + "::long valid free stretch|widePair|wideLater"),
 ("f_window_from_late", CU, "  return Math.max(0, (s.local ? firstWitnessFrom(s, y) : firstEnterFrom(s, y - s.back)) - 1);", "  return Math.max(0, (s.local ? firstWitnessFrom(s, y) + 1 : firstEnterFrom(s, y - s.back)) - 1);", "ts", T_U + " " + T_IX + "::random generations"),
 ("f_window_to_early", CU, "  while (lo < hi) { const m = (lo + hi) >> 1; if (s.witness(m) <= y) lo = m + 1; else hi = m; }\n  return lo - 1;", "  while (lo < hi) { const m = (lo + hi) >> 1; if (s.witness(m) <= y) lo = m + 1; else hi = m; }\n  return lo - 2;", "ts", T_U + " " + T_IX + "::random generations"),
 ("f_floor_late", CU, "const stretchFloor = (s: UnionSide, j: number) => (s.local ? s.witness(j) : s.enter(j) - s.front);", "const stretchFloor = (s: UnionSide, j: number) => (s.local ? s.witness(Math.min(j + 1, s.n - 1)) : s.enter(j) - s.front);", "ts", T_U + " " + T_IX + "::random generations"),
 ("f_rising_unchecked", CU, "    if (k > 0 && !(x.witness[k]! >= x.witness[k - 1]!)) x.rising = false;", "    if (k < 0 && !(x.witness[k]! >= x.witness[k - 1]!)) x.rising = false;", "ts", T_U + "::the walk calls a kept stretch local"),
 # the bar's stage watch registered after every input it reads (a computed declared below it is in its TDZ)
 ("v_stage_watch_early", TV, ["// every load since Form 1)\n/** The bar's timeline width", "// what the bar shows, watched once every input of it is declared (_colStage)\nwatch(() => _colStage(), _colOnStageChange);\n"],
  ["// every load since Form 1)\nwatch(() => _colStage(), _colOnStageChange);\n/** The bar's timeline width", "// what the bar shows, watched once every input of it is declared (_colStage)\n"],
  "e2e", "e2e/viewer.spec.ts::reads nothing before it is declared"),
 ("f_bound_unchecked", CU, "(j + 1 >= x.n || x.fHi[q]! <= x.witness[j + 1]!)", "(j + 1 >= x.n || x.fHi[q]! <= x.witness[j + 1]! + Infinity)", "ts", T_U + "::the walk calls a kept stretch local"),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak162")
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
