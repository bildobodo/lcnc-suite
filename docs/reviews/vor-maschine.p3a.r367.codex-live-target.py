"""Run the actual new live driver's entry with ALL native/network edges fake.

No native linuxcnc import, socket, controller operation, /proc lookup, or
machine file. The tiny INI lives in a temporary directory. Stop at power-on.
"""
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path
from unittest.mock import patch

root = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/codex-r367")
out = []
for label, port_line in (("not_a_sim_and_no_port", ""), ("not_the_running_ini", "WEBUI_PORT = 4188\n")):
    events = []
    stat = types.SimpleNamespace(task_state=1, ini_filename="/different/running/machine.ini", poll=lambda: None)
    native = types.ModuleType("linuxcnc")
    def fake_stat():
        events.append({"native_stat_constructed": True})
        return stat
    native.stat = fake_stat
    native.STATE_ESTOP, native.STATE_ESTOP_RESET, native.STATE_ON = 1, 2, 4
    class ReachedPowerOn(Exception):
        pass
    class Task:
        def cancel(self):
            pass
    class Loop:
        def create_task(self, coro):
            coro.close()             # never run reader/heartbeat
            return Task()
    with patch.dict(sys.modules, {"linuxcnc": native}):
        spec = importlib.util.spec_from_file_location("r367_actual_live_driver", root / "scripts/home_step_live_check.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    RealGateway = module.Gateway
    class Gateway(RealGateway):
        def __init__(self, url):
            super().__init__(url)
            self.frames = 3         # fixed fake receipt; no wait or network
            self.data = {"ini_filename": stat.ini_filename}
            holder["gw"] = self
    holder = {}
    class Socket:
        async def send(self, raw):
            d = json.loads(raw)
            events.append({"wire": d})
            if d["cmd"] == "estop_reset":
                stat.task_state = native.STATE_ESTOP_RESET
            if d["cmd"] == "machine_on":
                raise ReachedPowerOn
            if d.get("req_id"):
                holder["gw"].replies[d["req_id"]] = {"ok": True}
        async def close(self):
            events.append({"socket_closed": True})
    async def connect(url, **kwargs):
        events.append({"url": url})
        return Socket()
    with tempfile.TemporaryDirectory(prefix="r367-fake-target-") as td:
        ini = Path(td) / "not-a-simulator.ini"
        ini.write_text("[DISPLAY]\n" + port_line + "[HAL]\nHALFILE = production-hardware.hal\n")
        with patch.object(module, "Gateway", Gateway), \
                patch.object(module.websockets, "connect", connect), \
                patch.object(module.asyncio, "get_event_loop", lambda: Loop()):
            coro = module.main(str(ini), False)
            try:
                coro.send(None)      # all awaits above finish inline
                raise AssertionError("unexpected suspension")
            except (ReachedPowerOn, StopIteration):
                pass
            finally:
                coro.close()
    writes = [e["wire"] for e in events if e.get("wire", {}).get("cmd") in ("arm", "estop_reset", "machine_on")]
    out.append({"case": label, "running_ini": stat.ini_filename,
                "events": events, "refused_before_writes": not writes})
print(json.dumps(out, indent=2))
sys.exit(0 if all(row["refused_before_writes"] for row in out) else 1)
