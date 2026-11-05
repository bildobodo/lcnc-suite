"""Where a live check may run (Codex R118/R119 VP-I73, the native stage's
plan R268/R269 + R282–R285): only a shipped SIMULATOR — the INI the
installer renders from the shipped template (with the run's own options),
every HAL file and program it starts the shipped one. Pure: no linuxcnc, no
hal — a bare import of either binds the running sim. Moved here from
toolsetter_readback_check.py, which uses it unchanged."""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

SIM_CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                          "examples", "sim_config")


def ini_values(text):
    """Every value of each (SECTION, KEY), repeated HALFILE lines kept."""
    values, section = {}, ""
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].upper()
        elif "=" in line:
            key, value = line.split("=", 1)
            values.setdefault((section, key.strip().upper()), []).append(value.strip())
    return values


INTERPRETERS = {"python", "python3", "bash", "sh", "tclsh", "haltcl"}
SYSTEM_PREFIXES = ("/usr/", "/bin/", "/sbin/", "/lib/", "/opt/linuxcnc/")


def _loadusr_runs(words):
    """What a `loadusr` line starts, by halcmd's forms (`loadusr [-W | -Wn
    name | -w | -i] program [args]`; -Wn names the component to wait for,
    never the program — Codex R120): [("file", path)] for a program given as
    a path and for an interpreter's script (relative to the configuration,
    the working directory halcmd runs in), [("path", name)] for a program
    found on PATH. Raises ValueError on a form it does not know."""
    i = 1
    while i < len(words) and words[i].startswith("-"):
        if words[i] == "-Wn":
            i += 2
        elif words[i] in ("-W", "-w", "-i"):
            i += 1
        else:
            raise ValueError(f"loadusr option {words[i]} not known")
    if i >= len(words):
        raise ValueError("loadusr without a program")
    prog, rest = words[i], words[i + 1:]
    out = [("file", prog) if "/" in prog else ("path", prog)]
    if os.path.basename(prog) in INTERPRETERS:
        opts, script = [], None
        for w in rest:
            if not w.startswith("-"):
                script = w
                break
            opts.append(w)
        if script is None or "-m" in opts or "-c" in opts:
            raise ValueError(f"loadusr {prog} without a script file")
        out.append(("file", script))
    return out


def _runs(text):
    """What a halcmd text runs: ("file", path) for `source <file>` and the
    files a `loadusr` starts, ("path", name) for a program it finds on PATH."""
    for raw in text.splitlines():
        words = raw.split("#", 1)[0].split()
        if len(words) >= 2 and words[0] == "source":
            yield ("file", words[1])
        elif words and words[0] == "loadusr":
            yield from _loadusr_runs(words)


def validate_sim_target(ini, running_ini, sim_config=SIM_CONFIG, which=shutil.which):
    """Only a running shipped SIMULATOR (Codex R118/R119 VP-I73): the
    requested INI is the one LinuxCNC runs, its name a shipped profile's, the
    whole INI the shipped template as the installer renders it (only the
    per-install settings lines may differ — config_sync_check's rule; an
    extra HALCMD, another kinematics, a Python remap differ), and every file
    its HAL runs — HALFILE, POSTGUI_HALFILE, SHUTDOWN, each file one of them
    or a HALCMD `source`s, a program or interpreter script a `loadusr`
    starts (byte for byte) — the shipped template's file of that path; a
    program found on PATH must be the checkout's own (install.sh links the
    suite's scripts) or the system's. A file linked back into the checkout
    is the template by construction. A `loadusr` form it does not know is
    refused. Raises ValueError with the reason."""
    req = os.path.realpath(os.path.expanduser(ini))
    if not running_ini or req != os.path.realpath(os.path.expanduser(running_ini)):
        raise ValueError("the requested INI is not the one LinuxCNC runs")
    check_copy(ini, sim_config, which)


