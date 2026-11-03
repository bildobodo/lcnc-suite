"""Every read a test makes from disk, against the table (Codex R256 TS256-02,
R257).

The scanned files are the heavy unit files, every e2e file and every
node-side module under lcnc-webui/src (none reads today). A read site is ONE
CALL — the whole source is scanned, so two calls on a line count twice and a
call split across lines is still a call. Each call belongs to exactly one
entry of rules.READ_SITES, which binds to the call by the text that starts
at the primitive's name; each entry finds exactly its count. A form the
scanner cannot bind fails visibly: a call whose text matches no entry (a
line break before its parenthesis included), and a read primitive used
other than called — an alias, a destructured name, an imported name or a
node namespace handed on as a value. Pure: reads the files it is given.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from test_select.rules import HEAVY_UNIT, READ_SITES, matches

# What reads or runs: the node modules' primitives, through a name the file
# imports from them or on a namespace it imports from them (fs.readFileSync,
# cp.execFileSync) — a RegExp's .exec( or a dialog's .open( is no read.
NODE_IO = r"(?:node:)?(?:fs|fs/promises|child_process)"
PRIMITIVES = ("readFileSync", "readFile", "readdirSync", "readdir", "existsSync", "statSync", "stat",
              "lstatSync", "createReadStream", "openSync", "open", "execFileSync", "execFile",
              "execSync", "exec", "spawnSync", "spawn", "fork", "opendir", "opendirSync")
IMPORT = re.compile(r"""import\s*(?:\{([^}]*)\}|(?:\*\s+as\s+)?(\w+))\s*from\s*["']%s["'];?""" % NODE_IO)


@dataclass(frozen=True)
class Call:
    offset: int     # where the primitive's name starts
    line: int
    name: str       # the primitive


def blank_comments(text: str) -> str:
    """Whole-line // comments to spaces (offsets and line numbers kept)."""
    return re.sub(r"(?m)^[ \t]*//.*$", lambda m: " " * len(m.group(0)), text)


def calls(text: str) -> tuple[list[Call], list[str]]:
    """Every call of a read primitive, and every use of one the scanner
    cannot bind (not called directly)."""
    src = blank_comments(text)
    imports = list(IMPORT.finditer(src))
    inside = lambda o: any(m.start() <= o < m.end() for m in imports)   # noqa: E731
    named: dict[str, str] = {}      # local name → primitive
    spaces: list[str] = []
    for m in imports:
        if m.group(2):
            spaces.append(m.group(2))
            continue
        for part in m.group(1).split(","):
            bits = part.split()
            if bits and bits[0] != "type" and bits[0] in PRIMITIVES:
                named[bits[-1] if "as" in bits else bits[0]] = bits[0]
    found: list[Call] = []
    loose: list[str] = []
    line_of = lambda o: src.count("\n", 0, o) + 1   # noqa: E731
    for local, prim in named.items():
        for m in re.finditer(rf"(?<![\w.$]){re.escape(local)}\b", src):
            if inside(m.start()):
                continue
            if re.match(r"\s*\(", src[m.end():]):
                found.append(Call(m.start(), line_of(m.start()), prim))
            else:
                loose.append(f"{line_of(m.start())}: {local} used other than called")
    prim_alt = "|".join(PRIMITIVES)
    for ns in spaces:
        for m in re.finditer(rf"(?<![\w.$]){re.escape(ns)}\b", src):
            if inside(m.start()):
                continue
            mm = re.match(rf"(?:\.promises)?\.({prim_alt})\b(\s*\()?", src[m.end():])
            if mm and mm.group(2):
                at = m.end() + mm.start(1)
                found.append(Call(at, line_of(at), mm.group(1)))
            elif mm:
                loose.append(f"{line_of(m.start())}: {ns}.{mm.group(1)} used other than called")
            elif not re.match(r"\s*\.\s*\w", src[m.end():]):
                loose.append(f"{line_of(m.start())}: the namespace {ns} handed on as a value")
    return sorted(found, key=lambda c: c.offset), loose


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
    for rel in scanned(root):
        text = (root / rel).read_text()
        src = blank_comments(text)
        actual, loose = calls(text)
        found += [f"{rel}:{x}" for x in loose]
        declared = READ_SITES.get(rel, ())
        owner: dict[int, str] = {}
        for r in declared:
            hits = [c for c in actual if src.startswith(r.text, c.offset)]
            if len(hits) != r.count:
                found.append(f"{rel}: {r.text!r} found {len(hits)} times, the table says {r.count}")
            for c in hits:
                if c.offset in owner:
                    found.append(f"{rel}:{c.line}: a call two entries claim")
                owner[c.offset] = r.text
        for c in actual:
            if c.offset not in owner:
                found.append(f"{rel}:{c.line}: a {c.name} call the table does not name: "
                             f"{src[c.offset:c.offset + 100].splitlines()[0] if src[c.offset:].strip() else ''}")
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
