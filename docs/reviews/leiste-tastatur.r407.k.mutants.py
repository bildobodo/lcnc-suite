#!/usr/bin/env python3
"""Mutants for package K (portrait keys): each breaks one claimed defence in an
archive copy of the head; input-session.spec must turn red. Run under the heavy
lock, never in a tree a gate uses.

    mutants_k.py <archive-root> <out.json>
"""
import json, pathlib, subprocess, sys, time

ROOT = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
W = ROOT / "lcnc-webui"

MUTANTS = [
    ("K1: number keypad tracks fixed", "src/NumberKeypadStrip.vue",
     "  .nkGrid { grid-template-columns: repeat(5, minmax(var(--key-size), 1fr)); }",
     "  .nkGrid { grid-template-columns: repeat(5, var(--key-size)); }",
     "portrait: the keys fill the strip column"),
    ("K1: keyboard content grid fixed", "src/TextKeypadStrip.vue",
     "  .tkContent {\n    grid-template-rows: repeat(6, var(--key-size));\n    grid-template-columns: repeat(5, minmax(var(--key-size), 1fr));",
     "  .tkContent {\n    grid-template-rows: repeat(6, var(--key-size));\n    grid-template-columns: repeat(5, var(--key-size));",
     "portrait: the keys fill the strip column"),
    ("K1: keyboard action row fixed", "src/TextKeypadStrip.vue",
     "  .tkActions {\n    grid-template-rows: var(--key-size);\n    grid-template-columns: repeat(5, minmax(var(--key-size), 1fr));",
     "  .tkActions {\n    grid-template-rows: var(--key-size);\n    grid-template-columns: repeat(5, var(--key-size));",
     "portrait: the keys fill the strip column"),
    ("K2: the X keeps its 44 px", "src/NumberKeypadStrip.vue",
     "grid-row: 1; width: auto; justify-self: stretch; }",
     "grid-row: 1; }",
     "the X is each helper"),
]


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=W, capture_output=True, text=True, **kw)


results = []
for name, rel, old, new, grep in MUTANTS:
    path = W / rel
    src = path.read_text()
    assert src.count(old) == 1, (name, rel, src.count(old))
    path.write_text(src.replace(old, new))
    t0 = time.monotonic()
    try:
        b = run(["npx", "vite", "build"])
        if b.returncode:
            results.append({"mutant": name, "verdict": "BUILD-FAIL", "tail": b.stdout[-400:] + b.stderr[-400:]})
            continue
        r = run(["npx", "playwright", "test", "e2e/input-session.spec.ts", "-g", grep, "--reporter=line"],
                env={**__import__("os").environ, "LCNC_E2E_WORKERS": "3"})
        failed = [l.strip() for l in r.stdout.splitlines() if l.strip().startswith("[e2e] ›")]
        errs = sorted({l.strip()[:160] for l in r.stdout.splitlines() if l.strip().startswith("Error:")})
        results.append({"mutant": name, "file": rel, "grep": grep, "exit": r.returncode,
                        "verdict": "RED" if r.returncode else "GREEN (survived)",
                        "failed_tests": failed, "errors": errs, "seconds": round(time.monotonic() - t0)})
    finally:
        path.write_text(src)
    print(results[-1]["mutant"], results[-1]["verdict"], flush=True)

b = run(["npx", "vite", "build"])
OUT.write_text(json.dumps({"root": str(ROOT), "results": results, "restored_build": b.returncode}, indent=1))
red = sum(1 for r in results if r["verdict"] == "RED")
print(f"{red} of {len(results)} red")
