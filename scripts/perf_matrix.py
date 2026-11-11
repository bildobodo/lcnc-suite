#!/usr/bin/env python3
"""Acceptance/characterization matrix harness (ISSUE_35 + PERFORMANCE handoff).

Drives repeatable load scenarios against a RUNNING lcnc-suite and extracts the
trace evidence for each into a per-commit JSON artifact — turning the ad-hoc
"load it and grep the trace" verification of the perf effort into regression
protection, and providing the characterization gate for the deeper
modularization (M2/M3/M6).

Headless scenarios (default set):
  idle_baseline        nothing but N viewers streaming for a window
  fanout               viewers (visible+hidden mix) streaming
  reconnect_storm      12 simultaneous WS connects (the multi-tab reload case)
  fusion_near_limit    near-cap tool-library import (preview route)
  rss_gc_watch         RSS sampling over a longer window

Opt-in (machine-state-touching; sim only):
  --allow-arm   enables: preview_publish (arms a client, load_file, measures
                spawn->publish), and the two protected writes — a write needs
                an ARMED connection since button gates BG-14 (armed_writer):
                upload_during_stream (max-size POST /upload, replacing
                perfmatrix-big.ngc, while viewers stream) and
                save_during_stream (max-size raw-body PUT /save while viewers
                stream)
  --allow-trip  enables: sigstop_trip (SIGSTOPs the gateway > oneshot budget,
                asserts the HAL latch TRIPS and STAYS latched through recovery
                of the heartbeat — the #34 property — then drives the operator
                recovery sequence ack->arm->reset and verifies the latch clears)

Metrics per scenario (from runlogs/trace.ndjson within the scenario's wall-time
window): lag.window count/max-drift/dominant, safety.* events, gcode.publish
stats, ws connects — plus per-scenario direct measurements (durations, sizes,
RSS). Caveat: [GC] and [HB-WAKE] gateway.log lines carry no wall time and are
NOT window-attributable; lag.window drift is the loop-stall metric here.

Verdict (exit 1, every reason on the RESULT line): a scenario whose own result
is no measurement (scenario_failure: an exception, an HTTP status outside 2xx,
an *_ok not True), a preview whose taken load_file did not publish the UPLOADED
program (origin.source = its sha256), and a window whose trace is not the
measured gateway's: each window posts a start and an end mark with the run's id
through /telemetry, and the trace must hold both, written by the gateway's pid
(trace_failure — a missing, empty, old or foreign trace read as "lag 0"). The
trace is read from THIS checkout's runlogs/: run the matrix from the tree the
running gateway was started from.

Artifacts: runlogs/perf-matrix/<utc>-<gitrev>.json  (one file per invocation)
"""
import argparse
import asyncio
import hashlib
import json
import os
import random
import re
import signal
import subprocess
import sys
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lcnc-gateway"))
import msgspec  # noqa: E402  (gateway venv)
import requests  # noqa: E402
import websockets  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TRACE = os.path.join(REPO, "runlogs", "trace.ndjson")
INI = os.environ.get("LCNC_INI_FILE",
                     "/home/cnc/linuxcnc/configs/lcnc_suite_sim/lcnc_suite_sim_3axis_xyz.ini")


def ini_get(key: str) -> str:
    with open(INI) as f:
        for line in f:
            m = re.match(rf"\s*{key}\s*=\s*(.+?)\s*$", line)
            if m:
                return m.group(1)
    return ""


TOKEN = os.environ.get("LCNC_WEBUI_TOKEN") or ini_get("WEBUI_TOKEN")
PORT = os.environ.get("LCNC_WEBUI_PORT") or ini_get("WEBUI_PORT") or "8000"
BASE = f"http://127.0.0.1:{PORT}"
WS_URL = f"ws://127.0.0.1:{PORT}/ws" + (f"?token={TOKEN}" if TOKEN else "")
HDRS = {"X-Auth-Token": TOKEN} if TOKEN else {}

