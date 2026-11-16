#!/usr/bin/env python3
"""Red proofs of step 6 (plan vor-maschine R385 D/E/F): each mutant breaks ONE
thing in ~/lcnc-suite-ff, runs what must see it, restores the file (and the
build). Run with the gateway venv; every Playwright run under the heavy lock.

    ~/lcnc-suite-pl/lcnc-gateway/.venv/bin/python3 -I ~/claude-work/ffcore/mutants.py <out-dir> [ids…]
"""
import json
import subprocess
import sys
from pathlib import Path

TREE = Path.home() / "lcnc-suite-ff"
WEB = TREE / "lcnc-webui"
PY = sys.executable
sys.path.insert(0, str(TREE / "scripts"))
from test_support.heavy_lock import heavy_lock  # noqa: E402

OUT = Path(sys.argv[1]).resolve()
ONLY = set(sys.argv[2:])
OUT.mkdir(parents=True, exist_ok=True)

SMOKE = "lcnc-webui/e2e/smoke.spec.ts"
DIALOGS = "lcnc-webui/e2e/dialogs.spec.ts"
LAYOUT = "lcnc-webui/e2e/layout.spec.ts"
CONFIG = "lcnc-webui/playwright.firefox.config.ts"
STYLE = "lcnc-webui/src/style.css"
PROBE = "lcnc-webui/src/ProbePanel.vue"
TEST_TS = "lcnc-webui/e2e/test.ts"

OLD_OVERLAY = """.dialogOverlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  border-radius: var(--radius-container);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
}
.dialogOverlay::before { content: none; }"""

# id: (what, [(file, old, new)], build, runs, expect)
#   runs: "firefox" = the runner on the whole set; ("chromium", [specs]) = the gate config on those specs
MUTANTS = {
    "F1": ("a touch call in a core spec", [(SMOKE, '  await page.goto("/");\n  await expect(page.locator("#app")).toBeVisible();',
                                              '  await page.goto("/");\n  await page.locator("#app").tap();\n  await expect(page.locator("#app")).toBeVisible();')],
           False, ["firefox"], {"firefox-static": "FAIL"}),
    "F2": ("a core test reaching tapMore", [(DIALOGS, 'import { clickMore, moreTrigger } from "./more";',
                                             'import { clickMore, moreTrigger, tapMore } from "./more";'),
                                            (DIALOGS, 'await clickMore(page.locator(".ctrlRow"), "Edit");',
                                             'await tapMore(page.locator(".ctrlRow"), "Edit");')],
           False, ["firefox"], {"firefox-static": "PASS", "firefox-core": "FAIL"}),
    "F3": ("a test.skip in a core test", [(SMOKE, 'test("app shell mounts with no gateway connected", async ({ page }) => {\n',
                                           'test("app shell mounts with no gateway connected", async ({ page }) => {\n  test.skip(true, "mutant F3");\n')],
           False, ["firefox"], {"firefox-executed": "FAIL"}),
    "F4": ("a core title renamed", [(SMOKE, 'test("Arm control stays reachable"', 'test("Arm control stays reachable (renamed)"')],
           False, ["firefox"], {"firefox-set": "FAIL"}),
    "F5": ("a variant of the grid guard lost", [(LAYOUT, "  for (const state of ['homed', 'unhomed'] as const) {",
                                                  "  for (const state of ['homed'] as const) {")],
           False, ["firefox"], {"firefox-set": "FAIL"}),
    "F6": ("the started browser is not the pin", [(CONFIG, "process.env.LCNC_FIREFOX_VERSION = PIN.version;",
                                                    'process.env.LCNC_FIREFOX_VERSION = "159.0";')],
           False, ["firefox"], {"firefox-core": "FAIL"}),
    "F9": ("the page not unloaded before its context closes", [(TEST_TS, '      await unloadInContext(page, mock.instance, { testId: testInfo.testId, title: testInfo.title, retry: testInfo.retry });\n', '      await Promise.resolve();\n')],
           False, ["firefox"], {"firefox-replay": "FAIL"}),
    "E": ("the old overlay: a radius on the backdrop itself", [(STYLE, "", "")],   # whole rule swapped below
          True, ["firefox", ("chromium", ["dialogs"])], {"firefox-core": "FAIL"}),
    "G": ("the glyph collapse: .gridWrap without width: 100%", [(PROBE, "  gap: var(--gap-controls);\n  width: 100%;\n  max-width: 286px;",
                                                                  "  gap: var(--gap-controls);\n  max-width: 286px;")],
          True, ["firefox", ("chromium", ["probe-visual", "layout"])], {"firefox-core": "FAIL"}),
}


def sh(cmd, cwd=TREE, **kw):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, **kw)


def build():
    r = sh(["npm", "run", "build"], cwd=WEB)
    if r.returncode:
        raise SystemExit(f"build failed: {r.stdout[-500:]}{r.stderr[-500:]}")


