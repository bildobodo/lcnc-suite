"""What the interpreter holds of the probing parameters, as THIS gateway wrote
it (P5-2 b, plan v6 — Codex R440–R444). Pure: no LinuxCNC, no asyncio.

Per parameter number (PROBE_KEYS: the probe panel's #3014–#3036, the surface
scan's #3050–#3059) the last thing the gateway knows: `applied` — a chunk of
its own carrying the value ended RCS_DONE on this Link; `read` — a confirmed
synch-read; `unknown` — a write that began and did not end provenly, or any
text that may have written the key. No entry: this process never wrote it and
nothing it sent may have — no claim either way.

Every text the gateway sends is classified BEFORE its possible effect (in the
write's own thread, at its begin): the keys it provenly writes become
unknown, a proven "none" leaves the book alone, and what the classifier
cannot settle — a computed target, a call into another file, a program — makes
EVERY key unknown. A value taken before a later invalidation never comes back
by itself: only the next own write or a confirmed read restores a key.

An entry holds only for the Link it was made on: after a Link change nothing
is "on the machine". A named limit: writes the gateway does not see (another
NML client, halcmd, a routine started outside it)."""
from __future__ import annotations

import hashlib
import threading
import time
from typing import Any, Callable, Dict, FrozenSet, Iterable, List, Optional

from probe_routines import ROUTINES

PROBE_KEYS: FrozenSet[int] = frozenset(range(3014, 3037)) | frozenset(range(3050, 3060))
#: the probe tip offset — one writer, the gateway (P5-1 c)
OFFSET_KEY = 3032

OUTCOMES = ("applied", "read", "unknown")


def _bundled_closure(name: str, read: Callable[[str], Optional[bytes]]) -> Optional[List[str]]:
    """`name` and every file its o-calls run — None unless each is the
    bundled one: `read(n)` gives the bytes of the file the INTERPRETER
    resolves, compared with the table's content. A routine of the operator's
    earlier on the path, or a changed one, is not."""
    seen: List[str] = []
    todo = [name]
    while todo:
        n = todo.pop()
        if n in seen:
            continue
        row = ROUTINES.get(n)
        raw = read(n) if row is not None else None
        if row is None or raw is None or hashlib.sha256(raw).hexdigest() != row[0]:
            return None
        seen.append(n)
        todo.extend(row[2])
    return seen


def routine_effect(name: str, read: Callable[[str], Optional[bytes]],
                   remapped: Callable[[str], Optional[FrozenSet[int]]]) -> Optional[FrozenSet[int]]:
    """The PROBE_KEYS the call of a probe routine may write — None: not
    proven (every key becomes unknown). Proven only where the resolved
    routine AND each file it calls is the bundled one; `remapped(line)` adds
    what the configuration's remapped words in them may write (None: not
    readable — not proven)."""
    files = _bundled_closure(name, read)
    if files is None:
        return None
    body = remapped("o<" + name + "> call")     # a text for the reader, never sent
    if body is None:
        return None
    return frozenset(k for n in files for k in ROUTINES[n][1]) | (body & PROBE_KEYS)


def routine_reads_offset(name: str, read: Callable[[str], Optional[bytes]]) -> bool:
    """Does the routine read #3032? Unknown (not the bundled one) reads it."""
    files = _bundled_closure(name, read)
    return True if files is None else any(ROUTINES[n][3] for n in files)