#: one id per matrix run: every scenario window posts a start and an end mark
#: with it through /telemetry, and only marks of THIS run in the trace prove
#: the trace is the measured gateway's and was written during the window
#: (Codex R346 LC-04)
RUN_ID = uuid.uuid4().hex[:12]
REPLY_TIMEOUT_S = 15.0     # an arm / disarm reply
PUBLISH_TIMEOUT_S = 60.0   # load_file's reply, then its publication
STALE_NOTIFY_S = 1.5       # preview_publish: a connect-time ready frame lands first
SETTLE_S = 2.0             # preview_publish: rss_kb_after includes the publish state
TRACE_PAD_S = 3.5          # trailing pad: trip events land LATE via the reader pipeline (a 1 s pad produced a false pass)


def gateway_pid():
    out = subprocess.run(["pgrep", "-f", "[u]vicorn gateway:app"],
                         capture_output=True, text=True)
    pids = out.stdout.split()
    return int(pids[0]) if pids else None


def gateway_rss_kb(pid):
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("VmRSS"):
                    return int(line.split()[1])
    except OSError:
        return None
    return None


def halcmd_getp(pin: str):
    out = subprocess.run(["halcmd", "getp", pin], capture_output=True, text=True)
    return out.stdout.strip() if out.returncode == 0 else None


# ---- trace extraction ------------------------------------------------------

def trace_window(t0_ns: int, t1_ns: int, mark=None) -> dict:
    """Summarize trace events whose t_wall_ns falls inside [t0_ns, t1_ns].
    `mark` = (run id, scenario): the window's own marks (trace_mark) — which
    of them the trace holds and the pid that wrote them (trace_failure)."""
    lag = []
    safety = []
    publishes = []
    connects = 0
    marks, mark_pids = [], set()
    if not os.path.exists(TRACE):
        return {"error": "no trace file"}
    with open(TRACE, "rb") as f:
        for line in f:
            # cheap pre-filter before json
            if b'"t_wall_ns"' not in line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            tw = e.get("t_wall_ns")
            if not isinstance(tw, int) or not (t0_ns <= tw <= t1_ns):
                continue
            tag = e.get("tag", "")
            if tag == "lag.window":
                lag.append((e.get("drift_ms", 0),
                            str(e.get("dominant_phase", "?")).split(" peer=")[0]))
            elif tag.startswith("safety."):
                safety.append(tag)
            elif tag == "gcode.publish":
                publishes.append({k: e.get(k) for k in
                                  ("bytes", "bytes_gz", "gzip_ms", "total_ms")})
            elif tag == "ws.connect.accept":
                connects += 1
            elif tag == "browser.perfmatrix_mark" and mark is not None \
                    and (e.get("run"), e.get("scenario")) == tuple(mark):
                marks.append(e.get("at"))
                mark_pids.add(e.get("pid"))
    worst = max(lag, default=(0, None))
    return {
        "lag_windows": len(lag),
        "lag_max_drift_ms": round(worst[0], 1),
        "lag_max_dominant": worst[1],
        "safety_events": sorted(set(safety)) or [],
        "gcode_publishes": publishes,
        "ws_connects": connects,
        "marks": sorted(m for m in marks if isinstance(m, str)),
        "mark_pids": sorted(p for p in mark_pids if isinstance(p, int)),
    }


async def trace_mark(scenario: str, at: str) -> str:
    """Post this run's mark for `scenario` (`start` / `end`) to the gateway's
    /telemetry: it writes `browser.perfmatrix_mark` into ITS trace, with ITS
    pid. "ok", else why the gateway did not take it."""
    line = json.dumps({"kind": "perfmatrix_mark", "run": RUN_ID, "scenario": scenario, "at": at})
    try:
        r = await asyncio.to_thread(requests.post, f"{BASE}/telemetry", data=line.encode() + b"\n",
                                    headers={"Content-Type": "application/x-ndjson"}, timeout=10)
        body = r.json() if r.status_code == 200 else {}
    except Exception as e:  # noqa: BLE001 - the reason goes into the verdict
        return f"{type(e).__name__}: {e}"
    if r.status_code != 200 or body.get("events") != 1:
        return f"HTTP {r.status_code} {body}"
    return "ok"


