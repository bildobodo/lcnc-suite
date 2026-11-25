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
import math
from collections import Counter
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from command_policy import TOOL_NUMBER_MAX
from tool_table import (_C_INT_MAX as INT_MAX, _C_INT_MIN as INT_MIN, LINE_BYTES_MAX, ToolTableUnreadable,
                        home_tools, parse_tool_table_bytes)

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

# ---- why an edit on a partial basis is refused (Codex R468 TF-1a/b) ---------
# A reason is "why — what to do", at most 60 characters. A cause that STAYS
# (a line LinuxCNC's file never reads whole, a tool number twice, a missing
# line end, a table that differs) names its own way out; "read again" stands
# only where a read may really come out differently: the file changed under
# the read, or it ends inside a line and lacks something (a save under way —
# or a closed, cut file: the same observation). The refusals change no rule:
# nothing is written in any of them.
#: the file changed while it was read
EDIT_FILE_CHANGED = "File changed while read — nothing written; read again"
#: the file ends inside a line AND lacks or differs (a save under way or a cut file)
EDIT_INCOMPLETE = "File incomplete — read again; if it stays, fix the file"
#: the file holds exactly what the gateway's last write wrote, its reload still awaited
EDIT_LOADING = "LinuxCNC still loads the last change — try again"
#: everything proven but the last line's line end
EDIT_NO_LINE_END = "Last line has no line end — add it in an editor"
#: more rows than LinuxCNC keeps
EDIT_TOO_MANY = "More than 1000 tools — remove some in an editor"
#: the basis was complete, the write thread's own read is not
EDIT_CHANGED = "Tool table changed meanwhile — nothing written; read again"
#: a partial proof with none of the named facts (compare leaves none)
EDIT_NOT_CONFIRMED = "Tool table not confirmed — nothing written; read again"
#: io keeps the home entries 1 … CANON_POCKETS_MAX - 1 (emctool.h 2.9.4: 1001)
#: and skips the rows past them
IO_TOOLS_MAX = 1000


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


def _line_reason(unread: Sequence[Dict[str, Any]]) -> str:
    return f"Line {unread[0]['line']} not readable — fix it in an editor"


def partial_reason(proof: Dict[str, Any], scan: Scan, loading: bool = False,
                   load_why: Optional[str] = None) -> str:
    """Why an edit on THIS partial read is refused and what to do about it —
    the one source of the words (the gateway's refusal, and the Tools tab's
    note through get_tool_table's `edit_refusal`). Two causes are the edit's
    own: the file changed while it was read, and the file holds exactly the
    gateway's last write whose load is still awaited (`loading`). Then
    `load_why` — why LinuxCNC may not be asked to load this file
    (load_refusal, TF-2): what is wrong with the file is said once, with one
    way out. Only a loadable file gets the difference words: loading it is
    the way out (or, for a tool that is only missing in the file, putting the
    row back — a start would drop it)."""
    if proof["why"] == CHANGED:
        return EDIT_FILE_CHANGED
    if loading:
        return EDIT_LOADING
    if load_why is not None:
        return load_why
    gone, differ = proof["missing"], [*(d["T"] for d in proof["differs"]), *proof["extra"]]
    if gone and not differ:
        what, them = (_tname(gone[0]), "it") if len(gone) == 1 else (f"{len(gone)} tools", "them")
        return f"{what} not in the file — restore {them}" + (", or load the file" if REMOVAL_ALLOWED else "")
    other = sorted({*differ, *gone})
    if other:
        what = f"{_tname(other[0])} differs" if len(other) == 1 else f"{len(other)} tools differ"
        return f"{what} from LinuxCNC — load the file or restart"
    return EDIT_NOT_CONFIRMED


def edit_basis_refusal(proof: Dict[str, Any], scan: Scan, loading: bool = False,
                       load_why: Optional[str] = None) -> Optional[str]:
    """MT-TF1 (Codex R465): an edit that rewrites the existing table needs
    its basis `complete` — at the basis read AND in the write thread, next to
    the base compare and the write admission (an early check replaces
    neither). None = admitted; else the refusal (nothing written), naming
    the cause and the way out (partial_reason). The Q465-1 switch
    (UNCHECKED_EDITS_BLOCKED) decides a random changer and a tool database —
    a line the rewrite would drop refuses there too; an unread controller is
    refused either way."""
    state, why = proof["state"], proof["why"]
    if state == "complete":
        return None
    if state == "unchecked":
        if why in (SCOPE_RANDOM, SCOPE_DATABASE) and not UNCHECKED_EDITS_BLOCKED:
            return _line_reason(scan[1]) if scan[1] else None
        return edit_unchecked(why)
    return partial_reason(proof, scan, loading, load_why)


