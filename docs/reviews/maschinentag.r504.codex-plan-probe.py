"""R504: executable model of plan v3 A/C. No product implementation tested."""
import json
from copy import deepcopy

def redeem(asks, cmd, job):
    a=asks.get(cmd['conn'])
    valid=(a is not None and cmd['ask_id']==a['ask_id']
        and all(cmd[k]==a[k] for k in ('attempt','program','action','line','digest'))
        and cmd['kind'] in a['offers'])
    if not valid: return None
    del asks[cmd['conn']]
    return {**deepcopy(a),'kind':cmd['kind'],'job':job}

def matches(proof, s, job):
    if not proof or proof['job']!=job: return False
    if any(proof[k]!=s[k] for k in ('program','action','line','digest')): return False
    if proof['kind']=='unchecked': return True
    expected=('running',None) if proof['kind']=='continue' else ('ended','restricted')
    return s['verified'] and s['version']==proof['version'] and (s['calc'],s['result'])==expected

def action(a,p,policy):
    if not a['valid']: return (1,None)
    no_consent=p['calc']=='ended' and (p['result'] in ('full-clear','full-findings') or (p['result']=='restricted' and policy=='no'))
    if p['version']>a['version'] and no_consent: return (2,None)
    if not a['verified']: return (3,'unchecked')
    if p['version']==a['version'] and p['calc']=='running' and 'continue' in a['offers']: return (4,'continue')
    if p['version']==a['version'] and (p['calc'],p['result'])==('ended','restricted') and policy=='ask' and 'limited' in a['offers']: return (5,'limited')
    if p['version']==a['version'] and no_consent: return (6,None)
    return (7,'unchecked')

ask=dict(ask_id=7,conn='c',attempt=1,program='p',version=10,verified=True,action='start',line=0,digest='job1',offers=['continue','unchecked'])
cmd={k:ask[k] for k in ('ask_id','conn','attempt','program','action','line','digest')}; cmd['kind']='continue'
open_asks={'c':ask}; proof=redeem(open_asks,cmd,'owner1')
s={**ask,'calc':'running','result':None}
chain=[matches(proof,s,'owner1') for _ in ('entry','record','write')]
assert chain==[True,True,True] and not open_asks
assert redeem(open_asks,cmd,'owner2') is None and not matches(proof,s,'owner2')
assert not matches(proof,{**s,'version':11},'owner1')
assert matches({**proof,'kind':'unchecked'},{**s,'version':11,'verified':False},'owner1')
a={**ask,'valid':True}
cases=[
 ('gateway_denies_finished_old',{**a,'verified':False},dict(version=10,calc='ended',result='full-clear'),'no',(3,'unchecked')),
 ('restricted_ask',{**a,'offers':['limited','unchecked']},dict(version=10,calc='ended',result='restricted'),'ask',(5,'limited')),
 ('restricted_no',a,dict(version=10,calc='ended',result='restricted'),'no',(6,None)),
 ('continue_to_not_checked',a,dict(version=10,calc='not_checked',result=None),'no',(7,'unchecked')),
 ('running',a,dict(version=10,calc='running',result=None),'no',(4,'continue')),
 ('newer_finished_old_ask',{**a,'verified':False},dict(version=11,calc='ended',result='full-clear'),'no',(2,None)),
 ('new_ask_still_denied',{**a,'verified':False,'version':11},dict(version=11,calc='ended',result='full-clear'),'no',(3,'unchecked')),
 ('superseded',{**a,'valid':False},dict(version=10,calc='running',result=None),'no',(1,None)),
]
rows=[]
for name,a,p,policy,expected in cases:
    got=action(a,p,policy)
    assert got==expected,(name,got,expected)
    rows.append(dict(case=name,row=got[0],consent=got[1]))
print(json.dumps({'review':'R504','kind':'Plan model, not product tests','positive_chain':chain,'second_job_refused':True,'changed_version_continue_refused':True,'changed_version_unchecked_matches':True,'action_cases':rows,'limits':['No implementation exists for this new flow.','No gateway, browser, native or performance test.','Does not prove future coverage from a limited consent; Q-C10 wording is decided in the review.']},indent=2))
