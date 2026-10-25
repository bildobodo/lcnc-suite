import { describe, it, expect } from 'vitest';
import { applyClientOverlay } from './permissions';
import { BUTTON_TYPES } from './machineControls';
// Baseline observations; desired behavior deliberately differs.
describe('R202 baseline gate observations', () => {
  it('permits the tool-change confirmation in viewer simulation', () => {
    const p=applyClientOverlay({armed:true,always:true,ready:true,resume:true},true,false,true);
    expect(p.resume).toBe(false);
    expect(BUTTON_TYPES.toolChangeConfirm.gate).toBe('armed');
    expect(p[BUTTON_TYPES.toolChangeConfirm.gate]).toBe(true);
  });
  it('widens missing motion classes to ready in a mixed-version envelope', () => {
    const p=applyClientOverlay({ready:true},true,false,false);
    expect([p.run,p.machineFrame,p.goZero]).toEqual([true,true,true]);
  });
  it('closes abort on disarm and in viewer simulation', () => {
    expect(applyClientOverlay({abort:true},false,false,false).abort).toBe(false);
    expect(applyClientOverlay({abort:true},true,false,true).abort).toBe(false);
  });
});
