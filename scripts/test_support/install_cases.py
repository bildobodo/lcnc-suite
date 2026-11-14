"""The install probe's pure parts and its host (package I, operator
2026-11-07, plan Codex R329): the child environment the installer and the
started suite get, the protection record of the operator's files, the
evaluators of the installed result, the started suite's safety chain and its
browser start. The orchestrator is scripts/install_probe.py.

Every evaluator returns a row {"case", "status", "detail", ...}: PASS only
with a POSITIVE proof — an unknown or missing value is "incomplete", a
contradiction FAIL (the native stage's rule)."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

from test_support.system_host import SystemHost

#: the gateway's own start grace before it judges the safety chain
#: (gateway._SAFETY_CHAIN_GRACE_SEC) and the margin the probe waits past it
SAFETY_GRACE_S = 15.0
SAFETY_MARGIN_S = 3.0
#: the window of frames that must all hold the chain (≥ this long, ≥ 3 frames)
SAFETY_WINDOW_S = 3.0

#: the helper links the installer writes into ~/.local/bin → their target in the clone
LINKS = {"lcnc-suite": "lcnc-suite", "hal_watchdog.py": "lcnc-gateway/hal_watchdog.py",
         "hal_reader.py": "lcnc-gateway/hal_reader.py",
         "compensation.py": "subroutines/surfacemap/compensation.py"}

#: what the installer could write in the OPERATOR's home were the sandbox to
#: leak (FI329-02): recorded after the LAN stop, compared before its restart
PROTECTED = (".local/bin", "linuxcnc", ".npm", ".cache/pip", ".gitconfig", ".config/git")


def row(case, status, detail, **extra):
    return {"case": case, "status": status, "detail": detail, **extra}


# ── the child environment (FI329-02) ─────────────────────────────────────
def child_env(run: Path, home: Path, system_path: str = "/usr/local/bin:/usr/bin:/bin") -> dict:
    """A NEW environment, nothing inherited: a parent's LCNC_LOG_DIR, npm_config_*,
    PIP_* or PYTHON* would send the installer's or the suite's writes outside the
    run (lcnc_paths._requested reads LCNC_LOG_DIR before HOME). Every write
    target is named here and lies in the run."""
    run, home = Path(run), Path(home)
    return {
        "HOME": str(home), "USER": os.environ.get("USER", "cnc"), "LOGNAME": os.environ.get("LOGNAME", "cnc"),
        "PATH": f"{home / '.local/bin'}:{system_path}",
        "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TERM": "dumb", "SHELL": "/bin/bash",
        "XDG_CACHE_HOME": str(home / ".cache"), "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_DATA_HOME": str(home / ".local/share"), "XDG_STATE_HOME": str(home / ".local/state"),
        "TMPDIR": str(run / "tmp"),
        "LCNC_LOG_DIR": str(run / "logs"),
        "PYTHONPYCACHEPREFIX": str(run / "pycache"),
        "npm_config_cache": str(run / "cache/npm"),
        "npm_config_update_notifier": "false",
        "PIP_CACHE_DIR": str(run / "cache/pip"),
        "PIP_DISABLE_PIP_VERSION_CHECK": "1",
        # npm ci of the frontend never downloads browsers into the run
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
    }


#: rtapi_app's socket is $HOME/.rtapi_fifo, an AF_UNIX path: at most 107
#: bytes and its NUL (sockaddr_un.sun_path, 108). Past that rtapi_app exits
#: without becoming ready ("rtapi fifo path is too long (arch limit 108)"),
#: every loadrt fails and LinuxCNC never reaches the display — the probe saw
#: only "/ready did not answer" (merge gate 2026-11-11: an --out inside a
#: worktree put the run folder's fifo at exactly 108 bytes).
RTAPI_FIFO_LIMIT = 108


def run_dir_problem(run: Path) -> str | None:
    """Why LinuxCNC cannot start under this run folder's HOME (child_env's),
    None when it can: its rtapi socket path is too long."""
    fifo = os.path.join(child_env(Path(run), Path(run) / "home")["HOME"], ".rtapi_fifo")
    n = len(os.fsencode(fifo))
    if n >= RTAPI_FIFO_LIMIT:
        return (f"the run folder is too long for LinuxCNC: rtapi_app's socket {fifo} is {n} bytes, "
                f"the limit is {RTAPI_FIFO_LIMIT - 1} — a shorter --run-dir (the merge gate: a shorter --out)")
    return None


def write_targets(env: dict, run: Path) -> list[str]:
    """Every write target the environment names lies in the run."""
    run = Path(run).resolve()
    keys = ("HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "TMPDIR",
            "LCNC_LOG_DIR", "PYTHONPYCACHEPREFIX", "npm_config_cache", "PIP_CACHE_DIR")
    out = [f"{k} is not set" for k in keys if not env.get(k)]
    out += [f"{k} = {env[k]} lies outside the run" for k in keys
            if env.get(k) and not Path(env[k]).resolve().is_relative_to(run)]
    return out


# ── the protection record (FI329-02) ─────────────────────────────────────
def manifest(root: Path) -> dict:
    """Every entry under `root`, links NOT followed: relative name → its type
    and, for a link, its target, for a file the sha256 of its content (a
    retargeted link or a replaced file changes the record; _hash_tree skipped
    links)."""
    root = Path(root)
    out: dict = {}

    def entry(p: Path) -> str:
        if p.is_symlink():
            return "link:" + os.readlink(p)
        if p.is_file():
            h = hashlib.sha256()
            with open(p, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            return "file:" + h.hexdigest()
        if p.is_dir():
            return "dir"
        return "other"
    if not root.exists() and not root.is_symlink():
        return {".": "absent"}
    out["."] = entry(root)
    if root.is_dir() and not root.is_symlink():
        for dirpath, dirs, files in os.walk(root, followlinks=False):
            for name in sorted(dirs + files):
                p = Path(dirpath) / name
                out[str(p.relative_to(root))] = entry(p)
    return out


def manifest_digest(m: dict) -> str:
    return hashlib.sha256(json.dumps(m, sort_keys=True).encode()).hexdigest()


def manifest_diff(before: dict, after: dict, limit: int = 5) -> list[str]:
    names = sorted(set(before) | set(after))
    out = [f"{n}: {before.get(n, 'absent')} → {after.get(n, 'absent')}" for n in names
           if before.get(n) != after.get(n)]
    return out[:limit] + ([f"… {len(out) - limit} more"] if len(out) > limit else [])


class InstallProbeHost(SystemHost):
    """The restore's host for the install probe: the run's tree is a CLONE
    (removed as a folder of the run, never `git worktree remove` — FI329-04),
    and the isolation also covers what the installer could write in the
    operator's home, links by their target (FI329-02)."""

    def __init__(self, pre: dict | None = None, run: Path | None = None, home: Path | None = None):
        super().__init__(pre)
        self._home = Path(home) if home else Path.home()
        self._run = Path(run) if run else None

    def file_hashes(self):
        out = super().file_hashes()
        for rel in PROTECTED:
            out["home:" + rel] = manifest_digest(manifest(self._home / rel))
        return out

    def remove_tree(self, tree, of):
        """The run's tree, whatever state an abort left it in — a clone, a
        half-made one, an empty folder (Codex R330/R331 FI-I62). Ownership is
        the RUN FOLDER's: made new by the run (exclusive), its identity in
        pre.json before the LAN stop; the tree must lie in it (links
        resolved). Another folder, the run itself, or a run folder that is not
        the recorded one is refused."""
        tree = Path(tree)
        if not tree.exists() and not tree.is_symlink():
            return
        run = self._run
        if run is None or not tree.resolve().is_relative_to(run.resolve()) or tree.resolve() == run.resolve():
            raise RuntimeError(f"{tree} is not a tree inside the run {run} — not removed")
        try:
            made = json.loads((run / "pre.json").read_text()).get("run_id")
        except (OSError, ValueError):
            made = None
        st = run.stat()
        if made != [st.st_dev, st.st_ino]:
            raise RuntimeError(f"{run} is not the run folder its record names — {tree} not removed")
        shutil.rmtree(tree)


