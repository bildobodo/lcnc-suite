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


# Suite-owned [RS274NGC] entries an older installed INI may lack; a local
# value is kept, a missing one comes from the template.
RS274_SUITE_KEYS = ("OWORD_NARGS", "NO_DOWNCASE_OWORD", "ON_ABORT_COMMAND")
# 2026-09-27: the XYZAC example moved its Z datum — machine Z0 is the top of
# travel, the A/C intersection sits at machine Z -500 (was Z 100..500). An
# installed INI keeps its local limits by design, so an install from before
# the move is migrated ONCE: these INI keys and the kins pin from the
# template, and the machine-absolute state (G5x Z, G28/G30 Z, the saved joint
# Z) by XYZAC_Z_SHIFT — program zero stays where the operator touched it off.
XYZAC_INI = "lcnc_suite_sim_5axis_xyzac.ini"
XYZAC_Z_SHIFT = -500.0
XYZAC_DATUM_KEYS = (("TRAJ", "HOME"), ("AXIS_Z", "MIN_LIMIT"), ("AXIS_Z", "MAX_LIMIT"),
                    ("JOINT_2", "HOME"), ("JOINT_2", "HOME_OFFSET"),
                    ("JOINT_2", "MIN_LIMIT"), ("JOINT_2", "MAX_LIMIT"))
# Machine-absolute Z parameters: G28 Z, G30 Z, and Z of G54..G59.3. G92 is an
# offset between coordinate systems and does not move with the datum.
XYZAC_ABSOLUTE_Z = (5163, 5183) + tuple(5223 + 20 * k for k in range(9))
# Toolsetter positions (#3100-#3102) that were never one: the example's before
# the move (the 3-axis values, never reachable there) and the WebUI's fallback
# zeros, pushed for a config without a toolsetter section (X0 Y0 Z0 = the
# table centre on the rotary intersection). Replaced by the template's, not
# shifted; any other value is the operator's and moves with the datum.
XYZAC_UNSET_TOOLSETTER = ((10.0, 10.0, -180.0), (0.0, 0.0, 0.0))


def remap_lines(text):
    """[RS274NGC] REMAP lines by their code (the value's first word)."""
    out, section = {}, ""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            section = stripped[1:-1].upper()
        elif section == "RS274NGC" and "=" in stripped and not stripped.startswith(("#", ";")):
            key, value = stripped.split("=", 1)
            if key.strip().upper() == "REMAP" and value.split():
                out[value.split()[0].upper()] = stripped
    return out


def xyzac_before_datum_move(text):
    """An installed XYZAC INI from before the Z datum move (Z window up to 500)."""
    config = values(text)
    try:
        return (config.get(("EMC", "MACHINE")) == "5 Axis XYZAC"
                and float(config.get(("JOINT_2", "MAX_LIMIT"), "0")) == 500.0)
    except ValueError:
        return False


def migrate_xyzac_var(text, template_text):
    """Shift the machine-absolute Z parameters; seed what the template adds."""
    rows = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            rows[int(parts[0])] = float(parts[1])
    for number in XYZAC_ABSOLUTE_Z:
        if number in rows:
            rows[number] += XYZAC_Z_SHIFT
    template_rows = {int(p[0]): float(p[1]) for p in (l.split() for l in template_text.splitlines()) if len(p) >= 2}
    if tuple(rows.get(n) for n in (3100, 3101, 3102)) in XYZAC_UNSET_TOOLSETTER:
        rows.update({n: template_rows[n] for n in (3100, 3101, 3102)})
    elif 3102 in rows:
        rows[3102] += XYZAC_Z_SHIFT   # an operator's absolute G53 Z moves with the datum
    for number, value in template_rows.items():
        rows.setdefault(number, value)
    return "".join(f"{n}\t{v:.6f}\n" for n, v in sorted(rows.items()))


