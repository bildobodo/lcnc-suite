"""The test selector's guards (test strategy step 3, Codex R248 TS248-01).

Both directions of the rule table against the tracked tree, the disk reads
of the heavy group and of the e2e specs, and the mechanism's counter-cases
on synthetic diffs in a scratch repository.
"""
from __future__ import annotations

import copy
import json
import re
import socket
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from test_select import dryrun, reads, rules, selector  # noqa: E402
from test_select.rules import (  # noqa: E402
    FULL, FULL_ONLY, HEAVY_LOADER, HEAVY_THRESHOLD_MS, HEAVY_UNIT, READ_SITES, RULES, decide, matches,
)

ROOT = Path(__file__).resolve().parents[2]
E2E = ROOT / "lcnc-webui" / "e2e"
TIMES = json.loads((Path(__file__).parent / "times.json").read_text())


def tracked() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True)
    return [p for p in out.stdout.splitlines() if (ROOT / p).exists()]


def spec_names() -> set[str]:
    return {p.name[: -len(".spec.ts")] for p in E2E.glob("*.spec.ts")}


# ── Both directions ──────────────────────────────────────────────────────
def test_every_spec_is_named_by_a_rule_or_owned_by_the_full_run():
    named = set().union(*(set(r.browser) for r in RULES if r.browser != FULL))
    assert sorted(spec_names() - named - set(FULL_ONLY)) == []
    assert sorted(set(FULL_ONLY) & named) == [], "a FULL_ONLY spec is named by a narrower rule"


def test_every_named_spec_exists():
    named = set().union(*(set(r.browser) for r in RULES if r.browser != FULL))
    assert sorted((named | set(FULL_ONLY)) - spec_names()) == []


def test_every_rule_glob_matches_a_tracked_file():
    files = tracked()
    dead = [(r.why, g) for r in RULES for g in r.globs if not any(matches(g, f) for f in files)]
    assert dead == []


def test_every_tracked_source_has_a_rule():
    """No tracked file falls to the fail-closed default: a new file comes
    with its rule (the default stays as the runtime's safety net)."""
    unmatched = [f for f in tracked() if decide(f).unmatched
                 and not re.search(r"\.(spec|test)\.ts$", f)
                 and not f.startswith("lcnc-webui/e2e/")]
    assert unmatched == []


# ── The heavy group ──────────────────────────────────────────────────────
def test_heavy_unit_files_exist_and_no_other_file_is_as_slow():
    for f in HEAVY_UNIT:
        assert (ROOT / f).is_file(), f
    times = TIMES["unit_ms"]
    assert sorted(set(HEAVY_UNIT) - set(times)) == [], "a heavy file without a recorded time"
    slow = sorted(f for f, ms in times.items() if ms >= HEAVY_THRESHOLD_MS and f not in HEAVY_UNIT)
    assert slow == [], f"above {HEAVY_THRESHOLD_MS} ms but not in HEAVY_UNIT"
    fast = sorted(f for f in HEAVY_UNIT if times[f] < HEAVY_THRESHOLD_MS)
    assert fast == [], "in HEAVY_UNIT but below the threshold"


def test_every_read_site_is_declared_exactly():
    """Every read or run in the heavy files, the e2e files and the node-side
    src modules belongs to exactly one READ_SITES entry, every entry finds
    exactly its count, every repo literal a file names lies under its reads
    (Codex R256 TS256-02: a second unknown read is never covered by a first)."""
    assert reads.problems(ROOT) == []


FORMS = {   # source → (calls found as (primitive, the text's start), refused count)
    'import fs from "node:fs";\nfs.readFileSync("a");': ([("readFileSync", 'readFileSync("a")')], 0),
    'import fs from "node:fs";\nfs.\nreadFileSync("a");': ([("readFileSync", 'readFileSync("a")')], 0),
    'import fs from "node:fs";\nfs .readFileSync ("a");': ([("readFileSync", 'readFileSync ("a")')], 0),
    'import extraFs, { constants } from "node:fs";\nextraFs.readFileSync("a");': ([("readFileSync", 'readFileSync("a")')], 0),
    'import * as fs from "fs";\nfs.promises.readFile("a");': ([("readFile", 'readFile("a")')], 0),
    'import { readFileSync as rf } from "node:fs";\nrf("a"); rf("b");': ([("readFileSync", 'rf("a")'), ("readFileSync", 'rf("b")')], 0),
    'import fs = require("node:fs");\nfs.existsSync("a");': ([("existsSync", 'existsSync("a")')], 0),
    'import { execFileSync } from "node:child_process";\nexecFileSync("python3", []);': ([("execFileSync", 'execFileSync("python3", [])')], 0),
    'import { constants, writeFileSync } from "node:fs";\nwriteFileSync("x", "y");': ([], 0),
    '// readFileSync("a")\nconst s = "readFileSync(b)";': ([], 0),
    'const re = /x/; re.exec("y"); dialog.open();': ([], 0),
    'import fs from "node:fs";\nfs["readFileSync"]("a");': ([], 1),
    'import fs from "node:fs";\nconst { readFileSync } = fs;': ([], 1),
    'import fs from "node:fs";\nconst r = fs.readFileSync;': ([], 1),
    'import { readFileSync } from "node:fs";\nconst rd = readFileSync;': ([], 1),
    'import fs from "node:fs";\nhelper(fs);': ([], 1),
    'const fs = require("node:fs");': ([], 1),
    'const m = await import("node:fs");': ([], 1),
    'export * from "node:fs";': ([], 1),
    # Codex R259: the namespaces default / promises, imported by name or taken as a value
    'import { default as extraFs } from "node:fs";\nextraFs.readFileSync("a");': ([("readFileSync", 'readFileSync("a")')], 0),
    'import { promises as ioPromises } from "node:fs";\nawait ioPromises.readFile("a");': ([("readFile", 'readFile("a")')], 0),
    'import fs from "node:fs";\nconst ioPromises = fs.promises;\nawait ioPromises.readFile("a");': ([], 1),
    'import fs from "node:fs";\nconst { readFile } = fs.promises;': ([], 1),
    'import fs from "node:fs";\nfs.promises.readFile("a"); fs.default.readFileSync("b");': (
        [("readFile", 'readFile("a")'), ("readFileSync", 'readFileSync("b")')], 0),
    # the closed classification: a write admitted, anything unclassified refused
    'import fs from "node:fs";\nfs.appendFileSync("x", "y"); fs.writeFileSync("x", "y");': ([], 0),
    'import fs from "node:fs";\nfs.someNewThing("x");': ([], 1),
    'import { someNewThing } from "node:fs";': ([], 1),
    'import { readFile } from "node:fs/promises";\nawait readFile("a");': ([("readFile", 'readFile("a")')], 0),
}


