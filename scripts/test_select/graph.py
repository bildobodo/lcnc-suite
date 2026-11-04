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

import os
import re
from collections import deque
from pathlib import Path

CUTS = {
    "App.vue": "App composes the features: its direct import is that feature's wiring",
    "defaults.ts": "the settings registry takes a module's default values: the module's rule names its readers",
}

EDGE = re.compile(
    r"""^\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s*['"](\.{1,2}/[^'"]+)['"]"""
    r"""|import\(\s*['"](\.{1,2}/[^'"]+)['"]\s*\)"""
    r"""|new URL\(\s*['"](\.{1,2}/[^'"]+)['"]\s*,\s*import\.meta\.url"""
    r"""|^\s*import\s+['"](\.{1,2}/[^'"]+)['"]""",
    re.M | re.S)


def sources(src: Path) -> list[str]:
    return sorted(p.relative_to(src).as_posix() for p in src.rglob("*")
                  if p.suffix in (".ts", ".vue") and not p.name.endswith((".test.ts", ".d.ts")))


def _resolve(src: Path, importer: str, rel: str) -> str | None:
    p = (src / importer).parent / rel
    for cand in (p, Path(f"{p}.ts"), Path(f"{p}.vue"), p / "index.ts"):
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
