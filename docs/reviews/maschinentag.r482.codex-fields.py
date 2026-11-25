"""R482: existing field producers, not an implementation of the planned store.
Run with python3 -B fields.py ARCHIVE_ROOT OUTPUT_JSON.
"""
from pathlib import Path
import json
import re
import sys

root, output = map(Path, sys.argv[1:])
sys.path.insert(0, str(root/'lcnc-gateway'))
from tool_table import _TOOL_META_FIELDS, _merge_tool_data
from tool_proof import library_rev

wire_omissions = {'native_mesh','native_profile','profile','shaft_segments','holder_segments','source_metadata'}
discard = {'source_metadata','source_id','fusion_guid'}
library = {'7': {'type': 'formmill', 'oal': 80,
                 'native_profile': [[0,0],[3,0],[3,80],[0,80]],
                 'native_mesh': {'vertices': [[0,0,0],[1,0,0],[0,1,0]], 'triangles': [[0,1,2]]},
                 'source_metadata': {'producer': 'source-only'}, 'fusion_guid': 'id'}}
before = _merge_tool_data([{'T':7,'P':7,'D':6,'Z':50,'remark':'old description'}], library)[0]
after = _merge_tool_data([{'T':7,'P':7,'D':6,'Z':51,'remark':'new description'}], library)[0]
same_wire = {k:v for k,v in after.items() if k not in wire_omissions}
shapes = root/'lcnc-webui/src/toolGeometry.ts'
text = shapes.read_text().split('export interface ToolMeta {',1)[1].split('\n}',1)[0]
interface_fields = re.findall(r'^  (\w+)\?:', text, flags=re.M)
out = {
 'kind':'source audit; planned normalisation NOT implemented or tested',
 'producer_fields':list(_TOOL_META_FIELDS),
 'toolmeta_fields':interface_fields,
 'toolmeta_not_in_producer':sorted(set(interface_fields)-set(_TOOL_META_FIELDS)),
 'wire_omissions':sorted(wire_omissions),
 'wire_omissions_not_in_producer':sorted(wire_omissions-set(_TOOL_META_FIELDS)),
 'raw_container_shapes':{k:type(v).__name__ for k,v in after.items() if isinstance(v,(dict,list))},
 'description_from_current_reply':{
   'library_revision':library_rev(library),
   'before':before['description'], 'after':same_wire['description'],
   'changed_scalars':{k:[before[k],after[k]] for k in before if before[k]!=after[k]},
   'no_edit_field_from_cache':same_wire['description']=='new description' and same_wire['Z']==51},
 'source_only_fields_discarded_by_plan':sorted(discard),
 'refusal_policy_audit':{
   'all_five_geometry_fields_named':wire_omissions-discard == {'native_mesh','native_profile','profile','shaft_segments','holder_segments'},
   'holder_independent':'holder overflow must preserve a usable tool shape; no holder in collision body',
   'same_vs_full':'must compare normalized outputs, not raw omitted arrays',
   'payload_vs_heap':'64 MB bounds normalized form payload; decoded reply and renderer/GC are separately named'}
}
assert not out['toolmeta_not_in_producer']
assert not out['wire_omissions_not_in_producer']
assert out['description_from_current_reply']['no_edit_field_from_cache']
output.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'meta_fields':len(_TOOL_META_FIELDS),'toolmeta_fields':len(interface_fields),
                  'containers':out['raw_container_shapes'],'description':same_wire['description']}))
