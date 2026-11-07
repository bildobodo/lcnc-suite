"""Package I red-check: each mutant applied to a SLIM COPY (scripts, install.sh,
examples; lcnc-webui linked read-only for the browser test's Playwright), the
install probe's guards run; the copy restored after each mutant.
usage: python3 inst_mut.py <out.json> [mutant names]"""
import json, pathlib, shutil, subprocess, sys
SRC = pathlib.Path("/home/cnc/lcnc-suite-g1")
T = pathlib.Path("/home/cnc/claude-work/g2/itree")
PY = str(SRC / "lcnc-gateway/.venv/bin/python3")
if T.exists():
    shutil.rmtree(T)
for d in ("scripts", "examples"):
    shutil.copytree(SRC / d, T / d, ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
shutil.copy(SRC / "install.sh", T / "install.sh")
(T / "lcnc-webui").symlink_to(SRC / "lcnc-webui")
IC, IP, RG, SH = "scripts/test_support/install_cases.py", "scripts/install_probe.py", "scripts/test_select/round_gate.py", "install.sh"
HL, NR, RL = "scripts/test_support/heavy_lock.py", "scripts/native_run.py", "scripts/test_support/restore_lan.py"
M = [
 ("ic-safety-no-reader-event", [(IC, """    if not any(e.get("tag") == "reader.connected" and e.get("outcome") == "admitted" for e in own):
        missing.append""", """    if False:
        missing.append""")]),
 ("ic-safety-no-reader-values", [(IC, """    elif any(d.get("comp_grid_version") is None for _, _e, d in late):""", """    elif False:""")]),
 ("ic-safety-latch-unclassified-ok", [(IC, """    if latch == "TRUE" and "safety.latch_faulted_on_connect" not in tags:""", """    if False:""")]),
 ("ic-safety-latch-unknown-ok", [(IC, """    elif latch not in ("TRUE", "FALSE"):""", """    elif False:""")]),
 ("ic-safety-no-window", [(IC, """    if len(late) < 3 or late[-1][0] - late[0][0] < SAFETY_WINDOW_S:""", """    if not late:""")]),
 ("ic-safety-any-pid", [(IC, """    own = [e for e in events if e.get("pid") == gw_pid and e.get("proc") == "gateway"]""", """    own = list(events)""")]),
 ("ic-safety-banner-ignored", [(IC, """        if env.get("safety_chain_incomplete"):""", """        if False:""")]),
 ("ic-manifest-follows-links", [(IC, """        if p.is_symlink():
            return "link:" + os.readlink(p)
""", "")]),
 ("ic-cleanup-worktree", [(IC, """        shutil.rmtree(tree)""", """        import subprocess
        subprocess.run(["git", "-C", str(of), "worktree", "remove", "--force", str(tree)])
        shutil.rmtree(tree)""")]),
 ("ic-cleanup-anywhere", [(IC, """        if run is None or not tree.resolve().is_relative_to(run.resolve()) or tree.resolve() == run.resolve():""", """        if run is None:""")]),
 ("ic-env-inherits", [(IC, """    return {
        "HOME": str(home),""", """    return {**os.environ,
        "HOME": str(home),""")]),
 ("ic-gate-ignores-post", [(IC, """    elif restore_post.get("outcome") != "complete":""", """    elif False:""")]),
 ("ic-gate-ignores-isolation", [(IC, """    if r.get("isolation") != []:""", """    if False:""")]),
 ("ic-browser-ignores-connected", [(IC, """    if not result.get("connected"):""", """    if False:""")]),
 ("ic-browser-ignores-responses", [(IC, """    for r in result.get("bad_responses", []):""", """    for r in []:""")]),
 ("ip-unit-first-service", [(IP, """    return parts[-1] if parts else None""", """    return parts[0] if parts else None""")]),
 ("rg-deactivating-is-end", [(RG, """props.get("ActiveState") in ("inactive", "failed"))""", """props.get("ActiveState") != "active")""")]),
 ("rg-deadline-not-stopped", [(RG, """            if now - t0 > probe_s:""", """            if False:""")]),
 ("rg-old-report-accepted", [(RG, """    if report is not None and (report.get("run_id") != run_id or report.get("commit") != sha):""", """    if False:""")]),
 ("rg-shared-run-folder", [(RG, '    run_dir = logs / f"install-probe-{run_id}"', '    run_dir = logs / "install-probe"')]),
 ("rg-head-not-sha", [(RG, """"--commit", sha,""", """"--commit", "HEAD",""")]),
 ("rg-interrupt-leaves-unit", [(RG, """    except BaseException:
        # the gate ends while its probe runs: the probe's own lock holds, but
        # the gate leaves nothing running behind it — stopped, its restore awaited
        stop_and_wait()
        raise""", """    except BaseException:
        raise""")]),
 ("rg-unread-forever", [(RG, """                if now - unread_since > unread_s:""", """                if False:""")]),
 ("rg-probe-in-the-lock", [(RG, """            omitted.append({"check": "browser", "reason": "; ".join(sel["browser"]["reasons"])})

    if a.merge:""", """            omitted.append({"check": "browser", "reason": "; ".join(sel["browser"]["reasons"])})
        if a.merge:
            checks.append(install_probe(logs, sel["head"]))
    if False:""")]),
 ("ip-under-gate-no-lock", [(IP, """    with heavy_lock("install_probe", wait=0):
        report = run(host, steps, a.run_dir)""", """    if True:
        report = run(host, steps, a.run_dir)""")]),
 ("ic-browser-ignores-status", [(IC, """    if not result.get("status_applied"):""", """    if False:""")]),
 ("ic-tree-identity-ignored", [(IC, """        if made != [st.st_dev, st.st_ino]:""", """        if False:""")]),
 ("ic-tree-identity-always-refuses", [(IC, """        if made != [st.st_dev, st.st_ino]:""", """        if True:""")]),
 ("sh-no-tty-check", [(SH, """  elif [[ ! -t 0 ]]; then
    fail "No terminal to ask — re-run with --yes to install these packages"
    exit 1
""", "")]),
 ("sh-no-root-goes-on", [(SH, """  if [[ "$NO_ROOT" -eq 1 ]]; then
    fail "--no-root: these need root — install them, then re-run"
    exit 1
  elif""", """  if""")]),
 ("sh-npm-install", [(SH, """npm ci --loglevel=warn""", """npm install --loglevel=warn""")]),
 ("sh-import-warns", [(SH, """  echo "$_imports" | sed 's/^/      /'
  exit 1""", """  echo "$_imports" | sed 's/^/      /'""")]),
 ("sh-fresh-drift-warns", [(SH, """  elif [[ "$1" -eq 1 && "$2" -eq 0 ]]; then echo warn""", """  elif [[ "$1" -eq 1 ]]; then echo warn""")]),
 ("ic-gate-post-missing-ok", [(IC, """    if restore_post is None:
        # the unit's ExecStopPost runs after every end — no record is no proof
        why.append("no record of the unit's own restore (ExecStopPost)")
    elif""", """    if""")]),
 ("sh-no-build", [(SH, """npm run build --silent""", """true""")]),
 ("hl-owed-ignored", [(HL, """                if m is None or m.get("run") == owed_by:""", """                if True:""")]),
 ("hl-settle-any-run", [(HL, """    if m and m.get("run") == run:""", """    if m:""")]),
 ("nr-no-owe", [(NR, """    heavy.owe(str(run_dir.resolve()))""", """    pass""")]),
 ("nr-settle-always", [(NR, """        if report["restore"].get("outcome") != "not_returned":
            heavy.settle""", """        if True:
            heavy.settle""")]),
 ("nr-no-run-id", [(NR, """    pre["run_id"] = [st.st_dev, st.st_ino]""", """    pass""")]),
 ("rl-not-the-owed-restore", [(RL, """    with heavy.heavy_lock("restore_lan", wait=600, owed_by=owner):""", """    with heavy.heavy_lock("restore_lan", wait=600):""")]),
 ("rg-show-unbounded", [(RG, """                            "-p", "ExecMainStatus", "--no-pager"], capture_output=True, text=True, timeout=SYSTEMCTL_S)""", """                            "-p", "ExecMainStatus", "--no-pager"], capture_output=True, text=True)""")]),
]
files = sorted({f for _, eds in M for f, _, _ in eds})
bak = {f: (T / f).read_text() for f in files}
out = []


def run():
    a = subprocess.run([PY, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", "test_install_probe.py"],
                       cwd=T / "scripts", capture_output=True, text=True, timeout=900)
    return a.returncode, a.stdout.strip().splitlines()[-1:]


try:
    base = run()
    print("baseline", base, flush=True)
    assert base[0] == 0, "the baseline must be green"
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
        rc, tail = run()
        verdict = "RED" if rc else "GREEN"
        out.append({"mutant": name, "verdict": verdict, "tail": tail})
        print(name, verdict, tail, flush=True)
finally:
    for f in files:
        (T / f).write_text(bak[f])
    pathlib.Path(sys.argv[1]).write_text(json.dumps({"base": "fc979851", "mutants": out}, indent=1) + "\n")
