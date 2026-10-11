#!/usr/bin/env python3
"""The suite's TWP Python remaps loaded as the interpreter would, then
`gateway_util.suite_python_reads` asked which entries are bound as reviewed
(docs/reviews/parity-ef.plan.md E4a, Fassung 7, Codex R129–R131). ONE case
per process — a fresh module table.

    python3 suite_py_bind_probe.py <case>

Prints one JSON line {"bound": {entry: [axes]}}. The machine modules the
sources import (interpreter, emccanon, hal) are inert stand-ins; no remap body
runs. Run by test_start_dep_worker.py."""
import json
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "examples" / "sim_config" / "twp" / "python"
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
import gateway_util  # noqa: E402  (pure: no LinuxCNC binding)

for name in ("interpreter", "emccanon", "hal"):
    sys.modules[name] = types.ModuleType(name)
os.environ["INI_FILE_NAME"] = str(HERE.parent / "examples" / "sim_config" / "lcnc_suite_sim_6axis_twp_xyzabc.ini")

case = sys.argv[1]
work = Path(tempfile.mkdtemp(prefix="py-bind-"))
try:
    if case == "foreign_remap_first":
        # a remap.py of its own EARLIER on the path (PATH_PREPEND): the same
        # entry names, another body
        shadow = work / "shadow"
        shadow.mkdir()
        (shadow / "remap.py").write_text("".join(f"def {e}(self, **words):\n    return self.current_x\n"
                                                 for e in gateway_util.SUITE_PY_READS))
        sys.path.insert(0, str(shadow))
        sys.path.insert(1, str(SRC))
    else:
        sys.path.insert(0, str(SRC))
    import remap  # noqa: E402
    mods = sys.modules
    if case == "entry_alias":
        remap.g682 = remap.g683                          # R130: g682 runs g683's body
    elif case == "helper_alias":
        remap.get_current_work_offset = remap.get_current_rotary_positions
    elif case == "imported_helper_alias":
        remap._active_fixture_index = mods["twp_params"].fixture_base
    elif case == "helper_module_binding":
        mods["twp_transform"]._rot_x = mods["twp_transform"].to_table_frame_vector
    elif case == "changed_file":
        # the same names from a copy that differs by one byte
        pass
    elif case != "plain" and case != "foreign_remap_first":
        raise SystemExit(f"unknown case {case}")
    if case == "changed_file":
        copy = work / "copy"
        shutil.copytree(SRC, copy, ignore=shutil.ignore_patterns("__pycache__"))
        with open(copy / "util.py", "a") as f:
            f.write("\n# changed\n")
        mods["util"].__file__ = str(copy / "util.py")
    bound = gateway_util.suite_python_reads(mods)
    print(json.dumps({"bound": {k: sorted(v) for k, v in sorted(bound.items())},
                      "remap_file": getattr(mods.get("remap"), "__file__", None)}))
finally:
    shutil.rmtree(work, ignore_errors=True)
