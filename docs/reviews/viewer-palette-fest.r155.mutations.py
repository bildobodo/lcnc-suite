"""The block-wise delta apply (Form 1 groundwork): each mutation must turn the named tests red.
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
CS = "lcnc-webui/src/viewer/contactStore.ts"
T_CS = "src/viewer/contactStore.test.ts"
M = [
 ("a_revision", CS, "    this.revision += d.count;", "    this.revision += 0 * d.count;", "ts", T_CS),
 ("a_offset", CS, ".subarray(done, done + n) : Array.prototype.slice.call(src, done, done + n), o);", ".subarray(done, done + n) : Array.prototype.slice.call(src, done, done + n), 0);", "ts", T_CS),
 ("a_no_dirty", CS, "      if (r < this.sent && !this.dirtyBlocks[b]![o]) {", "      if (r < this.sent && !this.dirtyBlocks[b]![o] && r < 0) {", "ts", T_CS),
 ("a_no_budget", CS, "    if (this.rows + d.count > this.budget) throw", "    if (this.rows + d.count > this.budget + 1e9) throw", "ts", T_CS),
 ("a_update_revision", CS, "      this.revision += cols.length;", "      this.revision += cols.length - 1;", "ts", T_CS),
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
    bak = os.path.join(S, os.path.basename(R) + "." + os.path.basename(f) + ".mutbakApply")
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
