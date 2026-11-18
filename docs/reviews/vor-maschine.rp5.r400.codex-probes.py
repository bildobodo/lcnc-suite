#!/usr/bin/env python3
"""R398: copies of real merge artifacts, isolated inventory mutations, no drivers imported."""
import argparse,copy,json,shutil,sys,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--gate',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
sys.path.insert(0,str(a.root/'scripts/inventory'));import coverage as c;import functions
out={};real_gate=json.loads(a.gate.read_text());head=real_gate['head']
files=['list-run.json','playwright.json','firefox-list.json','firefox.json','unit-light.list.json','unit-light.json','unit-heavy.list.json','unit-heavy.json','replay.json','firefox-replay.json','backend/backend.junit.xml','unit-light.options.json','unit-heavy.options.json']
with tempfile.TemporaryDirectory(prefix='r398-probes-') as tmp:
 tmp=Path(tmp);gate=tmp/'gate.json';gate.write_text(json.dumps(real_gate));logs=gate.with_suffix('.logs');originals={}
 for name in files:
  q=logs/name;q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(a.gate.with_suffix('.logs')/name,q);originals[name]=q.read_bytes()
 def restore():
  for name,data in originals.items():(logs/name).write_bytes(data)
 def edit(name,fn):
  q=logs/name;d=json.loads(q.read_text());fn(d);q.write_text(json.dumps(d))
 def specs(d):
  yield from d.get('specs',[])
  for x in d.get('suites',[]):yield from specs(x)
 def evaluate(name,natives=None):
  r=c.coverage(gate,natives or [],[],root=a.root)
  out[name]={'verdict':r['verdict'],'errors':r['errors'],'checked':sum(s['checked']=='passed' for f in r['functions'] for s in f['statements']),'native_passes':sum(e['status']=='PASS' for f in r['functions'] for e in f['native']),'estop':next(f for f in r['functions'] if f['id']=='F-ESTOP')['triggered'], 'trigger_totals':{p:sum(sum(v.values()) for f in r['functions'] for cmd,projects in f['triggered']['commands'].items() for p2,v in projects.items() if p2==p and isinstance(v,dict)) for p in ['e2e','firefox-core']}}
  print(name,r['verdict'],len(r['errors']),out[name]['checked']);return r
 evaluate('control')
 # A different readable name does not make a second attempt of the same identity.
 def dup(r):
  entry=next(x for x in r['attempt_list'] if any(k.split(':')[0]=='estop' for k in r['per_attempt'].get(x['name'],{})))
  clone=copy.deepcopy(entry);clone['name']=entry['name']+' [second name, same identity]';r['attempt_list'].append(clone)
  r['per_attempt'][clone['name']]=copy.deepcopy(r['per_attempt'][entry['name']])
  out['duplicated_identity_input']={'original':entry,'duplicate':clone}
 edit('replay.json',dup);evaluate('replay_duplicate_identity');restore()
 # Duplicate result of retry 0: the failing result is overwritten in the map.
 def dup_retry(d):
  sp=next(x for x in specs(d) if x['file']=='setup-gates.spec.ts' and x['title'].startswith('the recovery order:'))
  for t in sp['tests']:
   failed=copy.deepcopy(t['results'][0]);failed['status']='failed';failed['errors']=[{'message':'R398 failed result at the same retry'}];t['results'].insert(0,failed)
 edit('playwright.json',dup_retry);evaluate('browser_duplicate_retry');restore()
 # Native run/row variants must agree; using only the case name hides the mismatch.
 declared=c._literal(a.root/'scripts/test_support/native_cases.py','REPORT_CASES')
 nr={'commit':head,'profile':'3axis_xyz','variant':None,'run_id':'r398-synthetic-native','rows':[{'case':x,'variant':None,'status':'PASS'} for x in declared[None]]}
 np=tmp/'native.json';np.write_text(json.dumps(nr));evaluate('native_control',[np])
 bad=copy.deepcopy(nr);next(x for x in bad['rows'] if x['case']=='home-all')['variant']='latch-delayed';np.write_text(json.dumps(bad));r=evaluate('native_row_variant_mismatch',[np]);out['native_row_variant_mismatch']['home_all']=[x for f in r['functions'] for x in f['native'] if x['title']=='home-all']
 bad=copy.deepcopy(nr);bad['profile']='not-a-profile';np.write_text(json.dumps(bad));evaluate('native_unknown_profile',[np])
 # The actual Vitest reporter/listing, run independently in this archive.
 VOPTS=json.loads(Path('/tmp/r400-vitest-options.json').read_text())  # ADAPTED (R400): the run's options records of the six files
 vlist=json.loads(Path('/tmp/r400-vitest-list.json').read_text());vrep=json.loads(Path('/tmp/r400-vitest-report.json').read_text())
 vlist=[x for x in vlist if '/r398-fixtures/' in x['file']];vrep['testResults']=[x for x in vrep['testResults'] if '/r398-fixtures/' in x['name']];VOPTS=[x for x in VOPTS if '/r398-fixtures/' in x['file']]
 errors=[];vi=c.vitest_index(vlist,vrep,'actual-vitest',errors)
 out['actual_vitest']={'reader_errors':errors,'tests':[{'file':k[0],'name':k[1],'reader':v,'options_fails':next((x['fails'] for x in VOPTS if x['file'].split('/lcnc-webui/src/')[-1]==k[0] and x['fullName']==k[1]),None)} for k,v in vi.items()]}
 original_load=functions.load;web,py,fns=original_load(a.root)
 original_e=next(e for f in fns['functions'] for s in f['statements'] for e in s['evidence'] if e['layer']=='unit')
 out['unit_original_evidence']=copy.deepcopy(original_e)
 # Bind ONE unit evidence to each actual test in turn (other evidence unchanged).
 for (fl,title),status in vi.items():
  changed=copy.deepcopy(fns);ev=next(e for f in changed['functions'] for s in f['statements'] for e in s['evidence'] if e['layer']=='unit');ev.clear();ev.update(layer='unit',file=fl,title=title)
  functions.load=lambda root,x=changed:(web,py,x)
  edit('unit-light.list.json',lambda d:d.extend(vlist));edit('unit-light.json',lambda d:d['testResults'].extend(vrep['testResults']));edit('unit-light.options.json',lambda d:d.extend(VOPTS))  # ADAPTED (R400)
  r=evaluate('unit_'+Path(fl).stem);out['unit_'+Path(fl).stem]['bound_evidence']=[e for f in r['functions'] for s in f['statements'] for e in s['evidence'] if e['layer']=='unit' and e['file']==fl]
  if fl.endswith('/alias.test.ts'):
   clean=(logs/'unit-light.options.json').read_bytes()
   def target(d):return next(x for x in d if x['file'].split('/lcnc-webui/src/')[-1]==fl and x['fullName']==title)
   for kind,val in [('absent',None),('null',None),('string','true'),('number',1)]:
    def mutate(d):
     x=target(d)
     if kind=='absent':x.pop('fails')
     else:x['fails']=val
    edit('unit-light.options.json',mutate)
    r=evaluate('options_fails_'+kind)
    out['options_fails_'+kind]['bound_evidence']=[e for f in r['functions'] for st in f['statements'] for e in st['evidence'] if e['layer']=='unit' and e['file']==fl]
    (logs/'unit-light.options.json').write_bytes(clean)
   # An otherwise valid options row from outside this group's listing may
   # overwrite the other group's actual expected-failure flag.
   other=copy.deepcopy(target(json.loads(clean)));other['fails']=False
   edit('unit-heavy.options.json',lambda d:d.append(other))
   r=evaluate('foreign_heavy_option_overwrites_true')
   out['foreign_heavy_option_overwrites_true']['bound_evidence']=[e for f in r['functions'] for st in f['statements'] for e in st['evidence'] if e['layer']=='unit' and e['file']==fl]
   (logs/'unit-heavy.options.json').write_bytes(originals['unit-heavy.options.json'])
   edit('unit-light.options.json',lambda d:d.remove(target(d)))
   r=evaluate('options_missing_record')
   out['options_missing_record']['bound_evidence']=[e for f in r['functions'] for st in f['statements'] for e in st['evidence'] if e['layer']=='unit' and e['file']==fl]
  restore()
 functions.load=original_load
a.out.write_text(json.dumps({'head':head,'cases':out},indent=2,ensure_ascii=False)+'\n')
