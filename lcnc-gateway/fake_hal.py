"""A pure-Python stand-in for the ``hal`` binding — for driving hal_watchdog.py
and hal_reader.py as real subprocesses in tests (no LinuxCNC needed).

Every pin/param write is appended as a JSON line to the file named by
``FAKE_HAL_JOURNAL`` so a test can assert what the helper did to HAL (e.g.
"a rejected connect wrote nothing"). ``get_value`` raises for every pin,
mirroring a config where the reader's snapshot pins are absent — the reader
logs them missing and keeps serving, which is the behaviour under test here.
"""
import json
import os
import time

HAL_BIT, HAL_FLOAT, HAL_S32, HAL_U32 = 1, 2, 3, 4
HAL_IN, HAL_OUT, HAL_IO = 16, 32, 48

_JOURNAL = os.environ.get("FAKE_HAL_JOURNAL", "")


def _journal(kind: str, name: str, value) -> None:
    if not _JOURNAL:
        return
    with open(_JOURNAL, "a") as f:
        f.write(json.dumps({"t": time.monotonic(), "kind": kind, "name": name, "value": value}) + "\n")


class component:
    def __init__(self, name: str):
        self.name = name
        self.pins = {}

    def newpin(self, name, typ, dirn):
        self.pins[name] = False if typ == HAL_BIT else 0

    def ready(self):
        pass

    def __getitem__(self, key):
        return self.pins[key]

    def __setitem__(self, key, value):
        self.pins[key] = value
        _journal("pin", f"{self.name}.{key}", value)

    def exit(self):
        pass


def get_value(name: str):
    raise RuntimeError(f"Can't get value: pin / param {name} not found")


def set_p(name: str, value: str):
    _journal("set_p", name, value)


def get_info_pins():
    return []


def get_info_signals():
    return []


def get_info_params():
    return []
