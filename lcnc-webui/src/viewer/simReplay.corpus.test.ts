import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { decodePreviewStreams } from "../previewDecode";
import {
  buildScrubTrack, buildEntryTrack, sampleTrack, jointsForSample,
  type ScrubSample, type ScrubTrack,
} from "./scrubTrack";
import { specFromWire } from "./kins";
import { epochTermsFor, type WcsTableRow } from "./wcsEpochs";
import type { PartFrameWcs } from "./partFrame";
import { ref, shallowRef } from "vue";

// `sim_parity compare`, off-machine and in CI, on RECORDED data.
//
// The live gate needs a running LinuxCNC, an armed client to answer M6, and
// the operator's go — so it runs a handful of times a week at best. The
// committed corpus artifacts (payload + truth capture per run) are enough to
// replay the entire client playback chain against a real machine trajectory
// with no machine at all, which is what turns "the offline chain matches the
// machine" from an occasional ceremony into a standing assertion.
//
// The chain here is IMPORTED, never reimplemented, and mirrors
// scripts/simDump.ts step for step — reimplementing a step would put that
// step outside the gate (the W3 P3 lesson).
//
// SCOPE, stated precisely so nobody trusts it further than it goes: the
// payload is an INPUT here, so this does not protect the parse-side fix.
// Break gateway_util.insert_flip_relabels again and the committed payloads
// are unchanged, so this stays green. What it pins is (a) the CLIENT chain
// against a real machine trajectory, and (b) any payload the moment someone
// regenerates the artifacts — a bad payload cannot be committed past it.
// The live `sim_parity gate` remains the only thing that certifies the
// parse side end to end.

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = resolve(HERE, "../../../scripts/parity_corpus/runs");

/**
 * Nearest-SEGMENT distance from each sample of `a` to the polyline `b`, in 6D
 * joint space (degrees ≙ mm). A twin of sim_parity.path_deviation — segment,
 * not nearest-sample: two trajectories sampled on different grids are up to
 * half a step apart at every point, so a point-to-point metric measures the
 * sampling, not the paths (measured: ~2.0 where the real gate reads 0.04).
 */
function deviation(a: number[][], b: number[][]): number {
  if (!a.length || !b.length) return Infinity;
  const n = Math.min(6, b[0]!.length);
  let worst = 0;
  for (const p of a) {
    let best = Infinity;
    for (let s = 0; s + 1 < b.length; s++) {
      const p0 = b[s]!, p1 = b[s + 1]!;
      let l2 = 0, dot = 0;
      for (let i = 0; i < n; i++) {
        const d = (p1[i] ?? 0) - (p0[i] ?? 0);
        l2 += d * d;
        dot += ((p[i] ?? 0) - (p0[i] ?? 0)) * d;
      }
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot / l2));
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const proj = (p0[i] ?? 0) + t * ((p1[i] ?? 0) - (p0[i] ?? 0));
        const e = (p[i] ?? 0) - proj;
        acc += e * e;
      }
      if (acc < best) best = acc;
    }
    if (best > worst) worst = best;
  }
  return Math.sqrt(worst);
}

function replay(payloadPath: string, truthPath: string) {
  const payload = msgpackDecode(
    new Uint8Array(readFileSync(payloadPath))) as Record<string, any>;
  const truthLines = readFileSync(truthPath, "utf8").split("\n").filter((l: string) => l.trim());
  const header = JSON.parse(truthLines[0]!);
  if (!header?.header) return null;      // pre-header capture: nothing to pin

  const axes: string[] = header.axes ?? [];
  const wcs: PartFrameWcs = header.wcs;
  const kinsSpec = specFromWire(header.kins ?? undefined);
  const startJoints: number[] = header.start_joints ?? [];

  const d = decodePreviewStreams(payload);
  const base = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents);
  if (!base) return null;
  const epochTerms = base.wcsEvents
    ? epochTermsFor(base.wcsEvents, wcs, header.wcs_table as WcsTableRow[] | undefined)
    : undefined;

  let track: ScrubTrack = base;
  if (startJoints.length) {
    const t = buildEntryTrack(base, startJoints, axes, wcs, kinsSpec, epochTerms, null,
                              { linear: payload.rapid_rate, rotary: payload.rot_rapid_rate });
    if (t) track = t;
  }
  _lastEntryTrack = track !== base ? track : null;

  const cumMax = track.cum[track.count - 1] ?? 0;
  const step = track.timeBased ? 0.02 : 0.5;
  const cums: number[] = [];
  for (let i = 0; i < track.count; i++) cums.push(track.cum[i]!);
  for (let s = 0; s < cumMax; s += step) cums.push(s);
  cums.sort((a, b) => a - b);

  const sample: ScrubSample = {
    px: 0, py: 0, pz: 0, pa: 0, pb: 0, pc: 0,
    line: 0, rapid: false, kinstype: null, frame: null, wcsEpoch: null, index: 0,
  };
  const joints: (number | null)[] = [];
  const sim: number[][] = [];
  let nulls = 0;
  for (const s of cums) {
    sampleTrack(track, s, sample);
    jointsForSample(sample, wcs, axes, joints, kinsSpec, epochTerms);
    if (joints.some(j => j == null)) { nulls++; continue; }
    sim.push(joints.slice() as number[]);
  }
  const truth = truthLines.slice(1)
    .map((l: string) => JSON.parse(l).joints as number[])
    .filter(Boolean);
  return { sim, truth, nulls, samples: cums.length };
}

