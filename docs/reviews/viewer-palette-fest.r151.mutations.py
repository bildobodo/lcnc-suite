"""Round B4 (the fallback's union, plan 3.5; Codex R150 VP150-01/02): each mutation must turn the named tests red.
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
 # VP150-01: a confirmed point cuts the free radius back — never a neighbourhood made contact
 ("u01_radius_not_cut", UN, "      confirmedIn(t, k, f, x => { if (x === p) onSample = true; r = Math.min(r, Math.abs(x - p)); });",
  "      confirmedIn(t, k, f, x => { if (x === p) onSample = true; });", "ts", f"{T_UN} {T_VU}"),
 ("u01_on_sample_free", UN, "  if (onSample) return null;", "  if (onSample && p < -1e300) return null;", "ts", T_UN),
 ("u01_conflict_unnamed", CV, "      eachWideConflict(sides, x => { conflicts++; conflictAt = Math.min(conflictAt, source.at(x)); });",
  "      eachWideConflict(sides, x => { conflictAt = Math.min(conflictAt, source.at(x)); });", "ts", T_VU),
 # VP150-02: the earlier generation's own coverage — reported, kept, read
 ("u02_not_posted", WK, "  if (run?.stores && !run.cancelling) {\n    self.postMessage({ id: run.id, heldCoverage:",
  "  if (run?.stores && !run.cancelling && run.id < -1e9) {\n    self.postMessage({ id: run.id, heldCoverage:", "ts", T_WK),
 ("u02_side_not_posted", WK, "  if (side?.req.contacts && !side.cancelling) {", "  if (side?.req.contacts && !side.cancelling && side.req.id > 1e9) {", "ts", T_WK),
 ("u02_not_kept", RC, "      for (const t of [r?.current, r?.held]) if (t && t.generation === g) t.covered = m.heldCoverage.covered.slice();",
  "      for (const t of [r?.current, r?.held]) if (t && t.generation === g + 1) t.covered = m.heldCoverage.covered.slice();", "ts", T_RC),
 ("u02_view_ignores", CV, "        const ownCov = held ? Math.max(provenCoverage(st), source.heldCoverage?.[sh] ?? -Infinity) : own;",
  "        const ownCov = held ? provenCoverage(st) : own;", "ts", f"{T_VU} {T_SC}"),
 ("u02_spec_drops", SC, "...(h.covered ? { heldCoverage: h.covered.map(f => f * s.ownEnd) } : {})",
  "...(h.covered && s.id < -1e9 ? { heldCoverage: h.covered.map(f => f * s.ownEnd) } : {})", "ts", T_SC),
 # the union in the view
 ("u_held_not_read", SC, "                   ...(h?.stores.length ? { held: h.stores,", "                   ...(h?.stores.length && s.id < -1e9 ? { held: h.stores,", "ts", T_SC),
 ("u_held_not_read_e2e", SC, "                   ...(h?.stores.length ? { held: h.stores,", "                   ...(h?.stores.length && s.id < -1e9 ? { held: h.stores,", "e2e", "a sweep worker fails mid-run"),
 ("u_no_heir", CV, "    if (sd === 0) {\n      const w = rd(c.witness, row);", "    if (sd === 2) {\n      const w = rd(c.witness, row);", "ts", T_VU),
 ("u_key_no_generation", CV, "  return `${lead}#g${lt.st.generation}/${evKey}`;", "  return `${lead}/${evKey}`;", "ts", T_VU),
 ("u_near_unmatched", CV, "      if (h && c && h.group === c.group && h.s <= c.e && c.s <= h.e) {", "      if (h && c && h.group === c.group && h.s <= c.e && c.s <= h.e && h.s < -1e300) {", "ts", T_VU),
 ("u_no_earlier", CV, "    if (t.held) kind |= T_EARLIER;", "    if (t.held && t.src < 0) kind |= T_EARLIER;", "ts", T_VU),
 ("u_gaps_ignored", CV, "    if (freeOf(t, pair, pre[0], pre[1])) { out.add(a); out.add(b); }\n  }\n}",
  "    if (pre[0] <= pre[1]) { out.add(a); out.add(b); }\n  }\n}", "ts", T_VU),
 ("u_counts_dropped", CV, "  const c = { ...v.unionCounts };", "  const c = { ...NO_COUNTS() };", "ts", T_VU),
 ("u_group_no_origin", CV, "  return rd(t.c.epPair, ep) * 4 + (rd(t.c.epFlags, ep) & EP_ORIGIN_MASK);", "  return rd(t.c.epPair, ep) * 4 + (rd(t.c.epFlags, ep) & 0);", "ts", T_VU),
 ("u_cut_stop_no_front", UN, "      if (cut && s.enter(j) - s.front > (cut as Span).a) break;", "      if (cut && s.enter(j) > (cut as Span).a) break;", "ts", T_UN),
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
    bak = os.path.join(S, "ef", os.path.basename(R) + "." + os.path.basename(f) + ".mutbakB4")
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
