#!/usr/bin/env python3
"""Offline fixture: unchanged HTTP handler + real SettingsStore, temporary disk.

Reads {mode, data} from stdin; emits response and cache/disk snapshots.
No gateway import, LinuxCNC, real settings or real server. Only the requested
write fault is injected; the handler is compiled verbatim without decorators.
"""
import ast
import asyncio
import errno
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lcnc-gateway"))
from settings_store import SettingsStore, VALID_SECTIONS
from starlette.requests import Request
from starlette.responses import JSONResponse

args = json.load(sys.stdin)
mode, data = args["mode"], args["data"]
tree = ast.parse((ROOT / "lcnc-gateway/gateway.py").read_text())
handler = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef)
               and n.name == "put_settings_section")
handler.decorator_list = []

with tempfile.TemporaryDirectory(prefix="ui-r7-store-") as tmp:
    path = Path(tmp) / "settings.json"
    before = {"keyboard": {"mapping": {"abort": "F8"}}}
    if mode == "corrupt":
        path.write_text("{ not valid json")
    elif mode != "missing":
        path.write_text(json.dumps({"review-ini": before}))
    store = SettingsStore(path, lambda: "review-ini")
    initial = json.loads(json.dumps(store.load()))
    scope = {"asyncio": asyncio, "Request": Request, "JSONResponse": JSONResponse,
             "_VALID_SETTINGS_SECTIONS": VALID_SECTIONS,
             "save_settings_section": store.save_section}
    exec(compile(ast.Module(body=[handler], type_ignores=[]),
                 "gateway.py:put_settings_section", "exec"), scope)

    class Body:
        async def json(self):
            return {"data": data}

    if mode == "missing":
        # A beacon that never reached the handler: reconnect gets the actual
        # empty store. Browser probe separately aborts the HTTP request.
        response, status = {"networkFailure": True}, None
    else:
        async def run():
            return await scope["put_settings_section"]("keyboard", Body())
        if mode == "disk-full":
            with patch("settings_store.atomic_write_bytes",
                       side_effect=OSError(errno.ENOSPC, "No space left on device")):
                result = asyncio.run(run())
        else:
            result = asyncio.run(run())
        status = result.status_code if isinstance(result, JSONResponse) else 200
        response = json.loads(result.body) if isinstance(result, JSONResponse) else result
    memory = json.loads(json.dumps(store.load()))
    disk_text = path.read_text() if path.exists() else None
    fresh = SettingsStore(path, lambda: "review-ini").load()
    print(json.dumps({"mode": mode, "initial": initial, "httpStatus": status,
                      "response": response, "cacheAfterRequest": memory,
                      "freshStoreAfterRequest": fresh, "diskText": disk_text,
                      "version": store.version}))
