#!/usr/bin/env python3
"""The pinned Mozilla Firefox of the Firefox core (test strategy TS248-05,
plan vor-maschine R385): ONE release, named with its archives' SHA256 in
`lcnc-webui/e2e/firefox.json`, fetched into a cache outside the tree and
checked against that pin — never Playwright's bundled Firefox.

    fetch_firefox.py fetch            the archive of this machine's arch into
                                      ~/.cache/lcnc-suite/firefox/<version>-<arch>/,
                                      its SHA256 checked against the pin, unpacked
    fetch_firefox.py path             the binary of the pinned version, or exit 1
    fetch_firefox.py check-newer      REPORTS a newer release (product-details):
                                      current | newer <v> | unknown <why>; never
                                      changes the pin, never fails
    fetch_firefox.py pin <version>    a deliberate re-pin: SHA256SUMS and its
                                      signature (gpg, Mozilla's release key by
                                      fingerprint), the archives' sums into
                                      firefox.json — a commit with new references

`--json` prints a machine-readable result. A cache hit is taken only when its
marker names the pinned archive's SHA256; a path alone proves no version (the
run compares `browser.version()` itself, Codex R385).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
PIN = ROOT / "lcnc-webui/e2e/firefox.json"
CACHE = Path(os.environ.get("LCNC_FIREFOX_CACHE", Path.home() / ".cache/lcnc-suite/firefox"))
RELEASES = "https://archive.mozilla.org/pub/firefox/releases"
PRODUCT_DETAILS = "https://product-details.mozilla.org/1.0/firefox_versions.json"
LOCALE = "en-US"
#: Mozilla's release signing key (the primary key's fingerprint; SHA256SUMS
#: is signed by a subkey of it). A re-pin refuses any other signer.
RELEASE_KEY = "14F26682D0916CDD81E37B6D61B7B526D98F0353"
ARCHES = ("linux-aarch64", "linux-x86_64")
TIMEOUT_S = 20
#: the marker beside an unpacked binary: the archive SHA256 it came from
MARKER = "archive.sha256"

Get = Callable[[str], bytes]


class FetchError(Exception):
    """A step that did not hold — the message names it."""


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "lcnc-suite-fetch-firefox"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:   # noqa: S310 — https URLs only, from this file
        return r.read()


def this_arch() -> str:
    m = platform.machine()
    arch = {"aarch64": "linux-aarch64", "arm64": "linux-aarch64", "x86_64": "linux-x86_64", "amd64": "linux-x86_64"}.get(m.lower())
    if arch is None or sys.platform != "linux":
        raise FetchError(f"no pinned Firefox archive for {sys.platform}/{m}")
    return arch


def load_pin(pin: Path = PIN) -> dict:
    try:
        data = json.loads(pin.read_text())
    except (OSError, ValueError) as e:
        raise FetchError(f"the pin {pin} is not readable: {e}")
    for key in ("version", "archives", "signing_key_fingerprint"):
        if key not in data:
            raise FetchError(f"the pin names no {key}")
    return data


def archive_of(pin: dict, arch: str) -> dict:
    a = pin["archives"].get(arch)
    if not a or not re.fullmatch(r"[0-9a-f]{64}", a.get("sha256", "")) or not a.get("path"):
        raise FetchError(f"the pin {pin['version']} has no archive with a SHA256 for {arch}")
    return a


def cache_dir(pin: dict, arch: str, cache: Path = CACHE) -> Path:
    return cache / f"{pin['version']}-{arch}"


def binary(pin: dict, arch: str, cache: Path = CACHE) -> Path:
    """The pinned binary in the cache — only when its marker names the
    pinned archive's SHA256."""
    d = cache_dir(pin, arch, cache)
    exe = d / "firefox" / "firefox"
    marker = d / MARKER
    want = archive_of(pin, arch)["sha256"]
    if not exe.is_file() or not os.access(exe, os.X_OK):
        raise FetchError(f"no Firefox {pin['version']} binary at {exe} — run fetch_firefox.py fetch")
    got = marker.read_text().strip() if marker.is_file() else None
    if got != want:
        raise FetchError(f"{exe} is not from the pinned archive (marker {got!r}, pin {want}) — run fetch_firefox.py fetch")
    return exe


def fetch(pin: dict, arch: str, cache: Path = CACHE, get: Get = http_get) -> dict:
    """The pinned archive of `arch` into the cache: downloaded, its SHA256
    checked against the pin BEFORE it is unpacked, unpacked with the safe
    data filter, then marked. A cache hit is the marked binary."""
    a = archive_of(pin, arch)
    try:
        return {"cache": "hit", "binary": str(binary(pin, arch, cache)), "sha256": a["sha256"]}
    except FetchError:
        pass
    d = cache_dir(pin, arch, cache)
    d.mkdir(parents=True, exist_ok=True)
    url = f"{RELEASES}/{pin['version']}/{a['path']}"
    data = get(url)
    got = hashlib.sha256(data).hexdigest()
    if got != a["sha256"]:
        raise FetchError(f"{url}: SHA256 {got}, the pin names {a['sha256']} — nothing unpacked")
    if not hasattr(tarfile, "data_filter"):
        raise FetchError("this Python's tarfile has no data filter: the archive is not unpacked unfiltered")
    with tempfile.TemporaryDirectory(dir=d) as tmp:
        archive = Path(tmp) / Path(a["path"]).name
        archive.write_bytes(data)
        unpacked = Path(tmp) / "unpacked"
        with tarfile.open(archive) as tf:
            tf.extractall(unpacked, filter="data")
        if not (unpacked / "firefox" / "firefox").is_file():
            raise FetchError(f"{url}: the archive holds no firefox/firefox")
        shutil.rmtree(d / "firefox", ignore_errors=True)
        (d / MARKER).unlink(missing_ok=True)
        (unpacked / "firefox").rename(d / "firefox")
    (d / MARKER).write_text(a["sha256"] + "\n")
    return {"cache": "fetched", "binary": str(binary(pin, arch, cache)), "sha256": a["sha256"], "url": url}