def test_the_scanner_finds_every_admitted_call_and_refuses_every_other_form(tmp_path: Path):
    """The read-site scanner's language on the TypeScript parser (Codex R258):
    whitespace anywhere JavaScript allows, mixed imports, .promises, import =
    require; and every form outside it refused — never "no read"."""
    files = []
    for i, src in enumerate(FORMS):
        f = tmp_path / f"form{i}.ts"
        f.write_text(src)
        files.append(str(f))
    out = reads.scan(ROOT, files)
    for f, (src, (want_calls, want_refused)) in zip(files, FORMS.items()):
        got = out[f]
        assert [(c["prim"], c["text"]) for c in got["calls"]] == [(p, t) for p, t in want_calls], src
        assert len(got["refused"]) == want_refused, (src, got["refused"])


def test_the_heavy_loader_reads_only_what_its_entry_declares():
    """What the FixtureFiles loader and collisionBounds are handed: the
    ROOT-relative literals of the heavy files and collisionFixtures.ts — each
    exists and lies under HEAVY_LOADER, and every HEAVY_LOADER glob is used."""
    lits = reads.heavy_literals(ROOT)
    assert len(lits) >= 5
    loose = [l for l in lits if not any(matches(g, l) or matches(g, l.rstrip("/") + "/x") for g in HEAVY_LOADER)]
    assert loose == []
    assert [l for l in lits if not (ROOT / l).exists()] == []
    unused = [g for g in HEAVY_LOADER if not any(matches(g, l) or matches(g, l.rstrip("/") + "/x") for l in lits)]
    assert unused == []


def test_the_real_chain_reaches_the_spec_two_helpers_up():
    """probe-click.spec → layout-fixtures → macroFolder → macro_refusals.json
    (Codex R256 TS256-01): a change to the helper or to its data selects
    probe-click, not only macroFolder's direct importers."""
    g = selector.E2EGraph(ROOT, "HEAD")
    assert g.problems == []
    reaching = g.specs_reaching("lcnc-webui/e2e/macroFolder.ts")
    assert {"probe-click", "layout", "macros"} <= reaching
    assert selector.readers_of("scripts/test_fixtures/macro_refusals.json") == ["lcnc-webui/e2e/macroFolder.ts"]
    assert "probe-click" in g.specs_reaching("lcnc-webui/src/probeVars.ts")


