"""Step 4 package 1 mutations: each must turn the named tests red.
ts  = vue-tsc (app) must compile, then vitest on the named files.
e2e = vue-tsc, npm run build, then playwright (--no-deps, serial-viewer) -g on the named spec.
Restores from a byte copy; rebuilds once at the end when an e2e mutation ran.
`--dry` only checks that every anchor occurs exactly once."""
import os, shutil, subprocess, sys
R = "/home/cnc/lcnc-suite-stop"
W = R + "/lcnc-webui"
S = "/tmp/claude-1000/-home-cnc-lcnc-suite/b51e55ad-5023-4968-835e-f7e1362322ed/scratchpad"
C = "lcnc-webui/src/viewer/collision.ts"
SH = "lcnc-webui/src/viewer/sweepShards.ts"
SM = "lcnc-webui/src/viewer/sweepMerge.ts"
WK = "lcnc-webui/src/viewer/collisionWorker.ts"
CT = "lcnc-webui/src/viewer/clashTargets.ts"
SW = "lcnc-webui/src/viewer/sweepWords.ts"
SR = "lcnc-webui/src/viewer/simRows.ts"
SB = "lcnc-webui/src/ScrubBar.vue"
TV = "lcnc-webui/src/ThreeViewer.vue"
CC = "lcnc-webui/src/viewer/checkContext.ts"
T_COL = "src/viewer/collision.test.ts"
T_SH = "src/viewer/sweepShards.test.ts"
T_CT = "src/viewer/clashTargets.test.ts"
T_SM = "src/viewer/sweepMerge.test.ts"
T_WK = "src/viewer/collisionWorker.test.ts"
T_WORDS = "src/viewer/scrubBarWords.test.ts src/viewer/sweepWords.test.ts src/viewer/simRows.test.ts"
T_CC = "src/viewer/checkContext.test.ts"
T_WIRE = "src/viewer/checkWiring.test.ts"
SPEC = "e2e/collisions.viewer.spec.ts"
M = [
 # ---- 1a/1d data: the cap, the start in contact, the bodies ----
 ("cap_capped", C, "      ...(omitted > 0 ? { capped: omitted } : {}),\n", "      ...(omitted < 0 ? { capped: omitted } : {}),\n", "ts", T_COL),
 ("cap_onsets", C, "      ...(omittedOnsets > 0 ? { cappedOnsets: omittedOnsets } : {}),\n", "      ...(omittedOnsets < 0 ? { cappedOnsets: omittedOnsets } : {}),\n", "ts", T_COL),
 ("cap_onsets_count", C, "    const omittedOnsets = Math.max(0, onsetE.length - MAX_HITS);",
  "    const omittedOnsets = Math.max(0, onsetE.length - MAX_HITS - 1);", "ts", T_COL),
 ("shards_capped", SH, "  const capped = results.reduce((s, r) => s + (r.capped ?? 0), 0) + Math.max(0, all.length - MAX_HITS);",
  "  const capped = Math.max(0, all.length - MAX_HITS);", "ts", T_SH),
 ("shards_onsets", SH, "  const cappedOnsets = results.reduce((s, r) => s + (r.cappedOnsets ?? 0), 0) + Math.max(0, onsets.length - MAX_HITS);",
  "  const cappedOnsets = results.reduce((s, r) => s + (r.cappedOnsets ?? 0), 0);", "ts", T_SH),
 ("merge_capped", SM, "{ capped: (entry.capped ?? 0) + (base.capped ?? 0) }", "{ capped: (base.capped ?? 0) }", "ts", T_SM),
 ("merge_onsets", SM, "      ? { cappedOnsets: (entry.cappedOnsets ?? 0) + (base.cappedOnsets ?? 0) } : {}),",
  "      ? { cappedOnsets: base.cappedOnsets ?? 0 } : {}),", "ts", T_SM),
 ("atstart_off", C, "      else if (seeded[pi] && firstDist[pi]! <= CONTACT_EPS && !boundary && !inBand) rec.atStart = true;",
  "      else if (false) rec.atStart = true;", "ts", T_COL),
 ("atstart_near", C, "      else if (seeded[pi] && firstDist[pi]! <= CONTACT_EPS && !boundary && !inBand) rec.atStart = true;",
  "      else if (seeded[pi] && !boundary && !inBand) rec.atStart = true;", "ts", T_COL),
 ("merge_atstart_a", SM, "      delete shifted[bi]!.atStart;   // it began on the entry move", "      void 0;", "ts", T_SM),
 ("merge_atstart_b", SM, "    delete shifted[bi]!.atStart;     // it began on the entry move", "    void 0;", "ts", T_SM),
 ("targets_atstart", CT, "      if (h.atStart && k === 0) t.atStart = true;", "      if (h.atStart) t.atStart = true;", "ts", T_CT),
 ("words_startsin_entry", SW, "    if (t.atStart && !t.entry) startsIn = true;", "    if (t.atStart) startsIn = true;", "ts", T_WORDS),
 ("bodies_result", C, "...(bodyClass ? { bodies: bodyClass } : {})", "...(bodyClass && false ? { bodies: bodyClass } : {})", "ts", T_COL),
 ("bodies_shards", SH, "    ...(first.bodies ? { bodies: first.bodies } : {}),", "    ...({}),", "ts", T_SH),
 ("bodies_merge", SM, "    ...((base.bodies ?? entry.bodies) ? { bodies: base.bodies ?? entry.bodies } : {}),", "    ...({}),", "ts", T_SM),
 ("bodies_nopairs", WK, "pairCount: 0, bvhMs: model.bvhMs, sweepMs: 0, truncated: null, ...(bodies ? { bodies } : {}) } });",
  "pairCount: 0, bvhMs: model.bvhMs, sweepMs: 0, truncated: null, ...(bodies && false ? { bodies } : {}) } });", "ts", T_WK),
 # ---- 1b: the first confirmed contact; touches ----
 ("confirmed_touches", C, "  return !h.boundary && !h.possible && (h.dist <= CONTACT_EPS || !!h.touches);",
  "  return !h.boundary && !h.possible && h.dist <= CONTACT_EPS;", "ts", T_COL),
 ("touches_carry", C, "      if (prev?.touches) rec.touches = true;\n", "", "ts", T_COL),
 ("onset_touches", C, "      if (onsetRec && onsetRec.dist > CONTACT_EPS && !onsetRec.possible) onsetRec.touches = true;\n", "", "ts", T_COL),
 ("first_is_onset", C, "        const { pi: _pi, samples: _s, carriedFrom: _c, ...copy } = onsetRec ?? rec;",
  "        const { pi: _pi, samples: _s, carriedFrom: _c, ...copy } = rec;", "ts", T_COL),
 ("first_possible", C, "      if (!firstTouch && dist <= CONTACT_EPS && !rec.boundary && !rec.possible) {",
  "      if (!firstTouch && dist <= CONTACT_EPS && !rec.boundary) {", "ts", T_COL),
 ("pump_once", WK, "        const first = !run.firstSent ? run.snapshot.first?.() ?? null : null;",
  "        const first = run.snapshot.first?.() ?? null;", "ts", T_WK),
 ("pump_off", WK, "          self.postMessage({ id, progress: slice.progress, first });", "          void first;", "ts", T_WK),
 ("coord_once", WK, "    if (m.first && !run.firstSent) {", "    if (m.first) {", "ts", T_WK),
 ("coord_off", WK, "      self.postMessage({ id: run.id, first: m.first });", "      void m.first;", "ts", T_WK),
 ("showfirst_confirmed", TV, "  if (cur?.hits.some(confirmedContact)) return;\n", "  if (cur?.hits.some(confirmedContact) && false) return;\n", "ts", T_WIRE),
 ("showfirst_track", TV, "  const cur = collisionPartial.value && collisionPartialTrack.value === _colPendingTrack ? collisionPartial.value : null;",
  "  const cur = collisionPartial.value;", "ts", T_WIRE),
 ("showfirst_running", TV, "                                   truncated: { covered: progress ?? collisionProgress.value, reason: \"running\" } };",
  "                                   truncated: { covered: progress ?? collisionProgress.value, reason: \"samples\" } };", "ts", T_WIRE),
 ("targets_touches", CT, "      if (h.touches) t.touches = true;\n", "", "ts", T_WORDS),
 ("marks_near", SB, "near: (x.dist ?? 0) > 1e-3 && !x.touches });", "near: (x.dist ?? 0) > 1e-3 });", "ts", T_WORDS),
 ("simrows_touches", SR, "    if ((t.dist ?? 0) > 1e-3 && !t.touches) notes.push(", "    if ((t.dist ?? 0) > 1e-3) notes.push(", "ts", T_WORDS),
 # ---- 1a: the words ----
 ("words_near_touch", SW, "    const touch = (t.dist ?? 0) <= TOUCH || !!t.touches;", "    const touch = (t.dist ?? 0) <= TOUCH;", "ts", T_WORDS),
 ("words_possible", SW, "    if (t.possible) { possible++; continue; }\n", "", "ts", T_WORDS),
 ("words_entry_apart", SW, "    if (t.entryMove) entryCollisions++;", "    if (false) entryCollisions++;", "ts", T_WORDS),
 ("bar_running", SB, "    n ? `${fw.text}${running ? \" so far\" : \"\"}${startsIn}` : running ? \"No contact so far\" : none;",
  "    n ? `${fw.text}${startsIn}` : running && false ? \"No contact so far\" : none;", "ts", T_WORDS),
 ("bar_tone", SB, "  const findTone = fw.danger ? \"danger\" : \"warn\";", "  const findTone = \"danger\";", "ts", T_WORDS),
 ("bar_startsin", SB, "  const startsIn = fw.startsIn ? \" · starts in contact\" : \"\";", "  const startsIn = \"\";", "ts", T_WORDS),
 ("bar_cut", SB, "  const cut = r?.cappedOnsets ? \" · more contacts not listed\" : r?.capped ? \" · records cut\" : \"\";",
  "  const cut = r?.capped ? \" · records cut\" : \"\";", "ts", T_WORDS),
 ("detail_onsets", SB, "  if (r.cappedOnsets) parts.push(", "  if (r.cappedOnsets === -1) parts.push(", "ts", T_WORDS),
 ("detail_startpairs", SB, "h => h.atStart && !h.entry && !h.possible && (h.dist <= 1e-3 || h.touches))",
  "h => h.atStart && !h.entry && !h.possible)", "ts", T_WORDS),
 ("help_tools_ctx", SB, "  const ctx = props.collisionContext;\n  const pt = ctx\n", "  const ctx = null as typeof props.collisionContext;\n  const pt = ctx\n", "ts", T_WORDS),
 ("previous_text", TV, "  return { collisions: targets.length, text: findingWords(targets).text, complete: !prev.truncated, version };",
  "  return { collisions: targets.length, text: findingWords([]).text, complete: !prev.truncated, version };", "ts", T_WIRE),
 # ---- 1c: the card ----
 ("card_joint_order", CC, "      i.axes.forEach((l, k) => { if (ROTARY.has(l) && finite(j[k])) rotary!.push({ letter: l, deg: j[k]! }); });",
  "      i.axes.forEach((l) => { const k = CANON.indexOf(l); if (ROTARY.has(l) && finite(j[k])) rotary!.push({ letter: l, deg: j[k]! }); });",
  "ts", T_CC),
 ("card_abc_letter", CC, "      const v = ROTARY.has(l) ? i.rotaryAbc[\"ABC\".indexOf(l)] : undefined;",
  "      const v = ROTARY.has(l) ? i.rotaryAbc[i.axes.indexOf(l) - 3] : undefined;", "ts", T_CC),
 ("card_stale", CC, "    : o.stale\n", "    : false\n", "ts", T_CC),
 ("card_run_never_stale", CC, "  rows.push(run\n", "  rows.push(run && !o.stale\n", "ts", T_CC),
 ("card_assumed", CC, "    out.push({ num: n, len, diam, assumed: assumed.has(n), unknown: unknown.has(n) });",
  "    out.push({ num: n, len, diam, assumed: assumed.has(-n), unknown: unknown.has(n) });", "ts", T_CC),
 ("card_statics_once", CC, "      if (seen.has(k)) return false;\n", "", "ts", T_CC),
 ("card_g92_set_only", CC, "  const g92 = axisValues(ctx.axes, b.g92, true);", "  const g92 = axisValues(ctx.axes, b.g92, false);", "ts", T_CC),
 ("card_tool_table", CC, "    const len = row && finite(row[3]) && row[3] !== 0 ? Math.abs(row[3]) : null;",
  "    const len = row && finite(row[3]) && row[3] !== 0 ? row[3] : null;", "ts", T_CC),
 ("wire_kins_track", TV, "    kins: m?.length ? semanticKinsMode(m[0]!, init?.kins) : 0,",
  "    kins: semanticKinsMode(d?.kins_type ?? null, init?.kins),", "ts", T_WIRE),
 ("wire_switches", TV, "    kinsSwitches: !!m && m.some(t => t !== m[0]),", "    kinsSwitches: false,", "ts", T_WIRE),
 ("wire_fixture_run", TV, "    fixture: inRun ? runBasis.value?.start?.g5xIndex ?? null : d?.g5x_index ?? null,",
  "    fixture: inRun && false ? runBasis.value?.start?.g5xIndex ?? null : d?.g5x_index ?? null,", "ts", T_WIRE),
 ("wire_fromline", TV, "    fromLine: run?.range ? collisionRun.value?.fromLine ?? null : null,",
  "    fromLine: run?.range || run ? collisionRun.value?.fromLine ?? null : null,", "ts", T_WIRE),
 # ---- 1c: e2e (the viewer's plumbing) ----
 ("e2e_ctx_keepshown", TV, "  if (!run?.keepShown) collisionContext.value = _colPendingCtx;", "  collisionContext.value = _colPendingCtx;",
  "e2e", "keeps its own limits while the full check"),
 ("e2e_ctx_final", TV, "      collisionResult.value = result;\n      collisionContext.value = _colPendingCtx;\n",
  "      collisionResult.value = result;\n", "e2e", "keeps its own limits while the full check"),
 ("e2e_inputs_rev", TV, "  _colInputsRev.value++;   // the card's \"changed since\" (step 4 plan 1c)\n", "", "e2e", "check basis card"),
 ("e2e_entry", SB, "    entry: !!e && e.track === track.value && shownResult.value === e.result });", "    entry: !!e && false });",
  "e2e", "lands on its line and shows its move"),
]
dry = "--dry" in sys.argv
only = [a for a in sys.argv[1:] if not a.startswith("--")]
res = []
built_mutant = False
for name, f, old, new, kind, sel in M:
    if only and name not in only:
        continue
    path = os.path.join(R, f)
    src = open(path).read()
    if src.count(old) != 1:
        res.append((name, "ANCHOR %d" % src.count(old)))
        continue
    if dry:
        res.append((name, "ok"))
        continue
    bak = os.path.join(S, "ef", os.path.basename(f) + ".mutbakP1")
    shutil.copyfile(path, bak)
    try:
        open(path, "w").write(src.replace(old, new))
        c = subprocess.run(["npx", "vue-tsc", "--noEmit", "-p", "tsconfig.app.json"], cwd=W, capture_output=True, text=True, timeout=900)
        if c.returncode:
            res.append((name, "NOCOMPILE", (c.stdout + c.stderr).strip().splitlines()[:1]))
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
                res.append((name, "NOBUILD"))
                continue
            p = subprocess.run(["npx", "playwright", "test", "--trace", "off", "--reporter=line", "--no-deps", "-g", sel, SPEC],
                               cwd=W, capture_output=True, text=True, timeout=1500)
            out = p.stdout + p.stderr
            why = [ln.strip() for ln in out.splitlines() if "Error:" in ln or "Expected" in ln][:2]
            tail = [ln for ln in out.splitlines() if " passed" in ln or " failed" in ln][-1:]
        res.append((name, "RED" if p.returncode else "GREEN!", tail[0].strip() if tail else out[-200:], " | ".join(why)[:230]))
    finally:
        shutil.copyfile(bak, path)
if built_mutant:
    b = subprocess.run(["npm", "run", "build"], cwd=W, capture_output=True, text=True, timeout=900)
    res.append(("rebuild", "ok" if b.returncode == 0 else "FAILED"))
for r in res:
    print(*r)
