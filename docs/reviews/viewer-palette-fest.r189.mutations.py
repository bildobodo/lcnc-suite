"""R189 (Codex R188 VP188-01: a phase covered at its edges per active page, the window chain between rows; Codex R186: the R witness by causality, the status age by a two-way clock relation; Codex R185: the overlap proof contract — the worker's own parse bounds, the gateway's g, the page's pairs, the run check's real slices, R by order only; Codex R183: the heartbeat paired by its number, the run check's active sweep and the parse the page saw by id, the anchor at a standstill, S against the switch log, rows kept unless hidden), plus the R182/R183 rules still standing: each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
e2e = build, then Playwright -g (project chromium, or the selector's third part); py = pytest in lcnc-gateway; tool = the browser-PC tools' own unittest (~/claude-work/bpc). Restores from a byte copy. `--dry` checks the anchors only."""
import os, shutil, subprocess, sys, time
R = os.environ.get("MUT_TREE", "/home/cnc/lcnc-suite-mut")
W = R + "/lcnc-webui"
S = os.path.expanduser("~/claude-work/form1/bak")
TOOLS = os.path.expanduser("~/claude-work/bpc")
VP = "lcnc-webui/src/viewerPerf.ts"
SS = "lcnc-webui/src/ws/statusStore.ts"
WW = "lcnc-webui/src/wsWorker.ts"
LW = "lcnc-webui/src/lcncWs.ts"
TV = "lcnc-webui/src/ThreeViewer.vue"
BP = "lcnc-gateway/bulk_pipeline.py"
GW = "lcnc-gateway/gateway.py"
D2 = TOOLS + "/drive2.py"
B2 = TOOLS + "/bpc2.py"
T_VP = "src/viewerPerf.test.ts src/statusAge.test.ts"
E_FR = "e2e/frames.spec.ts::perf rows carry"
P_BP = "test_bulk_pipeline.py::TestCancelInflight::test_every_event_names_its_job_and_the_basis"
M = [
 ('t189_edges_ignored', '/home/cnc/claude-work/bpc/bpc2.py', 'inner == 0 and start <= ROW_CHAIN_NS and end <= ROW_CHAIN_NS', 'inner == 0', 'tool', ''),
 ('t189_end_edge_ignored', '/home/cnc/claude-work/bpc/bpc2.py', 'inner == 0 and start <= ROW_CHAIN_NS and end <= ROW_CHAIN_NS', 'inner == 0 and start <= ROW_CHAIN_NS', 'tool', ''),
 ('t189_silent_page_covers', '/home/cnc/claude-work/bpc/bpc2.py', 'per[pg] = {"rows": 0, "complete": False}', 'per[pg] = {"rows": 0, "complete": True}', 'tool', ''),
 ('t189_expected_dropped', '/home/cnc/claude-work/bpc/bpc2.py', 'exp = set(expected) if expected is not None else', 'exp = set() if expected is not None else', 'tool', ''),
 ('t189_chain_ignored', '/home/cnc/claude-work/bpc/bpc2.py', 'inner = sum(1 for x, y in zip(rs, rs[1:]) if abs(y["win_start"] - x["win_end"]) > CHAIN_SLACK_MS)', 'inner = 0', 'tool', ''),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak189")
    shutil.copyfile(path, bak)
    try:
        mutated = src
        for o, nw in zip(olds, news): mutated = mutated.replace(o, nw)
        open(path, "w").write(mutated)
        if kind not in ("py", "tool"):
            c = subprocess.run(["npx", "vue-tsc", "--noEmit", "-p", "tsconfig.app.json"], cwd=W, capture_output=True, text=True, timeout=900)
            if c.returncode: add((name, "NOCOMPILE", (c.stdout + c.stderr).strip().splitlines()[:1])); continue
        if kind == "tool":
            p = subprocess.run([os.path.expanduser("~/lcnc-suite/lcnc-gateway/.venv/bin/python"), "-m", "unittest", "test_bpc_tools"],
                               cwd=TOOLS, capture_output=True, text=True, timeout=300)
            out = p.stdout + p.stderr
            why = [ln.strip() for ln in out.splitlines() if ln.startswith("FAIL:") or ln.startswith("ERROR:")][:2]
            tail = [ln for ln in out.splitlines() if ln.startswith("Ran ") or ln.startswith("FAILED") or ln == "OK"][-1:]
        elif kind == "py":
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
            spec, pat, *proj = sel.split("::")
            p = subprocess.run(["npx", "playwright", "test", "--project", proj[0] if proj else "chromium", "--trace", "off", "--reporter=line", "--no-deps", "-g", pat, spec],
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
