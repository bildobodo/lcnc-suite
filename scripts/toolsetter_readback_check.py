#!/usr/bin/env python3
"""Live proof of the toolsetter basis read-back (M600 in the preview, plan
section 2; owed since Codex R104): a confirmed read takes the INTERPRETER's
values — task_plan_synch makes the interpreter write every line of the
parameter file from its own values (rs274ngc_pre.cc save_parameters), a new
inode proves the fresh file.

On a running SIM, never a machine — enforced before anything is sent
(Codex R118 VP-I73): the INI must be the one LinuxCNC runs, its name a
shipped simulator profile's (examples/sim_config/profiles.json), and its
kinematics, joints, coordinates and HAL files the shipped fixture's;
otherwise the check stops without connecting. One armed WS client,
heartbeats throughout. The check writes a scratch program `T1 M600` into a
dot folder of PROGRAM_PREFIX and loads it (only a loaded program that runs
the routine makes the gateway read back), and switches the task to MDI (in
AUTO, where a load leaves it, LinuxCNC takes no synch — Codex R118
VP-I71); nothing is run. Then:

  1. the start: every key `assumed` from the file, the read-back confirms them
  2. MDI `#3009 = <file value + 1.25>`: the interpreter holds the new value,
     the file still the old one — the gateway books #3009 `assumed` (the file's)
  3. the read-back at idle: a new inode, the file now holds the interpreter's
     value, the gateway books #3009 `read` with it; the published parse's
     toolsetter values follow
  4. the old value back by MDI and the same read-back

Rows print PASS / FAIL with what was measured. Ends by terminating the
verified instance's launcher (only it) while the client is still connected
(a client leaving a running sim trips the HAL watchdog's latch, which nobody
but the operator acknowledges; the check never acknowledges a trip).

    lcnc-gateway/.venv/bin/python scripts/toolsetter_readback_check.py <ini> <report.txt> [--keep-sim]
"""
import asyncio
import json
import os
import signal
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import linuxcnc
import msgspec
import websockets

s = linuxcnc.stat()
KEY = 3009
ROWS = []
SIM_CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "examples", "sim_config")


def ini_values(text):
    """Every value of each (SECTION, KEY), repeated HALFILE lines kept."""
    values, section = {}, ""
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].upper()
        elif "=" in line:
            key, value = line.split("=", 1)
            values.setdefault((section, key.strip().upper()), []).append(value.strip())
    return values


INTERPRETERS = {"python", "python3", "bash", "sh", "tclsh", "haltcl"}
SYSTEM_PREFIXES = ("/usr/", "/bin/", "/sbin/", "/lib/", "/opt/linuxcnc/")


def _loadusr_runs(words):
    """What a `loadusr` line starts, by halcmd's forms (`loadusr [-W | -Wn
    name | -w | -i] program [args]`; -Wn names the component to wait for,
    never the program — Codex R120): [("file", path)] for a program given as
    a path and for an interpreter's script (relative to the configuration,
    the working directory halcmd runs in), [("path", name)] for a program
    found on PATH. Raises ValueError on a form it does not know."""
    i = 1
    while i < len(words) and words[i].startswith("-"):
        if words[i] == "-Wn":
            i += 2
        elif words[i] in ("-W", "-w", "-i"):
            i += 1
        else:
            raise ValueError(f"loadusr option {words[i]} not known")
    if i >= len(words):
        raise ValueError("loadusr without a program")
    prog, rest = words[i], words[i + 1:]
    out = [("file", prog) if "/" in prog else ("path", prog)]
    if os.path.basename(prog) in INTERPRETERS:
        opts, script = [], None
        for w in rest:
            if not w.startswith("-"):
                script = w
                break
            opts.append(w)
        if script is None or "-m" in opts or "-c" in opts:
            raise ValueError(f"loadusr {prog} without a script file")
        out.append(("file", script))
    return out


def _runs(text):
    """What a halcmd text runs: ("file", path) for `source <file>` and the
    files a `loadusr` starts, ("path", name) for a program it finds on PATH."""
    for raw in text.splitlines():
        words = raw.split("#", 1)[0].split()
        if len(words) >= 2 and words[0] == "source":
            yield ("file", words[1])
        elif words and words[0] == "loadusr":
            yield from _loadusr_runs(words)


