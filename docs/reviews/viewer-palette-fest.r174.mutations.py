"""R174 (B8, step 4 package 2 plan 5: the per-line sample goes, a sample where the kind of move changes stays): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
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
M = [
 # the kind-change sample: without it a rapid part of a contact shorter than the cadence reads as a feed
 ("b8_kind_never", CO, ": qKind[pi] !== (isRapid ? 1 : 0)) {", ": qKind[pi] !== (isRapid ? 1 : 0) && false) {", "ts",
  T_C + " " + T_LS + "::rapid – feed – rapid in one contact|tables and views"),
 # the kind a query leaves: never noted, every chunk start asks again (the per-line cost back, and more)
 ("b8_every_chunk", CO, ": qKind[pi] !== (isRapid ? 1 : 0)) {", ": qKind[pi] !== (isRapid ? 1 : 0) || true) {", "ts", T_LS),
 # the comparison is not vacuous: the old rule by default
 ("b8_old_rule_default", CO, "          if (opts.lineSample ? qLine[pi]", "          if ((opts.lineSample ?? true) ? qLine[pi]", "ts", T_LS),
 # the comparison's seam: the run "with" never takes the old rule
 ("b8_seam_ignored", CO, "          if (opts.lineSample ? qLine[pi]", "          if (opts.lineSample && false ? qLine[pi]", "ts", T_LS),
 # the re-sampling at MIN_ADV after a touch (R86): what the cadence leaves to it
 ("b8_resample_dropped", CO, "          if (fromTouch) {", "          if (fromTouch && false) {", "ts", T_C + " " + T_WIN + "::VP-I45|contact windows"),
 # the near pair's margin exit never walked: its stay ends at its last sample inside the margin
 ("b8_near_never", CO, "const fromNear = !opts.lineSample && !touching[pi] && !unknownInside && d > opts.margin && s", "const fromNear = !opts.lineSample && !touching[pi] && !unknownInside && d > opts.margin * 1e9 && s", "ts",
  T_WIN + " " + T_LS + "::near stays|tables and views"),
 # the walk's speed bound only the current chunk's, not the largest since the near sample
 ("b8_near_current_v", CO, "            const V = Math.max(nearV[pi]!, 1e-9);", "            const V = Math.max(pairV[pi]!, 1e-9);", "ts", T_WIN + "::largest speed bound"),
 # the walk steps past the margin: inside it by the distance to the margin's far side
 ("b8_near_walk_long", CO, "              x += Math.max(MIN_ADV, Math.abs(dx - opts.margin) / V);", "              x += Math.max(MIN_ADV, (dx + opts.margin) / V);", "ts", T_WIN + " " + T_LS + "::near stays|tables and views"),
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
