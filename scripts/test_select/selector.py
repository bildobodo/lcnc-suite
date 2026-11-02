#!/usr/bin/env python3
"""The test selector (test strategy step 3, Codex R248–R251): which checks a
round runs, from a NAMED base..head diff.

    python3 -I scripts/test_select/selector.py --base <commit> [--head HEAD]
        [--repo <worktree>] [--vitest | --vitest-list <json>] [--out sel.json]

Every changed path gets a decision (rules.py); the record names what was
selected AND what was left out, with reasons. Fail closed: a missing base
exits 2 (never an empty diff), a path no rule matches selects the full
frontend and backend runs, an e2e helper no spec imports selects the full
browser run, and without the `vitest list --changed` answer the heavy unit
group runs (named). `--vitest` asks vitest in the worktree, which must then be
clean and at head (vitest compares base with the working tree).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from test_select.rules import (  # noqa: E402
    FULL, HEAVY_DATA, HEAVY_UNIT, SPEC_READS, decide, matches,
)

ROOT = Path(__file__).resolve().parents[2]
W = "lcnc-webui/"
E2E = W + "e2e/"
SPEC_RE = re.compile(r"lcnc-webui/e2e/([^/]+)\.spec\.ts\Z")
SHOT_RE = re.compile(r"lcnc-webui/e2e/__screenshots__/([^/]+)\.spec\.ts/")
UNIT_RE = re.compile(r"lcnc-webui/.+\.test\.ts\Z")


class SelectError(Exception):
    pass


def git(repo: Path, *args: str) -> str:
    r = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True)
    if r.returncode != 0:
        raise SelectError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


def commit(repo: Path, rev: str) -> str:
    try:
        return git(repo, "rev-parse", "--verify", "--quiet", rev + "^{commit}").strip()
    except SelectError:
        raise SelectError(f"no commit {rev!r} — a missing base is never an empty diff") from None


def changed_paths(repo: Path, base: str, head: str) -> list[tuple[str, str]]:
    """(status, path) per changed path; a rename or copy yields both paths."""
    out = []
    for line in git(repo, "diff", "--name-status", "-M", base, head).splitlines():
        parts = line.split("\t")
        status = parts[0][0]
        if status in "RC":
            out.append((status + "-from", parts[1]))
            out.append((status + "-to", parts[2]))
        else:
            out.append((status, parts[1]))
    return out


def spec_files(repo: Path, head: str) -> dict[str, str]:
    """name → path of every spec at head."""
    names = {}
    for p in git(repo, "ls-tree", "-r", "--name-only", head, "--", E2E).splitlines():
        m = SPEC_RE.match(p)
        if m:
            names[m.group(1)] = p
    return names


def helper_importers(repo: Path, head: str, helper: str, specs: dict[str, str]) -> set[str]:
    """The specs that import (or, for a stylesheet, name) an e2e helper."""
    stem = Path(helper).name
    stem_noext = re.sub(r"\.(ts|mjs|js)$", "", stem)
    pat = re.compile(r"""['"]\./(?:%s|%s)['"]|['"][^'"]*%s['"]""" % (
        re.escape(stem_noext), re.escape(stem), re.escape(stem)))
    hits = set()
    for name, path in specs.items():
        text = git(repo, "show", f"{head}:{path}")
        if pat.search(text):
            hits.add(name)
    return hits


def read_by(path: str) -> set[str]:
    """The specs whose declared disk reads (SPEC_READS) cover a path."""
    out = set()
    for owner, globs in SPEC_READS.items():
        if any(matches(g, path) for g in globs):
            out.add(owner)
    return out


def vitest_changed(repo: Path, base: str) -> list[str]:
    """The unit files `vitest list --changed <base>` names (import graph)."""
    if git(repo, "status", "--porcelain"):
        raise SelectError("vitest compares base with the working tree: the tree must be clean")
    out = repo / "lcnc-webui" / "node_modules" / ".cache" / "test-select-vitest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["npx", "vitest", "list", "--changed", base, "--filesOnly",
                        f"--json={out}"], cwd=repo / "lcnc-webui", capture_output=True, text=True)
    if r.returncode != 0:
        raise SelectError(f"vitest list --changed failed: {r.stderr.strip()[-400:]}")
    return files_from_vitest_list(json.loads(out.read_text()), repo)


def files_from_vitest_list(data: list[dict], repo: Path) -> list[str]:
    files = set()
    for row in data:
        f = row["file"]
        rel = f.split("/lcnc-webui/", 1)[-1] if "/lcnc-webui/" in f else f
        files.add(W + rel)
    return sorted(files)


