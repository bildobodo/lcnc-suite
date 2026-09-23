"""Recheck the round-7 folder finding using the actual listing and validator.

Reads installed nc_files; temporary fixtures only. No gateway/LCNC import.
Run with lcnc-gateway/.venv/bin/python3 from the repository root.
"""
import ast
import json
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path("lcnc-gateway").resolve()))
from fastapi import HTTPException
from gateway_util import ALLOWED_EXTENSIONS, validate_path_within

tree = ast.parse(Path("lcnc-gateway/gateway.py").read_text())
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "list_files")
fn.decorator_list = []
root = Path.home() / "linuxcnc/nc_files"
scope = dict(os=os, HTTPException=HTTPException, ALLOWED_EXTENSIONS=ALLOWED_EXTENSIONS,
             validate_path_within=validate_path_within, get_nc_files_dir=lambda: str(root))
exec(compile(ast.Module(body=[fn], type_ignores=[]), "gateway.py:list_files", "exec"), scope)
listing = scope["list_files"]
local = listing()
names = {e["name"] for e in local["entries"]}
excluded = [p.name for p in root.iterdir() if p.is_symlink() and not p.resolve().is_relative_to(root.resolve())]
assert all(name not in names for name in excluded)
opened = []
for entry in local["entries"]:
    if entry["type"] == "directory":
        listing(entry["path"])
        opened.append(entry["name"])
report = {"date": "2026-09-23", "productCommit": "358d6dc", "localRoot": str(root),
          "externalLinksExcluded": sorted(excluded), "listedDirectoriesOpened": opened}
with tempfile.TemporaryDirectory(prefix="ui-r8-files-") as tmp:
    base = Path(tmp)
    root = base / "nc_files"
    (root / "real").mkdir(parents=True)
    (root / "real/program.ngc").write_text("M2\n")
    (root / "internal-link").symlink_to(root / "real", target_is_directory=True)
    (base / "external").mkdir()
    (base / "external/other.ngc").write_text("M2\n")
    (root / "external-dir").symlink_to(base / "external", target_is_directory=True)
    (root / "external-file.ngc").symlink_to(base / "external/other.ngc")
    items = listing()["entries"]
    assert {e["name"] for e in items} == {"real", "internal-link"}
    for entry in items:
        assert [e["name"] for e in listing(entry["path"])["entries"]] == ["program.ngc"]
    try:
        listing("external-dir")
    except HTTPException as error:
        assert error.status_code == 400
    else:
        raise AssertionError("External path validation must still refuse opening")
    report["fixtures"] = {"internalDirectoriesOpen": True, "externalDirectoryAndFileExcluded": True,
                          "directExternalOpenStillRefused": True}
Path("docs/reviews/ui-optimierungen.implementation-review.r8.files-evidence.json").write_text(
    json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