def check_copy(ini, sim_config=SIM_CONFIG, which=shutil.which, nc_files=None, macro_dir=None):
    """validate_sim_target without the running instance — the native stage's
    check BEFORE it starts the copy. `nc_files` / `macro_dir` are the
    installer options the copy was made with: the template is rendered with
    them, so the comparison stays exact (no key exempted). `which` resolves a
    program the HAL starts by name — under the run's own PATH there."""
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # scripts/
    from config_sync_check import drifted_lines   # noqa: E402 (the installer's rule)
    from install_examples import render_ini        # noqa: E402
    req = os.path.realpath(os.path.expanduser(ini))
    with open(os.path.join(sim_config, "profiles.json")) as f:
        names = [p["ini"] for p in json.load(f)["profiles"]]
    name = os.path.basename(req)
    if name not in names:
        raise ValueError(f"{name} is no shipped simulator profile")
    with open(req) as f:
        text = f.read()
    with open(os.path.join(sim_config, name)) as f:
        template = f.read()
    repo = Path(sim_config).resolve().parents[1]
    missing, local = drifted_lines(render_ini(template, template, repo, nc_files=nc_files, macro_dir=macro_dir),
                                   text, ini=True)
    if missing or local:
        ln = (local or missing)[0][1].strip()
        raise ValueError(f"not the shipped simulator: the INI differs ({ln})")
    got = ini_values(text)
    todo = [("file", v) for key in (("HAL", "HALFILE"), ("HAL", "POSTGUI_HALFILE"), ("HAL", "SHUTDOWN"))
            for v in got.get(key, [])]
    try:
        todo += [r for cmd in got.get(("HAL", "HALCMD"), []) for r in _runs(cmd)]
    except ValueError as e:
        raise ValueError(f"not the shipped simulator: {e}")
    base, seen = os.path.dirname(req), set()
    checkout = str(repo) + os.sep
    while todo:
        kind, rel = todo.pop(0)
        if (kind, rel) in seen:
            continue
        seen.add((kind, rel))
        if kind == "path":
            # a program on PATH: the checkout's own (install.sh links the
            # suite's scripts) or the system's, never another file
            found = which(rel)
            real = os.path.realpath(found) if found else ""
            if not (real.startswith(checkout) or real.startswith(SYSTEM_PREFIXES)):
                raise ValueError(f"not the shipped simulator: {rel} runs from {found or 'nowhere on PATH'}")
            continue
        if rel.startswith("LIB:"):
            continue                     # LinuxCNC's own library
        deployed = os.path.normpath(os.path.join(base, rel))
        shipped = os.path.normpath(os.path.join(sim_config, rel))
        if not os.path.isfile(shipped):
            raise ValueError(f"not the shipped simulator: its HAL runs {rel}, no shipped file")
        if not os.path.isfile(deployed):
            raise ValueError(f"not the shipped simulator: {rel} is missing")
        with open(deployed, errors="replace") as f:
            dtext = f.read()
        hal = rel.endswith((".hal", ".tcl"))
        if os.path.realpath(deployed) != os.path.realpath(shipped):
            if hal:
                with open(shipped, errors="replace") as f:
                    missing, local = drifted_lines(f.read(), dtext)
                if missing or local:
                    raise ValueError(f"not the shipped simulator: {rel} differs ({(local or missing)[0][1].strip()})")
            else:
                # a program or script it starts: byte for byte, no settings
                # line or comment exempt (Codex R120)
                with open(shipped, "rb") as a, open(deployed, "rb") as b:
                    if a.read() != b.read():
                        raise ValueError(f"not the shipped simulator: {rel} differs")
        if hal:
            try:
                todo += list(_runs(dtext))
            except ValueError as e:
                raise ValueError(f"not the shipped simulator: {rel}: {e}")


# ── The native stage's run (plan Codex R268/R269 FI265-04, R283/R284) ────

#: Every file or folder the copy WRITES — each must lie in the run's folder.
MUTABLE_KEYS = (("RS274NGC", "PARAMETER_FILE"), ("TRAJ", "POSITION_FILE"), ("EMCIO", "TOOL_TABLE"),
                ("DISPLAY", "PROGRAM_PREFIX"), ("DISPLAY", "TOOL_LIBRARY_DIR"), ("DISPLAY", "WEBUI_MACRO_DIR"))
#: Folders that must exist before the start: the gateway falls back to
#: ~/linuxcnc/nc_files (and creates it) for a PROGRAM_PREFIX it cannot find.
MUST_EXIST = (("DISPLAY", "PROGRAM_PREFIX"), ("DISPLAY", "TOOL_LIBRARY_DIR"), ("DISPLAY", "WEBUI_MACRO_DIR"))


