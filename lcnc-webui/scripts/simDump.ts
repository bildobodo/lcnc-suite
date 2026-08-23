// Sim-trajectory dump (W6 P2) — the sim side of the sim-vs-actual gate.
//
// Replays a preview payload through the ACTUAL client playback chain —
// decodePreviewStreams → buildScrubTrack → buildEntryTrack →
// sampleTrack + jointsForSample — and writes the joint-space trajectory
// the 3D sim would pose the machine along. scripts/sim_parity.py compares
// it against a real-run capture (twp_parity sample_run). Everything here
// is IMPORTED from the client modules; reimplementing any step would put
// that step outside the gate (the W3 P3 lesson).
//
// Usage (from lcnc-webui/):
//   npx vite-node scripts/simDump.ts <payload.msgpack> <truth.ndjson> <out.jsonl> [--no-entry]
//
// <truth.ndjson>'s FIRST line is the context header sample_run writes
// (axes, kins wire decl, PartFrameWcs, wcs_table rows, start_joints) —
// captured at the same instant as the truth, so both trajectories share
// one state snapshot.
import { readFileSync, writeFileSync } from "node:fs";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { decodePreviewStreams } from "../src/previewDecode";
import {
  buildScrubTrack, buildEntryTrack, sampleTrack, jointsForSample,
  type ScrubSample, type ScrubTrack,
} from "../src/viewer/scrubTrack";
import { specFromWire } from "../src/viewer/kins";
import { epochTermsFor, type WcsTableRow } from "../src/viewer/wcsEpochs";
import type { PartFrameWcs } from "../src/viewer/partFrame";

function fail(msg: string): never {
  console.error(`simDump: ${msg}`);
  process.exit(2);
}

const args = process.argv.slice(2).filter(a => a !== "--");
const noEntry = args.includes("--no-entry");
const [payloadPath, truthPath, outPath] = args.filter(a => !a.startsWith("--"));
if (!payloadPath || !truthPath || !outPath) {
  fail("usage: vite-node scripts/simDump.ts <payload.msgpack> <truth.ndjson> <out.jsonl> [--no-entry]");
}

const payload = msgpackDecode(new Uint8Array(readFileSync(payloadPath))) as Record<string, any>;
const headerLine = readFileSync(truthPath, "utf8").split("\n").find(l => l.trim());
const header = headerLine ? JSON.parse(headerLine) : null;
if (!header?.header) fail(`${truthPath} has no context header (old capture? re-run sample_run)`);

const axes: string[] = header.axes ?? [];
const wcs: PartFrameWcs = header.wcs;
const kinsSpec = specFromWire(header.kins ?? undefined);
const startJoints: number[] = header.start_joints ?? [];

const d = decodePreviewStreams(payload);
const base = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames);
if (!base) fail("scrub track unbuildable from this payload — the sim would not offer itself (that IS a red result)");
const epochTerms = base.wcsEvents
  ? epochTermsFor(base.wcsEvents, wcs, header.wcs_table as WcsTableRow[] | undefined)
  : undefined;

let track: ScrubTrack = base;
let entryUsed = false;
if (!noEntry && startJoints.length) {
  const t = buildEntryTrack(base, startJoints, axes, wcs, kinsSpec, epochTerms, null,
                            { linear: payload.rapid_rate, rotary: payload.rot_rapid_rate });
  if (t) { track = t; entryUsed = true; }
}

// Sample plan: every vertex cum (exact corners) + a uniform grid fine
// enough that segment interpolation itself is exercised (the arc class
// lives BETWEEN vertices). Time-based tracks: 20 ms; distance tracks:
// 0.5 units.
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
let nullSamples = 0;
const lines: string[] = [JSON.stringify({
  meta: true, points: track.count, samples: cums.length,
  timeBased: track.timeBased, entry: entryUsed, cumMax,
})];
for (const s of cums) {
  sampleTrack(track, s, sample);
  jointsForSample(sample, wcs, axes, joints, kinsSpec, epochTerms);
  if (joints.some(j => j == null)) nullSamples++;
  lines.push(JSON.stringify({ cum: Math.round(s * 1e4) / 1e4, joints: joints.slice() }));
}
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`simDump: ${cums.length} samples (${track.count} vertices, ` +
            `entry=${entryUsed}, timeBased=${track.timeBased}` +
            (nullSamples ? `, ${nullSamples} samples with null joints — UNCHECKED axes` : "") +
            `) -> ${outPath}`);
