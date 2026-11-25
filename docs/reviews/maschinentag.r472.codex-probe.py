import json
from unittest.mock import patch
from test_tool_commit_gateway import _Commit, gateway
from tool_table import parse_tool_table

class ReviewR472(_Commit):
    def test_control_failed_pocket_reload_reads_complete_same_owner(self):
        self.fresh()
        before=self.read()
        with patch.object(self.io, 'load_tool_table', side_effect=gateway.linuxcnc.error('reload failed')):
            r=self.send({'cmd':'save_tool','tool_number':1,'pocket':8,'expected':self.expect(1)})
        after=self.read()
        print(json.dumps({'case':'pocket-only failed reload', 'reply':r, 'before':before['table'], 'after':after['table'], 'proof':after['proof'], 'rows':after['tools']}, default=str),flush=True)
        self.assertEqual((r['ok'],r['reload']),(True,'reload failed'))
        self.assertEqual(after['table'], before['table'])
        self.assertEqual(after['proof']['state'],'complete')
        self.assertEqual(next(t['P'] for t in parse_tool_table(str(self.table)) if t['T']==1),8)
