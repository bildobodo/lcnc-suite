// Copy to archive/lcnc-webui/src/viewer/r57.consumer-probe.test.ts.
// Check the F6 event removal against existing decoder and pose functions.
import { it, expect, afterAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { decodePreviewStreams } from "../previewDecode";
import { buildScrubTrack } from "./scrubTrack";
import { tloForIndex, toolForIndex } from "./tloEvents";
import { liftToJoints, wcsTerms } from "./partFrame";

const evidence = JSON.parse(readFileSync("../evidence/viewer-palette-fest.r57.probe.json", "utf8"));
const output: any[] = [];
function resolve(c: any, pruned: boolean) {
  const payload = Object.fromEntries(Object.entries(c.payload).map(([k, v]: [string, any]) =>
    [k, v && v.bytes_b64 != null ? Uint8Array.from(Buffer.from(v.bytes_b64, "base64")) : structuredClone(v)]));
  if (pruned) {
    if (c.kept_rows.length) payload.tlo_events = c.kept_rows;
    else delete payload.tlo_events;
  }
  const d = decodePreviewStreams(payload);
  const t = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents)!;
  const seed = c.run.seed ?? [0, 0, 0];
  const terms = wcsTerms({ g5x: [], g92: [], rotationDeg: 0 });
  return Array.from({ length: t.count }, (_, i) => {
    const p = Array.from(t.pos.slice(3*i, 3*i+3)) as [number, number, number];
    const abc = Array.from(t.abc.slice(3*i, 3*i+3)) as [number, number, number];
    const offset = tloForIndex(t.tlo?.[i], t.tloEvents, seed);
    const joints: number[] = [];
    liftToJoints(...p, ...abc, terms, offset, joints);
    return { p, abc, offset, tool: toolForIndex(t.tlo?.[i], t.tloEvents, 1), joints };
  });
}
for (const c of evidence.cases) {
  it(`${c.case}: F6 preserves resolved offsets, tool identity and axis positions`, () => {
    const original = resolve(c, false);
    const pruned = resolve(c, true);
    expect(pruned).toEqual(original);
    if (c.case === "codex_r56" || c.case === "percent_g431")
      expect(pruned[0]!.joints[2]).toBe(10);
    output.push({ case: c.case, original_events: c.payload.tlo_events ?? [],
      retained_events: c.kept_rows, resolved: pruned, equal: true });
  });
}
afterAll(() => writeFileSync("../evidence/viewer-palette-fest.r57.consumer-probe.json", JSON.stringify({
  commit: evidence.commit, method: "Actual preview decode, scrub merge, TLO/tool resolver and joint conversion. " +
    "Proposed immutable tlo_start supplied as fallback; no live status or product changes.", cases: output,
}, null, 2)+"\n"));
