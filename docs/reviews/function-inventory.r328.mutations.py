"""G2 red-check: each mutant applied to a SLIM COPY of the worktree (scripts,
examples, subroutines, the gateway's sim tool setter test), the G2 guards
run; the copy restored from its backup after each mutant."""
import json, pathlib, shutil, subprocess, sys
SRC = pathlib.Path("/home/cnc/lcnc-suite-g1")
T = pathlib.Path("/home/cnc/claude-work/g2/tree")
PY = str(SRC / "lcnc-gateway/.venv/bin/python3")
if T.exists():
    shutil.rmtree(T)
for d in ("scripts", "examples", "subroutines"):
    shutil.copytree(SRC / d, T / d, ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
(T / "lcnc-gateway").mkdir(parents=True)
shutil.copy(SRC / "lcnc-gateway/test_sim_toolsetter.py", T / "lcnc-gateway")
NATIVE_K = ("plate_is_instance_0 or scan_is_the_grid or scan_counters or map_reload_needs or reference_follows or "
            "each_method_is or wrong_reference or not_one_is_incomplete or on_off_and_after or pair_reports or "
            "settled_window or signals_parse or fixture_check or constants_are_the_literal or releases_the_override "
            "or shipped_scan_frees or surface_step or expected_wiring or compensation_on_turns or measured_position "
            "or unknown_map_version or three_readings or confirmed_enable or override_free or process_mapped "
            "or g54_x_y")
HAL, NR, NC = "examples/sim_config/hallib/", "scripts/native_run.py", "scripts/test_support/native_cases.py"
M = [
 ("hal-instance-0-first", [(HAL + "sim_toolsetter.hal", "addf sim-toolsetter.1 servo-thread\naddf sim-toolsetter.0 servo-thread",
                            "addf sim-toolsetter.0 servo-thread\naddf sim-toolsetter.1 servo-thread")]),
 ("hal-chain-appended", [(HAL + "sim_surface.hal", "addf surf-z     servo-thread -3", "addf surf-z     servo-thread")]),
 ("hal-constant-off", [(HAL + "sim_surface.hal", "setp surf-curve.gain1 -0.0024", "setp surf-curve.gain1 -0.0025")]),
 ("hal-manual-to-0", [(HAL + "sim_toolsetter.hal", "net probe-in => sim-toolsetter.1.manual\nnet sim-ts-pass sim-toolsetter.1.out => sim-toolsetter.0.manual",
                       "net probe-in => sim-toolsetter.0.manual")]),
 ("hal-height-set", [(HAL + "sim_surface.hal", "net surf-height surf-z.out => sim-toolsetter.1.plate-z", "setp sim-toolsetter.1.plate-z -169")]),
 ("hal-5axis-surface", [(HAL + "core_sim_5.hal", "source hallib/sim_toolsetter.hal\n", "source hallib/sim_toolsetter.hal\nsource hallib/sim_surface.hal\n")]),
 ("ngc-early-release", [("subroutines/surfacemap/surface_scan.ngc",
                         "  G0 G53 Z0               (Return to machine Z0)\n  G0 X#<x0> Y#<y0>        (Return to start position)\n  ; The override stays locked through the return: the scan's lock covers\n  ; every move of the routine, freed only after its last (Codex R326 FI326-01)\n  M50 P1                  (Restore feedrate override)",
                         "  M50 P1                  (Restore feedrate override)\n  G0 G53 Z0               (Return to machine Z0)\n  G0 X#<x0> Y#<y0>        (Return to start position)")]),
 ("nc-scan-no-order", [(NC, "        if abs(p[0] - x) > GRID_TOL or abs(p[1] - y) > GRID_TOL:", "        if False:")]),
 ("nc-scan-no-count", [(NC, "    if len(points) != len(grid):", "    if False:")]),
 ("nc-cubic-no-reference", [(NC, "    if abs(e - refs[method]) > tol:", "    if method != \"cubic\" and abs(e - refs[method]) > tol:")]),
 ("nc-linear-no-edge", [(NC, "    if method == \"linear\" and abs(e - (0.75 * z0 + 0.25 * z1)) > tol:", "    if False:")]),
 ("nc-nearest-no-node", [(NC, "    if method == \"nearest\" and abs(e - z0) > tol:", "    if False:")]),
 ("nc-cubic-no-curvature", [(NC, "        if abs(e - f_dev) >= abs(lin - f_dev):", "        if False:")]),
 ("nc-no-discrimination", [(NC, "    if min(gaps) < METHOD_GAP:", "    if False:")]),
 ("nc-off-residual-ok", [(NC, "    elif abs(e) >= OFF_EOFFSET:", "    elif False:")]),
 ("nc-gap-unchecked", [(NC, "    if abs(gap - gap_expected) > gap_tol:", "    if False:")]),
 ("nc-joint-unchecked", [(NC, "    if abs((reading[\"joint_z\"] - e) - z_control) > tol:\n        return _row(case, \"FAIL\", f\"joint Z − offset {reading['joint_z'] - e:.4f}, commanded {z_control:g}\",\n                    **measured)\n    if abs(e - refs",
                          "    if abs(e - refs")]),
 ("nc-settle-no-gap", [(NC, "        if t_prev - t > gap:\n            return None", "        pass")]),
 ("nc-settle-no-version", [(NC, "                and v[4] == first[4]):", "                ):")]),
 ("nc-reference-raw-q", [(NC, "    v = float(griddata((xs, ys), zs, [node], method=method)[0])", "    v = float(griddata((xs, ys), zs, [tuple(q)], method=method)[0])")]),
 ("nc-pair-first-wins", [(NC, "    for want in (\"FAIL\", \"incomplete\"):\n        r = next((r for r in parts if r[\"status\"] == want), None)\n        if r is not None:\n            return {**_row(case, want, r[\"detail\"]), \"readings\": list(parts)}", "    for r in parts:\n        if r[\"status\"] != \"PASS\":\n            return {**_row(case, r[\"status\"], r[\"detail\"]), \"readings\": list(parts)}")]),
 ("nr-plate-any-instance", [(NR, r'setp\s+sim-toolsetter\.0\.plate-([xyz])', r'setp\s+\S+\.plate-([xyz])')]),
 ("nr-fixture-no-order", [(NR, "    elif idx != sorted(idx):", "    elif False:")]),
 ("nr-fixture-no-readers", [(NR, "        if missing:\n            problems.append", "        if False:\n            problems.append")]),
 ("nr-no-method-switch", [(NR, "            sw = {\"to\": m, **_comp_method(c, m)}", "            sw = {\"to\": m, \"confirmed\": True}")]),
 ("nr-after-xy-no-move", [(NR, "    _at(c, COMP_B, feed=COMP_FEED)\n", "")]),
 ("nr-map-not-waited", [(NR, "    rows.append(nc.eval_map_reload(\"surface-scan.map\", v_before, c.status.get(\"comp_grid_version\")))",
                         "    rows.append(nc.eval_map_reload(\"surface-scan.map\", v_before, v_before))")]),
 ("nr-at-always-z", [(NR, "    if feed is None and not (nc._finite(jp[2], e) and abs(jp[2] - e - control) <= AT_TOL):", "    if feed is None:")]),
 ("nr-pre-move-unchecked", [(NR, "        if pre[\"status\"] != \"PASS\":", "        if False:")]),
 ("nr-drain-unchecked", [(NR, "    if not r.get(\"settled\"):\n        raise _Unconfirmed(what, r)\n    return r", "    return r")]),
 ("nc-site-unchecked", [(NC, "    x, y = reading.get(\"x\"), reading.get(\"y\")\n    if not _finite(x, y):", "    return None\n    x, y = reading.get(\"x\"), reading.get(\"y\")\n    if not _finite(x, y):")]),
 ("nc-window-version-unknown-ok", [(NC, "    if not (_finite(*first) and cond(last)):", "    if not (_finite(*first[:4]) and cond(last)):"),
                                   (NC, "        if not (cond(st) and _finite(*v) and", "        if not (cond(st) and _finite(*v[:4]) and")]),
 ("nc-read-version-unknown-ok", [(NC, "    if not _finite(reading.get(\"version\")):", "    if False:")]),
 ("nc-window-xy-unchecked", [(NC, "all(abs(a - b) <= tol for a, b in zip(v[:4], first[:4]))", "all(abs(a - b) <= tol for a, b in zip(v[3:4], first[3:4])) and abs(v[0] - first[0]) <= tol")]),
 ("nr-override-unconfirmed", [(NR, "    _short(c, \"M50 P1\")\n    i0, end", "    _short(c, \"M50 P1\")\n    return {}\n    i0, end"),
                              (NR, "    if st.get(\"feed_override_enabled\") is not True:\n        errors.append", "    if False:\n        errors.append")]),
 ("nr-scipy-any-root", [(NR, "    if len(roots) != 1:", "    if not roots:")]),
 ("nr-basis-no-xy", [(NR, "                or any(not nc._finite(v) or abs(v) > nc.SAME for v in basis[\"g5x_offset\"][:2])\n", "")]),
 ("nr-no-cleanup-off", [(NR, "    for what, fn in ((\"off\", lambda: _comp_off(ctx, c)),", "    for what, fn in ((\"off\", lambda: {\"settled\": True}),")]),
]
files = sorted({f for _, eds in M for f, _, _ in eds})
bak = {f: (T / f).read_text() for f in files}
out = []
def run():
    a = subprocess.run([PY, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", "test_native_stage.py", "-k", NATIVE_K],
                       cwd=T / "scripts", capture_output=True, text=True, timeout=900)
    b = subprocess.run([PY, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", "test_sim_toolsetter.py"],
                       cwd=T / "lcnc-gateway", capture_output=True, text=True, timeout=300)
    return a.returncode, b.returncode, (a.stdout + b.stdout).strip().splitlines()[-1:]
try:
    base = run()
    print("baseline", base, flush=True)
    assert base[:2] == (0, 0), "the baseline must be green"
    for name, eds in [m for m in M if len(sys.argv) < 3 or m[0] in sys.argv[2:]]:
        for f in files:
            (T / f).write_text(bak[f])
        ok = True
        for f, a, b in eds:
            t = (T / f).read_text()
            if t.count(a) != 1:
                ok = False
                break
            (T / f).write_text(t.replace(a, b))
        if not ok:
            out.append({"mutant": name, "verdict": "ANCHOR"}); print(name, "ANCHOR", flush=True); continue
        rn, rg, tail = run()
        verdict = "RED" if (rn or rg) else "GREEN"
        out.append({"mutant": name, "verdict": verdict, "native_stage": rn, "sim_toolsetter": rg, "tail": tail})
        print(name, verdict, tail, flush=True)
finally:
    for f in files:
        (T / f).write_text(bak[f])
    pathlib.Path(sys.argv[1]).write_text(json.dumps({"base": "R328", "mutants": out}, indent=1) + "\n")