def validate_sim_target(ini, running_ini, sim_config=SIM_CONFIG, which=shutil.which):
    """Only a running shipped SIMULATOR (Codex R118/R119 VP-I73): the
    requested INI is the one LinuxCNC runs, its name a shipped profile's, the
    whole INI the shipped template as the installer renders it (only the
    per-install settings lines may differ — config_sync_check's rule; an
    extra HALCMD, another kinematics, a Python remap differ), and every file
    its HAL runs — HALFILE, POSTGUI_HALFILE, SHUTDOWN, each file one of them
    or a HALCMD `source`s, a program or interpreter script a `loadusr`
    starts (byte for byte) — the shipped template's file of that path; a
    program found on PATH must be the checkout's own (install.sh links the
    suite's scripts) or the system's. A file linked back into the checkout
    is the template by construction. A `loadusr` form it does not know is
    refused. Raises ValueError with the reason."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from config_sync_check import drifted_lines   # noqa: E402 (scripts/, the installer's rule)
    from install_examples import render_ini        # noqa: E402
    req = os.path.realpath(os.path.expanduser(ini))
    if not running_ini or req != os.path.realpath(os.path.expanduser(running_ini)):
        raise ValueError("the requested INI is not the one LinuxCNC runs")
    with open(os.path.join(sim_config, "profiles.json")) as f:
        names = [p["ini"] for p in json.load(f)["profiles"]]
    name = os.path.basename(req)
    if name not in names:
        raise ValueError(f"{name} is no shipped simulator profile")
    with open(req) as f:
        text = f.read()
    with open(os.path.join(sim_config, name)) as f:
        template = f.read()
    repo = Path(sim_config).resolve().parents[1]
    missing, local = drifted_lines(render_ini(template, template, repo), text, ini=True)
    if missing or local:
        ln = (local or missing)[0][1].strip()
        raise ValueError(f"not the shipped simulator: the INI differs ({ln})")
    got = ini_values(text)
    todo = [("file", v) for key in (("HAL", "HALFILE"), ("HAL", "POSTGUI_HALFILE"), ("HAL", "SHUTDOWN"))
            for v in got.get(key, [])]
    try:
        todo += [r for cmd in got.get(("HAL", "HALCMD"), []) for r in _runs(cmd)]
    except ValueError as e:
        raise ValueError(f"not the shipped simulator: {e}")
    base, seen = os.path.dirname(req), set()
    checkout = str(repo) + os.sep
    while todo:
        kind, rel = todo.pop(0)
        if (kind, rel) in seen:
            continue
        seen.add((kind, rel))
        if kind == "path":
            # a program on PATH: the checkout's own (install.sh links the
            # suite's scripts) or the system's, never another file
            found = which(rel)
            real = os.path.realpath(found) if found else ""
            if not (real.startswith(checkout) or real.startswith(SYSTEM_PREFIXES)):
                raise ValueError(f"not the shipped simulator: {rel} runs from {found or 'nowhere on PATH'}")
            continue
        if rel.startswith("LIB:"):
            continue                     # LinuxCNC's own library
        deployed = os.path.normpath(os.path.join(base, rel))
        shipped = os.path.normpath(os.path.join(sim_config, rel))
        if not os.path.isfile(shipped):
            raise ValueError(f"not the shipped simulator: its HAL runs {rel}, no shipped file")
        if not os.path.isfile(deployed):
            raise ValueError(f"not the shipped simulator: {rel} is missing")
        with open(deployed, errors="replace") as f:
            dtext = f.read()
        hal = rel.endswith((".hal", ".tcl"))
        if os.path.realpath(deployed) != os.path.realpath(shipped):
            if hal:
                with open(shipped, errors="replace") as f:
                    missing, local = drifted_lines(f.read(), dtext)
                if missing or local:
                    raise ValueError(f"not the shipped simulator: {rel} differs ({(local or missing)[0][1].strip()})")
            else:
                # a program or script it starts: byte for byte, no settings
                # line or comment exempt (Codex R120)
                with open(shipped, "rb") as a, open(deployed, "rb") as b:
                    if a.read() != b.read():
                        raise ValueError(f"not the shipped simulator: {rel} differs")
        if hal:
            try:
                todo += list(_runs(dtext))
            except ValueError as e:
                raise ValueError(f"not the shipped simulator: {rel}: {e}")


def launcher_pids(running_ini, ps_lines):
    """The pids of the launcher of exactly this instance: `bash …/lcnc-suite
    -ini <running_ini>`. `ps_lines` are `pgrep -a` lines; another instance's
    launcher, a shell holding the pattern in its command — none of them."""
    out = []
    for line in ps_lines:
        pid, _, cmd = line.strip().partition(" ")
        argv = cmd.split()
        if (len(argv) == 4 and argv[0] == "bash" and argv[1].endswith("/lcnc-suite")
                and argv[2] == "-ini" and argv[3] == running_ini):
            out.append(int(pid))
    return out


def row(name, ok, detail=""):
    ROWS.append((name, "PASS" if ok else "FAIL", detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


def ini_value(ini, section, key):
    sec = None
    for line in open(ini):
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            sec = line[1:-1]
        elif sec == section and "=" in line and line.split("=", 1)[0].strip() == key:
            return line.split("=", 1)[1].strip()
    return None


def var_value(path, key):
    """(inode, value) of one parameter in the file."""
    st = os.stat(path)
    with open(path) as f:
        for line in f:
            p = line.split()
            if len(p) >= 2 and p[0] == str(key):
                return st.st_ino, float(p[1])
    return st.st_ino, None


class Trace:
    """New lines of the suite's trace bus from now on."""

    def __init__(self, path):
        self.path = path
        self.pos = os.path.getsize(path)

    def new(self):
        out = []
        with open(self.path) as f:
            f.seek(self.pos)
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
            self.pos = f.tell()
        return out


