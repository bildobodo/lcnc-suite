// The part-B A/B measurement run (Codex R39 VP39-03; temporary — removed
// with the previous GL line after the acceptance). One button in Settings →
// Debug drives a FIXED sequence through the viewer, so both line renderers
// see the same camera path and the same data:
//
//   calibrate    once, before any build, the path hidden: the reference frame
//                rate (the variants must not set the limit they are judged by)
//   for each variant in AB_ORDER (A, B, B, A, A, B — the order alternates):
//     build      a REAL rebuild in that renderer, every time (never both held)
//     warmup     hold still; the measured refresh rate comes from here
//     orbit      a fixed camera orbit
//     fitdetail  fit ↔ detail, forcing LOD changes
//     jumps      finding jumps on the scrub bar (needs the simulation)
//     overlay_off  the orbit again with the limit overlays hidden
//     reveal     rapids hidden locally + finding jumps (the finding's view)
//     release    dispose the drawn path, keep the program: the ledger's return
//
// Every jump sequence starts from the SAME timeline state (VP-I15); the
// user's timeline, simulation and camera are put back at the end.
//
// Each phase records its raw samples (viewerPerf's tap) into mergeable
// histograms and emits them with the phase's conditions — a hidden tab, an
// open dialog, a camera touched by hand, a running collision sweep — and the
// memory ledger at the VP39-01 points. A phase that cannot run says why
// (`skipped` + reason); nothing is bypassed to make it run.
// scripts/viewer_ab_report.py merges the runs and gives the verdict.
import { PhaseHistogram, splitSparse } from "./abHistogram";
import type { PathMemory } from "./toolpathController";

export type AbVariant = "gl" | "fat";
/** A = the previous GL line, B = the 2 CSS px line; the order alternates. */
export const AB_ORDER: readonly AbVariant[] = ["gl", "fat", "fat", "gl", "gl", "fat"];
export const AB_LABELS: Record<AbVariant, string> = { gl: "Previous GL line", fat: "2 CSS px" };

export interface AbDurations {
  calibrateMs: number;
  warmupMs: number;
  orbitMs: number;
  fitDetailCycles: number;
  fitDetailHoldMs: number;
  jumps: number;
  jumpMs: number;
  overlayMs: number;
}
export const AB_DURATIONS: AbDurations = {
  calibrateMs: 3000, warmupMs: 3000, orbitMs: 30000, fitDetailCycles: 8, fitDetailHoldMs: 1500, jumps: 16, jumpMs: 600, overlayMs: 10000,
};

export type AbPhase = "calibrate" | "build" | "warmup" | "orbit" | "fitdetail" | "jumps" | "overlay_off" | "reveal" | "release";

/** What happened around a phase, since the previous call (sticky flags). */
export interface AbConditions { hidden: boolean; dialog: boolean; interacted: boolean; sweepBusy: boolean }

/** What the run needs from the viewer. A string result is the reason a
 *  phase could not run. */
export interface AbDriver {
  /** Why the run cannot start now, else null. */
  blocker(): string | null;
  lineMode(): AbVariant;
  /** REBUILD the paths in that renderer — a real build whether or not the
   *  mode changes (Codex R47 VP-I14); resolves once a frame was drawn. */
  setLineMode(v: AbVariant): Promise<void>;
  /** The reference frame rate, measured before any build with the path
   *  HIDDEN (Codex R47, answer 1: the variants under test must not set the
   *  limit they are judged by). */
  calibrate(ms: number): Promise<void>;
  /** Dispose the drawn path, keep the program (VP-I17: the ledger's return
   *  to the payload); the next build rebuilds it. */
  release(): Promise<void>;
  /** Extra fields for the phase record just measured (e.g. where the finding
   *  jumps landed — every repetition must see the same sequence, VP-I15). */
  notes(): Record<string, unknown>;
  warmUp(ms: number): Promise<void>;
  orbit(ms: number): Promise<void>;
  fitDetail(cycles: number, holdMs: number): Promise<void>;
  findingJumps(n: number, ms: number): Promise<string | null>;
  overlayOff(ms: number): Promise<string | null>;
  /** Rapids hidden LOCALLY (never the stored layer) + finding jumps: the
   *  finding's view (reveal). The rapids stay hidden until revealEnd, so the
   *  phase's memory is read with the reveal built. */
  revealJumps(n: number, ms: number): Promise<string | null>;
  revealEnd(): Promise<void>;
  /** Camera, local layers and the simulation back as the run found them. */
  restore(): Promise<void>;
  memory(): PathMemory;
  render(): Record<string, number>;
  conditions(): AbConditions;
  meta(): Record<string, unknown>;
  tap(fn: ((kind: "raf" | "mt" | "gpu", ms: number, now: number) => void) | null): void;
  emit(kind: string, fields: Record<string, unknown>): void;
  now(): number;
}

export interface AbProgress { rep: number; reps: number; variant: AbVariant; phase: AbPhase }
export interface AbResult { ok: boolean; reason?: string; runId: string; phases: number; skipped: string[]; cancelled: boolean }

/** A histogram record's JSON stays under this (the trace bus truncates a
 *  line over PIPE_BUF — 4096 B with the gateway's own fields). */
