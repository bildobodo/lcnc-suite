"""R23: isolated inode check, using unchanged extracted repository functions.

Only temporary files and a fake STAT object. No gateway import, NML connection,
browser, server, or machine command. The LinuxCNC success/failure is modelled;
the provenance writer and its file replacement are the actual source functions.
"""
import ast
import asyncio
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
from typing import Dict

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ns = dict(os=os, tempfile=tempfile, asyncio=asyncio, Dict=Dict,
          WCS_PROV_BASE=5231, WCS_PROV_STRIDE=20, PROV_STAMPED=1.0)
locations = {}


def extract(relative, names):
    source = (ROOT / relative).read_text()
    tree = ast.parse(source, filename=relative)
    selected = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                and n.name in names]
    assert {n.name for n in selected} == set(names)
    for n in selected:
        locations[n.name] = {'file': relative, 'line': n.lineno}
    exec(compile(ast.Module(body=selected, type_ignores=[]), relative, 'exec'), ns)


extract('lcnc-gateway/gateway_util.py', ['atomic_write_bytes', 'wcs_prov_params'])
extract('lcnc-gateway/status_runtime.py', ['read_var_file', 'write_var_file_updates'])
extract('lcnc-gateway/gateway.py', ['_ensure_prov_var_rows'])
ns['_read_var_file'] = ns['read_var_file']
ns['_write_var_file_updates'] = ns['write_var_file_updates']
ns['STAT'] = SimpleNamespace(poll=lambda: None, axis_mask=0b101111)  # XYZAC
ns['_trace'] = SimpleNamespace(emit=lambda *a, **k: None)
ns['_status_runtime'] = SimpleNamespace(mark_var_file_written=lambda p: None)

# Deterministic scheduler: run each file-I/O handoff inline. We explicitly place
# this background task inside the G30 lock interval; no timing race is needed.
async def inline_to_thread(fn, *args):
    return fn(*args)

ns['asyncio'] = SimpleNamespace(to_thread=inline_to_thread)


async def main():
    cmd_lock = asyncio.Lock()
    ns['_get_cmd_lock'] = lambda: cmd_lock
    ns['_prov_rows_ensured'] = set()
    ns['_prov_rows_ok'] = None
    ns['_prov_cache'] = {}
    with tempfile.TemporaryDirectory(prefix='operator-r23-') as directory:
        path = Path(directory) / 'sim.var'
        ns['_resolve_var_file_path'] = lambda: str(path)
        path.write_text('5181 10.000000\n5182 0.000000\n5183 0.000000\n')
        before = path.stat().st_ino
        no_writer_passes = path.stat().st_ino != before
        # A G30 handler holds the proposed lock and its synch has not saved.
        # The already scheduled background task still runs to completion.
        async with cmd_lock:
            await ns['_ensure_prov_var_rows']()
            after = path.stat().st_ino
            data = ns['read_var_file'](str(path), {'5181', '5231'})
            foreign_writer_case = {
                'cmd_lock_held': cmd_lock.locked(),
                'background_seed_completed': ns['_prov_rows_ok'],
                'inode_before': before, 'inode_after': after,
                'inode_predicate_passes': before != after,
                'file_g30_x': data['5181'], 'based_on': 10,
                'model_interpreter_g30_x': 20,
                'old_basis_incorrectly_matches_file': data['5181'] == 10,
                'provenance_row_added': data['5231'] == 0,
            }
        assert foreign_writer_case['inode_predicate_passes']
        assert foreign_writer_case['old_basis_incorrectly_matches_file']
        assert foreign_writer_case['background_seed_completed'] is True
        # Positive control: the documented LinuxCNC publication sequence.
        old_inode = path.stat().st_ino
        new_path = Path(str(path) + '.new')
        new_path.write_text('5181 20.000000\n5182 0.000000\n5183 0.000000\n')
        os.link(path, str(path) + '.bak')
        os.replace(new_path, path)
        control = {
            'inode_changed': path.stat().st_ino != old_inode,
            'backup_holds_old_inode': Path(str(path) + '.bak').stat().st_ino == old_inode,
            'fresh_value': ns['read_var_file'](str(path), {'5181'})['5181'],
        }
        assert control['inode_changed'] and control['backup_holds_old_inode']
        return {'unchanged_file_passes': no_writer_passes,
                'background_writer': foreign_writer_case, 'publication_control': control}


out = {
    'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'scope': 'Real extracted provenance/file-writer functions; deterministic inline I/O scheduling, simulated synch outcomes and interpreter value.',
    'functions': locations,
    'observations': asyncio.run(main()),
}
(HERE / 'operator-punkte.r23.inode-probe.json').write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps(out, indent=2))
