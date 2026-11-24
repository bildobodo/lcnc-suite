#!/usr/bin/env python3
"""Rule R — a tool-table read admitted by LinuxCNC's own table (P6 package
"tool files read", plan maschinentag.r465 v4 §3, Codex R465). Pure: no
linuxcnc, no gateway; the gateway hands in the file's bytes and
STAT.tool_table as read AFTER them.

Why the file alone proves nothing: LinuxCNC's `io` writes tool.tbl IN PLACE
(tooldata_save: fopen "w" = truncate, stdio blocks of st_blksize, fclose —
no rename, no fsync, no lock; measured 2026-11-24: the empty file 282 times
in 60 saves, 17 of 22 cut states with equal fd signatures around the read).
What proves a read: `io` puts the new values into its shared table
(tooldata_put, the mmap STAT.tool_table reads live) BEFORE it saves, so
every state of the file during a save is a prefix of the new content while
LinuxCNC's memory already holds all of it.

A row of tool T is PROVEN when the bytes hold exactly one row for T, the
memory exactly one home entry for T, and every field the memory holds
(X…W, D, I, J; Q exactly) equals the row's within TOL — a field absent
from the row counts as 0, as `io` leaves zero fields out. The read is
COMPLETE when the table was read initialised (an EMPTY tuple is "controller
not read", never "no tools") and either the bytes are empty and the memory
holds no tool, or the bytes end in a newline, the multiset of T equals the
memory's, every row is proven and no line is unread.

What R does NOT prove (Codex R465, named — never sold as more):
  * "proven" is within TOL, not "fully printed": a cut last digit can stay
    within TOL of the memory (memory D 1.00000051, `D+1.00000` cut from
    `D+1.000001`) — that row is proven, the whole read stays partial
    without its final newline;
  * the pocket P and the remark (STAT carries neither);
  * an atomic snapshot of the mmap (STAT reads it entry by entry);
  * the completion of an arbitrary foreign write protocol — only that the
    file's listed values equal LinuxCNC's;
  * a writer still at work: `partial` says the file is incomplete or
    differs, never "is being written" (a paused writer and a closed
    incomplete file look the same).
Scope: a nonrandom changer without a tool database (A2): a random changer
saves index 0 as pocket 0 and is not measured, a tool database writes
another file — both `unchecked` with the reason, like an unread controller
(A3)."""
import hashlib
import json
from collections import Counter
from typing import Any, Dict, List, Optional, Sequence, Tuple

from tool_table import parse_tool_table_bytes

#: half a unit of `%+f`'s sixth decimal plus binary rounding (measured
#: |memory − file| ≤ 4.33e-7 over 120 io saves)
TOL = 5.5e-7
#: the file's letters and the STAT.tool_table entry fields that carry them
#: (emcmodule.cc Stat_tool_table: id, x…w offsets, diameter, front/back
#: angle, orientation); Q (orientation) is an integer and compared exactly
STAT_FIELDS: Tuple[Tuple[str, str], ...] = (
    ("X", "xoffset"), ("Y", "yoffset"), ("Z", "zoffset"), ("A", "aoffset"), ("B", "boffset"),
    ("C", "coffset"), ("U", "uoffset"), ("V", "voffset"), ("W", "woffset"),
    ("D", "diameter"), ("I", "frontangle"), ("J", "backangle"), ("Q", "orientation"))

#: why R does not apply (the read is `unchecked`)
SCOPE_RANDOM = "random tool changer"
SCOPE_DATABASE = "tool database"
SCOPE_UNKNOWN = "changer type not read"
NOT_READ = "controller not read"
#: why a read is partial — neutral: never "is being written" (Codex R465)
DIFFERS = "file incomplete or differs from LinuxCNC"
CHANGED = "file changed while read"

# ---- Q465-1 — THE switch point (operator decision pending) -----------------
#: Whether an edit that rewrites the table is refused when rule R cannot
#: check the table at all — a random tool changer or a tool database
#: (MT-TF1's admission, Codex R465 recommends yes). True (the default until
#: the operator answers): such an edit is refused with its named reason;
#: READING stays possible. False: those two scopes edit as before this
#: package (the strict parse, the row and base checks, the write admission
#: still hold). An unread controller is refused either way.
UNCHECKED_EDITS_BLOCKED = True

EDIT_NOT_CONFIRMED = "Tool table not confirmed — nothing written; read again"


def edit_unchecked(why: str) -> str:
    return f"Table not checked ({why}) — nothing written"


Scan = Tuple[List[Dict[str, Any]], List[Dict[str, Any]], bool, bool]


def scan_table(data: bytes) -> Scan:
    """The bytes as rule R reads them: (rows, unread, ends in a newline,
    empty) — rows and unread from THE parser (non-strict)."""
    unread: List[Dict[str, Any]] = []
    rows = parse_tool_table_bytes(data, unread=unread)
    return rows, unread, data.endswith(b"\n"), len(data) == 0


