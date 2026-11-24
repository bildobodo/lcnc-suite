"""R465: isolated original preempt function + plan wait model; stored rule-R evidence.
No gateway import, HTTP/WS connection or controller activity.
"""
import ast, asyncio, hashlib, json, sys, time
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, '/tmp/r465/probes')
from rule_check import head_parser, rule
from rule_check2 import home_memory
ROOT=Path('/tmp/r465/src')
EVIDENCE=Path('/home/cnc/lcnc-suite-p6f8/scratch/p6f8')
async def preempt_case(registered):
    src=(ROOT/'lcnc-gateway/gateway.py').read_text()
    node=next(n for n in ast.parse(src).body if isinstance(n,ast.FunctionDef) and n.name=='_preempt_inflight')
    events=[]
    ns={'time':time,'_clients':{},'_WS_NO_PREEMPT':{'abort','estop'},'_rfl_task':None,
        '_ts_readback_task':None,'_reserved_heal_task':None,
        '_trace':SimpleNamespace(emit=lambda *a,**k:events.append([a,k]))}
    exec(compile(ast.Module(body=[node],type_ignores=[]),'original:_preempt_inflight','exec'),ns)
    lock=asyncio.Lock(); entered=asyncio.Event(); done=asyncio.Event()
    async def post_section_wait():
        async with lock:
            entered.set()  # shielded writes already ended; new plan §4 wait begins
            await done.wait()
    waiting=asyncio.create_task(post_section_wait()); await entered.wait()
    if registered:
        ns['_clients'][1]=SimpleNamespace(cmd_inflight_task=waiting,cmd_inflight='save_tool',cmd_inflight_since_mono=time.monotonic())
    victims=ns['_preempt_inflight']('abort',2)
    stop_entered=asyncio.Event()
    async def stop():
        async with lock:stop_entered.set()
    stop_task=asyncio.create_task(stop())
    for _ in range(3):await asyncio.sleep(0)
    observed={'registered_as_ws':registered,'preempted_victims':victims,'wait_cancelled':waiting.cancelled(),
              'stop_reached_lock':stop_entered.is_set()}
    if registered:
        assert waiting.cancelled() and stop_entered.is_set()
    else:
        assert not waiting.done() and not stop_entered.is_set() and lock.locked()
    done.set()
    await asyncio.gather(waiting,return_exceptions=True); await stop_task
    return observed
async def main():
    p,err=head_parser(ROOT/'lcnc-gateway/tool_table.py')
    cps=json.loads((EVIDENCE/'toolfile/run2-checkpoints.json').read_text())['checkpoints']
    rows=[]
    for cp in cps:
        mem,dups=home_memory(cp['stat_tool_table'])
        complete,proven,unread=rule(cp['bytes'],mem,p,err)
        assert complete and not dups and not unread
        rows.append({'name':cp['name'],'complete':complete,'proven':len(proven)})
    # A persisted incomplete file and a paused writer have identical observations.
    memory={1:{'D':6.0},2:{'D':8.0}}
    cut='T1 P1 D6\n'
    complete,proven,_=rule(cut,memory,p,err)
    assert not complete and sorted(proven)==[1]
    # Rule's tolerance means a truncated final numeric token can be proven;
    # it remains partial (no newline), and is not proof that io finished.
    complete2,proven2,_=rule('T1 P1 D+1.00000',{1:{'D':1.00000051}},p,err)
    assert not complete2 and 1 in proven2
    result={'review':'R465','base':'6c78780c','preemption':[await preempt_case(False),await preempt_case(True)],
      'rule_R_real_checkpoints':rows,'indistinguishable_partial':{'bytes':cut,'complete':complete,'proven':list(proven),
        'states':['writer paused at this prefix','writer closed this incomplete file; no write active']},
      'rounding_cut':{'correct_io_token':'D+1.000001','cut':'D+1.00000','memory':1.00000051,'proven':list(proven2),'complete':complete2},
      'hashes':{str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in [ROOT/'lcnc-gateway/gateway.py',ROOT/'lcnc-gateway/tool_table.py',EVIDENCE/'toolfile/run2-checkpoints.json',Path('/tmp/r465/probes/rule_check.py')]},
      'limits':['HTTP wait is the proposed new section, modelled with Events; _preempt_inflight is original source.',
                'No native run; stored checkpoints are reevaluated.'], 'status':'PASS'}
    print(json.dumps(result,indent=2))
asyncio.run(main())
