"""The pinned Firefox's fetch (scripts/fetch_firefox.py, plan vor-maschine
R385 A): an archive is unpacked only with the pinned SHA256, a cache hit only
with its marker, a look-up for a newer release is `unknown` on every failure,
a re-pin only with Mozilla's release key. No network: every download is a
fake, the signatures come from throw-away keys."""
from __future__ import annotations

import hashlib
import io
import json
import socket
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_firefox as ff  # noqa: E402

VERSION = "160.0"


def archive(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:xz") as tf:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o755
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


GOOD = archive({"firefox/firefox": b"#!/bin/sh\necho fake\n", "firefox/application.ini": b"[App]\n"})


def pin_for(data: bytes, arch: str = "linux-aarch64") -> dict:
    return {"version": VERSION, "signing_key_fingerprint": ff.RELEASE_KEY,
            "archives": {arch: {"path": f"{arch}/en-US/firefox-{VERSION}.tar.xz",
                                "sha256": hashlib.sha256(data).hexdigest()}}}


def serve(data: bytes):
    calls: list[str] = []

    def get(url: str) -> bytes:
        calls.append(url)
        return data
    return get, calls


def test_the_shipped_pin_names_both_arches_with_sums():
    pin = ff.load_pin()
    for arch in ff.ARCHES:
        a = ff.archive_of(pin, arch)
        assert a["path"] == f"{arch}/en-US/firefox-{pin['version']}.tar.xz"
    assert pin["signing_key_fingerprint"] == ff.RELEASE_KEY


def test_a_wrong_sum_unpacks_nothing(tmp_path):
    pin = pin_for(GOOD)
    get, _ = serve(GOOD + b"tampered")
    with pytest.raises(ff.FetchError, match="SHA256 .* the pin names"):
        ff.fetch(pin, "linux-aarch64", tmp_path, get)
    d = ff.cache_dir(pin, "linux-aarch64", tmp_path)
    assert not (d / "firefox").exists() and not (d / ff.MARKER).exists()


def test_the_pinned_archive_is_unpacked_and_then_a_cache_hit(tmp_path):
    pin = pin_for(GOOD)
    get, calls = serve(GOOD)
    r = ff.fetch(pin, "linux-aarch64", tmp_path, get)
    assert r["cache"] == "fetched" and Path(r["binary"]).is_file()
    assert calls == [f"{ff.RELEASES}/{VERSION}/linux-aarch64/en-US/firefox-{VERSION}.tar.xz"]
    again = ff.fetch(pin, "linux-aarch64", tmp_path, get)
    assert again["cache"] == "hit" and len(calls) == 1


def test_a_binary_without_the_pinned_marker_is_no_hit(tmp_path):
    pin = pin_for(GOOD)
    get, calls = serve(GOOD)
    ff.fetch(pin, "linux-aarch64", tmp_path, get)
    (ff.cache_dir(pin, "linux-aarch64", tmp_path) / ff.MARKER).write_text("0" * 64 + "\n")
    with pytest.raises(ff.FetchError, match="not from the pinned archive"):
        ff.binary(pin, "linux-aarch64", tmp_path)
    assert ff.fetch(pin, "linux-aarch64", tmp_path, get)["cache"] == "fetched" and len(calls) == 2


def test_a_missing_arch_is_named(tmp_path):
    pin = pin_for(GOOD, "linux-aarch64")
    get, calls = serve(GOOD)
    with pytest.raises(ff.FetchError, match="no archive with a SHA256 for linux-x86_64"):
        ff.fetch(pin, "linux-x86_64", tmp_path, get)
    assert calls == []


def test_an_archive_reaching_outside_is_refused(tmp_path):
    evil = archive({"firefox/firefox": b"x", "../evil": b"x"})
    pin = pin_for(evil)
    get, _ = serve(evil)
    with pytest.raises(tarfile.TarError):
        ff.fetch(pin, "linux-aarch64", tmp_path / "cache", get)
    assert not (tmp_path / "cache" / "evil").exists() and not (tmp_path / "evil").exists()


@pytest.mark.parametrize("failure, why", [
    (OSError("network unreachable"), "OSError"),
    (socket.timeout("timed out"), "timed out"),
    (b"not json", "JSONDecodeError"),
    (json.dumps({"LATEST_FIREFOX_VERSION": "latest"}).encode(), "unreadable latest version"),
    (json.dumps({"OTHER": "1"}).encode(), "KeyError"),
])
def test_a_failed_look_up_is_unknown_never_current(failure, why):
    def get(url: str) -> bytes:
        if isinstance(failure, BaseException):
            raise failure
        return failure
    r = ff.check_newer({"version": VERSION}, get)
    assert r["status"] == "unknown" and why in r["why"]


@pytest.mark.parametrize("latest, status", [("160.0", "current"), ("160.0.1", "newer"), ("161.0", "newer"), ("159.0", "current")])
def test_the_look_up_reports_only(latest, status):
    r = ff.check_newer({"version": VERSION}, lambda url: json.dumps({"LATEST_FIREFOX_VERSION": latest}).encode())
    assert r["status"] == status and r["pinned"] == VERSION


# ── the re-pin's signature ───────────────────────────────────────────────
def gpg(home: Path, *args: str, data: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["gpg", "--batch", "--homedir", str(home), "--pinentry-mode", "loopback",
                           "--passphrase", "", *args], input=data, capture_output=True, check=True)


@pytest.fixture(scope="module")
def keys(tmp_path_factory):
    """Two throw-away signing keys: their exports and primary fingerprints."""
    out = {}
    for name in ("mozilla", "other"):
        home = tmp_path_factory.mktemp(f"gpg-{name}")
        home.chmod(0o700)
        gpg(home, "--quick-gen-key", f"{name} <{name}@example.invalid>", "ed25519", "sign", "never")
        fpr = [line.split(":")[9] for line in gpg(home, "--with-colons", "--list-keys").stdout.decode().splitlines()
               if line.startswith("fpr:")][0]
        out[name] = {"home": home, "fpr": fpr, "key": gpg(home, "--armor", "--export").stdout}
    return out


def signed(keys, name: str, data: bytes) -> bytes:
    return gpg(keys[name]["home"], "--armor", "--detach-sign", data=data).stdout


def test_a_signature_of_the_release_key_is_taken(keys):
    sums = b"abc  linux-aarch64/en-US/firefox-160.0.tar.xz\n"
    sub = ff.verify_signature(sums, signed(keys, "mozilla", sums), keys["mozilla"]["key"], keys["mozilla"]["fpr"])
    assert sub == keys["mozilla"]["fpr"]


def test_another_signer_is_refused(keys):
    sums = b"abc  linux-aarch64/en-US/firefox-160.0.tar.xz\n"
    with pytest.raises(ff.FetchError, match="not Mozilla's release key"):
        ff.verify_signature(sums, signed(keys, "other", sums), keys["other"]["key"], keys["mozilla"]["fpr"])


def test_a_signature_over_other_sums_is_refused(keys):
    sums = b"abc  linux-aarch64/en-US/firefox-160.0.tar.xz\n"
    sig = signed(keys, "mozilla", sums)
    with pytest.raises(ff.FetchError, match="no valid signature"):
        ff.verify_signature(sums + b"def  evil\n", sig, keys["mozilla"]["key"], keys["mozilla"]["fpr"])


def test_a_pin_needs_every_arch(monkeypatch):
    sums = f"{'a' * 64}  linux-aarch64/en-US/firefox-{VERSION}.tar.xz\n".encode()
    monkeypatch.setattr(ff, "verify_signature", lambda *a, **k: "SUB")
    with pytest.raises(ff.FetchError, match="names no linux-x86_64"):
        ff.make_pin(VERSION, lambda url: sums)
