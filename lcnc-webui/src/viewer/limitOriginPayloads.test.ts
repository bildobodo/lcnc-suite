// The REAL worker's payloads (scripts/gen_limit_origin_payloads.py: LinuxCNC's
// native offline interpreter, X max 500) through the client's own decode and
// track, placed by viewer/limitPlaces.ts (Codex R177 VP-I130): a limit record
// names the RAW line of the file its move ran in; its row, its jump and its
// bands come from its own violating moves, its line from the program's view
// of them — never the raw number.
import * as fs from "node:fs";
import * as path from "node:path";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";
import { decodePreviewStreams } from "../previewDecode";
import type { LimitViolation, ScrubTrack } from "../ws/bulkData";
import { buildScrubTrack } from "./scrubTrack";
import { limitPlaces } from "./limitPlaces";
import { buildSimRows } from "./simRows";

const DIR = path.resolve(__dirname, "../../../scripts/test_fixtures/limit_origin_payloads");

function load(name: string) {
  const raw = msgpackDecode(fs.readFileSync(path.join(DIR, `${name}.msgpack`))) as Record<string, any>;
  const d = decodePreviewStreams(raw);
  const track = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents)!;
  return { raw, track, violations: raw.violations as LimitViolation[] };
}
const placed = (name: string) => {
  const { raw, track, violations } = load(name);
  return { track, violations, ...limitPlaces(violations, track, track, !raw.lines_untrusted) };
};
/** The point a move ends OUTSIDE the window at: the payload's flag (the gateway's own verdict). */
const outsideCums = (t: ScrubTrack) => {
  const out: number[] = [];
  for (let i = 0; i < t.count; i++) if (t.outside?.[i]) out.push(t.cum[i]!);
  return out;
};
const lineOfPoint = (t: ScrubTrack, cum: number) => {
  for (let i = 0; i < t.count; i++) if (t.cum[i] === cum) return t.lines[i];
  return null;
};

