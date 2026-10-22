"""R182 (browser-PC instruments, Codex R181 VP181-01: status age from the worker's receipt, pooled histograms, the gateway → socket bound, input delay, parse jobs and the start basis by id): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
e2e = build, then Playwright -g (project chromium); py = pytest in lcnc-gateway. Restores from a byte copy. `--dry` checks the anchors only."""
import os, shutil, subprocess, sys, time
R = os.environ.get("MUT_TREE", "/home/cnc/lcnc-suite-mut")
W = R + "/lcnc-webui"
S = os.path.expanduser("~/claude-work/form1/bak")
VP = "lcnc-webui/src/viewerPerf.ts"
WW = "lcnc-webui/src/wsWorker.ts"
LW = "lcnc-webui/src/lcncWs.ts"
BP = "lcnc-gateway/bulk_pipeline.py"
T_VP = "src/viewerPerf.test.ts"
E_FR = "e2e/frames.spec.ts::perf rows carry"
P_BP = "test_bulk_pipeline.py::TestCancelInflight::test_every_event_names_its_job_and_the_basis"
M = [
 ("r182_age_before_build", VP, "if (!_enabled || _lastApplyTs === 0 || typeof rxEpochMs !== 'number'", "if (!_enabled || typeof rxEpochMs !== 'number'", "ts", T_VP),
 ("r182_age_newest", VP, "  if (_rxOldest === 0) _rxOldest = rxEpochMs;", "  _rxOldest = rxEpochMs;", "ts", T_VP),
 ("r182_age_kept", VP, "      if (age > _ageMax) _ageMax = age;\n    }\n    _rxOldest = 0;", "      if (age > _ageMax) _ageMax = age;\n    }\n    void 0;", "ts", T_VP),
 ("r182_rt_no_hold", VP, "const net = Math.max(0, rtMs - serverMs);", "const net = Math.max(0, rtMs);", "ts", T_VP),
 ("r182_bin_width", VP, "  if (ms < 100) return Math.floor(ms / 2) * 2;", "  if (ms < 100) return Math.floor(ms / 5) * 5;", "ts", T_VP),
 ("r182_hist_kept", VP, "  _applySum = _applyMax = 0;\n  _resetHistograms();\n  _renderSum = _renderMax = 0;", "  _applySum = _applyMax = 0;\n  _renderSum = _renderMax = 0;", "ts", T_VP),
 ("r182_input_negative", VP, "  if (!(d >= 0) || d > INPUT_ODD_MS) { _inOdd++; return; }", "  if (d > INPUT_ODD_MS) { _inOdd++; return; }", "ts", T_VP),
 ("r182_quiet_presses", VP, "if (_frames === 0 && _renderCount === 0 && _inN === 0 && _inOdd === 0) return;", "if (_frames === 0 && _renderCount === 0) return;", "ts", T_VP),
 ("r182_worker_no_rx", WW, "const rx = performance.timeOrigin + lastFrameRxAt;", "const rx = 0;", "e2e", E_FR),
 ("r182_status_not_noted", LW, "noteStatusReceived(rx);", "noteStatusReceived(rx && 0);", "e2e", E_FR),
 ("r182_no_key_listener", VP, "window.addEventListener('keydown', _onInput, { capture: true, passive: true });", "window.addEventListener('wheel', _onInput, { capture: true, passive: true });", "e2e", E_FR),
 ("r182_publish_without_job", BP, '            _trace.emit("gcode.publish", job=_job, basis=_basis, active_idx=active_idx,', '            _trace.emit("gcode.publish", basis=_basis, active_idx=active_idx,', "py", P_BP),
 ("r182_cancel_without_job", BP, '                _trace.emit("gcode.parse_cancelled", job=_job, file=filepath,', '                _trace.emit("gcode.parse_cancelled", file=filepath,', "py", P_BP),
 ("r182_superseded_without_job", BP, '_trace.emit("gcode.reparse_superseded", reason=reason, job=inf.get("job"),', '_trace.emit("gcode.reparse_superseded", reason=reason,', "py", P_BP),
 ("r182_basis_without_offsets", BP, '                                  "wcs_off": _seed_wcs, "rotary_seed": _seed_rot,', '                                  "rotary_seed": _seed_rot,', "py", P_BP),
 ("r182_jobs_not_counted", BP, "            self.job_seq += 1\n", "            self.job_seq += 0\n", "py", P_BP),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak182")
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
            p = subprocess.run(["npx", "playwright", "test", "--project", "chromium", "--trace", "off", "--reporter=line", "--no-deps", "-g", pat, spec],
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
