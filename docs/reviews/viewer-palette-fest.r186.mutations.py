"""R186 (Codex R185: the overlap proof contract — the worker's own parse bounds, the gateway's g, the page's pairs, the run check's real slices, R by order only; Codex R183: the heartbeat paired by its number, the run check's active sweep and the parse the page saw by id, the anchor at a standstill, S against the switch log, rows kept unless hidden), plus the R182/R183 rules still standing: each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
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
 ('r183_viewer_newest', 'lcnc-webui/src/viewerPerf.ts', '  if (_pendingRx === 0 || rxEpochMs < _pendingRx) _pendingRx = rxEpochMs;', '  _pendingRx = rxEpochMs;', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r183_viewer_kept', 'lcnc-webui/src/viewerPerf.ts', '  const rx = _pendingRx;\n  _pendingRx = 0;\n', '  const rx = _pendingRx;\n', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r183_store_newest', 'lcnc-webui/src/ws/statusStore.ts', 'if (typeof rx === "number" && rx > 0 && (_pendingRx === 0 || rx < _pendingRx)) _pendingRx = rx;', 'if (typeof rx === "number" && rx > 0) _pendingRx = rx;', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r183_store_kept', 'lcnc-webui/src/ws/statusStore.ts', '    if (_pendingRx > 0) _rxOf.set(_pendingStatus, _pendingRx);\n    _pendingRx = 0;\n', '    if (_pendingRx > 0) _rxOf.set(_pendingStatus, _pendingRx);\n', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r183_first_apply_aged', 'lcnc-webui/src/viewerPerf.ts', '  if (rx > 0 && built) {', '  if (rx > 0 && (built || !built)) {', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r183_vis_not_skipped', 'lcnc-webui/src/viewerPerf.ts', '    if (rx < _visChangedAt) _ageVisSkip++;', '    if (rx < _visChangedAt && rx < 0) _ageVisSkip++;', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r183_status_rx_dropped', 'lcnc-webui/src/lcncWs.ts', 'handleStatusMessage(msg, rx);', 'handleStatusMessage(msg, rx && 0);', 'e2e', 'e2e/frames.spec.ts::perf rows carry'),
 ('r183_viewer_no_note', 'lcnc-webui/src/ThreeViewer.vue', 'notePendingReceipt(statusReceiptOf(msg));', 'notePendingReceipt(statusReceiptOf(msg) && 0);', 'e2e', 'e2e/frames.spec.ts::perf rows carry'),
 ('r183_rt_negative', 'lcnc-webui/src/viewerPerf.ts', '  if (!(net >= 0)) { _rtInvalid++; return; }', '  if (Number.isNaN(net)) { _rtInvalid++; return; }', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r182_worker_no_rx', 'lcnc-webui/src/wsWorker.ts', 'const rx = performance.timeOrigin + lastFrameRxAt;', 'const rx = 0;', 'e2e', 'e2e/frames.spec.ts::perf rows carry'),
 ('r182_no_key_listener', 'lcnc-webui/src/viewerPerf.ts', "window.addEventListener('keydown', _onInput, { capture: true, passive: true });", "window.addEventListener('wheel', _onInput, { capture: true, passive: true });", 'e2e', 'e2e/frames.spec.ts::perf rows carry'),
 ('r182_bin_width', 'lcnc-webui/src/viewerPerf.ts', '  if (ms < 100) return Math.floor(ms / 2) * 2;', '  if (ms < 100) return Math.floor(ms / 5) * 5;', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r182_hist_kept', 'lcnc-webui/src/viewerPerf.ts', '  _applySum = _applyMax = 0;\n  _resetHistograms();\n  _renderSum = _renderMax = 0;', '  _applySum = _applyMax = 0;\n  _renderSum = _renderMax = 0;', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r182_input_negative', 'lcnc-webui/src/viewerPerf.ts', '  if (!(d >= 0) || d > INPUT_ODD_MS) { _inOdd++; return; }', '  if (d > INPUT_ODD_MS) { _inOdd++; return; }', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r182_quiet_presses', 'lcnc-webui/src/viewerPerf.ts', 'if (_frames === 0 && _renderCount === 0 && _inN === 0 && _inOdd === 0) return;', 'if (_frames === 0 && _renderCount === 0) return;', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r182_publish_without_job', 'lcnc-gateway/bulk_pipeline.py', '            _trace.emit("gcode.publish", job=_job, basis=_basis, active_idx=active_idx,', '            _trace.emit("gcode.publish", basis=_basis, active_idx=active_idx,', 'py', 'test_bulk_pipeline.py::TestCancelInflight::test_every_event_names_its_job_and_the_basis'),
 ('r182_cancel_without_job', 'lcnc-gateway/bulk_pipeline.py', '                _trace.emit("gcode.parse_cancelled", job=_job, file=filepath,', '                _trace.emit("gcode.parse_cancelled", file=filepath,', 'py', 'test_bulk_pipeline.py::TestCancelInflight::test_every_event_names_its_job_and_the_basis'),
 ('r182_superseded_without_job', 'lcnc-gateway/bulk_pipeline.py', '_trace.emit("gcode.reparse_superseded", reason=reason, job=inf.get("job"),', '_trace.emit("gcode.reparse_superseded", reason=reason,', 'py', 'test_bulk_pipeline.py::TestCancelInflight::test_every_event_names_its_job_and_the_basis'),
 ('r182_basis_without_offsets', 'lcnc-gateway/bulk_pipeline.py', '                                  "wcs_off": _seed_wcs, "rotary_seed": _seed_rot,', '                                  "rotary_seed": _seed_rot,', 'py', 'test_bulk_pipeline.py::TestCancelInflight::test_every_event_names_its_job_and_the_basis'),
 ('r182_jobs_not_counted', 'lcnc-gateway/bulk_pipeline.py', '            self.job_seq += 1\n', '            self.job_seq += 0\n', 'py', 'test_bulk_pipeline.py::TestCancelInflight::test_every_event_names_its_job_and_the_basis'),
 ('t_guard_counts_own', '/home/cnc/claude-work/bpc/drive2.py', '    others = sum(1 for x in clients if isinstance(x, dict) and x.get("armed")) - (1 if c.env.get("armed") else 0)', '    others = sum(1 for x in clients if isinstance(x, dict) and x.get("armed"))', 'tool', ''),
 ('t_guard_ip_filter', '/home/cnc/claude-work/bpc/drive2.py', '    others = sum(1 for x in clients if isinstance(x, dict) and x.get("armed")) - (1 if c.env.get("armed") else 0)', '    others = sum(1 for x in clients if isinstance(x, dict) and x.get("armed") and x.get("ip") not in bpc.LOCAL)', 'tool', ''),
 ('t_trip_sticky', '/home/cnc/claude-work/bpc/drive2.py', '"safety_trip": d.get("safety_trip")}', '"safety_trip": d.get("safety_trip") or (self.env or {}).get("safety_trip")}', 'tool', ''),
 ('t_stale_ignored', '/home/cnc/claude-work/bpc/drive2.py', '    if c.env is None or time.monotonic() - c.env_at > ENV_STALE_S:\n        return "no fresh status envelope', '    if c.env is None:\n        return "no fresh status envelope', 'tool', ''),
 ('t_guard_never_cancels', '/home/cnc/claude-work/bpc/drive2.py', '            why.append(b)\n            seq.cancel()\n', '            why.append(b)\n', 'tool', ''),
 ('t_wd_last_dump', '/home/cnc/claude-work/bpc/bpc2.py', '    t0 = anchor["wall_ns"] - anchor["wd_ms"] * 10**6', '    t0 = anchor["wall_ns"] - int(re.findall(r"\\[HB-DUMP\\] \\+(\\d+)ms reason=trip_reset", wd_text)[-1]) * 10**6', 'tool', ''),
 ('t_wd_no_step_check', '/home/cnc/claude-work/bpc/bpc2.py', '    if steps:\n', '    if steps and False:\n', 'tool', ''),
 ('t_wd_no_instance_check', '/home/cnc/claude-work/bpc/bpc2.py', '    if line not in wd_text[anchor["wd_log_bytes"]:]:', '    if False:', 'tool', ''),
 ('t_wd_no_tick_check', '/home/cnc/claude-work/bpc/bpc2.py', '    if not ticks or ticks[0] > a + 2e9 or ticks[-1] < b - 2e9 or (holes and max(holes) > 3e9):', '    if not ticks:', 'tool', ''),
 ('t_wd_no_anchor_pass', '/home/cnc/claude-work/bpc/bpc2.py', '    if anchor is None:\n        return {"status": "not proven", "why": "no anchor (drive2\'s own E-Stop reset)"}', '    if anchor is None:\n        return {"status": "bound", "statement": "no anchor"}', 'tool', ''),
 ('t_rss_no_coverage', '/home/cnc/claude-work/bpc/bpc2.py', '    if not gw or gw[0][0] > a + 1e9 or gw[-1][0] < b - 1e9 or (holes and max(holes) > 1e9):', '    if not gw:', 'tool', ''),
 ('t_s_ignores_rss', '/home/cnc/claude-work/bpc/bpc2.py', '    if rss.get("status") != "sampled":\n        why.append("workers alive at once not collected")\n    elif rss["workers_at_once_max"] > 1:', '    if rss.get("status") == "sampled" and rss["workers_at_once_max"] > 1:', 'tool', ''),
 ('r184_rt_newest_sent', 'lcnc-webui/src/viewerPerf.ts', "  const sentAt = typeof hbSeq === 'number' ? _hbSent.get(hbSeq) : undefined;", "  const sentAt = typeof hbSeq === 'number' ? [..._hbSent.values()].pop() : undefined;", 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r184_rt_not_forgotten', 'lcnc-webui/src/viewerPerf.ts', "  if (typeof hbSeq === 'number') for (const k of [..._hbSent.keys()]) if (k <= hbSeq) _hbSent.delete(k);\n", '', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r184_vis_not_counted', 'lcnc-webui/src/viewerPerf.ts', '  _visChangedAt = atEpochMs;\n  _visChanges++;\n', '  _visChangedAt = atEpochMs;\n', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r184_rt_no_seq_sent', 'lcnc-webui/src/lcncWs.ts', 'noteHeartbeatSentAt(m.at, m.seq);', 'noteHeartbeatSentAt(m.at, undefined);', 'e2e', 'e2e/frames.spec.ts::perf rows carry'),
 ('r184_rt_no_seq_reply', 'lcnc-webui/src/lcncWs.ts', 'noteHeartbeatReply(rx, msg.timing.server_ms, msg.timing.hb_seq, msg.timing.g_mono_ms, msg.timing.g_pid);', 'noteHeartbeatReply(rx, msg.timing.server_ms, undefined, msg.timing.g_mono_ms, msg.timing.g_pid);', 'e2e', 'e2e/frames.spec.ts::perf rows carry'),
 ('r184_worker_seq_mismatch', 'lcnc-webui/src/wsWorker.ts', '        ws.send(`{"cmd":"heartbeat","seq":${seq}}`);\n        post({ type: "hbsent", at, seq });', '        ws.send(`{"cmd":"heartbeat","seq":${seq}}`);\n        post({ type: "hbsent", at, seq: seq + 1000 });', 'e2e', 'e2e/frames.spec.ts::perf rows carry'),
 ('r184_gw_no_echo', 'lcnc-gateway/gateway.py', '                                status_msg["timing"]["hb_seq"] = _clients[client_id].hb_seq', '                                status_msg["timing"]["hb_seq"] = None', 'py', 'test_ws_smoke.py::TestHeartbeatTimingNamesItsHeartbeat'),
 ('r184_gw_bool_seq', 'lcnc-gateway/gateway.py', '_hb_seq if isinstance(_hb_seq, int) and not isinstance(_hb_seq, bool)', '_hb_seq if isinstance(_hb_seq, int)', 'py', 'test_ws_smoke.py::TestHeartbeatTimingNamesItsHeartbeat'),
 ('r184_parse_seen_dropped', 'lcnc-webui/src/ws/statusStore.ts', '  _noteParseSeen(_frameHadRefresh ? prWire : null, rx);', '  _noteParseSeen(null, rx);', 'ts', 'src/ws/parseSeen.test.ts'),
 ('r184_parse_seen_e2e', 'lcnc-webui/src/ws/statusStore.ts', '  _noteParseSeen(_frameHadRefresh ? prWire : null, rx);', '  _noteParseSeen(_frameHadRefresh ? null : null, rx);', 'e2e', 'e2e/frames.spec.ts::the page reports the parse it sees in flight'),
 ('r184_sweep_no_run_gen', 'lcnc-webui/src/ThreeViewer.vue', 'id, run_gen: run?.gen ?? null, range_from: run?.range?.from ?? null,', 'id, run_gen: run ? null : null, range_from: run?.range?.from ?? null,', 'e2e', 'e2e/collisions.viewer.spec.ts::a parse made for the run is checked during it::serial-viewer'),
 ('r184_sweep_done_no_id', 'lcnc-webui/src/ThreeViewer.vue', '        id: m.id, run_gen: _colReqRunGen,\n        ms: Math.round(performance.now() - _colStartedAt),', '        id: -m.id, run_gen: _colReqRunGen,\n        ms: Math.round(performance.now() - _colStartedAt),', 'e2e', 'e2e/collisions.viewer.spec.ts::a parse made for the run is checked during it::serial-viewer'),
 ('t_not_still_idle_only', '/home/cnc/claude-work/bpc/drive2.py', '    if st.get("inpos") is not True or not isinstance(v, (int, float)) or abs(v) > 0.001:', '    if False:', 'tool', ''),
 ('t_anchor_no_still_check', '/home/cnc/claude-work/bpc/drive2.py', '    why = not_still(c)\n    if why:\n        raise Stop(f"no E-Stop for the anchor: {why}")\n', '', 'tool', ''),
 ('t_s_extra_ignored', '/home/cnc/claude-work/bpc/bpc2.py', '    if extra:\n        why.append', '    if extra and False:\n        why.append', 'tool', ''),
 ('t_s_basis_unchecked', '/home/cnc/claude-work/bpc/bpc2.py', '        if j["idx"] != idx.get(sw.get("to")) or j["basis"] != sw.get("basis"):', '        if j["idx"] != idx.get(sw.get("to")):', 'tool', ''),
 ('t_s_no_log_pass', '/home/cnc/claude-work/bpc/bpc2.py', '    if not switches:\n        return {"verdict": "S not met", "why": ["no switch log (supersede.json)"]}', '    if not switches:\n        return {"verdict": "S met", "why": []}', 'tool', ''),
 ('t_rows_coverage_ignored', '/home/cnc/claude-work/bpc/bpc2.py', '    coverage = {"complete": not gaps,', '    coverage = {"complete": True,', 'tool', ''),
 ('t_rows_vis_changes_kept', '/home/cnc/claude-work/bpc/bpc2.py', 'else "visibility_changed" if r.get("vis_changes", 0)', 'else "visibility_changed" if False', 'tool', ''),
 ('t_target_edges', '/home/cnc/claude-work/bpc/bpc2.py', '    if met_in is None or met_all != met_in:', '    if met_in is None:', 'tool', ''),
 ('r186_t0_after_parse', 'lcnc-gateway/gcode_parse_worker.py', '    print(f"__PARSE_T0__\\t{time.monotonic_ns()}", file=err, flush=True)\n    result = parse(ctx)\n', '    result = parse(ctx)\n    print(f"__PARSE_T0__\\t{time.monotonic_ns()}", file=err, flush=True)\n', 'py', 'test_parse_span.py'),
 ('r186_t1_before_parse', 'lcnc-gateway/gcode_parse_worker.py', '    result = parse(ctx)\n    print(f"__PARSE_T1__\\t{time.monotonic_ns()}", file=err, flush=True)\n', '    print(f"__PARSE_T1__\\t{time.monotonic_ns()}", file=err, flush=True)\n    result = parse(ctx)\n', 'py', 'test_parse_span.py'),
 ('r186_t1_invented', 'lcnc-gateway/gcode_parse_worker.py', '    result = parse(ctx)\n    print(f"__PARSE_T1__\\t{time.monotonic_ns()}", file=err, flush=True)\n', '    try:\n        result = parse(ctx)\n    finally:\n        print(f"__PARSE_T1__\\t{time.monotonic_ns()}", file=err, flush=True)\n', 'py', 'test_parse_span.py'),
 ('r186_span_not_emitted', 'lcnc-gateway/bulk_pipeline.py', '            if _span["p0_ns"] is not None:\n', '            if False:\n', 'py', 'test_bulk_pipeline.py::TestCancelInflight'),
 ('r186_span_not_when_cancelled', 'lcnc-gateway/bulk_pipeline.py', '            if _span["p0_ns"] is not None:\n', '            if _span["p0_ns"] is not None and self.cancel_reason is None:\n', 'py', 'test_bulk_pipeline.py::TestCancelInflight'),
 ('r186_span_cancel_unnamed', 'lcnc-gateway/bulk_pipeline.py', '                            **({"cancelled": self.cancel_reason} if self.cancel_reason is not None else {}))', '                            **({}))', 'py', 'test_bulk_pipeline.py::TestCancelInflight'),
 ('r186_span_last_wins', 'lcnc-gateway/bulk_pipeline.py', '            if ln.startswith(tag) and span[key] is None:', '            if ln.startswith(tag):', 'py', 'test_bulk_pipeline.py::TestCancelInflight'),
 ('r186_span_worker_log', 'lcnc-gateway/bulk_pipeline.py', '                    elif ln.startswith("__PARSE_T"):\n                        pass   # the parse call\'s bounds: gcode.parse_span above\n', '', 'py', 'test_bulk_pipeline.py::TestCancelInflight'),
 ('r186_refresh_no_job', 'lcnc-gateway/bulk_pipeline.py', '                "job": inf.get("job"),', '                "job": None,', 'py', 'test_bulk_pipeline.py::TestCancelInflight'),
 ('r186_g_early', 'lcnc-gateway/gateway.py', '                        _g_mono = time.monotonic()', '                        _g_mono = time.monotonic() - 0.5', 'py', 'test_ws_smoke.py::TestHeartbeatTimingNamesItsHeartbeat'),
 ('r186_g_seconds', 'lcnc-gateway/gateway.py', '                            "g_mono_ms": round(_g_mono * 1000, 3),', '                            "g_mono_ms": round(_g_mono, 3),', 'py', 'test_ws_smoke.py::TestHeartbeatTimingNamesItsHeartbeat'),
 ('r186_g_no_pid', 'lcnc-gateway/gateway.py', '                            "g_pid": os.getpid(),', '                            "g_pid": 0,', 'py', 'test_ws_smoke.py::TestHeartbeatTimingNamesItsHeartbeat'),
 ('r186_pairs_invalid_kept', 'lcnc-webui/src/viewerPerf.ts', '  if (!(net >= 0)) { _rtInvalid++; return; }', "  if (!(net >= 0)) { _rtInvalid++; if (typeof gMonoMs === 'number') _hbPairs.push([hbSeq as number, sentAt as number, rxEpochMs as number, gMonoMs, gPid as number]); return; }", 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r186_pairs_not_reset', 'lcnc-webui/src/viewerPerf.ts', '  _hbPairs.length = 0; _hbPairsDropped = 0;', '  _hbPairsDropped = 0;', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r186_pairs_hs_hr_swapped', 'lcnc-webui/src/viewerPerf.ts', '_hbPairs.push([hbSeq as number, sentAt as number, rxEpochMs as number, gMonoMs, gPid]);', '_hbPairs.push([hbSeq as number, rxEpochMs as number, sentAt as number, gMonoMs, gPid]);', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r186_pairs_uncapped', 'lcnc-webui/src/viewerPerf.ts', '    if (_hbPairs.length < HB_PAIRS_MAX) _hbPairs.push(', '    if (_hbPairs.length < HB_PAIRS_MAX * 1000) _hbPairs.push(', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('r186_pairs_no_g', 'lcnc-webui/src/lcncWs.ts', 'noteHeartbeatReply(rx, msg.timing.server_ms, msg.timing.hb_seq, msg.timing.g_mono_ms, msg.timing.g_pid);', 'noteHeartbeatReply(rx, msg.timing.server_ms, msg.timing.hb_seq, undefined, msg.timing.g_pid);', 'e2e', 'e2e/frames.spec.ts::perf rows carry'),
 ('r186_seen_by_start', 'lcnc-webui/src/ws/statusStore.ts', '  const key = job !== null ? `j${job}` : `s${started}`;', '  const key = `s${started}`;', 'ts', 'src/ws/parseSeen.test.ts'),
 ('r186_seen_close_kept', 'lcnc-webui/src/ws/statusStore.ts', '  _parseSeenOff(null, "closed");\n', '', 'ts', 'src/ws/parseSeen.test.ts'),
 ('r186_seen_no_off_on_switch', 'lcnc-webui/src/ws/statusStore.ts', '  _parseSeenOff(rxMs);\n  _parseSeen = { key', '  _parseSeen = { key', 'ts', 'src/ws/parseSeen.test.ts'),
 ('r186_wit_every_slice', 'lcnc-webui/src/viewer/collisionWorker.ts', '  if (b === wt.bucket) return;\n', '', 'ts', 'src/viewer/collisionWorker.test.ts'),
 ('r186_wit_no_time_origin', 'lcnc-webui/src/viewer/collisionWorker.ts', 'witnessNote(run.witness, performance.timeOrigin + run.sliceStart, performance.timeOrigin + sliceEnd)', 'witnessNote(run.witness, run.sliceStart, sliceEnd)', 'ts', 'src/viewer/collisionWorker.test.ts'),
 ('r186_wit_no_end_flush', 'lcnc-webui/src/viewer/collisionWorker.ts', '      witnessFlush(id, run.witness, true);\n      if (slice.cancelled)', '      if (slice.cancelled)', 'ts', 'src/viewer/collisionWorker.test.ts'),
 ('r186_wit_pool_dropped', 'lcnc-webui/src/viewer/collisionWorker.ts', '  if (m.witness) { self.postMessage({ id: m.id, witness: { ...m.witness, shard: k } }); return; }', '  if (m.witness) return;', 'ts', 'src/viewer/collisionWorker.test.ts'),
 ('r186_wit_shard_unnamed', 'lcnc-webui/src/viewer/collisionWorker.ts', 'witness: { ...m.witness, shard: k } }', 'witness: { ...m.witness } }', 'ts', 'src/viewer/collisionWorker.test.ts'),
 ('r186_wit_no_at', 'lcnc-webui/src/viewer/collisionWorker.ts', 'witness: { ...wt.w, at: performance.timeOrigin + performance.now() } }', 'witness: { ...wt.w } }', 'ts', 'src/viewer/collisionWorker.test.ts'),
 ('r186_wit_not_asked', 'lcnc-webui/src/ThreeViewer.vue', '    ...(witness ? { witness: true } : {}),\n', '    ...(witness && false ? { witness: true } : {}),\n', 'e2e', 'e2e/collisions.viewer.spec.ts::a parse made for the run is checked during it::serial-viewer'),
 ('r186_wit_page_dropped', 'lcnc-webui/src/ThreeViewer.vue', '      if (m.witness) { _colNoteWitness(m.id, m.witness); return; }', '      if (m.witness) { if (m.id < 0) _colNoteWitness(m.id, m.witness); return; }', 'e2e', 'e2e/collisions.viewer.spec.ts::a parse made for the run is checked during it::serial-viewer'),
 ('r186_wit_ahead_flipped', 'lcnc-webui/src/ThreeViewer.vue', 'w.at - (performance.timeOrigin + performance.now())', '(performance.timeOrigin + performance.now()) - w.at + 50', 'e2e', 'e2e/collisions.viewer.spec.ts::a parse made for the run is checked during it::serial-viewer'),
 ('r186_win_start_kept', 'lcnc-webui/src/viewerPerf.ts', '  _winStart = winEnd;\n', '', 'ts', 'src/viewerPerf.test.ts src/statusAge.test.ts'),
 ('t186_row_nominal_window', '/home/cnc/claude-work/bpc/bpc2.py', '    w = r.get("win_ms") if isinstance(r.get("win_ms"), (int, float)) else r.get("window_ms", 3000)', '    w = r.get("window_ms", 3000)', 'tool', ''),
 ('t186_g_inside_unchecked', '/home/cnc/claude-work/bpc/bpc2.py', 'p["pid"] == sp.get("pid") and lo_g < p["g"] < hi_g)', 'p["pid"] == sp.get("pid"))', 'tool', ''),
 ('t186_pid_unchecked', '/home/cnc/claude-work/bpc/bpc2.py', 'p["pid"] == sp.get("pid") and lo_g < p["g"] < hi_g)', 'lo_g < p["g"] < hi_g)', 'tool', ''),
 ('t186_no_margin', '/home/cnc/claude-work/bpc/bpc2.py', 'PAGE_STAMP_MS = 2.0', 'PAGE_STAMP_MS = 0.0', 'tool', ''),
 ('t186_window_wide', '/home/cnc/claude-work/bpc/bpc2.py', 'w0, w1 = A["hr"] + PAGE_STAMP_MS, B["hs"] - PAGE_STAMP_MS', 'w0, w1 = A["hs"] + PAGE_STAMP_MS, B["hr"] - PAGE_STAMP_MS', 'tool', ''),
 ('t186_ahead_words_kept', '/home/cnc/claude-work/bpc/bpc2.py', '        if not isinstance(r.get("ahead_ms"), (int, float)) or r["ahead_ms"] > PAGE_STAMP_MS:', '        if False:', 'tool', ''),
 ('t186_ws_ahead_kept', '/home/cnc/claude-work/bpc/bpc2.py', '            if page in ahead_pages:\n                continue\n', '', 'tool', ''),
 ('t186_idle_slices', '/home/cnc/claude-work/bpc/bpc2.py', ' or r.get("run_gen") is None:', ':', 'tool', ''),
 ('t186_cross_page', '/home/cnc/claude-work/bpc/bpc2.py', '                        if sl["page"] != page:\n                            continue\n', '', 'tool', ''),
 ('t186_no_end_needed', '/home/cnc/claude-work/bpc/bpc2.py', '        if p0 is None or p1 is None:', '        if p0 is None:', 'tool', ''),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak186")
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
