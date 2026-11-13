"""R361 independent boundary probes: only fake channels, real lifecycle methods."""
import asyncio, json, os, sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
root=Path('/tmp/codex-r361')
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

results={'target':'58010ecb'}
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

# The INI represents the SAME TWP machine across reconnects. Only channel
# availability changes; never a different physical machine/configuration.
class Ini:
    hook = None
    unreadable = False
    def __init__(self, path):
        if Ini.hook:
            hook, Ini.hook = Ini.hook, None
            hook()
        if Ini.unreadable:
            raise OSError("review: transient INI read failure")
    def find(self, section, key):
        return "xyzacb_trsrn" if (section,key)==("KINS","KINEMATICS") else None
    def findall(self, section, key):
        return []

def boot_setup():
    events,old,new=setup(oldmode=lc.MODE_MDI)
    for c in (old,new):
        c.stat.g5x_index=7
        c.stat.ini_filename='/review/same-twp.ini'
    g._publish_link(old.stat,old.cmd,old.err,None)
    g._reserved_heal_checked=False
    g._reserved_heal_decl_tried=0
    g._reserved_heal_pending=None
    g._reserved_fixture_warning=''
    g._reserved_heal_inflight=False
    Ini.unreadable=False;Ini.hook=None
    return events,old,new

def snap():
    return dict(checked=g._reserved_heal_checked,pending=g._reserved_heal_pending,
                warning=g._reserved_fixture_warning,link=g.current_link() is not None)

st=SimpleNamespace(g5x_index=7,twp_active=False,permissions={})

def boot_case(revoke):
    events,old,new=boot_setup()
    with patch.object(lc,'ini',Ini):
        if revoke:Ini.hook=lambda:g._revoke_link('review: transport fails during INI read')
        g._reserved_fixture_heal_tick(st)
        first=snap()
        if revoke:g._publish_link(new.stat,new.cmd,new.err,None)
        g._reserved_heal_decl_tried=0
        g._reserved_fixture_heal_tick(st)
        return dict(first=first,after_reconnect=snap(),decl=g._parse_kins_decl(),events=events)

async def queued_heal_case(loss):
    events,old,new=boot_setup()
    traced=[]
    with patch.object(lc,'ini',Ini),patch.object(g._trace,'emit',lambda name,**kw:traced.append([name,kw])):
        g._reserved_fixture_heal_tick(st)  # actual initial detection, not a fabricated pending bit
        before=snap()
        lock=g._get_cmd_lock()
        await lock.acquire()
        task=asyncio.create_task(g._reserved_fixture_heal())
        await asyncio.sleep(0) # the heal is now awaiting the real command lock
        if loss=='no_link':g._revoke_link('review: transport failed while heal waited')
        if loss=='unread_ini':
            g._publish_link(new.stat,new.cmd,new.err,None)
            Ini.unreadable=True
        lock.release()
        # No motion: the unknown cases must defer before writes. The success
        # control uses a non-ready fresh gate so it also never writes.
        with patch.object(g,'_reader_fresh_get',return_value=0),patch.object(g,'_controller_gate_refusal',return_value='review: not ready'):
            await task
        after=snap()
        Ini.unreadable=False
        if loss=='no_link':g._publish_link(new.stat,new.cmd,new.err,None)
        g._reserved_fixture_heal_tick(st)
        return dict(before=before,after_heal=after,after_reconnect=snap(),events=events,trace=traced)

class SwitchingStat(Stat):
    read_hook=None
    @property
    def echo_serial_number(self):
        if self.read_hook:
            hook,self.read_hook=self.read_hook,None
            hook()
        return 100

def claim_race(kind):
    events,old,new=setup(oldmode=lc.MODE_MDI)
    c=g._StartClaim('mdi');c.state='sent';c.serial=41;c.sent_t=99.0;c.link_seq=g.link().seq
    g._source_claims[:]=[c]
    a=SwitchingStat('polled',lc.MODE_MDI,events)
    b=Stat('replacement',lc.MODE_MDI,events)
    for v in (a,b):
        v.state=lc.RCS_DONE;v.interp_state=lc.INTERP_IDLE
        v.queued_mdi_commands=0;v.exec_state=lc.EXEC_DONE
    b.echo_serial_number=100
    if kind=='publish':a.interp_state=2  # the actually-polled channel is NOT idle
    pa=g._publish_link(a,Chan('polled',a,events),old.err,None)
    if kind=='publish':
        a.read_hook=lambda:g._publish_link(b,Chan('replacement',b,events),old.err,None)
    elif kind=='revoke':
        a.read_hook=lambda:g._revoke_link('review: lost during proof read')
    # Capture a second race after the OLD fields have all been read: current
    # code reaches safe_get exec_state last, then gets current_link again.
    if kind=='revoke_after_fields':
        inner=g.safe_get
        def read(attr,default=None):
            value=inner(attr,default)
            if attr=='exec_state':g._revoke_link('review: lost after proof fields')
            return value
        ctx=patch.object(g,'safe_get',side_effect=read)
    else:
        from contextlib import nullcontext
        ctx=nullcontext()
    a.poll()  # only A was polled before this release attempt
    with ctx:g._release_after_poll(100.000,pa)
    first=dict(claims=len(g._source_claims),err_since=c.err_since,proof=c.err_proof,
               current_seq=g.current_link().seq if g.current_link() else None,polled_seq=pa.seq)
    if kind=='publish':
        b.poll()  # B first becomes a sample in THIS release attempt
        g._release_after_poll(100.025,g.current_link())
    return dict(events=events,first=first,after_first_current_poll=dict(claims=len(g._source_claims),err_since=c.err_since,proof=c.err_proof))

results['boot_control']=boot_case(False)
results['boot_read_loses_link']=boot_case(True)
for loss in ('none','no_link','unread_ini'):
    results['queued_heal_'+loss]=asyncio.run(queued_heal_case(loss))
for race in ('none','publish','revoke','revoke_after_fields'):
    results['claim_'+race]=claim_race(race)
assert results['boot_control']['first']['pending'] == 7
assert results['queued_heal_none']['after_heal']['pending'] == 7
assert results['queued_heal_no_link']['before']['pending'] == 7
assert results['queued_heal_unread_ini']['before']['pending'] == 7
results['contract_checks'] = {
    'control_boot_detects_twp': results['boot_control']['first']['pending'] == 7,
    'control_queued_not_ready_retains_warning': results['queued_heal_none']['after_heal']['pending'] == 7,
    'boot_loss_does_not_spend_check': not results['boot_read_loses_link']['first']['checked'],
    'queued_heal_no_link_retains_pending': results['queued_heal_no_link']['after_heal']['pending'] == 7,
    'queued_heal_unread_ini_retains_pending': results['queued_heal_unread_ini']['after_heal']['pending'] == 7,
    'control_first_quiet_sample_retains_claim': results['claim_none']['first']['claims'] == 1,
    'control_lost_before_fields_retains_claim': results['claim_revoke']['first']['claims'] == 1,
    'replacement_needs_own_first_sample': results['claim_publish']['first']['err_since'] is None,
    'replacement_first_sample_cannot_finish_window': results['claim_publish']['after_first_current_poll']['claims'] == 1,
    'lost_after_fields_retains_claim': results['claim_revoke_after_fields']['first']['claims'] == 1,
}
(root/'probes/boundary.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
