"""R172 (C3: display lines — plan 1.3/4.2; C4 docs): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
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
M = [
 # the display line: never the raw line
 ("d_raw_fallback", STK, "  return own > 0 ? own : t.cline?.[i] ?? 0;\n}", "  return own > 0 ? own : t.cline?.[i] || (t.lines[i] ?? 0);\n}", "ts", T_CVT + "::display lines"),
 ("d_call_ignored", STK, "  return own > 0 ? own : t.cline?.[i] ?? 0;\n}", "  return own > 0 ? own : 0 * (t.cline?.[i] ?? 0);\n}", "ts", T_CVT + "::display lines"),
 ("d_untrusted_own", STK, "  return (t.lineOk ? t.lineOk[i] === 1 : wholesaleTrusted) && ln > 0 ? ln : 0;",
  "  return (t.lineOk ? t.lineOk[i] !== 2 : wholesaleTrusted) && ln > 0 ? ln : 0;", "ts", T_CVT + "::display lines"),
 ("d_wholesale_ignored", STK, "  return (t.lineOk ? t.lineOk[i] === 1 : wholesaleTrusted) && ln > 0 ? ln : 0;",
  "  return (t.lineOk ? t.lineOk[i] === 1 : true || wholesaleTrusted) && ln > 0 ? ln : 0;", "ts", T_CVT + "::display lines"),
 ("d_point_ending", CV, "    if (atEnd ? t.cum[mid]! < pos : t.cum[mid]! <= pos) lo = mid + 1; else hi = mid;\n  }\n  return lo;",
  "    if ((atEnd || !atEnd) ? t.cum[mid]! < pos : t.cum[mid]! <= pos) lo = mid + 1; else hi = mid;\n  }\n  return lo;", "ts", T_CVT + "::display lines"),
 ("d_runs_over_untrusted", CV, "    if (k >= 0 && runLine[k] === ln && !broken) runB[k] = t.cum[i]!;",
  "    if (k >= 0 && (runLine[k] === ln || ln < 0) && !broken) runB[k] = t.cum[i]!;", "ts", T_CVT + "::display lines"),
 ("d_display_runs_raw", CV, "  return runsBy(t, i => displayLineOf(t, i, trusted) || -1);", "  return runsBy(t, i => (displayLineOf(t, i, trusted) && t.lines[i]!) || -1);", "ts", T_CVT + "::display lines"),
 ("d_name_dropped", CV, "  target.noLine = true;\n  if (name) target.subName = name;", "  target.noLine = true;\n  if (!name) target.subName = name ?? undefined;", "ts", T_CVT + "::display lines"),
 ("d_row_label_raw", SR, "      lineLabel: t.entryMove ? \"entry\" : t.noLine ? (t.subName ? `(${t.subName})` : NO_VALUE) : `L${t.line}`,",
  "      lineLabel: t.entryMove ? \"entry\" : `L${t.line}`,", "ts", T_SR + "::without a line to show"),
 ("d_row_note_dropped", SR, "    if (t.noLine && !t.entryMove) notes.push(", "    if (t.noLine && t.entryMove) notes.push(", "ts", T_SR + "::without a line to show"),
 ("d_word_raw", SR, "  if (!lineAt) return `L${raw}`;\n  const l = lineAt(pos);", "  if (!lineAt || raw >= 0) return `L${raw}`;\n  const l = lineAt(pos);", "ts", T_SR + "::a position's line in words"),
 ("d_card_raw", CC, "bc.map(c => `${pairName(c.a, c.b)} (${lineWordAt(o.lineAt, c.cum, c.line)})`)", "bc.map(c => `${pairName(c.a, c.b)} (${lineWordAt(null, c.cum, c.line)})`)", "ts", T_CC + "::what the result left out"),
 ("d_note_raw_end", CV, "    const la = lineAt(a), lb = lineAt(b, true);", "    const la = lineAt(a), lb = lineAt(b);", "ts", T_CVT + "::display lines"),
 ("e_entry_line", STK, "    lineOk[0] = 0;\n    lineOk[1] = 0;", "    lineOk[0] = 0;\n    lineOk[1] = 1;", "e2e", E_CO + "::a contact on the entry"),
 # the page: the display resolvers, the trust
 ("e_page_raw_lines", TV, "  if (!c || c.trusted !== trusted) _lineAtCache.set(t, c = { trusted, f: displayLineAt(t, trusted) });",
  "  if (!c || c.trusted !== trusted) _lineAtCache.set(t, c = { trusted, f: displayLineAt({ ...t, lineOk: undefined, cline: undefined }, true) });", "e2e", E_CO + "::a contact in a called file"),
 ("e_page_raw_runs", TV, "  if (!c || c.trusted !== trusted) _lineRunsCache.set(t, c = { trusted, r: displayLineRuns(t, trusted) });",
  "  if (!c || c.trusted !== trusted) _lineRunsCache.set(t, c = { trusted, r: displayLineRuns({ ...t, lineOk: undefined, cline: undefined }, true) });", "e2e", E_CO + "::a contact in a called file"),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak172")
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