def trace_failure(trace: dict, pid, sent) -> "str | None":
    """Why a window's trace is no measurement of the measured gateway, None
    when it is (Codex R346 LC-04): no trace file, or not both of this run's
    marks in the window — a trace another gateway writes, an empty or only an
    old one, would read as "lag 0" — or marks written by another process than
    the gateway whose RSS and pid the report names. A window with no lag event
    but both marks is a valid measurement."""
    if not trace:
        return None
    if trace.get("error"):
        return f"trace: {trace['error']} ({TRACE})"
    missing = [at for at in ("start", "end") if at not in trace.get("marks", [])]
    if missing:
        posts = "; ".join(f"{at} mark {s}" for at, s in zip(("start", "end"), sent) if s != "ok")
        return (f"trace: no {'/'.join(missing)} mark of run {RUN_ID} in {TRACE} — not the measured "
                f"gateway's trace, or not written" + (f" ({posts})" if posts else ""))
    if trace.get("mark_pids") != [pid]:
        return f"trace: the marks were written by pid {trace.get('mark_pids')}, the measured gateway is {pid}"
    return None


# ---- WS viewer client ------------------------------------------------------

LIVENESS_FAILED = False  # set by with_viewers when a scenario delivers 0 status frames
DELIVERY_FAILED = False  # set by preview_publish when the load never produces a publish
SCENARIO_FAILURES = {}   # scenario → why its own result is no measurement (scenario_failure)


class Viewer:
    """Minimal browser stand-in: hello + 1 Hz heartbeat + frame draining."""

    def __init__(self, name: str, hidden: bool = False):
        self.name = name
        self.hidden = hidden
        self.frames = 0
        self.status_frames = 0  # status/status_delta only — the liveness signal
        self.bytes = 0
        self.merged = {}
        self.armed_seen = None
        self.gcode_ready = False      # viewer_gcode / viewer_gcode_ready seen
        self.gcode_version = None     # latest viewer_gcode_ready version seen
        self.last_reply_error = None  # most recent reply ok=False error text
        self.conn_key = None          # the hello reply's key for protected HTTP writes (BG-14)
        self.replies = {}             # req_id → reply (request())
        self.ready = []               # every viewer_gcode_ready: version, file, origin source
        self._seq = 0
        self._ws = None
        self._tasks = []

    async def connect(self):
        self._ws = await websockets.connect(WS_URL, max_size=None)
        await self._ws.send(json.dumps(
            {"cmd": "hello", "session": f"perfmx-{self.name}", "resume_armed": False}))
        if self.hidden:
            await self._ws.send(json.dumps({"cmd": "tab_visibility", "hidden": True}))
        self._tasks = [asyncio.create_task(self._drain()),
                       asyncio.create_task(self._heartbeat())]

    async def _drain(self):
        try:
            async for raw in self._ws:
                self.frames += 1
                self.bytes += len(raw)
                if isinstance(raw, (bytes, bytearray)):
                    try:
                        msg = msgspec.msgpack.decode(raw)
                    except Exception:
                        continue
                else:
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue
                if msg.get("type") in ("status", "status_delta"):
                    self.status_frames += 1
                    self.merged.update(msg.get("data") or {})
                    if "armed" in msg:
                        self.armed_seen = msg["armed"]
                elif msg.get("type") in ("viewer_gcode", "viewer_gcode_ready"):
                    self.gcode_ready = True
                    if msg.get("version") is not None:
                        self.gcode_version = msg["version"]
                    if msg.get("type") == "viewer_gcode_ready":
                        origin = msg.get("origin") if isinstance(msg.get("origin"), dict) else {}
                        self.ready.append({"version": msg.get("version"), "file": msg.get("file"),
                                           "source": origin.get("source")})
                elif msg.get("type") == "reply":
                    if isinstance(msg.get("conn_key"), str) and msg["conn_key"]:
                        self.conn_key = msg["conn_key"]      # the hello reply (no req_id)
                    if msg.get("req_id") is not None:
                        self.replies[msg["req_id"]] = msg
                    if msg.get("ok") is False:
                        self.last_reply_error = msg.get("error")
        except Exception:
            pass

    async def _heartbeat(self):
        try:
            while True:
                await asyncio.sleep(1.0)
                await self._ws.send('{"cmd":"heartbeat"}')
        except Exception:
            pass

    async def send(self, obj: dict):
        await self._ws.send(json.dumps(obj))

    async def request(self, obj: dict, timeout: float):
        """Send `obj` with a req_id and return ITS reply (the gateway echoes
        the id on every reply path), None when none came within `timeout`."""
        self._seq += 1
        rid = f"pm-{self.name}-{self._seq}"
        await self.send({**obj, "req_id": rid})
        t_end = time.monotonic() + timeout
        while rid not in self.replies and time.monotonic() < t_end:
            await asyncio.sleep(0.02)
        return self.replies.pop(rid, None)

    async def close(self):
        for t in self._tasks:
            t.cancel()
        try:
            await self._ws.close()
        except Exception:
            pass


