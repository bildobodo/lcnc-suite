"""R362 independent multi-claim commit probes; fake channels only."""
import asyncio, json, os, sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
root=Path('/tmp/codex-r362')
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

results={'target':'45727d61'}
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

class HookClaim(g._StartClaim):
    def __getattribute__(self,name):
        if name=='err_since':
            hook=object.__getattribute__(self,'__dict__').pop('read_hook',None)
            if hook:hook()
        return super().__getattribute__(name)

def case(kind,finish_first):
    events,old,new=setup()
    written=g.link()
    a,b=old.stat,new.stat
    for st in (a,b):
        st.state=lc.RCS_DONE;st.interp_state=lc.INTERP_IDLE
        st.echo_serial_number=100;st.queued_mdi_commands=0;st.exec_state=lc.EXEC_DONE
    owner=g._publish_link(a,old.cmd,old.err,None)
    c1,c2=g._StartClaim('first'),HookClaim('second')
    for i,c in enumerate((c1,c2),7):
        c.state='sent';c.serial=i;c.sent_t=99.;c.link_seq=written.seq
    if finish_first:c1.err_since,c1.err_proof=99.9,('relinked',owner.seq)
    before=(c1.err_since,c1.err_proof)
    if kind=='publish':c2.read_hook=lambda:g._publish_link(b,new.cmd,new.err,None)
    if kind=='revoke':c2.read_hook=lambda:g._revoke_link('review: second claim after first result computed')
    g._source_claims[:]=[c1,c2]
    g._release_after_poll(100.,owner)
    count=len(g._source_claims)
    after=(c1.err_since,c1.err_proof)
    wanted=(count==2 and after==before) if kind!='none' else ((count==1 and g._source_claims==[c2]) if finish_first else (count==2 and c1.err_since==100.))
    return dict(claims=count,first_before=before,first_after=after,second_since=c2.err_since,
                owner_still_current=g.current_link() is owner,contract_holds=wanted)

for finish_first in (False,True):
    for kind in ('none','publish','revoke'):
        results[f'{kind}_after_{"release" if finish_first else "mark"}_computed']=case(kind,finish_first)
assert all(v['contract_holds'] for v in results.values() if isinstance(v,dict))
(root/'probes/commit.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
