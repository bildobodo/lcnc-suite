"""Type stub of LinuxCNC's EMBEDDED `interpreter` module — it exists only inside
a parse (the rs274ngc interpreter's Python plugin, 2.9.4 interpmodule.cc /
interp_internal.hh), so no native name check reaches it outside one. Only the
members gcode_canon reads (package 2, typings/BOUNDARY.md): names from the
interpreter's setup / block / context structures as gcode_canon's own header
documents them (gcode_canon.py:34–37); gcode_canon reads every one through
int()/str() inside its own guards — a type here says what the code assumes,
the native parse corpus (test_*_worker.py through native_start_probe.py) is
what exercises it."""
from typing import Sequence

class _Remap:
    name: str

class _Block:
    x_flag: bool
    y_flag: bool
    z_flag: bool
    g_modes: Sequence[int]
    executing_remap: _Remap | None

class _Context:
    filename: str
    position: int

class _Interp:
    call_level: int
    remap_level: int
    filename: str
    sequence_number: int
    distance_mode: int
    feed_mode: int
    blocks: Sequence[_Block]
    sub_context: Sequence[_Context]

this: _Interp
