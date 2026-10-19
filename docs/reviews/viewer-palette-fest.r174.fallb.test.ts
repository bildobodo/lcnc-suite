// Evidence copy of the measurement (never in the repository's tests; the
// operator's program data stays local — only numbers go into the evidence): haus.ngc Fall B for B8 (step 4 package 2,
// plan 5) — the same base track swept with the per-line sample (the old rule,
// `lineSample`) and without, in ONE process on one core, so both run under
// the same load: wall, query time, queries, probes, samples, heap, and what
// the contact tables hold.
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, it } from "vitest";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { decodePreviewStreams } from "../previewDecode";
import { buildScrubTrack } from "./scrubTrack";
import { buildCollisionModel, sweepCollisionsIter, toolCylinderPositions, type CollisionBody, type CollisionMachine } from "./collision";
import { specFromWire } from "./kins";
import { ContactStore, NONE } from "./contactStore";
import { buildContactView, viewCounts } from "./contactView";

const DIR = path.resolve(__dirname, "../../../examples/sim_config/machine-5axis-xyzac");
// the operator's payload and the live state at its parse: local files, never in the repository
const PAYLOAD = process.env.B8_PAYLOAD!, INIT = process.env.B8_INIT!;
const OUT = process.env.B8_OUT ?? "/dev/null";
const MAXMS = Number(process.env.B8_MAXMS) || undefined;
const ORDER = (process.env.B8_ORDER ?? "off,on,off").split(",");
const log = (s: string) => { fs.appendFileSync(OUT, s + "\n"); };
function parseBinSTL(buf: Buffer): Float32Array {
  const n = buf.readUInt32LE(80);
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) { const off = 84 + i * 50 + 12; for (let v = 0; v < 9; v++) out[i * 9 + v] = buf.readFloatLE(off + v * 4); }
  return out;
}
it("haus.ngc Fall B, with and without the per-line sample", { timeout: 86_400_000 }, () => {
  const gc = (globalThis as { gc?: () => void }).gc;
  const LIVE = JSON.parse(fs.readFileSync(INIT, "utf8"));
  const mj = JSON.parse(fs.readFileSync(path.join(DIR, "machine.json"), "utf8"));
  const machine: CollisionMachine = { groups: mj.groups, kinematics: mj.kinematics, workGroup: mj.workGroup, toolGroup: mj.toolGroup, unitScale: 1,
    axes: ["X", "Y", "Z", "A", "C"], kins: specFromWire(LIVE.viewer_init.kins) ?? undefined };
  const bodies: CollisionBody[] = mj.parts.filter((p: any) => p.collide !== false).map((p: any) => ({
    id: p.id, group: p.group ?? "root", positions: parseBinSTL(fs.readFileSync(path.join(DIR, p.file))),
    translate: p.translate, rotate: p.rotate, stock: !!p.stock }));
  bodies.push({ id: "tool", group: mj.toolGroup, positions: toolCylinderPositions(6, 65.04), tool: true } as CollisionBody);
  const model = buildCollisionModel(machine, bodies);
  const payload = msgpackDecode(fs.readFileSync(PAYLOAD)) as any;
  const d = decodePreviewStreams(payload);
  const track = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents)!;
  const wcs = { g5x: LIVE.status.g5x_offset, g92: [], rotationDeg: 0, tool: LIVE.status.tool_offset } as any;
  log(`# haus.ngc Fall B (B8) ${new Date().toISOString()} — head ${process.env.B8_HEAD ?? "?"}, gc ${gc ? "exposed" : "absent"}, order ${ORDER.join(" ")}`);
  log(`model: bodies ${model.bodies.length}, pairs ${model.pairs.length}; track points ${track.count}, end cum ${track.cum[track.count - 1]!.toFixed(1)}`);
  const pairName = (p: number) => ({ a: model.bodies[model.pairs[p]![0]]!.id, b: model.bodies[model.pairs[p]![1]]!.id });
  const runs = new Map<string, { st: ContactStore; end: number }>();
  for (const [k, variant] of ORDER.entries()) {
    const on = variant === "on";
    gc?.(); gc?.();
    const heap0 = process.memoryUsage().heapUsed;
    const store = new ContactStore(1, 0);
    const profile: { queries?: Uint32Array; ms?: Float64Array; probes?: Uint32Array } = {};
    const t0 = performance.now();
    const iter = sweepCollisionsIter(model, track, wcs, { margin: 2, contacts: { store }, profile, ...(on ? { lineSample: true } : {}), ...(MAXMS ? { maxMs: MAXMS } : {}) });
    let peak = heap0, nextLog = 60_000;
    let r = iter.next();
    while (!r.done) {
      const m = process.memoryUsage().heapUsed;
      if (m > peak) peak = m;
      const t = performance.now() - t0;
      if (t >= nextLog) { log(`  [${k} ${variant}] t ${(t / 1000).toFixed(0)} s progress ${(r.value * 100).toFixed(1)} %`); nextLog += 60_000; }
      r = iter.next();
    }
    const res = r.value, wall = performance.now() - t0;
    const sum = (a?: ArrayLike<number>) => { let n = 0; for (let i = 0; i < (a?.length ?? 0); i++) n += a![i]!; return n; };
    gc?.(); gc?.();
    const heap1 = process.memoryUsage().heapUsed;
    const E = store.episodes;
    let touchEp = 0, nearEp = 0;
    for (let e = 0; e < E.rows; e++) (E.get(e, "ivCount") > 0 ? touchEp++ : nearEp++);
    const end = track.cum[track.count - 1]!;
    const v = buildContactView({ sources: [{ stores: [store], at: c => c, ownCoverage: end }], pairName, coverage: end });
    const vc = viewCounts(v);
    log(`[${k}] ${on ? "WITH the per-line sample (old rule)" : "WITHOUT (B8)"}: wall ${(wall / 1000).toFixed(1)} s, query ms ${sum(profile.ms).toFixed(0)}, queries ${sum(profile.queries)}, probes ${sum(profile.probes)}, samples ${res.samples}, truncated ${JSON.stringify(res.truncated)}`);
    log(`    heap: before ${(heap0 / 1e6).toFixed(0)} MB, peak ${(peak / 1e6).toFixed(0)} MB, after (gc) ${(heap1 / 1e6).toFixed(0)} MB; store rows: episodes ${E.rows} (with a touch ${touchEp}, near misses ${nearEp}), intervals ${store.intervals.rows}, gaps ${store.gaps.rows}`);
    log(`    view: ${JSON.stringify(vc)}; static ${res.staticContacts.length}; uncertified ${JSON.stringify(res.uncertified)}`);
    {
      const pr = profile.probes ?? new Uint32Array(0), ms = profile.ms ?? new Float64Array(0), q = profile.queries ?? new Uint32Array(0);
      const idx = Array.from(pr.keys()).sort((a, b) => ms[b]! - ms[a]!).slice(0, 10);
      log(`    top query-ms pairs: ${idx.map(i => `${pairName(i).a}/${pairName(i).b} ${(ms[i]! / 1000).toFixed(1)} s ${q[i]} q ${pr[i]} p`).join("; ")}`); }
    runs.set(variant, { st: store, end });
  }
  // what the tables hold, compared: touch onsets per pair, every near stay of
  // the run with it inside a stay of the same pair without it (by lines)
  const on = runs.get("on"), off = runs.get("off");
  if (!on || !off) return;
  const lineOf = (x: number) => { let i = 1; while (i < track.count - 1 && track.cum[i]! < x) i++; return track.lines[i]!; };
  const eps = (st: ContactStore, touch: boolean) => {
    const m = new Map<number, Array<{ onset: number; end: number; first: number; last: number }>>();
    for (let e = 0; e < st.episodes.rows; e++) {
      if ((st.episodes.get(e, "ivCount") > 0) !== touch) continue;
      const p = st.episodes.get(e, "pair"), o = st.episodes.get(e, "onset"), x = st.episodes.get(e, "end"), en = Number.isNaN(x) ? on.end : x;
      m.set(p, [...(m.get(p) ?? []), { onset: o, end: en, first: lineOf(o), last: lineOf(en) }]);
    }
    return m;
  };
  const tOn = eps(on.st, true), tOff = eps(off.st, true);
  let same = 0, moved: string[] = [];
  for (const [p, l] of tOn) for (const e of l) {
    const o = (tOff.get(p) ?? []).find(f => Math.abs(f.onset - e.onset) <= 2);
    if (o) same++; else moved.push(`${pairName(p).a}/${pairName(p).b} @${e.onset.toFixed(2)} L${e.first}`);
  }
  let onlyOff: string[] = [];
  for (const [p, l] of tOff) for (const e of l) if (!(tOn.get(p) ?? []).some(f => Math.abs(f.onset - e.onset) <= 2)) onlyOff.push(`${pairName(p).a}/${pairName(p).b} @${e.onset.toFixed(2)} L${e.first}`);
  log(`touch onsets: with ${[...tOn.values()].flat().length}, without ${[...tOff.values()].flat().length}; the same within 2 units ${same}; only with: ${JSON.stringify(moved)}; only without: ${JSON.stringify(onlyOff)}`);
  // touch intervals: the run without covers every witness of the run with (bisection tolerance)
  const ivs = (st: ContactStore) => {
    const m = new Map<number, Array<[number, number]>>();
    for (let k = 0; k < st.intervals.rows; k++) {
      const p = st.episodes.get(st.intervals.get(k, "episode"), "pair"), x = st.intervals.get(k, "exit");
      m.set(p, [...(m.get(p) ?? []), [st.intervals.get(k, "enter"), Number.isNaN(x) ? on.end : x]]);
    }
    return m;
  };
  const iOff = ivs(off.st);
  let wIn = 0; const wOut: string[] = [];
  for (let k = 0; k < on.st.intervals.rows; k++) {
    const p = on.st.episodes.get(on.st.intervals.get(k, "episode"), "pair"), w = on.st.intervals.get(k, "witness");
    if ((iOff.get(p) ?? []).some(([a, b]) => w >= a - 0.01 && w <= b + 0.01)) wIn++; else wOut.push(`${pairName(p).a}/${pairName(p).b} @${w.toFixed(3)}`);
  }
  log(`witnesses of the run with it inside the run without's touch intervals: ${wIn} of ${on.st.intervals.rows}; outside: ${JSON.stringify(wOut.slice(0, 20))}`);
  const nOn = eps(on.st, false), sOff = new Map<number, Array<{ first: number; last: number }>>();
  for (let e = 0; e < off.st.episodes.rows; e++) {
    const p = off.st.episodes.get(e, "pair"), x = off.st.episodes.get(e, "end");
    sOff.set(p, [...(sOff.get(p) ?? []), { first: lineOf(off.st.episodes.get(e, "onset")), last: lineOf(Number.isNaN(x) ? on.end : x) }]);
  }
  let nIn = 0; const nOut: string[] = [];
  for (const [p, l] of nOn) for (const e of l) {
    if ((sOff.get(p) ?? []).some(f => f.first <= e.first && f.last >= e.last)) nIn++;
    else nOut.push(`${pairName(p).a}/${pairName(p).b} L${e.first}–L${e.last}`);
  }
  log(`near stays of the run with it inside a stay of the same pair without it (by lines): ${nIn} of ${[...nOn.values()].flat().length}; not: ${JSON.stringify(nOut.slice(0, 30))}`);
  expect(NONE).toBeDefined();
});