# ── Counter-cases on synthetic diffs ─────────────────────────────────────
def sh(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=True).stdout


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A scratch repository with the real tree's names: every spec (empty),
    one helper imported by one spec, a central and a plain source, a heavy
    test and a model."""
    r = tmp_path / "repo"
    (r / "lcnc-webui/e2e").mkdir(parents=True)
    for name in spec_names():
        (r / f"lcnc-webui/e2e/{name}.spec.ts").write_text("")
    (r / "lcnc-webui/e2e/joint-jog.spec.ts").write_text('import { x } from "./jogHelper";\n')
    (r / "lcnc-webui/e2e/jogHelper.ts").write_text("export const x = 1;\n")
    (r / "lcnc-webui/e2e/orphanHelper.ts").write_text("export const y = 1;\n")
    # the real chain (Codex R256 TS256-01): spec → layout-fixtures → macroFolder → data
    (r / "lcnc-webui/e2e/probe-click.spec.ts").write_text(
        'import { openLayout } from "./layout-fixtures";\nimport { probeVarMap } from "../src/probeVars";\n')
    (r / "lcnc-webui/e2e/layout-fixtures.ts").write_text("import { Folder, serveNow } from './macroFolder';\n")
    (r / "lcnc-webui/e2e/macroFolder.ts").write_text("export const Folder = 1;\n")
    for p in ("lcnc-webui/src/format.ts", "lcnc-webui/src/ProbePanel.vue", "lcnc-webui/src/probeVars.ts",
              HEAVY_UNIT[0], "examples/sim_config/machine-5axis-xyzac/table.stl", "docs/notes.md",
              "scripts/test_fixtures/macro_refusals.json"):
        (r / p).parent.mkdir(parents=True, exist_ok=True)
        (r / p).write_text("v1\n")
    sh(r, "init", "-q", "-b", "main")
    sh(r, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    sh(r, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base")
    return r


def commit_change(r: Path, edit) -> str:
    edit(r)
    sh(r, "add", "-A")
    sh(r, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "change")
    return "HEAD~1"


def test_a_new_source_without_a_rule_selects_everything(repo: Path):
    base = commit_change(repo, lambda r: (r / "lcnc-webui/src/brandNew.ts").write_text("x\n"))
    sel = selector.select(repo, base, "HEAD", vitest_files=[])
    assert sel["unmatched"] == ["lcnc-webui/src/brandNew.ts"]
    assert sel["browser"]["run"] == FULL and sel["backend"]["run"] and sel["unit"]["heavy"] == sorted(HEAVY_UNIT)


def test_a_renamed_central_source_selects_the_full_run_by_both_paths(repo: Path):
    base = commit_change(repo, lambda r: (r / "lcnc-webui/src/format.ts").rename(r / "lcnc-webui/src/fmt.ts"))
    sel = selector.select(repo, base, "HEAD", vitest_files=[])
    paths = [(row["status"], row["path"]) for row in sel["changed"]]
    assert ("R-from", "lcnc-webui/src/format.ts") in paths and ("R-to", "lcnc-webui/src/fmt.ts") in paths
    assert sel["browser"]["run"] == FULL
    assert any("format.ts" in why for why in sel["browser"]["reasons"])


def test_a_changed_heavy_test_runs_exactly_itself(repo: Path):
    base = commit_change(repo, lambda r: (r / HEAVY_UNIT[0]).write_text("v2\n"))
    sel = selector.select(repo, base, "HEAD", vitest_files=[HEAVY_UNIT[0]])
    assert sel["unit"]["changed"] == [HEAVY_UNIT[0]]
    assert sel["unit"]["heavy"] == [HEAVY_UNIT[0]], "exactly itself, not the group"
    assert sel["browser"]["run"] == [] and not sel["backend"]["run"]


def test_a_model_change_selects_the_heavy_group_and_the_specs_that_read_it(repo: Path):
    base = commit_change(repo, lambda r: (r / "examples/sim_config/machine-5axis-xyzac/table.stl").write_text("v2\n"))
    sel = selector.select(repo, base, "HEAD", vitest_files=[])
    readers = sorted(f for f, rs in READ_SITES.items() if f in HEAVY_UNIT
                     and any(r.reads and any(matches(g, "examples/sim_config/machine-5axis-xyzac/table.stl") for g in r.reads) for r in rs))
    assert len(readers) == 7 and sel["unit"]["heavy"] == readers, "exactly the heavy files that read it"
    assert sel["backend"]["run"]
    assert sel["browser"]["run"] == ["bake-hold.viewer", "collisions.viewer", "reach.viewer", "simulation-off.viewer", "toolsetter.viewer"]


def test_a_var_file_selects_the_backend_and_the_probe_live_check_not_the_heavy_group(repo: Path):
    def edit(r: Path):
        (r / "examples/sim_config/xyz3").mkdir(parents=True)
        (r / "examples/sim_config/xyz3/sim.var").write_text("3036\t0.000000\n")
    base = commit_change(repo, edit)
    sel = selector.select(repo, base, "HEAD", vitest_files=[])
    assert sel["backend"]["run"] and sel["unit"]["heavy"] == [] and sel["browser"]["run"] == []
    assert sel["live"] == {"probe-live": ["examples/sim_config/xyz3/sim.var"]}


def test_documentation_selects_no_product_test_and_says_why(repo: Path):
    base = commit_change(repo, lambda r: (r / "docs/notes.md").write_text("v2\n"))
    sel = selector.select(repo, base, "HEAD", vitest_files=[])
    assert sel["browser"]["run"] == [] and not sel["backend"]["run"] and sel["unit"]["heavy"] == []
    assert sel["changed"][0]["decision"] == "no product tests: no product code"
    assert sel["backend"]["reasons"] == ["no path under a backend rule: a UI-only round"]


def test_a_missing_base_is_an_error_never_an_empty_diff(repo: Path):
    with pytest.raises(selector.SelectError, match="missing base"):
        selector.select(repo, "0" * 40, "HEAD", vitest_files=[])


def test_without_the_vitest_answer_the_heavy_group_runs(repo: Path):
    base = commit_change(repo, lambda r: (r / "lcnc-webui/src/ProbePanel.vue").write_text("v2\n"))
    sel = selector.select(repo, base, "HEAD", vitest_files=None)
    assert sel["unit"]["heavy"] == sorted(HEAVY_UNIT)
    assert any("not asked" in why for why in sel["unit"]["heavy_reasons"])


def test_a_component_selects_its_area_and_the_ui_sweep(repo: Path):
    base = commit_change(repo, lambda r: (r / "lcnc-webui/src/ProbePanel.vue").write_text("v2\n"))
    sel = selector.select(repo, base, "HEAD", vitest_files=[])
    assert set(rules.UI_SWEEP) | set(rules.PROBING) == set(sel["browser"]["run"])
    assert sel["firefox"]["needed"] and sel["live"] == {"probe-live": ["lcnc-webui/src/ProbePanel.vue"]}


def test_an_e2e_helper_selects_its_importers_and_an_orphan_the_full_run(repo: Path):
    base = commit_change(repo, lambda r: (r / "lcnc-webui/e2e/jogHelper.ts").write_text("v2\n"))
    assert selector.select(repo, base, "HEAD", vitest_files=[])["browser"]["run"] == ["joint-jog"]
    base = commit_change(repo, lambda r: (r / "lcnc-webui/e2e/orphanHelper.ts").write_text("v2\n"))
    assert selector.select(repo, base, "HEAD", vitest_files=[])["browser"]["run"] == FULL


def test_a_helper_two_imports_up_selects_the_spec(repo: Path):
    base = commit_change(repo, lambda r: (r / "lcnc-webui/e2e/macroFolder.ts").write_text("v2\n"))
    assert "probe-click" in selector.select(repo, base, "HEAD", vitest_files=[])["browser"]["run"]


def test_data_a_helper_reads_selects_the_specs_reaching_the_helper(repo: Path):
    base = commit_change(repo, lambda r: (r / "scripts/test_fixtures/macro_refusals.json").write_text("v2\n"))
    sel = selector.select(repo, base, "HEAD", vitest_files=[])
    assert "probe-click" in sel["browser"]["run"]
    assert sel["changed"][0]["reads"] == ["lcnc-webui/e2e/macroFolder.ts"]


def test_a_src_module_a_spec_imports_selects_that_spec(repo: Path):
    base = commit_change(repo, lambda r: (r / "lcnc-webui/src/probeVars.ts").write_text("v2\n"))
    assert "probe-click" in selector.select(repo, base, "HEAD", vitest_files=[])["browser"]["run"]


def test_an_import_that_resolves_nowhere_selects_the_full_run(repo: Path):
    base = commit_change(repo, lambda r: (r / "lcnc-webui/e2e/tabs.spec.ts").write_text('import { z } from "./nowhere";\n'))
    sel = selector.select(repo, base, "HEAD", vitest_files=[])
    assert sel["browser"]["run"] == FULL
    assert any("nowhere" in why and "fail closed" in why for why in sel["browser"]["reasons"])


def test_a_changed_spec_and_a_reference_image_select_their_spec(repo: Path):
    def edit(r: Path):
        (r / "lcnc-webui/e2e/tabs.spec.ts").write_text("v2\n")
        shot = r / "lcnc-webui/e2e/__screenshots__/visual.spec.ts/a.png"
        shot.parent.mkdir(parents=True)
        shot.write_text("png")
    base = commit_change(repo, edit)
    assert selector.select(repo, base, "HEAD", vitest_files=[])["browser"]["run"] == ["tabs", "visual"]


def test_vitest_is_asked_only_on_a_clean_tree(repo: Path):
    (repo / "lcnc-webui/src/stray.test.ts").write_text("x")
    with pytest.raises(selector.SelectError, match="clean"):
        selector.vitest_changed(repo, "HEAD")


# ── The dry run ──────────────────────────────────────────────────────────
def reports(unit_status: dict[str, str], tests: list[tuple[str, str]]):
    vitest = {"testResults": [{"name": f"/x/{f}", "status": s, "startTime": 0, "endTime": 1000}
                              for f, s in unit_status.items()]}
    pw = {"suites": [{"specs": [{"file": f, "title": "t", "tests": [
        {"projectName": "p", "status": s, "results": [{"duration": 1000}]}]}]} for f, s in tests]}
    return vitest, pw


def test_the_dry_run_names_a_failure_the_selection_would_miss():
    sel = {"base": "b", "head": "h", "unit": {"heavy": [], "changed": []},
           "browser": {"run": ["tabs"]}}
    vitest, pw = reports({"lcnc-webui/src/a.test.ts": "passed", HEAVY_UNIT[0]: "failed"},
                         [("tabs.spec.ts", "expected"), ("layout.spec.ts", "unexpected")])
    result = dryrun.dry_run(sel, vitest, pw)
    assert result["missed"] == [{"unit": HEAVY_UNIT[0], "status": "failed"},
                                {"spec": "layout.spec.ts", "title": "t", "status": "unexpected"}]
    sel["unit"]["heavy"], sel["browser"]["run"] = [HEAVY_UNIT[0]], ["tabs", "layout"]
    assert dryrun.dry_run(sel, vitest, pw)["missed"] == []


def test_the_dry_run_refuses_an_empty_report():
    sel = {"base": "b", "head": "h", "unit": {"heavy": [], "changed": []}, "browser": {"run": FULL}}
    with pytest.raises(ValueError):
        dryrun.dry_run(sel, {"testResults": []}, {"suites": []})


# ── The run's proof: listing and order ───────────────────────────────────
from test_select import proof  # noqa: E402


def listing(rows: list[tuple[str, str]]) -> dict:
    return {"suites": [{"file": f, "specs": [{"file": f, "tests": [{"projectName": p}]}]} for f, p in rows]}


def test_the_listing_is_exactly_the_selection_in_the_full_projects():
    full = listing([("a.spec.ts", "chromium"), ("b.spec.ts", "serial-guards"), ("c.spec.ts", "serial-viewer")])
    assert proof.check_listing(full, listing([("b.spec.ts", "serial-guards")]), ["b"]) == []
    assert proof.check_listing(full, listing([("b.spec.ts", "chromium")]), ["b"]) == [
        "b.spec.ts: in ['chromium'], the full config runs it in ['serial-guards']"]
    assert proof.check_listing(full, listing([("b.spec.ts", "serial-guards"), ("c.spec.ts", "serial-viewer")]),
                               ["b"]) == ["c.spec.ts: listed but not selected"]
    assert proof.check_listing(full, listing([]), ["b", "z"]) == [
        "z.spec.ts: not a test file of the full config", "b.spec.ts: selected but not listed",
        "z.spec.ts: selected but not listed"]


def test_a_vitest_hit_runs_exactly_the_heavy_files_it_reaches(repo: Path):
    base = commit_change(repo, lambda r: (r / "lcnc-webui/src/ProbePanel.vue").write_text("v2\n"))
    sel = selector.select(repo, base, "HEAD", vitest_files=[HEAVY_UNIT[2], "lcnc-webui/src/x.test.ts"])
    assert sel["unit"]["heavy"] == [HEAVY_UNIT[2]]


# ── The import graph: a module holds what its components select ─────────
from test_select import graph  # noqa: E402

SRC = ROOT / "lcnc-webui" / "src"


def graph_problems() -> list[str]:
    rev, workers = graph.importers(SRC)
    problems = []
    for f in graph.sources(SRC):
        d = decide(f"lcnc-webui/src/{f}")
        if f.endswith(".vue") or d.browser_full or d.unmatched:
            continue
        for t, path in graph.terminals(f, rev, workers).items():
            td = decide(f"lcnc-webui/src/{t}")
            how = " ← ".join(path)
            if td.browser_full:
                problems.append(f"{f}: reaches the central {t} ({how})")
            elif not set(td.browser) <= d.browser:
                problems.append(f"{f}: misses {sorted(set(td.browser) - d.browser)} of {t} ({how})")
    return problems


def test_a_module_holds_the_selection_of_every_component_it_reaches():
    """A module acts and renders through the components that use it: its
    selection holds theirs, and one reaching a central component is FULL
    (graph.py: runtime imports, three named cuts)."""
    assert graph_problems() == []


def test_test_only_modules_are_reached_by_no_runtime_entry():
    """controlScan, controlInventory and the inventory's adapters run in tests
    only: from main.ts, App.vue and every worker, through every runtime import
    and no cut, none is reached (Codex R270) — their unit-only rule stays true."""
    rev, _ = graph.importers(SRC)
    for e in rules.RUNTIME_ENTRIES:
        assert (SRC / e).is_file(), e
    test_only = [f for f in graph.sources(SRC) if any(matches(g, f"lcnc-webui/src/{f}") for g in rules.TEST_ONLY_GLOBS)]
    assert {"controlScan.ts", "controlInventory.ts", "inventory/webAtoms.ts"} <= set(test_only)
    reached = graph.reached_from(list(rules.RUNTIME_ENTRIES), rev, graph.spawns(SRC))
    assert len(reached) > 50, "the walk reaches the app"
    assert {m: " → ".join(reached[m]) for m in test_only if m in reached} == {}


def test_the_edge_pattern_agrees_with_the_parser_on_every_source():
    """graph.py's pattern against TypeScript's parser (importscan.mjs), file by
    file — a spelling the pattern misses, or an import form neither reads
    (`require()`, a computed `import()`), fails here (Codex R271 FI-I07)."""
    assert graph.pattern_disagreements(SRC) == []


def test_the_edge_pattern_and_the_parser_see_the_same_spellings(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "node_modules").symlink_to(SRC.parent / "node_modules")   # the scanner's TypeScript
    (src / "x.ts").write_text("export const X = 1;\n")
    (src / "main.ts").write_text('import{X}from"./x";\nimport"./x";\nexport{X}from"./x";\nimport type { T } from "./x";\n'
                                 'const m = import("./x");\nconst w = new Worker(new URL("./x.ts", import.meta.url));\n')
    (src / "bad.ts").write_text('const r = require("./x");\nconst d = import(name);\n')
    (src / "types.ts").write_text('let t: import("./x").T;\n')   # a type position: no edge, a known excess
    rev, _ = graph.importers(src)
    assert graph.reached_from(["main.ts"], rev, graph.spawns(src)).keys() == {"main.ts", "x.ts"}
    assert graph.pattern_disagreements(src) == ["bad.ts: 1: require() — a form the graph does not read",
                                                "bad.ts: 2: import() of a computed path"]


def test_the_graph_reads_every_source_type_the_build_compiles():
    """graph.SOURCE_EXT is tsconfig.app.json's `include`, and no other script
    type sits in src — a reachable file of a type the walk does not read would
    hide a runtime use (Codex R272 FI-I07)."""
    include = re.search(r'"include"\s*:\s*\[([^\]]*)\]', (SRC.parent / "tsconfig.app.json").read_text())
    assert include, "tsconfig.app.json names its include list"
    built = {Path(g).suffix for g in re.findall(r'"([^"]+)"', include.group(1)) if g.startswith("src/")}
    assert built == set(graph.SOURCE_EXT)
    other = sorted(p.relative_to(SRC).as_posix() for p in SRC.rglob("*")
                   if p.suffix in (".js", ".mjs", ".cjs", ".jsx", ".mts", ".cts"))
    assert other == []


def test_the_runtime_walk_reads_tsx(tmp_path):
    (tmp_path / "main.ts").write_text('import { a } from "./inventory/r.tsx";\nimport { b } from "./q";\n')
    (tmp_path / "inventory").mkdir()
    (tmp_path / "inventory" / "r.tsx").write_text("export const a = 1;\n")
    (tmp_path / "q.tsx").write_text("export const b = <i />;\n")
    rev, _ = graph.importers(tmp_path)
    assert graph.reached_from(["main.ts"], rev, graph.spawns(tmp_path)).keys() == {"main.ts", "inventory/r.tsx", "q.tsx"}


def test_the_runtime_walk_sees_a_transitive_import_not_a_type_or_a_comment(tmp_path):
    (tmp_path / "main.ts").write_text('import "./a";\n')
    (tmp_path / "a.ts").write_text('// import { x } from "./controlScan";\nimport type { T } from "./controlScan";\n')
    (tmp_path / "w.ts").write_text('import { scan } from "./controlScan";\n')
    (tmp_path / "App.vue").write_text('<script setup>\nconst w = new Worker(new URL("./w.ts", import.meta.url));\n</script>\n')
    (tmp_path / "controlScan.ts").write_text("export const scan = 1;\n")
    rev, _ = graph.importers(tmp_path)
    spawned = graph.spawns(tmp_path)
    assert graph.reached_from(["main.ts"], rev, spawned).keys() == {"main.ts", "a.ts"}
    assert graph.reached_from(["App.vue"], rev, spawned)["controlScan.ts"] == ["App.vue", "w.ts", "controlScan.ts"]


def test_the_cuts_name_real_files():
    for name in graph.CUTS:
        assert (SRC / name).is_file(), name


# ── Discovery against execution (Codex R256 TS256-04) ────────────────────
def pw(rows: list[tuple[str, str, str, int]], errors: list | None = None) -> dict:
    """(file, project, title, results) → a Playwright JSON report; titles
    with ' › ' sit in a describe suite."""
    suites: dict[str, dict] = {}
    for f, p, title, n in rows:
        fs = suites.setdefault(f, {"title": f, "file": f, "specs": [], "suites": []})
        *desc, leaf = title.split(" › ")
        target = fs
        for d in desc:
            nxt = next((s for s in target["suites"] if s["title"] == d), None)
            if nxt is None:
                nxt = {"title": d, "specs": [], "suites": []}
                target["suites"].append(nxt)
            target = nxt
        target["specs"].append({"title": leaf, "file": f, "tests": [
            {"projectName": p, "results": [{"status": "passed"}] * n}]})
    return {"suites": list(suites.values()), "errors": errors or []}


LISTED = [("a.spec.ts", "serial-guards", "one", 0), ("a.spec.ts", "serial-guards", "grid › two", 0),
          ("b.spec.ts", "serial-guards", "three", 0)]


def ran_as(listed, drop=(), extra=(), counts=None):
    rows = [(f, p, t, (counts or {}).get(t, 1)) for f, p, t, _ in listed if t not in drop]
    return pw(rows + list(extra))


def test_every_listed_test_ran_once_and_nothing_else_ran():
    listing = pw(LISTED)
    assert proof.check_executed(listing, ran_as(LISTED)) == []
    assert proof.check_executed(listing, ran_as(LISTED, drop={"grid › two"})) == [
        "listed, never ran: a.spec.ts | serial-guards | grid › two"]
    assert proof.check_executed(listing, ran_as(LISTED, drop={"three"})) == [
        "listed, never ran: b.spec.ts | serial-guards | three"], "a whole selected file missing"
    assert proof.check_executed(listing, ran_as(LISTED, counts={"one": 2})) == [
        "2 results (retried or run twice): a.spec.ts | serial-guards | one"]
    # a focused test.only: the listing names six, one ran (Codex's sentinel)
    focused = LISTED + [("a.spec.ts", "serial-guards", "sentinel", 0)]
    only = pw([("a.spec.ts", "serial-guards", "sentinel", 1)])
    assert len(proof.check_executed(pw(focused), only)) == 3
    assert proof.check_executed(pw(LISTED, errors=[{"message": "x"}]), ran_as(LISTED))[0].startswith("discovery or run errors")
    assert proof.check_executed(pw([]), pw([])) == ["the listing holds no test"]


def test_every_listed_unit_test_ran():
    listed = [{"file": "/x/a.test.ts", "name": "d > one"}, {"file": "/x/a.test.ts", "name": "d > two"}]
    report = {"testResults": [{"name": "/x/a.test.ts", "assertionResults": [
        {"ancestorTitles": ["d"], "title": "one"}, {"ancestorTitles": ["d"], "title": "two"}]}]}
    assert proof.check_unit_executed(listed, report) == []
    report["testResults"][0]["assertionResults"].pop()
    assert proof.check_unit_executed(listed, report) == ["listed, never ran: /x/a.test.ts > d > two"]
    assert proof.check_unit_executed([], {"testResults": []}) == ["the listing holds no test"]
    # a test that passed on its second attempt (Codex R257): one entry, passed, the first failure kept
    retried = {"testResults": [{"name": "/x/a.test.ts", "assertionResults": [
        {"ancestorTitles": ["d"], "title": "one", "status": "passed", "failureMessages": ["AssertionError: expected 1 to be 2"]},
        {"ancestorTitles": ["d"], "title": "two", "status": "passed", "failureMessages": []}]}]}
    assert proof.check_unit_executed(listed, retried) == ["passed only after a failed attempt: /x/a.test.ts > d > one"]


# ── The round gate's plan and configs (Codex R256 TS256-03 / -05) ────────
from test_select import round_gate  # noqa: E402


def test_every_round_runs_the_selection_guards_first():
    """A UI-only round (no backend) runs them too: the table is checked
    against THIS tree before anything is left out."""
    ui_only = {"unit": {"heavy": []}, "backend": {"run": False}, "browser": {"run": ["tabs"]}}
    docs_only = {"unit": {"heavy": []}, "backend": {"run": False}, "browser": {"run": []}}
    for sel in (ui_only, docs_only):
        steps = round_gate.plan(sel)
        assert steps[0] == "selection-guards"
    assert round_gate.plan(ui_only)[-2:] == ["ports-free", "browser"]


def test_a_merge_runs_what_a_round_may_leave_out():
    """Codex R279 FI-I17: a merge gate is the full offline gate — every heavy
    unit file, the backend and the whole browser run, whatever the change
    selects; a round with a full browser run was taken for one."""
    docs_only = {"unit": {"heavy": [], "heavy_reasons": {}}, "backend": {"run": False, "reasons": ["x"]},
                 "browser": {"run": [], "reasons": ["y"]}}
    m = round_gate.as_merge(docs_only)
    assert m["unit"]["heavy"] == sorted(HEAVY_UNIT)
    assert m["backend"]["run"] is True and m["browser"]["run"] == FULL
    assert round_gate.plan(m) == ["selection-guards", "lint", "build", "unit-light", "unit-heavy", "backend",
                                  "ports-free", "browser"]
    assert docs_only["unit"]["heavy"] == [], "the round's selection itself is left as it was"


def test_the_gate_configs_start_their_own_servers_and_refuse_a_focused_test():
    for name in ("playwright.gate.config.ts", "playwright.select.config.ts"):
        text = (ROOT / "lcnc-webui" / name).read_text()
        assert "forbidOnly: true" in text, name
        assert "reuseExistingServer: false" in text, name
        assert re.search(r"webServer:\s*\(?(Array\.isArray|asList)\(full\.webServer", text), name
    gate = (ROOT / "scripts/test_select/round_gate.py").read_text()
    assert '"playwright.gate.config.ts"' in gate and '"--forbid-only"' in gate and '"--allowOnly=false"' in gate
    assert '"--retry=0"' in gate
    assert "playwright.config.ts\", \"--list" not in gate, "the gate never lists or runs the developer config"


def test_a_listening_port_is_seen():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen(1)
        assert round_gate.listening(s.getsockname()[1])
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    assert not round_gate.listening(port)


def test_a_listing_prints_its_json_never_into_the_runs_report(monkeypatch):
    """The run's report variables reach the run only: with them the listing's
    JSON went into the report file and stdout was empty (round 2, crash)."""
    monkeypatch.setenv("PLAYWRIGHT_JSON_OUTPUT_FILE", "/x/report.json")
    env = round_gate.listing_env({"PLAYWRIGHT_JSON_OUTPUT_NAME": "/x/report.json", "LCNC_E2E_SELECTION": "/x/sel.json"})
    assert not set(round_gate.JSON_OUT) & set(env) and env["LCNC_E2E_SELECTION"] == "/x/sel.json"


# ── The per-worker mock (Codex R261/R262 PM261-01/-02) ───────────────────
def e2e_sources() -> list[Path]:
    return sorted(p for p in E2E.glob("*") if p.suffix in (".ts", ".mjs"))


def test_every_spec_takes_its_test_from_the_fixture_file():
    """./test carries the per-worker mock and the baseline reset; a spec on
    Playwright's own `test` would run against no mock of its worker."""
    bad = []
    for f in sorted(E2E.glob("*.spec.ts")):
        text = f.read_text()
        if re.search(r"""from\s*["']@playwright/test["']""", text):
            bad.append(f"{f.name}: imports from @playwright/test")
        if not re.search(r"""import\s*\{\s*test\b[^}]*\}\s*from\s*["']\./test["']""", text):
            bad.append(f"{f.name}: no test from ./test")
    assert bad == []


