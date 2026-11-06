"""R312: real gateway with repository fake_linuxcnc only; no live transport.
Usage: PY -B probe_a.py ARCHIVE_A OUT_JSON
"""
import asyncio,json,sys,unittest.mock as mock
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'lcnc-gateway'))
import test_toolsetter_sync as ts
import gateway as g
import toolsetter_rules as tr
out={}
case=ts.TestProgramStartSync()
case.setUp()
g._shared_status=ts.td._payload()
try:
    basis=g._toolsetter_basis()
    original=g._cmd_blocking
    async def before_write(fn,*args,**kw):
        if getattr(fn,'__name__','')=='record' and args==(g.linuxcnc.MODE_AUTO,):
            case.section['toolsetter']['touchZ']=-150
        return await original(fn,*args,**kw)
    # The recording test command uses the generic callable name 'record'.
    with mock.patch.object(g,'_cmd_blocking',before_write):
        ts.td._run(g._rfl_sequence(7,0,False,None,0,basis=basis))
    writes=[{'cmd':n,'args':list(a)} for n,a,k in case.cmd.calls if n in ('mode','auto','mdi')]
    out['basis_changed_at_rfl_auto_switch']={'writes':writes,'phase':g._rfl_status,
        'expected':'No AUTO mode write after the basis changed; the write-thread admit must reject it.'}
    assert not any(x['cmd']=='mode' and x['args']==[g.linuxcnc.MODE_AUTO] for x in writes), out
    assert not any(x['cmd']=='auto' for x in writes),out
    assert 'changed meanwhile' in g._rfl_status['error'],out
finally:
    case.doCleanups()
section={**ts.SECTION,'touchZ':-179.0078125}
r=tr.setup(section)
assert r['ok']
out['rounding']={'section':section,'booking':{'version':1,'keys':{str(k):{'value':v,'origin':'applied'} for k,v in r['values'].items()}},'expected':'confirmed','sent_3102':r['values'][3102]}
Path(sys.argv[2]).write_text(json.dumps(out,indent=2)+"\n")
