"""R190 plan review: what the existing refresh status can distinguish.
Runs only the AST-extracted, unchanged preview_refresh_status method against
local state fixtures. No gateway import, services, sockets or machine commands.
Usage: R190_REPO=/path/to/084b8e4a R190_OUT=/tmp/output python3 probe.py
"""
import ast,hashlib,json,os
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
REPO=Path(os.environ.get('R190_REPO','/home/cnc/lcnc-suite'))
OUT=Path(os.environ.get('R190_OUT','/tmp/codex-r190-6kucf91o'));OUT.mkdir(parents=True,exist_ok=True)
p=REPO/'lcnc-gateway/bulk_pipeline.py';source=p.read_text();tree=ast.parse(source)
fn=next(n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name=='preview_refresh_status')
mod=ast.Module(body=[fn],type_ignores=[]);env={'Optional':Optional,'os':os};exec(compile(mod,str(p),'exec'),env)
read=env[fn.name]
inf={'reason':'wcsoff:G54:z','file':'/a/part.ngc','started_ms':1000,'expected_ms':10000,'job':17}
fixtures={
 'no_parse_started':SimpleNamespace(inflight=None,refresh_running=False,reparse_pending=False,superseded_total=0),
 'parse_running':SimpleNamespace(inflight=inf,refresh_running=True,reparse_pending=False,superseded_total=0),
 'superseded_waiting_to_restart':SimpleNamespace(inflight=None,refresh_running=False,reparse_pending=True,superseded_total=1),
 'published_fetch_or_decode_not_applied':SimpleNamespace(inflight=None,refresh_running=False,reparse_pending=False,superseded_total=0),
 'failed_without_publish':SimpleNamespace(inflight=None,refresh_running=False,reparse_pending=False,superseded_total=0),
 'same_result_no_new_payload':SimpleNamespace(inflight=None,refresh_running=False,reparse_pending=False,superseded_total=0),
}
outputs={name:read(s) for name,s in fixtures.items()}
assert outputs['parse_running']['job']==17
assert all(v is None for k,v in outputs.items() if k!='parse_running')
result={'kind':'existing-source observability probe, not execution of proposed E1','source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'method_line':fn.lineno,'states':outputs,'conclusion':'preview_refresh disappearance alone cannot distinguish not-yet-started, supersede gap, successful publication awaiting frontend application, failure, or same-result completion. Other current-file/version/decode inputs or explicitly bounded uncertainty are required.'}
(OUT/'refresh-observability.json').write_text(json.dumps(result,indent=2))
# Capture the precise source passages used by this plan review.
ranges={
 'lcnc-gateway/bulk_pipeline.py':[(678,692),(1004,1021),(1095,1113)],
 'lcnc-webui/src/ws/statusStore.ts':[(100,128),(133,148),(496,532)],
 'lcnc-webui/src/ws/bulkData.ts':[(875,905),(918,946)],
 'lcnc-webui/src/ThreeViewer.vue':[(2631,2645),(2834,2857),(3697,3717),(3970,4008),(4142,4157),(4264,4279),(4487,4508)],
 'lcnc-webui/src/ScrubBar.vue':[(149,155),(324,352),(378,390),(396,405),(419,438)],
 'lcnc-webui/src/viewer/toolpathController.ts':[(1014,1037)],
 'docs/reviews/viewer-palette-fest.r188.browser-pc-drive2.py':[(348,387)],
}
records={}
for name,blocks in ranges.items():
 f=REPO/name;lines=f.read_text().splitlines();records[name]={'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'excerpts':[{'first_line':a,'last_line':b,'text':'\n'.join(lines[a-1:b])} for a,b in blocks]}
(OUT/'source-contracts.json').write_text(json.dumps(records,indent=2))
print(json.dumps(result,indent=2))
