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


def settable_wd(shown: str) -> str:
    """`systemctl show`'s WorkingDirectory in the form `systemd-run -p` takes:
    it SHOWS a missing-ok folder as "!<dir>" but SETS it as "-<dir>"
    (measured; "!" is refused) — empty is "/"."""
    if not shown:
        return "/"
    return "-" + shown[1:] if shown.startswith("!") else shown


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
        cmd = ["systemd-run", "--user", f"--unit={name}", "-p", f"WorkingDirectory={settable_wd(spec['WorkingDirectory'])}"]
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

    def unit_owns(self, unit, pid):
        """The process lives in the unit's own cgroup (R286 FI-I21: not the
        first linuxcncsvr found anywhere)."""
        try:
            return f"/{unit}.service" in Path(f"/proc/{pid}/cgroup").read_text()
        except OSError:
            return False

    def remove_tree(self, tree, of):
        if not Path(tree).exists():
            subprocess.run(["git", "-C", str(of), "worktree", "prune"], check=True, capture_output=True)
            return
        r = subprocess.run(["git", "-C", str(of), "worktree", "remove", "--force", str(tree)],
                           capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(r.stderr.strip() or f"git worktree remove exited {r.returncode}")

    def unit_status(self, unit):
        """systemd's view of the unit in ONE query (R289 FI-I19 B): LoadState,
        ActiveState, the InvocationID (kept by a failed unit too), its
        command and folder, and the pids of its cgroup tree. A failed query
        raises — unknown is never "not running"."""
        out = subprocess.run(["systemctl", "--user", "show", unit, "-p", "LoadState", "-p", "ActiveState",
                              "-p", "InvocationID", "-p", "ControlGroup", "-p", "ExecStart", "-p", "WorkingDirectory",
                              "--no-pager"], capture_output=True, text=True, check=True).stdout
        props = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
        if not props.get("LoadState") or not props.get("ActiveState"):
            raise RuntimeError(f"systemctl show {unit}: no LoadState / ActiveState")
        pids = []
        if props.get("ControlGroup"):
            for procs in Path("/sys/fs/cgroup" + props["ControlGroup"]).rglob("cgroup.procs"):
                try:
                    pids += [int(x) for x in procs.read_text().split()]
                except FileNotFoundError:
                    continue                # a sub-cgroup removed while read
        return {"load": props["LoadState"], "active": props["ActiveState"],
                "invocation": props.get("InvocationID") or None,
                "exec": parse_exec_start(props["ExecStart"]) if props.get("ExecStart") else [],
                "wd": props.get("WorkingDirectory", ""), "pids": pids}

    def unit_instance(self, unit):
        """The linuxcncsvr in the unit's own cgroup: (name, pid, start ticks), or None."""
        for d in Path("/proc").glob("[0-9]*"):
            try:
                if (d / "comm").read_text().strip() == "linuxcncsvr" and \
                        f"/{unit}.service" in (d / "cgroup").read_text():
                    return ("linuxcncsvr", int(d.name), int((d / "stat").read_text().rsplit(")", 1)[1].split()[19]))
            except (OSError, IndexError, ValueError):
                continue
        return None

    def process_alive(self, pid, start):
        """The process `pid` with that start time still exists (a reused pid is another process)."""
        try:
            return int(Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]) == start
        except (OSError, IndexError, ValueError):
            return False

    def keepalive_heartbeat_since(self, since, unit="bg-keepalive"):
        """A FRESH heartbeat of THE recorded keepalive at the RETURNED gateway
        (R287 FI-I21; a TCP connection and another counted client are none):
        its beat file (written on every pong — the gateway's answer to a
        heartbeat) names the unit's MainPID, its pongs grow after `since`,
        and its TCP pair ends at the returned gateway's process."""
        spec = self.unit(unit)
        script = next((a for a in spec["ExecStart"] if a.endswith(".py")), None)
        if not script:
            return False
        beat = Path(script).with_suffix(".beat.json")
        end = time.monotonic() + 20
        seen = None
        while time.monotonic() < end:
            main = subprocess.run(["systemctl", "--user", "show", unit, "-p", "MainPID", "--value"],
                                  capture_output=True, text=True).stdout.strip()
            try:
                b = json.loads(beat.read_text())
            except (OSError, ValueError):
                b = None
            gw = next((p for p in read_procs() if "gateway:app" in p["cmdline"]), None)
            if b and gw and str(b.get("pid")) == main and b.get("t_wall", 0) > since:
                if seen is not None and b["pongs"] > seen and self._pair(int(main), b["local_port"], gw["pid"]):
                    return True
                seen = b["pongs"] if seen is None else seen
            time.sleep(1.5)
        return False

    @staticmethod
    def _pair(client_pid, local_port, gateway_pid):
        """The TCP connection 127.0.0.1:local_port ↔ 127.0.0.1:8000: its client
        end held by the keepalive, its server end by the returned gateway."""
        out = subprocess.run(["ss", "-Htnp", "state", "established"], capture_output=True, text=True).stdout
        client = server = False
        for line in out.splitlines():
            if f"127.0.0.1:{local_port} " in line and "127.0.0.1:8000" in line:
                cols = line.split()
                local, peer = cols[2], cols[3]
                if local.endswith(f":{local_port}") and f"pid={client_pid}," in line:
                    client = True
                if local.endswith(":8000") and peer.endswith(f":{local_port}") and f"pid={gateway_pid}," in line:
                    server = True
        return client and server
