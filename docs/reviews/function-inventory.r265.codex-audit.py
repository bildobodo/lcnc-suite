#!/usr/bin/env python3
"""Read-only R265 source audit; no imports from the product, servers or tests.

Run from any directory: python3 <this-file> [repository] > evidence.json
This checks the named declarations, not arbitrary TypeScript/Vue syntax.
The pinned sources make the comparison reproducible across worktrees.
"""
import collections
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2])
PRODUCT = "4a2a068a"
DOCUMENT = "569eee5e"


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True)


def source(path, ref=PRODUCT):
    return git("show", f"{ref}:{path}")


def section(text, start, end):
    if text.count(start) != 1:
        raise ValueError(f"Declaration changed: {start}")
    return text.split(start, 1)[1].split(end, 1)[0]


atoms_text = source("docs/reviews/function-inventory.atoms.json", DOCUMENT)
atoms = json.loads(atoms_text)
defaults = source("lcnc-webui/src/defaults.ts")
gamepad_body = section(defaults, "export const GAMEPAD_ACTIONS:", "\n];").split("= [", 1)[1]
gamepad_values = re.findall(r'\{\s*value:\s*"([^\"]+)"', gamepad_body)
if len(gamepad_values) != gamepad_body.count("{ value:"):
    raise ValueError("Unsupported gamepad declaration")
keyboard_axes = re.findall(r'"([xyzabcuvw])"', section(defaults, "export const KB_AXIS_LETTERS =", "] as const;"))
keyboard_body = section(defaults, "export const KEYBOARD_ACTION_LABELS:", "} as Record<KeyboardAction, string>;")
if "..._jogEntries((l, d)" not in keyboard_body or len(keyboard_axes) != 9:
    raise ValueError("Unsupported keyboard declaration")
keyboard_values = [f"jog_{axis}{direction}" for axis in keyboard_axes for direction in "+-"]
keyboard_values += re.findall(r'^\s*(\w+): INPUT_COMMAND_LABELS\.', keyboard_body, re.M)
by_key = collections.defaultdict(list)
for item in atoms["controls"]:
    by_key[item["key"]].append({"file": item["file"], "line": item["line"]})

# Small, version-bound excerpts for the other source findings. These are
# facts for a design discussion; no runtime behavior is claimed as measured.
queries = [
    ("lcnc-webui/src/controlScan.ts", ["const CATALOG_ATTR", "const RAW_CONTROLS", "const ACTION_EVENTS", "function templateOf", "const isRaw"]),
    ("lcnc-webui/e2e/tool-import.spec.ts", ["page.route(", "route.fulfill"]),
    ("lcnc-webui/e2e/macroFolder.ts", ["page.route("]),
    ("lcnc-webui/e2e/test.ts", ['event: "test-start"', 'event: "test-end"', "appConnectFrames()", "browser.contexts()"]),
    ("lcnc-webui/src/App.vue", [':eoffsetEnabled="!!', ':compMethod="st.comp_method']),
    ("lcnc-webui/src/ProbePanel.vue", ["const METHOD_LABELS", "Compensation:", ':modelValue="compMethod ?? 2"']),
    ("lcnc-gateway/gateway.py", ['if cmd == "set_compensation"', 'if cmd == "set_compensation_method"', 'if cmd == "confirm_tool_change"', 'await _loop.run_in_executor(None, _hal_send, {"compensation_', 'delivered = await _loop.run_in_executor(None, _hal_send, {"tool_changed"']),
    ("scripts/macro_live_check.py", ["Never run it on", "The intended target is a COPY", "Each run ends with", "the HAL watchdog trips"]),
    ("scripts/toolsetter_readback_check.py", ["Ends by terminating", "nothing is run", "s = linuxcnc.stat()"]),
    ("scripts/test_support/live_session.py", ["if requested and seq != confirmed", 'self.send({"cmd": "confirm_tool_change"']),
    ("scripts/perf_matrix.py", ["--allow-trip", "asserts the HAL latch", "recovery sequence"]),
]
excerpts = []
for path, needles in queries:
    text = source(path)
    excerpts.append({
        "path": path,
        "sha256": hashlib.sha256(text.encode()).hexdigest(),
        "matches": [{"line": i, "text": line} for i, line in enumerate(text.splitlines(), 1)
                    if any(needle in line for needle in needles)],
    })

result = {
    "kind": "static source audit only; no runtime/test/live measurements",
    "product_commit": git("rev-parse", PRODUCT).strip(),
    "document_commit": git("rev-parse", DOCUMENT).strip(),
    "atom_file_sha256": hashlib.sha256(atoms_text.encode()).hexdigest(),
    "atom_sections": list(atoms),
    "atom_counts": {key: len(value) for key, value in atoms.items()},
    "controls": {
        "occurrences": len(atoms["controls"]),
        "unique_keys": len(by_key),
        "files": len({x["file"] for x in atoms["controls"]}),
        "duplicate_keys": {key: value for key, value in by_key.items() if len(value) > 1},
    },
    "gamepad": {
        "declared_values": gamepad_values,
        "inventoried_values": [row[0] for row in atoms["gamepad"]],
        "missing": sorted(set(gamepad_values) - {row[0] for row in atoms["gamepad"]}),
        "note": "Includes the 'none' assignment; these are declared choices, not 12 machine commands.",
    },
    "keyboard": {
        "declared_actions": keyboard_values,
        "inventoried": atoms["keyboard"],
        "note": "21 bindable actions; absent axes and unbound defaults need not be active on a given profile.",
    },
    "source_excerpts": excerpts,
}
print(json.dumps(result, ensure_ascii=False, indent=2))
