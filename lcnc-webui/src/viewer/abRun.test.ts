// The A/B run's schedule (Codex R39 VP39-03), against a fake viewer: the
// alternating order, one rebuild per variant (never both held), every phase
// recorded with its conditions, a phase that cannot run named, histograms
// emitted whole, and the viewer restored — also on cancel.
import { describe, it, expect } from "vitest";
import { runAb, AB_ORDER, type AbDriver, type AbVariant } from "./abRun";
import type { PathMemory } from "./toolpathController";

type Emitted = { kind: string; f: Record<string, any> };
const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];

function fakeDriver(o: { blocker?: string; skipJumps?: string; hiddenIn?: string; frameMs?: number; initial?: AbVariant } = {}) {
  let mode: AbVariant = o.initial ?? "fat";
  let t = 0;
  let tap: ((k: "raf" | "mt" | "gpu", ms: number, now: number) => void) | null = null;
  const calls: string[] = [];
  const emitted: Emitted[] = [];
  let flags = { hidden: false, dialog: false, interacted: false, sweepBusy: false };
  let phaseName = "";
  const frames = async (ms: number) => {
    const step = o.frameMs ?? 16.7;
    for (let x = 0; x < ms; x += step) {
      t += step;
      tap?.("raf", step, t);
      tap?.("mt", 1, t);
      tap?.("gpu", mode === "fat" ? 9 : 5, t);
    }
    if (o.hiddenIn === phaseName) flags.hidden = true;
  };
  const mem = (): PathMemory => ({ mode, cpu: { base: 10, dist: 1, overlay: 2, reveal: 0, source: 5, total: 18 },
    gpu: { base: 10, dist: 1, overlay: 2, reveal: 0, total: 13 }, buildBytes: mode === "fat" ? 11 : 0, instances: 7 });
  const d: AbDriver = {
    blocker: () => o.blocker ?? null,
    lineMode: () => mode,
    setLineMode: async v => { calls.push(`mode:${v}`); mode = v; phaseName = "build"; await frames(50); },
    warmUp: async ms => { phaseName = "warmup"; await frames(ms); },
    orbit: async ms => { phaseName = "orbit"; calls.push("orbit"); await frames(ms); },
    fitDetail: async (c, h) => { phaseName = "fitdetail"; await frames(c * h); },
    findingJumps: async (n, ms) => { phaseName = "jumps"; if (o.skipJumps) return o.skipJumps; await frames(n * ms); return null; },
    overlayOff: async ms => { phaseName = "overlay_off"; await frames(ms); return null; },
    revealJumps: async (n, ms) => { phaseName = "reveal"; calls.push("reveal"); await frames(n * ms); return null; },
    revealEnd: async () => { calls.push("revealEnd"); },
    restore: async () => { calls.push("restore"); },
    memory: mem,
    render: () => ({ calls: 3, triangles: mode === "fat" ? 14 : 0 }),
    conditions: () => { const c = flags; flags = { hidden: false, dialog: false, interacted: false, sweepBusy: false }; return c; },
    meta: () => ({ commit: "abc1234", dpr: 2 }),
    tap: fn => { tap = fn; },
    emit: (kind, f) => emitted.push({ kind, f }),
    now: () => t,
  };
  return { d, calls, emitted, get tapOn() { return tap !== null; } };
}

const SHORT = { warmupMs: 100, orbitMs: 400, fitDetailCycles: 2, fitDetailHoldMs: 100, jumps: 2, jumpMs: 100, overlayMs: 200 };

