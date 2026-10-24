"""Usage: python3 audit.py DOCS_REVIEWS REPRODUCTION_OUTPUT AUDIT_JSON
Run codex-reproduce.py first; this checks its retained source events.
"""
from pathlib import Path
import json,sys,datetime
D,O,dest=[Path(x).resolve() for x in sys.argv[1:4]];summary=json.loads((O/'summary.json').read_text());out={}
for v in ['s','f']:
 r=json.loads((O/(v+'-timeline.json')).read_text()); ph=summary[v]['phases']
 def tag(t):return [x for x in r if x['tag']==t]
 starts=tag('browser.collision.sweep_start');ends=tag('browser.collision.sweep_cancelled');done=tag('browser.collision.sweep_done');seen=tag('browser.preview.parse_seen');pubs=tag('gcode.publish')
 ons=[x for x in seen if x['state']=='on'];offs=[x for x in seen if x['state']=='off']
 assert len(starts)==2 and len(ends)==1 and len(done)==1
 assert starts[0]['id']==ends[0]['id'] and starts[1]['id']==done[0]['id']
 assert starts[0]['t_perf_ms']<ons[0]['t_perf_ms']<ends[0]['t_perf_ms']<offs[-1]['t_perf_ms']<starts[1]['t_perf_ms']<done[0]['t_perf_ms']
 assert done[0]['covered']==1 and done[0].get('truncated') is None
 switches=json.loads((D/f'viewer-palette-fest.r199.supersede-{v}.json').read_text())
 inp=json.loads((O/(v+'-input-rows.json')).read_text())
 out[v]={'main_sweeps':[ {k:x[k] for k in ['tag','id','t_perf_ms','t_wall_ns'] if k in x}|{k:x[k] for k in ['ms','covered','truncated','samples','coarsened','uncertified'] if k in x} for x in sorted(starts+ends+done,key=lambda x:x['t_perf_ms'])], 'parse_first_seen_perf_ms':ons[0]['t_perf_ms'],'cancel_after_parse_seen_ms':ends[0]['t_perf_ms']-ons[0]['t_perf_ms'],'cancel_page_wall_ms':ends[0]['t_wall_ms'],'second_switch_gateway_wall_ns':switches[1]['switch_ns'],'warning':'No subtraction across VM and page wall clocks used as a causal proof; the driver second switch and cancellation are corroborating timing only.', 'last_publication':pubs[-1],'last_parse_off_perf_ms':offs[-1]['t_perf_ms'],'start_after_last_parse_off_ms':starts[-1]['t_perf_ms']-offs[-1]['t_perf_ms'], 'supersede_gap_ms':[ons[i+1]['t_perf_ms']-offs[i]['t_perf_ms'] for i in range(7)],'input_rows':[{'page_perf_ms':x['t_perf_ms'],'count':x['in_n'],'after_done_row_end_ms':x['t_perf_ms']-done[0]['t_perf_ms'],'window_ms':x['win_ms']} for x in inp],'input_counter_semantics':'keydown OR pointerdown; counts cannot identify which kind','all_clock_relations_bound':all(p['target']['verdict']=='met' for p in ph.values()),'max_phase_edge_s':max(max(x['edge_start_s'],x['edge_end_s']) for p in ph.values() for x in p['coverage']['pages'].values())}
dest.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({v:{'cancel_after_on_ms':x['cancel_after_parse_seen_ms'],'gaps':x['supersede_gap_ms'],'input_rows':x['input_rows']} for v,x in out.items()},indent=2))
