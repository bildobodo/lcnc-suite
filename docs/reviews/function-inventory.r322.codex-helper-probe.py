"""R322: the existing _thread_to_end expects a Task/Future, not a coroutine.

Offline API probe only: extracts the unchanged function by AST from the
specified archive. No gateway import, threads, processes, sockets or HAL.
This does not test the future Sim-Trip implementation.
"""
import ast
import asyncio
import hashlib
import json
from pathlib import Path
import sys
from typing import Callable, Optional

source = (Path(sys.argv[1]) / 'lcnc-gateway/gateway.py').read_text()
node = next(n for n in ast.parse(source).body if isinstance(n, ast.AsyncFunctionDef) and n.name == '_thread_to_end')
module = ast.Module(body=[node], type_ignores=[])
env = {'asyncio': asyncio, 'Optional': Optional, 'Callable': Callable}
exec(compile(module, 'unchanged-_thread_to_end', 'exec'), env)

async def case(wrap):
    entered, release, finished = asyncio.Event(), asyncio.Event(), asyncio.Event()
    async def work():
        entered.set()
        await release.wait()
        finished.set()
    inner = work()
    if wrap:
        inner = asyncio.create_task(inner)
    outer = asyncio.create_task(env['_thread_to_end'](inner))
    await entered.wait()
    outer.cancel()
    for _ in range(3):
        await asyncio.sleep(0)
    after_cancel = {'outer_done': outer.done(), 'inner_finished': finished.is_set()}
    outer.cancel()
    for _ in range(3):
        await asyncio.sleep(0)
    after_second = {'outer_done': outer.done(), 'inner_finished': finished.is_set()}
    release.set()
    await finished.wait()
    try:
        await outer
        outcome = 'returned'
    except asyncio.CancelledError:
        outcome = 'CancelledError'
    except Exception as e:
        outcome = f'{type(e).__name__}: {e}'
    return {'after_cancel': after_cancel, 'after_second_cancel': after_second, 'outcome': outcome}

async def main():
    return {'bare_coroutine': await case(False), 'task': await case(True)}

results = asyncio.run(main())
assert results['bare_coroutine']['after_cancel']['outer_done']
assert results['bare_coroutine']['outcome'].startswith('AttributeError:')
assert not results['task']['after_cancel']['outer_done']
assert not results['task']['after_second_cancel']['outer_done']
assert results['task']['outcome'] == 'CancelledError'
results['source_commit'] = '41d0d1ab'
results['function_sha256'] = hashlib.sha256(ast.get_source_segment(source, node).encode()).hexdigest()
print(json.dumps(results, indent=2))
