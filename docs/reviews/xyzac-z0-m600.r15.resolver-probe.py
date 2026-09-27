"""R15 B2: pure loaded-file resolver, no LinuxCNC import or live commands."""
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'lcnc-gateway'))
from gateway_util import resolve_loaded_file, validate_path_within, validate_extension

results=[]
for sub in ('/review/remap_subs/m600.ngc','/review/nc_files/probe.ngc'):
    previous=None
    rows=[]
    for phase,raw,idle in [('baseline',None,True),('MDI call',sub,False),('MDI error leaves sub in STAT.file',sub,True)]:
        loaded,ignored=resolve_loaded_file(raw,idle,previous,True)
        rows.append({'phase':phase,'raw':raw,'idle':idle,'previous':previous,'loaded':loaded,'ignored':ignored})
        previous=loaded
    results.append({'sub':sub,'rows':rows,'unexpected_adoption':previous is not None})
path='/review/nc_files/shared/main.ngc'
proposal={'program_prefix':'/review/nc_files','subroutine_path':['/review/nc_files/shared'],
          'explicit_program_candidate':path,'within_current_load_allowlist':validate_path_within(path,'/review/nc_files'),
          'extension_allowed':validate_extension(path),
          'also_under_subroutine_path':Path(path).is_relative_to('/review/nc_files/shared'),
          'note':'The proposed categorical path exclusion would conflict with explicit loads in a shared directory; PROGRAM_PREFIX also permits called subroutines.'}
out={'scope':'Pure reproduction of reported B2 status sequence; second path illustrates PROGRAM_PREFIX search coverage',
     'results':results,'path_rule_counterexample':proposal}
Path(__file__).with_suffix('.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
