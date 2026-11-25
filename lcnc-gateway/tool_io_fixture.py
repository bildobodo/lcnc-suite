"""Test helper (P6 "tool files read", rule R): LinuxCNC's tool table as the
gateway reads it through STAT — what `io` holds after it LOADED a tool.tbl
(tooldata_load, nonrandom: index 0 the spindle entry, the file's tools in
home entries 1…n in file order). A tool edit is admitted only on a table
LinuxCNC's own proves (MT-TF1), so a test that is not about the proof gives
its fake status the table its file holds — and a fake `load_tool_table`
that loads it again, as io does. Nothing is filled in on a test's behalf:
the test calls these. Import after fake_linuxcnc.install()."""
from pathlib import Path
from typing import Any, Iterable, Tuple, Union

from fake_linuxcnc import _ToolRow
from tool_table import parse_tool_table_bytes

#: the file's letters → the STAT entry's fields (tool_proof.STAT_FIELDS)
_FIELDS = {"X": "xoffset", "Y": "yoffset", "Z": "zoffset", "A": "aoffset", "B": "boffset",
           "C": "coffset", "U": "uoffset", "V": "voffset", "W": "woffset", "D": "diameter",
           "I": "frontangle", "J": "backangle"}


#: the reader's values of a machine at rest: no M6 request, no tool prepared
#: (iocontrol's tool-prepare / tool-prep-number / tool-prep-pocket)
READER_AT_REST = {"tool_change": False, "tool_prepare": False, "tool_prep_number": 0, "tool_prep_pocket": 0}


def at_rest(stat: Any) -> None:
    """The controller read a tool-table write that sends a reload needs: the
    machine stands, no tool is prepared (LinuxCNC's -1: at its start and after
    every finished change)."""
    stat.inpos, stat.current_vel, stat.pocket_prepped = True, 0.0, -1


def entry(tool: int, **fields: float) -> Any:
    """One STAT.tool_table entry (the binding's tool_result) from file
    letters: entry(5, Z=50.0, D=6.0)."""
    kw = {_FIELDS[k]: float(v) for k, v in fields.items() if k in _FIELDS}
    kw["orientation"] = int(fields.get("Q", 0))
    z = kw.pop("zoffset", 0.0)
    d = kw.pop("diameter", 0.0)
    return _ToolRow(tool, z, d, **kw)   # the fake binding's tool_result


def loaded_table(data: Union[bytes, str], spindle: int = 0) -> Tuple[Any, ...]:
    """STAT.tool_table after io loaded `data` (bytes or text): index 0 the
    spindle entry (a copy of the loaded tool's row, else an empty T0), then
    every row the parser reads, in file order."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    rows = parse_tool_table_bytes(data)
    home = [entry(int(r["T"]), **{k: v for k, v in r.items() if k in _FIELDS or k == "Q"}) for r in rows]
    spin = next((e for e in home if e.id == spindle), None) if spindle > 0 else None
    return (spin if spin is not None else entry(0),) + tuple(home)


def load_into(stat: Any, path: Union[str, Path], spindle: int = 0) -> None:
    """io's load of the file at `path` NOW into the fake `stat`."""
    stat.tool_table = loaded_table(Path(path).read_bytes(), spindle)


class LoadingCommand:
    """A fake command channel whose load_tool_table is io's: it reads the
    file at `path` into `stat.tool_table` at the call (and records the text
    it loaded); every other command a no-op recorder."""

    def __init__(self, stat: Any, path: Union[str, Path]):
        self.stat, self.path, self.loaded = stat, Path(path), []

    def load_tool_table(self) -> None:
        self.loaded.append(self.path.read_text())
        load_into(self.stat, self.path)

    def __getattr__(self, _name: str) -> Any:
        return lambda *a, **k: None


class SplitIo:
    """A fake io whose steps are SEPARATE (TF-2): `load_tool_table` only
    queues the request (and calls `then`, the test's next step right behind
    the NML write); `run` is the load (the table cleared, then the file — a
    missing one leaves it EMPTY, tooldata_common.cc 2.9.4:296), `drop` an
    abort that drops it, `set_offset` a foreign G10 L1 — tooldata_put, THEN
    tooldata_save: a refused save keeps the value and the file
    (ioControl.cc:1006). `held` is what io knows and STAT does not carry:
    {T: (P, remark)}."""

    def __init__(self, stat: Any, path: Union[str, Path], immediate: bool = False):
        self.stat, self.path, self.immediate = stat, Path(path), immediate
        self.loads = self.queued = 0
        self.then: Any = None
        self.held: Any = {}
        self.run()

    def load_tool_table(self) -> None:
        self.loads += 1
        self.queued += 1
        if self.immediate:
            self.run()
        if self.then is not None:
            self.then()

    def run(self) -> bool:
        self.queued = 0
        self.held = {}
        try:
            data = self.path.read_bytes()
        except FileNotFoundError:
            self.stat.tool_table = (entry(-1),)
            return False
        self.held = {r["T"]: (r["P"], r["remark"]) for r in parse_tool_table_bytes(data)}
        self.stat.tool_table = loaded_table(data, getattr(self.stat, "tool_in_spindle", 0))
        return True

    def drop(self) -> None:
        self.queued = 0

    def set_offset(self, tool: int, save: bool = True, **fields: float) -> None:
        old = {e.id: e for e in self.stat.tool_table[1:]}
        new = entry(tool, **fields)
        self.stat.tool_table = self.stat.tool_table[:1] + tuple(new if e.id == tool else e for e in old.values())
        if save:
            self.path.write_text("".join(
                f"T{e.id:<3d} P{self.held[e.id][0]:<3d} D{e.diameter:+f} Z{e.zoffset:+f} ;{self.held[e.id][1]}\n"
                for e in self.stat.tool_table[1:]))

    def __getattr__(self, _name: str) -> Any:
        return lambda *a, **k: None


def table_of(entries: Iterable[Any]) -> Tuple[Any, ...]:
    """A STAT.tool_table from home entries (index 0 an empty T0)."""
    return (entry(0),) + tuple(entries)


def settled_job(owner: Any, outcome: str = "not checked") -> Any:
    """A tool-table write's job with nothing to wait for — what a test that
    stands in for the reload (gateway._reload_tool_table) returns."""
    import gateway
    return gateway._ToolWriteJob(seq=-1, scan=None, owner=owner, outcome=outcome)


def nonrandom(testcase: Any) -> None:
    """The configuration's changer read as nonrandom without a tool database
    (rule R applies) for the test — a test's gateway has no INI to read it
    from (_tool_table_scope); restored after it."""
    import gateway
    saved = gateway._tool_table_scope
    gateway._tool_table_scope = lambda: None
    testcase.addCleanup(setattr, gateway, "_tool_table_scope", saved)
