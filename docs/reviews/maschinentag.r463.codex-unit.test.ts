import { describe, expect, it } from 'vitest';
import { scanToolHeader, compareHeaderD, headerNote } from './programToolHeader';

const program = (...lines: string[]) => ['(T13 D=6)', ...lines, 'M2'].join('\n');
describe('R463 independent header grammar probes', () => {
  it('control: literal G21 with the first actual motion compares in mm', () => {
    expect(compareHeaderD(scanToolHeader(program('G21 G0 X1')), 13, 6, 'mm')).toEqual({kind:'match'});
  });
  it('M72 can restore the initial units: the lexical G20 is not proof', () => {
    const s = scanToolHeader(program('M70', 'G20', 'M72', 'G0 X1'));
    const c = compareHeaderD(s, 13, 6, 'mm');
    console.log('R463 M72', JSON.stringify({scan:s, comparison:c, note:headerNote(c,'mm')}));
    expect(s.unit).toBeNull();
    expect(c).toMatchObject({kind:'notCompared',why:'unitsNotProven'});
  });
  it('a Fanuc call is control flow even without an O-word in the scanned prefix', () => {
    const text = program('G21', 'M98 P100', 'G0 X1') + '\no100\nG20\nM99\n';
    const s=scanToolHeader(text);
    console.log('R463 M98',JSON.stringify({scan:s,comparison:compareHeaderD(s,13,6,'mm')}));
    expect(s.unit).toBeNull();
  });
});