async def with_viewers(n: int, hidden_frac: float, body):
    viewers = [Viewer(f"v{i}", hidden=(i / max(1, n)) < hidden_frac) for i in range(n)]
    for v in viewers:
        await v.connect()
    try:
        result = await body(viewers)
    finally:
        for v in viewers:
            await v.close()
    status_rx = sum(v.status_frames for v in viewers)
    if isinstance(result, dict):
        result["status_rx"] = status_rx
    if status_rx == 0:
        global LIVENESS_FAILED
        LIVENESS_FAILED = True
        print("  LIVENESS FAIL: viewers received ZERO status frames — "
              "the fan-out is dead regardless of the perf numbers", flush=True)
        if isinstance(result, dict):
            result["LIVENESS_FAIL"] = True
    return result


@asynccontextmanager
async def armed_writer():
    """The headers of a protected HTTP write (/upload, /save — button gates
    BG-14): the token AND the X-Conn-Key of a connection armed for it. A write
    without one is refused 403 before its body is read, and a scenario that
    measures it measures an idle gateway (BG-14 4b226659, 2026-10-26: the
    first matrix after it, 2026-11-11 at f54f3120, got 403 in 6–62 ms and
    still answered 0). It ARMS a client: only under --allow-arm. Disarmed
    and closed after."""
    w = Viewer("writer")
    await w.connect()
    try:
        t0 = time.monotonic()
        while w.conn_key is None and time.monotonic() - t0 < 10:
            await asyncio.sleep(0.05)
        arm = await w.request({"cmd": "arm", "armed": True}, REPLY_TIMEOUT_S) if w.conn_key else None
        if not w.conn_key or not (arm or {}).get("ok"):
            raise RuntimeError(f"no armed writer: conn_key {'set' if w.conn_key else 'missing'}, "
                               f"arm reply {arm}")
        yield {**HDRS, "X-Conn-Key": w.conn_key}
    finally:
        try:
            await w.request({"cmd": "arm", "armed": False}, REPLY_TIMEOUT_S)
        except Exception:
            pass
        await w.close()