def check_newer(pin: dict, get: Get = http_get) -> dict:
    """What Mozilla calls the latest release, against the pin: `current`,
    `newer` or `unknown` with its reason — a failed look-up is never
    `current`, and it never fails the caller."""
    try:
        latest = json.loads(get(PRODUCT_DETAILS))["LATEST_FIREFOX_VERSION"]
        if not isinstance(latest, str) or not re.fullmatch(r"\d+(\.\d+)*", latest):
            return {"status": "unknown", "why": f"an unreadable latest version {latest!r}"}
    except Exception as e:   # noqa: BLE001 — every failure of the look-up is "unknown", named
        return {"status": "unknown", "why": f"{type(e).__name__}: {e}"[:200]}

    def key(v: str) -> tuple[int, ...]:
        return tuple(int(x) for x in v.split("."))
    if key(latest) > key(pin["version"]):
        return {"status": "newer", "latest": latest, "pinned": pin["version"]}
    return {"status": "current", "latest": latest, "pinned": pin["version"]}


def verify_signature(sums: bytes, sig: bytes, key: bytes, fingerprint: str = RELEASE_KEY) -> str:
    """gpg verifies `sig` over `sums` in a throw-away keyring holding `key`;
    the VALIDSIG's primary key must be `fingerprint`. Returns the signing
    subkey's fingerprint."""
    with tempfile.TemporaryDirectory() as home:
        env = {**os.environ, "GNUPGHOME": home}
        h = Path(home)
        (h / "KEY").write_bytes(key)
        (h / "SUMS").write_bytes(sums)
        (h / "SUMS.asc").write_bytes(sig)
        imp = subprocess.run(["gpg", "--batch", "--import", str(h / "KEY")], env=env, capture_output=True, text=True)
        if imp.returncode:
            raise FetchError(f"gpg could not import the key: {imp.stderr.strip()[-200:]}")
        v = subprocess.run(["gpg", "--batch", "--status-fd", "1", "--verify", str(h / "SUMS.asc"), str(h / "SUMS")],
                           env=env, capture_output=True, text=True)
    valid = [line.split() for line in v.stdout.splitlines() if line.startswith("[GNUPG:] VALIDSIG ")]
    if v.returncode or not valid:
        raise FetchError(f"SHA256SUMS: no valid signature ({v.stderr.strip()[-200:]})")
    sub, primary = valid[0][2], valid[0][-1]
    if primary != fingerprint:
        raise FetchError(f"SHA256SUMS is signed by {primary}, not Mozilla's release key {fingerprint}")
    return sub


def make_pin(version: str, get: Get = http_get) -> dict:
    if not re.fullmatch(r"\d+(\.\d+)+", version):
        raise FetchError(f"not a release version: {version!r}")
    base = f"{RELEASES}/{version}"
    sums, sig, key = get(f"{base}/SHA256SUMS"), get(f"{base}/SHA256SUMS.asc"), get(f"{base}/KEY")
    subkey = verify_signature(sums, sig, key)
    lines = dict(reversed(line.split(maxsplit=1)) for line in sums.decode().splitlines() if line.strip())
    archives = {}
    for arch in ARCHES:
        path = f"{arch}/{LOCALE}/firefox-{version}.tar.xz"
        digest = lines.get(path)
        if not digest or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise FetchError(f"SHA256SUMS names no {path}")
        archives[arch] = {"path": path, "sha256": digest}
    return {"version": version, "source": base + "/", "signing_key_fingerprint": RELEASE_KEY,
            "signing_subkey": subkey, "locale": LOCALE, "archives": archives}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fetch")
    sub.add_parser("path")
    sub.add_parser("check-newer")
    p = sub.add_parser("pin")
    p.add_argument("version")
    a = ap.parse_args(argv)

    def say(result: dict, text: str) -> None:
        print(json.dumps(result) if a.json else text)
    try:
        if a.cmd == "pin":
            pin = make_pin(a.version)
            PIN.write_text(json.dumps(pin, indent=2) + "\n")
            say(pin, f"pinned Firefox {a.version} in {PIN.relative_to(ROOT)} — commit it with new references")
            return 0
        pin = load_pin()
        if a.cmd == "check-newer":
            r = check_newer(pin)
            say(r, f"{r['status']} {r.get('latest') or r.get('why', '')}".strip())
            return 0
        arch = this_arch()
        if a.cmd == "path":
            exe = binary(pin, arch)
            say({"binary": str(exe), "version": pin["version"], "arch": arch,
                 "sha256": archive_of(pin, arch)["sha256"]}, str(exe))
            return 0
        r = fetch(pin, arch)
        say({**r, "version": pin["version"], "arch": arch}, f"{r['cache']}: {r['binary']}")
        return 0
    except (FetchError, OSError, tarfile.TarError) as e:
        say({"error": str(e)}, f"fetch_firefox: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