def test_no_mock_address_outside_its_binding():
    """HTTP, /ws and /ctl come from ctl.ts (the worker's slot) only; no spec
    or helper names a mock port or the removed override."""
    allowed = {"ctl.ts", "mockSlot.mjs", "mockSlot.d.mts", "mock-gateway.mjs"}
    bad = [f"{f.name}:{n}" for f in e2e_sources() if f.name not in allowed
           for n, line in enumerate(f.read_text().splitlines(), 1)
           if re.search(r"\b4174\b|localhost:45\d\d|TOOL_IMPORT_TEST_URL", line)]
    assert bad == []


def test_no_state_outlives_the_per_test_reset():
    """The baseline fixture resets the mock before every test: state set up
    once for a file (beforeAll) would be wiped, and a parallel describe would
    put two tests on one mock at once."""
    bad = [f"{f.name}:{n}: {m.group(0)}" for f in e2e_sources()
           for n, line in enumerate(f.read_text().splitlines(), 1)
           for m in [re.search(r"\b(beforeAll|afterAll|describe\.configure|describe\.parallel)\b", line)] if m
           and not line.lstrip().startswith("//")]
    assert bad == []


def test_a_worker_slot_is_a_whole_index_in_range_and_nothing_else_binds():
    probe = ("import('" + (E2E / "mockSlot.mjs").as_uri() + "').then(m => console.log(JSON.stringify("
             "[undefined, '0', '3', '15', '16', '-1', '1.5', ' 2', '', 'x'].map(i => m.mockUrl(i)))))")
    out = json.loads(subprocess.run(["node", "-e", probe], capture_output=True, text=True, check=True).stdout)
    u = "http://mock-unbound.invalid/"
    assert out == [u, "http://localhost:4500/", "http://localhost:4503/", "http://localhost:4515/", u, u, u, u, u, u]


