#!/usr/bin/env python3
"""settings.json persistence (gateway modularization, issue #33).

Owns the per-INI settings file: the read-modify-write lock (#24), the
parse-failure refuse-to-clobber guard, and a `version` counter the status loop
watches to push settings_changed. The current-INI key is INJECTED (it derives
from STAT, which this module must not import), as is an optional load-error
callback — so the module stays linuxcnc/trace-free and unit-testable.

The cache only ever holds a WRITTEN state (review round 7, UI-I12 rest A):
every change is prepared on a deep copy and becomes the cache only after
the file write succeeded. A failed write (disk full, the refuse-to-clobber
guard) leaves the cache — and so the next settings_init/settings_changed
blob — at the last stored state: the WebUI reads an equal section in that
blob as the confirmation of a page-hide (sendBeacon) save, so an unwritten
value in the cache would have been reported "Saved".

Device profiles (settings split, operator 2026-11-07, plan Codex R334–R337).
A setting is either the MACHINE's — one value for every client, saved only by
an armed writer — or a DEVICE's: every browser profile (per origin) has its
own, saved by that device without arm, by another device only armed. The
file keeps the machine sections where schema 1 had them (an older gateway
still reads them) and adds `_v2` per INI:

  _v2.template   the device sections a NEW device starts with — made once
                 from the schema-1 display sections and the macro bar, then
                 changed only explicitly; its simulation is always off
                 (operator OP1: every new device starts without it)
  _v2.devices    public id → {token_sha256, name, created, last_seen,
                 last_address, changed, sections, revs}
  _v2.revs       the machine sections' revisions

A device is known by a SECRET token (only its hash is stored) and shown by a
separate public id. Nothing removes a profile on its own (R337): a profile
leaves only by the explicit delete. Every save names the revision it was
made on (`base_rev`); a section another writer changed since is refused as
Stale with the current state — never merged, never retried here.
"""
import copy
import hashlib
import json
import secrets
import threading
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Callable, Deque, Dict, Iterable, List, Optional, Tuple, TypeGuard

from features import features_of, validate_features
from gateway_util import atomic_write_bytes
from json_types import JsonObject, JsonValue, to_int

# The machine's sections: one value for all clients, saved only by an armed
# writer (button gates Q2 / BG-19), acting in a client only once the server
# holds them. `macros` holds only the earlier MDI-line macros (kept as
# stored, never used again); the macro BAR is a device section (OP3).
# `features`: the switchable suite functions (package 3, features.py).
MACHINE_SECTIONS = frozenset({"machine", "toolsetter", "probe", "keyboard",
                              "gamepad", "mdi", "macros", "features"})

# A device's sections: how THIS browser looks and what it runs for itself.
# Its own device saves them without arm (the former display sections, the
# macro bar — OP3 — and the simulation switch).
DEVICE_SECTIONS = frozenset({"display", "viewer", "panels", "camera",
                             "macroBar", "simulation"})

# The device sections a client acts on only once the server HOLDS them (the
# others apply at once in the tab that changed them): a simulation switched
# on by a refused or stale save must never start the check.
CONFIRMED_DEVICE_SECTIONS = frozenset({"simulation"})

# Sections the client may persist (the save routes reject anything else).
VALID_SECTIONS = MACHINE_SECTIONS | DEVICE_SECTIONS

# The sections a save needs no arm for — its own device's. The ONE
# classification every save path (WS, HTTP, the page-hide beacon) asks.
FREE_SECTIONS = DEVICE_SECTIONS
PROTECTED_SECTIONS = MACHINE_SECTIONS

SIMULATION_OFF: JsonObject = {"enabled": False}
DEVICE_NAME_MAX = 40
_WRITES_KEPT = 32


def section_needs_arm(section: str) -> bool:
    """Does a save of `section` (on the writer's OWN device) need an armed
    writer? Unknown sections are refused before this by the VALID_SECTIONS
    check; treated as protected."""
    return section not in FREE_SECTIONS


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def valid_token(token: object) -> TypeGuard[str]:
    """A device token as the WebUI makes it: 32 hex digits (128 bits from
    crypto.getRandomValues)."""
    return (isinstance(token, str) and len(token) == 32
            and all(c in "0123456789abcdef" for c in token))


class UnknownDevice(LookupError):
    """No profile with that public id (or token)."""


