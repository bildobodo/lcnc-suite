#!/usr/bin/env python3
"""settings.json persistence (gateway modularization, issue #33).

Owns the per-INI settings file: the read-modify-write lock (#24), the
parse-failure refuse-to-clobber guard, and a `version` counter the status loop
watches to push settings_changed. The current-INI key is INJECTED (it derives
from STAT, which this module must not import), as is an optional load-error
callback — so the module stays linuxcnc/trace-free and unit-testable. Logic
extracted verbatim from gateway.py; behavior unchanged.

The cache only ever holds a WRITTEN state (review round 7, UI-I12 rest A):
every change is prepared on a deep copy and becomes the cache only after
the file write succeeded. A failed write (disk full, the refuse-to-clobber
guard) leaves the cache — and so the next settings_init/settings_changed
blob — at the last stored state: the WebUI reads an equal section in that
blob as the confirmation of a page-hide (sendBeacon) save, so an unwritten
value in the cache would have been reported "Saved".
"""
import copy
import json
import threading
from typing import Callable, Optional

from gateway_util import atomic_write_bytes

# Sections the client may persist (the save routes reject anything else).
VALID_SECTIONS = {"macros", "machine", "viewer", "camera", "mdi", "gamepad",
                  "probe", "toolsetter", "keyboard", "display", "panels"}


class SettingsStore:
    def __init__(self, path, ini_key: Callable[[], str],
                 on_load_error: Optional[Callable[[Exception], None]] = None):
        self._path = path
        self._ini_key = ini_key
        self._on_load_error = on_load_error
        # Serializes RMW from BOTH the WS save path and the REST save/reset
        # routes (the latter not under _cmd_lock) — threading.Lock because the
        # guarded methods run in executor threads (#24).
        self._lock = threading.Lock()
        self._cache: Optional[dict] = None
        self._load_failed = False
        self.version = 0

    def _load_all(self) -> dict:
        """The full settings.json (all INI configs)."""
        if self._cache is not None:
            return self._cache
        if self._path.exists():
            try:
                with open(self._path, "r") as f:
                    self._cache = json.load(f)
                    self._load_failed = False
                    return self._cache
            except Exception as e:
                # Parse failure: cache {} so reads degrade gracefully, but flag
                # it so WRITES are blocked — overwriting a corrupt file with one
                # section would wipe every other INI's settings, and the file may
                # be hand-recoverable.
                self._load_failed = True
                if self._on_load_error is not None:
                    self._on_load_error(e)
        self._cache = {}
        return self._cache

    def _save_all(self, all_data: dict) -> None:
        if self._load_failed and self._path.exists():
            raise RuntimeError(
                "settings.json failed to parse and was not overwritten; "
                "fix or remove the file and restart the gateway"
            )
        atomic_write_bytes(str(self._path), json.dumps(all_data, indent=2).encode("utf-8"))
        self._cache = all_data

    def load(self) -> dict:
        """Settings for the current INI config."""
        return self._load_all().get(self._ini_key(), {})

    def save_section(self, section: str, data) -> None:
        """Persist one section for the current INI config; bumps version.
        Prepared on a copy: the cache changes only once the write succeeded."""
        with self._lock:
            all_data = copy.deepcopy(self._load_all())
            ini = self._ini_key()
            all_data.setdefault(ini, {})[section] = data
            self._save_all(all_data)
            self.version += 1

    def reset(self) -> None:
        """Drop all settings for the current INI config; bumps version.
        Prepared on a copy: the cache changes only once the write succeeded."""
        with self._lock:
            all_data = copy.deepcopy(self._load_all())
            ini = self._ini_key()
            if ini in all_data:
                del all_data[ini]
                self._save_all(all_data)
            self.version += 1