class ProbeBook:
    """Thread-safe: the write threads invalidate, the event loop books and
    builds the wire view."""

    def __init__(self, wall: Callable[[], float] = time.time,
                 emit: Callable[..., None] = lambda *_a, **_k: None) -> None:
        self._lock = threading.Lock()
        self._wall = wall
        self._emit = emit
        self._e: Dict[int, Dict[str, Any]] = {}
        self.version = 0

    def invalidate(self, keys: Optional[Iterable[int]], why: str) -> None:
        """`keys` (None: every probe key) may be written by what begins now."""
        ks = sorted(PROBE_KEYS if keys is None else PROBE_KEYS & frozenset(keys))
        if not ks:
            return
        now = self._wall()
        changed: List[int] = []
        with self._lock:
            for k in ks:
                old = self._e.get(k)
                if old is None or old["outcome"] != "unknown":
                    changed.append(k)
                self._e[k] = {"value": None, "outcome": "unknown", "t": now, "link": None, "job": why,
                              "persisted": None, "refused": None}
            if changed:
                self.version += 1
        if changed:
            self._emit("probe.book_unknown", keys=changed, why=why, all=keys is None)

    def book(self, values: Dict[int, Optional[float]], outcome: str, link_seq: Optional[int], job: str) -> None:
        """Values this gateway's own chunk put into the interpreter
        (`applied`), or a confirmed read gave (`read`)."""
        if outcome not in ("applied", "read"):
            raise ValueError(f"no booking outcome: {outcome!r}")
        now = self._wall()
        with self._lock:
            for k, v in values.items():
                if k not in PROBE_KEYS:
                    continue
                if v is None:
                    self._e.pop(k, None)     # the file has no line for it: nothing known
                    continue
                self._e[k] = {"value": float(v), "outcome": outcome, "t": now, "link": link_seq, "job": job,
                              "persisted": True if outcome == "read" else None, "refused": None}
            self.version += 1

    def refused(self, values: Dict[int, float], why: str) -> None:
        """Values whose write was provenly NOT made (refused before its
        begin): what the machine holds of them is unchanged."""
        with self._lock:
            for k, v in values.items():
                if k not in PROBE_KEYS:
                    continue
                e = self._e.get(k)
                note = {"value": float(v), "why": why}
                if e is None:
                    self._e[k] = {"value": None, "outcome": None, "t": self._wall(), "link": None, "job": None,
                                  "persisted": None, "refused": note}
                else:
                    e["refused"] = note
            self.version += 1

    def persisted(self, keys: Iterable[int], ok: bool) -> None:
        """Did the parameter file take the keys an own chunk put into the
        interpreter?"""
        with self._lock:
            for k in keys:
                e = self._e.get(k)
                if e is not None and e["outcome"] == "applied":
                    e["persisted"] = bool(ok)
            self.version += 1

    def entry(self, key: int, link_seq: Optional[int]) -> Optional[Dict[str, Any]]:
        """A key's entry as it holds on `link_seq` — its outcome `unknown`
        once the Link is another one; None: nothing known."""
        with self._lock:
            e = self._e.get(key)
            return None if e is None else self._on(e, link_seq)

    @staticmethod
    def _on(e: Dict[str, Any], link_seq: Optional[int]) -> Dict[str, Any]:
        out = dict(e)
        if out["outcome"] in ("applied", "read") and (link_seq is None or out["link"] != link_seq):
            out.update(outcome="unknown", value=None)
        return out

    def wire(self, link_seq: Optional[int]) -> Dict[str, Any]:
        """{"version", "keys": {"3014": {"value", "outcome", "t", "job",
        "refused"}}} — t in ms. A key with nothing known is absent."""
        with self._lock:
            keys = {}
            for k, raw in sorted(self._e.items()):
                e = self._on(raw, link_seq)
                if e["outcome"] is None and e["refused"] is None:
                    continue
                keys[str(k)] = {"value": e["value"], "outcome": e["outcome"], "t": round(e["t"] * 1000),
                                "job": e["job"],
                                **({"refused": e["refused"]["value"]} if e["refused"] else {})}
            return {"version": self.version, "keys": keys}


def machine_outcome(value: Optional[float], entry: Optional[Dict[str, Any]], writing: bool) -> Dict[str, Any]:
    """What the machine holds of the active calibration offset (plan v6 P5-1
    d), from the booking of #3032 alone — one truth, whoever wrote it:
    write_pending (the gateway's own write is under way), taken /
    taken_persist_unconfirmed (it holds this value; the file has it, or that
    is not confirmed), saved_write_unknown (a write whose effect is not
    known), saved_not_written (nothing, or another value: the next probe
    writes it)."""
    if writing:
        return {"outcome": "write_pending", "at": None, "why": None}
    out = None if entry is None else entry.get("outcome")
    at = None if entry is None else round(entry["t"] * 1000)
    if out == "unknown":
        return {"outcome": "saved_write_unknown", "at": at, "why": entry.get("job") if entry else None}
    if out in ("applied", "read") and entry is not None and value is not None and entry.get("value") == value:
        return {"outcome": "taken" if entry.get("persisted") else "taken_persist_unconfirmed", "at": at, "why": None}
    return {"outcome": "saved_not_written", "at": None,
            "why": (entry.get("refused") or {}).get("why") if entry else None}
