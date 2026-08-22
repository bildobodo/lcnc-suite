// Run-playhead watcher (W2 P5) — the state machine between the live machine
// pose and the scrub track's run-time playhead.
//
// The wave-1 watcher projected the pose onto the track every status frame
// and, whenever the windowed match missed, RESCUED with a full-track 6D
// scan — so a machine parked off-path (the toolchange's G30 park is the
// canonical case) paid a 99k-segment scan per frame: browser.viewer.perf
// gap_p50 went 33 → 319 ms for the whole toolchange (report 6). It also
// ACCEPTED the rescue's best match regardless of residual, parking the
// playhead on whatever track point happened to be nearest the toolsetter.
//
// This machine makes off-path a NAMED state instead of a per-frame fight:
//
//   ATTACHED  windowed projection (+ trusted-line hint span competing on
//             residual) every frame. A miss triggers the escape transition:
//             exactly ONE full-track scan — that is also the attach path
//             for run start and run-from-line. Passes re-attach; fails ↓
//   OFF-PATH  playhead FROZEN, highlight cleared, chip shown. Zero
//             per-frame work; every RE-PROBE_MS: the hint span (exact,
//             cheap) plus a STRIDED coarse scan whose best candidate is
//             refined by a windowed stride-1 pass — only a refined residual
//             inside the escape gate re-attaches. Honest degradation: while
//             the machine is genuinely off the programmed path there IS no
//             right playhead, and the chip says so.
//
// Pure module: no Vue, no globals — ScrubBar owns the refs and feeds
// update() from its status watcher. Unit-tested with an injected projector
// (runWatcher.test.ts pins the per-frame op budget on a 200k track).
import {
  projectOntoTrack, type ScrubTrack, type TrackProjection,
} from "./scrubTrack";
import type { PartFrameWcs, WcsTerms } from "./partFrame";

export type RunWatcherPhase = "attached" | "offPath";

export interface RunWatcherInput {
  track: ScrubTrack;
  /** Machine axis pose (kins-forwarded live joints), [x,y,z,a,b,c]. */
  machine: readonly number[];
  wcs: PartFrameWcs;
  epochTerms?: readonly WcsTerms[];
  /** Trusted motion-line span (track indices) — a HINT that competes on
   *  residual, never an override. Null when attribution is untrusted. */
  hintSpan?: { start: number; end: number } | null;
  nowMs: number;
}

export interface RunWatcherOutput {
  phase: RunWatcherPhase;
  /** New playhead cum — null means "leave the display alone" (frozen
   *  off-path, or an off-path frame between re-probes). */
  cum: number | null;
  /** Matched upper track index (lineRunAround's input) when cum != null. */
  index: number | null;
  /** What this frame actually computed — the op-budget tests key on it. */
  probed: "window" | "full" | "reprobe" | "idle";
  /** Wall-clock cost of this update, for ui.playhead_slow telemetry. */
  costMs: number;
}

/** Residual gate: past this the machine is not ON the matched segment. */
export const RUN_ESCAPE_D2 = 100;  // (10 units)²
/** Off-path re-probe cadence. */
export const REPROBE_MS = 1000;
/** Strided coarse scan probes at most this many segments. */
export const STRIDE_TARGET = 4096;

type Project = typeof projectOntoTrack;

export interface RunWatcher {
  update(inp: RunWatcherInput): RunWatcherOutput;
  reset(): void;
  readonly phase: RunWatcherPhase;
}

export function createRunWatcher(project: Project = projectOntoTrack): RunWatcher {
  let phase: RunWatcherPhase = "attached";
  let track: ScrubTrack | null = null;
  let lastCum: number | null = null;
  let window = 0;
  let lastProbeMs = -Infinity;

  function reset(): void {
    phase = "attached";
    track = null;
    lastCum = null;
    window = 0;
    lastProbeMs = -Infinity;
  }

  // A few × the longest segment so one segment can't outrun the window.
  function computeWindow(t: ScrubTrack): number {
    let maxSeg = 0;
    for (let i = 1; i < t.count; i++) {
      const d = t.cum[i]! - t.cum[i - 1]!;
      if (d > maxSeg) maxSeg = d;
    }
    return Math.max(t.timeBased ? 5 : 200, 3 * maxSeg);
  }

  // Returns the COMPLETE output shape: building `{ phase, ...attach(x) }`
  // at a call site would read the stale pre-transition phase (object
  // literals evaluate left to right).
  function attach(best: TrackProjection,
                  probed: RunWatcherOutput["probed"]): Omit<RunWatcherOutput, "costMs"> {
    phase = "attached";
    lastCum = best.cum;
    return { phase: "attached", probed, cum: best.cum, index: best.index };
  }

  function update(inp: RunWatcherInput): RunWatcherOutput {
    const t0 = performance.now();
    const { track: t, machine: m, wcs, epochTerms: et, hintSpan, nowMs } = inp;
    if (t !== track) {
      // Track identity change (new program, entry-track swap): stale cum
      // and window belong to the OLD geometry — full reset, re-attach.
      reset();
      track = t;
    }
    if (!window) window = computeWindow(t);

    const done = (out: Omit<RunWatcherOutput, "costMs">): RunWatcherOutput =>
      ({ ...out, costMs: performance.now() - t0 });

    const hintBest = (): TrackProjection | null => hintSpan
      ? project(t, m, wcs, et, {
          lo: t.cum[Math.max(0, hintSpan.start - 1)]!,
          hi: t.cum[hintSpan.end]!,
        })
      : null;

    if (phase === "attached") {
      let best = lastCum != null
        ? project(t, m, wcs, et, {
            lo: lastCum - 0.25 * window,
            hi: lastCum + 0.75 * window,
          })
        : null;
      const h = hintBest();
      if (h && (!best || h.dist2 < best.dist2)) best = h;
      if (best && best.dist2 <= RUN_ESCAPE_D2) {
        return done(attach(best, "window"));
      }
      // Escape transition: exactly ONE full-track scan — the attach path
      // for run start / run-from-line, and the single full price paid
      // before off-path goes quiet.
      lastProbeMs = nowMs;
      const full = project(t, m, wcs, et, null);
      if (full && full.dist2 <= RUN_ESCAPE_D2) {
        return done(attach(full, "full"));
      }
      phase = "offPath";
      lastCum = null;
      return done({ phase, probed: "full", cum: null, index: null });
    }

    // OFF-PATH: zero work between re-probe ticks.
    if (nowMs - lastProbeMs < REPROBE_MS) {
      return done({ phase, probed: "idle", cum: null, index: null });
    }
    lastProbeMs = nowMs;
    const h = hintBest();
    if (h && h.dist2 <= RUN_ESCAPE_D2) {
      return done(attach(h, "reprobe"));
    }
    const stride = Math.max(1, Math.ceil((t.count - 1) / STRIDE_TARGET));
    const coarse = project(t, m, wcs, et, null, stride);
    if (coarse) {
      // Refine the coarse candidate at stride 1 in a window around it —
      // only the refined residual may re-attach (a strided best can sit a
      // stride's worth of path away from the true nearest segment).
      const fine = stride > 1
        ? project(t, m, wcs, et, {
            lo: coarse.cum - window, hi: coarse.cum + window,
          })
        : coarse;
      if (fine && fine.dist2 <= RUN_ESCAPE_D2) {
        return done(attach(fine, "reprobe"));
      }
    }
    return done({ phase, probed: "reprobe", cum: null, index: null });
  }

  return {
    update,
    reset,
    get phase() { return phase; },
  };
}
