"""R173 (Codex R172 VP-I125: a folded source's undecidable stretch reads its own track; VP-I126: no raw line without a table): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
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
STK = "lcnc-webui/src/viewer/scrubTrack.ts"
SR = "lcnc-webui/src/viewer/simRows.ts"
CC = "lcnc-webui/src/viewer/checkContext.ts"
T_SR = "src/viewer/simRows.test.ts"
T_CC = "src/viewer/checkContext.test.ts"
T_STK = "src/viewer/scrubTrack.test.ts"
SB = "lcnc-webui/src/ScrubBar.vue"
M = [
 ("u125_own_lineat_dropped", CV, "...(n0.own ? { lineAt: n0.own.source.ownTrack!.lineAt } : {})", "...(n0.own && n0.own.src < -1 ? { lineAt: n0.own.source.ownTrack!.lineAt } : {})", "ts", T_CVT + "::VP-I125"),
 ("u125_shown_axis", CV, "      const s = own ? Math.min(s0, t.ownCov) : Math.min(t.source.at(s0), t.cov);",
  "      const s = own ? Math.min(t.source.at(s0), t.cov) : Math.min(t.source.at(s0), t.cov);", "ts", T_CVT + "::VP-I125"),
 ("u125_sources_merged", CV, "      const key = `${a}\\u0000${b}\\u0000${own ? t.src : -1}`;", "      const key = `${a}\\u0000${b}\\u0000${own ? -1 : -1}`;", "ts", T_CVT + "::VP-I125"),
 ("u125_note_shown", CV, "  const lineAt = u.lineAt ?? shownLineAt;", "  const lineAt = shownLineAt ?? u.lineAt;", "ts", T_CVT + "::VP-I125"),
 ("e125_own_lineat_dropped", CV, "...(n0.own ? { lineAt: n0.own.source.ownTrack!.lineAt } : {})", "...(n0.own && n0.own.src < -1 ? { lineAt: n0.own.source.ownTrack!.lineAt } : {})", "e2e", E_CO + "::VP-I125"),
 ("e126_no_track_resolver", SB, "  return t ? displayLineAt(t, !viewerGcode.value?.lines_untrusted) : null;", "  return t && !t ? displayLineAt(t, !viewerGcode.value?.lines_untrusted) : null;", "e2e", E_CO + "::VP-I126"),
 # R171's and R172's rules whose lines R173 rebuilt, re-anchored
 ("u_held_ignored_r173", CV, 'if (G.get(row, "reason") !== GAP_UNDECIDABLE) continue;\n      const { a, b } = nameOf(v, t, G.get(row, "pair"));\n      const own',
  'if (G.get(row, "reason") !== GAP_UNDECIDABLE || t.held) continue;\n      const { a, b } = nameOf(v, t, G.get(row, "pair"));\n      const own', "ts", T_CVT + "::undecidable stretches: every generation"),
 ("u_pairs_unordered_r173", CV, "  const o = yield* sortSteps(out.length, (x, y) => firstAt[x]! - firstAt[y]!", "  const o = yield* sortSteps(out.length, (x, y) => 0 * (firstAt[x]! - firstAt[y]!)", "ts", T_CVT + "::undecidable stretches: every generation"),
 ("d_card_raw_r173", CC, "(${lineWordAt(o.lineAt, c.cum)})", "(${lineWordAt(null, c.cum)})", "ts", T_CC + "::what the result left out"),
 ("u126_word_number", SR, "  if (!lineAt) return NO_VALUE;", "  if (!lineAt) return `L${Math.round(pos)}`;", "ts", T_SR + "::a position's line in words"),
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
