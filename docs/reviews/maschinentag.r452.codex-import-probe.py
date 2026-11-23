"""R452 design evidence: observe existing replacement; not a P2b regression."""
import asyncio
import json
from pathlib import Path
from unittest.mock import patch
import gateway
from calc_lifetime import ActionLedger
from tool_table import parse_tool_table, write_tool_table

def test_sidecar_failure_leaves_the_replaced_table(tmp_path):
    table=tmp_path/'tool.tbl'
    old=[{'T':3,'P':8,'X':1.,'Z':123.,'D':6.,'remark':'measured'}]
    new=[{'T':3,'P':3,'Z':45.,'D':6.,'remark':'imported'}]
    write_tool_table(str(table),old)
    reloaded=[]
    async def reload():
        reloaded.extend(parse_tool_table(str(table)))
    with patch.object(gateway,'_actions',ActionLedger()), \
         patch.object(gateway,'_write_admission_refusal',return_value=None), \
         patch.object(gateway,'_reload_tool_table_and_bump',side_effect=reload), \
         patch.object(gateway,'save_tool_library',side_effect=OSError('sidecar disk error')):
        try:
            asyncio.run(gateway._persist_imported_tools(str(table),new,{'3':{'fusion_guid':'new'}}))
            raise AssertionError('expected injected error')
        except OSError as e:
            error=str(e)
    result={'before':old,'after':parse_tool_table(str(table)),'controller_reload_saw':reloaded,'error':error}
    Path('/tmp/r452/import-observation.json').write_text(json.dumps(result,indent=2))
    assert result['after'][0]['Z']==45.
    assert reloaded[0]['Z']==45.
