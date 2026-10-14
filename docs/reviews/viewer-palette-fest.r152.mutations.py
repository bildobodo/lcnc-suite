"""Round B4 after Codex R151 (VP-I111..VP-I114, the walk per group): each mutation must turn the named tests red.
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
M = [
 # VP-I114: a contradiction is possible as soon as the radius exceeds the tolerance — in both places
 ("i14_threshold", UN, "      if (r > PROTECT) wideIn(sides, p, r, each);", "      if (r > 2 * PROTECT) wideIn(sides, p, r, each);", "ts", f"{T_UN} {T_VU}"),
 ("i14_walk_threshold", UN, "    if (conflict && r0 > PROTECT && r < r0) wideX(xs, p, r0, conflict);",
  "    if (conflict && r0 > 2 * PROTECT && r < r0) wideX(xs, p, r0, conflict);", "ts", f"{T_UN} {T_VU}"),
 ("i14_walk_one_sided", UN, "if (x > a && x < b && x - a > PROTECT && b - x > PROTECT) each(x);", "if (x > a && x < b && x - a > PROTECT) each(x);", "ts", T_UN),
 # VP-I113: a tool gap separates events
 ("i13_no_seps", CV, "  if (lo >= u.sPairs.length || u.sPairs[lo] !== pair) return { seps: NO_SEPS, ev0: 0 };",
  "  if (pair >= 0 || lo >= u.sPairs.length || u.sPairs[lo] !== pair) return { seps: NO_SEPS, ev0: 0 };", "ts", T_VU),
 ("i13_held_gaps_only", CV, "  for (const held of [true, false]) {", "  for (const held of [true]) {", "ts", T_VU),
 ("i13_undecidable_separates", CV, "          if (t.hReason[g] !== GAP_TOOL_UNKNOWN) continue;", "          if (t.hReason[g]! > 1e9) continue;", "ts", T_VU),
 ("i13_sep_index", CV, "if (g.seps[2 * m + 1]! < end) lo = m + 1; else hi = m; }", "if (g.seps[2 * m + 1]! <= end) lo = m + 1; else hi = m; }", "ts", T_VU),
 ("i13_point_part_kept", UN, "    if (z > 0 && A === lo && (a < lo || (a === b && pointSep(seps, z - 1) && !after))) return null;",
  "    if (z > 0 && A === lo && (a === b && pointSep(seps, z - 1) && !after)) return null;", "ts", f"{T_UN} {T_VU}"),
 ("i13_after_flag", UN, "    if (z > 0 && A === lo && (a < lo || (a === b && pointSep(seps, z - 1) && !after))) return null;",
  "    if (z > 0 && A === lo && (a < lo || (a === b && pointSep(seps, z - 1) && after))) return null;", "ts", T_UN),
 ("i13_no_handover", CV, "  if (!m) return -1;\n  const entry = m[1]", "  if (!m || key.length > 0) return -1;\n  const entry = m[1]", "ts", T_VU),
 # the walk against the search and the brute force
 ("w_ranges_short", UN, "        to = k + 1;\n        // the start's holder", "        to = k;\n        // the start's holder", "ts", T_UN),
 ("w_absorb_touching", UN, "        if (n0 && n0.a <= cb) { if (n0.b > cb) cb = n0.b; adv(0); continue; }",
  "        if (n0 && n0.a < cb) { if (n0.b > cb) cb = n0.b; adv(0); continue; }", "ts", T_UN),
 ("w_free_merge_open", UN, "      if (a < lb || (a === lb && !(ao && lbo))) {", "      if (a < lb || (a === lb && (lbo || !lbo))) {", "ts", T_UN),
 ("w_no_cut_back", UN, "      for (let q = k - 1; q <= k + 1; q++) r = Math.min(r, nearestIn(t, q, p));", "      for (let q = k - 1; q <= k + 1; q++) r = Math.min(r, r + 0 * nearestIn(t, q, p));", "ts", T_UN),
 ("w_zone_start_skips", UN, "    // the next zone starts its parts from this one's first: an interval may",
  "    for (let si = 0; si < 2; si++) { const x = xs[si]!; kz[si] = Math.max(kz[si]!, Math.min(pk[si]!, x.n) - 1, 0); }\n    // the next zone starts its parts from this one's first: an interval may", "ts", T_UN),
 ("w_search_no_cut_back", UN, "  eachConfirmedIn(sides, f, x => { if (x === p) onSample = true; r = Math.min(r, Math.abs(x - p)); });",
  "  eachConfirmedIn(sides, f, x => { if (x === p) onSample = true; });", "ts", f"{T_UN} {T_VU}"),
 ("w_reflist_never_sorts", CV, "if (before(i - 1, i) > 0) sorted = false;", "if (before(i - 1, i) > 1e300) sorted = false;", "ts", f"{T_VU} src/viewer/contactView.test.ts"),
 # VP-I111: an entry contact the base continues, in every generation of either side
 ("i11_held_not_joined", SC, "      if (h?.stores.length) out.push({ stores: h.stores, held: true,", "      if (h?.stores.length && p.s.id < -1e9) out.push({ stores: h.stores, held: true,", "ts", T_SC),
 ("i11_held_side_whole", SC, "whole: !!h.covered?.length && h.covered.every(f => f >= 1) });", "whole: true });", "ts", T_SC),
 ("i11_no_continuation", CV, "  if (info.joinedHere.length) info.aux = true;", "  if (info.joinedHere.length > 1e9) info.aux = true;", "ts", T_SC),
 ("i11_no_continuation_e2e", CV, "  if (info.joinedHere.length) info.aux = true;", "  if (info.joinedHere.length > 1e9) info.aux = true;", "e2e", "Codex R151 VP-I111"),
 ("i11_reach_last_piece", CV, "        for (const r of info.joinedHere) baseEnd.set(r, e);", "        for (const r of info.rows) if (findSorted(joined, r) >= 0) baseEnd.set(r, e);", "ts", T_SC),
 ("i11_held_bit_dropped", CV, "pack(j.baseSrc, j.baseShard, biv, false, !!j.baseHeld)))).sort();", "pack(j.baseSrc, j.baseShard, biv, false, false)))).sort();", "ts", T_SC),
 # carried over from R151 (the union itself)
 ("u_held_not_read", SC, "                   ...(h?.stores.length ? { held: h.stores,", "                   ...(h?.stores.length && s.id < -1e9 ? { held: h.stores,", "ts", T_SC),
 ("u_held_not_read_e2e", SC, "                   ...(h?.stores.length ? { held: h.stores,", "                   ...(h?.stores.length && s.id < -1e9 ? { held: h.stores,", "e2e", "a sweep worker fails mid-run"),
 ("u_no_heir", CV, "    if (sd === 0) {\n      const w = rd(c.witness, row);", "    if (sd === 2) {\n      const w = rd(c.witness, row);", "ts", T_VU),
 ("u_near_unmatched", CV, "      if (h && c && h.group === c.group && h.s <= c.e && c.s <= h.e) {", "      if (h && c && h.group === c.group && h.s <= c.e && c.s <= h.e && h.s < -1e300) {", "ts", T_VU),
 ("u_gaps_ignored", CV, "    if (freeOf(t, pair, pre[0], pre[1])) { out.add(a); out.add(b); }\n  }\n}",
  "    if (pre[0] <= pre[1]) { out.add(a); out.add(b); }\n  }\n}", "ts", T_VU),
 ("u_group_no_origin", CV, "  return rd(t.c.epPair, ep) * 4 + (rd(t.c.epFlags, ep) & EP_ORIGIN_MASK);", "  return rd(t.c.epPair, ep) * 4 + (rd(t.c.epFlags, ep) & 0);", "ts", T_VU),
 ("u02_view_ignores", CV, "        const ownCov = held ? Math.max(provenCoverage(st), source.heldCoverage?.[sh] ?? -Infinity) : own;",
  "        const ownCov = held ? provenCoverage(st) : own;", "ts", f"{T_VU} {T_SC}"),
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
    bak = os.path.join(S, "ef", os.path.basename(R) + "." + os.path.basename(f) + ".mutbakR152")
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
