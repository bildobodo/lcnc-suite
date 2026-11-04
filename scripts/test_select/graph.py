"""The frontend's runtime import graph — the guard on the rule table
(test strategy step 3).

A module renders and acts through the components that use it: a change to
it can do whatever a change to them can. So a module's selection must hold
the selection of every component it reaches through runtime imports
(`import type` is no edge; `{ type A, b }` is), and a module that reaches a
central component (one whose rule is FULL) must be FULL itself.

Three named cuts stop the walk, each with its reason (CUTS):
  App.vue      composes the features; its direct import of a module is that
               feature's wiring, and the module's own rule names the feature
  defaults.ts  takes a module's default VALUES into the settings registry;
               the module's own rule names its readers
  a worker     (`new URL("./x.ts", import.meta.url)`) runs apart: its code
               reaches the page only through its owner's messages, so the
               worker module counts as a terminal with its own rule's
               selection, which its imports must hold

Pure: reads the source files it is given, never runs anything.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from collections import deque
from pathlib import Path

CUTS = {
    "App.vue": "App composes the features: its direct import is that feature's wiring",
    "defaults.ts": "the settings registry takes a module's default values: the module's rule names its readers",
}

# Every spelling TypeScript accepts — `import{x}from"./y"` too (Codex R271
# FI-I07); importscan.mjs, on the parser, proves the pattern per file.
EDGE = re.compile(
    r"""^\s*(?:import|export)\b\s*(type\b\s*)?[^;'"]*?\bfrom\s*['"](\.{1,2}/[^'"]+)['"]"""
    r"""|import\(\s*['"](\.{1,2}/[^'"]+)['"]\s*\)"""
    r"""|new URL\(\s*['"](\.{1,2}/[^'"]+)['"]\s*,\s*import\.meta\.url"""
    r"""|^\s*import\s*['"](\.{1,2}/[^'"]+)['"]""",
    re.M | re.S)


# Every source type the app's build compiles (tsconfig.app.json `include`) —
# a guard holds the two equal, so no reachable file falls out of the walk
# (Codex R272 FI-I07).
SOURCE_EXT = (".ts", ".tsx", ".vue")


def sources(src: Path) -> list[str]:
    return sorted(p.relative_to(src).as_posix() for p in src.rglob("*")
                  if p.suffix in SOURCE_EXT and not p.name.endswith((".test.ts", ".test.tsx", ".d.ts")))


def _resolve(src: Path, importer: str, rel: str) -> str | None:
    p = (src / importer).parent / rel
    for cand in (p, Path(f"{p}.ts"), Path(f"{p}.tsx"), Path(f"{p}.vue"), p / "index.ts", p / "index.tsx"):
        if cand.is_file():
            return Path(os.path.normpath(cand)).relative_to(src).as_posix()
    return None


def importers(src: Path) -> tuple[dict[str, set[str]], set[str]]:
    """imported → its runtime importers; and the modules loaded as workers."""
    rev: dict[str, set[str]] = {}
    workers: set[str] = set()
    for f in sources(src):
        for m in EDGE.finditer((src / f).read_text()):
            if m.group(1):          # import type / export type: no runtime edge
                continue
            rel = m.group(2) or m.group(3) or m.group(4) or m.group(5)
            target = _resolve(src, f, rel)
            if target is None or target == f:
                continue
            if m.group(4):
                workers.add(target)  # its owner holds no runtime edge to it
                continue
            rev.setdefault(target, set()).add(f)
    return rev, workers


def terminals(module: str, rev: dict[str, set[str]], workers: set[str]) -> dict[str, list[str]]:
    """The components and workers a module reaches through runtime imports,
    each with the chain that reaches it; the walk stops at a component, a
    worker and a CUT importer."""
    prev: dict[str, str | None] = {module: None}
    queue, found = deque([module]), {}
    while queue:
        x = queue.popleft()
        for y in sorted(rev.get(x, ())):
            if y in prev or y in CUTS:
                continue
            prev[y] = x
            if y.endswith(".vue") or y in workers:
                path, node = [y], x
                while node is not None:
                    path.append(node)
                    node = prev[node]
                found[y] = path
            else:
                queue.append(y)
    return found


def spawns(src: Path) -> dict[str, set[str]]:
    """A module → the workers it starts (`new Worker(new URL("./x.ts", import.meta.url))`)."""
    out: dict[str, set[str]] = {}
    for f in sources(src):
        for m in EDGE.finditer((src / f).read_text()):
            if m.group(4):
                target = _resolve(src, f, m.group(4))
                if target is not None and target != f:
                    out.setdefault(f, set()).add(target)
    return out


def reached_from(entries: list[str], rev: dict[str, set[str]], spawned: dict[str, set[str]]) -> dict[str, list[str]]:
    """Every module a runtime walk from the entries reaches — through every
    runtime import and into every worker a reached module starts, with NO cut
    (the proof that a test-only module stays out of the running app, Codex
    R270) — each with the chain from its entry."""
    fwd: dict[str, set[str]] = {}
    for imported, by in rev.items():
        for f in by:
            fwd.setdefault(f, set()).add(imported)
    prev: dict[str, str | None] = {e: None for e in entries}
    queue = deque(entries)
    while queue:
        x = queue.popleft()
        for y in sorted(fwd.get(x, set()) | spawned.get(x, set())):
            if y not in prev:
                prev[y] = x
                queue.append(y)
    out = {}
    for m in prev:
        path, node = [], m
        while node is not None:
            path.append(node)
            node = prev[node]
        out[m] = path[::-1]
    return out


SCAN = Path(__file__).resolve().parent / "importscan.mjs"


def parsed_edges(src: Path) -> dict[str, dict]:
    """The parser's runtime edges per source (importscan.mjs): {file:
    {imports, workers: resolved targets, refused: [why]}} — a scanner failure
    raises: no answer is never "no edges"."""
    files = sources(src)
    r = subprocess.run(["node", str(SCAN), str(src.resolve()), *files], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"importscan.mjs failed: {r.stderr.strip()[-400:]}")
    raw = json.loads(r.stdout)
    out = {}
    for f in files:
        res = lambda specs: {t for t in (_resolve(src, f, x) for x in specs) if t is not None and t != f}
        out[f] = {"imports": res(raw[f]["imports"]), "workers": res(raw[f]["workers"]),
                  "typeImports": res(raw[f]["typeImports"]), "refused": raw[f]["refused"]}
    return out


def pattern_disagreements(src: Path) -> list[str]:
    """Where the edge pattern and the parser differ, file by file, and every
    import form the parser refused (Codex R271 FI-I07): every parser edge is a
    pattern edge (the pattern misses none); a pattern edge the parser does not
    have must be a type position's `import("./x").T`."""
    rev, _ = importers(src)
    fwd: dict[str, set[str]] = {}
    for imported, by in rev.items():
        for f in by:
            fwd.setdefault(f, set()).add(imported)
    spawned = spawns(src)
    out = []
    for f, e in parsed_edges(src).items():
        out += [f"{f}: {why}" for why in e["refused"]]
        missed = e["imports"] - fwd.get(f, set())
        excess = fwd.get(f, set()) - e["imports"] - e["typeImports"]
        if missed:
            out.append(f"{f}: the pattern misses {sorted(missed)}")
        if excess:
            out.append(f"{f}: the pattern reads {sorted(excess)}, which the parser finds no import of")
        if e["workers"] != spawned.get(f, set()):
            out.append(f"{f}: workers by the pattern {sorted(spawned.get(f, set()))}, by the parser {sorted(e['workers'])}")
    return out