RUN = "gate-r"


def worker_report(rows: list[tuple], run: str | None = RUN) -> dict:
    """(file, title, workerIndex, parallelIndex, status) → a Playwright JSON
    report with its run in config.metadata (one result per test, retry 0)."""
    specs = [{"title": t, "file": f, "tests": [{"projectName": "e2e", "results": [
        {"status": st, "retry": 0, "workerIndex": w, "parallelIndex": sl}]}]} for f, t, w, sl, st in rows]
    return {"config": {"metadata": {"actualWorkers": 2, **({"run": run} if run else {})}},
            "suites": [{"title": sp["file"], "file": sp["file"], "specs": [sp], "suites": []} for sp in specs]}


def worker_events() -> list[dict]:
    """A clean run on two slots: m0/m1 bound, a test each, slot 0's worker
    replaced — its successor m2 binds BEFORE m0's stop is logged (the handoff
    waits only for the port) — and runs the third test."""
    ws = {0: (0, 100, "m0"), 1: (1, 101, "m1"), 2: (0, 102, "m2")}   # workerIndex → slot, pid, instance

    def e(event, w, **kw):
        slot, pid, inst = ws[w]
        return {"run": RUN, "pid": pid, "event": event, "slot": slot, "workerIndex": w, "instance": inst, **kw}

    def bound(w):
        port = 4500 + ws[w][0]
        return e("bound", w, port=port, endpoint=f"http://localhost:{port}/")

    def t(event, f, title, w):
        return e(event, w, file=f, project="e2e", title=title, retry=0)
    return [bound(0), bound(1), t("test-start", "a.spec.ts", "one", 0), t("test-start", "b.spec.ts", "two", 1),
            t("test-end", "a.spec.ts", "one", 0), t("test-end", "b.spec.ts", "two", 1), bound(2), e("stopped", 0),
            t("test-start", "c.spec.ts", "three", 2), t("test-end", "c.spec.ts", "three", 2),
            e("stopped", 1), e("stopped", 2)]


