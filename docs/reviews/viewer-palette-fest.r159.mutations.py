"""R158 findings (VP-I115 rests A/B, VP-I118 rest): each mutation must
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
T_M = "src/viewer/contactMeter.test.ts"
T_IX = "src/viewer/contactViewIndexed.test.ts"
T_VU = "src/viewer/contactViewUnion.test.ts"
CU = "lcnc-webui/src/viewer/contactUnion.ts"
M = [
 # VP-I118: the build in the making counted, apart from published and waiting
 ("m_meter_off", CP, "const t0 = this.clock(), r = withMeter(meter, () => job.next())", "const t0 = this.clock(), r = withMeter(meter && null, () => job.next())", "ts", T_M),
 ("m_in_progress_hidden", CP, "inProgress = this.pass?.meter?.bytes ?? 0;", "inProgress = 0 * (this.pass?.meter?.bytes ?? 0);", "ts", T_M),
 ("m_meter_kept", CP, "        me.meter = null;\n        if (!out) { discarded(); return; }", "        if (!out) { discarded(); return; }", "ts", T_M),
 ("m_alloc_uncounted", CV, "  const out = allocU32(n);\n  const blocks = Math.ceil(n / BLOCK);", "  const out = new Uint32Array(n);\n  const blocks = Math.ceil(n / BLOCK);", "ts", T_M),
 ("m_sort_uncounted", ST, "  let b = allocU32(n);", "  let b = new Uint32Array(n) as Uint32Array;", "ts", T_M),
 ("m_js_row_buffer", ST, "    this.a[this.n++] = x;\n  }", "    this.a[this.n++] = x;\n    ((this as unknown as { js?: number[] }).js ??= []).push(x);\n  }", "ts", T_M),

 # VP-I115 rest A: one interval's gaps in counted steps, a band piece lit at once, ownEnd / freeOf by bisection
 ("a_gaps_at_once", CV, "    if ((c.n += 6) >= STEP_OPS) { c.n = 0; yield; }\n    const e = holeEnd(t, k);", "    if ((c.n += 6) >= STEP_OPS) { c.n = 0; }\n    const e = holeEnd(t, k);", "ts", T_CV),
 ("a_small_holes_huge", CV, "const SMALL_HOLES = 64;", "const SMALL_HOLES = 1 << 30;", "ts", T_CV),
 ("a_union_small_sync", CV, "if (typeof w === \"number\") work += w; else (later ??= []).push(w);", "if (typeof w === \"number\") work += w; else (later ??= []).push((function* (): Steps<void> { runToEnd(w); })());", "ts", T_CV),
 ("a_lit_first_column", CV, "    diff[c0]!++; diff[e + 1]!--;", "    diff[c0]!++; diff[Math.min(e, c0) + 1]!--;", "ts", T_CV),
 ("a_comp_of_gaps_self", CV, "          hComp[k] = same && G.get(idx[k + 1]!, \"start\") <= hReach[k]! ? hComp[k + 1]! : k;", "          hComp[k] = k + 0 * hReach[k]!;", "ts", T_CV),
 ("a_tool_gap_only_itself", CV, "          hTool[k] = G.get(g, \"reason\") === GAP_TOOL_UNKNOWN ? k : same ? hTool[k + 1]! : NO_GAP;", "          hTool[k] = G.get(g, \"reason\") === GAP_TOOL_UNKNOWN ? k : NO_GAP;", "ts", f"{T_CV} {T_IX} {T_VU}"),
 # VP-I115 rest B: the indexes the questions use
 ("b_no_next_free", CV, "    nextFree: k => nextOf(g.free, lo + k, hi,", "    nextFree: k => nextOf(Uint32Array.from({ length: g.free.length }, (_, b) => b), lo + k, hi,", "ts", T_IX),
 ("b_blocks_not_jumped", CV, "    if (nb !== b) { k = nb * BLOCK; continue; }", "    if (nb !== b && k < 0) { k = nb * BLOCK; continue; }", "ts", T_IX),
 ("b_no_comp", CV, "    ...(g.comp.length ? { comp: (k: number) => g.comp[lo + k]! } : {}),", "    ...(g.comp.length < 0 ? { comp: (k: number) => g.comp[lo + k]! } : {}),", "ts", T_IX),
 ("b_comp_wrong", CU, "        const value = compValue(endSide, endK);", "        const value = compValue(endSide, Math.max(0, endK - 1));", "ts", f"{T_U} {T_IX}"),
 ("b_facts_linear", CV, "  return { info: pieceFacts(v, u, g, piece), t, g, u };", "  return { info: (pieceFacts as unknown) ? describePiece(v.tables, u, [g.r0[0], g.r1[0]], g.sides, g.seps, piece, v.joined, () => {}) : pieceFacts(v, u, g, piece), t, g, u };", "ts", T_IX),
 ("b_heir_first", CV, "    if (lo < to && inside(s.witness(lo))) info.heir = refAt(0, lo);", "    if (from < to && inside(s.witness(from)) && lo >= 0) info.heir = refAt(0, from);", "ts", T_IX),
 ("b_possible_never", CV, "    }) < lo + to) info.possible = false;", "    }) < lo + from) info.possible = false;", "ts", T_IX),
 ("b_open_end_off", CV, "      for (; a < to && s.end(a) === piece.end; a++) if (s.open(a)) { info.openEnd = true; break; }", "      for (; a < to && s.end(a) === piece.end; a++) if (s.open(a) && a < 0) { info.openEnd = true; break; }", "ts", T_IX),
 ("b_mark_no_break", CV, "      // (Codex R158 VP-I115: every episode over a long line was asked)\n      if (best === EP_MARK_CONTACT && own) break;", "      // (Codex R158 VP-I115: every episode over a long line was asked)", "ts", T_IX),
 ("b_findkey_scan", CV, "  const places = keyPlaces(v, key);", "  for (let i = 0; i < v.n; i++) if (keyOf(v, i) === key) return i;\n  const places = keyPlaces(v, key);", "ts", T_IX),
 ("b_episodes_by_ordinal", CV, "(x, y) => E.get(x, \"pair\") - E.get(y, \"pair\") || E.get(x, \"ordinal\") - E.get(y, \"ordinal\") || x - y,", "(x, y) => E.get(x, \"ordinal\") - E.get(y, \"ordinal\") || x - y,", "ts", T_IX),
 ("b_near_matched_lost", CV, "          windows.push([cp, cp]);\n        }\n        continue;", "          void cp;\n        }\n        continue;", "ts", T_IX),
 ("b_rank_first_only", CV, "    return nextOf(g.notPossible, at, end, notPossible) < end ? EP_MARK_CONTACT : EP_MARK_POSSIBLE;", "    return nextOf(g.notPossible, at, at, notPossible) < end ? EP_MARK_CONTACT : EP_MARK_POSSIBLE;", "ts", f"{T_IX} {T_CV}"),
 ("b_wide_at_once", CU, "    for (let k = Math.max(0, predEnterX(t, a) - 1); k < t.n && t.enter[k]! <= b; k++) {\n      if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }", "    for (let k = Math.max(0, predEnterX(t, a) - 1); k < t.n && t.enter[k]! <= b; k++) {\n      if ((c.n += 4) >= STEP_OPS) { c.n = 0; }", "ts", T_U),
 ("b_boundaries_at_once", CV, "      if ((ops.n += 2) >= STEP_OPS) { ops.n = 0; yield; check(v); }\n      if ((E.get(row, \"flags\") & EP_ORIGIN_MASK) !== ORIGIN_BOUNDARY) continue;", "      if ((ops.n += 2) >= STEP_OPS) { ops.n = 0; check(v); }\n      if ((E.get(row, \"flags\") & EP_ORIGIN_MASK) !== ORIGIN_BOUNDARY) continue;", "ts", T_CV),
 ("b_free_stretch_all_points", CU, "    for (let q = k - 1; q <= k + 1; q++) d = Math.min(d, nearestSide(t, q, p));", "    for (let q = 0; q < t.n; q++) d = Math.min(d, nearestSide(t, q, p) + 0 * k);", "ts", f"{T_U} {T_IX}"),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak159")
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
