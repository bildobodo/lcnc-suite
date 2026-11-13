"""R359 deterministic offline probes; fake channels, no live instance/service."""
import asyncio, json, os, sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
root=Path('/tmp/codex-r360-final')
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

results={'target':'3aae6337'}
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
                with g._pinned_link():
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
                with g._pinned_link():
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
    try:result=asyncio.run(write_after_failed_connect())
    except Exception as e:result={'exception':type(e).__name__,'error':str(e)}
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
# Additional R360 checks of cache publication and completion of read-back.
import contextvars
from dataclasses import asdict

def reset_caches():
    g._ini_config=None
    g._machine_limits=None
    g._joint_jog_cache=None

def cached_limits_case(swap):
    events,old,new=setup(oldmode=lc.MODE_MDI)
    old.stat.axis_mask=7;old.stat.joints=3;old.stat.ini_filename='/old.ini'
    new.stat.axis_mask=31;new.stat.joints=5;new.stat.ini_filename='/new.ini'
    reset_caches()
    g._ini_config={'max_jog_velocity':100.0}
    def reconnect_and_read_ini():
        reset_caches();swap_connection(new)
        # A reader in the new context has already read the new INI.
        g._ini_config={'max_jog_velocity':2.0}
    if swap:old.stat.hook=reconnect_and_read_ini
    with patch.object(g,'_declared_var_numbers',return_value=frozenset()):
        with g._pinned_link():mine=g.get_machine_limits()
        next_read=g.get_machine_limits()
        reset_caches();g._ini_config={'max_jog_velocity':2.0 if swap else 100.0}
        clean=g.get_machine_limits()
    fields=lambda v:{k:getattr(v,k) for k in ('n_axes','n_joints','max_jog_velocity')}
    return {'old_result':fields(mine),'next_context':fields(next_read),'uncached_current':fields(clean),'events':events}

def joint_cache_case(swap):
    events,old,new=setup(oldmode=lc.MODE_MDI)
    for c,path in ((old,'/old.ini'),(new,'/new.ini')):
        c.stat.axis_mask=7;c.stat.joints=3;c.stat.ini_filename=path
    reset_caches()
    class Ini:
        def __init__(self,path):
            self.path=path
            if swap and path=='/old.ini':reset_caches();swap_connection(new)
        def find(self,section,key):
            if key=='WEBUI_JOINT_JOG_BEFORE_HOMING':return '1' if self.path=='/old.ini' else '0'
            if key=='WEBUI_JOINT_AXES':return 'X Y Z'
            if section.startswith('JOINT_') and key=='MAX_VELOCITY':return '10'
            return None
    with patch.object(lc,'ini',Ini):
        with g._pinned_link():mine=g._joint_jog_facts()
        next_read=g._joint_jog_facts()
        reset_caches()
        clean=g._joint_jog_facts()
    return {'old_result':mine,'next_context':next_read,'uncached_current':clean,'events':events}

async def readback_case(swap_at):
    events,old,new=setup(oldmode=lc.MODE_MDI)
    g._var_file_lock=None
    g._ts_basis={};g._ts_basis_version=0
    path=root/'probes'/('readback-'+str(swap_at)+'.var')
    def replace(value):
        tmp=path.with_suffix('.tmp')
        tmp.write_text(''.join(f'{k} {value}\n' for k in g.TOOLSETTER_BASIS_KEYS))
        tmp.replace(path)
    replace(1.0)
    g._ts_book({k:1.0 for k in g.TOOLSETTER_BASIS_KEYS},'assumed')
    def synch():
        old.cmd.serial+=1
        events.append(['synch','old',old.cmd.serial])
        replace(2.0)  # actual new inode, written by the old interpreter's synch
    old.cmd.task_plan_synch=synch
    if swap_at=='wait':old.cmd.hook=lambda:swap_connection(new)
    real_read=g.read_var_snapshot
    count=0
    def read(*a,**kw):
        nonlocal count
        val=real_read(*a,**kw);count+=1
        if swap_at=='last_read' and count==2:swap_connection(new)
        return val
    traced=[]
    with patch.object(g,'_resolve_var_file_path',return_value=str(path)),patch.object(g,'read_var_snapshot',side_effect=read),patch.object(g._trace,'emit',lambda name,**kw:traced.append([name,kw])):
        await g._ts_read_back('probe.ngc')
    return {'published':g.link().stat.name,'basis':g.toolsetter_basis_view(g._ts_basis),
            'origins':sorted(set(v['origin'] for v in g._ts_basis.values())),
            'values':sorted(set(v['value'] for v in g._ts_basis.values())),
            'events':events,'trace':traced}

async def heal_completion_case(swap):
    events,old,new=setup(oldmode=lc.MODE_MDI)
    old.stat.g5x_index=7;new.stat.g5x_index=7
    g._reserved_heal_pending=7
    g._reserved_fixture_warning='reserved fixture'
    g._reserved_heal_inflight=False
    mdi=old.cmd.mdi
    def select(text):
        mdi(text)
        if text=='G54':old.stat.g5x_index=1
    old.cmd.mdi=select
    if swap:old.cmd.hook=lambda:swap_connection(new)
    traced=[]
    with patch.object(g,'_twp_capable',return_value=True),patch.object(g,'_reader_fresh_get',return_value=0),patch.object(g,'_controller_gate_refusal',return_value=None),patch.object(g,'_ts_mark_assumed',lambda x:None),patch.object(g,'_remap_env',lambda:None),patch.object(g,'toolsetter_assigned_keys',lambda *a:[]),patch.object(g._trace,'emit',lambda name,**kw:traced.append([name,kw])):
        await g._reserved_fixture_heal()
    return {'events':events,'trace':traced,'published':g.link().stat.name,'current_fixture':g.link().stat.g5x_index,'pending':g._reserved_heal_pending,'warning':g._reserved_fixture_warning}

results['limits_without_swap']=cached_limits_case(False)
results['limits_swap_during_poll']=cached_limits_case(True)
results['joint_cache_without_swap']=joint_cache_case(False)
results['joint_cache_swap_during_ini']=joint_cache_case(True)
for when in ('none','wait','last_read'):
    results['readback_'+when]=asyncio.run(readback_case(when))
results['heal_completion_control']=asyncio.run(heal_completion_case(False))
results['heal_completion_swap']=asyncio.run(heal_completion_case(True))
# The first poll started BEFORE the write; its result is handled after it.
# A second poll starts only 5 ms after the write: no 20 ms post-write
# quiet window has been observed. The same-link path already checks sent_t.
def claim_window_case(relinked):
    events,old,new=setup(oldmode=lc.MODE_MDI)
    written_on=g.link()
    c=g._StartClaim('mdi');c.state='sent';c.serial=41;c.sent_t=100.100
    c.link_seq=written_on.seq
    g._source_claims[:]=[c]
    if relinked:swap_connection(new)
    stat=g.link().stat
    stat.state=lc.RCS_ERROR;stat.interp_state=lc.INTERP_IDLE
    stat.queued_mdi_commands=0;stat.exec_state=lc.EXEC_DONE
    stat.echo_serial_number=41
    counts=[]
    for began in (100.000,100.105,100.130):
        g._release_start_claims(began)
        counts.append({'poll_started':began,'claims':len(g._source_claims),'err_since':c.err_since})
    return {'sent_t':c.sent_t,'proof_window':g._CLAIM_ERROR_PROOF_S,'observations':counts}
results['claim_window_same_link']=claim_window_case(False)
results['claim_window_relinked']=claim_window_case(True)
(root/'probes/probe.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
