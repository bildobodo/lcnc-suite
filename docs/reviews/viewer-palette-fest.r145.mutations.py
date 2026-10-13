"""Step 4 package 2 round A mutations: each must turn the named tests red.
ts = vue-tsc (app) must compile, then vitest on the named files.
Restores from a byte copy. `--dry` only checks that every anchor occurs exactly once."""
import os, shutil, subprocess, sys, time
R = os.environ.get("MUT_ROOT", "/home/cnc/lcnc-suite-p2")
W = R + "/lcnc-webui"
S = "/tmp/claude-1000/-home-cnc-lcnc-suite/b51e55ad-5023-4968-835e-f7e1362322ed/scratchpad"
SPEC = "e2e/collisions.viewer.spec.ts"
CS = "lcnc-webui/src/viewer/contactStore.ts"
C = "lcnc-webui/src/viewer/collision.ts"
WK = "lcnc-webui/src/viewer/collisionWorker.ts"
MG = "lcnc-webui/src/viewer/contactMerge.ts"
T_CS = "src/viewer/contactStore.test.ts"
T_WK = "src/viewer/collisionWorker.test.ts"
T_MG = "src/viewer/contactMerge.test.ts"
T_CC = "src/viewer/collisionContacts.test.ts"
T_C = "src/viewer/collision.test.ts"
T_IN = "src/viewer/collisionInside.test.ts"
T_SP = "src/viewer/collisionSpeed.test.ts"
T_WIN = "src/viewer/collisionWindows.test.ts"
T_SH = "src/viewer/sweepShards.test.ts"
SH = "lcnc-webui/src/viewer/sweepShards.ts"
T_SH_UNIT = "src/viewer/sweepShards.test.ts -t mergeShardResults"
M = [
 # ---- the store (A1) ----
 ("cs_dirty_once", CS, "    if (row < this.sent && !this.dirtyBlocks[b]![o]) {", "    if (row < this.sent) {", "ts", T_CS),
 ("cs_one_in_flight", CS, "    if (this.inFlight) return null;", "    if (this.inFlight && false) return null;", "ts", T_CS),
 ("cs_generation", CS, "    if (d.request !== this.request || d.generation !== this.generation) return false;", "    if (d.request !== this.request) return false;", "ts", T_CS + " " + T_WK),
 ("cs_order", CS, "    if (d.from !== this.rows) throw new Error(", "    if (d.from !== this.rows && false) throw new Error(", "ts", T_CS),
 ("cs_f32_inward", CS, "  if (f <= r) return f;", "  if (f !== r || f <= r) return f;", "ts", T_CS),
 ("cs_forward_set", CS, "      for (const [name] of this.schema) this.set(r, name, d.updated[name]![i]!);",
  "      for (const [name] of this.schema) this.col(name)[Math.floor(r / BLOCK)]![r % BLOCK] = d.updated[name]![i]!;", "ts", T_CS),
 # ---- the sink (A2) ----
 ("sink_free_undecided", C, "        const freeDecided = !undecidable && !inBand && d > CONTACT_EPS;", "        const freeDecided = !inBand && d > CONTACT_EPS;", "ts", T_IN),
 ("sink_witness", C, "                                              witness: T(s), freeAt: NaN, freeR: 0 }, enter.at);",
  "                                              witness: T(s) + 1, freeAt: NaN, freeR: 0 }, enter.at);", "ts", T_CC),
 ("sink_radius_v", C, "        r = Math.min(V > 0 ? (d - CONTACT_EPS) / V : Infinity, s - chunkLo, chunkHi - s);",
  "        r = Math.min(V > 0 ? (d - CONTACT_EPS) / (V * 0.05) : Infinity, s - chunkLo, chunkHi - s);", "ts", T_CC),
 ("sink_radius_chunk", C, "        r = Math.min(V > 0 ? (d - CONTACT_EPS) / V : Infinity, s - chunkLo, chunkHi - s);",
  "        r = V > 0 ? (d - CONTACT_EPS) / V : Infinity;", "ts", T_CC + " " + T_WIN),
 ("sink_tool_floor", C, "rangeStart, toolFloor[pi]!, cutFrom);", "rangeStart, cutFrom);", "ts", T_C),
 ("sink_tool_ended", C, '            if (iv >= 0) store.intervals.set(iv, "flags", store.intervals.get(iv, "flags") | IV_ENDED_AT_GAP);',
  '            if (iv >= 0) store.intervals.set(iv, "flags", store.intervals.get(iv, "flags") | (IV_ENDED_AT_GAP & 0));', "ts", T_C),
 ("sink_after_tool", C, "| (afterTool[pi] ? IV_AFTER_UNKNOWN_TOOL : 0)", "| (afterTool[pi] && false ? IV_AFTER_UNKNOWN_TOOL : 0)", "ts", T_C),
 ("sink_cut_feed_begun", C, "            if (cutting && (!isRapid || boundary)) cutMute[pi] = 1;", "            if (cutting && boundary) cutMute[pi] = 1;", "ts", T_C),
 ("sink_cut_feed_part", C, "        if (ep >= 0 && touch && cutting && !isRapid) {", "        if (ep >= 0 && touch && cutting && !isRapid && false) {", "ts", T_C),
 ("sink_band_possible", C, "            const flags = (inBand ? IV_POSSIBLE : 0)", "            const flags = (inBand && false ? IV_POSSIBLE : 0)", "ts", T_C),
 ("sink_finish_close", C, '            if (d > CONTACT_EPS && v === "outside") closeInterval(pi, s, d);',
  '            if (d > CONTACT_EPS && v === "outside" && false) closeInterval(pi, s, d);', "ts", T_CC),
 ("sink_pose_restore", C, "          if (sink?.moved) { sink.moved = false; interpPose(i, (s - c0) / L); }",
  "          if (sink?.moved) { sink.moved = false; }", "ts", T_CC),
 ("sink_budget_stop", C, "        if (sink?.full) {", "        if (sink?.full && sink.failAt < 0) {", "ts", T_CC),
 ("sh_entry_unbisected", C, "            } else enter = bisect(s, floor, pi);", "            } else enter = { at: s, decided: true };", "ts", T_SH),
 ("sink_tool_gap_all", C, "          if (!pairTool[pi]) continue;\n          if (epRow[pi]! >= 0) {",
  "          if (!pairTool[pi] || epRow[pi]! < 0) continue;\n          if (epRow[pi]! >= 0) {", "ts", T_C),
 ("sink_tool_cut_reset", C, "          cutMute[pi] = 0; cutPart[pi] = 0; cutFeedAt[pi] = NaN;\n          toolGap[pi] = add(", "          toolGap[pi] = add(", "ts", T_C),
 ("sink_cut_floor", C, "const cutFrom = cutPart[pi] && !Number.isNaN(cutFeedAt[pi]!) ? rapidStartAfter",
  "const cutFrom = cutPart[pi] && !Number.isNaN(cutFeedAt[pi]!) && false ? rapidStartAfter", "ts", T_C),
 ("sink_cut_boundary", C, "      while (seg < n - 1 && track.rapid[seg] === 1 && dcum[seg]! <= x + 1e-9) seg++;\n", "", "ts", T_C),
 ("sink_fail_at", C, "if (r < 0) { api.full = true; api.failAt = Math.min(api.failAt, at); }",
  "if (r < 0) { api.full = true; api.failAt = Math.min(api.failAt, Infinity + 0 * at); }", "ts", T_C),
 ("sink_fail_all", C, "      sample(pi: number, s: number, isRapid: boolean, d: number, inBand: boolean, undecidable: boolean) {\n",
  "      sample(pi: number, s: number, isRapid: boolean, d: number, inBand: boolean, undecidable: boolean) {\n        if (api.full) return;\n", "ts", T_C),
 ("sink_break_jump", C, "      if (from < breakAt && s > breakAt) {", "      if (from < breakAt && s > breakAt && false) {", "ts", T_IN),
 ("sink_break_side", C, "      if (from < breakAt && s > breakAt) {", "      if (from < breakAt) {", "ts", T_C),
 ("sink_floor_side", C, "            const jump = s >= breakAt ? breakAt : prevBreakAt;", "            const jump = s >= breakAt ? breakAt : breakAt + 0 * prevBreakAt;", "ts", T_C),
 # ---- transport (A6) ----
 ("wk_final_waits", WK, "        else run.final = { result: slice.result };", "        else self.postMessage({ id, result: slice.result });", "ts", T_WK),
 ("wk_coord_ack", WK, "    _shards[k]!.postMessage({ contactsAck: run.id, generation: run.stores[k]!.generation });", "    void k;", "ts", T_WK),
 ("wk_coord_ack_gen", WK, "    _shards[k]!.postMessage({ contactsAck: run.id, generation: run.stores[k]!.generation });", "    _shards[k]!.postMessage({ contactsAck: run.id, generation: -1 });", "ts", T_WK),
 ("wk_owner_waiting", WK, "  if (!run.stores || run.ownerWaiting) return false;", "  if (!run.stores) return false;", "ts", T_WK),
 ("wk_generation", WK, "  req.contacts ? { ...req, contacts: { ...req.contacts, generation: req.contacts.generation + 1 } } : req;", "  req;", "ts", T_WK),
 ("wk_pool_final_waits", WK, "        if (run.stores) { if (!forwardContacts(run, { result: merged })) run.finalMsg = { result: merged }; }",
  "        if (run.stores) { if (!forwardContacts(run, { result: merged })) self.postMessage({ id: run.id, result: merged }); }", "ts", T_WK),
 ("wk_local_gen", WK, "    if (!run?.store || run.store.generation !== d.generation) return;", "    if (!run?.store) return;", "ts", T_WK),
 ("wk_pool_ack_gen", WK, "      if (_poolRun.stores[0]!.generation === d.generation) onPoolAck(_poolRun);", "      onPoolAck(_poolRun);", "ts", T_WK),
 ("wk_drain_ack_gen", WK, "    } else if (_drain && _drain.id === d.contactsAck && _drain.generation === d.generation) {",
  "    } else if (_drain && _drain.id === d.contactsAck) {", "ts", T_WK),
 ("wk_drain", WK, "  if (run?.stores && !run.cancelling && (run.ownerWaiting", "  if (run?.stores && !run.cancelling && run.k < 0 && (run.ownerWaiting", "ts", T_WK),
 ("wk_drain_final", WK, "stores: run.stores, ownerWaiting: run.ownerWaiting, finalMsg: run.finalMsg };", "stores: run.stores, ownerWaiting: run.ownerWaiting, finalMsg: null };", "ts", T_WK),
 ("wk_side_gen", WK, "    else handleLocal(onThisCore(nextGeneration(side.req)));", "    else handleLocal(onThisCore(side.req));", "ts", T_WK),
 # ---- merges (A5) ----
 ("mg_one_to_one", MG, "    out.set(first, cands.shift()!);", "    out.set(first, cands[0]!);", "ts", T_MG),
 ("mg_at_start", MG, '    if (first === NONE || BI.get(first, "enter") > atStart) continue;', '    if (first === NONE || BI.get(first, "enter") > atStart + 1) continue;', "ts", T_MG),
 ("mg_entry_open", MG, '    if (!Number.isNaN(EI.get(iv, "exit")) || (EI.get(iv, "flags") & IV_ENDED_AT_GAP)) continue;', '    if ((EI.get(iv, "flags") & IV_ENDED_AT_GAP)) continue;', "ts", T_MG),
 ("mg_entry_gap", MG, '    if (!Number.isNaN(EI.get(iv, "exit")) || (EI.get(iv, "flags") & IV_ENDED_AT_GAP)) continue;', '    if (!Number.isNaN(EI.get(iv, "exit")) || ((EI.get(iv, "flags") & IV_ENDED_AT_GAP) && false)) continue;', "ts", T_MG),
 ("sh_merge_min", SH, "  const from = results.reduce((m, r) => (r.incompleteFrom === undefined ? m : Math.min(m, r.incompleteFrom)), Infinity);",
  "  const from = results.reduce((m, r) => (r.incompleteFrom === undefined ? m : r.incompleteFrom), Infinity);", "ts", T_SH_UNIT),
 # ---- the speed bound held directly (A7) ----
 ("v_no_radius", C, "    return Math.sqrt(Math.max(0, _leverV.lengthSq() - along * along)) + body.radius;",
  "    return Math.sqrt(Math.max(0, _leverV.lengthSq() - along * along)) + body.radius * 0;", "ts", T_SP),
 ("v_bulge_zero", C, "          if (!pd.dof.rotate) trans += jointSpeedBound(dJ, jointBulge[pd.dof.joint] ?? 0);",
  "          if (!pd.dof.rotate) trans += jointSpeedBound(dJ, 0);", "ts", T_SP),
 ("v_axis_z", C, "    _axisDir.copy(pd.dof.axisVec).transformDirection(nw);", "    _axisDir.set(0, 0, 1).transformDirection(nw);", "ts", T_SP),
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
    bak = os.path.join(S, "ef", os.path.basename(R) + "." + os.path.basename(f) + ".mutbakP2")
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