def scenario_failure(direct):
    """Why a scenario's own result is no measurement, None when it is: an
    exception, an HTTP write not taken (`status` / `*_status` outside 2xx),
    a property it asserts not held (`*_ok` not True). Each fails the run —
    before, all three printed and the matrix still answered 0."""
    if not isinstance(direct, dict) or "skipped" in direct:
        return None
    if direct.get("error"):
        return f"error: {direct['error']}"
    bad = [f"{k} {v}" for k, v in direct.items()
           if (k == "status" or k.endswith("_status")) and not (isinstance(v, int) and 200 <= v < 300)]
    bad += [f"{k} {v}" for k, v in direct.items() if k.endswith("_ok") and v is not True]
    return "; ".join(bad) or None


# ---- scenario helpers ------------------------------------------------------

def gen_gcode(path: str, target_mb: int):
    if os.path.exists(path) and abs(os.path.getsize(path) / 1e6 - target_mb) < 2:
        return
    rng = random.Random(42)
    with open(path, "w") as f:
        f.write("G21 G90\nT13 M600\nG0 X0 Y0 Z5\n")
        size = 0
        x = y = 0.0
        while size < target_mb * 1_000_000:
            x = (x + rng.random()) % 200
            y = (y + rng.random()) % 200
            line = f"G1 X{x:.3f} Y{y:.3f} Z-{rng.random():.3f} F1200\n"
            f.write(line)
            size += len(line)
        f.write("G0 Z5\nM2\n")


def scenario(name):
    def deco(fn):
        SCENARIOS[name] = fn
        return fn
    return deco


SCENARIOS = {}


@scenario("idle_baseline")
async def sc_idle(args):
    async def body(viewers):
        await asyncio.sleep(args.window)
        return {"viewer_frames": sum(v.frames for v in viewers)}
    return await with_viewers(2, 0.0, body)


@scenario("fanout")
async def sc_fanout(args):
    async def body(viewers):
        await asyncio.sleep(args.window)
        return {
            "viewers": len(viewers),
            "viewer_frames": sum(v.frames for v in viewers),
            "viewer_bytes": sum(v.bytes for v in viewers),
        }
    return await with_viewers(8, 0.5, body)


@scenario("reconnect_storm")
async def sc_storm(args):
    viewers = [Viewer(f"storm{i}") for i in range(12)]
    t0 = time.monotonic()
    await asyncio.gather(*(v.connect() for v in viewers))
    connect_ms = round((time.monotonic() - t0) * 1000)
    await asyncio.sleep(6)
    frames = sum(v.frames for v in viewers)
    for v in viewers:
        await v.close()
    return {"tabs": 12, "all_connected_ms": connect_ms, "frames_after_6s": frames}


@scenario("upload_during_stream")
async def sc_upload(args):
    if not args.allow_arm:
        return {"skipped": "needs --allow-arm (arms a writer + replaces perfmatrix-big.ngc)"}
    path = "/tmp/perfmatrix-big.ngc"
    gen_gcode(path, args.upload_mb)

    async with armed_writer() as hdrs:
        async def body(viewers):
            t0 = time.monotonic()
            with open(path, "rb") as f:
                # overwrite=1: the program of an earlier run is replaced, never a 409
                r = await asyncio.to_thread(
                    requests.post, f"{BASE}/upload", headers=hdrs, params={"overwrite": 1},
                    files={"file": ("perfmatrix-big.ngc", f)}, timeout=300)
            dur = round((time.monotonic() - t0) * 1000)
            await asyncio.sleep(2)
            return {"status": r.status_code, "upload_ms": dur,
                    "size_mb": round(os.path.getsize(path) / 1e6, 1),
                    "viewer_frames": sum(v.frames for v in viewers)}
        return await with_viewers(3, 0.0, body)