# ── the installed result ─────────────────────────────────────────────────
def eval_links(home: Path, src: Path) -> dict:
    """The installer's four links in the sandbox's ~/.local/bin lead into the clone."""
    bad = []
    for name, rel in LINKS.items():
        link = Path(home) / ".local/bin" / name
        if not link.is_symlink():
            bad.append(f"{name}: no link")
        elif Path(os.path.realpath(link)) != (Path(src) / rel).resolve():
            bad.append(f"{name} → {os.readlink(link)}, not the clone's {rel}")
    return row("install-links", "FAIL" if bad else "PASS",
               "; ".join(bad) if bad else "the four links lead into the clone")


def eval_profiles(config: Path, catalog: Path) -> dict:
    names = [p["ini"] for p in json.loads(Path(catalog).read_text())["profiles"]]
    missing = [n for n in names if not (Path(config) / n).is_file()]
    return row("install-profiles", "FAIL" if missing or not names else "PASS",
               f"missing: {', '.join(missing)}" if missing else f"{len(names)} profiles installed: {', '.join(names)}")


def eval_clean_clone(porcelain: str) -> dict:
    """The installer changed no tracked file of the clone (a lock file rewritten
    by `npm install`, a template touched)."""
    changed = [ln for ln in porcelain.splitlines() if ln.strip()]
    return row("install-tracked-files", "FAIL" if changed else "PASS",
               f"changed: {'; '.join(changed[:5])}" if changed else "no tracked file changed")


