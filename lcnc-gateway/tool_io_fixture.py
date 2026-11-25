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
