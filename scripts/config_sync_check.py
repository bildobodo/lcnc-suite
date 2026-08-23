#!/usr/bin/env python3
"""Deployed-config drift checker (W2 P7).

install.sh copies ``examples/sim_config`` to ``~/linuxcnc/configs/
lcnc_suite_sim`` ONCE and keeps the operator's copy on later runs — so
repo fixes to the INI/HAL templates silently never arrive. The observed
case (review report 4): the repo's TCP INI gained
``HALCMD = setp xyzac-trt-kins.x-offset 0`` while the deployed copy kept
the 5-of-6 pin set, and the suite booted with a "config fallback" banner
until the line was hand-carried over.

This tool prints the EXACT drifted lines per file so that carry-over is a
copy-paste, not an investigation. It is warn-only by design: local edits
are legitimate (that is why install.sh keeps the copy), so the operator
decides what to merge. Expected local divergence never reports:

- whole runtime-artifact files (``*.var``, ``*.tbl``, probe results,
  backups, logs) — LinuxCNC mutates these;
- per-install ``[DISPLAY]``/camera settings lines (WEBUI_TOKEN,
  WEBUI_DEV/HOST/PORT/BROWSER, LOG_DIR, ALLOWED_ORIGINS, CAMERA_*);
- files symlinked back into the repo (in sync by construction — the
  lcnc_webui.hal safety glue).

Exit code: 0 = no drift, 1 = drift reported, 2 = usage/environment error.
install.sh runs it warn-only (non-zero never aborts an install).
"""
import argparse
import difflib
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_REPO = os.path.normpath(os.path.join(_HERE, "..", "examples", "sim_config"))
DEFAULT_DEPLOYED = os.path.expanduser("~/linuxcnc/configs/lcnc_suite_sim")

#: File types worth comparing: config templates and the preview-critical
#: code they reference (the TWP remap fork rides the config dir).
COMPARE_EXT = {".ini", ".hal", ".ngc", ".py", ".comp"}

#: Runtime artifacts LinuxCNC (or the operator) mutates — never compared.
ARTIFACT_RE = re.compile(
    r"(\.var(\.bak)?$|\.tbl$|\.bak(\.|$)|\.log$|^probe-results|position.*\.txt$)",
    re.IGNORECASE)

#: Per-install settings lines whose divergence is expected and healthy.
LOCAL_LINE_RE = re.compile(
    r"^\s*(WEBUI_TOKEN|WEBUI_DEV|WEBUI_HOST|WEBUI_PORT|WEBUI_BROWSER|"
    r"WEBUI_ALLOWED_ORIGINS|LOG_DIR|CAMERA_\w+)\s*=",
    re.IGNORECASE)


def is_artifact(name):
    return bool(ARTIFACT_RE.search(name))


def drifted_lines(repo_text, deployed_text):
    """Non-whitelisted drift between two file bodies.

    Returns (missing_from_deployed, local_only) — lists of (lineno_hint,
    line) where lineno_hint is the line number in the file the line came
    FROM (repo for missing, deployed for local-only). Pure.
    """
    sm = difflib.SequenceMatcher(
        a=repo_text.splitlines(), b=deployed_text.splitlines(), autojunk=False)
    missing, local = [], []
    for tag, a0, a1, b0, b1 in sm.get_opcodes():
        if tag == "equal":
            continue
        for i in range(a0, a1):
            ln = sm.a[i]
            if ln.strip() and not LOCAL_LINE_RE.match(ln):
                missing.append((i + 1, ln))
        for j in range(b0, b1):
            ln = sm.b[j]
            if ln.strip() and not LOCAL_LINE_RE.match(ln):
                local.append((j + 1, ln))
    return missing, local


def check(repo_dir, deployed_dir, out=sys.stdout):
    """Compare every comparable repo file against its deployed twin.

    Returns the number of drifted/missing files (0 = clean)."""
    if not os.path.isdir(repo_dir):
        print(f"repo config dir not found: {repo_dir}", file=sys.stderr)
        return -1
    if not os.path.isdir(deployed_dir):
        print(f"deployed config dir not found: {deployed_dir} "
              f"(nothing installed — nothing to check)", file=out)
        return 0
    drift_files = 0
    for root, _dirs, files in os.walk(repo_dir):
        for name in sorted(files):
            ext = os.path.splitext(name)[1].lower()
            if ext not in COMPARE_EXT or is_artifact(name):
                continue
            rpath = os.path.join(root, name)
            rel = os.path.relpath(rpath, repo_dir)
            dpath = os.path.join(deployed_dir, rel)
            if not os.path.exists(dpath):
                drift_files += 1
                print(f"\n[MISSING] {rel} — in the repo template but not "
                      f"deployed (new file since install?)", file=out)
                continue
            # Symlinked back into the repo = in sync by construction.
            if os.path.islink(dpath) and \
                    os.path.realpath(dpath) == os.path.realpath(rpath):
                continue
            try:
                with open(rpath, errors="replace") as f:
                    rtext = f.read()
                with open(dpath, errors="replace") as f:
                    dtext = f.read()
            except OSError as e:
                drift_files += 1
                print(f"\n[UNREADABLE] {rel}: {e}", file=out)
                continue
            missing, local = drifted_lines(rtext, dtext)
            if not missing and not local:
                continue
            drift_files += 1
            print(f"\n[DRIFT] {rel}", file=out)
            for lineno, ln in missing[:40]:
                print(f"  repo-only    (repo L{lineno}): {ln}", file=out)
            if len(missing) > 40:
                print(f"  … {len(missing) - 40} more repo-only lines", file=out)
            for lineno, ln in local[:40]:
                print(f"  local-only   (deployed L{lineno}): {ln}", file=out)
            if len(local) > 40:
                print(f"  … {len(local) - 40} more local-only lines", file=out)
    return drift_files


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", default=DEFAULT_REPO,
                    help=f"repo template dir (default {DEFAULT_REPO})")
    ap.add_argument("--deployed", default=DEFAULT_DEPLOYED,
                    help=f"deployed config dir (default {DEFAULT_DEPLOYED})")
    a = ap.parse_args()
    n = check(a.repo, a.deployed)
    if n < 0:
        return 2
    if n == 0:
        print("config sync: deployed config matches the repo templates "
              "(per-install settings lines and runtime artifacts excluded)")
        return 0
    print(f"\nconfig sync: {n} file(s) drifted from the repo templates. "
          f"Local edits are legitimate — carry over the repo-only lines you "
          f"want (the P0 class: a template gained a line your copy lacks).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
