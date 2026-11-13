"""R363 plan counterexamples. Fake channels only; no server or live Sim.

Run with the gateway venv Python and an archive of 45727d61:
  python3 this-file.py /tmp/codex-r362 /tmp/r363-result.json
Reader cases execute the original reader's AST loop in memory. This is a
source-loop probe, not an end-to-end WebSocket test. AUTO uses the original
schema + dispatch group; program identity/admission/toolsetter dependencies
are isolated and the mode write goes only to fake_linuxcnc.
"""
import ast
import asyncio
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

root = Path(sys.argv[1]).resolve()
os.environ['LCNC_LOG_DIR'] = tempfile.mkdtemp(prefix='r363-trace-')
os.environ.pop('LCNC_LAUNCHER_PID', None)
os.environ.pop('LCNC_INI_FILE', None)
sys.path.insert(0, str(root / 'lcnc-gateway'))
import fake_linuxcnc
lc = fake_linuxcnc.install()
import session_bind
with patch.object(session_bind, 'discover_instance', return_value=(None, [])):
    import gateway as g
import command_policy as cp
from link_fixture import FakeConnection, swap_connection

source = (root / 'lcnc-gateway/gateway.py').read_text()
tree = ast.parse(source)
endpoint = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef)
                and n.name == 'ws_endpoint')
loops = [n for n in ast.walk(endpoint) if isinstance(n, ast.While)
         and any(isinstance(stmt, ast.Assign)
                 and any(isinstance(t, ast.Name) and t.id == '_wsmsg' for t in stmt.targets)
                 for stmt in n.body)]
assert len(loops) == 1
fn = ast.parse('async def reader_probe():\n    pass\n').body[0]
fn.body = loops[0:1]
module = ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[]))

class EndOfFrames(Exception):
    pass

async def reader_case(frame):
    pending = deque([{'cmd': 'heartbeat', 'seq': 1}, frame,
                     {'cmd': 'heartbeat', 'seq': 2}])
    sent = []
    class WS:
        async def receive(self):
            if not pending:
                raise EndOfFrames()
            return {'type': 'websocket.receive', 'text': json.dumps(pending.popleft())}
    async def send(ws, obj):
        sent.append(obj)
    client = SimpleNamespace(frames_rx=0, hb_ring=deque(), armed=False)
    scope = dict(vars(g), client=client, client_id=1, client_ip='127.0.0.1',
                 ws=WS(), _clients={1: client}, ws_send_json=send,
                 _trace=SimpleNamespace(emit=lambda *args, **kwargs: None))
    exec(compile(module, '<original-ws-reader-loop>', 'exec'), scope)
    failure = None
    try:
        await scope['reader_probe']()
    except EndOfFrames:
        pass
    except Exception as exc:
        failure = {'type': type(exc).__name__, 'message': str(exc)}
    return {'frame': frame, 'failure': failure, 'frames_sent': sent,
            'remaining_inputs': list(pending)}

async def run_case(line):
    msg = {'cmd': 'auto_run', 'line': line, 'version': 1,
           'file': '/tmp/r363-program.ngc', 'source': 'r363-source'}
    corrections = cp.validate_payload('auto_run', msg, cp.MachineLimits())
    conn = FakeConnection()
    swap_connection(conn)
    calls = []
    async def guard(*args, **kwargs):
        calls.append('start_guard')
        return None
    async def sync(*args, **kwargs):
        calls.append('toolsetter_sync')
        return None, {}
    async def mode(value, **kwargs):
        calls.append(['mode', value])
        conn.cmd.mode(value)
    async def no_run_basis():
        return None
    serial_before = conn.cmd.serial
    with (patch.object(g, '_bulk', SimpleNamespace(preview_version=1, published_source='r363-source')),
         patch.object(g, '_status_runtime', SimpleNamespace(program=SimpleNamespace(
             change_pending=False, loaded=msg['file']))),
         patch.object(g, 'program_source', return_value='r363-source'),
         patch.object(g, '_toolsetter_basis', return_value={}),
         patch.object(g, '_basis_admit', return_value=lambda: None),
         patch.object(g, '_start_guard', guard),
         patch.object(g, '_toolsetter_sync', sync),
         patch.object(g, '_ts_program_writes', return_value=[]),
         patch.object(g, '_begin_run_basis', no_run_basis),
         patch.object(g, 'set_mode', mode)):
        try:
            result = await g._cmds_program_run('auto_run', msg, True, None)
        except Exception as exc:
            result = {'type': type(exc).__name__, 'message': str(exc)}
    return {'line': line, 'schema_accepted': True, 'corrections': corrections,
            'calls_before_result': calls, 'fake_writes': conn.cmd.serial - serial_before,
            'result': result}

async def main():
    cases = [
        {'cmd': 'save_settings', 'section': 'unknown-section'},
        {'cmd': 'hello', 'session': ['x'], 'resume_armed': True},
        {'cmd': 'hello', 'session': {'x': 1}, 'resume_armed': True},
        {'cmd': 'save_settings', 'section': []},
        {'cmd': 'save_settings', 'section': {}},
    ]
    results = {'target': '45727d61', 'live_access': False,
               'reader_probe': 'original AST loop, not a socket or server',
               'source_sha256': {str(p): hashlib.sha256((root / p).read_bytes()).hexdigest()
                                for p in map(Path, ['lcnc-gateway/gateway.py',
                                    'lcnc-gateway/command_policy.py',
                                    'lcnc-gateway/fake_linuxcnc.py'])},
               'reader': [await reader_case(c) for c in cases],
               'auto_run': [await run_case(n) for n in [0, 2**31 - 1, 2**31]]}
    expected = {'cmd': 'touchoff', 'axes': {'X': 0},
                'expect': {'kins_type': None, 'g5x_index': 1}}
    results['touch_expect'] = {'payload': expected,
        'current_schema_corrections': cp.validate_payload('touchoff', expected, cp.MachineLimits()),
        'setup_sender': 'SetupStrip.vue expectNow: kinsType ?? null, g5xIndex ?? null',
        'client_type': 'useTouchoffMath.ts TouchoffExpect: number | null for both dimensions'}
    assert results['reader'][0]['failure'] is None
    assert len([f for f in results['reader'][0]['frames_sent'] if f['type'] == 'pong']) == 2
    assert all(r['failure']['type'] == 'TypeError' for r in results['reader'][1:])
    assert all(len(r['remaining_inputs']) == 1 for r in results['reader'][1:])
    assert results['auto_run'][0]['result']['ok'] is True
    assert results['auto_run'][1]['result']['ok'] is True
    assert results['auto_run'][2]['result']['type'] == 'TypeError'
    assert results['auto_run'][2]['fake_writes'] == 1
    text = json.dumps(results, indent=2, ensure_ascii=False) + '\n'
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(text)
        print('R363: counterexamples and positive controls reproduced')
    else:
        print(text)

asyncio.run(main())
