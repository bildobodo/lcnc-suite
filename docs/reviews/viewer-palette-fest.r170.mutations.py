"""R170 (C2: the record sink and package 1's hold out; the first interval beside an unacknowledged delta): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
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
M = [
 # the running sweep's metadata (C2)
 ("w_meta_never", CW, "if (!side && run.snapshot.meta && (run.lastMeta === null || performance.now() >= run.nextMetaAt)) {",
  "if (!side && run.snapshot.meta && (run.lastMeta !== null && performance.now() >= run.nextMetaAt)) {", "ts", T_WK + "::posts its METADATA"),
 ("w_meta_every", CW, "if (sig !== run.lastMeta) { run.lastMeta = sig; partial = meta; }",
  "if (sig !== run.lastMeta || sig.length > 0) { run.lastMeta = sig; partial = meta; }", "ts", T_WK + "::posts its METADATA"),
 ("w_meta_sig_counters", CW, "  return JSON.stringify(rest);\n}", "  return JSON.stringify(rest) + _s;\n}", "ts", T_WK + "::posts its METADATA"),
 ("co_meta_reason", CO, 'opts.snapshot.meta = () => buildResult({ covered: frac(sweptTo), reason: "running" }, false);',
  'opts.snapshot.meta = () => buildResult({ covered: frac(sweptTo), reason: "stopped" }, false);', "ts", T_WK + "::posts its METADATA"),
 # the first interval beside an unacknowledged delta (C2, Codex R167)
 ("w_store_no_urgent", CS, "if (this.inFlight > (this.firstIntervalUnsent ? 1 : 0)) return null;",
  "if (this.inFlight > (this.firstIntervalUnsent ? 0 : 0)) return null;", "ts", T_CS + " " + T_WK + "::first interval"),
 ("w_store_ack_negative", CS, "ack(): void { if (this.inFlight > 0) this.inFlight--; }", "ack(): void { this.inFlight--; }", "ts", T_CS + "::at most two"),
 ("w_send_waiting", CW, "  const s = run.store;\n  if (!s) return false;", "  const s = run.store;\n  if (!s || s.waiting) return false;", "ts", T_WK + "::this core: the delta with the first interval"),
 ("w_coord_no_urgent", CW, "if (run.ownerWaiting > (firstTouch ? 1 : 0)) return false;", "if (run.ownerWaiting > (firstTouch ? 0 : 0)) return false;", "ts", T_WK + "::the pool: the request's first interval"),
 ("w_coord_ack_negative", CW, "run.ownerWaiting = Math.max(0, run.ownerWaiting - 1);", "run.ownerWaiting = run.ownerWaiting - 1;", "ts", T_WK + "::the pool: the request's first interval"),
 ("w_drain_bool", CW, "stores: run.stores, ownerWaiting: run.ownerWaiting, finalMsg", "stores: run.stores, ownerWaiting: run.ownerWaiting ? 1 : 0, finalMsg", "ts", T_WK + "::drain says nothing until both"),
 ("w_drain_ack_all", CW, "_drain.ownerWaiting = Math.max(0, _drain.ownerWaiting - 1);", "_drain.ownerWaiting = Math.max(0, _drain.ownerWaiting - 9);", "ts", T_WK + "::drain says nothing until both"),
 ("e_coord_no_urgent", CW, "if (run.ownerWaiting > (firstTouch ? 1 : 0)) return false;", "if (run.ownerWaiting > (firstTouch ? 0 : 0)) return false;", "e2e", E_CO + "::first touch shows while"),
 # the first touch through the viewer (C2)
 ("v_first_touch_unmarked", TV, "if (first) m.firstTouch = true;", "if (first) m.firstTouch = !first;", "ts", T_W + "::first touch interval is marked"),
 ("v_first_touch_every", TV, "first = _intervalRows(m.id) === 0 && m.contacts.some(d => d.intervals.count > 0);",
  "first = _intervalRows(m.id) >= 0 && m.contacts.some(d => d.intervals.count > 0);", "ts", T_W + "::first touch interval is marked"),
 ("v_first_not_urgent", TV, "_colKick(!!(m.result || m.stopped || m.error || m.heldCoverage) || first);",
  "_colKick(!!(m.result || m.stopped || m.error || m.heldCoverage) || (first && false));", "ts", T_W + "::first touch interval is marked"),
 ("v_side_first_unset", TV, "if (m.firstTouch && collisionSideFirst.value?.id !== side.id) {", "if (m.firstTouch && collisionSideFirst.value?.id === side.id) {", "ts", T_W + "::shown from its first touch"),
 ("v_delta_alone_drops_first", TV, "if (deltaAlone && !m.firstTouch) return;   // a delta alone", "if (deltaAlone && !!m) return;   // a delta alone", "ts", T_W + "::a side run's first touch"),
 ("v_previous_not_from_view", TV, "  if (sv) return { collisions: sv.view.n,", "  if (sv && sv.view.n < -1) return { collisions: sv.view.n,", "ts", T_W + "::the earlier preview's verdict"),
 # the undecidable stretches from the gap table (C2)
 ("v_undecidable_not_derived", TV, "const undecidable = yield* undecidableStretchesSteps(view);", "const undecidable = (yield* undecidableStretchesSteps(view)).slice(0, 0);", "e2e", E_CO + "::an undecidable gap alone"),
 ("sb_undecidable_ignored", SB, "  for (const u of sv?.derived?.undecidable ?? []) {", "  for (const u of (sv?.derived?.undecidable ?? []).slice(1)) {", "e2e", E_CO + "::an undecidable gap alone"),
 ("cv_undecidable_reason", CV, 'if (G.get(row, "reason") !== GAP_UNDECIDABLE) continue;', 'if (G.get(row, "reason") === GAP_UNDECIDABLE) continue;', "ts", T_IN),
 ("co_rest_undec_dropped", CO, 'if (v === "undecidable") { markInside(pi, v); restUndec.add(pi); }', 'if (v === "undecidable") { markInside(pi, v); void restUndec; }', "ts", T_IN),
 # the merges keep metadata only, every statement (C2)
 ("ss_notes_shard0", SS, "    ...unitedNotes(results),", "    ...unitedNotes(results.slice(0, 1)),", "ts", T_IN + " " + T_WK),
 ("sm_notes_entry_only", SM, "    ...unitedNotes([entry, base]),", "    ...unitedNotes([entry]),", "ts", T_SMG),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak170")
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
