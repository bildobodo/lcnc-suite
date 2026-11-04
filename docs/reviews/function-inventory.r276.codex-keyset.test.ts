// R276: the exact set claimed by F-TOOLMEASURE.S4, separately from its count.
import { expect, it } from 'vitest';
import { toolsetterVarMap, TOOLSETTER_FALLBACK } from './toolsetterSetup';
it('R276: the 23 toolsetter parameter numbers are exactly the claimed set', () => {
  const expected = [3004,3005,3006,3007,3009,3010,3013,
    ...Array.from({length:16}, (_,i) => 3100+i)].map(String).sort();
  expect(Object.keys(toolsetterVarMap(TOOLSETTER_FALLBACK)).sort()).toEqual(expected);
});
