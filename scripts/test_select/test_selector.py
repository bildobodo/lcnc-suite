"""The test selector's guards (test strategy step 3, Codex R248 TS248-01).

Both directions of the rule table against the tracked tree, the disk reads
of the heavy group and of the e2e specs, and the mechanism's counter-cases
on synthetic diffs in a scratch repository.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from test_select import dryrun, rules, selector  # noqa: E402
from test_select.rules import (  # noqa: E402
    FULL, FULL_ONLY, HEAVY_DATA, HEAVY_THRESHOLD_MS, HEAVY_UNIT, RULES, SPEC_READS, decide, matches,
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


LITERAL = re.compile(r"""["'`]((?:examples|lcnc-gateway|scripts|subroutines|test-fixtures)/[^"'`$\s]*)["'`]""")


def heavy_read_literals() -> dict[str, list[str]]:
    files = list(HEAVY_UNIT) + ["lcnc-webui/src/viewer/collisionFixtures.ts"]
    return {f: LITERAL.findall((ROOT / f).read_text()) for f in files}


def test_every_heavy_read_lies_under_a_data_rule():
    """What the eight files and collisionFixtures.ts read from disk (no
    import: `vitest list --changed` never sees it) lies under HEAVY_DATA."""
    reads = heavy_read_literals()
    loose = [(f, lit) for f, lits in reads.items() for lit in lits
             if not any(matches(g, lit) or matches(g, lit.rstrip("/") + "/x") for g in HEAVY_DATA)]
    assert loose == []
    for f, lits in reads.items():
        for lit in lits:
            assert (ROOT / lit).exists(), f"{f} reads {lit}, which does not exist"
    every = [lit for lits in reads.values() for lit in lits]
    unused = [g for g in HEAVY_DATA if not any(matches(g, l) or matches(g, l.rstrip("/") + "/x") for l in every)]
    assert unused == [], "a HEAVY_DATA glob no heavy file reads"


def test_a_heavy_file_reading_from_disk_names_what_it_reads():
    """A read whose target the guard cannot resolve fails it: a heavy file
    that calls readFileSync names a path literal or reads through the
    fixture module's shipped cases (whose literals the guard sees)."""
    reads = heavy_read_literals()
    for f in HEAVY_UNIT:
        text = (ROOT / f).read_text()
        if "readFileSync" not in text:
            continue
        via_fixtures = re.search(r"\b(shippedCases|loadShippedModel)\(", text) is not None
        assert reads[f] or via_fixtures, f"{f}: reads from disk without a path the guard can resolve"


URL_LITERAL = re.compile(r"""new URL\(\s*["'](\.\./\.\./[^"']+)["']\s*,\s*import\.meta\.url\s*\)""")


def test_every_e2e_disk_read_outside_the_frontend_is_declared():
    """A spec or helper that reads a file outside lcnc-webui declares it in
    SPEC_READS, so a change to that file selects it — and every entry is used."""
    seen: dict[str, set[str]] = {}
    for f in sorted(E2E.glob("*.ts")) + sorted(E2E.glob("*.mjs")):
        owner = f.name[: -len(".spec.ts")] if f.name.endswith(".spec.ts") else f.stem
        for rel in URL_LITERAL.findall(f.read_text()):
            target = (E2E / rel).resolve().relative_to(ROOT).as_posix()
            seen.setdefault(owner, set()).add(target)
    undeclared = [(o, t) for o, ts in seen.items() for t in ts
                  if not any(matches(g, t) or matches(g, t.rstrip("/") + "/x") for g in SPEC_READS.get(o, ()))]
    assert undeclared == []
    unused = [(o, g) for o, gs in SPEC_READS.items() for g in gs
              if not any(matches(g, t) or matches(g, t.rstrip("/") + "/x") for t in seen.get(o, ()))]
    assert unused == []
    for owner in SPEC_READS:
        assert owner in spec_names() or (E2E / f"{owner}.ts").is_file(), owner


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
    for p in ("lcnc-webui/src/format.ts", "lcnc-webui/src/ProbePanel.vue", HEAVY_UNIT[0],
              "examples/sim_config/machine-5axis-xyzac/table.stl", "docs/notes.md"):
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
    assert sel["unit"]["heavy"] == sorted(HEAVY_UNIT) and sel["backend"]["run"]
    assert sel["browser"]["run"] == ["bake-hold.viewer", "collisions.viewer", "reach.viewer", "toolsetter.viewer"]


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


def test_a_changed_spec_and_a_reference_image_select_their_spec(repo: Path):
    def edit(r: Path):
        (r / "lcnc-webui/e2e/tabs.spec.ts").write_text("v2\n")
        shot = r / "lcnc-webui/e2e/__screenshots__/visual.spec.ts/a.png"
        shot.parent.mkdir(parents=True)
        shot.write_text("png")
    base = commit_change(repo, edit)
    assert selector.select(repo, base, "HEAD", vitest_files=[])["browser"]["run"] == ["tabs", "visual"]


def test_vitest_is_asked_only_on_a_clean_tree(repo: Path):
    (repo / "dirty.txt").write_text("x")
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
