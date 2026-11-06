"""Pure file compatibility check: the R323 writer -> the R325 reader.
No gateway import, no LinuxCNC library or command; sscanf is from libc only.
"""
import ctypes
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

old_root, new_root, output = map(Path, sys.argv[1:])
assert str(old_root).startswith('/tmp/') and str(new_root).startswith('/tmp/')
sys.path.insert(0, str(new_root / 'lcnc-gateway'))
from tool_table import parse_tool_table, ToolTableUnreadable

source = old_root / 'lcnc-gateway/tool_table.py'
spec = importlib.util.spec_from_file_location('prior_tool_table', source)
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)
libc = ctypes.CDLL(None)
q = ctypes.c_int()
converted = libc.sscanf(b'+3.000000', b'%d', ctypes.byref(q))
with tempfile.TemporaryDirectory(prefix='r324-prior-writer-') as tmp:
    table = Path(tmp) / 'tool.tbl'
    old.write_tool_table(str(table), [{'T': 1, 'P': 1, 'Z': 50.0, 'D': 6.0},
                                    {'T': 2, 'P': 5, 'Z': 50.1, 'D': 6.0, 'Q': 3}])
    written = table.read_text()
    try:
        strict = parse_tool_table(str(table), True)
    except ToolTableUnreadable as e:
        strict = {'refused': str(e)}
    result = {'writer_commit': '52454d27', 'reader_commit': '89003ac0',
              'old_writer_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'old_writer_output': written, 'old_reader': old.parse_tool_table(str(table)),
              'new_display_reader': parse_tool_table(str(table)), 'new_strict_reader': strict,
              'libc_integer_scan_of_Q': {'conversions': converted, 'value': q.value}}
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
