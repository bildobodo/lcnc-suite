// The own hole (viewer/fedPath.ts, stock-mute plan v2 §3.4; Codex R484
// MT484-02, R488): its answer against an independent 1-D reference, every
// change of basis at a point without length, the lateral and top ladders,
// the caps — and the channels the worker's copy must carry for it.
import { describe, expect, it } from "vitest";
import { FED_CAP, FED_CHANNELS, fedOver, type FedTrack, type FedWork } from "./fedPath";
import { copyTrackForWorker } from "./colTrackCopy";
import { rng } from "./collisionFixtures";
import type { ScrubTrack } from "../ws/bulkData";

/** A track from points (x, y, z) and kinds (1 rapid). */
function track(pts: number[][], rapid: number[], extra: Partial<FedTrack> = {}): FedTrack {
  const n = pts.length;
  const pos = new Float32Array(n * 3);
  pts.forEach((p, i) => pos.set(p, i * 3));
  return { pos, abc: new Float32Array(n * 3), rapid: Uint8Array.from(rapid), count: n, ...extra };
}
const work = (): FedWork => ({ asks: 0, steps: 0 });
const ask = (t: FedTrack, seg: number, u = 0) => fedOver(t, seg, u, work());

// a peck: rapid to the plane, feed to -3, rapid up, rapid back to -2.5, feed on to -6
const PECK = { pts: [[50, 30, 15], [50, 30, 3], [50, 30, -3], [50, 30, 3], [50, 30, -2.5], [50, 30, -6]], rapid: [1, 1, 0, 1, 1, 0] };

