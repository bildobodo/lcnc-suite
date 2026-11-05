"""The real host of restore_lan (the VM's systemd user units, /proc, git,
the LAN gateway): every read the restore proves its points with. Impure by
design; the pure parts — the ExecStart line, the trace — are functions the
offline tests reach. Never imports linuxcnc or hal."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

from test_support.live_target import ini_values, read_procs

READY_URL = "http://127.0.0.1:8000/ready"
WS_URL = "ws://127.0.0.1:8000/ws"


def parse_exec_start(value: str) -> list[str]:
    """`systemctl show -p ExecStart --value`: `{ path=… ; argv[]=a b c ; …}` → argv."""
    start = value.index("argv[]=") + len("argv[]=")
    return value[start:value.index(" ;", start)].split()


def clients_since(trace_lines, pid: int, since: float) -> bool:
    """A loop.tick of gateway `pid` after `since` (wall seconds) with a client
    connected: the keepalive holds the returned instance's HAL heartbeat up."""
    for line in trace_lines:
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if (ev.get("tag") == "loop.tick" and ev.get("pid") == pid and ev.get("clients", 0) >= 1
                and ev.get("t_wall_ns", 0) / 1e9 > since):
            return True
    return False


def _hash_tree(path: Path) -> str:
    h = hashlib.sha256()
    if path.is_file():
        h.update(path.read_bytes())
    elif path.is_dir():
        for p in sorted(path.rglob("*")):
            if p.is_file() and not p.is_symlink():
                h.update(str(p.relative_to(path)).encode() + b"\0" + p.read_bytes())
    else:
        h.update(b"<absent>")
    return h.hexdigest()


class SystemHost:
    """`pre` (the recorded state) gives the INI and the tree once the LAN
    instance is stopped — no process names them then."""

    def __init__(self, pre: dict | None = None):
        self._ini = (pre or {}).get("ini")
        self._tree = (pre or {}).get("tree")

    # ── units ──
    def unit(self, name):
        out = subprocess.run(["systemctl", "--user", "show", name, "-p", "ExecStart", "-p", "WorkingDirectory",
                              "-p", "Environment", "--no-pager"], capture_output=True, text=True, check=True).stdout
        props = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
        return {"ExecStart": parse_exec_start(props["ExecStart"]), "WorkingDirectory": props.get("WorkingDirectory", ""),
                "Environment": props.get("Environment", "").split()}

    def is_active(self, name):
        return subprocess.run(["systemctl", "--user", "is-active", "-q", name]).returncode == 0

    def stop(self, name):
        subprocess.run(["systemctl", "--user", "stop", name], check=True)

    def start(self, name, spec):
        subprocess.run(["systemctl", "--user", "reset-failed", name], capture_output=True)
        cmd = ["systemd-run", "--user", f"--unit={name}", "-p", f"WorkingDirectory={spec['WorkingDirectory'] or '/'}"]
        cmd += [f"-E{e}" for e in spec.get("Environment", [])]
        subprocess.run(cmd + spec["ExecStart"], check=True, capture_output=True)
        for _ in range(50):
            if self.is_active(name):
                return
            time.sleep(0.1)
        raise RuntimeError(f"{name} is not active after its start")

    def wait_ready(self, timeout):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                with urllib.request.urlopen(READY_URL, timeout=2) as r:
                    if r.status in (200, 204):
                        return True
            except OSError:
                pass
            time.sleep(1)
        return False

    # ── the instance ──
    def lan_instance(self):
        for d in Path("/proc").glob("[0-9]*"):
            try:
                if (d / "comm").read_text().strip() == "linuxcncsvr":
                    start = int((d / "stat").read_text().rsplit(")", 1)[1].split()[19])
                    return ("linuxcncsvr", int(d.name), start)
            except (OSError, IndexError, ValueError):
                continue
        return ()

    def _launcher(self):
        for p in read_procs():
            c = p["cmdline"]
            if len(c) >= 4 and c[0].endswith("bash") and c[1].endswith("/lcnc-suite") and c[2] == "-ini":
                return p
        return None

    def gateway_ini(self):
        p = self._launcher()
        if p:
            self._ini = os.path.realpath(p["cmdline"][3])
            self._tree = str(Path(os.path.realpath(p["cmdline"][1])).parent)
        return self._ini

    def tree_dir(self):
        self.gateway_ini()
        return self._tree

    def tree_head(self):
        self.gateway_ini()
        if not self._tree:
            return None
        return subprocess.run(["git", "-C", self._tree, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()

    def file_hashes(self):
        home = Path.home()
        out = {"nc_files": _hash_tree(home / "linuxcnc/nc_files"), "macros": _hash_tree(home / "linuxcnc/macros")}
        if self._tree:
            out["settings"] = _hash_tree(Path(self._tree) / "lcnc-gateway/settings.json")
        if self._ini:
            out["config"] = _hash_tree(Path(self._ini).parent)
        return out

    # ── the LAN gateway's own state ──
    def lan_trip(self):
        """`safety_trip` of the LAN gateway's first full status, read by a
        disarmed hello-only client (the INI's token is sent, never printed)."""
        from urllib.parse import urlencode
        from websockets.sync.client import connect
        import msgspec
        token = (ini_values(Path(self.gateway_ini()).read_text()).get(("DISPLAY", "WEBUI_TOKEN")) or [""])[-1]
        with connect(WS_URL + ("?" + urlencode({"token": token}) if token else ""), max_size=None, close_timeout=2) as ws:
            ws.send(json.dumps({"cmd": "hello", "session": "native-stage-restore-probe"}))
            end = time.monotonic() + 10
            while time.monotonic() < end:
                raw = ws.recv(timeout=max(0.1, end - time.monotonic()))
                msg = msgspec.msgpack.decode(raw) if isinstance(raw, bytes) else json.loads(raw)
                if msg.get("type") == "status" and isinstance(msg.get("data"), dict):
                    return msg.get("safety_trip") or msg["data"].get("safety_trip")
        raise RuntimeError("the LAN gateway sent no status within 10 s")

    def keepalive_connected_since(self, since):
        gw = next((p for p in read_procs() if "gateway:app" in p["cmdline"]), None)
        if not gw or not self._tree:
            return False
        trace = Path(self._tree) / "runlogs/trace.ndjson"
        end = time.monotonic() + 15
        while time.monotonic() < end:
            try:
                with trace.open(errors="replace") as f:
                    f.seek(max(0, trace.stat().st_size - 2_000_000))
                    if clients_since(f, gw["pid"], since):
                        return True
            except OSError:
                pass
            time.sleep(1)
        return False
