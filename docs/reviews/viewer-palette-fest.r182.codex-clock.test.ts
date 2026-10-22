// Review-only integration probe. Copies only ThreeViewer's small watch/RAF
// consumer; the status store and telemetry collector are the reviewed modules.
import './testGlobals';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, watch } from 'vue';
import { writeFileSync } from 'node:fs';
const emitted: Array<Record<string, any>> = [];
vi.mock('./ws/telemetry', () => ({ emitTelemetry: (_k: string, row: Record<string, any>) => emitted.push(row) }));
import { flushViewerPerf, noteStatusReceived, recordApply, resetViewerPerf } from './viewerPerf';
import { handleStatusMessage, noteHeartbeatSent, resetOnClose, status } from './ws/statusStore';
let now = 1;
let raf: FrameRequestCallback[] = [];
let pending: any = null;
let stop: (() => void) | undefined;
const out: Record<string, any> = {};
beforeEach(() => {
  resetOnClose(); resetViewerPerf(); emitted.length = 0; status.value = null;
  now = 1; raf = []; pending = null;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { raf.push(cb); return raf.length; });
  stop = watch(() => status.value, (msg) => { if (msg?.data) pending = msg.data; });
});
afterEach(async () => { for (const cb of raf.splice(0)) cb(now); await nextTick(); stop?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); writeFileSync('/tmp/codex-r182-kw9jm2wo/clock-evidence.json', JSON.stringify(out, null, 2)); });
function receive(id: string, t: number) {
  now = t; noteStatusReceived(performance.timeOrigin + t);
  handleStatusMessage({type:'status', data:{id}});
}
async function flushStatus() { for (const cb of raf.splice(0)) cb(now); await nextTick(); }
function apply(t: number) { now = t; const shown = pending?.id; recordApply(1); pending = null; return shown; }
it('control: coalesced frames are timed from the oldest receipt', async () => {
  recordApply(1, 80);
  receive('A', 90); receive('B', 101); await flushStatus();
  expect(apply(110)).toBe('B'); flushViewerPerf();
  out.coalesced = {shown:'B', trueOldestAge:20, actual:emitted[0]};
  expect(emitted[0]?.age_n).toBe(1); expect(emitted[0]?.age_max_ms).toBe(20);
});
it('contract: applying A must leave the later unshown B timed for its own apply', async () => {
  recordApply(1, 80);
  receive('A', 90); now = 95; await flushStatus(); // Vue has queued A in ThreeViewer.
  receive('B', 101); // B is in the store RAF batch; animate was already scheduled first.
  const first = apply(110); // shows A, not B
  await flushStatus(); // store's later callback now exposes B to the viewer watcher.
  const second = apply(200); flushViewerPerf();
  out.twoApplies = {shown:[first, second], expectedAges:[20,99], actual:emitted[0]};
  expect(first).toBe('A'); expect(second).toBe('B');
  expect(emitted[0]?.age_n, 'B was separately displayed, not coalesced into A').toBe(2);
  expect(emitted[0]?.age_max_ms).toBe(99);
});
it('contract: delayed main-thread hbsent delivery must not understate the network bound', () => {
  // Worker sends at t=10; return arrives at worker at t=130. Gateway hold=20.
  // Busy main thread consumes both posts at t=200/201 (in correct FIFO order).
  // One concrete split is outbound=10, gateway=20, inbound=90.
  now = 200; noteHeartbeatSent();
  now = 201; handleStatusMessage({type:'status', data:{id:'reply'}, timing:{server_ms:20}});
  recordApply(1); flushViewerPerf();
  out.roundTrip = {workerSend:10, workerReceive:130, mainHbsent:200, mainStatus:201,
    hold:20, inboundLeg:90, bothLegs:100, actual:emitted[0]};
  expect(emitted[0]?.rt_net_max_ms, 'upper bound must cover the actual 90 ms inbound leg').toBeGreaterThanOrEqual(90);
});
