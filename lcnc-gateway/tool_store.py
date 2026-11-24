#!/usr/bin/env python3
"""tool_library.json persistence (gateway modularization, issue #33).

Owns the mtime-cached read of the per-INI tool-metadata sidecar (the status loop
reads it on every tool-number change × connected client, so caching matters) and
the strict refuse-to-clobber write. The current-INI key (STAT-derived) and a
trace callback are INJECTED, so the module stays linuxcnc/trace-free and
unit-testable. Logic extracted verbatim from gateway.py; behavior unchanged. The
tool.tbl format helpers live in tool_table.py.
"""
import json
import threading
from typing import Callable, Optional, Tuple

from gateway_util import atomic_write_bytes


class ToolLibraryUnreadable(ValueError):
    """The tool library could not be read (strict read, P6 "tool files
    read"): a reader that names it instead of showing cached or empty
    metadata as the library."""


class ToolLibraryStore:
    def __init__(self, path, ini_key: Callable[[], str],
                 on_error: Optional[Callable[[str, str, Exception], None]] = None,
                 seed_path: Optional[Callable] = None):
        self._path = path
        self._ini_key = ini_key
        self._on_error = on_error            # (event, level, exc) -> None
        # (the file's signature, data): inode, mtime in ns and size — an mtime
        # alone repeats within the filesystem's timestamp tick (ext4: a jiffy),
        # and a write in that tick was served from the cache (P6 tool files read)
        self._cache: Optional[Tuple[Tuple[int, int, int], dict]] = None
        self._seed_path = seed_path
        self._seed_cache = None
        # Guards _cache + the file RMW. Once the gateway offloads load()/save()
        # to executor threads (B3), the status hot path can read concurrently
        # with a WS tool-command write — without this lock that races the mtime
        # cache and the read-modify-write. threading.Lock (not asyncio) because
        # the guarded methods run in executor threads, like SettingsStore.
        self._lock = threading.Lock()

    def _emit(self, event: str, level: str, e: Exception) -> None:
        if self._on_error is not None:
            self._on_error(event, level, e)

    def _load_all(self, strict: bool = False) -> dict:
        """Full tool_library.json (all INI configs), mtime-cached. Hot path:
        the status loop calls load() on every tool-number change per client.
        Keyed by (inode, mtime_ns, size): catches UI edits and external edits.
        `strict`: a failed stat, read or parse raises ToolLibraryUnreadable
        instead of answering the last cached data or {}."""
        if not self._path.exists():
            self._cache = None
            return {}
        try:
            st = self._path.stat()
            sig = (st.st_ino, st.st_mtime_ns, st.st_size)
        except OSError as e:
            self._emit("tool_lib.stat_failed", "warn", e)
            if strict:
                raise ToolLibraryUnreadable(f"not read ({e.strerror})") from None
            return self._cache[1] if self._cache else {}
        if self._cache is not None and self._cache[0] == sig:
            return self._cache[1]
        try:
            with open(self._path, "r") as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            self._emit("tool_lib.corrupt", "error", e)
            if strict:
                raise ToolLibraryUnreadable(f"not JSON (line {e.lineno})") from None
            return self._cache[1] if self._cache else {}
        except OSError as e:
            self._emit("tool_lib.read_failed", "warn", e)
            if strict:
                raise ToolLibraryUnreadable(f"not read ({e.strerror})") from None
            return self._cache[1] if self._cache else {}
        if strict and not isinstance(data, dict):
            raise ToolLibraryUnreadable(f"top level is {type(data).__name__}, not an object")
        self._cache = (sig, data)
        return data

    def _save_all(self, all_data: dict) -> None:
        atomic_write_bytes(str(self._path), json.dumps(all_data, indent=2).encode("utf-8"))
        self._cache = None  # invalidate; next read re-loads with fresh mtime

    def load(self, strict: bool = False) -> dict:
        """Tool metadata for the current INI config.

        Migrates the old flat format (top-level keys that look like tool numbers)
        by wrapping it under the current INI key once. Lock-guarded so a
        concurrent save() (different executor thread) can't tear the cache.
        `strict` (the Tools tab's read, P6 "tool files read"): an unreadable
        file, a section or a seed that is not an object raise
        ToolLibraryUnreadable — never the cached rows or {} as the library."""
        with self._lock:
            all_data = self._load_all(strict)
            ini = self._ini_key()
            if all_data and not any(k.startswith("/") for k in all_data) and any(k.isdigit() for k in all_data):
                all_data = {ini: all_data}
                self._save_all(all_data)
            if ini in all_data:
                if strict and not isinstance(all_data[ini], dict):
                    raise ToolLibraryUnreadable(f"section is {type(all_data[ini]).__name__}, not an object")
                return all_data[ini]  # An explicitly saved empty table stays empty.
            # Fresh example installations carry geometry beside their tool.tbl.
            # Never overlay a saved library, including legacy flat libraries.
            path = self._seed_path() if self._seed_path else None
            if path is None or not path.is_file():
                return {}
            try:
                key = (str(path), path.stat().st_mtime_ns)
                if self._seed_cache is None or self._seed_cache[0] != key:
                    data = json.loads(path.read_text())
                    if not isinstance(data, dict):
                        raise ValueError('Tool metadata seed must be an object')
                    self._seed_cache = (key, data)
                return self._seed_cache[1]
            except (OSError, ValueError) as e:
                self._emit('tool_lib.seed_failed', 'warn', e)
                if strict:
                    raise ToolLibraryUnreadable(f"seed not read ({e})") from None
                return {}

    def save(self, library: dict, *, ini_key: Optional[str] = None) -> None:
        """Persist tool metadata for the current INI config.

        Strict re-read (raises on any I/O / parse failure) rather than the cached
        read — a stale {} would overwrite the file and wipe every other INI's
        entries. Lock-guarded so the read-modify-write is atomic against a
        concurrent load()/save() on another executor thread."""
        with self._lock:
            if self._path.exists():
                with open(self._path, "r") as f:
                    all_data = json.load(f)
                if not isinstance(all_data, dict):
                    raise RuntimeError(
                        f"{self._path} top-level is {type(all_data).__name__}, "
                        "expected dict — refusing to overwrite"
                    )
            else:
                all_data = {}
            # A reviewed import binds its destination before executor dispatch.
            # A configuration switch must not redirect that write to another INI.
            all_data[self._ini_key() if ini_key is None else ini_key] = library
            self._save_all(all_data)
