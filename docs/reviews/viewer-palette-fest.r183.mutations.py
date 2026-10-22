"""R183 (Codex R182 VP182-01..04: the status age's receipt travels with the buffered status; the round trip timed in the worker; the driver's envelope guard; the report's 'not proven'), plus R182's rules still standing: each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
e2e = build, then Playwright -g (project chromium); py = pytest in lcnc-gateway; tool = the browser-PC tools' own unittest (~/claude-work/bpc). Restores from a byte copy. `--dry` checks the anchors only."""
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
D2 = TOOLS + "/drive2.py"
B2 = TOOLS + "/bpc2.py"
T_VP = "src/viewerPerf.test.ts src/statusAge.test.ts"
E_FR = "e2e/frames.spec.ts::perf rows carry"
P_BP = "test_bulk_pipeline.py::TestCancelInflight::test_every_event_names_its_job_and_the_basis"
M = [
 # VP182-01: the receipt travels with the status
 ("r183_viewer_newest", VP, "  if (_pendingRx === 0 || rxEpochMs < _pendingRx) _pendingRx = rxEpochMs;", "  _pendingRx = rxEpochMs;", "ts", T_VP),
 ("r183_viewer_kept", VP, "  const rx = _pendingRx;\n  _pendingRx = 0;\n", "  const rx = _pendingRx;\n", "ts", T_VP),
 ("r183_store_newest", SS, 'if (typeof rx === "number" && rx > 0 && (_pendingRx === 0 || rx < _pendingRx)) _pendingRx = rx;', 'if (typeof rx === "number" && rx > 0) _pendingRx = rx;', "ts", T_VP),
 ("r183_store_kept", SS, "    if (_pendingRx > 0) _rxOf.set(_pendingStatus, _pendingRx);\n    _pendingRx = 0;\n", "    if (_pendingRx > 0) _rxOf.set(_pendingStatus, _pendingRx);\n", "ts", T_VP),
 ("r183_first_apply_aged", VP, "  if (rx > 0 && built) {", "  if (rx > 0 && (built || !built)) {", "ts", T_VP),
 ("r183_vis_not_skipped", VP, "    if (rx < _visChangedAt) _ageVisSkip++;", "    if (rx < _visChangedAt && rx < 0) _ageVisSkip++;", "ts", T_VP),
 ("r183_status_rx_dropped", LW, "handleStatusMessage(msg, rx);", "handleStatusMessage(msg, rx && 0);", "e2e", E_FR),
 ("r183_viewer_no_note", TV, "notePendingReceipt(statusReceiptOf(msg));", "notePendingReceipt(statusReceiptOf(msg) && 0);", "e2e", E_FR),
 # VP182-02: the round trip timed in the worker, paired with exactly one heartbeat
 ("r183_rt_ambiguous", VP, "  const ok = _hbOutstanding === 1 && _hbSentAt > 0", "  const ok = _hbOutstanding >= 1 && _hbSentAt > 0", "ts", T_VP),
 ("r183_rt_negative", VP, "  if (!(net >= 0)) { _rtInvalid++; return; }", "  if (Number.isNaN(net)) { _rtInvalid++; return; }", "ts", T_VP),
 ("r183_rt_unstamped", LW, "noteHeartbeatSentAt(m.at);", "noteHeartbeatSentAt(undefined);", "e2e", E_FR),
 ("r183_worker_no_hb_stamp", WW, "        ws.send('{\"cmd\":\"heartbeat\"}');\n        post({ type: \"hbsent\", at });", "        ws.send('{\"cmd\":\"heartbeat\"}');\n        post({ type: \"hbsent\", at: at && 0 });", "e2e", E_FR),
 # R182's rules still standing
 ("r182_worker_no_rx", WW, "const rx = performance.timeOrigin + lastFrameRxAt;", "const rx = 0;", "e2e", E_FR),
 ("r182_no_key_listener", VP, "window.addEventListener('keydown', _onInput, { capture: true, passive: true });", "window.addEventListener('wheel', _onInput, { capture: true, passive: true });", "e2e", E_FR),
 ("r182_bin_width", VP, "  if (ms < 100) return Math.floor(ms / 2) * 2;", "  if (ms < 100) return Math.floor(ms / 5) * 5;", "ts", T_VP),
 ("r182_hist_kept", VP, "  _applySum = _applyMax = 0;\n  _resetHistograms();\n  _renderSum = _renderMax = 0;", "  _applySum = _applyMax = 0;\n  _renderSum = _renderMax = 0;", "ts", T_VP),
 ("r182_input_negative", VP, "  if (!(d >= 0) || d > INPUT_ODD_MS) { _inOdd++; return; }", "  if (d > INPUT_ODD_MS) { _inOdd++; return; }", "ts", T_VP),
 ("r182_quiet_presses", VP, "if (_frames === 0 && _renderCount === 0 && _inN === 0 && _inOdd === 0) return;", "if (_frames === 0 && _renderCount === 0) return;", "ts", T_VP),
 ("r182_publish_without_job", BP, '            _trace.emit("gcode.publish", job=_job, basis=_basis, active_idx=active_idx,', '            _trace.emit("gcode.publish", basis=_basis, active_idx=active_idx,', "py", P_BP),
 ("r182_cancel_without_job", BP, '                _trace.emit("gcode.parse_cancelled", job=_job, file=filepath,', '                _trace.emit("gcode.parse_cancelled", file=filepath,', "py", P_BP),
 ("r182_superseded_without_job", BP, '_trace.emit("gcode.reparse_superseded", reason=reason, job=inf.get("job"),', '_trace.emit("gcode.reparse_superseded", reason=reason,', "py", P_BP),
 ("r182_basis_without_offsets", BP, '                                  "wcs_off": _seed_wcs, "rotary_seed": _seed_rot,', '                                  "rotary_seed": _seed_rot,', "py", P_BP),
 ("r182_jobs_not_counted", BP, "            self.job_seq += 1\n", "            self.job_seq += 0\n", "py", P_BP),
 # VP182-03: the driver's envelope guard
 ("t_guard_counts_own", D2, '    others = sum(1 for x in clients if isinstance(x, dict) and x.get("armed")) - (1 if c.env.get("armed") else 0)', '    others = sum(1 for x in clients if isinstance(x, dict) and x.get("armed"))', "tool", ""),
 ("t_guard_ip_filter", D2, '    others = sum(1 for x in clients if isinstance(x, dict) and x.get("armed")) - (1 if c.env.get("armed") else 0)', '    others = sum(1 for x in clients if isinstance(x, dict) and x.get("armed") and x.get("ip") not in bpc.LOCAL)', "tool", ""),
 ("t_trip_sticky", D2, '"safety_trip": d.get("safety_trip")}', '"safety_trip": d.get("safety_trip") or (self.env or {}).get("safety_trip")}', "tool", ""),
 ("t_stale_ignored", D2, "    if c.env is None or time.monotonic() - c.env_at > ENV_STALE_S:", "    if c.env is None:", "tool", ""),
 ("t_guard_never_cancels", D2, "            why.append(b)\n            seq.cancel()\n", "            why.append(b)\n", "tool", ""),
 # VP182-04: the report's 'not proven'
 ("t_wd_last_dump", B2, '    t0 = anchor["wall_ns"] - anchor["wd_ms"] * 10**6', '    t0 = anchor["wall_ns"] - int(re.findall(r"\\[HB-DUMP\\] \\+(\\d+)ms reason=trip_reset", wd_text)[-1]) * 10**6', "tool", ""),
 ("t_wd_no_step_check", B2, "    if steps:\n", "    if steps and False:\n", "tool", ""),
 ("t_wd_no_instance_check", B2, '    if line not in wd_text[anchor["wd_log_bytes"]:]:', "    if False:", "tool", ""),
 ("t_wd_no_tick_check", B2, "    if not ticks or ticks[0] > a + 2e9 or ticks[-1] < b - 2e9 or (holes and max(holes) > 3e9):", "    if not ticks:", "tool", ""),
 ("t_wd_no_anchor_pass", B2, '    if anchor is None:\n        return {"status": "not proven", "why": "no anchor (drive2\'s own E-Stop reset)"}', '    if anchor is None:\n        return {"status": "bound", "statement": "no anchor"}', "tool", ""),
 ("t_rss_no_coverage", B2, "    if not gw or gw[0][0] > a + 1e9 or gw[-1][0] < b - 1e9 or (holes and max(holes) > 1e9):", "    if not gw:", "tool", ""),
 ("t_rows_no_edge", B2, "        if not (a + ROW_SPAN_NS <= t < b):", "        if not (a <= t < b):", "tool", ""),
 ("t_s_ignores_rss", B2, '    if rss.get("status") != "sampled":\n        why.append("workers alive at once not collected")\n    elif rss["workers_at_once_max"] > 1:', '    if rss.get("status") == "sampled" and rss["workers_at_once_max"] > 1:', "tool", ""),
 ("t_r_any_start", B2, "        after = [d for d in disc if d > pub and not any(s0 < s < d for s in starts)]", "        after = [d for d in disc if d > pub]", "tool", ""),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak183")
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
