"""R180 (Codex R179: the rest of VP-I131 — the stretch cap said per axis, never one axis's numbers for a row): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
e2e = build, then Playwright -g; py = pytest in lcnc-gateway. Restores from a byte copy. `--dry` checks the anchors only."""
import os, shutil, subprocess, sys, time
R = os.environ.get("MUT_TREE", "/home/cnc/lcnc-suite-mut")
W = R + "/lcnc-webui"
S = os.path.expanduser("~/claude-work/form1/bak")
LP = "lcnc-webui/src/viewer/limitPlaces.ts"
SR = "lcnc-webui/src/viewer/simRows.ts"
SB = "lcnc-webui/src/ScrubBar.vue"
SP = "lcnc-webui/src/SimPanel.vue"
T_LP = "src/viewer/limitPlaces.test.ts src/viewer/limitOriginPayloads.test.ts"
E_SP = "e2e/sim-panel.viewer.spec.ts"
M = [
 ("r180_cut_one_axis", LP, "      if (all > have) (t.cuts ??= []).push({ axis: v.axis, shown: have, total: all });", "      if (all > have && !t.cuts) (t.cuts ??= []).push({ axis: v.axis, shown: have, total: all });", "ts", T_LP),
 ("r180_note_no_axis", SR, "t.cuts.map(c => `${c.axis} ${c.shown} of ${c.total}`).join(\", \")", "t.cuts.map(c => `${c.shown} of ${c.total}`).join(\", \")", "ts", T_LP),
 ("r180_help_not_per_axis", SP, "timeline bands show only the first ${cutShown} stretches per axis.`", "timeline bands show only the first ${cutShown} of ${cut === 1 ? \"its\" : \"their\"} stretches.`", "e2e", E_SP + "::two capped axes"),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak180")
    shutil.copyfile(path, bak)
    try:
        mutated = src
        for o, nw in zip(olds, news): mutated = mutated.replace(o, nw)
        open(path, "w").write(mutated)
        if kind != "py":
            c = subprocess.run(["npx", "vue-tsc", "--noEmit", "-p", "tsconfig.app.json"], cwd=W, capture_output=True, text=True, timeout=900)
            if c.returncode: add((name, "NOCOMPILE", (c.stdout + c.stderr).strip().splitlines()[:1])); continue
        if kind == "py":
            env = dict(os.environ, LCNC_LOG_DIR=os.path.expanduser("~/claude-work/form1/testlogs"))
            p = subprocess.run([R + "/lcnc-gateway/.venv/bin/python", "-m", "pytest", "-o", "addopts=", "-q", "-p", "no:cacheprovider", sel], cwd=R + "/lcnc-gateway", capture_output=True, text=True, timeout=900, env=env)
            out = p.stdout + p.stderr
            why = [ln.strip() for ln in out.splitlines() if ln.startswith("FAILED") or "AssertionError" in ln][:2]
            tail = [ln for ln in out.splitlines() if " passed" in ln or " failed" in ln][-1:]
        elif kind == "ts":
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
