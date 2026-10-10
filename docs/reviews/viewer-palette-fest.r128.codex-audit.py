"""R128 evidence audit. Reads saved data only; never imports a machine tool.
Run: python3 r128.audit.py <directory-with-published-codex-evidence> <r127.f5.txt>
"""
from pathlib import Path
import gzip, hashlib, json, re, sys
root=Path(sys.argv[1]); old=Path(sys.argv[2]).read_text()
pre='viewer-palette-fest.r128.codex-'
log=(root/(pre+'sequence.txt')).read_text()
def ini_of(text):
    return json.loads(next(s[4:] for s in text.splitlines() if s.startswith('INI ')))
def h_model(iv,feed):
    rho=iv['AXIS_Z.OFFSET_AV_RATIO'] or 0
    v=min(feed/60,(1-rho)*iv['AXIS_Z.MAX_VELOCITY'],iv['TRAJ.MAX_LINEAR_VELOCITY'] or float('inf'))
    a=min((1-rho)*iv['AXIS_Z.MAX_ACCELERATION'],iv['TRAJ.MAX_LINEAR_ACCELERATION'] or float('inf'))
    return 4*v*iv['EMCMOT.SERVO_PERIOD']/1e9 + v*v/a
raw=gzip.decompress((root/(pre+'samples.json.gz')).read_bytes())
data=json.loads(raw); st=data['stat']; hs=data['hal']
assert len(st)==32971 and len(hs)==117
assert all(b[0]>a[0] for a,b in zip(st,st[1:]))
iv=ini_of(log)
L=66; plate=(150,0,-300); pgeo=plate[2]+L
at=lambda r: abs(r[1]-plate[0])<.001 and abs(r[2]-plate[1])<.001 and r[7]==7
events=[i for i in range(1,len(st)) if at(st[i]) and ((st[i][5] and not st[i-1][5]) or (st[i][5] and abs(st[i][4]-st[i-1][4])>1e-9))]
assert len(events)==2
out={'source':'saved Claude F5 data, audited offline; no new live run',
     'raw_sha256':hashlib.sha256(raw).hexdigest(),'stat_samples':len(st),'hal_samples':len(hs),
     'duration_s':st[-1][0]-st[0][0],'INI':iv,'plate':plate,'initial_tool_length':L,'events':[]}
for k,i in enumerate(events):
    start=st[i]; end=events[k+1] if k+1<len(events) else len(st)
    win=[r for r in st[i:end] if at(r)]
    q=min(r[3] for r in win); mins=[r for r in win if r[3]==q]
    feed=(2000,200)[k]; h=h_model(iv,feed); overshoot=pgeo-q
    assert 0<=overshoot<=h
    nearest_before=max((r for r in hs if r[0]<=start[0]),key=lambda r:r[0])
    nearest_after=min((r for r in hs if r[0]>=start[0]),key=lambda r:r[0])
    for _,pins in [nearest_before,nearest_after]:
        assert pins['sim-toolsetter.0.enable']=='TRUE'
        assert pins['sim-toolsetter.0.tool-length']=='66'
    event={'kind':('fast','slow')[k],'index':i,'t':start[0],'reported_trip_z':start[4],
           'sampled_stop_z':q,'overshoot_mm':overshoot,'model_mm':h,'margin_mm':h-overshoot,
           'identical_min_samples':len(mins),'sampled_min_plateau_s':mins[-1][0]-mins[0][0],
           'hal_brackets':[nearest_before,nearest_after]}
    if k==0:
        after=[r for r in win if r[0]>mins[0][0]]
        top=max(r[3] for r in after); peak=next(r for r in after if r[3]==top)
        assert abs(top-q-3)<1e-9 and peak[6]==0 and top-L>plate[2]
        first_down=next(r for r in after if r[0]>peak[0] and r[3]<top-1e-6)
        assert first_down[6]==0
        event['retract']={'top_z':top,'distance_mm':top-q,'tip_above_plate_mm':top-L-plate[2],
                          'probe_at_peak':peak[6],'probe_on_first_observed_descent':first_down[6]}
    out['events'].append(event)
assert all(p['sim-toolsetter.0.manual']=='FALSE' and p['axis.z.eoffset']=='0' and p['axis.z.eoffset-enable']=='FALSE' for _,p in hs)
probe_window=[(t,p) for t,p in hs if st[events[0]][0]-.15<=t<=st[events[1]][0]+.15]
assert probe_window and all(p['sim-toolsetter.0.enable']=='TRUE' for t,p in probe_window)
out['sampled_probe_window_hal_count']=len(probe_window)
slow_prep=st[events[1]][4]
expected_length=L-(pgeo-slow_prep)
observed=float(re.search(r'T7 table length after the routine ([\d.]+)',log).group(1))
assert abs(expected_length-observed)<=.000051
out['tool_length']={'expected_from_slow_trip':expected_length,'reported_after':observed,'restored':66}
# Fresh repeated rows must match the already-reviewed R127 4T rows literally.
corrected=old.split('## Mit dem korrigierten Modell',1)[1]
oldrows=[s for s in corrected.splitlines() if re.match(r'^F\d+\s',s)]
newrows=[];configs=[]
pat=re.compile(r'^F(\d+)\s+\+([\d.]+)\s+G(\d+)(\s+stop)?\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*$')
for name in ['xyzac','accel250','norho']:
    text=(root/(pre+name+'.txt')).read_text(); ci=ini_of(text)
    rows=[s for s in text.splitlines() if re.match(r'^F\d+\s',s)]; assert len(rows)==14
    margins=[]
    for s in rows:
        m=pat.fullmatch(s); assert m,s
        f,approach,path,stop,prep,q,delta,over,model,margin=m.groups()
        assert abs(float(model)-h_model(ci,float(f)))<=.000051
        assert abs(float(over)-(pgeo-float(q)))<=.000101
        assert abs(float(model)-float(over)-float(margin))<=.00011
        assert float(margin)>0; margins.append(float(margin))
    assert "manual ['FALSE']" in text and "eoffset ['0']" in text and "eoffset-enable ['FALSE']" in text
    assert "vs #3100–#3102 150.0, 0.0, -300.0" in text
    newrows+=rows;configs.append({'name':name,'INI':ci,'count':len(rows),'min_reported_margin_mm':min(margins)})
assert newrows==oldrows
out['repeated_cases']={'count':len(newrows),'identical_to_R127':True,'configs':configs}
(root/(pre+'audit.json')).write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'verdict':'PASS','sequence_events':2,'retract_mm':out['events'][0]['retract']['distance_mm'],
                  'sequence_margins_mm':[x['margin_mm'] for x in out['events']],
                  'repeated_cases':len(newrows),'rows_identical_to_R127':True},indent=2))
