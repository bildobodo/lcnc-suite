"""Plan 4.4 (the list window, step 4 package 2 round B): each mutation must turn the named tests red.
ts = vue-tsc (app) must compile, then vitest on the named files; e2e = build, then Playwright -g.
Restores from a byte copy. `--dry` only checks that every anchor occurs exactly once."""
import os, shutil, subprocess, sys, time
R = os.environ.get("MUT_ROOT", "/home/cnc/lcnc-suite-mut")
W = R + "/lcnc-webui"
S = os.path.expanduser("~/claude-work/r154/bak")
SPEC = "e2e/sim-panel.viewer.spec.ts"
SW = "lcnc-webui/src/viewer/simWindow.ts"
CV = "lcnc-webui/src/viewer/contactView.ts"
SB = "lcnc-webui/src/ScrubBar.vue"
SP = "lcnc-webui/src/SimPanel.vue"
T_SW = "src/viewer/simWindow.test.ts"
T_CV = "src/viewer/contactView.test.ts"
T_CO = "src/viewer/collision.test.ts"
T_BW = "src/viewer/scrubBarWords.test.ts"
M = [
 # the steps on the index (findingNav's rule over the whole list)
 ("w_step_after_tie", SW, "e.index + 1 : l.atOrAfter(e.cum, l.order < KIND_ORDER[e.kind]);", "e.index + 1 : l.atOrAfter(e.cum, l.order > KIND_ORDER[e.kind]);", "ts", T_SW),
 ("w_step_before_tie", SW, "e.index - 1 : l.atOrAfter(e.cum, l.order < KIND_ORDER[e.kind]) - 1;", "e.index - 1 : l.atOrAfter(e.cum, l.order > KIND_ORDER[e.kind]) - 1;", "ts", T_SW),
 ("w_step_nudge", SW, "l.atOrAfter(s - 2 * JUMP_NUDGE, false)", "l.atOrAfter(s, false)", "ts", T_SW),
 ("w_step_no_wrap", SW, "if (dir > 0) return firstOf(cands) ?? firstOf(ls.map(l => pickOf(l, 0)));", "if (dir > 0) return firstOf(cands);", "ts", T_SW),
 ("w_kind_order", SW, "(a.cum === b.cum && KIND_ORDER[a.kind] < KIND_ORDER[b.kind])", "(a.cum === b.cum && KIND_ORDER[a.kind] > KIND_ORDER[b.kind])", "ts", T_SW),
 ("w_next_at_pos", SW, "const l = kindList(t, k), i = l.atOrAfter(pos, true);", "const l = kindList(t, k), i = l.atOrAfter(pos, false);", "ts", T_SW),
 # the merged list and the window
 ("w_merged_tie", SW, "this.clash ? this.clash.atOrAfter(o.cum, false) : 0", "this.clash ? this.clash.atOrAfter(o.cum, true) : 0", "ts", T_SW),
 ("w_index_clash", SW, "this.clash!.pos(p.index), true);", "this.clash!.pos(p.index), false);", "ts", T_SW),
 ("w_always_recentre", SW, "if (center >= lo && center < hi) return prev;", "if (center >= lo && center < hi && prev < 0) return prev;", "ts", T_SW),
 ("w_centre_no_shown", SW, "const e = selected(ls, s, sel) ?? nextTarget(m.t, kinds, s);", "const e = nextTarget(m.t, kinds, s);", "ts", T_SW),
 # the marks
 ("w_ticks_near", SW, "if (!c.near(j)) { near = false; break; }", "if (c.near(j)) { near = false; break; }", "ts", T_SW),
 ("w_ticks_per_target", SW, "    out.push({ pct: Math.min(100, (c.pos(i) / axisEnd) * 100), near });",
  "    for (let j = i; j < c.n && c.pos(j) < hi; j++) out.push({ pct: Math.min(100, (c.pos(j) / axisEnd) * 100), near });", "ts", T_SW),
 # the start contacts, at each table's first sample
 ("v_start_max", CV, "if (b[j]! < m) m = b[j]!;", "if (b[j]! > m || m === Infinity) m = b[j]!;", "ts", f"{T_CV} {T_CO}"),
 # the bar's own inputs
 ("b_start_near", SB, ".filter(h => !h.entry && !h.possible && !isNearMiss(h));", ".filter(h => !h.entry && !h.possible);", "ts", T_BW),
 ("b_count_not_index", SB, "  const n = clashIndex.value.n;\n  const fw = wordsOfCounts(clashCounts.value);", "  const n = 0;\n  const fw = wordsOfCounts(clashCounts.value);", "ts", T_BW),
 # re-anchored (the first anchors left a name unused: NOCOMPILE)
 ("w_step_nudge2", SW, "l.atOrAfter(s - 2 * JUMP_NUDGE, false)", "l.atOrAfter(s - 0 * JUMP_NUDGE, false)", "ts", T_SW),
 ("w_centre_no_shown2", SW, "const e = selected(ls, s, sel) ?? nextTarget(m.t, kinds, s);", "const e = selected(ls, s, sel && null) ?? nextTarget(m.t, kinds, s);", "ts", T_SW),
 ("b_start_near2", SB, ".filter(h => !h.entry && !h.possible && !isNearMiss(h));", ".filter(h => !h.entry && !h.possible && (!isNearMiss(h) || true));", "ts", T_BW),
 ("e_no_window2", SB, "part = m.slice(first, first + LIST_WINDOW_ROWS);", "part = m.slice(first, first + LIST_WINDOW_ROWS * 1e6);", "e2e", "a long list is a window"),
 ("e_no_restore2", SP, "watch([marked, rows], () => { restoreAnchor(); follow(true);", "watch([marked, rows], () => { if (rows.value.length < 0) restoreAnchor(); follow(true);", "e2e", "a moved window keeps the picture"),
 # in the page
 ("e_no_window", SB, "part = m.slice(first, first + LIST_WINDOW_ROWS);", "part = m.slice(first, m.total);", "e2e", "a long list is a window"),
 ("e_ticks_per_target", SB, "clashTicks(clashIndex.value, bandCols.value, max)", "clashTicks(clashIndex.value, bandCols.value * 1000, max)", "e2e", "a long list is a window"),
 ("e_focus_local", SP, "pickEl(keys[Math.max(0, Math.min(h.index - simView.window.before, keys.length - 1))]!)",
  "pickEl(keys[Math.max(0, Math.min(h.index, keys.length - 1))]!)", "e2e", "a long list is a window"),
 ("e_no_restore", SP, "watch([marked, rows], () => { restoreAnchor(); follow(true);", "watch([marked, rows], () => { follow(true);", "e2e", "a moved window keeps the picture"),
 ("e_filter_ignored", SB, "const listKinds = computed(() => SIM_FILTER_KINDS[simView.filter]);", "const listKinds = computed(() => SIM_FILTER_KINDS[simView.filter === \"all\" ? \"all\" : \"all\"]);",
  "e2e", "the list is the timeline's marks"),
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
    bak = os.path.join(S, os.path.basename(R) + "." + os.path.basename(f) + ".mutbakR154")
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
