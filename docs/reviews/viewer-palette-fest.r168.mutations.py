"""R164 VP-I120 (the Sim list in portions) + R165 VP-I121 (one rendered tab stop) and the pitch per list: each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
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
M = [
 # the two defects of the tables C1 found
 ("c_band_mutes", CO, "if (cutting && (!isRapid || boundary)) { if (!inBand) cutMute[pi] = 1; }", "if (cutting && (!isRapid || boundary)) { if (!inBand || inBand) cutMute[pi] = 1; }", "ts", T_C + "::braking range"),
 ("c_rapid_open_unmarked", CO, "| (cutPart[pi] ? IV_CONTINUES_CUT : 0) | (isRapid ? IV_RAPID : 0);", "| (cutPart[pi] ? IV_CONTINUES_CUT : 0) | (isRapid ? 0 * IV_RAPID : 0);", "ts", T_C + "::braking range"),
 ("c_rapid_drag_unmarked", CO, "g = (inBand ? f : f & ~IV_POSSIBLE) | (isRapid ? IV_RAPID : 0);", "g = (inBand ? f : f & ~IV_POSSIBLE) | (isRapid ? 0 * IV_RAPID : 0);", "ts", T_C + "::move kind"),
 ("v_reentry_inherits", CV, "if ((ivFlags & IV_RAPID) || (first && (flags & EP_RAPID))) kind |= T_RAPID;", "if ((ivFlags & IV_RAPID) || (flags & EP_RAPID)) kind |= T_RAPID;", "ts", T_CV),
 ("v_rapid_ignored", CV, "if ((ivFlags & IV_RAPID) || (first && (flags & EP_RAPID))) kind |= T_RAPID;", "if ((ivFlags & 0 * IV_RAPID) || (first && (flags & EP_RAPID))) kind |= T_RAPID;", "ts", T_CV),
 ("v_piece_rapid_inherits", CV, "if ((ivFlags & IV_RAPID) || (first && (epFlags & EP_RAPID))) bits |= T_RAPID;", "if ((ivFlags & IV_RAPID) || (epFlags & EP_RAPID)) bits |= T_RAPID;", "ts", "src/viewer/contactViewUnion.test.ts::move kind"),
 # the ported guards: store-sink mutants the records do not see
 ("s_entry_is_witness", CO, "const iv = add(store.intervals, { episode: ep, enter: T(enter.at), exit: NaN, flags, next: NONE,", "const iv = add(store.intervals, { episode: ep, enter: T(s + 0 * enter.at), exit: NaN, flags, next: NONE,", "ts", T_HZ),
 ("s_entry_is_witness_oracle", CO, "const iv = add(store.intervals, { episode: ep, enter: T(enter.at), exit: NaN, flags, next: NONE,", "const iv = add(store.intervals, { episode: ep, enter: T(s + 0 * enter.at), exit: NaN, flags, next: NONE,", "ts", T_OR),
 ("s_touch_only_stays", CO, "        if (d <= opts.margin) {\n          if (epRow[pi]! < 0 && !cutMute[pi]) {", "        if (d <= (touch ? opts.margin : -1)) {\n          if (epRow[pi]! < 0 && !cutMute[pi]) {", "ts", T_OR),
 ("s_shard_drops_near", CO, "          if (epRow[pi]! < 0 && !cutMute[pi]) {", "          if (epRow[pi]! < 0 && !cutMute[pi] && (touch || !opts.shard || opts.shard.index === 0)) {", "ts", T_SH),
 ("s_stay_end_onset", CO, "if (ep >= 0) store.episodes.set(ep, \"end\", T(lastInMargin[pi]!));", "if (ep >= 0) store.episodes.set(ep, \"end\", store.episodes.get(ep, \"onset\") + 0 * lastInMargin[pi]!);", "ts", T_OR),
 ("s_no_boundary_origin", CO, "const flags = (boundary ? ORIGIN_BOUNDARY : origin)", "const flags = (boundary ? origin + 0 * ORIGIN_BOUNDARY : origin)", "ts", T_RO),
 ("s_no_boundary_origin_unit", CO, "const flags = (boundary ? ORIGIN_BOUNDARY : origin)", "const flags = (boundary ? origin + 0 * ORIGIN_BOUNDARY : origin)", "ts", T_RG),
 ("s_rest_note_dropped", CO, "        if (v === \"undecidable\") markInside(pi, v, firstLine);\n      }\n      if (rest) {", "        if (v === \"undecidable\") void firstLine;\n      }\n      if (rest) {", "ts", T_IN + "::at rest"),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak166")
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
