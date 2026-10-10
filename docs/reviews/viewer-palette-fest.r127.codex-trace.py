from pathlib import Path
import subprocess
root=Path(__file__).parent
p=root/'lcnc-webui/src/viewer/collision.ts'; original=p.read_bytes()
q=root/'lcnc-webui/src/viewer/r127.trace.test.ts'
s=(root/'lcnc-webui/src/viewer/r127.native-contact.codex.test.ts').read_text().replace("const actual=doSweep(true,true),control=doSweep(false,true),noncut=doSweep(true,false);", "(globalThis as any).__r127trace=[];\n const actual=doSweep(true,true);\n writeFileSync('../r127.trace.json',JSON.stringify((globalThis as any).__r127trace,null,2));\n const control=doSweep(false,true),noncut=doSweep(true,false);")
q.write_text(s)
marker='  const noteQuery = (pi: number, s: number, line: number, isRapid: boolean, d: number, inBand = false) => {'
log='''
    const trace = (globalThis as any).__r127trace;
    if (trace && d <= opts.margin && !inContact[pi]) trace.push({s,line,isRapid,d,inBand,pre:inContact[pi],onset:onsetLine[pi],centerA:bodies[pairs[pi]![0]]!.worldCenter.toArray(),centerB:bodies[pairs[pi]![1]]!.worldCenter.toArray()});
'''
try:
 assert marker in original.decode();p.write_text(original.decode().replace(marker,marker+log))
 with (root/'r127.trace.txt').open('w') as out:
  ret=subprocess.run(['nice','-n','19','node','node_modules/vitest/vitest.mjs','run','src/viewer/r127.trace.test.ts','--maxWorkers=1'],cwd=root/'lcnc-webui',stdout=out,stderr=subprocess.STDOUT)
 print('diagnostic test exit',ret.returncode)
finally:
 p.write_bytes(original)
 assert p.read_bytes()==original
