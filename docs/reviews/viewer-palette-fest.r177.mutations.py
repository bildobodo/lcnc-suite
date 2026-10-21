"""R177 (the live look of 2026-10-19/20: the list's scroll, limit rows by the program's line, open near stays while running, the timeline's lanes, a pinned parse ends with its run): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
e2e = build, then Playwright -g; py = pytest in lcnc-gateway. Restores from a byte copy. `--dry` checks the anchors only."""
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
G = "lcnc-gateway"
GU = G + "/gateway_util.py"
BP = G + "/bulk_pipeline.py"
M = [
 # the list keeps its scroll on a new result; what is in view stays in place
 ("r177_follow_every_rows", SP, "  if (marked.value !== followed) followSoon();", "  followSoon();", "e2e", E_SP + "::a new result keeps the list where it was scrolled"),
 ("r177_anchor_marked_only", SP, "  if (!tr || !inView(tr.getBoundingClientRect())) {", "  if (!tr || !inView(tr.getBoundingClientRect()) && false) {", "e2e", E_SP + "::a new result keeps the list where it was scrolled"),
 ("r177_follow_on_complete", SP, "watch(listComplete, whole => { if (whole && marked.value !== followed) followSoon(); });", "watch(listComplete, whole => { if (whole) followSoon(); });", "e2e", E_SP + "::a new result keeps the list where it was scrolled|spacers' row height"),
 # limit rows and bands by the program's line
 ("r177_first_move_raw", STK, "  return lineHas(p.index, line) ? firstMoveBy(t, p.index, p.lines, line, on) : lineFirstMoveCum(t, line, on);", "  return lineHas(p.index, -1) ? firstMoveBy(t, p.index, p.lines, line, on) : lineFirstMoveCum(t, line, on);", "ts", T_STK + "::line of the PROGRAM"),
 ("r177_span_raw", STK, "  return lineHas(p.index, line) ? spanBy(t, p.index, line, on) : lineSpanCum(t, line, on);", "  return lineHas(p.index, -1) ? spanBy(t, p.index, line, on) : lineSpanCum(t, line, on);", "ts", T_STK + "::line of the PROGRAM"),
 ("r177_rows_raw", SB, "    const move = programLineFirstMoveCum(b, v.line, t, !viewerGcode.value?.lines_untrusted);", "    const move = programLineFirstMoveCum(b, v.line, t, !viewerGcode.value?.lines_untrusted) && lineSpanCum(b, v.line, t);", "e2e", E_SP + "::a limit row stands at its program line"),
 ("r177_bands_raw", SB, "    const span = programLineSpanCum(b, v.line, t, !viewerGcode.value?.lines_untrusted);", "    const span = programLineSpanCum(b, v.line, t, !viewerGcode.value?.lines_untrusted) && lineSpanCum(b, v.line, t);", "e2e", E_SP + "::a limit row stands at its program line"),
 # an open near stay while running
 ("r177_open_near_counted", CV, '  return !(t.source.running && !t.held && Number.isNaN(E.get(e, "end")));', '  return !(t.source.running && !t.held && Number.isNaN(E.get(e, "end")) && t.src < 0);', "ts", T_CVT + "::while the check runs"),
 ("r177_running_not_passed", SC, "                   ...(s.running ? { running: true } : {}) });", "                   ...(s.running && s.id < 0 ? { running: true } : {}) });", "ts", "src/viewer/shownContacts.test.ts::the running flag reaches the view"),
 ("r177_partial_not_running", TV, "    return _colPartialReq === null ? null : { id: _colPartialReq, map: null, coverage: end * collisionProgress.value, ownEnd: end, running: true };", "    return _colPartialReq === null ? null : { id: _colPartialReq, map: null, coverage: end * collisionProgress.value, ownEnd: end };", "ts", T_W + "::a running check's word is marked running"),
 ("r177_runbase_not_running", TV, "  return s && s.trk === trk ? { id: _colReqId, map: null, coverage: end * collisionProgress.value, ownEnd: end, running: true } : null;", "  return s && s.trk === trk ? { id: _colReqId, map: null, coverage: end * collisionProgress.value, ownEnd: end } : null;", "ts", T_W + "::a running check's word is marked running"),
 ("r177_entry_first_not_running", TV, "                   entryEnd: ent.track.cum[1], sweptToEnd: ent.whole, ...(e ? {} : { running: true }) },", "                   entryEnd: ent.track.cum[1], sweptToEnd: ent.whole },", "ts", T_W + "::a running check's word is marked running"),
 # the timeline's lanes
 ("r177_swept_in_track", SB, ".scrubBand.swept { top: calc(50% - 8px); height: 3px; transform: none; background: var(--info); }", ".scrubBand.swept { background: var(--info); }", "e2e", E_SP + "::the timeline: the progress"),
 ("r177_swept_translucent", SB, ".scrubBand.swept { top: calc(50% - 8px); height: 3px; transform: none; background: var(--info); }", ".scrubBand.swept { top: calc(50% - 8px); height: 3px; transform: none; background: color-mix(in oklab, var(--info) var(--tint-heavy), transparent); }", "e2e", E_SP + "::the timeline: the progress"),
 ("r177_clash_translucent", SB, ".scrubBand.clash { background: var(--mark-clash); }", ".scrubBand.clash { background: color-mix(in oklab, var(--mark-clash) var(--tint-edge), transparent); }", "e2e", E_SP + "::the timeline: the progress"),
 ("r177_tick_edge", SB, "  top: calc(50% - 3px);\n  height: 6px;\n  width: 2px;\n  transform: translateX(-50%);\n  pointer-events: none;\n}", "  top: calc(50% - 3px);\n  height: 6px;\n  width: 2px;\n  transform: translateX(-50%);\n  pointer-events: none;\n  box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg) 90%, transparent);\n}", "e2e", E_SP + "::the timeline: the progress"),
 ("r177_glyph_every_column", SB, "      const px = (x.pct / 100) * bandCols.value, glyph = px - last >= GLYPH_PX;", "      const px = (x.pct / 100) * bandCols.value, glyph = px - last >= GLYPH_PX * 0;", "e2e", E_SP + "::the timeline: the progress"),
 # a pinned parse ends with its run; the published ctx carries no verify file
 ("r177_pinned_outlives", GU, '    return "run_ended" if interp_idle else None', '    return "run_ended" if interp_idle and not inflight.get("pinned") else None', "py", "test_gateway_util.py::TestPinnedParseOutlived"),
 ("r177_verify_in_ctx", BP, '            self.published_ctx = {k: v for k, v in ctx.items() if k != "verify_against"}', '            self.published_ctx = dict(ctx)', "py", "test_bulk_pipeline.py::TestVerifyAtTheActualOffset"),
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
        if kind != "py":
            c = subprocess.run(["npx", "vue-tsc", "--noEmit", "-p", "tsconfig.app.json"], cwd=W, capture_output=True, text=True, timeout=900)
            if c.returncode: add((name, "NOCOMPILE", (c.stdout + c.stderr).strip().splitlines()[:1])); continue
        if kind == "py":
            env = dict(os.environ, LCNC_LOG_DIR=os.path.expanduser("~/claude-work/form1/testlogs"))
            p = subprocess.run([R + "/lcnc-gateway/.venv/bin/python", "-m", "pytest", "-o", "addopts=", "-q", "-p", "no:cacheprovider", sel], cwd=R + "/lcnc-gateway", capture_output=True, text=True, timeout=900, env=env)
            out = p.stdout + p.stderr
            why = [ln.strip() for ln in out.splitlines() if ln.startswith("FAILED") or "AssertionError" in ln][:2]
            tail = [ln for ln in out.splitlines() if " passed" in ln or " failed" in ln][-1:]
        elif kind == "ts":
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
