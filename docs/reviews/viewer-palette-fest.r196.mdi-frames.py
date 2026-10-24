#!/usr/bin/env python3
"""VP-I132 measurement (R195/R196): does the status the gateway sends ever
show the interpreter NOT idle around an MDI `G10 L2 P1 Z…` — the way the S
phase changes its offsets? N switches, alternating z0 − 1 and z0 (ends on z0),
each `gap` s apart; every status frame's interp_state / task_mode / G54 Z
change logged with its receipt time (mdi_frames.jsonl). Nothing else sent."""
import asyncio, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import msgspec.msgpack
from drive import Stop, log
from drive2 import Client2, guard_breach

OUT = os.path.join(HERE, "mdi_frames.jsonl")

class Rec(Client2):
    def __init__(self):
        super().__init__(); self.frames = []
    async def _read(self):
        async for raw in self.ws:
            try:
                d = msgspec.msgpack.decode(raw) if isinstance(raw, (bytes, bytearray)) else json.loads(raw)
            except Exception:
                continue
            if isinstance(d, dict) and d.get("type") in ("status", "status_delta") and isinstance(d.get("data"), dict):
                x = d["data"]
                f = {k: x[k] for k in ("interp_state", "task_mode", "exec_state", "g5x_offset") if k in x}
                if f: self.frames.append({"t": time.monotonic(), **f})
            # hand the frame to the normal reader's bookkeeping
            if isinstance(d, dict):
                if d.get("type") in ("status", "status_delta"):
                    self.env = {"clients": d.get("clients"), "armed": d.get("armed"), "safety_trip": d.get("safety_trip")}
                    self.env_at = time.monotonic()
                if isinstance(d.get("data"), dict): self.st.update(d["data"])
                if d.get("type") == "reply" or ("ok" in d and "cmd" in d): self.replies.append(d)

async def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    gap = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
    c = Rec(); await c.connect(); await asyncio.sleep(2.0)
    try:
        b = guard_breach(c)
        if b: raise Stop(b)
        if c.st.get("interp_state") != 1 or not c.st.get("enabled") or not c.st.get("homed"):
            raise Stop(f"machine not ready: {[c.st.get(k) for k in ('interp_state','enabled','homed')]}")
        if c.st.get("g5x_index") != 1: raise Stop("G54 not active")
        z0 = float(c.st["wcs_table"][0]["z"])
        log("z0", z0, "switches", n, "gap", gap)
        sends = []
        for k in range(n):
            z = z0 - 1.0 if k % 2 == 0 else z0
            t = time.monotonic()
            await c.cmd({"cmd": "mdi", "text": f"G10 L2 P1 Z{z:.3f}"})
            sends.append({"k": k, "z": z, "t_send": t, "t_reply": time.monotonic()})
            b = guard_breach(c)
            if b: raise Stop(b)
            await asyncio.sleep(gap)
        await c.until(lambda s: s.get("interp_state") == 1, 30, "idle at the end")
        await asyncio.sleep(1.0)
        busy = [f for f in c.frames if "interp_state" in f and f["interp_state"] != 1]
        modes = sorted({f["task_mode"] for f in c.frames if "task_mode" in f})
        log("frames", len(c.frames), "non-idle interp frames", len(busy), "task modes seen", modes)
        with open(OUT, "w") as fh:
            fh.write(json.dumps({"z0": z0, "n": n, "gap": gap, "sends": sends}) + "\n")
            for f in c.frames: fh.write(json.dumps(f) + "\n")
        log("final G54 Z", c.st["wcs_table"][0]["z"])
    finally:
        try: await c.cmd({"cmd": "arm", "armed": False}, timeout=5)
        except Exception: pass
        await c.ws.close()

asyncio.run(main())
