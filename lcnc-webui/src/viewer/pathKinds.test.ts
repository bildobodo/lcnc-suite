// The changes between feed and rapid from the payload to every consumer of the
// path (2026-11-25). The payloads are the REAL parse worker's
// (scripts/gen_path_kinds_payloads.py), each once as shipped and once with
// nothing thinned (`.full`): programs whose rapid vertices lie on a chord of
// the rapid stream although feeds run between — canned cycles, a rapid into
// the part before a feed, a ramp entered at a level re-entered by rapid. The
// worker dropped them; test_path_kinds_worker.py holds the worker. HERE: no
// layer of the client drops a change of kind again — the merged track, the
// simulation's entry and slices, the check's copy and its sweep, the drawn
// sections, the display levels, the part-frame bake, the packed lines.
//
// And the course inside a run of one kind (Codex R487 H1): at every time of
// the un-thinned path the shipped one is at the same place, a feed on the same
// line, and the check finds the same contacts.
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";
import { decodePreviewStreams } from "../previewDecode";
import { buildCollisionModel, sweepCollisions, toolCylinderPositions, type CollisionMachine } from "./collision";
import { copyTrackForWorker } from "./colTrackCopy";
import { ContactStore, EP_RAPID, IV_RAPID } from "./contactStore";
import { packPairs } from "./fatPaths";
import { buildFrameIndex, buildLodLevels } from "./lineChunks";
import { transformToPartFrame, type PartFrameMachine } from "./partFrame";
import { buildEntryTrack, buildScrubTrack, displayLineForPoint, sampleTrack, sliceTrack, splitTrackStreams, type ScrubSample, type ScrubTrack } from "./scrubTrack";

const DIR = path.resolve(__dirname, "../../../scripts/test_fixtures/path_kinds_payloads");
const CASES = fs.readdirSync(DIR).filter(f => f.endsWith(".msgpack") && !f.endsWith(".full.msgpack")).map(f => f.slice(0, -8)).sort();

function load(name: string) {
  const raw = msgpackDecode(fs.readFileSync(path.join(DIR, `${name}.msgpack`))) as Record<string, any>;
  const d = decodePreviewStreams(raw);
  const track = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents, d.rotaryCmd,
                                d.startBelieved, d.startUnbound)!;
  return { raw, d, track };
}
type Path = { pos: Float32Array; abc: Float32Array; rapid: Uint8Array; cum: Float32Array; count: number };
/** The runs of one kind: the kind and the points they begin and end at. */
function runs(t: Path, from = 0): { rapid: number; first: number[]; last: number[]; end: number }[] {
  const at = (i: number) => [...t.pos.subarray(i * 3, i * 3 + 3), ...t.abc.subarray(i * 3, i * 3 + 3)];
  const out: { rapid: number; first: number[]; last: number[]; end: number }[] = [];
  for (let i = from; i < t.count; i++) {
    const r = out[out.length - 1];
    if (r && r.rapid === t.rapid[i]) { r.last = at(i); r.end = t.cum[i]!; }
    else out.push({ rapid: t.rapid[i]!, first: at(i), last: at(i), end: t.cum[i]! });
  }
  return out;
}
/** The payload's own path, apart from buildScrubTrack: its vertices sorted by
 *  their execution order. */
function bySeq(d: ReturnType<typeof decodePreviewStreams>): Path {
  const at: { seq: number; rapid: number; p: number[]; a: number[] }[] = [];
  for (const [s, rapid] of [[d.feed, 0], [d.rapid, 1]] as const)
    for (let i = 0; i < s.pos.length / 3; i++)
      at.push({ seq: s.seq![i]!, rapid, p: [...s.pos.subarray(i * 3, i * 3 + 3)], a: s.abc ? [...s.abc.subarray(i * 3, i * 3 + 3)] : [0, 0, 0] });
  at.sort((x, y) => x.seq - y.seq);
  return { pos: Float32Array.from(at.flatMap(v => v.p)), abc: Float32Array.from(at.flatMap(v => v.a)), rapid: Uint8Array.from(at.map(v => v.rapid)),
           cum: new Float32Array(at.length), count: at.length };
}
const kinds = (t: Path, from = 0) => runs(t, from).map(({ rapid, first, last }) => ({ rapid, first, last }));

