"""Round B4 after Codex R152 (VP-I112/VP-I113 rests): each mutation must turn the named tests red.
ts = vue-tsc (app) must compile, then vitest on the named files; e2e = build, then Playwright -g.
Restores from a byte copy. `--dry` only checks that every anchor occurs exactly once."""
import os, shutil, subprocess, sys, time
R = os.environ.get("MUT_ROOT", "/home/cnc/lcnc-suite-mut")
W = R + "/lcnc-webui"
S = "/tmp/claude-1000/-home-cnc-lcnc-suite/b51e55ad-5023-4968-835e-f7e1362322ed/scratchpad"
SPEC = "e2e/collisions.viewer.spec.ts"
UN = "lcnc-webui/src/viewer/contactUnion.ts"
CV = "lcnc-webui/src/viewer/contactView.ts"
SC = "lcnc-webui/src/viewer/shownContacts.ts"
RC = "lcnc-webui/src/viewer/contactsReceiver.ts"
WK = "lcnc-webui/src/viewer/collisionWorker.ts"
T_UN = "src/viewer/contactUnion.test.ts"
T_VU = "src/viewer/contactViewUnion.test.ts"
T_SC = "src/viewer/shownContacts.test.ts"
T_RC = "src/viewer/contactsReceiver.test.ts"
T_WK = "src/viewer/collisionWorker.test.ts"
T_SW = "src/viewer/contactUnionSweep.test.ts"
T_BU = "src/viewer/contactViewBudget.test.ts"
M = [
 # VP-I113 rest: never two gaps of one generation; the same gap across generations aligned
 ("s13_touching_join", UN, "    Math.max(c.s, S) < Math.min(c.e, E) || (c.s === c.e && S < c.s && c.s < E) || (S === E && c.s < S && S < c.e);",
  "    Math.max(c.s, S) <= Math.min(c.e, E) || (c.s === c.e && S < c.s && c.s < E) || (S === E && c.s < S && S < c.e);", "ts", f"{T_UN} {T_SW}"),
 ("s13_no_alignment", UN, "      if (i !== li && c && ((c.s === S && c.e === E) || overlaps(c, S, E))) take(i);",
  "      if (i !== li && c && overlaps(c, S, E)) take(i);", "ts", f"{T_UN} {T_SW}"),
 ("s13_first_zone_none", UN, "  let j = k, prev = 0;", "  let j = k, prev = -1;", "ts", T_UN),
 ("s13_walk_first_zone_none", UN, "  let prev = 0;\n  for (let k = 0; k < x.n; k++) {", "  let prev = -1;\n  for (let k = 0; k < x.n; k++) {", "ts", T_UN),
 ("s13_after_ignored", UN, "  return Math.min(zmax, Math.max(zmin, prev + (after ? 1 : 0)));", "  return Math.min(zmax, Math.max(zmin, prev + (after ? 0 : 0)));", "ts", f"{T_UN} {T_SW}"),
 ("s13_walk_prev_geometry", UN, "    else prev = endZone(seps, b);", "    else prev = sepsEnding(seps, b, true);", "ts", T_UN),
 ("s13_search_cluster", UN, "      for (let k = Math.max(0, firstEnterFrom(s, y) - 1); k < s.n && s.enter(k) <= hi; k++) {",
  "      for (let k = Math.max(0, predEnter(s, y) - 1); k < s.n && s.enter(k) <= hi; k++) {", "ts", T_UN),
 ("s13_chain_cutoff_wrong", UN, "    if (sepsEnding(seps, pa, true) + 1 <= zmin) break;", "    if (sepsEnding(seps, pa, true) <= zmin) break;", "ts", T_UN),
 ("s13_enter_zone_geometric", UN, "    if (a === s.end(idx) && seps.count) return pointZone(s, idx, seps);", "    if (a === s.end(idx) && seps.count < 0) return pointZone(s, idx, seps);", "ts", T_UN),
 # VP-I112 rest: the lean gap index, its reach, the bound
 ("s12_reach_by_end", CV, "  while (lo < hi) { const m = (lo + hi) >> 1; if (t.hReach[m]! < x) lo = m + 1; else hi = m; }",
  "  while (lo < hi) { const m = (lo + hi) >> 1; if (holeEnd(t, m) < x) lo = m + 1; else hi = m; }", "ts", T_VU),
 ("s12_reach_not_running", CV, "          hReach[k] = k > 0 && G.get(idx[k - 1]!, \"pair\") === G.get(g, \"pair\") ? Math.max(hReach[k - 1]!, end) : end;",
  "          hReach[k] = k > 0 && G.get(idx[k - 1]!, \"pair\") === G.get(g, \"pair\") ? end : end;", "ts", T_VU),
 ("s12_gaps_unsorted", CV, "        idx.sort((x, y) => G.get(x, \"pair\") - G.get(y, \"pair\") || G.get(x, \"start\") - G.get(y, \"start\") || x - y);",
  "        idx.sort((x, y) => G.get(x, \"pair\") - G.get(y, \"pair\") || x - y);", "ts", f"{T_VU} src/viewer/contactView.test.ts"),
 ("s12_ended_gap_search", CV, "    while (lo < hi) { const m = (lo + hi) >> 1; if (holeStart(t, m) < w) lo = m + 1; else hi = m; }",
  "    while (lo < hi) { const m = (lo + hi) >> 1; if (holeStart(t, m) <= w) lo = m + 1; else hi = m; }", "ts", f"{T_VU} src/viewer/contactView.test.ts {T_SW}"),
 ("s12_bound_gap_term", CV, "    add(\"gapIndex\", 12 * 2 * b.gaps);", "    add(\"gapIndex\", 4 * 2 * b.gaps);", "ts", T_BU),
 # the interval number from the group index
 ("s_ordinal_off", CV, "  return indexIn(v.tables, g, lo, hi, pack(t.src, t.shard, row, false, t.held)) - indexIn",
  "  return 1 + indexIn(v.tables, g, lo, hi, pack(t.src, t.shard, row, false, t.held)) - indexIn", "ts", f"{T_VU} src/viewer/contactView.test.ts"),
 ("s_handover_off", CV, "      const at = lo + indexIn(v.tables, g, lo, hi, pack(t.src, t.shard, first, false, true)) + nth;",
  "      const at = lo + indexIn(v.tables, g, lo, hi, pack(t.src, t.shard, first, false, true)) + nth + 1;", "ts", T_VU),
 # carried over (R151/R152), re-anchored where the code moved
 ("i14_threshold", UN, "      if (r > PROTECT) wideIn(sides, p, r, each);", "      if (r > 2 * PROTECT) wideIn(sides, p, r, each);", "ts", f"{T_UN} {T_VU}"),
 ("i13_no_seps", CV, "  if (to === lo) return { seps: NO_SEPARATORS, ev0: 0 };", "  if (to === lo || pair >= 0) return { seps: NO_SEPARATORS, ev0: 0 };", "ts", f"{T_VU} {T_SW}"),
 ("i13_held_gaps_only", CV, "  for (const held of withSeps ? [true, false] : []) {", "  for (const held of withSeps ? [true] : []) {", "ts", T_VU),
 ("i13_no_handover", CV, "  if (!m) return -1;\n  const entry = m[1]", "  if (!m || key.length > 0) return -1;\n  const entry = m[1]", "ts", T_VU),
 ("w_ranges_short", UN, "        to = k + 1;\n        // the start's holder", "        to = k;\n        // the start's holder", "ts", T_UN),
 ("w_zone_start_skips", UN, "    // the next zone starts its parts from this one's first: an interval may",
  "    for (let si = 0; si < 2; si++) { const x = xs[si]!; kz[si] = Math.max(kz[si]!, Math.min(pk[si]!, x.n) - 1, 0); }\n    // the next zone starts its parts from this one's first: an interval may", "ts", T_UN),
 ("i11_no_continuation", CV, "  if (info.joinedHere.length) info.aux = true;", "  if (info.joinedHere.length > 1e9) info.aux = true;", "ts", T_SC),
 ("i11_no_continuation_e2e", CV, "  if (info.joinedHere.length) info.aux = true;", "  if (info.joinedHere.length > 1e9) info.aux = true;", "e2e", "Codex R151 VP-I111"),
 ("u_held_not_read_e2e", SC, "                   ...(h?.stores.length ? { held: h.stores,", "                   ...(h?.stores.length && s.id < -1e9 ? { held: h.stores,", "e2e", "a sweep worker fails mid-run"),
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
    bak = os.path.join(S, "ef", os.path.basename(R) + "." + os.path.basename(f) + ".mutbakR153")
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
