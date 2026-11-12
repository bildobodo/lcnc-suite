"""Type stub of LinuxCNC 2.9.4's `gcode` module, the rs274ngc interpreter's
Python entry (src/emc/rs274ngc/gcodemodule.cc, v2.9.4; package 2, plan
vor-maschine R352/R353 VM352-03). Every method METH_VARARGS (positional
only, no keywords). parse tries "sOO!|s:new-parse" (an initcode LIST) first,
then the legacy "sO|sss:parse"; it returns PyTuple(result, last sequence
number) and raises RuntimeError / KeyboardInterrupt ("Load aborted").
MIN_ERROR is INTERP_MIN_ERROR (3 on the installed module), MAX_ERROR -1."""
from typing import Final, overload

class linecode: ...

MIN_ERROR: Final = 3
MAX_ERROR: Final = -1

@overload
def parse(f: str, callback: object, initcodes: list[str], interpname: str = ..., /) -> tuple[int, int]: ...
@overload
def parse(f: str, callback: object, unitcode: str = ..., initcode: str = ..., interpname: str = ..., /
          ) -> tuple[int, int]: ...
def strerror(err: int, /) -> str: ...
def arc_to_segments(canon: object, x1: float, y1: float, cx: float, cy: float, rot: int, z1: float,
                    a: float, b: float, c: float, u: float, v: float, w: float, max_segments: int = 128, /
                    ) -> list[tuple[float, float, float, float, float, float, float, float, float]]: ...
def calc_extents(*items: object) -> list[list[float]]: ...
