#!/usr/bin/env python3
"""R267: inspect pinned sources and a logical HTTP attribution counterexample.
No product imports, builds, test runners, sockets or live state accesses.
"""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
REF = "98beef82"


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True)


def source(path):
    return git("show", f"{REF}:{path}")


ini_calls = []
for path in ("lcnc-gateway/gateway.py", "lcnc-gateway/gcode_parse_worker.py", "lcnc-gateway/gateway_util.py"):
    text = source(path)
    for node in ast.walk(ast.parse(text)):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        category = None
        if isinstance(fn, ast.Attribute) and fn.attr == "findall" and ast.unparse(fn.value) in ("ini", "_ini", "_kini"):
            category = "INI repeated values: outside the four listed forms"
        elif isinstance(fn, ast.Name) and fn.id in ("_ini_float", "_ini_vel", "ini_find", "read_axis_limits"):
            if fn.id != "_ini_float" or not all(isinstance(a, ast.Constant) for a in node.args[1:]):
                category = "INI helper / dynamic family / callable handed on"
        if category:
            ini_calls.append({"path": path, "line": node.lineno, "category": category, "call": ast.unparse(node)})

needles = {
    "scripts/install_examples.py": ["def install(", "settings_path =", "macro_dir = resolve_directory", "library_dir = resolve_directory", "for rel in catalog[\"shared\"]", "symlink_to(target"],
    "examples/sim_config/lcnc_suite_sim_3axis_xyz.ini": ["PROGRAM_PREFIX =", "WEBUI_MACRO_DIR =", "TOOL_LIBRARY_DIR =", "PARAMETER_FILE =", "TOOL_TABLE ="],
    "lcnc-gateway/gateway.py": ['SETTINGS_PATH =', 'SettingsStore(SETTINGS_PATH'],
    "lcnc-webui/src/App.vue": ['function runFromLine(', 'cmd: "auto_run"', 'probe_vars: probeVars', 'toolsetterVarMap(setup.values)'],
    "lcnc-webui/src/toolsetterSetup.ts": ['"3004":', '"3007":', '"3013":', '"3100":', '"3115":'],
    "lcnc-webui/e2e/macroFolder.ts": ['page.route(', 'url.searchParams.get(', 'url.searchParams.has('],
    "lcnc-webui/e2e/collisions.viewer.spec.ts": ['route.fetch()', 'route.fulfill({ response:'],
    "subroutines/tool_length_probe/tool_touch_off.ngc": ['M50 P0'],
    "subroutines/surfacemap/surface_scan.ngc": ['M50 P0'],
    "scripts/test_select/round_gate.py": ['steps = [', 'steps.append("unit-heavy")', 'steps += ["ports-free", "browser"]'],
    "docs/reviews/viewer-palette-fest.r127.f5.txt": ['F2000  +10    G64', 'P_geo → P_rep:', 'P_rep → Q =', 'Korrektur: t = 4'],
}
excerpts = []
for path, search in needles.items():
    text = source(path)
    excerpts.append({"path": path, "sha256": hashlib.sha256(text.encode()).hexdigest(),
                     "matches": [{"line": i, "text": line} for i, line in enumerate(text.splitlines(), 1)
                                 if any(needle in line for needle in search)]})

# These are two possible histories, not a measurement of Playwright or the
# not-yet-built reporter. The proposed key discards their distinguishing fact.
common = {"origin": "run/test/project/retry", "method": "GET", "path": "/g30", "status": 200}
histories = [
    [{**common, "request": "A", "actual": "browser replacement"}, {**common, "request": "B", "actual": "mock served"}],
    [{**common, "request": "A", "actual": "mock served"}, {**common, "request": "B", "actual": "browser replacement"}],
]
projected = [{"browser_finished": [common, common], "mock_served": [common]} for _ in histories]
result = {
    "kind": "static plan review evidence; no live or browser experiment",
    "product": git("rev-parse", REF).strip(),
    "plan": git("rev-parse", "d05bbd27").strip(),
    "ini_counterexamples": ini_calls,
    "source_excerpts": excerpts,
    "http_key_counterexample": {"histories": histories, "observations_under_proposed_key": projected,
                                "indistinguishable": projected[0] == projected[1]},
    "references": ["https://playwright.dev/docs/api/class-request", "https://playwright.dev/docs/api/class-route"],
}
print(json.dumps(result, ensure_ascii=False, indent=2))
