#!/usr/bin/env python3
"""R133 test runner for this sandbox: keep the event loop's selector waking
periodically. Even an unrelated asyncio.to_thread(lambda: 42) completed its
body but hung during asyncio.run shutdown here. Does not replace to_thread,
fake a result, change product code or run any real LinuxCNC command.
Usage: <venv-python> async_pytest.py ARCHIVE [pytest args...]
"""
import asyncio
from pathlib import Path
import sys

root=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(root/'lcnc-gateway'))
original=asyncio.events.new_event_loop
def new_loop():
    loop=original()
    def tick():
        loop.call_later(0.05,tick)
    loop.call_later(0.05,tick)
    return loop
asyncio.events.new_event_loop=new_loop
import pytest
raise SystemExit(pytest.main(sys.argv[2:]))
