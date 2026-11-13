"""R359 deterministic offline probes; fake channels, no live instance/service."""
import asyncio, json, os, sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
root=Path('/tmp/codex-r359')
os.environ['LCNC_LOG_DIR']=str(root/'probes/probe-logs')
os.environ.pop('LCNC_LAUNCHER_PID',None)
os.environ.pop('LCNC_INI_FILE',None)
sys.path.insert(0,str(root/'lcnc-gateway'))
import fake_linuxcnc
lc=fake_linuxcnc.install()
import session_bind
with patch.object(session_bind,'discover_instance',return_value=(None,[])):
    import gateway as g
from link_fixture import FakeConnection, swap_connection

results={'target':'999a8ca9'}
class Stat:
    def __init__(self, name, mode, events):
        self.name,self.task_mode,self.events=name,mode,events
        self.interp_state=lc.INTERP_IDLE
        self.task_state=lc.STATE_ON
        self.paused=False
        self.ini_filename=''
        self.homed=(1,1,1);self.joints=3
        self.hook=None
    def poll(self):
        self.events.append(['poll',self.name,self.task_mode])
        if self.hook:
            f,self.hook=self.hook,None;f()
class Chan:
    def __init__(self,name,stat,events,changes_mode=True):
        self.name,self.stat,self.events=name,stat,events
        self.serial=40 if name=='old' else 80
        self.changes_mode=changes_mode
        self.hook=None
        self.on_mdi=None
    def mode(self,mode):
        self.serial+=1; self.events.append(['mode',self.name,mode,self.serial])
        if self.changes_mode:self.stat.task_mode=mode
    def mdi(self,text):
        self.serial+=1; self.events.append(['mdi',self.name,text,self.serial])
        if self.on_mdi:
            f,self.on_mdi=self.on_mdi,None;f()
    def abort(self):
        self.serial+=1; self.events.append(['abort',self.name,self.serial])
    def wait_complete(self,timeout):
        self.events.append(['wait',self.name,self.serial])
        if self.hook:
            f,self.hook=self.hook,None;f()
        return lc.RCS_DONE

def setup(oldmode=lc.MODE_MANUAL,newmode=lc.MODE_MDI,changes_mode=True):
    events=[]
    oldstat,newstat=Stat('old',oldmode,events),Stat('new',newmode,events)
    old=FakeConnection(oldstat,Chan('old',oldstat,events,changes_mode))
    new=FakeConnection(newstat,Chan('new',newstat,events))
    swap_connection(old)
    g._cmd_lock=None;g._source_lock=None;g._source_claims=[];g._active_jogs.clear()
    return events,old,new
async def mode_case(swap,oldchanges):
    events,old,new=setup(changes_mode=oldchanges)
    if swap:old.cmd.hook=lambda:swap_connection(new)
    try:
        async with g._get_cmd_lock():await g.set_mode(lc.MODE_MDI)
        outcome={'ok':True}
    except Exception as e:outcome={'ok':False,'exception':type(e).__name__,'error':str(e)}
    return dict(outcome,events=events,old_mode=old.stat.task_mode,new_mode=new.stat.task_mode,
                published=g.link().stat.name)
async def compound_case(swap):
    events,old,new=setup()
    if swap:old.cmd.hook=lambda:swap_connection(new)
    async def start_guard(*a,**k):return None
    # Startguard/toolsetter dependencies isolated; real mode switch, real
    # dispatch group, real _cmd_blocking and its serial/claim/wait path.
    with patch.object(g,'_start_guard',start_guard),patch.object(g,'_ts_mark_assumed',lambda x:None),patch.object(g,'_remap_env',lambda:None),patch.object(g,'toolsetter_assigned_keys',lambda *a:[]):
        try:
            async with g._get_cmd_lock():
                reply=await g._cmds_mdi_and_frames('mdi',{'cmd':'mdi','text':'G4 P0'},True,None)
        except Exception as e:reply={'ok':False,'exception':type(e).__name__,'error':str(e)}
    return {'reply':reply,'events':events,'published':g.link().stat.name}
