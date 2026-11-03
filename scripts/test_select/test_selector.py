"""The test selector's guards (test strategy step 3, Codex R248 TS248-01).

Both directions of the rule table against the tracked tree, the disk reads
of the heavy group and of the e2e specs, and the mechanism's counter-cases
on synthetic diffs in a scratch repository.
"""
from __future__ import annotations

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
    assert sel["browser"]["run"] == ["bake-hold.viewer", "collisions.viewer", "reach.viewer", "toolsetter.viewer"]


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


def test_the_full_chain_is_read_from_the_config():
    chain = proof.full_chain((ROOT / "lcnc-webui/playwright.config.ts").read_text())
    assert chain[0] == ("chromium", False) and chain[-1] == ("serial-viewer", True)
    assert len(chain) == 9 and all(serial for _, serial in chain[1:])


def ran(rows: list[tuple[str, str, int, int]]) -> dict:
    """(project, file, start s, duration s) → a JSON report."""
    from datetime import datetime, timezone
    return {"suites": [{"specs": [{"file": f, "tests": [{"projectName": p, "results": [{
        "startTime": datetime.fromtimestamp(1_800_000_000 + t, timezone.utc).isoformat().replace("+00:00", "Z"),
        "duration": d * 1000}]}]}]} for p, f, t, d in rows]}


def test_the_order_proof_holds_the_chain_and_the_path_order():
    chain = [("chromium", False), ("serial-guards", True), ("serial-viewer", True)]
    good = ran([("chromium", "x.spec.ts", 0, 5), ("chromium", "w.spec.ts", 1, 3),
                ("serial-guards", "a.spec.ts", 10, 5), ("serial-guards", "b.spec.ts", 16, 5),
                ("serial-viewer", "v.spec.ts", 30, 5)])
    assert proof.check_order(good, chain) == []
    early = ran([("serial-guards", "a.spec.ts", 10, 5), ("serial-viewer", "v.spec.ts", 12, 5)])
    assert proof.check_order(early, chain) == ["serial-viewer began before serial-guards ended"]
    swapped = ran([("serial-guards", "b.spec.ts", 10, 5), ("serial-guards", "a.spec.ts", 16, 5)])
    assert proof.check_order(swapped, chain) == [
        "serial-guards: files ran ['b.spec.ts', 'a.spec.ts'], path order is ['a.spec.ts', 'b.spec.ts']"]
    overlap = ran([("serial-guards", "a.spec.ts", 10, 5), ("serial-guards", "b.spec.ts", 12, 5)])
    assert proof.check_order(overlap, chain) == ["serial-guards: b.spec.ts began before a.spec.ts ended"]
    assert proof.check_order({"suites": []}, chain) == ["the report holds no test results"]


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


def test_the_gate_configs_start_their_own_servers_and_refuse_a_focused_test():
    for name in ("playwright.gate.config.ts", "playwright.select.config.ts"):
        text = (ROOT / "lcnc-webui" / name).read_text()
        assert "forbidOnly: true" in text, name
        assert "reuseExistingServer: false" in text, name
        assert re.search(r"webServer:\s*\(?(Array\.isArray|asList)\(full\.webServer", text), name
    gate = (ROOT / "scripts/test_select/round_gate.py").read_text()
    assert '"playwright.gate.config.ts"' in gate and '"--forbid-only"' in gate and '"--allowOnly=false"' in gate
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
