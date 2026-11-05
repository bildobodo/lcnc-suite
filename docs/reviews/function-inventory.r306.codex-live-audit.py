"""R306 read-only re-evaluation of recorded native sections. No live access.
argv: reviewed archive, recorded run directory. Does not re-run the machine.
"""
import collections, hashlib, json, math, sys
from pathlib import Path
ROOT, RUN=map(Path,sys.argv[1:3])
sys.path.insert(0,str(ROOT/'scripts'))
from test_support import servo_cases as sc
import native_run as nr
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
r=json.loads((RUN/'report.json').read_text()); by={x['case']:x for x in r['rows']}
out={'code_head':r['commit'],'run':str(RUN),'profile':r['profile'],
     'report_sha256':sha(RUN/'report.json'),'reported_verdict':r['verdict'],'recomputed_verdict':nr.verdict(r),
     'row_counts':dict(collections.Counter(x['status'] for x in r['rows'])),
     'effective_row_counts':dict(collections.Counter(x['status'] for x in r['rows'] if not x.get('informational'))),
     'sections':[],'limits':[
         'No machine or simulator rerun. Non-servo row verdicts below come from the saved report.',
         'Raw section files contain their body; end-marker receipt and integrity edge readings are recorded in report.json.',
         'Jog response timestamps are not separately stored. Re-evaluation uses the reported anchor and rounded standstill delay to bound the compatible timestamp; it cannot independently prove which reply was received then.',
         'The RFL program-line interpretation and start-point verdict remain for 2c-b.']}
for a in r['servo_sections']:
 p=RUN/a['file']; raw=[json.loads(l) for l in p.read_text().splitlines()]; integ=a['integrity']
 checks={'sample_count':len(raw)==a['samples'],'first_n':raw[0][1]==a['first_n'],
         'end_boundary_n':raw[-1][1]+1==a['end_n'],
         'consecutive_n':all(b[1]==x[1]+1 for x,b in zip(raw,raw[1:])),
         'receipt_monotonic':all(b[0]>=x[0] for x,b in zip(raw,raw[1:])),
         'own_mark_only':all(x[2][-1]==a['start_mark'] for x in raw),
         'finite_channels':all(math.isfinite(v) for _,_,vs in raw for v in vs),
         'both_enabled':integ['enable_start'] is True and integ['enable_end'] is True,
         'overrun_unchanged_zero':integ['overruns_start']==integ['overruns_end']==0,
         'period_edges_ini':integ['period_ns_start']==integ['period_ns_end']==integ['ini_period_ns']==1000000,
         'same_thread_sampler_last':integ['thread_start']==integ['thread_end'] and integ['thread_end'][-1]=='sampler.0',
         'fifo_below_capacity':integ['depth_end']<integ['depth'],'no_reported_problem':not a['problems'] and not a['end_error']}
 rec={'case':a['case'],'file':a['file'],'sha256':sha(p),'samples':len(raw),'checks':checks}
 sec={'samples':raw,'problems':[] if all(checks.values()) else [k for k,v in checks.items() if not v]}
 if a['case'].startswith('jog-'):
  row=by[a['case']]; ai=next(i for i,x in enumerate(raw) if x[1]==row['anchor_n']); ref=next(x for x in raw if x[1]==row['standstill_n'])
  rounded=ref[0]-row['standstill_received_s']
  lo=max(raw[ai][0]+1e-9,rounded-.00005); hi=min(raw[ai+1][0],rounded+.00005)
  rec['compatible_response_time']=[lo,hi]; rec['checks']['response_interval_exists']=lo<=hi
  ev=[sc.eval_jog_servo(a['case'],'XYZ'.index(row['axis']),row['sign'],sec,t) for t in (lo,(lo+hi)/2,hi)]
  rec['recomputed']=[{k:x[k] for k in ['status','travel_mm','brake_upper_mm','standstill_n','standstill_received_s']} for x in ev]
  rec['checks']['same_result_at_response_bounds']=all(x['status']==row['status'] and x['brake_upper_mm']==row['brake_upper_mm'] for x in ev)
 elif a['case'].startswith('override-plateau'):
  ev=sc.eval_plateau(a['case'],sec,by[a['case']]['expected'],.001)
  rec['recomputed']=ev; rec['checks']['same_verdict']=ev['status']==by[a['case']]['status']
 elif a['case'].startswith('goto-'):
  counter=a['case'].endswith('counter-xy-first'); row=by[a['case']]['inner'] if counter else by[a['case']]
  ev=sc.eval_retract_path(a['case'],sec,row['start'],row['target'])
  rec['recomputed']=ev; rec['checks']['same_verdict']=ev['status']==row['status']
 else:
  rec['program_line_counts']=dict(collections.Counter(str(v[6]) for _,_,v in raw))
  rec['evaluation']='deferred to 2c-b'
 out['sections'].append(rec)
for n in ['restore.json','restore-post.json']:
 d=json.loads((RUN/n).read_text()); out[n]={'sha256':sha(RUN/n),'saved_result':d}
out['same_returned_instance']=out['restore.json']['saved_result']['instance']==out['restore-post.json']['saved_result']['instance']
pre=json.loads((RUN/'pre.json').read_text()); state=json.loads((RUN/'state.json').read_text())
out['isolation']={'pre_sha256':sha(RUN/'pre.json'),'state_sha256':sha(RUN/'state.json'),
                  'recorded_hash_count':len(pre.get('hashes',{})),'saved_isolation':state.get('isolation'),'test_ended':state.get('test_ended')}
prog=Path(r['rfl_origin']['file']); out['rfl_program']={'text':prog.read_text(),'sha256':sha(prog),'matches_loaded_source':sha(prog)==r['rfl_origin']['source']}
out['all_checks_pass']=all(all(a['checks'].values()) for a in out['sections'])
print(json.dumps(out,indent=2,ensure_ascii=False))
sys.exit(int(not out['all_checks_pass']))
