"""Step 4 package 2 round B (R147 fixes) mutations: each must turn the named tests red.
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
 # ---- contactView after the R147 rewrite: the earlier rules, re-anchored ----
 ("cv_join_skip", CV, "=== ORIGIN_BOUNDARY || joined.has(ref) || (I.get(iv, \"flags\") & IV_CONTINUES_CUT)) continue;",
  "=== ORIGIN_BOUNDARY || (joined.has(ref) && ref < 0) || (I.get(iv, \"flags\") & IV_CONTINUES_CUT)) continue;", "ts", T_CV),
 ("cv_join_reach", CV, "  if (r !== undefined) { end = Math.max(end, r); open = false; }", "  if (r !== undefined) { open = false; }", "ts", T_CV),
 ("cv_continues_cut", CV, "|| joined.has(ref) || (I.get(iv, \"flags\") & IV_CONTINUES_CUT)) continue;",
  "|| joined.has(ref) || (I.get(iv, \"flags\") & IV_CONTINUES_CUT & 0)) continue;", "ts", T_CV),
 ("cv_boundary_target", CV, "      if ((E.get(ep, \"flags\") & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY || joined.has(ref)",
  "      if ((E.get(ep, \"flags\") & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY + 9 || joined.has(ref)", "ts", T_CV),
 ("cv_reentry", CV, "  if (!first) kind |= T_REENTRY;", "  if (!first && row < 0) kind |= T_REENTRY;", "ts", T_CV),
 ("cv_at_start", CV, "  if (first && (flags & EP_AT_START)) kind |= T_AT_START;", "  if ((flags & EP_AT_START)) kind |= T_AT_START;", "ts", T_CV),
 ("cv_open_end", CV, "    if (Number.isNaN(g)) { end = t.cov; open = true; }", "    if (Number.isNaN(g)) { end = t.source.at(I.get(row, \"enter\")); open = true; }", "ts", T_CV),
 ("cv_source_cov", CV, "    const cov = Math.min(source.coverage ?? coverage, coverage);", "    const cov = coverage + 0 * (source.coverage ?? 0);", "ts", T_CV),
 ("cv_entry_move", CV, "  !!source.entry && source.entryEnd !== undefined && ownCum <= source.entryEnd + ON_ENTRY_TOL;",
  "  !!source.entry && source.entryEnd !== undefined && ownCum <= source.entryEnd + ON_ENTRY_TOL + Infinity;", "ts", T_CV),
 ("cv_mark_rank", CV, "      if (best < 0 || m < best) { best = m;", "      if (best < 0 || m > best) { best = m;", "ts", T_CV),
 ("cv_mark_walk", CV, "      if (v.epBlockPre[blk]! < a) break;", "      if (v.epBlockPre[blk]! < a || i < lo - 1) break;", "ts", T_CV),
 ("cv_band_edge", CV, "          const c0 = col(x), e = Math.max(c0, Math.min(W - 1, Math.ceil((y / axisEnd) * W) - 1));",
  "          const c0 = col(x), e = col(y);", "ts", T_CV),
 ("cv_nav_sample", CV, "  for (let i = firstAfter(v, s - JUMP_NUDGE, true); i < v.n; i++) if (sampleAt(v, i) > s) return i;",
  "  for (let i = firstAfter(v, s - JUMP_NUDGE, true); i < v.n; i++) if (targetPos(v, i) > s) return i;", "ts", T_CV),
 ("cv_nav_key", CV, "    if (i >= 0) return (i + 1) % v.n;", "    if (i >= 0) return i;", "ts", T_CV),
 # ---- R147: VP-I101 .. VP-I105 ----
 ("i101_tint_tol", CV, "if (t.source.at(I.get(rows[mid]!, \"enter\")) <= pos) lo = mid + 1; else hi = mid; }\n      if (lo === 0) continue;\n      const row = rows[lo - 1]!;\n      if (ivEnd(v.reach, t, row, pack(t.src, t.shard, row)).end < pos ||",
  "if (t.source.at(I.get(rows[mid]!, \"enter\")) <= pos + 1e-3) lo = mid + 1; else hi = mid; }\n      if (lo === 0) continue;\n      const row = rows[lo - 1]!;\n      if (ivEnd(v.reach, t, row, pack(t.src, t.shard, row)).end < pos - 1e-3 ||", "ts", T_CV),
 ("i102a_point_gap_dropped", CV, "        let l = holesL.get(pair); if (!l) holesL.set(pair, l = []); l.push(a, Math.max(a, b));",
  "        if (!(b > a)) continue;\n        let l = holesL.get(pair); if (!l) holesL.set(pair, l = []); l.push(a, Math.max(a, b));", "ts", T_CV),
 ("i102a_tint_hole", CV, "end < pos || inHole(t.holes.get(pair), pos)) continue;", "end < pos || (inHole(t.holes.get(pair), pos) && pos < -1e300)) continue;", "ts", T_CV),
 ("i102a_mark_hole", CV, "      if (!freeOf(t.holes.get(E.get(row, \"pair\")), Math.max(a, s), Math.min(b, e))) continue;",
  "      if (!freeOf(t.holes.get(E.get(row, \"pair\")), Math.max(a, s), Math.min(b, e)) && row < 0) continue;", "ts", T_CV),
 ("i102b_point_piece", CV, "  if (x === y) { if (!inHole(h, x)) out.push(x, x); return; }", "  if (x === y) return;", "ts", T_CV),
 ("i103_tool_reason", CV, "        if (st.gaps.get(g, \"reason\") === GAP_TOOL_UNKNOWN) {", "        if (st.gaps.get(g, \"reason\") >= GAP_TOOL_UNKNOWN - 1) {", "ts", T_CV),
 ("i104_gap_own_cov", CV, "        const b = Number.isNaN(e0) ? cov : Math.min(source.at(e0), cov);", "        const b = Number.isNaN(e0) ? coverage : Math.min(source.at(e0), coverage);", "ts", T_CV),
 ("i104_gap_other_source", CV, "end < pos || inHole(t.holes.get(pair), pos)) continue;",
  "end < pos || v.tables.some(u => u !== undefined && inHole(u.holes.get(pair), pos))) continue;", "ts", T_CV),
 ("i105_wide_index", CV, ["        const a = Uint32Array.from(rows);", "  const tgt = new Uint32Array(n);"],
  ["        const a = Float64Array.from(rows) as unknown as Uint32Array;", "  const tgt = new Float64Array(n) as unknown as Uint32Array;"], "ts", T_CV),
 # ---- the snapshot rules of the rewrite ----
 ("cv_live_snapshot", CV, "      if (Number.isNaN(E.get(e, \"end\"))) live.set(ref, p);", "      if (Number.isNaN(E.get(e, \"end\")) && e < 0) live.set(ref, p);", "ts", T_CV),
 ("cv_end_clip", CV, "  if (!Number.isNaN(exit)) end = Math.min(t.source.at(exit), t.cov);", "  if (!Number.isNaN(exit)) end = t.source.at(exit);", "ts", T_CV),
 # ---- the line helpers ----
 ("cv_continuation", CV, "      const begins = s >= a - LINE_TOL;", "      const begins = s >= a - LINE_TOL - Infinity;", "ts", T_CV),
 ("cv_line_at_end", CV, "      if (atEnd ? t.cum[mid]! < pos : t.cum[mid]! <= pos) lo = mid + 1; else hi = mid;", "      if (atEnd ? t.cum[mid]! <= pos : t.cum[mid]! <= pos) lo = mid + 1; else hi = mid;", "ts", T_CV),
 ("cv_runs_apart", CV, "    if (k >= 0 && runLine[k] === ln) runB[k] = t.cum[i]!;", "    if (k >= 0 && runLine.includes(ln)) runB[runLine.indexOf(ln)] = t.cum[i]!;", "ts", T_CV),
 # ---- VP-I106: whose tables stay ----
 ("i106_owner_entry", RC, "  for (const id of [o.side, o.result, o.entry, o.runSide, o.sideFirst]) if (id !== null) out.add(id);",
  "  for (const id of [o.side, o.result, o.runSide, o.sideFirst]) if (id !== null) out.add(id);", "ts", T_RC),
 ("i106_owner_result", RC, "  for (const id of [o.side, o.result, o.entry, o.runSide, o.sideFirst]) if (id !== null) out.add(id);",
  "  for (const id of [o.side, o.entry, o.runSide, o.sideFirst]) if (id !== null) out.add(id);", "ts", T_RC),
 ("i106_router", TV, "          _contacts.keepOnly(_colContactOwners());", "          _contacts.keepOnly(new Set([_colReqId, ...(_colSide ? [_colSide.id] : [])]));", "e2e", "VP-I106"),
 ("i106_watch", TV, "collisionSideFirst], () => _contacts.keepOnly(_colContactOwners()));", "collisionSideFirst], () => void _colContactOwners());", "e2e", "VP-I106"),
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
    bak = os.path.join(S, "ef", os.path.basename(R) + "." + os.path.basename(f) + ".mutbakP2B3")
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