def home_entries(table: Sequence[Any]) -> Dict[int, List[Dict[str, float]]]:
    """LinuxCNC's HOME entries on a nonrandom changer: every index ≥ 1 that
    holds a tool (toolno ≠ −1 — what tooldata_save writes, write_tool_line;
    T0 too), as {T: [fields…]}; index 0 is the spindle copy, never saved
    on a nonrandom changer (tooldata_save starts at 1)."""
    out: Dict[int, List[Dict[str, float]]] = {}
    for idx, t in enumerate(table):
        if idx < 1:
            continue
        tid = int(t.id)
        if tid == -1:
            continue
        entry = {k: float(getattr(t, attr)) for k, attr in STAT_FIELDS if k != "Q"}
        entry["Q"] = int(t.orientation)
        out.setdefault(tid, []).append(entry)
    return out


def _row_diff(row: Dict[str, Any], mem: Dict[str, float]) -> List[str]:
    """The letters whose value the row does not carry within TOL (Q exactly)."""
    out = []
    for k, _attr in STAT_FIELDS:
        have = row.get(k, 0)
        want = mem.get(k, 0)
        if k == "Q":
            if int(have) != int(want):
                out.append(k)
        elif not abs(float(have) - float(want)) <= TOL:
            out.append(k)
    return out


def compare(scan: Scan, table: Optional[Sequence[Any]], scope: Optional[str]) -> Dict[str, Any]:
    """Rule R on a scan against STAT.tool_table read AFTER the bytes: the
    proof {state, proven, differs, missing, extra, duplicates, why,
    ends_newline}. `table` None = not read; an EMPTY tuple = the binding not
    initialised — both "controller not read" (never "no tools")."""
    rows, unread, nl, empty = scan
    proof: Dict[str, Any] = {"state": "unchecked", "proven": [], "differs": [], "missing": [],
                             "extra": [], "duplicates": [], "why": None, "ends_newline": nl}
    if scope is not None:
        proof["why"] = scope
        return proof
    if not table:
        proof["why"] = NOT_READ
        return proof
    memory = home_entries(table)
    by_t: Dict[int, List[Dict[str, Any]]] = {}
    for r in rows:
        by_t.setdefault(int(r["T"]), []).append(r)
    proven, differs = [], []
    for t in sorted(set(by_t) & set(memory)):
        if len(by_t[t]) != 1 or len(memory[t]) != 1:
            continue
        diff = _row_diff(by_t[t][0], memory[t][0])
        if diff:
            differs.append({"T": t, "fields": diff})
        else:
            proven.append(t)
    proof["proven"] = proven
    proof["differs"] = differs
    proof["missing"] = sorted(set(memory) - set(by_t))
    proof["extra"] = sorted(set(by_t) - set(memory))
    proof["duplicates"] = sorted(t for t in set(by_t) | set(memory)
                                 if len(by_t.get(t, ())) > 1 or len(memory.get(t, ())) > 1)
    file_ts = Counter(int(r["T"]) for r in rows)
    mem_ts = Counter({t: len(v) for t, v in memory.items()})
    complete = ((empty and not memory)
                or (nl and file_ts == mem_ts and len(proven) == len(rows) and not unread))
    proof["state"] = "complete" if complete else "partial"
    proof["why"] = None if complete else DIFFERS
    return proof


def prove(data: bytes, table: Optional[Sequence[Any]], scope: Optional[str]) -> Tuple[list, list, Dict[str, Any]]:
    """(rows, unread, proof) of one byte snapshot (scan_table + compare)."""
    scan = scan_table(data)
    return scan[0], scan[1], compare(scan, table, scope)


def changed_while_read(scan: Scan) -> Dict[str, Any]:
    """The proof of an attempt whose file changed under the read (its
    signatures differ): nothing proven, the rows the file's for the note."""
    return {"state": "partial", "proven": [], "differs": [], "missing": [], "extra": [],
            "duplicates": [], "why": CHANGED, "ends_newline": scan[2]}


def edit_basis_refusal(proof: Dict[str, Any]) -> Optional[str]:
    """MT-TF1 (Codex R465): an edit that rewrites the existing table needs
    its basis `complete` — at the basis read AND in the write thread, next to
    the base compare and the write admission (an early check replaces
    neither). None = admitted; else the refusal (nothing written). The
    Q465-1 switch (UNCHECKED_EDITS_BLOCKED) decides a random changer and a
    tool database; an unread controller is refused either way."""
    state, why = proof["state"], proof["why"]
    if state == "complete":
        return None
    if state == "unchecked":
        if why in (SCOPE_RANDOM, SCOPE_DATABASE) and not UNCHECKED_EDITS_BLOCKED:
            return None
        return edit_unchecked(why)
    return EDIT_NOT_CONFIRMED


def content_rev(data: bytes) -> str:
    """The table read's revision: the sha256 of the bytes read."""
    return hashlib.sha256(data).hexdigest()


def library_rev(section: Dict[str, Any]) -> str:
    """The library read's revision: the sha256 of its canonical section."""
    return hashlib.sha256(json.dumps(section, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode("utf-8")).hexdigest()
