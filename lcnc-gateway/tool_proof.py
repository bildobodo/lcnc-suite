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

from tool_table import ToolTableUnreadable, home_tools, parse_tool_table_bytes

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


def partial_reason(proof: Dict[str, Any], scan: Scan, loading: bool = False) -> str:
    """Why an edit on THIS partial read is refused and what to do about it —
    the one source of the words (the gateway's refusal, and the Tools tab's
    note through get_tool_table's `edit_refusal`). A cause in the file is
    named only where the file is whole by its other marks: a file that ends
    inside a line and lacks something may be a save under way, and "fix line
    7 in an editor" would be the wrong advice there. The ways out follow
    LinuxCNC's source (2.9.4; not run natively): tooldata_load reads a tool
    number twice into TWO entries (removing one row leaves LinuxCNC's two —
    hence the restart; io's next save would write both back), it skips an
    unreadable line or takes a cut value from it, a start loads the file —
    a tool missing there is gone —, a full import replaces the file and has
    LinuxCNC load it. `loading`: the file holds exactly the gateway's last
    write and LinuxCNC's load of it is still awaited."""
    rows, unread, nl, _empty = scan
    if proof["why"] == CHANGED:
        return EDIT_FILE_CHANGED
    if loading:
        return EDIT_LOADING
    file_ts = Counter(int(r["T"]) for r in rows)
    extra, differs = proof["extra"], [d["T"] for d in proof["differs"]]
    twice = [t for t in proof["duplicates"] if file_ts[t] > 1]
    loaded_twice = [t for t in proof["duplicates"] if file_ts[t] <= 1]
    if not nl:
        if proof["missing"] or extra or differs or unread or twice or loaded_twice:
            return EDIT_INCOMPLETE
        return EDIT_NO_LINE_END
    # an unread line first: LinuxCNC may hold a tool from it (a cut value, a
    # cut T) that then reads as missing — it IS in the file, and a start
    # would load the same cut value again
    if unread:
        return _line_reason(unread)
    gone = proof["missing"]
    if gone and not extra:
        what, them = (f"T{gone[0]}", "it") if len(gone) == 1 else (f"{len(gone)} tools", "them")
        return f"{what} not in the file — restore it; restart drops {them}"
    if twice:
        return f"T{twice[0]} twice in the file — remove one, restart LinuxCNC"
    if len(rows) > IO_TOOLS_MAX:
        return EDIT_TOO_MANY
    if loaded_twice:
        return f"LinuxCNC holds T{loaded_twice[0]} twice — restart it"
    other = sorted({*differs, *extra, *gone})
    if other:
        what = f"T{other[0]} differs" if len(other) == 1 else f"{len(other)} tools differ"
        return f"{what} from LinuxCNC — a restart loads the file"
    return EDIT_NOT_CONFIRMED


def edit_basis_refusal(proof: Dict[str, Any], scan: Scan, loading: bool = False) -> Optional[str]:
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
    return partial_reason(proof, scan, loading)


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