# ── the started suite's safety chain (FI329-01) ──────────────────────────
def eval_safety(frames: list, events: list, hal: dict, gw_pid: int | None, gw_start: float | None) -> dict:
    """POSITIVE proof that the started instance's safety chain is in place —
    an absent banner alone is none (evaluate_safety_chain answers None for an
    unknown reader). `frames`: [(monotonic s, envelope: {safety_chain_incomplete,
    reader_stale, safety_trip}, data: {comp_grid_version, ...})] received by
    the probe's own unarmed client; `events`: the run's trace lines (dicts);
    `hal`: {"latch_fault": "FALSE"|..., "oneshot_out": "TRUE"|...} read by
    halcmd; `gw_start`: the gateway's start (monotonic s, the probe's clock)."""
    case = "start-safety-chain"
    if gw_pid is None or gw_start is None:
        return row(case, "incomplete", "the gateway's process or start time unknown — no binding")
    late = [f for f in frames if f[0] >= gw_start + SAFETY_GRACE_S + SAFETY_MARGIN_S]
    problems, missing = [], []
    for _, env, _data in late:
        if env.get("safety_chain_incomplete"):
            problems.append(f"banner: {env['safety_chain_incomplete']}")
        if env.get("reader_stale"):
            problems.append("reader_stale")
        if env.get("safety_trip"):
            problems.append(f"a trip waits: {env['safety_trip']}")
    if len(late) < 3 or late[-1][0] - late[0][0] < SAFETY_WINDOW_S:
        missing.append(f"{len(late)} frame(s) past the grace, over "
                       f"{(late[-1][0] - late[0][0]) if len(late) > 1 else 0:.1f} s — need ≥ 3 over {SAFETY_WINDOW_S} s")
    elif any(d.get("comp_grid_version") is None for _, _e, d in late):
        missing.append("a frame without the reader's comp_grid_version — the reader's snapshot not shown")
    own = [e for e in events if e.get("pid") == gw_pid and e.get("proc") == "gateway"]
    if not any(e.get("tag") == "hal.admitted" for e in own):
        missing.append("no hal.admitted of this gateway — the watchdog's admission not seen")
    if not any(e.get("tag") == "reader.connected" and e.get("outcome") == "admitted" for e in own):
        missing.append("no reader.connected (admitted) of this gateway")
    rejects = [e["tag"] for e in own if "reject" in str(e.get("tag")) or e.get("outcome") in ("rejected", "legacy")]
    if rejects:
        problems.append(f"helper refusals: {', '.join(rejects[:3])}")
    latch, shot = hal.get("latch_fault"), hal.get("oneshot_out")
    tags = {e.get("tag") for e in own}
    if "safety.tripped" in tags:
        problems.append("the gateway traced safety.tripped")
    if latch == "TRUE" and "safety.latch_faulted_on_connect" not in tags:
        # a fresh LinuxCNC boots with the latch set until the operator's
        # E-Stop Reset; the gateway classifies that first sight
        # (safety.latch_faulted_on_connect, no banner, no trip — live run
        # 2026-11-07). A TRUE it did not classify so is a fault.
        problems.append("webui-hb-latch.fault-out is TRUE and the gateway did not see it as the boot state")
    elif latch not in ("TRUE", "FALSE"):
        missing.append(f"webui-hb-latch.fault-out not read ({latch!r}) — the latch not proven in HAL")
    if shot == "FALSE":
        problems.append("oneshot.0.out is FALSE — heartbeats do not arrive")
    elif shot != "TRUE":
        missing.append(f"oneshot.0.out not read ({shot!r})")
    if problems:
        return row(case, "FAIL", "; ".join(problems[:4]), missing=missing)
    if missing:
        return row(case, "incomplete", "; ".join(missing))
    state = "set at boot (the gateway's first sight, no trip)" if latch == "TRUE" else "clear"
    return row(case, "PASS", f"{len(late)} frames over {late[-1][0] - late[0][0]:.1f} s past the grace: no banner, "
                             f"reader fresh, no trip; watchdog and reader admitted this gateway; the latch in HAL, "
                             f"{state}; heartbeat oneshot TRUE")


