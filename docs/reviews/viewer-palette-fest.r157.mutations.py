"""Plan 3.6 Form 1 (the stepped build, the publisher, the page's layout reads): each mutation must
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
M = [
 # the publisher: a pass never discards itself, publishes what is shown then
 ("p_view_dirties", CP, ["  markDirty(): void { this.dirty = true; }", "  viewOf(track: T): V | null { return this.views.get(track)?.view ?? null; }"],
  ["  markDirty(): void { this.dirty = true; if (this.pass && this.pass.phase === 2) this.pass.discard = true; }",
   "  viewOf(track: T): V | null { this.markDirty(); return this.views.get(track)?.view ?? null; }"], "ts", T_P),
 ("p_no_recheck", CP, "      if (this.shows(built)) break;", "      if (this.shows(built) || true) break;", "ts", T_P),
 ("p_view_needs_tables", CP, "  viewOf(track: T): V | null { return this.views.get(track)?.view ?? null; }",
  "  viewOf(track: T): V | null { const p = this.views.get(track); return p && p.ids.every(id => this.reqs.has(id)) ? p.view : null; }", "ts", T_P),
 ("p_stage_early", CP, ["    for (const m of taken) yield* this.timed(this.take(m, c), 0);", "    const staged = this.deps.stage();"],
  ["    for (const m of taken) yield* this.timed(this.take(m, c), 0);\n    const early = this.deps.stage();", "    const staged = early;"], "ts", T_P),
 ("p_catchup_counts", CP, "yield* this.timed(this.applyTo(dead, m, c, false), 3);", "yield* this.timed(this.applyTo(dead, m, c, true), 3);", "ts", T_P),
 ("p_pub_written", CP, "        yield* this.applyTo(this.workOf(r)!, m, c);", "        yield* this.applyTo(r.copies![r.pub]!, m, c);", "ts", T_P),
 ("p_ack_early", CP, "        else r.ahead.push(m);", "        else { r.ahead.push(m); this.ackOf(m); }", "ts", T_P),
 ("p_held_is_pub", CP, "            r.held = this.workOf(r);", "            r.held = r.copies[r.pub]!;", "ts", T_P),
 ("p_drain_unacked", CP, "        if (r.fallen) this.ackOf(m);", "        if (r.fallen && m.id < 0) this.ackOf(m);", "ts", T_P),
 ("p_old_gen_unacked", CP, "        this.deps.ack({ contactsAck: m.id, generation: g });\n      } else {", "        void g;\n      } else {", "ts", T_P),
 # the viewer's rule: a pass's own effects never mark it again
 ("v_stage_in_pass", TV, "  if (_contacts.running && _contacts.phase <= 2) return;", "  if (_contacts.running && _contacts.phase <= 0) return;", "ts", T_W),
 # the build: every step bounded
 ("c_proven_once", CV, "    if (!Number.isNaN(f)) take(f);\n    if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }", "    if (!Number.isNaN(f)) take(f);\n    if ((c.n += 4) >= STEP_OPS) { c.n = 0; }", "ts", T_CV),
 ("c_copy_at_once", CV, "yield* copySteps(new Float64Array(P.length), P, c)", "Float64Array.from(P)", "ts", T_CV),
 # the marks: every position read counted
 ("w_search_flat", SW, "  const search = POS_OPS * (Math.ceil(Math.log2(c.n + 1)) + 1);", "  const search = 64 + 0 * POS_OPS;", "ts", T_SW),
 ("w_dense_flat", SW, "      if ((ops.n += POS_OPS) >= STEP_OPS) { ops.n = 0; yield; }", "      if ((ops.n += 16) >= STEP_OPS) { ops.n = 0; yield; }", "ts", T_SW),
 # the copy, the store's stepped apply
 ("s_copy_no_yield", ST, "    out[i] = src[i]!;\n    if (++c.n >= STEP_OPS) { c.n = 0; yield; }", "    out[i] = src[i]!;\n    if (++c.n >= STEP_OPS) { c.n = 0; }", "ts", T_ST),
 ("a_refusal_episodes_only", CS, "    const why = this.episodes.refusal(d.episodes) ?? this.intervals.refusal(d.intervals) ?? this.gaps.refusal(d.gaps);",
  "    const why = this.episodes.refusal(d.episodes);", "ts", T_CS),
 ("a_updates_at_once", CS, "      if ((c.n += cols.length) >= STEP_OPS) { c.n = 0; yield; }", "      if ((c.n += cols.length) >= STEP_OPS) { c.n = 0; }", "ts", f"{T_CS} {T_P}"),
 ("a_rows_at_once", CS, "      if ((c.n += n * this.schema.length) >= STEP_OPS) { c.n = 0; yield; }", "      if ((c.n += n * this.schema.length) >= STEP_OPS) { c.n = 0; }", "ts", f"{T_CS} {T_P}"),
 # the page's layout reads after a DOM change
 ("h_read_at_mount", SH, "    ro.observe(head);\n    observers.set(el, ro);\n  },", "    ro.observe(head);\n    observers.set(el, ro);\n    apply();\n  },", "ts", "src/stickyHead.test.ts"),
 ("f_attach_sync", SF, "  for (const c of el.children) ro.observe(c)\n  updateSoon()", "  for (const c of el.children) ro.observe(c)\n  update()", "ts", "src/scrollFade.test.ts"),
 ("f_change_sync", SF, "    // batch keeps sf-up/sf-down honest (in the next frame: updateSoon).\n    updateSoon()", "    // batch keeps sf-up/sf-down honest (in the next frame: updateSoon).\n    update()", "ts", "src/scrollFade.test.ts"),
 # the written-out glyphs are lucide's
 ("g_glyph_drift", "lcnc-webui/src/ScrubBar.vue", '<path d="M18 6 6 18" />', '<path d="M18 6 6 17" />', "ts", "src/glyphMarkup.test.ts"),
 ("g_glyph_size", "lcnc-webui/src/SimPanel.vue", 'width="11" height="11" fill="currentColor"', 'width="12" height="11" fill="currentColor"', "ts", "src/glyphMarkup.test.ts"),
 # in the page: the tracks a run check's beginning stands on
 ("e_tracks_no_runside", TV, "return [collisionTrack.value, collisionPartialTrack.value, _colRunSideBase()?.trk, collisionEntry.value?.track,",
  "return [collisionTrack.value, collisionPartialTrack.value, collisionEntry.value?.track,", "e2e", "e2e/collisions.viewer.spec.ts::R138"),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak")
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