describe("runAb", () => {
  it("A, B, B, A, A, B: one rebuild per repetition, the start mode restored", async () => {
    const f = fakeDriver({ initial: "gl" });
    const r = await runAb(f.d, { runId: "r1", durations: SHORT });
    expect(r.ok).toBe(true);
    expect(f.calls.filter(c => c.startsWith("mode:"))).toEqual([...AB_ORDER.map(v => `mode:${v}`), "mode:gl"]);
    // ending in the start mode already: no extra rebuild
    const g = fakeDriver({ initial: "fat" });
    await runAb(g.d, { runId: "r1b", durations: SHORT });
    expect(g.calls.filter(c => c.startsWith("mode:"))).toEqual(AB_ORDER.map(v => `mode:${v}`));
    expect(f.calls).toContain("restore");
    expect(f.calls.filter(c => c === "revealEnd").length, "the local rapids come back after every reveal").toBe(6);
    expect(f.tapOn, "the tap is off after the run").toBe(false);
    const phases = f.emitted.filter(e => e.kind === "viewer.abrun").map(e => e.f.phase);
    expect(phases[0]).toBe("meta");
    expect(last(phases)).toBe("end");
    expect(phases.filter(p => p === "orbit").length).toBe(6);
  });

  it("every phase record: variant, status, the three histograms' summary, the memory at the VP39-01 points", async () => {
    const f = fakeDriver();
    await runAb(f.d, { runId: "r2", durations: SHORT });
    const rec = f.emitted.filter(e => e.kind === "viewer.abrun" && e.f.phase === "orbit" && e.f.variant === "fat")[0]!.f;
    expect(rec.status).toBe("ran");
    expect(rec.raf.n).toBeGreaterThan(0);
    expect(rec.raf.p95).toBe(17);                    // 16.7 ms frames: the bin's upper edge
    expect(rec.gpu.p95).toBe(10);
    expect(rec.memory_at).toBe("after_orbit");
    expect(rec.memory.mode).toBe("fat");
    const at = f.emitted.filter(e => e.f.memory_at).map(e => e.f.memory_at);
    for (const p of ["after_load", "after_orbit", "after_lods", "after_nav", "after_reveal", "end"]) expect(at).toContain(p);
    // one histogram record per kind for this phase (small: one part), bins whole
    const hist = f.emitted.filter(e => e.kind === "viewer.abhist" && e.f.seq === rec.seq);
    expect(hist.map(h => h.f.series).sort()).toEqual(["gpu", "mt", "raf"]);
    expect(hist.every(h => !("kind" in h.f)), "no field may shadow the telemetry event's kind").toBe(true);
    const raf = hist.find(h => h.f.series === "raf")!.f;
    expect([raf.part, raf.parts, raf.bins]).toEqual([0, 1, [16, rec.raf.n]]);
  });

  it("a phase that cannot run is named, never bypassed: skipped + reason, no histogram", async () => {
    const f = fakeDriver({ skipJumps: "Machine is on — the simulation needs it off" });
    const r = await runAb(f.d, { runId: "r3", durations: SHORT });
    const jumps = f.emitted.filter(e => e.kind === "viewer.abrun" && e.f.phase === "jumps");
    expect(jumps.every(e => e.f.status === "skipped" && e.f.reason === "Machine is on — the simulation needs it off")).toBe(true);
    expect(f.emitted.some(e => e.kind === "viewer.abhist" && jumps.some(j => j.f.seq === e.f.seq))).toBe(false);
    expect(r.skipped.length).toBe(6);
  });

  it("the phase's conditions ride its record (a hidden tab flags that phase only)", async () => {
    const f = fakeDriver({ hiddenIn: "fitdetail" });
    await runAb(f.d, { runId: "r4", durations: SHORT });
    const recs = f.emitted.filter(e => e.kind === "viewer.abrun" && e.f.variant);
    expect(recs.filter(e => e.f.hidden).map(e => e.f.phase)).toEqual(Array(6).fill("fitdetail"));
  });

  it("a blocker refuses the start, with its reason; nothing moves", async () => {
    const f = fakeDriver({ blocker: "No program loaded" });
    const r = await runAb(f.d, { runId: "r5", durations: SHORT });
    expect([r.ok, r.reason]).toEqual([false, "No program loaded"]);
    expect(f.calls).toEqual([]);
    expect(f.emitted).toEqual([]);
  });

  it("cancel: the phase under way leaves no sample, the viewer and the start mode are restored, it says so", async () => {
    const f = fakeDriver({ initial: "gl" });
    const cancel = { cancelled: false };
    const r = await runAb(f.d, { runId: "r6", durations: SHORT,
      onProgress: p => { if (p.rep === 1 && p.phase === "orbit") cancel.cancelled = true; }, cancel });
    expect([r.ok, r.cancelled]).toEqual([false, true]);
    expect(f.calls[f.calls.length - 2]).toBe("restore");
    expect(last(f.calls)).toBe("mode:gl");
    expect(f.emitted.some(e => e.f.rep === 1 && e.f.phase === "orbit"), "the cancelled orbit is not recorded").toBe(false);
    expect(last(f.emitted)!.f).toMatchObject({ phase: "end", cancelled: true });
  });
});
