#!/usr/bin/env python3
"""Mutants for package S (strip fit): each breaks one claimed defence in an
archive copy of the head; strip-fit.spec must turn red. Run under the heavy
lock, never in a tree a gate uses.

    mutants_s.py <archive-root> <out.json>
"""
import json, pathlib, subprocess, sys, time

ROOT = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
W = ROOT / "lcnc-webui"

MUTANTS = [
    ("S2: no semibold room", "src/style.css",
     ".choice[data-label]::after {\n  content: attr(data-label);", ".choice[data-label]::after {\n  content: none;",
     "a checked choice moves no option"),
    ("S2: jog head adds its width", "src/JogStrip.vue",
     ".stripSection > .jogHead { width: 0; min-width: 100%; }", ".stripSection > .jogHead { }",
     "1axis-x @ touch-fullhd —"),
    ("S4a: tool body does not scroll", "src/ToolStrip.vue",
     ".toolBody { overflow-y: auto; }", ".toolBody { overflow-y: visible; }",
     "the long error note"),
    ("S4a: note words do not break", "src/style.css",
     "min-width: 0; overflow-wrap: break-word; }", "min-width: 0; }",
     "the path error note"),
    ("S4: Tool back to 280 px", "src/style.css",
     "--strip-tool-w: 224px;", "--strip-tool-w: 280px;",
     "3axis-xyz @ touch-fullhd — no overflow"),
    ("S4: offset word back behind the length", "src/ToolStrip.vue",
     '<div class="statusRow"><span class="label-muted md">Z Offset</span><span class="val-status md mono">{{ fmtQty(toolLength, linearUnit) }}</span></div>',
     '<div class="statusRow"><span class="label-muted md">Z Offset</span><span class="val-status md mono">{{ fmtQty(toolLength, linearUnit) }} · {{ offsetWord }}</span></div>',
     "3axis-xyz @ touch-fullhd — no overflow|3axis-xya @ touch-fullhd — Tool at its minimum"),
    ("S4a: tool body hides its overflow", "src/ToolStrip.vue",
     ".toolBody { overflow-y: auto; }", ".toolBody { overflow-y: hidden; }",
     "touch drag"),
    ("S1: portrait keeps the landscape shift", "src/App.vue",
     "    margin-left: 0;   /* the landscape gap cancel (S1) is horizontal only */\n", "",
     "end fade"),
    ("guard: one line demanded under the note too (Codex R408 counter-probe)", "e2e/strip-fit.spec.ts",
     "  expect(fit.clipped, 'cut sideways under the note').toEqual([]);",
     "  expect([...fit.clipped, ...fit.wraps], 'cut sideways under the note').toEqual([]);",
     "corner chamfer"),
    ("sym: Tool does not take the rest of the row", "src/ToolStrip.vue",
     ".toolStrip { width: var(--strip-tool-w); flex-grow: 1; }", ".toolStrip { width: var(--strip-tool-w); }",
     "3axis-xyz @ touch-fullhd — no overflow"),
    ("sym: the card does not reach down", "src/ToolStrip.vue",
     ".toolBody > :last-child { flex: 1 0 auto; }\n", "",
     "3axis-xyz @ touch-fullhd — no overflow"),
    ("sym: Tool shrinks below its minimum", "src/ToolStrip.vue",
     ".toolStrip { width: var(--strip-tool-w); flex-grow: 1; }", ".toolStrip { width: var(--strip-tool-w); flex-grow: 1; flex-shrink: 1; }",
     "3axis-xya @ touch-fullhd — Tool at its minimum"),
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
        r = run(["npx", "playwright", "test", "e2e/strip-fit.spec.ts", "-g", grep, "--reporter=line"],
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