const HIST_MAX_CHARS = 2600;

export async function runAb(d: AbDriver, o: {
  runId: string;
  order?: readonly AbVariant[];
  durations?: Partial<AbDurations>;
  onProgress?: (p: AbProgress) => void;
  cancel?: { cancelled: boolean };
}): Promise<AbResult> {
  const order = o.order ?? AB_ORDER;
  const dur = { ...AB_DURATIONS, ...o.durations };
  const run = o.runId;
  const blocked = d.blocker();
  if (blocked) return { ok: false, reason: blocked, runId: run, phases: 0, skipped: [], cancelled: false };

  const initial = d.lineMode();
  let seq = 0;
  const skipped: string[] = [];
  d.emit("viewer.abrun", { run, seq: seq++, phase: "meta", order: order.join(","), durations: dur, initial, ...d.meta() });

  const memOf = (m: PathMemory) => ({ mode: m.mode, cpu: m.cpu, gpu: m.gpu, allocated: m.allocated, peak: m.peak,
    generation: m.generation, pairs: m.pairs });
  let cancelled = false;
  try {
    for (let rep = -1; rep < order.length; rep++) {
      // rep -1: the calibration, before any build, with no variant
      const variant = rep < 0 ? "none" as unknown as AbVariant : order[rep]!;
      const phase = async (name: AbPhase, act: () => Promise<string | null | void>, memoryAt?: string) => {
        if (o.cancel?.cancelled) throw new Cancelled();
        o.onProgress?.({ rep, reps: order.length, variant, phase: name });
        const hist = { raf: new PhaseHistogram(), mt: new PhaseHistogram(), gpu: new PhaseHistogram() };
        d.conditions();   // start the phase's sticky flags afresh
        d.tap((kind, ms, now) => hist[kind].add(ms, now));
        const t0 = d.now();
        let reason: string | null | void;
        try { reason = await act(); } finally { d.tap(null); }
        if (o.cancel?.cancelled) throw new Cancelled();   // a cancelled phase is no sample
        const ms = d.now() - t0;
        for (const h of Object.values(hist)) h.finish();
        const cond = d.conditions();
        const status = reason ? "skipped" : "ran";
        if (reason) skipped.push(`${rep + 1}/${variant}/${name}: ${reason}`);
        const sum = (k: keyof typeof hist) => {
          const t = hist[k].total;
          return { n: t.n, p95: t.quantile(0.95), win_p95_max: hist[k].windowP95Max, max: +t.max.toFixed(1),
            over_50: t.atLeast(50), over_100: t.atLeast(100) };
        };
        const s = seq++;
        d.emit("viewer.abrun", {
          run, seq: s, rep, variant, phase: name, status, ...(reason ? { reason } : {}), ms: Math.round(ms),
          hidden: cond.hidden, dialog: cond.dialog, interacted: cond.interacted, sweep_busy: cond.sweepBusy,
          raf: sum("raf"), mt: sum("mt"), gpu: sum("gpu"),
          ...(memoryAt ? { memory_at: memoryAt, memory: memOf(d.memory()) } : {}),
          render: d.render(), ...d.notes(),
        });
        if (status === "ran") {
          for (const kind of ["raf", "mt", "gpu"] as const) {
            const t = hist[kind].total;
            if (t.n === 0) continue;
            const parts = splitSparse(t.sparse(), HIST_MAX_CHARS);
            // `series`, never `kind`: emitTelemetry's own `kind` names the event.
            parts.forEach((bins, part) => d.emit("viewer.abhist", {
              run, seq: s, rep, variant, phase: name, series: kind, part, parts: parts.length, n: t.n, max: +t.max.toFixed(1), bins }));
          }
        }
      };
      if (rep < 0) { await phase("calibrate", () => d.calibrate(dur.calibrateMs)); continue; }
      await phase("build", async () => { await d.setLineMode(variant); }, "after_load");
      await phase("warmup", () => d.warmUp(dur.warmupMs));
      await phase("orbit", () => d.orbit(dur.orbitMs), "after_orbit");
      await phase("fitdetail", () => d.fitDetail(dur.fitDetailCycles, dur.fitDetailHoldMs), "after_lods");
      await phase("jumps", () => d.findingJumps(dur.jumps, dur.jumpMs), "after_nav");
      await phase("overlay_off", () => d.overlayOff(dur.overlayMs));
      try { await phase("reveal", () => d.revealJumps(dur.jumps, dur.jumpMs), "after_reveal"); }
      finally { await d.revealEnd(); }
      await phase("release", async () => { await d.release(); }, "after_release");
    }
  } catch (e) {
    if (!(e instanceof Cancelled)) throw e;
    cancelled = true;
  } finally {
    d.tap(null);
    await d.restore();
    // always a real build: the last phase released the path
    await d.setLineMode(initial);
    d.emit("viewer.abrun", { run, seq: seq++, phase: "end", cancelled, skipped: skipped.length,
      memory_at: "end", memory: memOf(d.memory()) });
  }
  return { ok: !cancelled, runId: run, phases: seq, skipped, cancelled, ...(cancelled ? { reason: "cancelled" } : {}) };
}

class Cancelled extends Error {}