def _within(path: Path, root: Path) -> bool:
    """`path` in `root` with every link on the way followed (the deepest
    existing ancestor resolved, the rest appended)."""
    probe, rest = path, []
    while not probe.exists() and not probe.is_symlink() and probe != probe.parent:
        rest.insert(0, probe.name)
        probe = probe.parent
    return probe.resolve().joinpath(*rest).is_relative_to(root.resolve())


def confinement_problems(ini: Path, run: Path, tree: Path) -> list[str]:
    """The copy's mutable paths and the tree's settings.json, each resolved
    as LinuxCNC and the gateway do (home, then relative to the INI's folder)
    — in the run, and the folders there."""
    ini = Path(ini)
    got = ini_values(ini.read_text())
    out = []
    for key in MUTABLE_KEYS:
        values = got.get(key) or []
        if not values:
            if key != ("TRAJ", "POSITION_FILE"):   # unset: LinuxCNC keeps no position file — nothing written
                out.append(f"{key[1]} not set")
            continue
        p = Path(os.path.expanduser(values[-1]))
        p = p if p.is_absolute() else ini.parent / p
        if not _within(p, run):
            out.append(f"{key[1]} = {values[-1]} lies outside the run")
        elif key in MUST_EXIST and not p.is_dir():
            out.append(f"{key[1]} = {values[-1]} is missing (the gateway would fall back to ~/linuxcnc/nc_files)")
    if not _within(Path(tree) / "lcnc-gateway/settings.json", run):
        out.append("the tree's settings.json lies outside the run")
    return out


def shared_inodes(copy: Path, original: Path, limit: int = 3) -> list[str]:
    """Files of `copy` that are the SAME file as `original`'s at that path
    (device and inode): a hard-link copy — a build writing into it
    (node_modules/.tmp/*.tsbuildinfo) changes the original (R283)."""
    out = []
    for dirpath, _dirs, files in os.walk(copy):
        for name in files:
            a = Path(dirpath) / name
            b = Path(original) / a.relative_to(copy)
            try:
                sa, sb = a.stat(follow_symlinks=False), b.stat(follow_symlinks=False)
            except OSError:
                continue
            if (sa.st_dev, sa.st_ino) == (sb.st_dev, sb.st_ino):
                out.append(str(a.relative_to(copy)))
                if len(out) >= limit:
                    return out
    return out


#: The suite's processes the copy starts, by the script each runs.
SUITE_HELPERS = ("lcnc-gateway/hal_reader.py", "lcnc-gateway/hal_watchdog.py",
                 "subroutines/surfacemap/compensation.py")


def process_problems(procs: list[dict], tree: Path, ini: Path) -> list[str]:
    """After the start (R283/R284): the launcher is the tree's with the
    copy's INI, the gateway's app dir the tree's, and each suite helper runs
    the tree's script — not the main checkout's that ~/.local/bin links. A
    missing one is named. `procs`: [{"cmdline": [...]}] (read_procs)."""
    tree = Path(tree).resolve()
    out = []
    cmds = [p["cmdline"] for p in procs]
    if not any(len(c) >= 4 and c[0].endswith("bash") and Path(c[1]).resolve() == tree / "lcnc-suite"
               and c[2] == "-ini" and Path(c[3]).resolve() == Path(ini).resolve() for c in cmds):
        out.append("the launcher of the run tree with the copy's INI is not running")
    gw = [c for c in cmds if "gateway:app" in c]
    if not gw:
        out.append("the gateway is not running")
    for c in gw:
        app = c[c.index("--app-dir") + 1] if "--app-dir" in c else ""
        if Path(app).resolve() != tree / "lcnc-gateway":
            out.append(f"the gateway runs from {app or 'an unnamed folder'}")
    for helper in SUITE_HELPERS:
        name = Path(helper).name
        runs = [Path(a) for c in cmds for a in c[:3] if Path(a).name == name]
        if not runs:
            out.append(f"{name} is not running")
        out += [f"{name} runs {r}, not the run tree's" for r in runs if r.resolve() != tree / helper]
    return out


def read_procs() -> list[dict]:
    """Every process's command line, from /proc (the orchestrator's read)."""
    out = []
    for d in Path("/proc").glob("[0-9]*"):
        try:
            raw = (d / "cmdline").read_bytes()
        except OSError:
            continue
        if raw:
            out.append({"pid": int(d.name), "cmdline": raw.rstrip(b"\0").decode(errors="replace").split("\0")})
    return out
