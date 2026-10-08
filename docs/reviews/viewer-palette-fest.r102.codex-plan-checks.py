"""Pure arithmetic and source inventory for R102 plan review. No machine access.
Run in an archive root: python3 evidence/viewer-palette-fest.r102.codex-plan-checks.py
"""
from pathlib import Path
import json,re
root=Path(__file__).resolve().parents[1]
s=(root/'lcnc-webui/src/toolsetterSetup.ts').read_text().split('export function toolsetterVarMap',1)[1]
fields=dict(re.findall(r'"(\d+)": p\.(\w+)',s))
plan_patched=set(range(3100,3116))
missing={k:v for k,v in fields.items() if int(k) not in plan_patched}
assert set(missing)=={'3004','3005','3006','3007','3009','3010','3013'}
def case(name,z=-100,L=20,clearance=5,maxtravel=10,minz=-500,diff=0):
 start=z+L+clearance+diff
 travel=min(maxtravel,start-minz-2)
 end=start-travel
 target=z+L+diff
 # G49, WCS zero: offset_z = 0. With another constant WCS, it cancels.
 returned=abs(z)+target-diff
 return dict(name=name,touchZ=z,length=L,toolMinDis=clearance,maxZTravel=maxtravel,
             axisMin=minz,finderDiff=diff,start=start,fastEnd=end,planTarget=target,
             targetStrictlyOnDownwardProbe=end<=target<start,
             routineLengthAtPlanTarget=returned,planClaimsLength=L)
cases=[case('ordinary'),case('configured-travel-too-short',maxtravel=1),
       case('axis-clamp-stops-before-target',minz=-81),case('positive-reference',z=10),
       case('edge-finder',diff=3)]
assert cases[0]['targetStrictlyOnDownwardProbe']
assert not cases[1]['targetStrictlyOnDownwardProbe']
assert not cases[2]['targetStrictlyOnDownwardProbe']
assert cases[3]['routineLengthAtPlanTarget']==40
assert cases[4]['routineLengthAtPlanTarget']==20
result={'missing_from_proposed_3100_3115_patch':missing,'other_routine_inputs':{
 '3014':'finder tool number (separate probe settings)',
 '5181..5183':'G30 position', '3116':'run-from-line skip', '2000':'call mode'},
 'arithmetic_counterexamples':cases,
 'limits':'Arithmetic for plan only, not an implementation of a changed M600; tool table assumed to equal physical length.'}
print(json.dumps(result,indent=2))