class Gateway:
    def __init__(self, url, token, port):
        self.url, self.token, self.port = url, token, port
        self.replies, self.seq, self.status_frames = {}, 0, 0

    async def __aenter__(self):
        self.ws = await websockets.connect(self.url, max_size=None)
        self.task = asyncio.get_event_loop().create_task(self._reader())
        self.beat = asyncio.get_event_loop().create_task(self._beat())
        await self.cmd({"cmd": "hello"}, wait=False)
        t0 = time.monotonic()
        while self.status_frames < 3 and time.monotonic() - t0 < 30:
            await asyncio.sleep(0.1)
        r = await self.cmd({"cmd": "arm", "armed": True})
        if not r.get("ok"):
            raise SystemExit(f"arm refused: {r.get('error')}")
        return self

    async def __aexit__(self, *a):
        self.beat.cancel()
        self.task.cancel()
        try:
            await self.ws.close()
        except Exception:
            pass

    async def _beat(self):
        while True:
            try:
                await self.ws.send(json.dumps({"cmd": "heartbeat"}))
            except Exception:
                return
            await asyncio.sleep(0.8)

    async def _reader(self):
        try:
            async for raw in self.ws:
                try:
                    d = msgspec.msgpack.decode(raw) if isinstance(raw, (bytes, bytearray)) else json.loads(raw)
                except Exception:
                    continue
                if not isinstance(d, dict):
                    continue
                if d.get("type") == "status":
                    self.status_frames += 1
                if d.get("type") == "reply" and d.get("req_id"):
                    self.replies[d["req_id"]] = d
        except Exception:
            return

    async def cmd(self, obj, wait=True, timeout=60.0):
        self.seq += 1
        rid = f"tsr-{self.seq}"
        await self.ws.send(json.dumps({**obj, "req_id": rid}))
        if not wait:
            return None
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            if rid in self.replies:
                return self.replies.pop(rid)
            await asyncio.sleep(0.02)
        return {"ok": False, "error": "no reply"}

    def http(self, path):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", headers={"X-Auth-Token": self.token})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read()


def poll():
    s.poll()
    return s


async def wait_idle(timeout=60.0):
    t0 = time.monotonic()
    await asyncio.sleep(0.3)
    while time.monotonic() - t0 < timeout:
        if poll().interp_state == linuxcnc.INTERP_IDLE and s.queue == 0:
            return True
        await asyncio.sleep(0.05)
    return False


async def until(gw, cmd, ok, timeout=20.0):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if ok():
            return True
        await gw.cmd(cmd)
        t1 = time.monotonic()
        while time.monotonic() - t1 < 2.0 and not ok():
            await asyncio.sleep(0.1)
    return ok()