describe("the own hole", () => {
  it("excuses a re-entry above the fed depth and refuses one below it", () => {
    expect(ask(track(PECK.pts, PECK.rapid), 4)).toBe(true);
    const below = PECK.pts.map(p => [...p]);
    below[4]![2] = -3.01;
    expect(ask(track(below, PECK.rapid), 4)).toBe(false);
    // exactly the fed depth: the feed covers it
    below[4]![2] = -3;
    expect(ask(track(below, PECK.rapid), 4)).toBe(true);
  });

  it("refuses any lateral offset, however small (bit-equal poses only)", () => {
    for (const dx of [5e-5, 1.5e-3, 2.1e-3, 0.02]) {
      const pts = PECK.pts.map(p => [...p]);
      pts[3]![0] = pts[3]![0]! + dx; pts[4]![0] = pts[4]![0]! + dx;   // the retract and the re-entry beside the hole
      expect(ask(track(pts, PECK.rapid), 4), `${dx}`).toBe(false);
    }
  });

  it("refuses every change of basis at a point without length, behind and ahead of the entry", () => {
    const base = [[50, 30, 15], [50, 30, 3], [50, 30, -6], [50, 30, 3], [50, 30, 3], [50, 30, -5], [50, 30, -5], [50, 30, -8]];
    const rapid = [1, 1, 0, 1, 1, 1, 1, 0];
    const n = base.length;
    // the zero-length points: 4 (behind the entry's segment 5) and 6 (ahead of it)
    for (const z of [4, 6]) {
      const u8 = () => new Uint8Array(n), u32 = () => new Uint32Array(n);
      const cases: Record<string, Partial<FedTrack>> = {
        tlo: { tlo: u32().fill(1, z) }, wcs: { wcs: u32().fill(1, z) }, mode: { mode: u8().fill(1, z) }, frame: { frame: u32().fill(1, z) },
        cond: { cond: u8().fill(1, z) }, brk: { brk: Object.assign(u8(), { [z]: 1 }) }, ustart: { ustart: Object.assign(u8(), { [z]: 1 }) },
        band: { band: Object.assign(u8(), { [z]: 1 }) }, unpredicted: { unpredicted: Object.assign(u8(), { [z]: 1 }) },
      };
      expect(ask(track(base, rapid), 5), `control at ${z}`).toBe(true);
      for (const [k, e] of Object.entries(cases)) expect(ask(track(base, rapid, e), 5), `${k} at ${z}`).toBe(false);
      // A turns by 1e-5 from the zero-length point on
      const t = track(base, rapid);
      for (let i = z; i < n; i++) t.abc[i * 3] = 1e-5;
      expect(ask(t, 5), `A at ${z}`).toBe(false);
    }
  });

  it("the top is the proven free side: a feed from above it covers, from it or below not", () => {
    for (const [top, want] of [[0.5, true], [0.0005, false], [0, false], [-0.0005, false]] as const) {
      // fed from `top` down to -6; the re-entry rapid from 3 to -5, its free side at 0.001
      const pts = [[50, 30, 15], [50, 30, 3], [50, 30, top], [50, 30, -6], [50, 30, 3], [50, 30, -5]];
      const u = (3 - 0.001) / 8;
      expect(ask(track(pts, [1, 1, 1, 0, 1, 1]), 5, u), `fed from ${top}`).toBe(want);
    }
  });

  it("a following rapid leaves the line at or outside the free side only", () => {
    // down the hole, then sideways at depth: refused; up and out first: excused
    expect(ask(track([[50, 30, 3], [50, 30, -6], [50, 30, 3], [50, 30, -5], [70, 30, -5]], [1, 0, 1, 1, 1]), 3)).toBe(false);
    expect(ask(track([[50, 30, 3], [50, 30, -6], [50, 30, 3], [50, 30, -5], [50, 30, 3], [70, 30, 3]], [1, 0, 1, 1, 1, 1]), 3)).toBe(true);
  });

  it("another hole between, and the start-dependent beginning", () => {
    // fed at X50, then a hole at X70, back to X50: the feed at X50 is read across the other hole? no — off the line
    const pts = [[50, 30, 3], [50, 30, -6], [50, 30, 3], [70, 30, 3], [70, 30, -6], [70, 30, 3], [50, 30, 3], [50, 30, -5]];
    expect(ask(track(pts, [1, 0, 1, 1, 0, 1, 1, 1]), 7)).toBe(false);
    // the feed lies in the beginning (depEnd): not read
    const t = track(PECK.pts, PECK.rapid, { depEnd: 3 });
    expect(ask(t, 4)).toBe(false);
    expect(ask(track(PECK.pts, PECK.rapid, { depEnd: 1 }), 4)).toBe(true);
  });

  it("reads at most FED_CAP segments back and forward", () => {
    // the feed 1024 segments back still counts, 1025 not (zero-length rapids between)
    for (const [back, want] of [[FED_CAP - 2, true], [FED_CAP, false]] as const) {
      const pts = [[50, 30, 15], [50, 30, 3], [50, 30, -6]];
      const rapid = [1, 1, 0];
      for (let i = 0; i < back; i++) { pts.push([50, 30, 3]); rapid.push(1); }
      pts.push([50, 30, -5]); rapid.push(1);
      expect(ask(track(pts, rapid), pts.length - 1), `${back}`).toBe(want);
    }
    const w = work();
    const pts = [[50, 30, 3], [50, 30, -6], [50, 30, 3], [50, 30, -5]];
    for (let i = 0; i < FED_CAP + 5; i++) pts.push([50, 30, -5]);
    expect(fedOver(track(pts, pts.map((_, i) => (i === 1 ? 0 : 1))), 3, 0, w)).toBe(false);
    expect(w).toEqual({ asks: 1, steps: FED_CAP + 1 });
  });

  it("agrees with an integer union of the fed cells on 20 000 random lines (never excuses what is not fed)", () => {
    let pos = 0, excused = 0, neg = 0, wrong = 0;
    for (let seed = 1; seed <= 20000; seed++) {
      const R = rng(seed), n = 4 + Math.floor(R() * 14);
      const z = [20], rapid = [1];
      for (let i = 1; i < n; i++) { z.push(Math.floor(R() * 41) - 20); rapid.push(R() < 0.5 ? 1 : 0); }
      const down = [];
      for (let i = 1; i < n; i++) if (rapid[i] && z[i]! < z[i - 1]!) down.push(i);
      if (!down.length) continue;
      const seg = down[Math.floor(R() * down.length)]!, L = z[seg - 1]! - z[seg]!, a = Math.floor(R() * L);
      const t = track(z.map(v => [0, 0, v]), rapid);
      const top = z[seg - 1]! - a;
      let low = z[seg]!;
      for (let i = seg + 1; i < n && rapid[i]; i++) low = Math.min(low, z[i]!);
      const cov = new Set<number>();
      for (let i = 1; i < seg; i++) if (!rapid[i]) for (let c = Math.min(z[i]!, z[i - 1]!); c < Math.max(z[i]!, z[i - 1]!); c++) cov.add(c);
      let want = top > low;
      for (let c = low; c < top; c++) if (!cov.has(c)) want = false;
      const got = ask(t, seg, a / L);
      if (want) { pos++; if (got) excused++; } else { neg++; if (got) wrong++; }
    }
    expect(wrong, `of ${neg} negatives`).toBe(0);
    expect(neg).toBeGreaterThan(10000);
    // conservative: an interval that does not meet the union when read is dropped
    expect(excused / pos).toBeGreaterThan(0.95);
  });
});

describe("the worker's copy carries what the own hole reads", () => {
  it("every channel of FED_CHANNELS", () => {
    const n = 4, u8 = () => new Uint8Array(n).fill(1), u32 = () => new Uint32Array(n).fill(1);
    const src = {
      pos: new Float32Array(n * 3), abc: new Float32Array(n * 3), lines: new Uint32Array(n), rapid: new Uint8Array(n), cum: new Float32Array(n), count: n,
      band: u8(), brk: u8(), ustart: u8(), unpredicted: u8(), cond: u8(), tlo: u32(), wcsEpoch: u32(), mode: u8(), frame: u32(), depEnd: 2,
    } as unknown as ScrubTrack;
    const copy = copyTrackForWorker(src).trackCopy as unknown as Record<string, unknown>;
    for (const k of FED_CHANNELS) expect(copy[k], k).toEqual(k === "wcs" ? (src as any).wcsEpoch : (src as any)[k]);
  });
});
