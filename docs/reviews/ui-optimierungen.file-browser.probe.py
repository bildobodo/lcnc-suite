"""Reproduce listed-but-rejected folders without importing/running gateway.

Run from repo root with lcnc-gateway/.venv/bin/python. Calls the actual
list_files function extracted by AST, using its original path validator.
Reads the local NC directory; creates comparison fixtures only in /tmp.
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
from tool_files import list_entries

source = Path("lcnc-gateway/gateway.py")
tree = ast.parse(source.read_text())
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "list_files")
fn.decorator_list = []
module = ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[]))
root = Path.home() / "linuxcnc/nc_files"
scope = dict(os=os, HTTPException=HTTPException, ALLOWED_EXTENSIONS=ALLOWED_EXTENSIONS,
             validate_path_within=validate_path_within, get_nc_files_dir=lambda: str(root))
exec(compile(module, str(source), "exec"), scope)
list_files = scope["list_files"]

def examine():
    result = []
    for entry in list_files()["entries"]:
        if entry["type"] != "directory":
            continue
        p = root / entry["path"]
        row = dict(name=entry["name"], listed=True, symlink=p.is_symlink(), target=str(p.resolve()))
        try:
            list_files(entry["path"])
            row["open"] = "ok"
        except HTTPException as exc:
            row.update(status=exc.status_code, error=exc.detail)
        result.append(row)
    return result

report = {"method": "Unchanged list_files body, original validator; no HTTP server or LinuxCNC imports",
          "local_root": str(root), "local_directories": examine()}
with tempfile.TemporaryDirectory(prefix="ui-folder-review-", dir="/tmp") as tmp:
    base = Path(tmp)
    root = base / "nc_files"
    root.mkdir()
    (root / "ordinary").mkdir()
    (root / "internal-link").symlink_to(root / "ordinary", target_is_directory=True)
    outside = base / "external"
    outside.mkdir()
    (root / "external-link").symlink_to(outside, target_is_directory=True)
    report["comparison"] = examine()
    report["tools_listing_same_fixture"] = [e["name"] for e in list_entries(root)["entries"]]
    assert all(e["open"] == "ok" for e in report["comparison"] if e["name"] != "external-link")
    assert next(e for e in report["comparison"] if e["name"] == "external-link")["error"] == "Invalid directory"
    assert "external-link" not in report["tools_listing_same_fixture"]
print(json.dumps(report, indent=2))
