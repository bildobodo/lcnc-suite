from pathlib import Path
import sys,json
w=Path(sys.argv[1]);repo=w/'repo';sys.path.insert(0,str(repo/'scripts'))
from test_select import round_gate
p=repo/'lcnc-webui/src/r257Retry.test.ts';assert not p.exists()
text='''import { expect, it } from 'vitest';
let attempts = 0;
it('R257 retry once then pass', { retry: 1 }, () => {
  attempts++;
  console.log('R257_ATTEMPT', attempts);
  expect(attempts).toBe(2);
});
'''
logs=w/'retry-logs';logs.mkdir(exist_ok=True)
try:
 p.write_text(text)
 result=round_gate.unit('retry-probe',['src/r257Retry.test.ts'],[],logs)
 (w/'retry-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
finally:p.unlink()
