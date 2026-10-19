"""R176 (Codex R175 VP-I129: a jump or a tool-offset change ends a near stretch on the pose before it): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
e2e = build, then Playwright -g. Restores from a byte copy. `--dry` checks the anchors only."""
import os, shutil, subprocess, sys, time
R = os.environ.get("MUT_TREE", "/home/cnc/lcnc-suite-mut")
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
LR = "lcnc-webui/src/viewer/simListRange.ts"
T_LR = "src/viewer/simListRange.test.ts"
SP = "lcnc-webui/src/SimPanel.vue"
E_SP = "e2e/sim-panel.viewer.spec.ts"
T_U = "src/viewer/contactUnion.test.ts"
T_M = "src/viewer/contactMeter.test.ts"
T_IX = "src/viewer/contactViewIndexed.test.ts"
T_VU = "src/viewer/contactViewUnion.test.ts"
CP_T = "src/viewer/contactPublisher.test.ts"
CU = "lcnc-webui/src/viewer/contactUnion.ts"
CO = "lcnc-webui/src/viewer/collision.ts"
T_C = "src/viewer/collision.test.ts"
T_OR = "src/viewer/collisionOracle.test.ts"
T_RO = "src/viewer/collisionRangeOracle.test.ts"
T_HZ = "src/viewer/collisionHorizon.test.ts"
T_SH = "src/viewer/sweepShards.test.ts"
T_IN = "src/viewer/collisionInside.test.ts"
T_RG = "src/viewer/collisionRange.test.ts"
CW = "lcnc-webui/src/viewer/collisionWorker.ts"
SB = "lcnc-webui/src/ScrubBar.vue"
SS = "lcnc-webui/src/viewer/sweepShards.ts"
SM = "lcnc-webui/src/viewer/sweepMerge.ts"
T_WK = "src/viewer/collisionWorker.test.ts"
T_SD = "src/viewer/startDepPayloads.test.ts"
T_SMG = "src/viewer/sweepMerge.test.ts"
E_CO = "e2e/collisions.viewer.spec.ts"
SC = "lcnc-webui/src/viewer/shownContacts.ts"
T_MT = "src/viewer/contactMeter.test.ts"
T_CVT = "src/viewer/contactView.test.ts"
STK = "lcnc-webui/src/viewer/scrubTrack.ts"
SR = "lcnc-webui/src/viewer/simRows.ts"
CC = "lcnc-webui/src/viewer/checkContext.ts"
T_SR = "src/viewer/simRows.test.ts"
T_CC = "src/viewer/checkContext.test.ts"
T_STK = "src/viewer/scrubTrack.test.ts"
SB = "lcnc-webui/src/ScrubBar.vue"
T_LS = "src/viewer/collisionLineSample.test.ts"
T_WIN = "src/viewer/collisionWindows.test.ts"
FMT = "lcnc-webui/src/format.ts"
NH = "lcnc-webui/src/viewer/nearHistory.ts"
T_NH = "src/viewer/nearHistory.test.ts"
LS = "lcnc-webui/src/viewer/collisionLineSample.test.ts"
M = [
 # VP-I129: no close at the boundary; a close at jumps only; the close from the distance AFTER the boundary
 ("v129_no_close", CO, "        if (!Number.isNaN(nearQ[pi]!) && !opts.lineSample && lastReal >= 0) {", "        if (!Number.isNaN(nearQ[pi]!) && !opts.lineSample && lastReal >= 0 && lastReal < 0) {", "ts", T_WIN + "::VP-I129"),
 ("v129_breaks_only", CO, "        if (!Number.isNaN(nearQ[pi]!) && !opts.lineSample && lastReal >= 0) {", "        if (!Number.isNaN(nearQ[pi]!) && !opts.lineSample && lastReal >= 0 && breakBoundary) {", "ts", T_WIN + "::VP-I129"),
 ("v129_post_pose", CO, "          const d0 = Math.min(distAtVertex(lastReal, pi, opts.margin * 2), opts.margin * 2);", "          const d0 = Math.min(0 * distAtVertex(lastReal, pi, opts.margin * 2) + distAtCum(c0 + 1e-6, pi, opts.margin * 2), opts.margin * 2);", "ts", T_WIN + "::VP-I129"),
 # R175's rules whose code moved into searchBack, re-anchored
 ("c_search_no_checkpoint_r176", CO, "      if (x <= lo + 1e-9) return false;\n      done++;\n      if ((done & (SAMPLES_PER_CLOCK - 1)) === 0",
  "      if (x <= lo + 1e-9) return false;\n      done++;\n      if (false && (done & (SAMPLES_PER_CLOCK - 1)) === 0", "ts", T_WIN + "::checkpoints|budget and an abort"),
 ("c_search_unposed_r176", CO, "      dx = Math.min(distAtCum(x, pi, opts.margin * 2), opts.margin * 2);   // beyond the bound: at least 2 × margin",
  "      dx = Math.min(pairDistance(bodies[pairs[pi]![0]]!, bodies[pairs[pi]![1]]!, opts.margin * 2, opts.margin), opts.margin * 2);", "ts", T_WIN + "::parked and continued|near stays"),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak173")
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
