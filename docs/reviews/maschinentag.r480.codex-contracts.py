"""R480: today's accepted input and explicit plan models, no new store tested.
No gateway, NML or machine imports. Small fixture files live only in /tmp.
"""
from pathlib import Path
import json
import sys
import tempfile

root=Path('/tmp/r480')
sys.path.insert(0,str(root/'tree/lcnc-gateway'))
from tool_store import ToolLibraryStore
from tool_table import _merge_tool_data

with tempfile.TemporaryDirectory(dir=root) as td:
    p=Path(td)/'library.json'
    profile=[[1, i/100] for i in range(4096)]
    p.write_text(json.dumps({'/fixture.ini':{'1':{'type':'formmill','native_profile':profile}}}))
    store=ToolLibraryStore(p,lambda:'/fixture.ini')
    lib=store.load(strict=True)
    row=_merge_tool_data([{'T':1,'P':1,'Z':60,'D':2}],lib)[0]
    assert len(row['native_profile'])==4096
    assert row['native_profile'] is lib['1']['native_profile']
    source={'strict_read_points':len(row['native_profile']),
            'merged_row_points':len(row['native_profile']),
            'row_retains_same_profile':True,
            'plan_build_cap_points':2048,
            'new_store_implemented':False,
            'obligation':'State when the retained library/rows drop rejected source geometry; a build refusal alone does not bound their storage.'}

# Logical accounting only. No large allocation or claimed heap measurement.
account={'kind':'lower bound arithmetic, not a heap measurement',
         'points':4_194_305,'double_coordinate_payload_bytes':4_194_305*2*8,
         'library_limit_mib':64,
         'over_limit_before_nested_array_overhead':4_194_305*2*8>64*1024*1024}

# Positive control of the new key rule. A held decision owns its result, not
# a licence for arbitrary expired T to accumulate in the record.
keys=set();rows=[]
for current,missing,needed,ok in [({1,2},set(),set(),True),
                                 ({3}, {2}, {1},True),
                                 (set(),set(),set(),False),
                                 ({4},set(),set(),True)]:
    if ok:keys=current|missing|needed
    rows.append({'current':sorted(current),'missing':sorted(missing),
                 'held_need':sorted(needed),'ok':ok,'kept':sorted(keys)})
assert rows[1]['kept']==[1,2,3] and rows[2]['kept']==[1,2,3] and rows[3]['kept']==[4]
print(json.dumps({'actual_existing_reader':source,'accounting':account,
                  'plan_key_rule_model':rows},indent=2))
