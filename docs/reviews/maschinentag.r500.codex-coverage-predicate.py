"""Static sensitivity of the exact handoff predicate, not the Vitest run.

Extract the expression verbatim from the head's stockMutePaths test, then
evaluate it with Node on three messages with different coverage values.
This proves only that this assertion does not read the value. It does not
claim the remaining integration assertions passed on any mutated worker.
"""
import json
from pathlib import Path
import subprocess

source = Path('/tmp/r500/tree/lcnc-webui/src/viewer/stockMutePaths.test.ts').read_text()
line = next(line.strip() for line in source.splitlines() if '"generation 0\'s coverage handed over"' in line)
prefix = 'expect('
suffix = ', "generation 0\'s coverage handed over").toBe(true);'
assert line.startswith(prefix) and line.endswith(suffix)
expression = line[len(prefix):-len(suffix)]
program = '''const rows = [0,0.87,1].map(x=>{
 const sent=[{id:60,heldCoverage:{generation:0,covered:[x,x]}}];
 return {covered:[x,x],accepted:EXPR};
}); console.log(JSON.stringify(rows));'''.replace('EXPR',expression)
rows=json.loads(subprocess.check_output(['node','--input-type=module','-e',program]))
print(json.dumps({'head':'e0080767','assertion':line,'expression':expression,
 'limit':'Only this exact predicate executed; the complete pool test was NOT run.',
 'cases':rows},indent=2))
