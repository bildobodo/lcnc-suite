"""R178 (Codex R177 VP-I130: a limit record is bound to its motion and its origin — the gateway's records carry `sub` / `site` and seq runs, the client places them by seq): each mutation must turn the named tests red. ts = vue-tsc (app) must compile, then vitest on the named files;
e2e = build, then Playwright -g; py = pytest in lcnc-gateway. Restores from a byte copy. `--dry` checks the anchors only."""
import os, shutil, subprocess, sys, time
R = os.environ.get("MUT_TREE", "/home/cnc/lcnc-suite-mut")
W = R + "/lcnc-webui"
S = os.path.expanduser("~/claude-work/form1/bak")
G = "lcnc-gateway"
GU = G + "/gateway_util.py"
GW = G + "/gcode_parse_worker.py"
T_GU = "test_gateway_util.py::TestLimitRecordOrigin"
T_GV = "test_gateway_util.py::TestVectorizedLimitChecks"
T_NW = "test_limit_origin_worker.py"
LP = "lcnc-webui/src/viewer/limitPlaces.ts"
STK = "lcnc-webui/src/viewer/scrubTrack.ts"
SB = "lcnc-webui/src/ScrubBar.vue"
T_LP = "src/viewer/limitPlaces.test.ts src/viewer/limitOriginPayloads.test.ts"
E_SP = "e2e/sim-panel.viewer.spec.ts"
M = [
 # the gateway: one record per origin, raw line and axis, with its stretches
 ("r178_scope_dropped", GU, "            key = (linenos[i], letter, scope)", "            key = (linenos[i], letter, None)", "py", T_GU),
 ("r178_runs_one", GU, "        if runs and q == runs[-1][1] + 1:", "        if runs:", "py", T_GU),
 ("r178_scope_outer_name", GU, "        states.append((names[-1], callers[0]) if names else None)", "        states.append((names[0], callers[0]) if names else None)", "py", T_GU),
 ("r178_scope_inner_caller", GU, "        states.append((names[-1], callers[0]) if names else None)", "        states.append((names[-1], callers[-1]) if names else None)", "py", T_GU),
 ("r178_scope_marker_seq", GU, "        k = bisect.bisect_left(ev_seqs, seq)", "        k = bisect.bisect_right(ev_seqs, seq)", "py", T_GU),
 ("r178_merge_origin", GU, '        key = (rec["line"], rec["axis"], rec.get("sub"), rec.get("site"))', '        key = (rec["line"], rec["axis"], None, None)', "py", T_GU),
 ("r178_merge_runs_worst", GU, '            rec["runs"] = merged[k][:LIMIT_RUN_CAP]', '            rec["runs"] = list(worst[k].get("runs", []))[:LIMIT_RUN_CAP]', "py", T_GU),
 ("r178_run_cap", GU, '            out["runs"] = runs[k][:LIMIT_RUN_CAP]', '            out["runs"] = runs[k]', "py", T_GU),
 ("r178_order_by_line", GU, "    keys = sorted(worst, key=lambda k: (runs[k][0][0] if k in runs else -1, k[0],", "    keys = sorted(worst, key=lambda k: (-1, k[0],", "py", T_GU),
 ("r178_trsrn_scalar_scope", GU, "        lineno, start, end, tlo, ktype, frame = sg[0], sg[1], sg[2], sg[3], sg[4], sg[5]\n        seq = _segment_seq(sg, 6)", "        lineno, start, end, tlo, ktype, frame = sg[0], sg[1], sg[2], sg[3], sg[4], sg[5]\n        seq = _segment_seq(sg, 7)", "py", T_GV),
 # the worker: the identity records bound, the call sites kept, the stretches' ends kept
 ("r178_worker_scope_none", GW, "            _identity_segs(), axis_limits, unit_scale, scope_of=_limit_scope)", "            _identity_segs(), axis_limits, unit_scale, scope_of=None)", "py", T_NW),
 ("r178_worker_no_seq", GW, "                    yield _lineno, dep_nan(_start, _b), dep_nan(_end, _a), _tlo, _seq", "                    yield _lineno, dep_nan(_start, _b), dep_nan(_end, _a), _tlo", "py", T_NW),
 ("r178_worker_no_anchor", GW, "        if _limit_bounds:\n            # both ends", "        if False and _limit_bounds:\n            # both ends", "py", T_NW),
 ("r178_worker_no_rapid_anchor", GW, "        if _limit_bounds:\n            r_anchors", "        if False and _limit_bounds:\n            r_anchors", "py", T_NW),
 # Codex R177 answer 2: the poll loop's wiring of the pinned parse's end
 ("r178_poll_idle_inverted", "lcnc-gateway/gateway.py", "                    _bulk.inflight, st.interp_state == linuxcnc.INTERP_IDLE)) is not None", "                    _bulk.inflight, st.interp_state != linuxcnc.INTERP_IDLE)) is not None", "py", "test_preview_poll_chain.py"),
 ("r178_poll_cancel_dropped", "lcnc-gateway/gateway.py", "            ):\n                _bulk.cancel_inflight(_ended)", "            ):\n                pass", "py", "test_preview_poll_chain.py"),
 ("r178_worker_caller_reset", GW, "    feed_cline = rapid_cline = None\n    if canon.sub_events:", "    feed_cline = rapid_cline = None\n    _caller_map = {}\n    if canon.sub_events:", "py", T_NW),
 # the client: placed by seq, read on its own track, its line from the program's view
 ("r178_place_by_raw_line", LP, "          const i0 = lowerBound(seq, r0);", "          const i0 = Math.max(0, base.lines.indexOf(v.line));", "ts", T_LP),
 ("r178_line_raw", LP, "    const shown = displayLineForPoint(base, i, trusted);", "    const shown = { line: (base.lines[i] ?? 0) || null, subName: displayLineForPoint(base, i, trusted).subName };", "ts", T_LP),
 ("r178_band_from_end", LP, "          const a = at(Math.max(0, i0 - 1)), b = at(i1);", "          const a = at(i0), b = at(i1);", "ts", T_LP),
 ("r178_key_line_only", LP, "    const t: LimitTarget = { key: `L${shown.line ?? 0}@${first.q}`, line: shown.line ?? 0,", "    const t: LimitTarget = { key: `L${shown.line ?? 0}`, line: shown.line ?? 0,", "ts", T_LP),
 ("r178_group_by_line", LP, "const groupKey = (v: LimitViolation) => `${v.sub ?? \"\"}\\u0000${v.sub != null ? v.site ?? 0 : 0}\\u0000${v.line}`;", "const groupKey = (v: LimitViolation) => `${v.line}`;", "ts", T_LP),
 ("r178_code_mark_raw", LP, "  const line = v.sub != null ? v.site ?? 0 : v.line;", "  const line = v.line;", "ts", T_LP),
 ("r178_track_seq_dropped", STK, "           ...(mergedSeq ? { seq: mergedSeq } : {}),", "", "ts", T_LP),
 ("r178_placeless_dropped", SB, "  const placeless = listKinds.value.includes(\"limit\") ? placelessLimitRows(limitPlace.value.placeless, linearUnit.value) : [];", "  const placeless = listKinds.value.includes(\"limit\") ? placelessLimitRows([], linearUnit.value) : [];", "e2e", E_SP + "::a limit row stands at its own move"),
 ("r178_bands_widened", SB, "  return mergeSpans(limitPlace.value.bands.map(([a, b]) => [(a / max) * 100, (b / max) * 100]));", "  return mergeSpans(limitPlace.value.bands.map(([a, b]) => [Math.max(0, (a / max) * 100 - 20), (b / max) * 100]));", "e2e", E_SP + "::a limit row stands at its own move"),
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
    bak = os.path.join(S, os.path.basename(f) + ".mutbak178")
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
