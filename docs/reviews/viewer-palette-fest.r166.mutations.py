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
M = [
 # the range rules (pure)
 ("l_first_whole", LR, "  if (n <= FIRST_ROWS) return { lo: 0, hi: n };\n  let lo = -1", "  if (n <= FIRST_ROWS || n > 0) return { lo: 0, hi: n };\n  let lo = -1", "ts", T_LR),
 ("l_far_between", LR, "  return around(n, i);\n}\n\n/** One portion more", "  return { lo: Math.min(r.lo, i), hi: Math.max(r.hi, i + 1) + 0 * around(n, i).lo };\n}\n\n/** One portion more", "ts", T_LR),
 ("l_grow_whole", LR, "  return { lo: r.lo - up, hi: r.hi + down };", "  return { lo: 0, hi: n + 0 * (up + down) };", "ts", T_LR),
 ("l_moved_partial", LR, "  if (n - kept <= STEP_ROWS) return { lo: 0, hi: n };", "  if (n - kept < 0) return { lo: 0, hi: n };", "ts", T_LR),
 ("l_sizer_one_digit", LR, "    else for (let d = 0; d <= 9; d++) out.push(sh.replace(/#/g, String(d)));", "    else for (let d = 1; d <= 1; d++) out.push(sh.replace(/#/g, String(d)));", "ts", T_LR),
 ("l_sizer_longest_only", LR, ".slice(0, SIZER_SHAPES);", ".slice(0, 1 + 0 * SIZER_SHAPES);", "ts", T_LR),
 ("l_tab_stop_unrendered", LR, "  if (s >= r.lo && s < r.hi) return stop;", "  if (s >= r.lo - 1e9) return stop;", "ts", T_LR),
 ("l_tab_stop_no_focus", LR, "  if (f >= r.lo && f < r.hi) return focused;", "  if (f < -1) return focused;", "ts", T_LR),
 ("l_tab_stop_none", LR, "  return r.hi > r.lo ? keys[Math.max(r.lo, Math.min(r.hi - 1, s))]! : null;", "  return r.hi > r.lo ? null : keys[Math.max(r.lo, Math.min(r.hi - 1, s))]!;", "ts", T_LR),
 ("l_kept_one_row", LR, "  if (r.hi - r.lo < FIRST_ROWS) {", "  if (r.hi - r.lo < 0 * FIRST_ROWS) {", "ts", T_LR),
 # the Sim tab
 ("v_no_sizer", SP, "            <tr class=\"sizerRow\" aria-hidden=\"true\">", "            <tr v-if=\"rows.length < 0\" class=\"sizerRow\" aria-hidden=\"true\">", "e2e", E_SP + "::fills in portions"),
 ("v_sizer_one_digit", LR, "    else for (let d = 0; d <= 9; d++) out.push(sh.replace(/#/g, String(d)));", "    else for (let d = 1; d <= 1; d++) out.push(sh.replace(/#/g, String(d)));", "e2e", E_SP + "::fills in portions"),
 ("v_kept_one_row", LR, "  if (r.hi - r.lo < FIRST_ROWS) {", "  if (r.hi - r.lo < 0 * FIRST_ROWS) {", "e2e", E_SP + "::never in a hidden tab"),
 ("v_hidden_measured", SP, ["  if (!trs.length || !sc.clientHeight) return;", "  if (!(h > 0)) return;"], ["  if (!trs.length) return;", "  if (!(h >= 0)) return;"], "e2e", E_SP + "::never in a hidden tab|shown between its portions"),
 ("v_pitch_first_row", SP, ["trs[Math.min(1, n - 1)]", "(n > 2 ? (b.top - a.top) / (n - 2) : a.height)"], ["trs[Math.min(0, n - 1)]", "(n > 1 ? (b.top - a.top) / (n - 1) : a.height)"], "e2e", E_SP + "::fills in portions|never in a hidden tab"),
 ("v_measure_late", SP, "  measureRowH();   // the spacers before the marked row's place is read", "  void 0;   // the spacers before the marked row's place is read", "e2e", E_SP + "::never in a hidden tab"),
 ("v_height_not_at_once", SP, "  sc.style.setProperty(\"--sim-row-h\", `${h}px`);", "  void sc;", "e2e", E_SP + "::never in a hidden tab"),
 ("v_pitch_once", SP, "  if (!sc || listComplete.value || measuredVer === rangeVer) return;", "  if (!sc || listComplete.value || measuredVer >= 0) return;", "e2e", E_SP + "::a size change after a list was measured"),
 ("v_tab_stop_unrendered", LR, "  if (s >= r.lo && s < r.hi) return stop;", "  if (s >= r.lo - 1e9) return stop;", "e2e", E_SP + "::ONE tab stop while it fills"),
 ("v_tab_stop_no_focus", LR, "  if (f >= r.lo && f < r.hi) return focused;", "  if (f < -1) return focused;", "e2e", E_SP + "::ONE tab stop while it fills"),
 ("v_focus_not_tracked", SP, "  if (key) lastFocused.value = key;", "  if (key) void lastFocused.value;", "e2e", E_SP + "::ONE tab stop while it fills"),
 ("v_no_spacers", SP, "            <tr v-if=\"range.lo > 0\" class=\"listSpacer\"", "            <tr v-if=\"range.lo < 0\" class=\"listSpacer\"", "e2e", E_SP + "::fills in portions"),
 ("v_whole_at_once", SP, "  range.value = nextRange(renderedKeys, keys, [at(held?.key), placed, at(rowStop.value)]);", "  range.value = { lo: 0, hi: keys.length + 0 * nextRange(renderedKeys, keys, [at(held?.key), placed, at(rowStop.value)]).lo };", "e2e", E_SP + "::fills in portions"),
 ("v_key_unadmitted", SP, "  admitRow(keys.indexOf(to));\n  void nextTick(() => pickEl(to)?.focus());", "  void keys.indexOf(to);\n  void nextTick(() => pickEl(to)?.focus());", "e2e", E_SP + "::between the portions"),
 ("v_marked_displaces", SP, "  if (marked.value) admitRow(rows.value.findIndex(r => r.key === marked.value), focusedIndex());", "  if (marked.value) admitRow(rows.value.findIndex(r => r.key === marked.value), -1 + 0 * focusedIndex());", "e2e", E_SP + "::a long list is a window"),
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