describe("a change between feed and rapid reaches every consumer of the path", () => {
  it("the fixtures hold what the cases are for", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(11);
    // a G83's pecks: 7 feeds and 13 rapids between the first plane and the last retract, per hole
    expect(runs(load("pk_g83_99").track).length).toBeGreaterThan(30);
  });

  it.each(CASES)("%s: the merged track has the un-thinned path's runs, end points bit-equal, the time at each run's end the same", name => {
    const { track: thin, d } = load(name), full = load(`${name}.full`).track;
    expect(kinds(thin), "the payload's execution order").toEqual(kinds(bySeq(d)));
    expect(kinds(thin)).toEqual(kinds(full));
    const a = runs(thin), b = runs(full);
    a.forEach((r, i) => expect(r.end, `run ${i}'s end`).toBeCloseTo(b[i]!.end, 3));
  });

  it.each(CASES)("%s: a slice, the entry track and the check's copy keep them", name => {
    const { track } = load(name);
    expect(kinds(sliceTrack(track, 0, track.count))).toEqual(kinds(track));
    const { trackCopy } = copyTrackForWorker(track);
    expect(kinds(trackCopy as Path)).toEqual(kinds(track));
    const entry = buildEntryTrack(track, [100, 100, 45, 0], ["X", "Y", "Z", "A"], { g5x: [], g92: [], rotationDeg: 0, tool: [0, 0, 0] }, undefined, undefined, null,
                                  { linear: 10, rotary: 10 });
    // the entry move in front (its point and the move into the first one), the base's points behind it
    if (entry) expect(kinds(entry, 1).slice(1)).toEqual(kinds(track).slice(1));
  });

  it.each(CASES)("%s: the drawn sections draw every move once, in its own stream", name => {
    const { track } = load(name);
    const s = splitTrackStreams(track);
    const drawn = new Map<number, number>();
    for (const [rapid, src, breaks, n] of [[0, s.feedSrc, s.feedBreaks, s.feedPos.length / 3], [1, s.rapidSrc, s.rapidBreaks, s.rapidPos.length / 3]] as const) {
      const { table } = buildFrameIndex(n, breaks);
      for (let q = 0; q < table.length; q += 2) {
        const a = src![table[q]!]!, b = src![table[q + 1]!]!;
        expect(b - a, `a drawn pair joins neighbours of the path (${a} → ${b})`).toBe(1);
        expect(track.rapid[b], `point ${b} in its own stream`).toBe(rapid);
        drawn.set(b, (drawn.get(b) ?? 0) + 1);
      }
    }
    for (let i = 1; i < track.count; i++) expect(drawn.get(i) ?? 0, `the move into point ${i}`).toBe(track.brk?.[i] ? 0 : 1);
  });

  it.each(CASES)("%s: the display levels end where every section ends and cross none", name => {
    const s = splitTrackStreams(load(name).track);
    const { feedLod, rapidLod } = buildLodLevels(s.feedPos, s.feedBreaks, s.rapidPos, s.rapidBreaks);
    for (const [pos, breaks, levels] of [[s.feedPos, s.feedBreaks, feedLod], [s.rapidPos, s.rapidBreaks, rapidLod]] as const) {
      const n = pos.length / 3, starts = [...new Set([0, ...breaks])].sort((x, y) => x - y);
      for (const level of levels) {
        const ends = new Set(level);
        starts.forEach((a, k) => {
          const b = (starts[k + 1] ?? n) - 1;
          if (b <= a) return;   // a lone vertex draws nothing
          expect(ends.has(a) && ends.has(b), `section ${a}..${b}`).toBe(true);
        });
        for (let q = 0; q < level.length; q += 2)
          expect(starts.some(x => level[q]! < x && x <= level[q + 1]!), `pair ${level[q]} → ${level[q + 1]} crosses a section`).toBe(false);
      }
    }
  });

  // a table with two rotaries, so the bake subdivides where a rotary turns
  const TABLE: PartFrameMachine = {
    groups: [{ id: "table", parent: "root" }, { id: "a", parent: "table" }, { id: "c", parent: "a" }, { id: "tool", parent: "root" }],
    kinematics: [
      { group: "table", joint: 0, type: "translate", direction: "x", sign: -1 }, { group: "table", joint: 1, type: "translate", direction: "y", sign: -1 },
      { group: "a", joint: 3, type: "rotate", direction: "x", sign: 1 }, { group: "tool", joint: 2, type: "translate", direction: "z", sign: 1 },
    ], workGroup: "c", toolGroup: "tool", unitScale: 1, axes: ["X", "Y", "Z", "A"],
  };
  it.each(CASES)("%s: the part-frame bake keeps every vertex of every section and the packed lines every move", name => {
    const { track } = load(name);
    const s = splitTrackStreams(track);
    for (const [pos, abc, breaks, src] of [[s.feedPos, s.feedAbc, s.feedBreaks, s.feedSrc], [s.rapidPos, s.rapidAbc, s.rapidBreaks, s.rapidSrc]] as const) {
      if (!pos.length) continue;
      const out = transformToPartFrame(TABLE, { g5x: [], g92: [], rotationDeg: 0, tool: [0, 0, 0] }, { pos, abc, breaks, src });
      expect(out.breaks!.length, "every section opens").toBe(breaks.length);
      expect([...new Set(out.src!)], "every path point the stream holds").toEqual([...new Set(src)]);
      const { table } = buildFrameIndex(out.pos.length / 3, out.breaks);
      let moves = 0;
      for (let q = 0; q < table.length; q += 2) {
        const a = table[q]! * 3, b = table[q + 1]! * 3;
        if ([0, 1, 2].some(k => out.pos[a + k] !== out.pos[b + k])) moves++;
      }
      expect(packPairs(out.pos, table, 0, table.length).pairs, "a packed line per move with length").toBe(moves);
    }
  });
});

