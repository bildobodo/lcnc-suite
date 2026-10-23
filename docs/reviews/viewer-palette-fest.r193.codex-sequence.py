"""Offline test of actual sequence(): fake client and clock, no machine/network.
Run beside the provided drive2/bpc2 modules and their prior dependencies.
"""
import asyncio
import json
import sys
import tempfile
from unittest.mock import patch, AsyncMock
import drive2

async def exercise(start, no_keys):
    marks, commands, prompts = [], [], []
    class Client:
        st={'enabled':True,'homed':True,'g5x_index':1,'interp_state':1}
        async def cmd(self, command):
            commands.append(command)
            if command.get('cmd')=='cycle_start': raise AssertionError('R reached with --to S')
        async def until(self,*a,**kw): return
    async def message(_c,text):prompts.append(text)
    with tempfile.TemporaryDirectory(prefix='r193-sequence-') as scratch:
        with patch.object(sys,'argv',['drive2.py','--to','S'] + (['--no-keys'] if no_keys else [])), \
             patch.object(drive2,'NO_KEYS',no_keys), \
             patch.object(drive2,'HERE',scratch), \
             patch.object(drive2,'anchored_reset',AsyncMock()), \
             patch.object(drive2,'setup_record',lambda _c:None), \
             patch.object(drive2,'wait_publish',AsyncMock()), \
             patch.object(drive2,'wait_settled',AsyncMock()), \
             patch.object(drive2,'supersede',AsyncMock(return_value=[{'spawn_ns':1,'job':1}])), \
             patch.object(drive2,'mdi_msg',message), \
             patch.object(drive2.asyncio,'sleep',AsyncMock()), \
             patch.object(drive2.bpc,'mark',marks.append), \
             patch.object(drive2,'log',lambda *a:None), \
             patch.object(drive2.Client2,'connect',side_effect=AssertionError('no network')):
            await drive2.sequence(Client(),start)
    assert marks[-1]=='end' and 'S_settle' in marks
    assert not any(m.startswith('R_') for m in marks)
    assert not any(c.get('cmd')=='cycle_start' for c in commands)
    assert not any(str(c.get('path','')).endswith('bpc_run.ngc') for c in commands)
    if no_keys:
        assert prompts == ['Messlauf ohne Eingabe - bitte keine Taste druecken'], prompts
    else:
        assert len(prompts) == (4 if start == 'A' else 2), prompts
        assert any('Pfeiltaste' in p for p in prompts)
    return {'no_keys':no_keys,'from':start,'to':'S','marks':marks,'commands':commands,'prompts':prompts,'pass':True}

async def main():
    print(json.dumps({'kind':'actual sequence function with all external work stubbed','cases':[await exercise(start, no_keys) for no_keys in (True, False) for start in ('A', 'S')]},ensure_ascii=False,indent=2))

if __name__=='__main__': asyncio.run(main())
