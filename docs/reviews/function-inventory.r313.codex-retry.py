"""R313: own pure whole-step cases for errors around a retried start.
PY -B retry.py ARCHIVE OUT_JSON — no socket, machine or HAL access.
"""
import json,sys,tempfile
from pathlib import Path
root=Path(sys.argv[1]);sys.path[:0]=[str(root/'scripts'),str(root/'lcnc-gateway')]
import test_native_stage as t
from test_support.live_session import Refused

t.nr.SHORT_GRACE=.02
class RetryClient(t.TsClient):
    def __init__(self,which,own_error=None):
        super().__init__('p2');self.which,self.own_error,self.refused=which,own_error,False
    def request(self,cmd,**kw):
        trigger=cmd=='cycle_start' and self.starts==self.which
        if trigger and not self.refused:
            self.refused=True
            self._frames({'interp_state':2},{'interp_state':1})
            self.errors.append((self.frames[-1][0],11,'previous rejected attempt: not the accepted start'))
            raise Refused('cycle_start refused: A program or macro is starting or running — wait')
        ans=super().request(cmd,**kw)
        if trigger and self.own_error:
            self.errors.append((self.frames[-1][0],*self.own_error))
        return ans
out={}
for name,which,err,expected in [('first_retry',0,None,'PASS'),('second_retry',1,None,'PASS'),
                               ('second_retry_debug',1,(13,'DEBUG: allowed'),'PASS'),
                               ('second_retry_nml',1,(11,'own NML error'),'FAIL')]:
    with tempfile.TemporaryDirectory(prefix='r313-retry-') as td:
        c=RetryClient(which,err);ctx,step=t._ts_step(Path(td),c);rows=step(ctx)
        verdict=t.nr.verdict({'rows':rows,'restore':{'outcome':'complete','isolation':[]}})
        assert verdict==expected,(name,rows)
        out[name]={'rows':rows,'verdict':verdict,'starts':c.starts,'known_refusal_injected':c.refused}
Path(sys.argv[2]).write_text(json.dumps(out,indent=2)+'\n')