# ---- may LinuxCNC be asked to load this file (TF-2, plan v3 §1.2) ----------
# The bytes are never "what LinuxCNC loaded": a load is a PATH job io runs
# later (ioControl.cc 2.9.4:974). What CAN be judged is whether io's reader
# would make of these bytes what this suite reads — io splits at spaces only,
# takes a field's leading number, cuts a line at 255 bytes and gives every
# `P` word it reads an index, in a `#` line too —, whether the file holds the
# tool in the spindle (io clears index 0 with the rest and finds it again by
# its number), and whether anything is unknown. ONE function for the preview,
# the read (get_tool_table's `load_refusal`) and the commit; its order is the
# priority of causes: what is wrong with the file before the changer's scope
# (whose line names no way out: none is proven), the file before an unknown
# controller. Every reason ≤ 60 characters, "why — what to do".

#: Q-TF2-1 — THE switch point (operator decision pending): may the load also
#: REMOVE tools LinuxCNC holds and the file does not (behind the dialog's
#: switch, never the tool in the spindle)? False: such a load is refused, the
#: dialog says REMOVAL_OFF, and no text offers it as a way out.
REMOVAL_ALLOWED = True
REMOVAL_OFF = "Loading never removes tools — restore them in the file"

LOAD_FILE_CHANGED = "File changed while read — check again"
LOAD_LINE_ENDS = "Windows line ends in the file — save it without them"
LOAD_OTHERWISE = "LinuxCNC reads this file otherwise — check it in an editor"
LOAD_T_INT = "A T number is past LinuxCNC's integers — correct it"
LOAD_RANDOM = "Random tool changer — not loaded from here"
LOAD_DATABASE = "Tool database — LinuxCNC does not use this file"
LOAD_SCOPE_UNKNOWN = "Changer type not read — check the INI"
LOAD_NO_TOOLS = "No tools in the file — restore it"
LOAD_T_RANGE = f"A T number outside 0–{TOOL_NUMBER_MAX} — fix it in an editor"
LOAD_TABLE_UNREAD = "LinuxCNC's table not read — try again"
LOAD_SPINDLE_UNREAD = "Spindle tool not read — try again"
#: the words of an UNKNOWN read (groups A and F): another read may come out
#: differently — they say nothing against the file (the page's write note
#: says "read again" for them, toolTableRead.ts; a test holds the two lists)
LOAD_UNKNOWN = (LOAD_FILE_CHANGED, LOAD_TABLE_UNREAD, LOAD_SPINDLE_UNREAD, EDIT_LOADING)


@dataclass(frozen=True)
class LoadRead:
    """One read of the file and of LinuxCNC's table after it, as load_refusal
    judges it."""
    data: bytes
    scan: Scan
    proof: Dict[str, Any]
    spindle: object         # STAT.tool_in_spindle; anything but an int ≥ 0: not read
    awaited: bool           # the newest write's or load's job has not ended


def _tname(t: int) -> str:
    """The tool in a reason — a number no table may hold is not spelled out."""
    return f"T{t}" if 0 <= t <= TOOL_NUMBER_MAX else "A tool"


def _tool_text(line: bytes) -> bytes:
    """The line as the parser sees it: b"" for a blank or a comment line."""
    text = line.decode("utf-8", errors="replace").strip()
    return b"" if text.startswith((";", "#")) else text.encode("utf-8")


def _hash_takes_a_place(lines: Sequence[bytes]) -> Optional[int]:
    """The first `#` line that takes a table index (io reads its `P` word —
    home_tools says it, no second mirror) with a tool line behind it, whose
    index it moves."""
    tool_lines = [n for n, line in enumerate(lines, 1) if _tool_text(line)]
    for n, line in enumerate(lines, 1):
        if not tool_lines or n > tool_lines[-1]:
            return None
        if line.strip().startswith(b"#"):
            try:
                if home_tools(line + b"\nT1 P1\n") != {1: (1, 1)}:
                    return n
            except ToolTableUnreadable:
                pass                        # named by the whole file's own read (_load_form)
    return None


def _load_under_the_read(r: LoadRead) -> Optional[str]:
    return LOAD_FILE_CHANGED if r.proof["why"] == CHANGED else None


def _load_cut(r: LoadRead) -> Optional[str]:
    """The file ends inside a line: a cut file's cause is never named."""
    rows, unread, nl, empty = r.scan
    if nl or empty:
        return None
    p = r.proof
    only = p["why"] == DIFFERS and not (p["missing"] or p["extra"] or p["differs"] or p["duplicates"] or unread)
    return EDIT_NO_LINE_END if only else EDIT_INCOMPLETE


