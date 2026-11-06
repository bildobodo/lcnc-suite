"""R323: an actual save_tool may not erase an untouched, reordered row.

Run with the archive's backend environment; fake_linuxcnc is installed by
test_tool_edit_contract before gateway is imported. Files stay under /tmp.
The reload helper is real; CMD.load_tool_table only records the file it sees.
"""
import asyncio
import json
from pathlib import Path
import sys
from unittest.mock import patch

root = Path(sys.argv[1]).resolve()
assert str(root).startswith('/tmp/')
sys.path.insert(0, str(root / 'lcnc-gateway'))
from test_tool_edit_contract import TestEachToolEditChangesItsRecord, table
TABLE = table()
import gateway
from test_button_gates import _payload

rows = [
    ('canonical_control', 'T2 P5 X3.25 Y-4.5 Z50.1 A1.5 B0 D6 I12 J34 Q3 ; second'),
    ('prior_writer_Q_decimal', 'T2 P5 X3.25 Y-4.5 Z50.1 A1.5 B0 D6 I12 J34 Q+3.000000 ; second'),
    ('pocket_before_tool', 'P5 T2 X3.25 Y-4.5 Z50.1 A1.5 B0 D6 I12 J34 Q3 ; second'),
    ('offset_between_tool_and_pocket', 'T2 X3.25 P5 Y-4.5 Z50.1 A1.5 B0 D6 I12 J34 Q3 ; second'),
]
results = []
for name, row in rows:
    case = TestEachToolEditChangesItsRecord()
    case.setUp()
    try:
        table_rows = TABLE.splitlines()
        table_rows[1] = row
        before = '\n'.join(table_rows) + '\n'
        case.table.write_text(before)
        gateway._shared_status = _payload()
        gateway._cmd_lock = None
        gateway.STAT.tool_in_spindle = 0
        reloads = []
        replies = []

        def reload_table():
            reloads.append(case.table.read_text())

        async def reply(_ws, msg):
            replies.append(msg)

        case.cmd.load_tool_table = reload_table
        with patch.object(gateway, 'get_tool_tbl_path', lambda: str(case.table)), \
                patch.object(gateway, '_tool_lib_store', case.store), \
                patch.object(gateway, 'ws_send_json', reply):
            asyncio.run(gateway._execute_client_command(
                901, case.writer, None, {'cmd': 'save_tool', 'tool_number': 1, 'z_offset': 49.0}))
        after = case.table.read_text()
        shown = gateway.parse_tool_table(str(case.table))
        results.append(dict(case=name, before=before, after=after, reply=replies[-1],
                            reloads=reloads,
                            untouched_record_kept='second' in after, shown_tools=[t['T'] for t in shown]))
    finally:
        case.doCleanups()
Path(sys.argv[2]).write_text(json.dumps(results, indent=2) + '\n')
for r in results:
    print(r['case'], 'reply_ok=', r['reply'].get('ok'),
          'reload_count=', len(r['reloads']), 'untouched_record_kept=', r['untouched_record_kept'])