describe("a limit record stands at its own move (Codex R177 VP-I130)", () => {
  it("the track keeps every point's seq, in execution order", () => {
    const { raw, track } = load("lim_sub");
    const d = decodePreviewStreams(raw);
    const want = [...Array.from(d.feed.seq ?? []), ...Array.from(d.rapid.seq ?? [])].sort((a, b) => a - b);
    expect(Array.from(track.seq!)).toEqual(want);
    expect(want.length).toBe(track.count);
  });

  it("Codex's case: a subroutine's L5 reads its call L3 and stands at the move that left the window", () => {
    const p = placed("lim_sub");
    expect(p.targets.map(t => [t.line, t.recs.length])).toEqual([[3, 1]]);
    const [t] = p.targets;
    expect(outsideCums(p.track)).toEqual([t!.cumEnd]);          // the jump's move ends where the flag is
    expect(lineOfPoint(p.track, t!.cumEnd)).toBe(5);            // the subroutine's own number there
    expect(p.bands).toEqual([[t!.cum, t!.cumEnd]]);             // its band is that move, nothing of the main L5
  });

  it("haus.ngc's case: the main program's L5 reads L5 at its own move, not the subroutine's L5", () => {
    const p = placed("lim_main");
    expect(p.targets.map(t => t.line)).toEqual([5]);
    expect(outsideCums(p.track)).toEqual([p.targets[0]!.cumEnd]);
    expect(p.bands).toEqual([[p.targets[0]!.cum, p.targets[0]!.cumEnd]]);
  });

  it("both at one raw number: two rows, each at its own move and line", () => {
    const p = placed("lim_both");
    expect(p.targets.map(t => [t.line, t.recs[0]!.value])).toEqual([[3, 600], [5, 700]]);
    expect(p.targets.map(t => t.cumEnd)).toEqual(outsideCums(p.track));
    expect(new Set(p.targets.map(t => t.key)).size).toBe(2);
  });

  it("an unmarked subroutine: its place is known, its line is not — no raw number for it", () => {
    const p = placed("lim_unmarked");
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0]).toMatchObject({ line: 0, noLine: true });
    expect(outsideCums(p.track)).toEqual([p.targets[0]!.cumEnd]);
    const rows = buildSimRows({ clash: [], limit: p.targets, tool: [], unit: "mm", timeBased: true, axisEnd: 1000 });
    expect(rows.map(r => [r.lineLabel, r.note])).toEqual([["—", "no line of this program"]]);
  });

  it("two call sites are two rows at their calls; one site run twice is one row with a band per run", () => {
    const two = placed("lim_two_sites");
    expect(two.targets.map(t => t.line)).toEqual([3, 5]);
    expect(two.targets.map(t => t.cumEnd)).toEqual(outsideCums(two.track));
    const loop = placed("lim_loop_site");
    expect(loop.targets.map(t => t.line)).toEqual([5]);
    expect(loop.bands.map(b => b[1])).toEqual(outsideCums(loop.track));
  });

  it("an arc's stretch: the band covers every move that ends outside and starts at the first one's start", () => {
    const p = placed("lim_arc");
    expect(p.targets.map(t => t.line)).toEqual([4]);
    const out = outsideCums(p.track);
    expect(p.bands).toHaveLength(1);
    const [[a, b]] = p.bands as [[number, number]];
    expect(b).toBe(out[out.length - 1]);
    expect(a).toBe(p.targets[0]!.cum);
    expect(p.targets[0]!.cumEnd).toBe(out[0]);
    expect(out.every(c => c > a && c <= b)).toBe(true);
  });

  it("a stretch inside a collinear run starts where its first move starts (the decimation kept it)", () => {
    for (const name of ["lim_collinear", "lim_collinear_rapid"]) {
    const p = placed(name);
    const out = outsideCums(p.track);
    expect(p.bands).toEqual([[p.targets[0]!.cum, out[out.length - 1]]]);
    // X500 → X600 is the first move outside: its start is the X500 point, a move inside the window ends there
    const i = Array.from(p.track.cum).indexOf(p.targets[0]!.cum);
    expect(p.track.pos[i * 3], name).toBe(500);
    }
  });

  it("more stretches than a record carries: bands for those it carries, and the row says so (Codex R178 VP-I131)", () => {
    const p = placed("lim_loop_cap");
    expect(p.targets.map(t => [t.line, t.cuts])).toEqual([[5, [{ axis: "X", shown: 32, total: 40 }]]]);
    expect(p.bands).toHaveLength(32);
    expect(outsideCums(p.track)).toHaveLength(40);
    const rows = buildSimRows({ clash: [], limit: p.targets, tool: [], unit: "mm", timeBased: true, axisEnd: 1e6 });
    expect(rows[0]!.note).toBe("the timeline bands only the first stretches: X 32 of 40");
  });

  it("a row of two axes says each axis's numbers, never one axis's for the row (Codex R179 VP-I131)", () => {
    // 80 calls, X and Y out by turns: two records at the call, 40 stretches each, 32 sent each
    const p = placed("lim_two_axes_cap");
    expect(p.targets.map(t => [t.line, t.recs.map(r => r.axis).sort().join(""), t.cuts])).toEqual(
      [[5, "XY", [{ axis: "Y", shown: 32, total: 40 }, { axis: "X", shown: 32, total: 40 }]]]);
    expect(p.bands).toHaveLength(64);
    const rows = buildSimRows({ clash: [], limit: p.targets, tool: [], unit: "mm", timeBased: true, axisEnd: 1e6 });
    expect(rows[0]!.note).toBe("the timeline bands only the first stretches: Y 32 of 40, X 32 of 40");
  });

  it("read on a track with an entry move in front: the same moves, shifted", () => {
    const { raw, track, violations } = load("lim_sub");
    const L = 7;
    const on = { ...track, count: track.count + 1, cum: Float32Array.from([0, ...Array.from(track.cum, c => c + L)]) } as ScrubTrack;
    const base = limitPlaces(violations, track, track, !raw.lines_untrusted);
    const shown = limitPlaces(violations, track, on, !raw.lines_untrusted);
    expect(shown.targets.map(t => [t.cum, t.cumEnd])).toEqual(base.targets.map(t => [t.cum + L, t.cumEnd + L]));
  });
});
