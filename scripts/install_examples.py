#!/usr/bin/env python3
"""Install the explicit example catalog, preserving controller state and INI edits.

Shared code/models track this checkout. INIs and mutable state remain local.
Before replacing anything, snapshot the complete previous installation outside
the LinuxCNC configuration chooser. No dependency installation or motion.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent


def values(text):
    result, section = {}, ""
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].upper()
        elif "=" in line and not line.startswith(("#", ";")):
            key, value = line.split("=", 1)
            result[(section, key.strip().upper())] = value.strip()
    return result


def render_ini(text, template, repo):
    """Update suite-owned paths/title; retain local settings, limits and HAL edits."""
    source = repo / "examples/sim_config"
    ref = values(template)
    managed = {key: ref[key] for key in (
        ("EMC", "MACHINE"), ("RS274NGC", "PARAMETER_FILE"),
        ("RS274NGC", "SUBROUTINE_PATH"), ("EMCIO", "TOOL_TABLE"),
        ("DISPLAY", "WEBUI_MACHINE_DIR"), ("PYTHON", "PATH_APPEND"),
        ("PYTHON", "TOPLEVEL")) if key in ref}
    managed[("DISPLAY", "DISPLAY")] = str(repo / "lcnc-suite")
    # Resolve paths against the source INI, not the installed directory.
    for key in (("RS274NGC", "SUBROUTINE_PATH"), ("PYTHON", "PATH_APPEND"),
                ("PYTHON", "TOPLEVEL")):
        if key in managed:
            managed[key] = ":".join(str((source / p).resolve())
                                    for p in managed[key].split(":"))
    if values(text).get(("DISPLAY", "OPEN_FILE")) == "~/linuxcnc/nc_files/blank.ngc":
        managed[("DISPLAY", "OPEN_FILE")] = ref[("DISPLAY", "OPEN_FILE")]
    section, output = "", []
    for line in text.splitlines():
        if line.strip().startswith("[") and line.strip().endswith("]"):
            section = line.strip()[1:-1].upper()
        elif "=" in line and not line.lstrip().startswith(("#", ";")):
            key = (section, line.split("=", 1)[0].strip().upper())
            if key in managed:
                line = f"{key[1]} = {managed[key]}"
            elif key == ("HAL", "HALCMD") and "twp-helper-comp.py" in line:
                line = f"HALCMD = loadusr -W {source}/twp/python/twp-helper-comp.py"
        output.append(line)
    return "\n".join(output) + "\n"


def assert_stopped():
    for proc in Path("/proc").glob("[0-9]*/comm"):
        try:
            name = proc.read_text().strip()
        except OSError:
            continue
        if name in ("milltask", "linuxcncsvr"):
            raise RuntimeError("Stop LinuxCNC before updating the installed examples")


def install(repo, destination, backup_root):
    repo, destination, backup_root = (Path(p).expanduser().resolve()
                                      for p in (repo, destination, backup_root))
    source = repo / "examples/sim_config"
    if destination == source or destination.is_relative_to(repo):
        raise ValueError("Install outside the source checkout")
    if backup_root.is_relative_to(destination.parent):
        raise ValueError("Backups must be outside the LinuxCNC configs directory")
    catalog = json.loads((source / "profiles.json").read_text())
    writes, links = {}, {}
    for profile in catalog["profiles"]:
        name = profile["ini"]
        current = destination / name
        previous = destination / profile.get("previous_ini", name)
        existing = current if current.is_file() else previous
        template = (source / name).read_text()
        text = existing.read_text() if existing.is_file() else template
        writes[name] = render_ini(text, template, repo).encode()
        old = values(text)
        for filename, key in (("sim.var", ("RS274NGC", "PARAMETER_FILE")),
                              ("tool.tbl", ("EMCIO", "TOOL_TABLE"))):
            rel = profile["state_dir"] + "/" + filename
            if not (destination / rel).exists():
                candidate = Path(old[key]).expanduser()
                if not candidate.is_absolute():
                    candidate = destination / candidate
                seed = candidate if existing.is_file() and candidate.is_file() else source / rel
                writes[rel] = seed.read_bytes()
        for rel in profile["programs"]:
            # User-edited programs remain local, just like offsets/tool tables.
            if not (destination / rel).exists():
                writes[rel] = (source / rel).read_bytes()
    for rel in catalog["shared"]:
        if not (source / rel).is_dir():
            raise ValueError(f"Missing shared example assets: {rel}")
        links[rel] = source / rel
    for rel in catalog.get("documents", []):
        writes[rel] = (source / rel).read_bytes()
    writes["profiles.json"] = (source / "profiles.json").read_bytes()
    writes["README.md"] = (source / "README.md").read_bytes()
    writes = {rel: content for rel, content in writes.items()
              if not (destination / rel).is_file() or (destination / rel).read_bytes() != content}
    links = {rel: target for rel, target in links.items()
             if not (destination / rel).is_symlink() or (destination / rel).resolve() != target.resolve()}
    retired = [destination / rel for rel in catalog["retired"]
               if (destination / rel).exists() or (destination / rel).is_symlink()]
    assert_stopped()
    if not (writes or links or retired):
        return None
    backup = None
    if destination.exists():
        backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        backup = backup_root / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        backup.mkdir(mode=0o700)
        shutil.copytree(destination, backup / "config", symlinks=True)
    destination.mkdir(parents=True, exist_ok=True)
    for rel, content in writes.items():
        path = destination / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        # Replace via rename; never write through an old symlink into a checkout.
        tmp = path.with_name(path.name + ".install-tmp")
        tmp.write_bytes(content)
        tmp.chmod(0o600 if path.suffix == ".ini" else 0o644)
        tmp.replace(path)
    for path in retired + [destination / rel for rel in links]:
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.exists():
            shutil.rmtree(path)
    for rel, target in links.items():
        (destination / rel).symlink_to(target, target_is_directory=True)
    return backup


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", type=Path, default=ROOT)
    ap.add_argument("--destination", type=Path,
                    default=Path.home() / "linuxcnc/configs/lcnc_suite_sim")
    ap.add_argument("--backup-root", type=Path,
                    default=Path.home() / "linuxcnc/config-backups/lcnc_suite_sim")
    args = ap.parse_args()
    backup = install(args.repo, args.destination, args.backup_root)
    print(f"Three example profiles installed: {args.destination}")
    if backup:
        print(f"Previous installation preserved: {backup}")


if __name__ == "__main__":
    main()
