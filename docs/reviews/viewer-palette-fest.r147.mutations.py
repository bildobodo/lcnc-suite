"""Step 4 package 2 round B (B1/B2) mutations: each must turn the named tests red.
ts = vue-tsc (app) must compile, then vitest on the named files; e2e = build, then Playwright -g.
Restores from a byte copy. `--dry` only checks that every anchor occurs exactly once."""
import os, shutil, subprocess, sys, time
R = os.environ.get("MUT_ROOT", "/home/cnc/lcnc-suite-p2")
W = R + "/lcnc-webui"
S = "/tmp/claude-1000/-home-cnc-lcnc-suite/b51e55ad-5023-4968-835e-f7e1362322ed/scratchpad"
SPEC = "e2e/collisions.viewer.spec.ts"
CV = "lcnc-webui/src/viewer/contactView.ts"
RC = "lcnc-webui/src/viewer/contactsReceiver.ts"
WK = "lcnc-webui/src/viewer/collisionWorker.ts"
TV = "lcnc-webui/src/ThreeViewer.vue"
T_CV = "src/viewer/contactView.test.ts"
T_RC = "src/viewer/contactsReceiver.test.ts"
T_WK = "src/viewer/collisionWorker.test.ts"
M = [
 # ---- contactView (B1) ----
 ("cv_join_skip", CV, "if (boundary || joined.has(`${si}:${sh}:${iv}`) || (ivFlags & IV_CONTINUES_CUT)) continue;",
  "if (boundary || (joined.has(`${si}:${sh}:${iv}`) && false) || (ivFlags & IV_CONTINUES_CUT)) continue;", "ts", T_CV),
 ("cv_join_reach", CV, "          if (r !== undefined) end = Math.max(end, r);", "          if (r !== undefined) end = Math.max(end, end + 0 * r);", "ts", T_CV),
 ("cv_continues_cut", CV, "if (boundary || joined.has(`${si}:${sh}:${iv}`) || (ivFlags & IV_CONTINUES_CUT)) continue;",
  "if (boundary || joined.has(`${si}:${sh}:${iv}`) || ((ivFlags & IV_CONTINUES_CUT) && false)) continue;", "ts", T_CV),
 ("cv_boundary_target", CV, "if (boundary || joined.has(`${si}:${sh}:${iv}`) || (ivFlags & IV_CONTINUES_CUT)) continue;",
  "if ((boundary && false) || joined.has(`${si}:${sh}:${iv}`) || (ivFlags & IV_CONTINUES_CUT)) continue;", "ts", T_CV),
 ("cv_reentry", CV, "          if (k > 0) kind |= T_REENTRY;", "          if (k > 99) kind |= T_REENTRY;", "ts", T_CV),
 ("cv_at_start", CV, "          if (k === 0 && (flags & EP_AT_START)) kind |= T_AT_START;", "          if ((flags & EP_AT_START)) kind |= T_AT_START;", "ts", T_CV),
 ("cv_open_end", CV, "          let end = ie.open ? cov : clipS(source.at(ie.end));", "          let end = ie.open ? enter : clipS(source.at(ie.end));", "ts", T_CV),
 ("cv_source_cov", CV, "    const cov = Math.min(source.coverage ?? coverage, coverage);", "    const cov = coverage + 0 * (source.coverage ?? 0);", "ts", T_CV),
 ("cv_entry_move", CV, "if (source.entry) { kind |= T_ENTRY; if (source.entryEnd !== undefined && enter < source.entryEnd) kind |= T_ENTRY_MOVE; }",
  "if (source.entry) { kind |= T_ENTRY; if (source.entryEnd !== undefined) kind |= T_ENTRY_MOVE; }", "ts", T_CV),
 ("cv_gap_touch", CV, "  for (const [pair, spans] of touch) tmap.set(pair, Float64Array.from(cut(unite(spans), holes.get(pair) ?? [])));",
  "  for (const [pair, spans] of touch) tmap.set(pair, Float64Array.from(cut(unite(spans), [])));", "ts", T_CV),
 ("cv_gap_episode", CV, "    const sp = cut([ep.s, Math.max(ep.s, ep.e)], holes.get(ep.pair) ?? []);", "    const sp = cut([ep.s, Math.max(ep.s, ep.e)], []);", "ts", T_CV),
 ("cv_ended_at_gap", CV, "  if (st.intervals.get(iv, \"flags\") & IV_ENDED_AT_GAP) {", "  if (st.intervals.get(iv, \"flags\") & IV_ENDED_AT_GAP & 0) {", "ts", T_CV),
 ("cv_mark_rank", CV, "      if (best < 0 || m < best) best = m;", "      if (best < 0 || m > best) best = m;", "ts", T_CV),
 ("cv_mark_walk", CV, "    for (let i = lo - 1; i >= 0 && v.epMax[i]! >= a; i--) {", "    for (let i = lo - 1; i >= lo - 1 && i >= 0 && v.epMax[i]! >= a; i--) {", "ts", T_CV),
 ("cv_band_edge", CV, "      const c0 = col(a), e = Math.max(c0, Math.min(W - 1, Math.ceil((b / axisEnd) * W) - 1));",
  "      const c0 = col(a), e = col(b);", "ts", T_CV),
 ("cv_nav_sample", CV, "  for (let i = lo; i < v.n; i++) if (sampleAt(v, i) > s) return i;", "  for (let i = lo; i < v.n; i++) if (v.pos[i]! > s) return i;", "ts", T_CV),
 ("cv_nav_key", CV, "    if (i >= 0) return (i + 1) % v.n;", "    if (i >= 0) return i;", "ts", T_CV),
 # ---- the receiver (B2) ----
 ("rc_drop_old", RC, "    if (r.current && g < r.current.generation) {", "    if (r.current && g < r.current.generation && g < -1) {", "ts", T_RC),
 ("rc_held", RC, "      if (r.current) r.held = r.current;", "      if (r.current) r.held = null;", "ts", T_RC),
 ("rc_ack_gen", RC, "      return { contactsAck: m.id, generation: g };\n    }", "      return { contactsAck: m.id, generation: r.current.generation };\n    }", "ts", T_RC),
 ("rc_pairs", RC, "    if (m.contactPairs) cur.pairs = m.contactPairs;", "    if (m.contactPairs && m.contactPairs.length < 0) cur.pairs = m.contactPairs;", "ts", T_RC),
 ("rc_refused", RC, "      if (!ok) this.dropped++;", "      if (!ok) this.dropped += 0;", "ts", T_RC),
 # ---- the pair names (B2) ----
 ("wk_pairs_once", WK, "  run.pairsSent = true;\n  self.postMessage({ id: run.id, contacts,", "  run.pairsSent = false;\n  self.postMessage({ id: run.id, contacts,", "ts", T_WK),
 ("wk_coord_pairs", WK, "    if (m.contactPairs && !run.pairs) run.pairs = m.contactPairs;", "    if (m.contactPairs && !run.pairs && run.k < 0) run.pairs = m.contactPairs;", "ts", T_WK),
 # ---- the page (B2) ----
 ("tv_ack", TV, "          if (ack) { _colWorker!.postMessage(ack); _contactsLog.acks++; }", "          if (ack) { void ack; }",
  "e2e", "contact tables reach the page"),
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
    if only and name not in only:
        continue
    if os.environ.get("MUT_KIND") and kind != os.environ["MUT_KIND"]:
        continue
    path = os.path.join(R, f)
    src = open(path).read()
    if src.count(old) != 1:
        add((name, "ANCHOR %d" % src.count(old)))
        continue
    if dry:
        add((name, "ok"))
        continue
    bak = os.path.join(S, "ef", os.path.basename(R) + "." + os.path.basename(f) + ".mutbakP2B")
    shutil.copyfile(path, bak)
    try:
        open(path, "w").write(src.replace(old, new))
        c = subprocess.run(["npx", "vue-tsc", "--noEmit", "-p", "tsconfig.app.json"], cwd=W, capture_output=True, text=True, timeout=900)
        if c.returncode:
            add((name, "NOCOMPILE", (c.stdout + c.stderr).strip().splitlines()[:1]))
            continue
        if kind == "ts":
            p = subprocess.run(["npx", "vitest", "run", "--reporter=dot", *sel.split()], cwd=W, capture_output=True, text=True, timeout=900)
            out = p.stdout + p.stderr
            why = [ln.strip() for ln in out.splitlines() if "AssertionError" in ln or ln.strip().startswith("FAIL")][:2]
            tail = [ln for ln in out.splitlines() if "Tests " in ln][-1:]
        else:
            b = subprocess.run(["npm", "run", "build"], cwd=W, capture_output=True, text=True, timeout=900)
            built_mutant = True
            if b.returncode:
                add((name, "NOBUILD"))
                continue
            spec, pat = sel.split("::") if "::" in sel else (SPEC, sel)
            p = subprocess.run(["npx", "playwright", "test", "--trace", "off", "--reporter=line", "--no-deps", "-g", pat, spec],
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