def apply(edits, mid):
    for f, old, new in edits:
        p = TREE / f
        s = p.read_text()
        if mid == "E":
            start = s.index(".dialogOverlay {")
            end = s.index("}", s.index(".dialogOverlay::before {")) + 1
            s = s[:start] + OLD_OVERLAY + s[end:]
            s = s.replace("  /* positioned, so it paints in tree order AFTER the overlay's scrim\n     (.dialogOverlay::before) — over it, never dimmed by it */\n  position: relative;\n", "")
        else:
            assert s.count(old) == 1, (mid, f, old[:50])
            s = s.replace(old, new)
        p.write_text(s)


def restore(edits):
    files = sorted({f for f, _, _ in edits})
    r = sh(["git", "checkout", "--", *files])
    if r.returncode:
        raise SystemExit(f"restore failed: {r.stderr}")
    if sh(["git", "status", "--porcelain", "--untracked-files=no"]).stdout:
        raise SystemExit("the tree is not clean after a restore")


def run_firefox(d: Path) -> dict:
    with heavy_lock(f"step6 mutant {d.name}"):
        sh([PY, "-I", str(TREE / "scripts/test_select/firefox.py"), "--out", str(d)])
    r = json.loads((d / "firefox-core.json").read_text())
    return {c["name"]: c["status"] for c in r["checks"]}, {c["name"]: (c.get("why") or [])[:3] for c in r["checks"] if c.get("why")}


def run_chromium(d: Path, specs: list[str]) -> dict:
    rep = d / f"chromium-{'-'.join(specs)}.json"
    with heavy_lock(f"step6 mutant {d.name} chromium"):
        sh(["npx", "playwright", "test", "-c", "playwright.gate.config.ts", *[f"e2e/{s}.spec.ts" for s in specs],
            "--trace", "off", "--reporter=json"], cwd=WEB, env={**__import__("os").environ, "PLAYWRIGHT_JSON_OUTPUT_NAME": str(rep)})
    st = json.loads(rep.read_text())["stats"]
    failed = []

    def walk(s):
        for sp in s.get("specs", []):
            for t in sp["tests"]:
                if any(r["status"] != "passed" for r in t["results"]):
                    failed.append(f"{sp['file']} › {sp['title']}")
        for x in s.get("suites", []):
            walk(x)
    for s in json.loads(rep.read_text())["suites"]:
        walk(s)
    return {"passed": st["expected"], "failed": st["unexpected"], "failed_tests": failed}


summary = {}
head = sh(["git", "rev-parse", "HEAD"]).stdout.strip()
if sh(["git", "status", "--porcelain", "--untracked-files=no"]).stdout:
    raise SystemExit("the tree must be clean")
for mid, (what, edits, needs_build, runs, expect) in MUTANTS.items():
    if ONLY and mid not in ONLY:
        continue
    d = OUT / mid
    d.mkdir(exist_ok=True)
    row = {"what": what, "head": head}
    try:
        apply(edits, mid)
        if needs_build:
            build()
        for r in runs:
            if r == "firefox":
                row["firefox"], row["firefox_why"] = run_firefox(d)
            else:
                row["chromium"] = run_chromium(d, r[1])
    finally:
        restore(edits)
        if needs_build:
            build()
    ff = row.get("firefox", {})
    row["red"] = all(ff.get(k) == v for k, v in expect.items()) and "FAIL" in ff.values() if ff else None
    if mid == "G":
        # TS248-05: red in the image AND the size check — each of the five grid
        # procedures must report BOTH errors (expect.soft), read off the report
        errs = {}

        def walk(suite):
            for sp in suite.get("specs", []):
                if sp["file"] == "probe-visual.spec.ts":
                    msgs = [e.get("message", "") for t in sp["tests"] for r in t["results"] for e in r.get("errors", [])]
                    errs[sp["title"].split(":")[0]] = {"size": any("square cells" in m for m in msgs),
                                                       "image": any("toHaveScreenshot" in m or "Screenshot comparison failed" in m for m in msgs)}
            for x in suite.get("suites", []):
                walk(x)
        for su in json.loads((d / "firefox.json").read_text())["suites"]:
            walk(su)
        row["probe_visual_errors"] = errs
        grid = ("Outside", "Inside", "Angle", "Boss/Pocket", "Ridge/Valley")
        both = all(errs.get(g, {}).get("size") and errs.get(g, {}).get("image") for g in grid)
        clean = not any(v["size"] or v["image"] for k, v in errs.items() if k not in grid)
        row["red"] = bool(row["red"] and both and clean)
    summary[mid] = row
    print(f"{'RED ' if row['red'] else 'GREEN!'} {mid} {what}: {ff} {row.get('chromium', {}).get('failed', '')} {row.get('probe_visual_errors', '')}", flush=True)
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