def migrate_xyzac_position(text):
    """The saved joint positions: Z (the third entry) moves with the datum."""
    lines = text.split("\n")
    if len(lines) > 2 and lines[2].strip():
        z = float(lines[2]) + XYZAC_Z_SHIFT
        lines[2] = str(int(z)) if z == int(z) else repr(z)
    return "\n".join(lines)


def render_ini(text, template, repo, migrate_datum=False):
    """Update suite-owned paths/title; retain local settings, limits and HAL edits."""
    source = repo / "examples/sim_config"
    ref = values(template)
    managed = {key: ref[key] for key in (
        ("EMC", "MACHINE"), ("RS274NGC", "PARAMETER_FILE"),
        ("RS274NGC", "SUBROUTINE_PATH"), ("EMCIO", "TOOL_TABLE"),
        ("TRAJ", "POSITION_FILE"),
        ("DISPLAY", "WEBUI_MACHINE_DIR"), ("PYTHON", "PATH_APPEND"),
        ("PYTHON", "TOPLEVEL")) if key in ref}
    managed[("DISPLAY", "DISPLAY")] = str(repo / "lcnc-suite")
    # Resolve paths against the source INI, not the installed directory.
    for key in (("RS274NGC", "SUBROUTINE_PATH"), ("PYTHON", "PATH_APPEND"),
                ("PYTHON", "TOPLEVEL")):
        if key in managed:
            managed[key] = ":".join(str((source / p).resolve())
                                    for p in managed[key].split(":"))
    local = values(text)
    if migrate_datum:
        managed.update({key: ref[key] for key in XYZAC_DATUM_KEYS if key in ref})
    # Suite-owned RS274NGC entries and remaps the installed INI lacks (a new
    # M600/M601, an abort handler): added from the template, never replaced.
    rs274_missing = [f"{key} = {ref[('RS274NGC', key)]}" for key in RS274_SUITE_KEYS
                     if ("RS274NGC", key) in ref and ("RS274NGC", key) not in local]
    local_remaps = remap_lines(text)
    rs274_missing += [line for code, line in remap_lines(template).items() if code not in local_remaps]
    zrot = next((l.strip() for l in template.splitlines() if "setp xyzac-trt-kins.z-rot-point" in l), None)
    # The initial XYZAC example accidentally used its mutable state directory
    # as the program browser root. Migrate that shipped default only; custom
    # program folders belong to the operator.
    if (ref.get(("EMC", "MACHINE")) == "5 Axis XYZAC"
            and local.get(("DISPLAY", "PROGRAM_PREFIX")) in ("xyzac5", "./xyzac5")):
        managed[("DISPLAY", "PROGRAM_PREFIX")] = ref[("DISPLAY", "PROGRAM_PREFIX")]
    if local.get(("DISPLAY", "TOOL_LIBRARY_DIR"), "") in ("", "tool-libraries", "./tool-libraries"):
        managed[("DISPLAY", "TOOL_LIBRARY_DIR")] = managed.get(("DISPLAY", "PROGRAM_PREFIX"),
            local.get(("DISPLAY", "PROGRAM_PREFIX")) or ref.get(("DISPLAY", "PROGRAM_PREFIX"))
            or "~/linuxcnc/nc_files")
    if local.get(("DISPLAY", "OPEN_FILE")) == "~/linuxcnc/nc_files/blank.ngc":
        managed[("DISPLAY", "OPEN_FILE")] = ref[("DISPLAY", "OPEN_FILE")]
    section, output = "", []
    for line in text.splitlines():
        if line.strip().startswith("[") and line.strip().endswith("]"):
            section = line.strip()[1:-1].upper()
            output.append(line)
            # Older installed INIs can lack a newly introduced state path.
            output.extend(f"{key[1]} = {value}" for key, value in managed.items()
                          if key[0] == section and key not in local)
            if section == "RS274NGC":
                output.extend(rs274_missing)
            continue
        elif "=" in line and not line.lstrip().startswith(("#", ";")):
            key = (section, line.split("=", 1)[0].strip().upper())
            if key in managed:
                line = f"{key[1]} = {managed[key]}"
            elif key == ("HAL", "HALCMD") and "twp-helper-comp.py" in line:
                line = f"HALCMD = loadusr -W {source}/twp/python/twp-helper-comp.py"
            elif migrate_datum and zrot and key == ("HAL", "HALCMD") and "xyzac-trt-kins.z-rot-point" in line:
                line = zrot
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


