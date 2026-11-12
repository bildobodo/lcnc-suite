"""The JSON value types of what arrives as JSON — a WS command's payload, a
settings document read from settings.json (package 2a, strict typing, Codex
R354 VM-I03). Exactly what json.loads makes: no Any, so the type check
follows every value to the narrowing the code does before it uses one.

Also the two conversions the payload checks need: float() / int() of a
value read off a payload or a status, with the SAME outcome as the builtins
for what arrives there — every JSON value, a status number, a numpy scalar
(a number, a numeric string, a bool, bytes and anything that declares
__float__ / __int__ / __index__ converts; None, a list, a dict, any other
object is float()'s / int()'s own TypeError) — typed, so a caller's except
(TypeError, ValueError) keeps meaning what it meant. Not the builtins for
every Python object: a memoryview (no JSON value) is a TypeError here.
Pure, stdlib only."""
from __future__ import annotations

from typing import Dict, List, SupportsFloat, SupportsIndex, SupportsInt, TypeAlias, Union

JsonValue: TypeAlias = Union[None, bool, int, float, str, List["JsonValue"], Dict[str, "JsonValue"]]
JsonObject: TypeAlias = Dict[str, JsonValue]


def to_float(value: object) -> float:
    """float(value), for a value of unknown type."""
    if isinstance(value, (str, bytes, bytearray, SupportsFloat, SupportsIndex)):
        return float(value)
    raise TypeError(f"float() argument must be a string or a real number, not '{type(value).__name__}'")


def to_int(value: object) -> int:
    """int(value), for a value of unknown type."""
    if isinstance(value, (str, bytes, bytearray, SupportsInt, SupportsIndex)):
        return int(value)
    raise TypeError(f"int() argument must be a string, a bytes-like object or a real number, "
                    f"not '{type(value).__name__}'")