const HEAD: CollisionMachine = {
  groups: [{ id: "table", parent: "root" }, { id: "gx", parent: "root" }, { id: "gy", parent: "gx" }, { id: "head", parent: "gy" }],
  kinematics: [{ group: "gx", joint: 0, type: "translate", direction: "x", sign: 1 }, { group: "gy", joint: 1, type: "translate", direction: "y", sign: 1 },
               { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 }],
  workGroup: "table", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
};
/** The same head over a table that turns about X (A). */
const HEAD_A: CollisionMachine = {
  ...HEAD, groups: [...HEAD.groups, { id: "a", parent: "table" }],
  kinematics: [...HEAD.kinematics, { group: "a", joint: 3, type: "rotate", direction: "x", sign: 1 }], workGroup: "a", axes: ["X", "Y", "Z", "A"],
};
const slab = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toNonIndexed();
  const p = new Float32Array(g.getAttribute("position").array as Float32Array);
  g.dispose();
  return p;
};

describe("the course inside a run of one kind (Codex R487 H1)", () => {
  // the decimation's tolerance and what f32 positions and summed f32 times add
  const TOL = 0.005 + 0.002;
  const inch = (name: string) => (load(name).raw.stats.unit === "in" ? 1 / 25.4 : 1);
  const pose = (t: ScrubTrack, i: number) => [...t.pos.subarray(i * 3, i * 3 + 3), ...t.abc.subarray(i * 3, i * 3 + 3)];
  const still = (t: ScrubTrack, i: number) => !!t.brk?.[i] || !!t.brk?.[i + 1];

  it.each(CASES)("%s: at every time of the un-thinned path the shipped path is at its place", name => {
    const thin = load(name).track, full = load(`${name}.full`).track, tol = TOL * inch(name);
    expect(thin.timeBased && full.timeBased).toBe(true);
    const out = {} as ScrubSample;
    for (let i = 1; i < full.count; i++) {
      if (still(full, i)) continue;   // a relabel or an unknown start: two places at one time
      sampleTrack(thin, full.cum[i]!, out);
      const at = [out.px, out.py, out.pz, out.pa, out.pb, out.pc];
      const off = Math.hypot(...pose(full, i).map((v, k) => v - at[k]!));
      expect(off, `point ${i} at ${full.cum[i]} s: ${pose(full, i)} — shipped ${at}`).toBeLessThan(tol);
    }
  });

  it.each(CASES)("%s: a feed reads its line at every time; a rapid the line of a later move of its own run", name => {
    const thin = load(name).track, full = load(`${name}.full`).track;
    const out = {} as ScrubSample;
    const shown = (t: ScrubTrack, i: number) => JSON.stringify([t.lines[i], displayLineForPoint(t, i, true)]);
    for (let i = 1; i < full.count; i++) {
      const dur = full.cum[i]! - full.cum[i - 1]!;
      if (dur < 1e-3 || full.brk?.[i]) continue;
      sampleTrack(thin, full.cum[i - 1]! + dur / 2, out);
      expect(thin.rapid[out.index], `the kind in the middle of move ${i}`).toBe(full.rapid[i]);
      if (!full.rapid[i]) { expect(shown(thin, out.index), `the line in the middle of feed ${i}`).toBe(shown(full, i)); continue; }
      const later = new Set<number>();
      for (let k = i; k < full.count && full.rapid[k]; k++) later.add(full.lines[k]!);
      expect(later.has(thin.lines[out.index]!), `the line in the middle of rapid ${i}`).toBe(true);
    }
  });

  /** The contacts of a path: each interval's [enter, exit] in seconds. */
  function contacts(track: ScrubTrack, machine: CollisionMachine, group: string, part: Float32Array): number[][] {
    const model = buildCollisionModel(machine, [{ id: "part", group, positions: part }, { id: "tool", group: "head", positions: toolCylinderPositions(2, 1), tool: true }]);
    const st = new ContactStore(1, 0);
    sweepCollisions(model, track, { g5x: [], g92: [], rotationDeg: 0, tool: [0, 0, 0] }, { margin: 0.1, contacts: { store: st } });
    return Array.from({ length: st.intervals.rows }, (_, k) => [st.intervals.get(k, "enter"), st.intervals.get(k, "exit")]);
  }
  /** The same contacts as the un-thinned path's, each at its time: places
   *  within TOL of each other at every time, met at 1.6 mm/s or faster (G1
   *  F100, the slowest of these programs), and 2 ms for the sweep's bisection. */
  function same(thin: number[][], full: number[][], what: string): void {
    expect(thin.length, `${what}: ${JSON.stringify(thin)} for ${JSON.stringify(full)}`).toBe(full.length);
    thin.forEach((c, k) => c.forEach((t, e) => expect(Math.abs(t - full[k]![e]!), `${what}: contact ${k} ${JSON.stringify([c, full[k]])}`).toBeLessThan(TOL / 1.6 + 0.002)));
  }

  it.each(CASES.filter(n => inch(n) === 1))("%s: the check finds the un-thinned path's contacts", name => {
    const part = slab(-200, 200, -200, 200, -1, 0);
    same(contacts(load(name).track, HEAD, "table", part), contacts(load(`${name}.full`).track, HEAD, "table", part), name);
  });

  it("Codex's program crosses the part four times, its controls once and three times", () => {
    const part = slab(40, 60, 20, 40, -1, 0);
    for (const [name, n] of [["pk_rev", 4], ["pk_rev_one", 1], ["pk_rev_two", 3], ["pk_rev_many", 18], ["pk_rev_feed", 12]] as const)
      expect(contacts(load(name).track, HEAD, "table", part).length, name).toBe(n);
  });

  it("a rotary to and fro crosses a part on the table each time (the 6D form)", () => {
    // the tool stands at (50, 30, 5); the part meets it where A passes 30 degrees
    const a = -20 * Math.PI / 180, y = 30.5 * Math.cos(a), z = 30.5 * Math.sin(a);
    const part = slab(45, 55, y - 1.5, y + 1.5, z - 1.5, z + 1.5);
    const thin = contacts(load("pk_rev_rotary").track, HEAD_A, "a", part);
    same(thin, contacts(load("pk_rev_rotary.full").track, HEAD_A, "a", part), "pk_rev_rotary");
    // the rapids 0 → 50 → 10 → 40 → 20 → 60: five times
    const t = load("pk_rev_rotary").track;
    let end = 0;
    for (let i = 1; i < t.count; i++) if (t.rapid[i] && (t.abc[i * 3]! || t.abc[(i - 1) * 3]!) && t.cum[i]! > end && !t.rapid.subarray(1, i).includes(0)) end = t.cum[i]!;
    expect(thin.filter(c => c[0]! < end).length).toBe(5);
  });

  it("straight and even is still thinned", () => {
    expect([load("pk_even").track.count, load("pk_even.full").track.count]).toEqual([6, 16]);
  });
});

