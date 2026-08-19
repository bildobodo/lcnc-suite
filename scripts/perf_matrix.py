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
  upload_during_stream max-size POST /upload while viewers stream
  save_during_stream   max-size raw-body PUT /save while viewers stream
  fusion_near_limit    near-cap tool-library import (preview route)
  rss_gc_watch         RSS sampling over a longer window

Opt-in (machine-state-touching; sim only):
  --allow-arm   enables: preview_publish (arms a client, load_file, measures
                spawn->publish)
  --allow-trip  enables: sigstop_trip (SIGSTOPs the gateway > oneshot budget,
                asserts the HAL latch TRIPS and STAYS latched through recovery
                of the heartbeat — the #34 property — then drives the operator
                recovery sequence ack->arm->reset and verifies the latch clears)

Metrics per scenario (from runlogs/trace.ndjson within the scenario's wall-time
window): lag.window count/max-drift/dominant, safety.* events, gcode.publish
stats, ws connects — plus per-scenario direct measurements (durations, sizes,
RSS). Caveat: [GC] and [HB-WAKE] gateway.log lines carry no wall time and are
NOT window-attributable; lag.window drift is the loop-stall metric here.

Artifacts: runlogs/perf-matrix/<utc>-<gitrev>.json  (one file per invocation)
"""
import argparse
import asyncio
import json
import os
import random
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lcnc-gateway"))
import msgspec  # noqa: E402  (gateway venv)
import requests  # noqa: E402
import websockets  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TRACE = os.path.join(REPO, "runlogs", "trace.ndjson")
INI = os.environ.get("LCNC_INI_FILE",
                     "/home/cnc/linuxcnc/configs/lcnc_suite_sim/lcnc_suite_sim.ini")


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

def trace_window(t0_ns: int, t1_ns: int) -> dict:
    """Summarize trace events whose t_wall_ns falls inside [t0_ns, t1_ns]."""
    lag = []
    safety = []
    publishes = []
    connects = 0
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
    worst = max(lag, default=(0, None))
    return {
        "lag_windows": len(lag),
        "lag_max_drift_ms": round(worst[0], 1),
        "lag_max_dominant": worst[1],
        "safety_events": sorted(set(safety)) or [],
        "gcode_publishes": publishes,
        "ws_connects": connects,
    }


# ---- WS viewer client ------------------------------------------------------

LIVENESS_FAILED = False  # set by with_viewers when a scenario delivers 0 status frames
DELIVERY_FAILED = False  # set by preview_publish when the load never produces a publish


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
                elif msg.get("type") == "reply" and msg.get("ok") is False:
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
    path = "/tmp/perfmatrix-big.ngc"
    gen_gcode(path, args.upload_mb)

    async def body(viewers):
        t0 = time.monotonic()
        with open(path, "rb") as f:
            r = await asyncio.to_thread(
                requests.post, f"{BASE}/upload", headers=HDRS,
                files={"file": ("perfmatrix-big.ngc", f)}, timeout=300)
        dur = round((time.monotonic() - t0) * 1000)
        await asyncio.sleep(2)
        return {"status": r.status_code, "upload_ms": dur,
                "size_mb": round(os.path.getsize(path) / 1e6, 1),
                "viewer_frames": sum(v.frames for v in viewers)}
    return await with_viewers(3, 0.0, body)


@scenario("save_during_stream")
async def sc_save(args):
    path = "/tmp/perfmatrix-big.ngc"
    gen_gcode(path, args.upload_mb)
    with open(path, "rb") as f:
        body_bytes = f.read()

    async def body(viewers):
        t0 = time.monotonic()
        r = await asyncio.to_thread(
            requests.put, f"{BASE}/save",
            params={"path": os.path.expanduser("~/linuxcnc/nc_files/perfmatrix-big.ngc")},
            headers={**HDRS, "Content-Type": "text/plain; charset=utf-8"},
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
    nc = os.path.expanduser("~/linuxcnc/nc_files/perfmatrix-big.ngc")
    with open(path, "rb") as f:
        requests.post(f"{BASE}/upload", headers=HDRS,
                      files={"file": ("perfmatrix-big.ngc", f)}, timeout=300)

    async def body(viewers):
        v = viewers[0]
        await v.send({"cmd": "arm", "armed": True})
        # Let any connect-time cache-hit viewer_gcode_ready (previous version)
        # land BEFORE snapshotting the baseline version — the first ready frame
        # after load_file can be that stale notify, not our publish.
        await asyncio.sleep(1.5)
        v0 = v.gcode_version
        await v.send({"cmd": "load_file", "path": nc})
        # Wait for OUR publish to actually LAND (version bump), not a blind
        # sleep: 9 of the first 17 runs of this scenario silently never
        # published in-window (parse-cache hits + parses outrunning the fixed
        # 20 s sleep), and their rss_kb_after measured an idle gateway — a
        # vacuous pass that poisoned the RSS baseline ("assert delivery").
        t0 = time.monotonic()
        deadline = t0 + 60.0
        while v.gcode_version in (None, v0) and time.monotonic() < deadline:
            await asyncio.sleep(0.5)
        delivered = v.gcode_version is not None and v.gcode_version != v0
        wait_s = round(time.monotonic() - t0, 1)
        await asyncio.sleep(2.0)  # settle so rss_kb_after includes publish state
        await v.send({"cmd": "arm", "armed": False})
        result = {"loaded": nc, "delivered": delivered, "publish_wait_s": wait_s,
                  "version_before": v0, "version_after": v.gcode_version}
        if v.last_reply_error:
            result["reply_error"] = v.last_reply_error
        if not delivered:
            global DELIVERY_FAILED
            DELIVERY_FAILED = True
            result["DELIVERY_FAIL"] = True
            print("  DELIVERY FAIL: load_file produced no fresh viewer_gcode "
                  f"publish within 60s (version stuck at {v0!r}, last reply "
                  f"error: {v.last_reply_error!r}) — rss/lag numbers below "
                  "measure an idle gateway", flush=True)
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
        try:
            direct = await fn(args)
        except Exception as e:
            direct = {"error": f"{type(e).__name__}: {e}"}
        await asyncio.sleep(3.5)  # trailing pad: trip events land LATE via the reader pipeline (a 1 s pad produced a false pass)
        t1_ns = time.time_ns()
        entry = {
            "direct": direct,
            "trace": trace_window(t0_ns, t1_ns) if "skipped" not in direct else {},
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
    outdir = os.path.join(REPO, "runlogs", "perf-matrix")
    os.makedirs(outdir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = os.path.join(outdir, f"{stamp}-{git_rev}.json")
    with open(out, "w") as f:
        json.dump(report, f, indent=1)
    print(f"\nartifact: {out}")
    if LIVENESS_FAILED:
        print("RESULT: FAIL (liveness) — at least one scenario delivered zero status frames", flush=True)
        return 1
    if DELIVERY_FAILED:
        print("RESULT: FAIL (delivery) — preview_publish never published; its metrics are vacuous", flush=True)
        return 1
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
    sys.exit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