# ── the browser start (FI329-03) ─────────────────────────────────────────
def eval_browser(result: dict | None) -> dict:
    """The built UI started against the run's own production gateway:
    mounted, its own WebSocket brought the viewer_init (the DRO fields) AND
    a status the app applied — the instance's boot E-Stop, shown as the
    strip's "Reset E-Stop" (the default without a status is "E-Stop"; Codex
    R330 FI-I61: viewer_init alone passed) — no entry module or worker
    missing or served as something else, no page error."""
    case = "start-browser"
    if not result:
        return row(case, "incomplete", "no browser result")
    problems = []
    if result.get("error"):
        problems.append(f"the check ended: {result['error']}")
    for r in result.get("bad_responses", []):
        problems.append(f"{r.get('url')}: {r.get('status')} {r.get('type')}")
    for e in result.get("page_errors", []):
        problems.append(f"page error: {e}")
    for e in result.get("console_errors", []):
        problems.append(f"console: {e}")
    scripts = result.get("scripts", [])
    if not any(s.get("ok") for s in scripts):
        problems.append("no script of the build was served")
    if not result.get("mounted"):
        problems.append("the app did not mount (.safetyStrip not shown)")
    if not result.get("connected"):
        problems.append("the app's own WebSocket brought no viewer_init (no DRO field)")
    if not result.get("status_applied"):
        problems.append("the app applied no status of the instance (its E-Stop not shown — 'Reset E-Stop')")
    if problems:
        return row(case, "FAIL", "; ".join(problems[:5]), scripts=len(scripts))
    return row(case, "PASS", f"mounted, viewer_init taken, the instance's E-Stop status applied; {len(scripts)} "
                             "script(s)/worker(s) served as JavaScript, no error")


def gate_status(report: dict | None, restore_post: dict | None) -> tuple[str, list[str]]:
    """The merge gate's verdict on a probe run: PASS only with the probe's
    own PASS (every row, the LAN returned complete, isolation []) AND the
    unit's own restore (ExecStopPost — it runs after every end) on record and
    complete (FI329-04: a missing or incomplete return is never green)."""
    why = []
    if not report:
        return "FAIL", ["no probe report — the probe did not finish"]
    if report.get("verdict") != "PASS":
        why.append(f"the probe's verdict is {report.get('verdict')}: {report.get('error') or ''}".rstrip(": "))
    crashes = report.get("crashes") or []
    if crashes:
        first = crashes[0]
        what = (f"damaged ({first['damaged']})" if first.get("damaged")
                else f"unparsed {first['unparsed']!r}" if "unparsed" in first
                else f"{first.get('proc')} {first.get('tag')} {first.get('exc_type') or ''}".rstrip())
        why.append(f"the run's crash.log: {len(crashes)} error or damaged record(s), first {what}")
    r = report.get("restore") or {}
    if r.get("outcome") != "complete":
        why.append(f"the LAN return: {r.get('outcome')} {r.get('reasons') or ''}".rstrip())
    if r.get("isolation") != []:
        why.append(f"isolation: {r.get('isolation')}")
    if restore_post is None:
        # the unit's ExecStopPost runs after every end — no record is no proof
        why.append("no record of the unit's own restore (ExecStopPost)")
    elif restore_post.get("outcome") != "complete":
        why.append(f"the unit's own restore: {restore_post.get('outcome')} {restore_post.get('reasons') or ''}".rstrip())
    return ("FAIL" if why else "PASS"), why
