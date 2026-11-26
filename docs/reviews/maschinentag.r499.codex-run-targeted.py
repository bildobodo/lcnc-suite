import subprocess,json
from pathlib import Path
cmd=['node','node_modules/vitest/vitest.mjs','run','src/toolDrawing.test.ts','src/toolForm.test.ts','src/toolShapeCache.test.ts','src/toolShapeRecord.test.ts','src/toolTableStore.test.ts','src/toolTableRead.test.ts','src/toolGeometry.test.ts','src/toolHolder.test.ts','src/toolSimulationGeometry.test.ts','src/formToolGeometry.test.ts','src/freecadGeometry.test.ts','src/exampleToolLibrary.test.ts','--maxWorkers=1','--no-file-parallelism']
with Path('/tmp/r499/targeted.txt').open('w') as o:r=subprocess.run(cmd,cwd='/tmp/r499/tree/lcnc-webui',stdout=o,stderr=subprocess.STDOUT)
Path('/tmp/r499/targeted.json').write_text(json.dumps({'cmd':cmd,'cwd':'/tmp/r499/tree/lcnc-webui','exit':r.returncode},indent=2))
print('\n'.join(Path('/tmp/r499/targeted.txt').read_text().splitlines()[-15:]))
raise SystemExit(r.returncode)