async def two_write_case(swap):
    # No mode switch: isolate the ownership of tool_change's actual T/M6
    # and G43 blocks. Only fake channels receive them, never a machine.
    events,old,new=setup(oldmode=lc.MODE_MDI)
    if swap:old.cmd.on_mdi=lambda:swap_connection(new)
    async def start_guard(*a,**k):return None
    # Startguard/toolsetter dependencies isolated; real tool_change body,
    # mode helper, writes, claims and waits. No invented command plan.
    with patch.object(g,'_start_guard',start_guard),patch.object(g,'_ts_mark_assumed',lambda x:None),patch.object(g,'_remap_env',lambda:None),patch.object(g,'toolsetter_assigned_keys',lambda *a:[]):
        try:
            async with g._get_cmd_lock():
                reply=await g._cmds_tool_table('tool_change',{'cmd':'tool_change','tool_number':7},True,None)
        except Exception as e:reply={'ok':False,'exception':type(e).__name__,'error':str(e)}
    return {'reply':reply,'events':events,'published':g.link().stat.name}
async def admit_swap_case(raises=False):
    events,old,new=setup();conn=g.link()
    claim=SimpleNamespace(state='pending',serial=None,sent_t=None)
    def admit():
        conn.stat.poll();swap_connection(new)
        if raises:raise RuntimeError('admit failed')
        return None
    try:
        async with g._get_cmd_lock():
            await g._cmd_blocking(conn,g.op(lc.command.abort),wait=None,claim=claim,admit=admit)
        outcome={'ok':True}
    except Exception as e:outcome={'ok':False,'exception':type(e).__name__,'error':str(e)}
    return dict(outcome,events=events,claim=vars(claim))

results['mode_refused_without_swap']=asyncio.run(mode_case(False,False))
results['mode_refused_old_but_new_mode_matches']=asyncio.run(mode_case(True,False))
results['mode_success_without_swap']=asyncio.run(mode_case(False,True))
results['mdi_without_swap']=asyncio.run(compound_case(False))
results['mdi_swap_during_mode_wait']=asyncio.run(compound_case(True))
results['two_write_without_swap']=asyncio.run(two_write_case(False))
results['two_write_swap_after_first']=asyncio.run(two_write_case(True))
results['admission_swaps']=asyncio.run(admit_swap_case())
results['admission_swaps_then_raises']=asyncio.run(admit_swap_case(True))

# A failed preliminary NML probe must not leave the previous channel admitted.
events,old,new=setup();conn=g.link()
with patch.object(g,'_instance_ended',False),patch.object(g,'_nml_connectable',return_value=False):
    connected=g.try_connect_lcnc()
    async def write_after_failed_connect():
        async with g._get_cmd_lock():
            return await g._cmd_blocking(conn,g.op(lc.command.abort),wait=None)
    result=asyncio.run(write_after_failed_connect())
results['failed_nml_precheck']={'connect_return':connected,'old_still_current':g.current_link() is conn,'write_result':result,'events':events}

# Terminal instance end after connect started, before its local channels publish.
events,old,new=setup();ident=(111,222)
ends=[]
def identified_then_ended(pid):
    snapshot=ident
    g._on_instance_ended('review: terminal event after identity snapshot')
    return snapshot
with patch.object(g,'_instance_ended',False),patch.object(g,'_bound_instance',ident),patch.object(g,'_request_process_shutdown',ends.append),patch.object(g,'_hal_disconnect',lambda:None),patch.object(g,'_nml_connectable',return_value=True),patch.object(g,'_get_lcnc_pid',return_value=ident[0]),patch.object(session_bind,'instance_for_pid',side_effect=identified_then_ended),patch.object(lc,'stat',return_value=old.stat),patch.object(lc,'command',return_value=old.cmd):
    connected=g.try_connect_lcnc()
    results['terminal_event_during_connect']={'connect_return':connected,'instance_ended':g._instance_ended,'published':g.current_link() is not None,'shutdown_requests':ends,'events':events}
(root/'probes/probe.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