WORKER_ROWS = [("a.spec.ts", "one", 0, 0, "passed"), ("b.spec.ts", "two", 1, 1, "passed"),
               ("c.spec.ts", "three", 2, 0, "passed"), ("d.spec.ts", "four", -1, -1, "skipped")]


def test_every_result_ran_on_the_mock_its_worker_bound_in_this_run():
    """proof.check_workers over the fixture's event log, bound to ONE run, to
    each mock's owner and to the report's results (Codex R262 PM261-04, R263
    PM263-02: every case Codex's mutations of the real log passed is here)."""
    report, ev = worker_report(WORKER_ROWS), worker_events()
    check = lambda x, r=report: proof.check_workers(r, x, RUN)  # noqa: E731
    assert check(ev) == [], "a clean run (a handoff, a static skip with no pair)"

    def edit(pred, **kw):
        return [{**e, **kw} if pred(e) else e for e in copy.deepcopy(ev)]
    two = lambda e: e.get("title") == "two"  # noqa: E731
    k2 = "b.spec.ts | e2e | two | 0"
    assert check(ev[:5] + ev[6:]) == [f"started, never ended: {k2}", f"no worker event for: {k2}"]
    assert check(edit(two, run="old")) == [f"2 events of another run (old), not {RUN}", f"no worker event for: {k2}"]
    assert check(edit(lambda e: e["event"] == "bound" and e["instance"] == "m1", workerIndex=999)) == [
        "mock m1 stopped by another worker or slot than bound it"] + [
        f"a test on mock m1 from another worker or slot than bound it: {k2}"] * 2, "the wrong owner in bound"
    assert check(edit(two, slot=15)) == [
        f"a test on mock m1 from another worker or slot than bound it: {k2}"] * 2 + [
        f"worker 1 slot 1 by the report, worker 1 slot 15 by the events: {k2}"]
    assert check(edit(lambda e: e["event"] == "bound" and e["instance"] == "m1", endpoint="http://localhost:4500/")) == [
        "mock m1: endpoint http://localhost:4500/ is not port 4501's"]
    assert check(edit(lambda e: e["event"] == "bound" and e["instance"] == "m1", port=4500)) == [
        "mock m1: port 4500 is not slot 1's", "mock m1: endpoint http://localhost:4501/ is not port 4500's"]
    shifted = [{**e, "workerIndex": e["workerIndex"] + 100} for e in copy.deepcopy(ev)]
    assert check(shifted) == [
        "worker 0 slot 0 by the report, worker 100 slot 0 by the events: a.spec.ts | e2e | one | 0",
        f"worker 1 slot 1 by the report, worker 101 slot 1 by the events: {k2}",
        "worker 2 slot 0 by the report, worker 102 slot 0 by the events: c.spec.ts | e2e | three | 0"]
    assert check(ev[:-1]) == ["mock m2 bound, never stopped"]
    assert check(ev + [{**ev[2], "file": "e.spec.ts", "title": "five"}, {**ev[4], "file": "e.spec.ts", "title": "five"}]) == [
        "a test outside mock m0's life: e.spec.ts | e2e | five | 0"] * 2 + [
        "slot 0: the tests of its mocks interleave (m0 → m2 → m0)",
        "an event pair no result reports: e.spec.ts | e2e | five | 0"], "a foreign pair, after its mock's stop"
    assert check(ev[:6] + [ev[2], ev[4]] + ev[6:]) == [
        "started twice: a.spec.ts | e2e | one | 0", "ended, never started: a.spec.ts | e2e | one | 0"], "a duplicate pair"
    assert check(ev[:6] + [ev[3]]) == ["mock m0 bound, never stopped", "mock m1 bound, never stopped",
                                       f"started twice: {k2}", "no worker event for: c.spec.ts | e2e | three | 0"], "cut short"
    assert check(edit(two, workerIndex=0, slot=0, pid=100, instance="m0")) == [
        "worker 0 ran two tests at once: one / two", f"worker 1 slot 1 by the report, worker 0 slot 0 by the events: {k2}"]
    assert check(edit(two, instance="m9")) == ["a test on a mock never bound: m9"] * 2
    assert check([e for e in ev if not (e["event"] == "bound" and e["instance"] == "m1")]) == [
        "stopped, never bound: m1"] + ["a test on a mock never bound: m1"] * 2
    assert check(ev, worker_report([r if r[1] != "four" else (*r[:4], "passed") for r in WORKER_ROWS])) == [
        "no worker event for: d.spec.ts | e2e | four | 0"], "a result that ran needs its pair"


