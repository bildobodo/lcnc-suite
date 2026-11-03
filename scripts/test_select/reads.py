"""Every read a test makes from disk, against the table (Codex R256 TS256-02).

The scanned files are the heavy unit files, every e2e file and every
node-side module under lcnc-webui/src (none reads today). A line that calls
a read or a run primitive is a read site; each must belong to exactly one
entry of rules.READ_SITES (by its text), each entry must find exactly its
count of sites — so a second, unknown read is never covered by a first known
one, whatever form its path takes. Pure: reads the files it is given.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from test_select.rules import HEAVY_UNIT, READ_SITES, matches

# What reads or runs: the node modules' primitives. A site is a call of a
# name the file imports from one of these modules, or of such a primitive on
# a namespace it imports from them (fs.readFileSync, cp.execFileSync) — a
# RegExp's .exec( or a dialog's .open( is no read.
NODE_IO = r"(?:node:)?(?:fs|fs/promises|child_process)"
PRIMITIVES = ("readFileSync", "readFile", "readdirSync", "readdir", "existsSync", "statSync", "stat",
              "lstatSync", "createReadStream", "openSync", "open", "execFileSync", "execFile",
              "execSync", "exec", "spawnSync", "spawn", "fork", "opendir", "opendirSync")
NAMED = re.compile(r"""import\s*\{([^}]*)\}\s*from\s*["']%s["']""" % NODE_IO)
SPACE = re.compile(r"""import\s+(?:\*\s+as\s+)?(\w+)\s+from\s*["']%s["']""" % NODE_IO)


def call_pattern(text: str) -> re.Pattern[str] | None:
    names: set[str] = set()
    for group in NAMED.findall(text):
        for part in group.split(","):
            bits = part.split()
            if bits and bits[0] != "type":
                local = bits[-1] if "as" in bits else bits[0]
                if bits[0] in PRIMITIVES:
                    names.add(re.escape(local))
    spaces = SPACE.findall(text)
    alts = [rf"(?<![\w.]){n}\s*\(" for n in names]
    alts += [rf"\b{re.escape(ns)}(?:\.promises)?\.(?:{'|'.join(PRIMITIVES)})\s*\(" for ns in spaces]
    return re.compile("|".join(alts)) if alts else None


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


def sites(text: str) -> list[tuple[int, str]]:
    pat = call_pattern(text)
    if pat is None:
        return []
    return [(n, line.strip()) for n, line in enumerate(text.splitlines(), 1)
            if not line.lstrip().startswith("//") and pat.search(line)]


def problems(root: Path) -> list[str]:
    found: list[str] = []
    for rel in scanned(root):
        text = (root / rel).read_text()
        actual = sites(text)
        declared = READ_SITES.get(rel, ())
        claimed: dict[int, str] = {}
        for r in declared:
            hits = [n for n, line in actual if r.text in line]
            if len(hits) != r.count:
                found.append(f"{rel}: {r.text!r} found {len(hits)} times, the table says {r.count}")
            for n in hits:
                if n in claimed:
                    found.append(f"{rel}:{n}: claimed by two entries")
                claimed[n] = r.text
        for n, line in actual:
            if n not in claimed:
                found.append(f"{rel}:{n}: a read the table does not name: {line[:120]}")
        # every literal path outside the frontend lies under what this file declares
        globs = [g for r in declared if r.reads for g in r.reads]
        for lit in REPO_LITERAL.findall(text):
            t = os.path.normpath((Path(rel).parent / lit).as_posix())
            if not any(matches(g, t) or matches(g, t.rstrip("/") + "/x") for g in globs):
                found.append(f"{rel}: names {t}, which no read of it declares")
    for rel in READ_SITES:
        if not (root / rel).is_file():
            found.append(f"{rel}: in the table, not in the tree")
        elif rel not in scanned(root):
            found.append(f"{rel}: in the table but not scanned")
    return found


def heavy_literals(root: Path) -> list[str]:
    """The paths the heavy loader is handed: the ROOT-relative literals of the
    heavy files and of collisionFixtures.ts."""
    files = list(HEAVY_UNIT) + ["lcnc-webui/src/viewer/collisionFixtures.ts"]
    return [lit for f in files for lit in ROOT_LITERAL.findall((root / f).read_text())]
