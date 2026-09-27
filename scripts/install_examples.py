#!/usr/bin/env python3
"""Install the explicit example catalog, preserving controller state and INI edits.

Shared code/models track this checkout. INIs and mutable state remain local.
Before replacing anything, snapshot the complete previous installation outside
the LinuxCNC configuration chooser. No dependency installation or motion.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
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
# travel, the A/C intersection sits at machine Z -500 (was Z 100..500). The
# datum IS the kins pin `xyzac-trt-kins.z-rot-point` (where the kinematics
# puts the A/C intersection): 0 before the move, -500 after. An installed INI
# on the old datum is migrated ONCE by one uniform shift of every
# machine-absolute Z — its own values, local limits included, never the
# template's — and so is the state that came with it (G5x Z, G28/G30 Z, the
# saved joint Z, the WebUI's saved toolsetter Z): program zero stays where
# the operator touched it off. Any other pin value is refused before writing.
XYZAC_INI = "lcnc_suite_sim_5axis_xyzac.ini"
XYZAC_Z_SHIFT = -500.0
XYZAC_DATUMS = {0.0: "old", -500.0: "new"}
# (section, key, whitespace field or None): the INI's machine-absolute Z.
XYZAC_INI_Z = (("TRAJ", "HOME", 2), ("AXIS_Z", "HOME", None),
               ("AXIS_Z", "MIN_LIMIT", None), ("AXIS_Z", "MAX_LIMIT", None),
               ("JOINT_2", "HOME", None), ("JOINT_2", "HOME_OFFSET", None),
               ("JOINT_2", "MIN_LIMIT", None), ("JOINT_2", "MAX_LIMIT", None))
ZROT_PIN = "xyzac-trt-kins.z-rot-point"
# Machine-absolute Z parameters: G28 Z, G30 Z, and Z of G54..G59.3. G92 is an
# offset between coordinate systems and does not move with the datum.
XYZAC_ABSOLUTE_Z = (5163, 5183) + tuple(5223 + 20 * k for k in range(9))
# G28/G30 store the controlled point WITHOUT the tool offset (live 2026-09-27:
# with G43 H1003 = 46.953 active, G30 lands on joint Z -26.275, as without).
# A stored Z outside the old [AXIS_Z] window was never a reachable target —
# shifted it still is not (the old default 0 -> -500); it becomes the top of
# travel, the migrated window's MAX_LIMIT.
XYZAC_REFERENCE_Z = (5163, 5183)
# The old example's shipped toolsetter triple (git 3e501ed: the 3-axis
# values, below the old Z travel — never a position anyone set up). With no
# WebUI section saved for this INI it is replaced by the template's, and the
# report says so. Any other triple is kept at its physical point (#3102 moves
# with the datum): 0/0/0 without a WebUI section is AMBIGUOUS — the WebUI's
# old fallback push, or set in the var file / interpreter directly — and the
# installer cannot tell them apart (Codex R16, XZ-03), so it keeps the point
# and names what to check.
XYZAC_OLD_TEMPLATE_TOOLSETTER = (10.0, 10.0, -180.0)
# Shipped programs a later version superseded, by content: an installed copy
# byte-identical to one of these was never edited and follows the example.
SUPERSEDED_PROGRAMS = {
    # 25bc9a4: the XYZAC demo on the old datum (`G53 G0 Z500` retracts).
    "xyzac5/demo.ngc": {"0e65cc15c6d767ff7e00c3eabc2e136636f880aea997a6c971beb61943174581"},
}


def fmt_number(value):
    return str(int(value)) if float(value).is_integer() else repr(float(value))


def section_lines(text):
    """(section, key, value, line) for every key line of an INI."""
    section = ""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            section = stripped[1:-1].upper()
        elif "=" in stripped and not stripped.startswith(("#", ";")):
            key, value = stripped.split("=", 1)
            yield section, key.strip().upper(), value.strip(), line


def xyzac_datum(text, name=XYZAC_INI):
    """'old' or 'new' — the datum an installed XYZAC INI's kins pin sets.
    Anything else (no pin line, several, another value) is refused: an
    unknown datum cannot be shifted, and a guess would mix two frames."""
    found = []
    for section, key, value, _line in section_lines(text):
        words = value.split()
        if section == "HAL" and key == "HALCMD" and len(words) >= 3 \
                and words[0] == "setp" and words[1] == ZROT_PIN:
            found.append(words[2])
    try:
        datum = XYZAC_DATUMS.get(float(found[0])) if len(found) == 1 else None
    except ValueError:
        datum = None
    if datum is None:
        raise ValueError(
            f"{name}: cannot tell the XYZAC Z datum — `setp {ZROT_PIN}` reads "
            f"{found or 'nothing'}; the installer knows 0 (before 2026-09-27) and -500 "
            f"(Z0 at the top of travel). Set one of them, or move the INI aside, and run again.")
    return datum


def shift_ini_value(value, field):
    if field is None:
        return fmt_number(float(value) + XYZAC_Z_SHIFT)
    words = value.split()
    words[field] = fmt_number(float(words[field]) + XYZAC_Z_SHIFT)
    return " ".join(words)


def z_window(text):
    config = values(text)
    return float(config["AXIS_Z", "MIN_LIMIT"]), float(config["AXIS_Z", "MAX_LIMIT"])


def migrate_xyzac_var(text, template_text, window, setter_saved, report):
    """Shift the machine-absolute Z parameters; seed what the template adds.

    `window` is the migrated [AXIS_Z] window; `setter_saved` says the WebUI
    saved a toolsetter Z for this INI (then #3100-#3102 are the operator's)."""
    rows = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            rows[int(parts[0])] = float(parts[1])
    for number in XYZAC_ABSOLUTE_Z:
        if number in rows:
            rows[number] += XYZAC_Z_SHIFT
    for number in XYZAC_REFERENCE_Z:
        if number in rows and not window[0] <= rows[number] <= window[1]:
            report.append(f"{XYZAC_INI}: #{number} (G{28 if number == 5163 else 30} Z) "
                          f"{fmt_number(rows[number] - XYZAC_Z_SHIFT)} was outside the Z travel "
                          f"(never reachable) — now the top of travel, {fmt_number(window[1])}")
            rows[number] = window[1]
    template_rows = {int(p[0]): float(p[1]) for p in (l.split() for l in template_text.splitlines()) if len(p) >= 2}
    triple = tuple(rows.get(n) for n in (3100, 3101, 3102))
    if not setter_saved and triple == XYZAC_OLD_TEMPLATE_TOOLSETTER:
        rows.update({n: template_rows[n] for n in (3100, 3101, 3102)})
        report.append(f"{XYZAC_INI}: toolsetter #3100-#3102 were the old example's unchanged 10/10/-180 "
                      f"(below the Z travel, never set up) — now the example's "
                      + "/".join(fmt_number(template_rows[n]) for n in (3100, 3101, 3102)))
    elif 3102 in rows:
        if not setter_saved and triple == (0.0, 0.0, 0.0):
            report.append(f"{XYZAC_INI}: toolsetter #3100-#3102 read 0/0/0 and the WebUI saved none for "
                          f"this INI — kept at the same point (Z now {fmt_number(XYZAC_Z_SHIFT)}). If it was "
                          f"never set up, set it in Probing › Toolsetter")
        rows[3102] += XYZAC_Z_SHIFT   # an absolute G53 Z moves with the datum
    for number, value in template_rows.items():
        rows.setdefault(number, value)
    return "".join(f"{n}\t{v:.6f}\n" for n, v in sorted(rows.items()))


def seed_xyzac_state(filename, text, local, shipped, report):
    """A state file seeded from the template carries the TEMPLATE's joint
    home and top of travel (0 and 0); the installed INI may keep its own — a
    lowered window survives the migration (XZ-04). Map the seed by meaning:
    the joint Z starts at this INI's [JOINT_2] HOME, G28/G30 Z are this INI's
    top of travel ([AXIS_Z] MAX_LIMIT, as for an unreachable migrated value).
    Nothing else of the seed changes, and a seed that already fits is
    returned byte for byte (Codex R16, XZ-09)."""
    rel = f"xyzac5/{filename}"
    if filename == "position.txt":
        home, seed_home = float(local["JOINT_2", "HOME"]), float(shipped["JOINT_2", "HOME"])
        lines = text.split("\n")
        if len(lines) > 2 and lines[2].strip() and float(lines[2]) == seed_home != home:
            lines[2] = fmt_number(home)
            report.append(f"{rel}: new file — the joint Z starts at this INI's home, {fmt_number(home)}")
            return "\n".join(lines)
        return text
    top, seed_top = float(local["AXIS_Z", "MAX_LIMIT"]), float(shipped["AXIS_Z", "MAX_LIMIT"])
    rows = {int(p[0]): float(p[1]) for p in (line.split() for line in text.splitlines()) if len(p) >= 2}
    moved = [n for n in XYZAC_REFERENCE_Z if rows.get(n) == seed_top != top]
    if not moved:
        return text
    rows.update({n: top for n in moved})
    report.append(f"{rel}: new file — G28/G30 Z at this INI's top of travel, {fmt_number(top)}")
    return "".join(f"{n}\t{v:.6f}\n" for n, v in sorted(rows.items()))


def migrate_xyzac_position(text):
    """The saved joint positions: Z (the third entry) moves with the datum."""
    lines = text.split("\n")
    if len(lines) > 2 and lines[2].strip():
        z = float(lines[2]) + XYZAC_Z_SHIFT
        lines[2] = str(int(z)) if z == int(z) else repr(z)
    return "\n".join(lines)


def settings_keys_for(settings, ini_path):
    """The settings.json keys the gateway uses for this INI (STAT.ini_filename
    — whatever path LinuxCNC was started with), matched by resolved path."""
    target = Path(ini_path).resolve()
    return [key for key in settings if key.startswith("/") and Path(key).resolve() == target]


def gateway_running():
    for cmdline in Path("/proc").glob("[0-9]*/cmdline"):
        try:
            argv = cmdline.read_bytes().split(b"\0")
        except OSError:
            continue
        if b"gateway:app" in argv:
            return True
    return False


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
    # Suite-owned RS274NGC entries and remaps the installed INI lacks (a new
    # M600/M601, an abort handler): added from the template, never replaced.
    rs274_missing = [f"{key} = {ref[('RS274NGC', key)]}" for key in RS274_SUITE_KEYS
                     if ("RS274NGC", key) in ref and ("RS274NGC", key) not in local]
    local_remaps = remap_lines(text)
    rs274_missing += [line for code, line in remap_lines(template).items() if code not in local_remaps]
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
            elif migrate_datum:
                value = line.split("=", 1)[1].strip()
                words = value.split()
                shift = next((field for s_, k_, field in XYZAC_INI_Z if (s_, k_) == key), False)
                if shift is not False:
                    line = f"{key[1]} = {shift_ini_value(value, shift)}"
                elif key == ("HAL", "HALCMD") and words[:2] == ["setp", ZROT_PIN]:
                    line = f"HALCMD = setp {ZROT_PIN} {fmt_number(float(words[2]) + XYZAC_Z_SHIFT)}"
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


def install(repo, destination, backup_root, settings_path=None, report=None):
    """Plan every write, refuse what cannot be done, back up, then write.

    `settings_path` is the gateway's settings.json (the WebUI's per-INI
    settings; default: the checkout's, which the gateway reads), read only
    when a datum migration needs it; `report` collects what the operator
    should know (printed by main)."""
    repo, destination, backup_root = (Path(p).expanduser().resolve()
                                      for p in (repo, destination, backup_root))
    report = [] if report is None else report
    settings_path = Path(settings_path) if settings_path else repo / "lcnc-gateway/settings.json"
    settings, settings_changed = None, False
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
        migrate_datum = name == XYZAC_INI and existing.is_file() and xyzac_datum(text, name) == "old"
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
        from_template = set()   # state seeded from the NEW template: already on the new datum
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
                if seed == source / rel:
                    from_template.add(rel)
                if filename == 'tool.tbl' and seed == source / rel:
                    # Seed geometry only together with a fresh example table.
                    # Upgrades/migrations retain existing measured tools/metadata.
                    metadata = str(Path(rel).with_suffix('.seed.json'))
                    if not (destination / metadata).exists():
                        writes[metadata] = (source / metadata).read_bytes()
        if migrate_datum:
            # The WebUI's copy of the toolsetter (per INI): its touchZ is the
            # same absolute G53 Z as #3102 — both move, or neither is right.
            if settings is None and settings_path.is_file():
                settings = json.loads(settings_path.read_text())   # unparsable -> refused, nothing written
            keys = settings_keys_for(settings, destination / name) if settings is not None else []
            setters = [settings[k]["toolsetter"] for k in keys
                       if isinstance(settings[k].get("toolsetter"), dict)
                       and isinstance(settings[k]["toolsetter"].get("touchZ"), (int, float))]
            for setter in setters:
                setter["touchZ"] = setter["touchZ"] + XYZAC_Z_SHIFT
                settings_changed = True
            window = z_window(writes[name].decode())
            for filename, migrate in (("sim.var", lambda t: migrate_xyzac_var(
                                          t, (source / profile["state_dir"] / "sim.var").read_text(),
                                          window, bool(setters), report)),
                                      ("position.txt", migrate_xyzac_position)):
                rel = profile["state_dir"] + "/" + filename
                if rel in from_template:
                    continue
                current = writes[rel].decode() if rel in writes else (
                    (destination / rel).read_text() if (destination / rel).is_file() else None)
                if current is not None:
                    writes[rel] = migrate(current).encode()
        if name == XYZAC_INI:
            local = values(writes[name].decode())
            for rel in sorted(from_template):
                if Path(rel).name in ("sim.var", "position.txt"):
                    writes[rel] = seed_xyzac_state(Path(rel).name, writes[rel].decode(),
                                                   local, ref, report).encode()
        for rel in profile["programs"]:
            # User-edited programs remain local, just like offsets/tool tables;
            # an unedited copy of a superseded shipped version follows the example.
            target = destination / rel
            if not target.exists():
                writes[rel] = (source / rel).read_bytes()
            elif hashlib.sha256(target.read_bytes()).hexdigest() in SUPERSEDED_PROGRAMS.get(rel, ()):
                writes[rel] = (source / rel).read_bytes()
            elif migrate_datum and target.read_bytes() != (source / rel).read_bytes():
                beside = str(Path(rel).with_suffix(".new" + Path(rel).suffix))
                writes[beside] = (source / rel).read_bytes()
                report.append(f"{rel} is edited locally and kept — it was written for the old Z datum "
                              f"(Z0 at the rotary intersection); the current one is {beside}")
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
    if settings_changed and gateway_running():
        # A running gateway caches settings.json and would write its copy back.
        raise RuntimeError("Stop the lcnc-suite gateway before updating the installed examples")
    if not (writes or links or retired or libraries or settings_changed):
        return None
    backup = None
    if destination.exists():
        backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        backup = backup_root / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        backup.mkdir(mode=0o700)
        shutil.copytree(destination, backup / "config", symlinks=True)
        if settings_changed:
            shutil.copy2(settings_path, backup / "settings.json")
    if settings_changed:
        tmp = Path(settings_path).with_name(Path(settings_path).name + ".install-tmp")
        tmp.write_text(json.dumps(settings, indent=2) + "\n")
        os.chmod(tmp, Path(settings_path).stat().st_mode & 0o777)
        tmp.replace(settings_path)
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
    report = []
    backup = install(args.repo, args.destination, args.backup_root, report=report)
    print(f"Three example profiles installed: {args.destination}")
    for line in report:
        print(f"  {line}")
    if backup:
        print(f"Previous installation preserved: {backup}")


if __name__ == "__main__":
    main()