def select(repo: Path, base: str, head: str, vitest_files: list[str] | None,
           historical: bool = False) -> dict:
    base_c, head_c = commit(repo, base), commit(repo, head)
    changes = changed_paths(repo, base_c, head_c)
    specs = spec_files(repo, head_c)
    deleted = {p for s, p in changes if s in ("D", "R-from")}

    browser: set[str] = set()
    browser_full: list[str] = []
    backend: list[str] = []
    heavy: list[str] = []
    unit_changed: set[str] = set()
    firefox: list[str] = []
    live: dict[str, list[str]] = {}
    unmatched: list[str] = []
    rows = []

    for status, path in changes:
        row = {"status": status, "path": path}
        rows.append(row)
        gone = path in deleted
        m_spec, m_shot = SPEC_RE.match(path), SHOT_RE.match(path)
        if m_spec or m_shot:
            name = (m_spec or m_shot).group(1)
            if name in specs:
                browser.add(name)
                row["decision"] = f"the spec itself: {name}"
            else:
                row["decision"] = "a spec that is gone at head: nothing to run"
            continue
        if UNIT_RE.match(path):
            if not gone:
                unit_changed.add(path)
                if path in HEAVY_UNIT:
                    heavy.append(f"{path} changed")
            row["decision"] = "a unit file: runs itself" if not gone else "a unit file that is gone"
            continue
        if path.startswith(E2E) and not path.startswith(E2E + "__screenshots__/"):
            if gone:
                row["decision"] = "an e2e helper that is gone: its importers changed and select themselves"
                continue
            d = decide(path)
            if d.unmatched:     # no central rule: the specs importing it
                importers = helper_importers(repo, head_c, path, specs)
                if importers:
                    browser |= importers
                    row["decision"] = "an e2e helper: the specs importing it: " + ", ".join(sorted(importers))
                else:
                    browser_full.append(f"{path}: an e2e helper no spec imports")
                    row["decision"] = "an e2e helper no spec imports: the full browser run"
                continue
        d = decide(path)
        row["rules"] = d.rules
        if d.none is not None:
            row["decision"] = f"no product tests: {d.none}"
            continue
        if d.unmatched:
            unmatched.append(path)
            row["decision"] = "NO RULE: the full frontend and backend runs"
        if d.browser_full:
            browser_full.append(f"{path}: {d.rules[0] if d.rules else 'no rule'}")
        browser |= d.browser
        if d.backend:
            backend.append(f"{path}: {next((r for r in d.rules), 'no rule')}")
        if d.heavy:
            heavy.append(f"{path}: no rule")
        if d.firefox:
            firefox.append(path)
        for check in d.live:
            live.setdefault(check, []).append(path)
        readers = read_by(path)
        for owner in readers:
            if owner in specs:
                browser.add(owner)
            else:   # an e2e helper's reads select the specs importing it
                browser |= helper_importers(repo, head_c, E2E + owner + ".ts", specs)
        if any(matches(g, path) for g in HEAVY_DATA):
            heavy.append(f"{path}: read by the heavy group")
        if readers:
            row["reads"] = sorted(readers)
        row.setdefault("decision", "the rules: " + "; ".join(d.rules))

    missing = sorted(browser - set(specs))
    if missing and not historical:
        raise SelectError(f"rules name specs that do not exist at head: {missing}")
    browser -= set(missing)   # a dry run on an older head: the rules are newer than it

    if vitest_files is None:
        heavy.append("vitest list --changed not asked: the heavy group runs (fail closed)")
        related: list[str] = []
    else:
        related = vitest_files
        for f in related:
            if f in HEAVY_UNIT:
                heavy.append(f"{f}: reached through the import graph (vitest list --changed)")

    return {
        "base": base_c, "head": head_c,
        "changed": rows,
        "unmatched": unmatched,
        "absent_at_head": missing,
        "unit": {
            "light": "every unit file but HEAVY_UNIT — every round",
            "heavy": bool(heavy), "heavy_reasons": heavy,
            "changed": sorted(unit_changed),
            "related": related,
        },
        "browser": ({"run": FULL, "reasons": browser_full} if browser_full
                    else {"run": sorted(browser), "reasons": [] if browser else
                          ["no path selects a browser spec"]}),
        "backend": ({"run": True, "reasons": backend} if backend else
                    {"run": False, "reasons": ["no path under a backend rule: a UI-only round"]}),
        "firefox": ({"needed": True, "paths": firefox,
                     "status": "pending: the pinned Mozilla target is not built yet (step 6)"}
                    if firefox else {"needed": False}),
        "live": {k: sorted(set(v)) for k, v in sorted(live.items())},
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--repo", type=Path, default=ROOT)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--vitest", action="store_true", help="ask vitest in the repo (clean tree at head)")
    g.add_argument("--vitest-list", type=Path, help="a saved `vitest list --changed --json` answer")
    ap.add_argument("--historical", action="store_true",
                    help="a dry run on an older head: drop rule-named specs it does not have")
    ap.add_argument("--out", type=Path)
    a = ap.parse_args(argv)
    try:
        vitest_files = None
        if a.vitest:
            if commit(a.repo, "HEAD") != commit(a.repo, a.head):
                raise SelectError("--vitest needs the worktree at head")
            vitest_files = vitest_changed(a.repo, a.base)
        elif a.vitest_list:
            vitest_files = files_from_vitest_list(json.loads(a.vitest_list.read_text()), a.repo)
        sel = select(a.repo, a.base, a.head, vitest_files, a.historical)
    except SelectError as e:
        print(f"test_select: {e}", file=sys.stderr)
        return 2
    text = json.dumps(sel, indent=2, ensure_ascii=False)
    if a.out:
        a.out.write_text(text + "\n")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