// The last entry track `replay` built — for the worker-boundary pin below.
let _lastEntryTrack: ScrubTrack | null = null;

const cases = existsSync(RUNS)
  ? readdirSync(RUNS).filter((f: string) => f.endsWith(".truth.ndjson"))
      .map((f: string) => f.replace(".truth.ndjson", ""))
      .filter((tag: string) => existsSync(`${RUNS}/${tag}.payload.msgpack`))
  : [];

/**
 * Per-program joint tolerance, from the corpus manifests the live gate uses
 * (scripts/parity_corpus/*.json: `tol` per entry, default 0.5). The two must
 * agree or this replay contradicts the gate on the same artifacts — e.g.
 * twp_g683_tilted carries a documented ~1.07 mm seed spike gated at 1.5.
 */
const CORPUS_DIR = resolve(HERE, "../../../scripts/parity_corpus");
const TOL: Record<string, number> = {};
for (const f of existsSync(CORPUS_DIR) ? readdirSync(CORPUS_DIR) : []) {
  if (!f.endsWith(".json")) continue;
  try {
    const m = JSON.parse(readFileSync(`${CORPUS_DIR}/${f}`, "utf8"));
    for (const e of m.programs ?? []) {
      const base = String(e.file).split("/").pop()!.replace(/\.ngc$/i, "");
      if (typeof e.tol === "number") TOL[base] = e.tol;
    }
  } catch { /* a manifest that does not parse contributes no tolerance */ }
}
const tolFor = (tag: string) => TOL[tag.replace(/\.run\d+$/, "")] ?? 0.5;

describe("sim replay vs recorded machine truth (committed corpus)", () => {
  it("has corpus artifacts to replay", () => {
    // A silently empty suite would be the worst outcome: it looks green.
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const tag of cases) {
    it(`${tag}: the offline chain reproduces the real trajectory`, () => {
      const r = replay(`${RUNS}/${tag}.payload.msgpack`, `${RUNS}/${tag}.truth.ndjson`);
      expect(r, `${tag}: unreplayable payload`).not.toBeNull();
      const { sim, truth, samples } = r!;
      expect(truth.length, `${tag}: empty truth capture`).toBeGreaterThan(0);
      expect(sim.length, `${tag}: empty sim trajectory`).toBeGreaterThan(0);
      // >5% null joints means axes we could not derive — unchecked is not
      // clean, so refuse to certify rather than comparing what is left.
      expect(r!.nulls / samples, `${tag}: too many underivable samples`)
        .toBeLessThan(0.05);
      // Both directions: the sim must cover the real path AND invent nothing.
      // sim->truth is the one that catches a phantom excursion (897 mm, once).
      const tol = tolFor(tag);
      expect(deviation(truth, sim), `${tag}: truth not covered by sim (tol ${tol})`)
        .toBeLessThan(tol);
      expect(deviation(sim, truth), `${tag}: sim invents motion (tol ${tol})`)
        .toBeLessThan(tol);
    });
  }
});

/**
 * Worker-boundary pin (2026-08-30): the collision sweep posts the track's
 * nested `frames`/`wcsEvents` to a Worker. A track held in a DEEP Vue `ref`
 * re-wraps those arrays in Proxies, and structured clone refuses Proxies —
 * the sweep threw DataCloneError after setting its busy flag and the Check
 * chip sat at 0% for the whole sim session. ScrubBar holds the entry track
 * in a shallowRef + markRaw; this asserts that choice is load-bearing on a
 * REAL entry track (frames present on TWP payloads).
 */
describe("entry track across the worker boundary", () => {
  const withFrames = cases.find((tag) => {
    const r = replay(`${RUNS}/${tag}.payload.msgpack`, `${RUNS}/${tag}.truth.ndjson`);
    return r && _lastEntryTrack?.frames?.length;
  });
  it.skipIf(!withFrames)("shallowRef keeps the track cloneable; a deep ref does not", () => {
    replay(`${RUNS}/${withFrames}.payload.msgpack`, `${RUNS}/${withFrames}.truth.ndjson`);
    const track = _lastEntryTrack!;
    const post = (t: ScrubTrack) => structuredClone({ frames: t.frames, wcs: t.wcsEvents });
    expect(() => post(shallowRef(track).value!)).not.toThrow();
    expect(() => post(ref(track).value as ScrubTrack)).toThrow();
  });
});
