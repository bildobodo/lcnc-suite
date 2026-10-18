"""R171 (Codex R170 VP-I123: every generation's undecidable gaps united; VP-I124: their derivation in counted steps and metered, the page's build whole in the guards): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
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
M = [
 # VP-I123: united, nothing lifted
 ("u_held_ignored", CV, 'if (G.get(row, "reason") !== GAP_UNDECIDABLE) continue;\n      const { a, b } = nameOf(v, t, G.get(row, "pair"));\n      const key',
  'if (G.get(row, "reason") !== GAP_UNDECIDABLE || t.held) continue;\n      const { a, b } = nameOf(v, t, G.get(row, "pair"));\n      const key', "ts", T_CVT + "::undecidable stretches: every generation"),
 ("u_partial_drops_outer", CV, "if (last && s <= last[1] + 1e-9) { if (e > last[1]) last[1] = e; }", "if (last && s <= last[1] + 1e-9) { void e; }", "ts", T_CVT + "::undecidable stretches: every generation"),
 ("u_three_kept_two", CV, "else if (spans.length < 3) spans.push([s, e]);", "else if (spans.length < 2) spans.push([s, e]);", "ts", T_CVT + "::undecidable stretches: every generation"),
 ("u_more_lost", CV, "else more = true;   // starts past the third", "else more = false;   // starts past the third", "ts", T_CVT + "::undecidable stretches: every generation"),
 ("u_pairs_unordered", CV, "  const o = yield* sortSteps(out.length, (x, y) => out[x]!.spans[0]![0] - out[y]!.spans[0]![0]",
  "  const o = yield* sortSteps(out.length, (x, y) => 0 * (out[x]!.spans[0]![0] - out[y]!.spans[0]![0])", "ts", T_CVT + "::undecidable stretches: every generation"),
 # VP-I124: counted steps, metered buffers, the page's build in the guards
 ("u_gather_uncounted", CV, '      if ((ops.n += 4) >= STEP_OPS) { ops.n = 0; yield; check(v); }\n      const row = t.hIdx[k]!;',
  '      if ((ops.n += 0) >= STEP_OPS) { ops.n = 0; yield; check(v); }\n      const row = t.hIdx[k]!;', "ts", T_CVT + "::one pair's undecidable gaps, both generations"),
 ("u_native_sort", CV, "  const order = yield* sortSteps(n, (x, y) => gid.at(x) - gid.at(y) || gs.at(x) - gs.at(y) || ge.at(x) - ge.at(y) || x - y, STEP_OPS >> 2);",
  "  const order = Uint32Array.from({ length: n }, (_, i) => i).sort((x, y) => gid.at(x) - gid.at(y) || gs.at(x) - gs.at(y) || ge.at(x) - ge.at(y) || x - y);", "ts", T_CVT + "::one pair's undecidable gaps, both generations"),
 ("u_unmetered_copy", CV, "  const order = yield* sortSteps(n, (x, y) => gid.at(x) - gid.at(y) || gs.at(x) - gs.at(y) || ge.at(x) - ge.at(y) || x - y, STEP_OPS >> 2);",
  "  const order = Uint32Array.from(yield* sortSteps(n, (x, y) => gid.at(x) - gid.at(y) || gs.at(x) - gs.at(y) || ge.at(x) - ge.at(y) || x - y, STEP_OPS >> 2));", "ts", T_MT + "::undecidable gaps on one pair"),
 ("u_build_without_notes", SC, "  const undecidable = yield* undecidableStretchesSteps(view);", "  const undecidable = (yield* undecidableStretchesSteps(view)).slice(0, 0);", "e2e", E_CO + "::an undecidable gap alone"),
 ("u_page_build_replica", TV, "    return yield* buildShownSteps(tables, spec as ShownSpec, held, _lineAtOf(trk), _colTimelineCols, _sliceEnd(trk));",
  "    const sv = yield* buildShownSteps(tables, spec as ShownSpec, held, _lineAtOf(trk), _colTimelineCols, _sliceEnd(trk));\n    return sv && sv.derived ? { ...sv, derived: { ...sv.derived, undecidable: [] } } : sv;", "e2e", E_CO + "::an undecidable gap alone"),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak171")
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
