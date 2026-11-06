"""R312: execute actual servo evaluator, synthetic cases + saved run only.
Usage: PY -B probe_b.py ARCHIVE SAVED_RUN_DIR OUT_JSON
"""
import copy,hashlib,json,sys,tempfile,shutil
from pathlib import Path
root=Path(sys.argv[1]);sys.path.insert(0,str(root/'scripts'))
import test_native_stage as t
from test_support import servo_cases as sc
out={}
def record(name,sec,expected):
    r=t._start(sec);out[name]={'actual':r,'expected':expected};return r
assert record('clean',t._good(),'PASS')['status']=='PASS'
# A drop across the exact R->0 boundary: last R Z=0, first 0 Z=-.002.
# The following samples rise, settle at entry, and execute normal L/L+1/L+2.
sec=t._good(runout=[(0,(0,0,-.002,0,0,-1),0)],entry=t._seg(0,(0,0,-.002),(100,100,0)))
assert record('descent_at_boundary',sec,'FAIL')['status']=='FAIL'
# R311 countercase: with no routine boundary the verdict must stay incomplete.
assert record('routine_boundary_absent',t._good(measure=[],runout=[]),'incomplete')['status']=='incomplete'
# R310's countercase is now correctly refused.
sec=t._good(measure=t._seg(587,(10,10,-127),(10,10,0))+t._seg(6,(10,10,0),(10,10,-3))+t._seg(601,(10,10,-3),(0,0,0)))
assert record('r310_early_program',sec,'FAIL')['status']=='FAIL'
# Whole existing step, only its file input points at a modified routine copy.
# Add an axis-only modal motion after its final explicitly spelled G1.
with tempfile.TemporaryDirectory(prefix='r311-hash-') as td:
    p=Path(td);tree=p/'tree'
    (tree/'lcnc-gateway').mkdir(parents=True)
    shutil.copyfile(root/'lcnc-gateway/toolsetter_rules.py', tree/'lcnc-gateway/toolsetter_rules.py')
    hashes={}
    for rel in t.nr.ROUTINE_TEXTS:
        source=(root/rel).read_text();changed=source
        if rel.endswith('/tool_touch_off.ngc'):
            lines=source.splitlines(keepends=True)
            assert 'G1 F#<traverse_fr>' in lines[600]
            lines[601]='X25 (R312 countercase: another modal motion)\n'
            changed=''.join(lines)
        dest=tree/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(changed)
        hashes[rel]={'original':hashlib.sha256(source.encode()).hexdigest(),'changed':hashlib.sha256(changed.encode()).hexdigest()}
    hist,frames=t._rfl_run();client=t.RflClient(frames,hist)
    run=p/'run';run.mkdir();ctx,step=t._rfl_step(run,client)
    ctx.update(run=run,tree=tree,servo=t.FakeMeasurement([t._good()]))
    old=t.nr.SHORT_GRACE;t.nr.SHORT_GRACE=.02
    try: rows=step(ctx)
    finally:t.nr.SHORT_GRACE=old
    by={r['case']:r for r in rows}
    out['changed_routine_whole_step']={'hashes':hashes,'row':by['rfl-start-point'],'expected':'incomplete; the approved routine hash differs','modal_line_602_in_mapping':602 in sc.motion_lines((tree/list(t.nr.ROUTINE_TEXTS)[0]).read_text())}
    assert by['rfl-start-point']['status']=='incomplete'
# Actual immutable recording + its actual section integrity, already evaluated.
run=Path(sys.argv[2]);report=json.loads((run/'report.json').read_text())
meta=next(x for x in report['servo_sections'] if x['case']=='rfl')
samples=[json.loads(x) for x in (run/'servo-rfl.jsonl').read_text().splitlines()]
assert len(samples)==meta['samples']
assert not meta['problems']
assert all(b[1]==a[1]+1 for a,b in zip(samples,samples[1:]))
assert all(s[2][8]==meta['start_mark'] for s in samples)
r_lines,sources,source_problem=sc.routine_sources(root,t.nr.ROUTINE_TEXTS)
sources={**sources, 'program':report['rfl_origin']['source']}
assert source_problem is None
kw=dict(line=7,safe_z=0,routine_lines=r_lines,program_lines=t.P_LINES,sources=sources,source_problem=source_problem)
base=sc.eval_rfl_start_servo('rfl-start-point',dict(samples=samples,problems=meta['problems']),entry_xy=(100,100),**kw)
neg=sc.eval_rfl_start_servo('counter',dict(samples=samples,problems=meta['problems']),entry_xy=(101,100),**kw)
assert base['status']=='PASS' and neg['status']=='FAIL'
axis={}
for line,fixed in ((7,(1,2)),(8,(0,2)),(9,(0,1))):
    seg=[s for s in samples if s[2][6]==line]
    axis[line]={ 'first_n':seg[0][1], 'samples':len(seg), 'other_axis_deviation':{ 'XYZ'[i]:max(abs(s[2][i]-seg[0][2][i]) for s in seg) for i in fixed}}
out['saved_live_run']={'commit':report['commit'],'report_verdict':report['verdict'],'restore':report['restore']['outcome'],'isolation':report['restore']['isolation'],'stream_sha256':hashlib.sha256((run/'servo-rfl.jsonl').read_bytes()).hexdigest(),'samples':len(samples),'section_problems':meta['problems'],'positive':base,'counter':neg,'axis_separation':axis,'rfl_errors':report['rfl_errors']}
Path(sys.argv[3]).write_text(json.dumps(out,indent=2)+"\n")
