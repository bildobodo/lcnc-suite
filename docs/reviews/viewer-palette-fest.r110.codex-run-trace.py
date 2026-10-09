from pathlib import Path
import sys,subprocess,json
E=Path(__file__).resolve().parent;results={};original={}
for n in ['replay','extra','controls']:original.update(json.loads((E/(n+'.json')).read_text()))
for name in ['g43_first','tc_g92_first','g43_percent_first','tc_g92_percent_first','g43_first_line4','tc_g92_first_line4','inline_python','python_explicit_separate_blocks']:
 p=subprocess.run([sys.executable,str(E/'trace.py'),name],text=True,capture_output=True,timeout=120)
 rows=[l for l in p.stdout.splitlines() if l.startswith('{')];traces=[l for l in p.stdout.splitlines() if l.startswith('TRACE ')]
 assert p.returncode==0 and rows and traces,(name,p.stdout,p.stderr)
 data=json.loads(rows[-1]);assert data==original[name]['data'],name
 results[name]={'data_identical_to_untraced':True,'trace':json.loads(traces[-1][6:]),'stderr':p.stderr}
(E/'trace.json').write_text(json.dumps(results,indent=2)+'\n')
print('8/8 observed native results identical to untraced results')
