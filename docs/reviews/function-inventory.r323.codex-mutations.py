"""R323 counter-mutations, ONLY in the caller's disposable archive.
Each source is restored in finally; no live repository or machine is used.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
assert str(root).startswith('/tmp/'), root
gateway = root / 'lcnc-gateway/gateway.py'
routine = root / 'subroutines/tool_length_probe/tool_touch_off.ngc'
cases = [
    ('tool_no_CMD_reload', gateway,
     'await _cmd_blocking(CMD.load_tool_table, wait=None)',
     'pass  # R323 mutation: no CMD reload', ['test_tool_edit_contract.py']),
    ('tool_reload_before_write', gateway,
     'await asyncio.to_thread(_write_tool_table_admitted, tbl_path, tools, conn_key)\n        await _reload_tool_table_and_bump()',
     'await _reload_tool_table_and_bump()\n        await asyncio.to_thread(_write_tool_table_admitted, tbl_path, tools, conn_key)',
     ['test_tool_edit_contract.py']),
    ('reload_poller_wrong_inputs', gateway,
     'file_changed = preview_file_changed(st.active_file, _cur_mtime, _bulk.last_file, _bulk.last_mtime)',
     'file_changed = preview_file_changed(None, None, None, None)', ['test_program_reload_unload.py']),
    ('reload_poller_no_schedule', gateway,
     '_bulk.schedule_refresh(\n                        st.active_file,\n                        _bulk.reparse_pending_reason or ("file" if file_changed else "reparse"),\n                        _spawn_preview_task)',
     'pass  # R323 mutation: no refresh scheduled', ['test_program_reload_unload.py']),
    ('routine_unlisted_spaced_read', routine,
     '#<tool_touch_x_coords> = #3100',
     '#<r323_extra> = # 3107\n#<tool_touch_x_coords> = #3100', ['test_toolsetter_routine_map.py']),
]
results = []
for name, path, before, after, tests in cases:
    saved = path.read_bytes()
    text = saved.decode()
    assert text.count(before) == 1, (name, text.count(before))
    try:
        path.write_text(text.replace(before, after, 1))
        cmd = [sys.executable, '-B', '-m', 'pytest', '-o', 'addopts=', '-q', '-p', 'no:cacheprovider', *tests]
        log = out / (name + '.txt')
        with log.open('w') as f:
            result = subprocess.run(cmd, cwd=root / 'lcnc-gateway', stdout=f, stderr=subprocess.STDOUT, timeout=60)
        row = {'case': name, 'changed_file': str(path.relative_to(root)), 'before': before, 'after': after,
               'command': cmd, 'returncode': result.returncode, 'test_output': log.read_text(),
               'source_sha256': hashlib.sha256(saved).hexdigest()}
        results.append(row)
        print(name, result.returncode, flush=True)
    finally:
        path.write_bytes(saved)
        assert path.read_bytes() == saved
(out/'mutations.json').write_text(json.dumps(results, indent=2)+'\n')