@scenario("save_during_stream")
async def sc_save(args):
    if not args.allow_arm:
        return {"skipped": "needs --allow-arm (arms a writer for the save)"}
    path = "/tmp/perfmatrix-big.ngc"
    gen_gcode(path, args.upload_mb)
    with open(path, "rb") as f:
        body_bytes = f.read()

    async with armed_writer() as hdrs:
        async def body(viewers):
            t0 = time.monotonic()
            r = await asyncio.to_thread(
                requests.put, f"{BASE}/save",
                params={"path": os.path.expanduser("~/linuxcnc/nc_files/perfmatrix-big.ngc")},
                headers={**hdrs, "Content-Type": "text/plain; charset=utf-8"},
                data=body_bytes, timeout=300)
            dur = round((time.monotonic() - t0) * 1000)
            await asyncio.sleep(2)
            return {"status": r.status_code, "save_ms": dur,
                    "size_mb": round(len(body_bytes) / 1e6, 1)}
        return await with_viewers(3, 0.0, body)


@scenario("fusion_near_limit")
async def sc_fusion(args):
    tools = [{"description": f"tool {i}",
              "geometry": {"DC": 6.0, "LCF": 20.0, "LB": 40.0, "SFDM": 6.0, "NOF": 2},
              "post-process": {"number": i, "diameter-offset": i},
              "type": "flat end mill", "unit": "millimeters", "BMC": "carbide"}
             for i in range(60000)]
    blob = json.dumps({"data": tools, "version": 1}).encode()
    t0 = time.monotonic()
    r = await asyncio.to_thread(
        requests.post, f"{BASE}/import-tool-library", headers=HDRS,
        files={"file": ("big.json", blob, "application/json")}, timeout=120)
    return {"status": r.status_code, "import_ms": round((time.monotonic() - t0) * 1000),
            "size_mb": round(len(blob) / 1e6, 1)}


@scenario("rss_gc_watch")
async def sc_rss(args):
    pid = gateway_pid()
    samples = []
    t_end = time.monotonic() + max(args.window, 60)
    while time.monotonic() < t_end:
        rss = gateway_rss_kb(pid)
        if rss:
            samples.append(rss)
        await asyncio.sleep(5)
    return {"rss_kb_first": samples[0] if samples else None,
            "rss_kb_last": samples[-1] if samples else None,
            "rss_kb_max": max(samples) if samples else None,
            "growth_kb": (samples[-1] - samples[0]) if len(samples) > 1 else 0}


