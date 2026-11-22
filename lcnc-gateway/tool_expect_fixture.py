"""Test helper (P4-2, Codex MT433-01): the `expected` row state a tool edit
dialog sends with save_tool / renumber_tool — built from the same rows,
library and table path the handler reads, so a test that is not about the
row check passes it. Import after fake_linuxcnc.install()."""
from typing import Any, Dict, List

import gateway
from command_policy import TOOL_EDIT_FIELDS
from tool_table import _merge_tool_data


def row_expect(tbl_path: str, rows: List[Dict[str, Any]], library: Dict[str, Any], tool: int) -> Dict[str, Any]:
    row = next(r for r in _merge_tool_data(rows, library) if r["T"] == tool)
    return {"table": gateway._tool_table_identity(tbl_path), "tool": tool,
            "fields": {f: row.get(f) for f in TOOL_EDIT_FIELDS}}