describe("the check sees the move the program makes", () => {
  /** The touches of the cutter (Ø 2 × 1) with a machine part: the line of the move each begins on and its kind. */
  function touches(track: ScrubTrack, part: Float32Array) {
    const model = buildCollisionModel(HEAD, [{ id: "part", group: "table", positions: part }, { id: "tool", group: "head", positions: toolCylinderPositions(2, 1), tool: true }]);
    const st = new ContactStore(1, 0);
    sweepCollisions(model, track, { g5x: [], g92: [], rotationDeg: 0, tool: [0, 0, 0] }, { margin: 0.1, contacts: { store: st } });
    return Array.from({ length: st.intervals.rows }, (_, k) => {
      const enter = st.intervals.get(k, "enter"), ep = st.intervals.get(k, "episode");
      let i = 1;
      while (i < track.count - 1 && track.cum[i]! < enter) i++;
      return { line: track.lines[i]!, rapid: track.rapid[i] === 1,
               flagged: !!(st.intervals.get(k, "flags") & IV_RAPID) || !!(st.episodes.get(ep, "flags") & EP_RAPID) };
    });
  }

  it("a rapid into a part before a feed is a rapid's contact, on its own line", () => {
    // G0 X50 Y30 / G0 Z15 / G0 Z-2 (a part at Z 0 … -1 stands there) / G1 Z-5: it arrived as one feed from Z40
    const { track } = load("pk_hidden_rapid");
    const t = touches(track, slab(40, 60, 20, 40, -1, 0));
    expect(t[0], JSON.stringify(t)).toMatchObject({ rapid: true, flagged: true, line: 5 });
  });

  it("a ramp is checked from its own corner, a G83 on the line of its pecks", () => {
    // the corner (6, 6, 3) of the ramp: a part between it and the straight
    // line the payload used to drive from Z40 is clear; one under the real
    // corner's column is met by the plunge
    const ramp = load("pk_ramp_levels").track;
    expect(touches(ramp, slab(14, 16, 4, 8, 12, 14)), "beside the plunge, on the line from Z40 to the ramp's end").toEqual([]);
    expect(touches(ramp, slab(4, 8, 4, 8, 10, 12))[0], "under the plunge").toMatchObject({ rapid: true });
    // a first peck above the part: no rapid plunge through it
    const g83 = load("pk_g83_high_98").track;
    const t = touches(g83, slab(10, 15, -10, -4, -30, 0));
    expect(t[0], JSON.stringify(t.slice(0, 3))).toMatchObject({ rapid: false });
  });
});
