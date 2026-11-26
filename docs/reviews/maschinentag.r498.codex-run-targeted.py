import os,subprocess,json
from pathlib import Path
base=Path('/tmp/r498/tree')
env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1')
rows=[]
commands=[('unit',base/'lcnc-webui',['node','node_modules/vitest/vitest.mjs','run','src/toolDrawing.test.ts','src/toolForm.test.ts','src/toolTableStore.test.ts','src/toolTableRead.test.ts','src/toolLoad.test.ts','src/toolLoadWords.test.ts','--maxWorkers=1','--no-file-parallelism']),('backend',base/'lcnc-gateway',['/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python','-m','pytest','-p','conftest','-q','-p','no:cacheprovider','test_tool_have_library.py','test_tool_load.py','test_tool_load_gateway.py'])]
for name,cwd,cmd in commands:
 p=Path('/tmp/r498')/(name+'.txt')
 with p.open('w') as out: r=subprocess.run(cmd,cwd=cwd,env=env,stdout=out,stderr=subprocess.STDOUT)
 rows.append(dict(name=name,cmd=cmd,cwd=str(cwd),exit=r.returncode))
 print(name,r.returncode,flush=True)
 print('\n'.join(p.read_text().splitlines()[-10:]),flush=True)
Path('/tmp/r498/targeted.json').write_text(json.dumps(rows,indent=2))
raise SystemExit(any(r['exit'] for r in rows))
