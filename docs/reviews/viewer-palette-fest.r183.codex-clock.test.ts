// Review-only integration probe. Copies only ThreeViewer's small watch/RAF
// consumer; the status store and telemetry collector are the reviewed modules.
import './testGlobals';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, watch } from 'vue';
import { writeFileSync } from 'node:fs';
const emitted: Array<Record<string, any>> = [];
vi.mock('./ws/telemetry', () => ({ emitTelemetry: (_k: string, row: Record<string, any>) => emitted.push(row) }));
import { flushViewerPerf, notePendingReceipt, noteHeartbeatSentAt, noteHeartbeatReply, recordApply, resetViewerPerf } from './viewerPerf';
import { handleStatusMessage, noteHeartbeatSent, resetOnClose, status, statusReceiptOf } from './ws/statusStore';
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
  stop = watch(() => status.value, (msg) => { if (msg?.data) { pending = msg.data; notePendingReceipt(statusReceiptOf(msg)); } });
});
afterEach(async () => { for (const cb of raf.splice(0)) cb(now); await nextTick(); stop?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); writeFileSync('/tmp/codex-r183-j66_w2sq/clock-evidence.json', JSON.stringify(out, null, 2)); });
function receive(id: string, t: number) {
  now = t;
  handleStatusMessage({type:'status', data:{id}}, performance.timeOrigin+t);
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
  now = 200; noteHeartbeatSent(); noteHeartbeatSentAt(performance.timeOrigin+10);
  now = 201; noteHeartbeatReply(performance.timeOrigin+130, 20); handleStatusMessage({type:'status', data:{id:'reply'}, timing:{server_ms:20}});
  recordApply(1); flushViewerPerf();
  out.roundTrip = {workerSend:10, workerReceive:130, mainHbsent:200, mainStatus:201,
    hold:20, inboundLeg:90, bothLegs:100, actual:emitted[0]};
  expect(emitted[0]?.rt_net_max_ms, 'upper bound must cover the actual 90 ms inbound leg').toBeGreaterThanOrEqual(90);
});

it('contract: an ambiguous reply cannot acknowledge another answer still in transit', () => {
  const t0=performance.timeOrigin;
  noteHeartbeatSentAt(t0+10); // H1: gateway receives at 20, responds at 40.
  noteHeartbeatSentAt(t0+1010); // H2: gateway receives at 1020, responds at 1040.
  noteHeartbeatReply(t0+1500,20); // H1 arrives late; invalid because two sends are outstanding.
  noteHeartbeatSentAt(t0+2010); // H3 sent while H2 response remains in flight.
  noteHeartbeatReply(t0+2300,20); // H2 arrives before H3's response; FIFO is respected.
  recordApply(1,2301); flushViewerPerf();
  out.lateReplyAfterAmbiguity={actual:emitted[0], response:'H2', actualInbound:1260, actualBothLegs:1270};
  expect(emitted[0]?.rt_n===0 || emitted[0]?.rt_net_max_ms>=1260,
    'H2 must be invalid or bounded by its own H2 send, never paired with H3').toBe(true);
});