def resolve_directory(value, ini_directory):
    """Resolve a configured folder, with the same home/relative rules as the UI."""
    path = Path.home() / value[2:] if value.startswith("~/") else Path(value).expanduser()
    return path if path.is_absolute() else ini_directory / path


def install(repo, destination, backup_root):
    repo, destination, backup_root = (Path(p).expanduser().resolve()
                                      for p in (repo, destination, backup_root))
    source = repo / "examples/sim_config"
    if destination == source or destination.is_relative_to(repo):
        raise ValueError("Install outside the source checkout")
    if backup_root.is_relative_to(destination.parent):
        raise ValueError("Backups must be outside the LinuxCNC configs directory")
    catalog = json.loads((source / "profiles.json").read_text())
    writes, links, libraries = {}, {}, {}
    for profile in catalog["profiles"]:
        name = profile["ini"]
        current = destination / name
        previous = destination / profile.get("previous_ini", name)
        existing = current if current.is_file() else previous
        template = (source / name).read_text()
        text = existing.read_text() if existing.is_file() else template
        migrate_datum = name == XYZAC_INI and existing.is_file() and xyzac_before_datum_move(text)
        writes[name] = render_ini(text, template, repo, migrate_datum).encode()
        rendered = values(writes[name].decode())
        library_dir = resolve_directory(rendered["DISPLAY", "TOOL_LIBRARY_DIR"], destination)
        for rel in catalog.get("tool_libraries", []):
            target = library_dir / Path(rel).name
            if not target.exists():
                # Preserve a previously installed/edited example when moving
                # from the old configuration-local folder into nc_files.
                previous_library = destination / rel
                seed = previous_library if previous_library.is_file() else source / rel
                libraries[target] = seed.read_bytes()
        old = values(text)
        ref = values(template)
        for filename, key in (("sim.var", ("RS274NGC", "PARAMETER_FILE")),
                              ("tool.tbl", ("EMCIO", "TOOL_TABLE")),
                              ("position.txt", ("TRAJ", "POSITION_FILE"))):
            if key not in ref:
                continue
            rel = profile["state_dir"] + "/" + filename
            if not (destination / rel).exists():
                candidate = Path(old.get(key, rel)).expanduser()
                if not candidate.is_absolute():
                    candidate = destination / candidate
                seed = candidate if existing.is_file() and candidate.is_file() else source / rel
                writes[rel] = seed.read_bytes()
                if filename == 'tool.tbl' and seed == source / rel:
                    # Seed geometry only together with a fresh example table.
                    # Upgrades/migrations retain existing measured tools/metadata.
                    metadata = str(Path(rel).with_suffix('.seed.json'))
                    if not (destination / metadata).exists():
                        writes[metadata] = (source / metadata).read_bytes()
        if migrate_datum:
            for filename, migrate in (("sim.var", lambda t: migrate_xyzac_var(
                                          t, (source / profile["state_dir"] / "sim.var").read_text())),
                                      ("position.txt", migrate_xyzac_position)):
                rel = profile["state_dir"] + "/" + filename
                current = writes[rel].decode() if rel in writes else (
                    (destination / rel).read_text() if (destination / rel).is_file() else None)
                if current is not None:
                    writes[rel] = migrate(current).encode()
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
    if not (writes or links or retired or libraries):
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
    for path, content in libraries.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation protects a library that appeared since planning.
        try:
            with path.open('xb') as stream:
                stream.write(content)
        except FileExistsError:
            pass
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
