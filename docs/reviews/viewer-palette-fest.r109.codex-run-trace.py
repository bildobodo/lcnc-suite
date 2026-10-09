from pathlib import Path
import sys,subprocess,json
E=Path(__file__).resolve().parent
results={};original={**json.loads((E/'native.json').read_text()),**json.loads((E/'python-cases.json').read_text())}
for name in ['explicit_same_block','python_explicit_same_block','python_line4_explicit_same_block','python_line4_remap_only']:
 p=subprocess.run([sys.executable,str(E/'trace.py'),name],text=True,capture_output=True,timeout=120)
 rows=[l for l in p.stdout.splitlines() if l.startswith('{')];traces=[l for l in p.stdout.splitlines() if l.startswith('TRACE ')]
 assert p.returncode==0 and rows and traces,(name,p.stdout,p.stderr)
 data=json.loads(rows[-1]);assert data==original[name]['data'], name
 results[name]={'data_identical_to_untraced':True,'trace':json.loads(traces[-1][6:]),'stderr':p.stderr}
(E/'trace.json').write_text(json.dumps(results,indent=2)+'\n')
print('4/4 observed native results identical to the untraced results')
