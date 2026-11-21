// Codex R423: the real dragScroll module, minimal EventTarget DOM seam.
// No product source changed. Native Settings lifetime is checked separately.
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('./releaseClick', () => ({ noteScrollGesture: vi.fn() }));
class Scroller extends EventTarget {
  style = { cursor: '', userSelect: '' };
  scrollLeft = 0;
  scrollTop = 0;
  closest() { return null; }
  querySelectorAll() { return []; }
  setPointerCapture() {}
}
let el: Scroller;
let win: EventTarget;
let stop: (() => void) | undefined;
function pointer(target: EventTarget, type: string, id: number, x: number) {
  target.dispatchEvent(Object.assign(new Event(type), { button: 0, pointerId: id, clientX: x, clientY: 0 }));
}
beforeEach(() => {
  vi.resetModules();
  el = new Scroller(); win = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('HTMLElement', Scroller);
  vi.stubGlobal('document', { body: el, querySelectorAll: () => [el], getSelection: () => null });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); });
it('outside release frees the owner for a different pointer', async () => {
  const mod = await import('./dragScroll'); stop = mod.stopDragScroll;
  mod.initDragScroll();
  pointer(el, 'pointerdown', 31, 100); pointer(el, 'pointermove', 31, 110);
  pointer(win, 'pointerup', 31, 110);
  expect(el.style.cursor).toBe('');
  pointer(el, 'pointerdown', 32, 100); pointer(el, 'pointermove', 32, 120);
  expect(el.scrollLeft).toBe(-30);
});
it('stop during a drag then reinit does not leave its old scroller owner', async () => {
  const mod = await import('./dragScroll'); stop = mod.stopDragScroll;
  mod.initDragScroll();
  pointer(el, 'pointerdown', 31, 100); pointer(el, 'pointermove', 31, 110);
  expect(el.scrollLeft).toBe(-10);
  mod.stopDragScroll();
  // This release takes place while stopped, so no module observer sees it.
  pointer(win, 'pointerup', 31, 110);
  expect.soft(el.style.cursor).toBe('');
  expect.soft(el.style.userSelect).toBe('');
  mod.initDragScroll();
  pointer(el, 'pointerdown', 32, 100); pointer(el, 'pointermove', 32, 120);
  console.log('R423 lifecycle', JSON.stringify({left:el.scrollLeft,cursor:el.style.cursor,userSelect:el.style.userSelect}));
  expect(el.scrollLeft).toBe(-30);
});