async def send(gw, obj, timeout=8.0):
    t0 = time.monotonic()
    while True:
        r = await gw.cmd(obj)
        if r.get("ok") or "busy" not in str(r.get("error")) or time.monotonic() - t0 > timeout:
            return r
        await asyncio.sleep(0.1)


async def wait_trace(trace, pred, timeout=60.0):
    """The first new trace event matching `pred`, else None."""
    seen = []
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        for ev in trace.new():
            seen.append(ev)
            if pred(ev):
                return ev, seen
        await asyncio.sleep(0.2)
    return None, seen


def payload_value(gw):
    """#KEY as the published parse read it (its toolsetter values)."""
    try:
        p = msgspec.msgpack.decode(gw.http("/preview"))
    except Exception as e:  # noqa: BLE001 — said in the row
        return f"no payload ({type(e).__name__})"
    tb = p.get("toolsetter_basis") or {}
    vals = tb.get("values") or {}
    return vals.get(str(KEY))


async def main(ini, report, keep_sim, running_ini):
    cfg = os.path.dirname(os.path.abspath(ini))
    token = ini_value(ini, "DISPLAY", "WEBUI_TOKEN") or ""
    port = int(ini_value(ini, "DISPLAY", "WEBUI_PORT") or 8000)
    var = os.path.join(cfg, ini_value(ini, "RS274NGC", "PARAMETER_FILE"))
    prefix = os.path.expanduser(ini_value(ini, "DISPLAY", "PROGRAM_PREFIX"))
    log_dir = ini_value(ini, "DISPLAY", "LOG_DIR") or os.path.join(
        os.path.dirname(os.path.realpath(ini_value(ini, "DISPLAY", "DISPLAY"))), "runlogs")
    trace = Trace(os.path.join(log_dir, "trace.ndjson"))
    scratch = os.path.join(prefix, ".ts-readback-check")
    os.makedirs(scratch, exist_ok=True)
    prog = os.path.join(scratch, "readback_m600.ngc")
    with open(prog, "w") as f:
        f.write("(toolsetter read-back check — loaded, never run)\nT1 M600\nM2\n")
    url = f"ws://127.0.0.1:{port}/ws" + (f"?token={token}" if token else "")
    try:
        async with Gateway(url, token, port) as gw:
            ok = (await until(gw, {"cmd": "estop_reset"}, lambda: poll().task_state != linuxcnc.STATE_ESTOP)
                  and await until(gw, {"cmd": "machine_on"}, lambda: poll().task_state == linuxcnc.STATE_ON))
            await asyncio.sleep(1.5)
            ok = ok and await until(gw, {"cmd": "home_all"}, lambda: all(poll().homed[:s.joints]) and s.inpos, timeout=120)
            row("setup: machine on and homed", ok)
            if not ok:
                return
            await asyncio.sleep(1.0)
            ino0, f0 = var_value(var, KEY)
            r = await send(gw, {"cmd": "load_file", "path": prog})
            row("load the scratch program (T1 M600, never run)", bool(r.get("ok")), str(r.get("error") or ""))
            # in AUTO (where the load leaves the task) LinuxCNC takes no synch
            r = await send(gw, {"cmd": "set_mode", "mode": linuxcnc.MODE_MDI})
            row("switch the task to MDI (the read-back is due outside AUTO)", bool(r.get("ok")), str(r.get("error") or ""))
            ev, _ = await wait_trace(trace, lambda e: e.get("tag") == "toolsetter.read_back", timeout=90)
            row("1 start: the read-back confirms the file's values",
                ev is not None and ev.get("state") == "confirmed",
                f"trace {ev and {k: ev.get(k) for k in ('version', 'state')}}; file #{KEY} = {f0}")
            if ev is None:
                return
            new = round(f0 + 1.25, 6)
            r = await send(gw, {"cmd": "mdi", "text": f"#{KEY} = {new}"})
            await wait_idle()
            ev, seen = await wait_trace(trace, lambda e: e.get("tag") == "toolsetter.basis" and e.get("origin") == "assumed"
                                        and KEY in (e.get("keys") or []), timeout=15)
            ino1, f1 = var_value(var, KEY)
            row(f"2 MDI #{KEY} = {new}: booked assumed, the file still the old value",
                bool(r.get("ok")) and ev is not None and f1 == f0,
                f"mdi ok={r.get('ok')}; trace assumed keys={ev and ev.get('keys')}; file #{KEY} = {f1} (inode {'same' if ino1 == ino0 else 'new'})")
            ev, seen = await wait_trace(trace, lambda e: e.get("tag") == "toolsetter.read_back", timeout=60)
            ino2, f2 = var_value(var, KEY)
            read = next((e for e in seen if e.get("tag") == "toolsetter.basis" and e.get("origin") == "read"
                         and KEY in (e.get("keys") or [])), None)
            row("3 read-back: a new inode, the file holds the interpreter's value, booked read",
                ev is not None and ev.get("state") == "confirmed" and ino2 != ino1 and f2 == new and read is not None,
                f"file #{KEY} = {f2} (inode {'new' if ino2 != ino1 else 'same'}); trace read keys={read and read.get('keys')}")
            v = None
            t0 = time.monotonic()
            while time.monotonic() - t0 < 60:
                v = payload_value(gw)
                if isinstance(v, (int, float)) and abs(v - new) < 1e-9:
                    break
                await asyncio.sleep(1.0)
            row("3b the published parse reads the confirmed value", isinstance(v, (int, float)) and abs(v - new) < 1e-9,
                f"payload toolsetter #{KEY} = {v}")
            r = await send(gw, {"cmd": "mdi", "text": f"#{KEY} = {f0}"})
            await wait_idle()
            ev, seen = await wait_trace(trace, lambda e: e.get("tag") == "toolsetter.read_back", timeout=60)
            ino3, f3 = var_value(var, KEY)
            row(f"4 the old value back (MDI #{KEY} = {f0}) and read back",
                bool(r.get("ok")) and ev is not None and ev.get("state") == "confirmed" and f3 == f0,
                f"file #{KEY} = {f3}")
            await send(gw, {"cmd": "unload_file"})
            await gw.cmd({"cmd": "arm", "armed": False})
            if not keep_sim:
                # the client stays connected while the sim goes down
                # the launcher is a bash script (its comm is `bash`): matched by
                # its command line from the start — a `bash -c` shell holding
                # the pattern in its own command does not start with it
                lines = subprocess.run(["pgrep", "-a", "-f", "/lcnc-suite -ini "], capture_output=True,
                                       text=True).stdout.splitlines()
                for pid in launcher_pids(running_ini, lines):
                    os.kill(pid, signal.SIGTERM)
                t0 = time.monotonic()
                while time.monotonic() - t0 < 30 and subprocess.run(["pgrep", "-x", "linuxcncsvr"],
                                                                    capture_output=True).returncode == 0:
                    await asyncio.sleep(0.5)
                row("teardown: the sim stopped with the client connected",
                    subprocess.run(["pgrep", "-x", "linuxcncsvr"], capture_output=True).returncode != 0)
    finally:
        try:
            os.remove(prog)
            os.rmdir(scratch)
        except OSError:
            pass
        with open(report, "w") as f:
            f.write(f"# toolsetter read-back check {time.strftime('%Y-%m-%d %H:%M:%S')} on {os.path.basename(ini)}\n")
            for name, verdict, detail in ROWS:
                f.write(f"{verdict}  {name}  {detail}\n")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    try:
        s.poll()
        running = s.ini_filename
    except linuxcnc.error as e:
        running = None
        print(f"no running LinuxCNC: {e}", flush=True)
    try:
        validate_sim_target(args[0], running)
    except ValueError as e:
        # before connecting, arming or resetting anything
        row("target: the running, shipped simulator", False, str(e))
        with open(args[1], "w") as f:
            f.write(f"# toolsetter read-back check {time.strftime('%Y-%m-%d %H:%M:%S')}: refused\n")
            for name, verdict, detail in ROWS:
                f.write(f"{verdict}  {name}  {detail}\n")
        sys.exit(1)
    row("target: the running, shipped simulator", True, os.path.basename(running))
    asyncio.run(main(args[0], args[1], "--keep-sim" in sys.argv, running))
    sys.exit(0 if ROWS and all(v == "PASS" for _, v, _ in ROWS) else 1)