class CorruptSettings(RuntimeError):
    """settings.json parsed, but a part the store reads has the wrong shape
    (an object where it needs one, a hash that is no string). A server-side
    failure like the refuse-to-clobber guard's RuntimeError — before 2a the
    same file failed with whatever AttributeError / TypeError the access hit."""


def _obj(value: JsonValue, where: str) -> JsonObject:
    """`value` as the JSON object the store needs, else CorruptSettings."""
    if isinstance(value, dict):
        return value
    raise CorruptSettings(f"settings.json: {where} is not an object")


class Stale(Exception):
    """The section changed since the save's base revision, by another writer.
    Carries the current state, so the client shows it at once."""
    def __init__(self, section: str, data: JsonValue, rev: int):
        super().__init__(f"{section} changed elsewhere — reloaded")
        self.section = section
        self.data = data
        self.rev = rev


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class SettingsStore:
    def __init__(self, path: Path, ini_key: Callable[[], str],
                 on_load_error: Optional[Callable[[Exception], None]] = None):
        self._path = path
        self._ini_key = ini_key
        self._on_load_error = on_load_error
        # Serializes RMW from BOTH the WS save path and the REST save/reset
        # routes (the latter not under _cmd_lock) — threading.Lock because the
        # guarded methods run in executor threads (#24).
        self._lock = threading.Lock()
        self._cache: Optional[Dict[str, JsonValue]] = None
        self._load_failed = False
        self.version = 0
        # Bumped when the device LIST changes (a new, renamed, deleted or
        # changed profile, a connect's last_seen) — the device views refresh.
        self.devices_version = 0
        # The writers of each section's recent revisions (this process only):
        # a save made on revision r passes when every write after r was the
        # saving writer's own (its own earlier save still in flight).
        self._writes: Dict[Tuple[str, str], Deque[Tuple[int, Optional[str]]]] = {}

    # ---- file ---------------------------------------------------------

    def _load_all(self) -> Dict[str, JsonValue]:
        """The full settings.json (all INI configs). A file that parses to
        anything but an object is a load failure like an unparsable one
        (the refuse-to-clobber guard below) — before 2a it was cached and
        every read failed on it."""
        if self._cache is not None:
            return self._cache
        if self._path.exists():
            try:
                with open(self._path, "r") as f:
                    data: JsonValue = json.load(f)
                    if not isinstance(data, dict):
                        raise CorruptSettings("settings.json: the file is not an object")
                    self._cache = data
                    self._load_failed = False
                    return data
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

    def _save_all(self, all_data: Dict[str, JsonValue]) -> None:
        if self._load_failed and self._path.exists():
            raise RuntimeError(
                "settings.json failed to parse and was not overwritten; "
                "fix or remove the file and restart the gateway"
            )
        atomic_write_bytes(str(self._path), json.dumps(all_data, indent=2).encode("utf-8"))
        self._cache = all_data

    # ---- schema 2 -----------------------------------------------------

    @staticmethod
    def _v2(entry: JsonObject) -> JsonObject:
        """The INI entry's device part, made from schema 1 on first use (on
        the copy being prepared — it reaches the file with the next write).
        Idempotent: an entry that has it is left alone."""
        found = entry.get("_v2")
        if isinstance(found, dict) and found.get("schema") == 2:
            return found
        template: JsonObject = {}
        for s in ("display", "viewer", "panels", "camera"):
            if s in entry:
                template[s] = copy.deepcopy(entry[s])
        macros = entry.get("macros")
        bar = macros.get("bar") if isinstance(macros, dict) else None
        if isinstance(bar, list):
            template["macroBar"] = {"bar": copy.deepcopy(bar)}
        template["simulation"] = dict(SIMULATION_OFF)
        v2: JsonObject = {"schema": 2, "template": template, "devices": {}, "revs": {}}
        entry["_v2"] = v2
        return v2

    def _entry(self, all_data: Dict[str, JsonValue]) -> JsonObject:
        return _obj(all_data.setdefault(self._ini_key(), {}), "this INI's entry")

    def _current(self) -> JsonObject:
        """The current INI's entry as cached (not a copy — read under the
        lock, never changed in place)."""
        return _obj(self._load_all().get(self._ini_key(), {}), "this INI's entry")

    def _read_entry(self) -> JsonObject:
        """The current INI's entry with its device part — a COPY (a read
        never writes; the migration lands with the next write)."""
        entry = copy.deepcopy(self._current())
        self._v2(entry)
        return entry

    @staticmethod
    def _devices(v2: JsonObject) -> JsonObject:
        return _obj(v2.get("devices"), "the device profiles")

    @staticmethod
    def _profile(v2: JsonObject, pid: str) -> Optional[JsonObject]:
        """The profile `pid`, None when there is none."""
        p = SettingsStore._devices(v2).get(pid)
        return None if p is None else _obj(p, f"device profile {pid}")

    @staticmethod
    def _fresh_device_sections(v2: JsonObject) -> JsonObject:
        sections = copy.deepcopy(_obj(v2.get("template"), "the device template"))
        sections["simulation"] = dict(SIMULATION_OFF)   # OP1, whatever the template says
        return sections

    @staticmethod
    def _profile_by_token(v2: JsonObject, token: str) -> Optional[str]:
        h = token_hash(token)
        for pid, p in SettingsStore._devices(v2).items():
            stored = _obj(p, f"device profile {pid}").get("token_sha256", "")
            if not isinstance(stored, str):
                raise CorruptSettings(f"settings.json: device profile {pid}'s token hash is not a string")
            if secrets.compare_digest(stored, h):
                return pid
        return None

    # ---- reads --------------------------------------------------------

    def load(self) -> Dict[str, JsonObject]:
        """The machine's sections of the current INI (what acts the same for
        every client — the spindle feedback, the toolsetter …): every section
        that is an object. One that is not (a save took any JSON value before
        2a — `machine: null` stopped the status loop of every client that
        connected) is left out, as if never saved."""
        with self._lock:
            entry = self._current()
            out: Dict[str, JsonObject] = {}
            for s in MACHINE_SECTIONS:
                value = entry.get(s)
                if isinstance(value, dict):
                    out[s] = copy.deepcopy(value)
            return out

    def load_section(self, section: str) -> JsonValue:
        """One MACHINE section of the current INI config — a copy read under
        the lock (P2: what a program start chooses and binds; a save in
        another thread lands before or after it, never half)."""
        with self._lock:
            return copy.deepcopy(self._current().get(section))

    def features(self) -> Dict[str, bool]:
        """The switches as they act now (features.features_of) — read under
        the lock, so a save lands before or after it, never half."""
        with self._lock:
            return features_of(self._current().get("features"))

    def view_for(self, device_id: Optional[str]) -> JsonObject:
        """What one client sees, flat as schema 1 (the client's sections keep
        their names): the machine's sections and its device's — the
        template's for an unbound client. `revs` names each section's
        revision, `device` the profile ({"id": None} = not bound)."""
        with self._lock:
            entry = self._read_entry()
            v2 = _obj(entry["_v2"], "the device part")
            settings: JsonObject = {s: entry[s] for s in MACHINE_SECTIONS if s in entry}
            macros = settings.get("macros")
            if isinstance(macros, dict):
                settings["macros"] = {k: v for k, v in macros.items() if k != "bar"}
            machine_revs = _obj(v2.get("revs"), "the machine revisions")
            revs: JsonObject = {s: to_int(machine_revs.get(s, 0)) for s in MACHINE_SECTIONS}
            profile = self._profile(v2, device_id) if device_id else None
            device: JsonObject
            if profile is not None:
                settings.update(_obj(profile.get("sections"), f"device {device_id}'s sections"))
                profile_revs = _obj(profile.get("revs", {}), f"device {device_id}'s revisions")
                revs.update({s: to_int(profile_revs.get(s, 0)) for s in DEVICE_SECTIONS})
                device = {"id": device_id, "name": profile.get("name", "")}
            else:
                settings.update(self._fresh_device_sections(v2))
                revs.update({s: 0 for s in DEVICE_SECTIONS})
                device = {"id": None, "name": ""}
            return {"settings": settings, "revs": revs, "device": device}

    def find_device(self, token: object) -> Optional[str]:
        """The public id of the profile this token belongs to — None for an
        unknown or malformed token. Never creates one."""
        if not valid_token(token):
            return None
        with self._lock:
            return self._profile_by_token(_obj(self._read_entry()["_v2"], "the device part"), token)

    def list_devices(self) -> List[JsonObject]:
        """Every profile of this INI as the device list shows it — never the
        token's hash. A simulation section that is not an object reads as
        OFF: a device saves its own sections without arm and the save takes
        any JSON value, so `null` there is a state a client can make (it
        failed the whole list before 2a)."""
        with self._lock:
            v2 = _obj(self._read_entry()["_v2"], "the device part")
            out: List[JsonObject] = []
            for pid, raw in self._devices(v2).items():
                p = _obj(raw, f"device profile {pid}")
                sim = _obj(p.get("sections", {}), f"device {pid}'s sections").get("simulation")
                revs = _obj(p.get("revs", {}), f"device {pid}'s revisions")
                out.append({"id": pid, "name": p.get("name", ""), "created": p.get("created"),
                            "last_seen": p.get("last_seen"), "last_address": p.get("last_address"),
                            "changed": bool(p.get("changed")),
                            "simulation": isinstance(sim, dict) and bool(sim.get("enabled")),
                            "simulation_rev": to_int(revs.get("simulation", 0))})
            return out

    # ---- writes -------------------------------------------------------

    def bind(self, token: str, address: Optional[str],
             claim: Optional[Callable[[str], None]] = None) -> Tuple[str, bool]:
        """The profile of a connecting device: its public id and whether it
        was made now. An unknown token makes a NEW profile from the template
        (simulation off); a known one records the connect (last seen, last
        address). `claim(pid)` runs under this lock right after the write —
        the connection holds the profile from then on, and a delete (whose
        admission asks who holds it, under the same lock) sees it (Codex R338
        SS-I04: the binding used to land after the lock, and a delete in the
        gap left a bound connection without a profile). Raises ValueError for
        a malformed token, the write's error when the file cannot be written
        (the client then stays unbound)."""
        if not valid_token(token):
            raise ValueError("malformed device token")
        with self._lock:
            all_data = copy.deepcopy(self._load_all())
            v2 = self._v2(self._entry(all_data))
            devices = self._devices(v2)
            pid = self._profile_by_token(v2, token)
            created = pid is None
            if pid is None:
                pid = secrets.token_hex(8)
                while pid in devices:
                    pid = secrets.token_hex(8)
                devices[pid] = {
                    "token_sha256": token_hash(token), "name": "", "created": _now(),
                    "last_seen": None, "last_address": None, "changed": False,
                    "sections": self._fresh_device_sections(v2), "revs": {},
                }
            p = _obj(devices[pid], f"device profile {pid}")
            p["last_seen"] = _now()
            p["last_address"] = address if isinstance(address, str) else None
            self._save_all(all_data)
            if claim is not None:
                claim(pid)
            self.devices_version += 1
            return pid, created

    def _stale(self, key: Tuple[str, str], current: int, base_rev: int,
               writer: Optional[str]) -> bool:
        if current == base_rev:
            return False
        if base_rev > current:
            return True
        writes = self._writes.get(key)
        if not writes or writes[0][0] > base_rev + 1:
            return True          # the writes since base are not all known here
        return any(rev > base_rev and (writer is None or w != writer) for rev, w in writes)

    def _book(self, key: Tuple[str, str], rev: int, writer: Optional[str]) -> None:
        q = self._writes.setdefault(key, deque(maxlen=_WRITES_KEPT))
        q.append((rev, writer))

    def save_section(self, section: str, data: JsonValue, *, device: Optional[str] = None,
                     base_rev: object = None, writer: Optional[str] = None,
                     admit: Optional[Callable[[], None]] = None,
                     admit_state: Optional[Callable[[JsonObject, JsonObject], None]] = None) -> int:
        """Persist one section; returns its new revision. `device` None = a
        MACHINE section, else that profile's DEVICE section. `base_rev`: the
        revision the change was made on — a section changed since by another
        writer raises Stale with its current state (`writer`: the saving
        connection's key; a save after its own earlier one passes). Prepared
        on a copy: the cache changes only once the write succeeded. `admit`:
        the write's admission, called under the lock right before the write —
        it raises to refuse, and a refusal writes and bumps nothing (button
        gates BG-24, Codex R211: a check before the lock is stale by the time
        a preceding writer lets go). `admit_state(before, after)`: a machine
        save's check of the machine's sections as they are and as they would
        be (package 3: the switches' transitions and the one cross-section
        rule), called right after `admit`, raising to refuse."""
        if device is None and section not in MACHINE_SECTIONS:
            raise ValueError(f"{section} is a device section")
        if device is not None and section not in DEVICE_SECTIONS:
            raise ValueError(f"{section} is a machine section")
        if not isinstance(base_rev, int) or isinstance(base_rev, bool) or base_rev < 0:
            raise ValueError("save without its base revision — reload the page")
        if not isinstance(data, dict):
            # every section the WebUI saves is an object; a null or a list
            # stored here failed its readers (the device list, the status loop)
            raise ValueError(f"{section}: settings are an object — reload the page")
        if section == "features":
            validate_features(data)
        with self._lock:
            all_data = copy.deepcopy(self._load_all())
            entry = self._entry(all_data)
            v2 = self._v2(entry)
            profile: Optional[JsonObject] = None
            if device is None:
                revs, scope = _obj(v2.get("revs"), "the machine revisions"), "machine"
            else:
                profile = self._profile(v2, device)
                if profile is None:
                    raise UnknownDevice(device)
                revs, scope = _obj(profile.setdefault("revs", {}), f"device {device}'s revisions"), device
            key = (scope, section)
            current = to_int(revs.get(section, 0))
            if self._stale(key, current, base_rev, writer):
                now = (entry.get(section) if profile is None
                       else _obj(profile.get("sections"), f"device {device}'s sections").get(section))
                raise Stale(section, copy.deepcopy(now), current)
            listed = False          # does the device LIST show the change?
            before: Optional[JsonObject] = None
            if profile is None:
                before = {s: copy.deepcopy(entry[s]) for s in MACHINE_SECTIONS if s in entry}
                entry[section] = data
            else:
                _obj(profile.get("sections"), f"device {device}'s sections")[section] = data
                listed = not profile.get("changed") or section == "simulation"
                profile["changed"] = True
            revs[section] = current + 1
            if admit is not None:
                admit()
            if admit_state is not None and before is not None:   # a machine save (device None)
                admit_state(before, {s: entry[s] for s in MACHINE_SECTIONS if s in entry})
            self._save_all(all_data)
            self._book(key, current + 1, writer)
            self.version += 1
            if listed:
                self.devices_version += 1
            return current + 1

    @staticmethod
    def _bump_all(revs: JsonObject, sections: Iterable[str]) -> None:
        """Every section's next revision — on the copy, BEFORE the write (the
        file holds them); booked as an anonymous write after it."""
        for s in sections:
            revs[s] = to_int(revs.get(s, 0)) + 1

    def _book_all(self, revs: JsonObject, scope: str, sections: Iterable[str]) -> None:
        for s in sections:
            self._book((scope, s), to_int(revs[s]), None)

    def reset_device(self, device: str, admit: Optional[Callable[[], None]] = None) -> None:
        """A device's sections back to the template (simulation off); its
        name stays."""
        with self._lock:
            all_data = copy.deepcopy(self._load_all())
            v2 = self._v2(self._entry(all_data))
            profile = self._profile(v2, device)
            if profile is None:
                raise UnknownDevice(device)
            profile["sections"] = self._fresh_device_sections(v2)
            revs = _obj(profile.setdefault("revs", {}), f"device {device}'s revisions")
            self._bump_all(revs, DEVICE_SECTIONS)
            if admit is not None:
                admit()
            self._save_all(all_data)
            self._book_all(revs, device, DEVICE_SECTIONS)
            self.version += 1
            self.devices_version += 1

    def rename_device(self, device: str, name: object, admit: Optional[Callable[[], None]] = None) -> None:
        name = name.strip() if isinstance(name, str) else ""
        if len(name) > DEVICE_NAME_MAX:
            raise ValueError(f"A device name has at most {DEVICE_NAME_MAX} characters")
        with self._lock:
            all_data = copy.deepcopy(self._load_all())
            v2 = self._v2(self._entry(all_data))
            profile = self._profile(v2, device)
            if profile is None:
                raise UnknownDevice(device)
            profile["name"] = name
            profile["changed"] = True     # a rename is a write accepted for it (R337 "never changed")
            if admit is not None:
                admit()
            self._save_all(all_data)
            self.version += 1
            self.devices_version += 1

    def delete_device(self, device: str, admit: Optional[Callable[[], None]] = None) -> None:
        """The ONE way a profile leaves (R337: never on its own). `admit`
        refuses a profile that is connected — decided under this lock, so a
        save racing the delete lands before it or is refused after it."""
        with self._lock:
            all_data = copy.deepcopy(self._load_all())
            v2 = self._v2(self._entry(all_data))
            devices = self._devices(v2)
            if device not in devices:
                raise UnknownDevice(device)
            del devices[device]
            if admit is not None:
                admit()
            self._save_all(all_data)
            for key in [k for k in self._writes if k[0] == device]:
                del self._writes[key]
            self.version += 1
            self.devices_version += 1