def _load_form(r: LoadRead) -> Optional[str]:
    """Would io's reader make of these bytes what this suite reads?"""
    rows, unread, _nl, _empty = r.scan
    if b"\r" in r.data:
        return LOAD_LINE_ENDS
    lines = r.data.split(b"\n")
    for n, line in enumerate(lines, 1):
        if len(line) + 1 > LINE_BYTES_MAX:
            return f"Line {n} too long for LinuxCNC — shorten it in an editor"
    for n, line in enumerate(lines, 1):
        part = line.partition(b";")[0] if _tool_text(line) else b""
        if b"\0" in line or any(not 0x20 <= c <= 0x7E for c in part):
            return f"Line {n} has a tab or control character — remove it"
    want = {i: (r_["T"], r_["P"]) for i, r_ in enumerate(rows[:IO_TOOLS_MAX], 1)}
    home, unmirrored = None, None
    try:
        home = home_tools(r.data)
    except ToolTableUnreadable as e:        # a line the mirror does not read: unknown, never guessed
        unmirrored = str(e)
    if home is not None and home != want:
        n = _hash_takes_a_place(lines)
        if n is not None:
            return f"Line {n} is a # comment with a P word — use ; instead"
    if unread:
        return _line_reason(unread)
    if unmirrored is not None:
        return unmirrored
    for row in rows:
        if not INT_MIN <= row["T"] <= INT_MAX:
            return LOAD_T_INT
    for row in rows:
        for k, name in (("P", "pocket"), ("Q", "Q")):
            if not INT_MIN <= row.get(k, 0) <= INT_MAX:
                return f"{_tname(row['T'])}: {name} is past LinuxCNC's integers — correct it"
    for row in rows:
        if not all(math.isfinite(float(row.get(k, 0))) for k, _attr in STAT_FIELDS):
            return f"{_tname(row['T'])}: not a finite number — fix it in an editor"
    return LOAD_OTHERWISE if home != want else None


def _load_scope(r: LoadRead) -> Optional[str]:
    return {SCOPE_RANDOM: LOAD_RANDOM, SCOPE_DATABASE: LOAD_DATABASE,
            SCOPE_UNKNOWN: LOAD_SCOPE_UNKNOWN}.get(r.proof["why"])


def _load_content(r: LoadRead) -> Optional[str]:
    rows = r.scan[0]
    if not rows:
        return LOAD_NO_TOOLS
    for row in rows:
        if not 0 <= row["T"] <= TOOL_NUMBER_MAX:
            return LOAD_T_RANGE
    for row in rows:
        if not 0 <= row["P"] <= TOOL_NUMBER_MAX:
            return f"{_tname(row['T'])}: pocket outside 0–{TOOL_NUMBER_MAX} — fix it in an editor"
    for row in rows:
        if row["D"] < 0:
            return f"{_tname(row['T'])}: diameter below 0 — fix it in an editor"
    twice = sorted(t for t, n in Counter(row["T"] for row in rows).items() if n > 1)
    if twice:
        return f"{_tname(twice[0])} twice in the file — remove one, restart LinuxCNC"
    return EDIT_TOO_MANY if len(rows) > IO_TOOLS_MAX else None


def _load_unknown(r: LoadRead) -> Optional[str]:
    if r.proof["why"] == NOT_READ:
        return LOAD_TABLE_UNREAD
    if not spindle_read(r.spindle):
        return LOAD_SPINDLE_UNREAD
    return EDIT_LOADING if r.awaited else None


def _load_against_linuxcnc(r: LoadRead) -> Optional[str]:
    held_twice = r.proof["duplicates"]      # (the file holds none twice: _load_content)
    if held_twice:
        return f"LinuxCNC holds {_tname(held_twice[0])} twice — restart it"
    if r.spindle and r.spindle not in {row["T"] for row in r.scan[0]}:
        return f"T{r.spindle} is in the spindle, not in the file — restore it"
    return None


def spindle_read(spindle: object) -> bool:
    """Was STAT.tool_in_spindle read (0 = none)?"""
    return type(spindle) is int and spindle >= 0


def load_refusal(r: LoadRead) -> Optional[str]:
    """Why LinuxCNC is not asked to load the file as read in `r`, or None.
    First match wins: the order IS the priority of causes."""
    for group in (_load_under_the_read, _load_cut, _load_form, _load_scope, _load_content, _load_unknown,
                  _load_against_linuxcnc):
        why = group(r)
        if why is not None:
            return why
    return None


def memory_rev(table: Optional[Sequence[Any]], spindle: object) -> Optional[str]:
    """The revision of what LinuxCNC holds: the sha256 of its home entries
    (by tool, every field exact) and the tool in the spindle; None while
    either is not read. With the bytes' revision it binds both sides of the
    difference the operator was shown."""
    if not table or not spindle_read(spindle):
        return None
    home = [[t, [[e[k] for k, _attr in STAT_FIELDS] for e in entries]]
            for t, entries in sorted(home_entries(table).items())]
    return hashlib.sha256(json.dumps([spindle, home], separators=(",", ":")).encode("utf-8")).hexdigest()


