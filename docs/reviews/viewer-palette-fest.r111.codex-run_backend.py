"""Isolated test runner. Timer tick works around sandbox asyncio self-pipe wakeups.
No command or gateway mocking beyond the repository's own test doubles.
"""
import asyncio, sys, os
from pathlib import Path
sys.path.insert(0,str(Path.cwd()))
os.environ['LCNC_LOG_DIR']=str(Path(__file__).resolve().parent/'logs')
_run=asyncio.run
async def with_tick(coro):
 loop=asyncio.get_running_loop()
 def tick(): loop.call_later(.01,tick)
 loop.call_later(.01,tick)
 return await coro
asyncio.run=lambda c,**kw:_run(with_tick(c),**kw)
import pytest
sys.exit(pytest.main(['-q',*sys.argv[1:]]))