@scenario("preview_publish")
async def sc_preview(args):
    if not args.allow_arm:
        return {"skipped": "needs --allow-arm (arms a client + load_file)"}
    path = "/tmp/perfmatrix-big.ngc"
    gen_gcode(path, args.upload_mb)
    # Defeat the gateway's parse cache: identical content re-serves the cached
    # payload (instant viewer_gcode_ready, NO gcode.publish event) and the
    # scenario would measure an idle gateway. A nonce comment after M2 changes
    # the content every run and forces a fresh parse+publish.
    with open(path, "a") as f:
        f.write(f"(perfmatrix nonce {time.time_ns()})\n")
    with open(path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()   # the publication's origin.source for THIS upload
    nc = os.path.expanduser("~/linuxcnc/nc_files/perfmatrix-big.ngc")
    # the nonce works only if the upload REPLACES the program: overwrite=1,
    # an armed writer, and its status in the result (scenario_failure)
    async with armed_writer() as hdrs:
        with open(path, "rb") as f:
            up = await asyncio.to_thread(
                requests.post, f"{BASE}/upload", headers=hdrs, params={"overwrite": 1},
                files={"file": ("perfmatrix-big.ngc", f)}, timeout=300)
    upload_status = up.status_code

    async def body(viewers):
        v = viewers[0]
        result = {"loaded": nc, "upload_status": upload_status, "source": sha[:16]}
        # arm and load each bound to ITS reply (Codex R346 LC-03): a refusal
        # or no reply is the scenario's failure, never outvoted by a version
        # change someone else's parse brings
        arm = await v.request({"cmd": "arm", "armed": True}, REPLY_TIMEOUT_S)
        result["arm_ok"] = bool(arm and arm.get("ok"))
        if not result["arm_ok"]:
            result["arm_error"] = (arm or {}).get("error", "no reply")
            return result
        try:
            # Let any connect-time cache-hit viewer_gcode_ready land first.
            await asyncio.sleep(STALE_NOTIFY_S)
            seen = len(v.ready)
            result["version_before"] = v.gcode_version
            t0 = time.monotonic()
            load = await v.request({"cmd": "load_file", "path": nc}, PUBLISH_TIMEOUT_S)
            result["load_ok"] = bool(load and load.get("ok"))
            if not result["load_ok"]:
                result["load_error"] = (load or {}).get("error", "no reply")
                return result
            # OUR publication: a ready frame whose origin is the uploaded
            # bytes (origin.source = sha256 of the program, None when the
            # file changed during the parse) — not merely another version.
            # Waiting for it, not a blind sleep: 9 of the first 17 runs never
            # published in-window, and rss_kb_after measured an idle gateway.
            own = None
            while own is None and time.monotonic() - t0 < PUBLISH_TIMEOUT_S:
                own = next((r for r in v.ready[seen:] if r["source"] == sha), None)
                if own is None:
                    await asyncio.sleep(0.2)
            result.update(delivered=own is not None, publish_wait_s=round(time.monotonic() - t0, 1),
                          version_after=own["version"] if own else None,
                          file_published=own["file"] if own else None,
                          other_ready=[r for r in v.ready[seen:] if r["source"] != sha][:3])
            if own is None:
                global DELIVERY_FAILED
                DELIVERY_FAILED = True
                result["DELIVERY_FAIL"] = True
                print(f"  DELIVERY FAIL: load_file was taken, but no viewer_gcode_ready of the uploaded "
                      f"program (source {sha[:16]}) within {PUBLISH_TIMEOUT_S:.0f} s — others: "
                      f"{result['other_ready']} — rss/lag numbers below measure an idle gateway", flush=True)
            else:
                await asyncio.sleep(SETTLE_S)
        finally:
            await v.request({"cmd": "arm", "armed": False}, REPLY_TIMEOUT_S)
        return result
    return await with_viewers(1, 0.0, body)


@scenario("sigstop_trip")
async def sc_trip(args):
    if not args.allow_trip:
        return {"skipped": "needs --allow-trip (trips the HAL safety latch)"}
    pid = gateway_pid()
    if not pid:
        return {"error": "no gateway pid"}
    res = {}
    res["latch_before"] = halcmd_getp("webui-hb-latch.fault-out")
    os.kill(pid, signal.SIGSTOP)
    await asyncio.sleep(0.9)          # > 0.5 s oneshot budget
    os.kill(pid, signal.SIGCONT)
    await asyncio.sleep(1.5)          # heartbeats resume; oneshot self-heals
    res["latch_after_resume"] = halcmd_getp("webui-hb-latch.fault-out")
    res["oneshot_after_resume"] = halcmd_getp("oneshot.0.out")
    # The #34 property: heartbeat recovery alone must NOT clear the latch.
    res["sticky_ok"] = (res["latch_after_resume"] == "TRUE")
    # Operator recovery: ack -> arm -> estop_reset, mirroring the UI order.
    v = Viewer("trip-recovery")
    await v.connect()
    try:
        await v.send({"cmd": "safety_trip_ack"})
        await asyncio.sleep(0.5)
        await v.send({"cmd": "arm", "armed": True})
        await asyncio.sleep(0.5)
        await v.send({"cmd": "estop_reset"})
        await asyncio.sleep(1.0)
        res["latch_after_reset"] = halcmd_getp("webui-hb-latch.fault-out")
        res["recovered_ok"] = (res["latch_after_reset"] == "FALSE")
        await v.send({"cmd": "arm", "armed": False})
    finally:
        await v.close()
    return res


# ---- runner -----------------------------------------------------------------

async def run(args):
    git_rev = subprocess.run(["git", "-C", REPO, "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True).stdout.strip()
    pid = gateway_pid()
    if not pid:
        print("FATAL: gateway not running", file=sys.stderr)
        return 2
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "git": git_rev,
        "run_id": RUN_ID,
        "trace": TRACE,
        "gateway_pid": pid,
        "scenarios": {},
    }
    names = args.scenarios or list(SCENARIOS)
    for name in names:
        fn = SCENARIOS.get(name)
        if not fn:
            print(f"unknown scenario: {name}", file=sys.stderr)
            continue
        print(f"── {name} ──", flush=True)
        rss0 = gateway_rss_kb(pid)
        t0_ns = time.time_ns()
        sent = [await trace_mark(name, "start")]
        try:
            direct = await fn(args)
        except Exception as e:
            direct = {"error": f"{type(e).__name__}: {e}"}
        sent.append(await trace_mark(name, "end"))
        await asyncio.sleep(TRACE_PAD_S)
        t1_ns = time.time_ns()
        entry = {
            "direct": direct,
            "trace": trace_window(t0_ns, t1_ns, (RUN_ID, name)) if "skipped" not in direct else {},
            "rss_kb_before": rss0,
            "rss_kb_after": gateway_rss_kb(pid),
            "window_s": round((t1_ns - t0_ns) / 1e9, 1),
        }
        report["scenarios"][name] = entry
        tr = entry["trace"]
        summary = (f"  lag: n={tr.get('lag_windows')} max={tr.get('lag_max_drift_ms')}ms "
                   f"({tr.get('lag_max_dominant')}) safety={tr.get('safety_events')}"
                   if tr else f"  {direct}")
        print(summary, flush=True)
        if direct.get("error"):
            print(f"  DIRECT ERROR: {direct['error']}", flush=True)
        why = "; ".join(w for w in (scenario_failure(direct), trace_failure(entry["trace"], pid, sent)) if w)
        if why:
            SCENARIO_FAILURES[name] = why
            entry["FAIL"] = why
            print(f"  SCENARIO FAIL: {why}", flush=True)
    outdir = os.path.join(REPO, "runlogs", "perf-matrix")
    os.makedirs(outdir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = os.path.join(outdir, f"{stamp}-{git_rev}.json")
    with open(out, "w") as f:
        json.dump(report, f, indent=1)
    print(f"\nartifact: {out}")
    # every reason, not the first one (a delivery failure hid the rest)
    reasons = []
    if LIVENESS_FAILED:
        reasons.append("(liveness) at least one scenario delivered zero status frames")
    if DELIVERY_FAILED:
        reasons.append("(delivery) preview_publish's upload was never published; its metrics are vacuous")
    reasons += [f"(scenario) {k}: {v}" for k, v in SCENARIO_FAILURES.items()]
    if reasons:
        print("RESULT: FAIL — " + " | ".join(reasons), flush=True)
        return 1
    print(f"RESULT: PASS (run {RUN_ID})", flush=True)
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scenarios", nargs="*",
                    help=f"subset to run (default: all). Known: {', '.join(SCENARIOS)}")
    ap.add_argument("--window", type=int, default=20, help="observation window seconds")
    ap.add_argument("--upload-mb", type=int, default=40, help="size of generated test file")
    ap.add_argument("--allow-arm", action="store_true",
                    help="enable scenarios that arm a client / load files (sim only)")
    ap.add_argument("--allow-trip", action="store_true",
                    help="enable the SIGSTOP HAL-latch trip scenario (sim only)")
    args = ap.parse_args()
    # it loads the machine and the sim like a gate: the ONE heavy lock (Codex R269)
    from test_support.heavy_lock import heavy_lock
    with heavy_lock("perf_matrix"):
        rc = asyncio.run(run(args))
    sys.exit(rc)


if __name__ == "__main__":
    main()