def load_differences(scan: Scan, table: Sequence[Any], proof: Dict[str, Any],
                     names: Dict[int, str]) -> Dict[str, List[Dict[str, Any]]]:
    """What the file would change in LinuxCNC's table, from a read load_refusal
    admits (every tool once on both sides): `removed` with LinuxCNC's values,
    `changed` field by field (now, file), `added` with the file's. Values
    only — STAT carries neither pocket nor remark."""
    memory = {t: e[0] for t, e in home_entries(table).items()}
    rows = {row["T"]: row for row in scan[0]}

    def one(t: int, values: Dict[str, Any]) -> Dict[str, Any]:
        return {"T": t, "name": names.get(t, ""), "Z": float(values.get("Z", 0)), "D": float(values.get("D", 0))}
    return {"removed": [one(t, memory[t]) for t in proof["missing"]],
            "changed": [{"T": d["T"], "name": names.get(d["T"], ""),
                         "fields": [{"f": k, "now": memory[d["T"]].get(k, 0), "file": rows[d["T"]].get(k, 0)}
                                    for k in d["fields"]]}
                        for d in proof["differs"]],
            "added": [one(t, rows[t]) for t in proof["extra"]]}


# ---- a prepared tool (tool guard, Codex R476 answer 2 / MT476-02) -----------
# `T5` without `M6`: LinuxCNC's io keeps what it prepared as a table INDEX
# (pocketPrepped, STAT.pocket_prepped: -1 at its start and after every
# finished change, 0 = T0) and the tool's number and POCKET on HAL
# (tool-prep-number / tool-prep-pocket, ioControl.cc 2.9.4:880-920). A load
# gives every row its index anew, in file order, and prepares nothing again;
# the M6 that follows takes number and pocket of whatever row then stands at
# the old index (629-655). A `T` + `M6` of the tool already in the spindle
# changes nothing and leaves its index prepared (951) — a resting state after
# every such program. The E-Stop of a GUI (EMC_AUX_ESTOP_ON) clears the pins,
# never the index (hal_init_pins); a T aborted before it was prepared leaves
# ITS number on the pins — so the words name no tool.
PREPARED_UNREAD = "Prepared tool not read — try again"
PREPARED = "A tool is prepared — change to another tool or send T0"
PREPARED_UNKNOWN = "Prepared tool unknown — send T0 or restart LinuxCNC"
PREPARING = "A tool is being prepared — wait until it is done"
PREPARED_CLEARED = "Prepared tool unclear since the E-Stop — send T0 first"


def prepared_refusal(data: bytes, scope: Optional[str], index: object, preparing: object,
                     number: object, pocket: object) -> Optional[str]:
    """May LinuxCNC load a tool table file of these bytes NOW, as far as a
    prepared tool goes? None = yes, else why not and the way out. Pure; every
    path that sends a load_tool_table asks it on the very bytes the load will
    read. `index` STAT.pocket_prepped; `preparing`, `number`, `pocket` the
    FRESH pins tool-prepare, tool-prep-number, tool-prep-pocket (None: not in
    the snapshot — an older reader, a pin that did not read). `scope` as in
    compare(): a random changer's index is the pocket and a tool database
    reads no file — neither is judged, so neither loads while a tool is
    prepared.

    Nothing prepared is index -1 or 0 AND no preparation under way — that one
    is known from the pin, or (an older reader) from number 0: nothing asked
    for. Prepared: the preparation is KNOWN to have ended (`preparing` False;
    a new `T` keeps the old index until its tool-prepared comes, so a positive
    index proves nothing about it — Codex R481 MT-I44), and the tool at the
    index after the load (LinuxCNC's own index assignment, home_tools) must be
    the SAME number in the SAME pocket as the pins say was prepared — never as
    a file says, which may have changed."""
    if type(index) is not int or index < -1:
        return PREPARED_UNREAD
    if preparing is True:
        return PREPARING
    tool = number if type(number) is int else None
    if index <= 0:
        return None if preparing is False or tool == 0 else PREPARED_UNKNOWN
    if scope is not None:
        return f"Prepared tool not checked ({scope}) — send T0"
    if preparing is not False or tool is None or type(pocket) is not int:
        return PREPARED_UNKNOWN
    if tool == 0:
        return PREPARED_CLEARED
    try:
        after = home_tools(data).get(index)
    except ToolTableUnreadable as e:
        return str(e)
    return None if after == (tool, pocket) else PREPARED


def content_rev(data: bytes) -> str:
    """The table read's revision: the sha256 of the bytes read."""
    return hashlib.sha256(data).hexdigest()


def library_rev(section: Dict[str, Any]) -> str:
    """The library read's revision: the sha256 of its canonical section."""
    return hashlib.sha256(json.dumps(section, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode("utf-8")).hexdigest()
