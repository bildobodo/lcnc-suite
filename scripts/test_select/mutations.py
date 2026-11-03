"""Red-first proof of the selector guards: each mutation breaks one rule or
one mechanism IN PLACE, runs test_selector.py and restores the file. Run by
hand only (never beside another run of the guards in this tree):

    lcnc-gateway/.venv/bin/python3 scripts/test_select/mutations.py

Every line must read RED.
"""
import shutil, subprocess, sys
from pathlib import Path
R = Path("scripts/test_select/rules.py"); S = Path("scripts/test_select/selector.py")
P = Path("scripts/test_select/proof.py"); G = Path("scripts/test_select/graph.py")
RG = Path("scripts/test_select/round_gate.py")
CC = Path("lcnc-webui/src/viewer/collisionContacts.test.ts"); FI = Path("lcnc-webui/e2e/freecad-import.spec.ts")
GC = Path("lcnc-webui/playwright.gate.config.ts")
MUTS = [
 ("a source loses its rule", R, '"probeVars.ts",\n', '\n'),
 ("a rule names a missing spec", R, 'MESSAGES = ("messages", "feedback-channels")', 'MESSAGES = ("messages", "feedback-channels", "gone")'),
 ("a rule glob matches nothing", R, '"CornerGlyph.vue", "axisColors.ts"', '"CornerGlyph.vue", "axisColors.ts", "Nowhere.vue"'),
 ("a heavy data path dropped", R, '    "lcnc-gateway/machine/**",\n)', ')'),
 ("a heavy file dropped", R, '    "lcnc-webui/src/viewer/contactViewIndexed.test.ts",\n', ''),
 ("a read site undeclared", R, '    _E + "freecad-import.spec.ts": (\n', '    _E + "freecad-import.spec-gone.ts": (\n'),
 ("unmatched no longer full", R, '        d.browser_full = d.backend = d.heavy = True', '        pass'),
 ("missing base reads as empty", S, '        raise SelectError(f"no commit {rev!r} — a missing base is never an empty diff") from None', '        return rev'),
 ("no vitest answer skips heavy", S, '        heavy_all = True\n        related: list[str] = []', '        related: list[str] = []'),
 ("a changed heavy test runs the group", S, '                    heavy_files.add(path)', '                    heavy_all = True'),
 ("docs select backend", R, 'none="no product code", final=True', 'none="no product code", final=False'),
 ("a shared module loses an area", R, 'browser=PROGRAM + VIEWER),\n    Rule(src("download.ts")', 'browser=PROGRAM),\n    Rule(src("download.ts")'),
 ("a status-path module not FULL", R, '"viewer/kinematics.ts", "viewer/kins.ts", "viewer/partFrame.ts",', '"viewer/kinematics.ts", "viewer/partFrame.ts",'),
 ("the sweep owns a path alone", R, '        owned |= not rule.additive', '        owned = True'),
 ("a worker counts as an import", G, '            if m.group(4):\n                workers.add(target)  # its owner holds no runtime edge to it\n                continue', '            if m.group(4):\n                workers.add(target)'),
 ("Codex R256: a second read in a heavy file", CC, 'const ROOT = path.resolve(__dirname, "../../..");\n',
  'const ROOT = path.resolve(__dirname, "../../..");\nconst EXTRA = fs.readFileSync(path.join(ROOT, "scripts", "test_fixtures", "macro_refusals.json"), "utf8");\n'),
 ("Codex R256: a second read in a spec, joined path", FI, 'import { readFileSync } from "node:fs";\n',
  'import { readFileSync } from "node:fs";\nconst EXTRA = readFileSync(["..", "scripts", "test_fixtures", "macro_refusals.json"].join("/"), "utf8");\n'),
 ("helpers reached one import deep only", S, '                stack.append(y)\n        return specs', '        return specs'),
 ("a helper's data selects nothing", S, '                browser |= graph.specs_reaching(f)\n        if path.startswith(S_SRC)', '                pass\n        if path.startswith(S_SRC)'),
 ("a UI-only round skips the guards", RG, '    steps = ["selection-guards", "lint", "build", "unit-light"]', '    steps = ["lint", "build", "unit-light"]'),
 ("a listed test that never ran passes", P, '    problems = [f"listed, never ran: {\' | \'.join(k)}" for k in sorted(set(want) - set(got))]', '    problems = []'),
 ("the listing gets the run's report variables", RG, '.items() if k not in JSON_OUT}', '.items()}'),
 ("the gate reuses a running server", GC, 'reuseExistingServer: false', 'reuseExistingServer: true'),
 ("listing ignores the project", P, '        if sel_at[f] != full_at[f]:', '        if False:'),
 ("order ignores a project overlap", P, '        if span[b][0] < span[a][1]:', '        if False:'),
 ("order ignores the path order", P, '        if by_start != sorted(files):', '        if False:'),
]
for name, f, a, b in MUTS:
    src = f.read_text(); assert src.count(a) == 1, name
    f.write_text(src.replace(a, b))
    # Two mutants of one file can share its size and mtime second: a cached
    # .pyc of the previous mutant would be loaded. No bytecode cache at all.
    shutil.rmtree("scripts/test_select/__pycache__", ignore_errors=True)
    try:
        r = subprocess.run([sys.executable, "-B", "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", "scripts/test_select/test_selector.py"], capture_output=True, text=True)
        failed = [l.split("::")[1].split(" ")[0] for l in r.stdout.splitlines() if l.startswith("FAILED")]
        print(f"{'RED ' if r.returncode else 'GREEN!'} {name}: {failed}")
    finally:
        f.write_text(src)
        shutil.rmtree("scripts/test_select/__pycache__", ignore_errors=True)
