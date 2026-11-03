"""Every read a test makes from disk, against the table (Codex R256 TS256-02,
R257, R258).

The scanned files are the heavy unit files, every e2e file and every
node-side module under lcnc-webui/src (none reads today). The TypeScript
parser finds the read sites (readscan.mjs): every CALL of a node read or run
primitive — through a name imported from node:fs, fs/promises or
child_process, or as a member of such a module's default or namespace
binding, whitespace and line breaks wherever JavaScript allows them — and
refuses every other use of those modules (an alias, a destructuring, a
namespace handed on, an element access, require() / import() of one, a
re-export): a form outside the scanner's narrow language fails visibly.
Each call belongs to exactly one entry of rules.READ_SITES, bound by the text
from the primitive's name; each entry finds exactly its count. Pure but for
running node on the parser the frontend already ships.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

from test_select.rules import HEAVY_UNIT, READ_SITES, matches

SCAN = Path(__file__).resolve().parent / "readscan.mjs"


def scan(root: Path, files: list[str]) -> dict[str, dict]:
    """{file: {calls: [{line, start, prim, text}], refused: [...]}} — a scanner
    failure raises: no answer is never "no reads"."""
    r = subprocess.run(["node", str(SCAN), str(root.resolve()), *files], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"readscan.mjs failed: {r.stderr.strip()[-400:]}")
    return json.loads(r.stdout)


# A literal path a scanned file names outside lcnc-webui: new URL("../../x"),
# a template URL (`../../dir/${name}`) or a ROOT-relative literal.
REPO_LITERAL = re.compile(r"""new URL\(\s*["'`](\.\./\.\./[^"'`$]*)""")
ROOT_LITERAL = re.compile(r"""["'`]((?:examples|lcnc-gateway|scripts|subroutines|test-fixtures)/[^"'`$\s]*)["'`]""")


def scanned(root: Path) -> list[str]:
    web = root / "lcnc-webui"
    out = set(HEAVY_UNIT)
    out |= {p.relative_to(root).as_posix() for p in (web / "e2e").glob("*") if p.suffix in (".ts", ".mjs", ".js")}
    out |= {p.relative_to(root).as_posix() for p in (web / "src").rglob("*.ts") if not p.name.endswith(".test.ts")}
    return sorted(out)


def problems(root: Path) -> list[str]:
    found: list[str] = []
    files = scanned(root)
    result = scan(root, files)
    for rel in files:
        text = (root / rel).read_text()
        found += [f"{rel}:{x}" for x in result[rel]["refused"]]
        actual = result[rel]["calls"]
        declared = READ_SITES.get(rel, ())
        owner: dict[int, str] = {}
        for r in declared:
            hits = [c for c in actual if c["text"].startswith(r.text)]
            if len(hits) != r.count:
                found.append(f"{rel}: {r.text!r} found {len(hits)} times, the table says {r.count}")
            for c in hits:
                if c["start"] in owner:
                    found.append(f"{rel}:{c['line']}: a call two entries claim")
                owner[c["start"]] = r.text
        for c in actual:
            if c["start"] not in owner:
                found.append(f"{rel}:{c['line']}: a {c['prim']} call the table does not name: {c['text'][:100]!r}")
        # every literal path outside the frontend lies under what this file declares
        globs = [g for r in declared if r.reads for g in r.reads]
        for lit in REPO_LITERAL.findall(text):
            t = os.path.normpath((Path(rel).parent / lit).as_posix())
            if not any(matches(g, t) or matches(g, t.rstrip("/") + "/x") for g in globs):
                found.append(f"{rel}: names {t}, which no read of it declares")
    for rel in READ_SITES:
        if not (root / rel).is_file():
            found.append(f"{rel}: in the table, not in the tree")
        elif rel not in files:
            found.append(f"{rel}: in the table but not scanned")
    return found


def heavy_literals(root: Path) -> list[str]:
    """The paths the heavy loader is handed: the ROOT-relative literals of the
    heavy files and of collisionFixtures.ts."""
    files = list(HEAVY_UNIT) + ["lcnc-webui/src/viewer/collisionFixtures.ts"]
    return [lit for f in files for lit in ROOT_LITERAL.findall((root / f).read_text())]
