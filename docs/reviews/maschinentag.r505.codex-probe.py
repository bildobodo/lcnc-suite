"""R505: isolated scheduling probes, never import or contact the gateway.

Extract cmd_worker and _thread_to_end verbatim via the AST of dbd14cab.
Only the command executor, socket, trace, and actions are stubs. The cap
probe models the explicitly retained cap policy from plan 6.2e.
"""
import ast
import asyncio
import contextvars
import hashlib
import json
import subprocess
import time
from types import SimpleNamespace
from typing import Optional, Callable

BASE = "dbd14cab"
REPO = "/home/cnc/lcnc-suite"
source = subprocess.check_output(
    ["git", "-C", REPO, "show", f"{BASE}:lcnc-gateway/gateway.py"], text=True)
tree = ast.parse(source)

class Trace:
    def emit(self, *args, **kwargs):
        pass

class WebSocketDisconnect(Exception):
    pass

def extract(name, env):
    node = next(n for n in ast.walk(tree)
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), f"{BASE}:gateway.py", "exec"), env)
    return env[name]

def retrieve(t):
    if not t.cancelled():
        t.exception()

def worker_env(execute, send):
    q = asyncio.Queue()
    client = SimpleNamespace(cmd_inflight=None, cmd_inflight_task=None,
                             cmd_preempted_by=None, cmd_inflight_since_mono=0.0)
    env = dict(asyncio=asyncio, time=time, contextvars=contextvars,
               client=client, client_id=7, cmd_queue=q, ws=object(),
               _set_phase=lambda *a: None, _trace=Trace(),
               _req_echo=lambda msg: {"req_id": msg["req_id"]},
               _current_action=contextvars.ContextVar("review_action", default=None),
               register_bg_task=lambda t: t, _retrieve_task_exc=retrieve,
               _execute_client_command=execute, ws_send_json=send,
               WebSocketDisconnect=WebSocketDisconnect)
    return q, client, extract("cmd_worker", env)

def item(cmd, rid):
    return ({"cmd": cmd, "req_id": rid}, time.monotonic(), None)

async def bounded(e):
    await asyncio.wait_for(e.wait(), 1)

async def case_disconnected_dequeued_abort():
    entered, permit = asyncio.Event(), asyncio.Event()
    writes = []
    async def execute(cid, client, ws, msg):
        entered.set()
        await permit.wait()       # not yet holding _cmd_lock / not written
        writes.append(msg["cmd"])
    async def send(*args):
        pass
    q, client, work = worker_env(execute, send)
    q.put_nowait(item("abort", "stop-1"))
    task = asyncio.create_task(work())
    await bounded(entered)
    inflight = client.cmd_inflight_task
    at_disconnect = {"queue_depth": q.qsize(), "inflight": client.cmd_inflight}
    # Existing disconnect branch cancels cmd_task, then drains cmd_queue.
    task.cancel()
    drained = []
    while not q.empty():
        drained.append(q.get_nowait()[0]["cmd"])
    await asyncio.gather(task, inflight, return_exceptions=True)
    permit.set()
    assert at_disconnect == {"queue_depth": 0, "inflight": "abort"}
    assert writes == [] and drained == [] and inflight.cancelled()
    return dict(at_disconnect=at_disconnect, queued_stop_handoff_sees=drained,
                written=writes, inflight_cancelled=inflight.cancelled())

async def case_old_reply_blocks_abort():
    started, reply_entered, release_reply, wrote = [asyncio.Event() for _ in range(4)]
    writes = []
    async def execute(cid, client, ws, msg):
        if msg["cmd"] == "mdi":
            started.set()
            await asyncio.Event().wait()
        else:
            writes.append(msg["cmd"])
            wrote.set()
    async def send(ws, msg):
        assert msg["error"] == "Preempted by abort"
        reply_entered.set()
        await release_reply.wait()
    q, client, work = worker_env(execute, send)
    q.put_nowait(item("mdi", "old"))
    task = asyncio.create_task(work())
    await bounded(started)
    # The relevant synchronous part of proposed _stop_arrival:
    client.cmd_preempted_by = "abort"
    client.cmd_inflight_task.cancel()
    q.put_nowait(item("abort", "stop-2"))
    await bounded(reply_entered)
    blocked = {"queue_depth": q.qsize(), "written": list(writes),
               "old_handler_done": client.cmd_inflight_task.done()}
    assert blocked == {"queue_depth": 1, "written": [], "old_handler_done": True}
    release_reply.set()
    await bounded(wrote)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert writes == ["abort"]
    return dict(while_old_reply_waits=blocked, after_reply_released=writes)

async def case_cancel_before_admit():
    ready, admit_allowed, cancelled = [asyncio.Event() for _ in range(3)]
    writes = []
    async def inner():
        ready.set()
        await admit_allowed.wait()   # represents dispatched work paused before admit
        writes.extend(["admit", "AUTO"])
        return 0
    env = dict(asyncio=asyncio, Optional=Optional, Callable=Callable)
    wait_to_end = extract("_thread_to_end", env)
    operation = asyncio.create_task(inner())
    outer = asyncio.create_task(wait_to_end(operation, on_cancel=cancelled.set))
    await bounded(ready)
    outer.cancel()
    await bounded(cancelled)
    assert not operation.done()
    admit_allowed.set()
    await asyncio.gather(outer, return_exceptions=True)
    assert writes == ["admit", "AUTO"] and outer.cancelled()
    return dict(model="actual wait-to-end helper with controlled async stand-in for the dispatched write",
                cancel_before_admit=True, later_steps=writes, outer_cancelled=outer.cancelled())

def case_stop_capacity():
    cap_node = next(n for n in tree.body if isinstance(n, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == "_WS_CMD_QUEUE_MAX" for t in n.targets))
    cap = ast.literal_eval(cap_node.value) * 4
    kept = ["jog_stop"] * cap
    # Each is kept by the plan's drain, so 6.2e's existing cap rejects abort.
    rejected = len(kept) >= cap
    assert rejected
    return dict(model="plan 6.2e retains existing cap", kept_stops=len(kept),
                stop_cap=cap, abort_rejected=rejected)

async def main():
    print(json.dumps(dict(base=BASE, source_sha256=hashlib.sha256(source.encode()).hexdigest(),
                         limits="Extracted scheduling code only; no gateway import, NML, socket, browser, or live sim.",
                         disconnected_dequeued_abort=await case_disconnected_dequeued_abort(),
                         old_reply_blocks_abort=await case_old_reply_blocks_abort(),
                         cancel_before_admit=await case_cancel_before_admit(),
                         cap=case_stop_capacity()), indent=2))

if __name__ == "__main__":
    asyncio.run(main())
