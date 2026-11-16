"""R386 selector counter-cases. Run from an isolated archive, with that archive
as argv[1]. Creates only a scratch git repository under /tmp. Uses the shipped
selector and its existing synthetic repository fixture; no live access.
"""
from pathlib import Path
import sys, tempfile, json
implementation = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
sys.path.insert(0, str(implementation / 'scripts'))
from test_select import selector
from test_select.test_selector import repo, commit_change
r=repo.__wrapped__(Path(tempfile.mkdtemp(prefix='r386-selector-')))
def setup(r):
 (r/'lcnc-webui/e2e/firefox-core.json').write_text(json.dumps({'required':[{'file':'probe-click.spec.ts','titles':['probe']}],'buildup':[]}))
commit_change(r,setup)
cases={
'helper': lambda r:(r/'lcnc-webui/e2e/macroFolder.ts').write_text('export const Folder = 2;\n'),
'source import':lambda r:(r/'lcnc-webui/src/probeVars.ts').write_text('v2\n'),
'read data':lambda r:(r/'scripts/test_fixtures/macro_refusals.json').write_text('{"new":true}\n'),
'unknown source':lambda r:(r/'lcnc-webui/src/brandNew.ts').write_text('x\n'),
'direct spec (control)':lambda r:(r/'lcnc-webui/e2e/probe-click.spec.ts').write_text('test();\n')}
result=[]
for name,edit in cases.items():
 base=commit_change(r,edit)
 s=selector.select(r,base,'HEAD',vitest_files=[])
 result.append({'case':name,'browser':s['browser']['run'],'firefox':s['firefox'],'changed':s['changed']})
print(json.dumps(result,indent=2))
