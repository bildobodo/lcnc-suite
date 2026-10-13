"""Step 4 package 2 round B (R148 rests and B3) mutations: each must turn the named tests red.
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
 # ---- R148 rests in contactView v3 ----
 ("r102_cut_after_map", CV, "  return !!pre && freeOf(t, t.st.episodes.get(I.get(row, \"episode\"), \"pair\"), pre[0], pre[1]);",
  "  const pair = t.st.episodes.get(I.get(row, \"episode\"), \"pair\");\n  const [hf, ht] = holeRange(t, pair);\n  for (let k = hf; k < ht; k++) if (t.source.at(t.hSpan[2 * k]!) <= pos && pos <= t.source.at(t.hSpan[2 * k + 1]!)) return false;\n  return !!pre;", "ts", T_CV),
 ("r104_reach_in_bands", CV, "      const x = t.source.at(pieces[i]!), y = Math.min(t.source.at(pieces[i + 1]!), t.cov);",
  "      const x = t.source.at(pieces[i]!), y = Math.max(Math.min(t.source.at(pieces[i + 1]!), t.cov), reachOf(v, ref) ?? -Infinity);", "ts", T_CV),
 ("r104_reach_in_tint", CV, ["    if (contactAt(t, row, pos)) { out.add(a); out.add(b); }", "      } else { tRefs[ti] = ref; tPos[ti] = p; tEnd[ti++] = e; }"],
  ["    if (contactAt(t, row, pos) || ((reachOf(v, ref) ?? -Infinity) >= pos && t.source.at(t.st.intervals.get(row, \"enter\")) <= pos)) { out.add(a); out.add(b); }",
   "      } else { const rk = findSorted(reachRef, ref); tRefs[ti] = ref; tPos[ti] = p; tEnd[ti++] = rk < 0 ? e : Math.max(e, reachVal[rk]!); }"], "ts", T_CV),
 ("r105_wide_lists", CV, "  const out = new Uint32Array(n);", "  const out = new Float64Array(n) as unknown as Uint32Array;", "ts", T_CV),
 ("r107_no_check", CV, "    if (t && t.st.revision !== t.revision) {", "    if (t && t.st.revision !== t.revision && t.revision < 0) {", "ts", T_CV),
 ("r107_set_no_revision", "lcnc-webui/src/viewer/contactStore.ts", "    this.col(name)[b]![o] = value;\n    this.revision++;", "    this.col(name)[b]![o] = value;", "ts", T_CV),
 ("r107_apply_at_once", TV, "          _pendingContacts.push({ id: m.id, contacts: m.contacts, ...(m.contactPairs ? { contactPairs: m.contactPairs } : {}) });",
  "          { const ack = _contacts.apply(m); if (ack) _colWorker!.postMessage(ack); }", "e2e", "e2e/collisions.viewer.spec.ts::contact tables reach the page|tint and the band"),
 ("r106_cancel_keeps", TV, "  _colReqId++;\n  _colReleaseContacts();", "  _colReqId++;", "ts", "src/viewer/checkWiring.test.ts"),
 # ---- B3: the views on the tables ----
 ("b3_result_req", TV, "      const run0 = collisionRun.value;\n      _colResultReq = m.id;", "      const run0 = collisionRun.value;\n      _colResultReq = -999;", "e2e", "e2e/collisions.viewer.spec.ts::a collision jump on the real XYZAC model"),
 ("b3_entry_shift", TV, "  return { base: { ...b, map: { kind: \"plus\", shift: ent.shift }, coverage: b.coverage + ent.shift },",
  "  return { base: { ...b, map: { kind: \"plus\", shift: 0 }, coverage: b.coverage + ent.shift },", "e2e", "e2e/collisions.viewer.spec.ts::stay apart"),
 ("b3_entry_no_join", TV, "  const ent = e ? { id: e.id, track: e.track, base: e.base, shift: e.shift, sliceEnd: e.sliceEnd, done: true }",
  "  const ent = e ? { id: e.id, track: e.track, base: e.base, shift: e.shift, sliceEnd: e.sliceEnd, done: false }", "e2e", "e2e/collisions.viewer.spec.ts::stay apart"),
 ("b3_own_track_dropped", "lcnc-webui/src/viewer/shownContacts.ts", "                   ...(s.track ? { ownTrack: ownTrackOf(s.track) } : {}),",
  "                   ...(s.track && s.id < -1e9 ? { ownTrack: ownTrackOf(s.track) } : {}),", "ts", "src/viewer/shownContacts.test.ts"),
 ("b3_runside_lines", TV, "             entry: true, entryEnd: rs.bound.cum[1], done: true, track: rs.bound };",
  "             entry: true, entryEnd: rs.bound.cum[1], done: true };", "e2e", "e2e/collisions.viewer.spec.ts::bound beginning: its contact reaches the list"),
 ("b3_no_bands", "lcnc-webui/src/ScrubBar.vue", "  return contactBands(sv.view, bandCols.value, max).map(([a, b]) => [a * 100, b * 100] as [number, number]);",
  "  return contactBands(sv.view, bandCols.value, max).map(([a, b]) => [a * 100, b * 100] as [number, number]).slice(0, 0);", "e2e", "e2e/collisions.viewer.spec.ts::tint and the band"),
 ("b3_no_tint", TV, "  const want = sv && cum != null ? tintAt(sv.view, cum) : new Set<string>();",
  "  const want = sv && cum != null && cum < -1e300 ? tintAt(sv.view, cum) : new Set<string>();", "e2e", "e2e/collisions.viewer.spec.ts::tint and the band"),
 ("b3_no_code_marks", "lcnc-webui/src/GcodePanel.vue", "    if (!seen.has(line)) seen.set(line, q(line));", "    if (!seen.has(line)) seen.set(line, line < 0 ? q(line) : null);",
  "e2e", "e2e/layout.spec.ts::names its findings with a glyph"),
 ("b3_near_class", "lcnc-webui/src/viewer/clashTargets.ts", "  t.near ?? ((t.dist ?? 0) > 1e-3 && !t.touches);", "  ((t.dist ?? 0) > 1e-3 && !t.touches);", "ts", "src/viewer/scrubBarWords.test.ts"),
 ("b3_line_at_start", CV, "      if (atEnd ? t.cum[mid]! < pos : t.cum[mid]! <= pos) lo = mid + 1; else hi = mid;",
  "      if (atEnd ? t.cum[mid]! < pos : t.cum[mid]! < pos) lo = mid + 1; else hi = mid;", "ts", T_CV),
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
    olds, news = (old, new) if isinstance(old, list) else ([old], [new])
    bad = [src.count(o) for o in olds if src.count(o) != 1]
    if bad:
        add((name, "ANCHOR %s" % bad))
        continue
    if dry:
        add((name, "ok"))
        continue
    bak = os.path.join(S, "ef", os.path.basename(R) + "." + os.path.basename(f) + ".mutbakP2B5")
    shutil.copyfile(path, bak)
    try:
        mutated = src
        for o, nw in zip(olds, news): mutated = mutated.replace(o, nw)
        open(path, "w").write(mutated)
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