def test_the_report_names_the_run_the_gate_started():
    assert proof.check_report_run(worker_report(WORKER_ROWS), RUN) == []
    assert proof.check_report_run(worker_report(WORKER_ROWS, run="gate-other"), RUN) == [
        f"the report names run gate-other, the gate ran {RUN}"]
    assert proof.check_report_run(worker_report(WORKER_ROWS, run=None), RUN) == ["the report names no run (config.metadata.run)"]
    cfg = (ROOT / "lcnc-webui" / "playwright.config.ts").read_text()
    assert "metadata: { run: process.env.LCNC_E2E_RUN }" in cfg, "the report carries its run"
    gate = (ROOT / "scripts/test_select/round_gate.py").read_text()
    assert '"LCNC_E2E_RUN": run_id' in gate and "events.unlink(missing_ok=True)" in gate, "one run, a fresh log"


def test_the_ports_checked_are_the_preview_and_every_worker_slot():
    assert round_gate.ports(3) == [4173, 4500, 4501, 4502]
    assert round_gate.ports(1) == [4173, 4500]
    mock_slot = (E2E / "mockSlot.mjs").read_text()
    assert f"MOCK_BASE_PORT = {round_gate.SLOT_BASE};" in mock_slot, "one slot base"
    for cfg in ("playwright.gate.config.ts", "playwright.select.config.ts"):
        assert "workers: Number(process.env.LCNC_E2E_WORKERS ?? 3)" in (ROOT / "lcnc-webui" / cfg).read_text(), cfg
    assert 'os.environ.get("LCNC_E2E_WORKERS", "3")' in (ROOT / "scripts/test_select/round_gate.py").read_text()
