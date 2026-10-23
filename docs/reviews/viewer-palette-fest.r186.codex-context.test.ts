// Review-only source/telemetry probe. No production module is modified.
import './testGlobals';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
const emitted: Array<Record<string, any>> = [];
vi.mock('./ws/telemetry', () => ({ emitTelemetry: (tag: string, row: Record<string, any>) => emitted.push({ tag, ...row }) }));
import { flushViewerPerf, notePendingReceipt, noteHeartbeatSentAt, noteHeartbeatReply, recordApply, resetViewerPerf } from './viewerPerf';
const root = '/tmp/codex-r186-t9s1ym0l';
const out: Record<string, any> = {};
let now = 0;
const source = readFileSync(new URL('./ThreeViewer.vue', import.meta.url), 'utf8');
const a = source.indexOf('function _colNoteWitness(');
const b = source.indexOf('\nlet _colKeepShown', a);
if (a < 0 || b < a) throw new Error('Cannot locate the unchanged viewer function');
const exact = source.slice(a, b);
// Extract the function unchanged; only its environment (clock and telemetry) is fake.
const js = ts.transpile(exact, { target: ts.ScriptTarget.ES2022 });
function consume(w: Record<string, any>, received: number) {
  const rows: any[] = [];
  const note = new Function('_colRunReqs', 'performance', 'emitTelemetry', `${js}; return _colNoteWitness;`)(
    new Map([[42, { gen: 7, range: 0 }]]), { timeOrigin: 0, now: () => received },
    (tag: string, data: any) => rows.push({ tag: `browser.${tag}`, page: 'P', ...data }),
  );
  note(42, w);
  return rows[0];
}
beforeEach(() => {
  resetViewerPerf(); emitted.length = 0; now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => { vi.restoreAllMocks(); writeFileSync(`${root}/context-evidence.json`, JSON.stringify(out, null, 2)); });
it('control: an ahead clock is detected when the word arrives promptly', () => {
  const actualSlice = [8300, 8350], offset = 2000;
  const row = consume({ shard: 0, gen: 1, s: actualSlice.map(t => t + offset), at: 8400 + offset }, 8401);
  out.aheadVisible = { actualSlice, workerOffsetMs: offset, postAtReal: 8400, receiveAtReal: 8401, row };
  expect(row.ahead_ms).toBe(1999);
});
it('counterexample: a delayed word masks an ahead collision clock in the actual viewer consumer', () => {
  const actualSlice = [8300, 8350], offset = 2000;
  const row = consume({ shard: 0, gen: 1, s: actualSlice.map(t => t + offset), at: 8400 + offset }, 10500);
  out.collisionAheadMasked = { actualSlice, workerOffsetMs: offset, postAtReal: 8400, receiveAtReal: 10500, row };
  expect(row.ahead_ms).toBe(-100);
  expect(row.s).toEqual([10300, 10350]);
});
it('counterexample: delayed apply masks an ahead WS clock and understates status age', () => {
  const t0 = performance.timeOrigin, offset = 2000;
  const hs = 10100, hr = 10200, applied = 12300;
  recordApply(1, 9000);
  now = applied;
  noteHeartbeatSentAt(t0 + hs + offset, 1);
  noteHeartbeatReply(t0 + hr + offset, 10, 1, 10150, 1);
  notePendingReceipt(t0 + hr + offset); recordApply(1);
  noteHeartbeatSentAt(t0 + 10800 + offset, 2);
  noteHeartbeatReply(t0 + 10900 + offset, 10, 2, 10850, 1);
  now = 13000; notePendingReceipt(t0 + 10900 + offset); recordApply(1);
  flushViewerPerf();
  const row = emitted.find(r => r.tag === 'viewer.perf');
  out.wsAheadMasked = { epoch: t0, workerOffsetMs: offset, actualAges: [2100, 2100], row };
  expect(row?.age_neg).toBe(0);
  expect(row?.age_n).toBe(2);
  expect(row?.age_max_ms).toBe(100);
  expect(row?.hb_pairs).toHaveLength(2);
});
