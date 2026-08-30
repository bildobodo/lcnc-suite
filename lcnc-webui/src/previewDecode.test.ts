import { describe, it, expect } from "vitest";
import { decodePreviewStreams } from "./previewDecode";

// Seq-keyed event resolution is what labels every vertex with its TWP frame
// and its WCS epoch. The post-g69 investigation turned on whether these two
// could disagree at a boundary where BOTH change on one instruction — they
// cannot, because they are the same rule over different event lists, and the
// real defect was elsewhere (the un-relabeled segment END, see
// gateway_util.insert_flip_relabels). That "they agree" fact was a session
// finding; these tests make it a standing assertion.
//
// Contract: an event at seq N governs vertices with seq > N (STRICT), ties on
// the same seq resolve to the LAST recorded event, and vertices before any
// event take the fill value — 0xff for frames ("no frame", never guessed) and
// 0 for epochs (epoch 0 is the parse-time basis).

function payload(seqs: number[], frameSeqs: number[], epochSeqs: number[]) {
  const seq = new Uint32Array(seqs);
  return {
    rapid: new Float32Array(seqs.length * 3).buffer,
    rapid_seq: new Uint8Array(seq.buffer),
    kins_frames: frameSeqs.map((s, i) => [s, i * 0.1, i * 1.0, i * 2.0]),
    wcs_frames: epochSeqs.map((s) => [s, 1, 0, 0, ...Array(12).fill(0)]),
  } as Record<string, any>;
}

describe("per-vertex event resolution (frames and WCS epochs)", () => {
  it("governs strictly: an event at seq N does not claim a vertex at seq N", () => {
    const d = decodePreviewStreams(payload([2, 16, 17], [], [0, 16]));
    // seq 16 is NOT governed by the event at 16 — only seq 17 is.
    expect(Array.from(d.rapid.wcs!)).toEqual([0, 0, 1]);
  });

  it("resolves frames and epochs identically at a combined flip", () => {
    // The g69 shape: kins frame and WCS epoch both change at the same seq.
    const seqs = [2, 8, 16, 17, 18];
    const d = decodePreviewStreams(payload(seqs, [2], [0, 2, 16]));
    const frames = Array.from(d.rapid.frame!);
    const epochs = Array.from(d.rapid.wcs!);
    // Both use "last event with seq < vertex seq".
    expect(frames).toEqual([0xff, 0, 0, 0, 0]);
    expect(epochs).toEqual([0, 1, 1, 2, 2]);
    // The trailing vertices land in the NEW epoch — the post-g69 restore.
    expect(epochs.slice(-2)).toEqual([2, 2]);
  });

  it("fills honestly before the first event: no frame is 0xff, not frame 0", () => {
    const d = decodePreviewStreams(payload([1, 5], [3], [0]));
    expect(Array.from(d.rapid.frame!)).toEqual([0xff, 0]);
  });

  it("breaks same-seq ties toward the last recorded event", () => {
    const d = decodePreviewStreams(payload([9], [], [0, 4, 4]));
    expect(Array.from(d.rapid.wcs!)).toEqual([2]);
  });

  it("omits the arrays entirely when the wire carries no events", () => {
    const d = decodePreviewStreams(payload([1, 2], [], []));
    expect(d.rapid.frame).toBeUndefined();
    expect(d.rapid.wcs).toBeUndefined();
  });
});

describe("TLO/tool events (schema 8)", () => {
  function tloPayload(seqs: number[], rows: number[][]) {
    const seq = new Uint32Array(seqs);
    return {
      rapid: new Float32Array(seqs.length * 3).buffer,
      rapid_seq: new Uint8Array(seq.buffer),
      tlo_events: rows,
    } as Record<string, any>;
  }

  it("governs strictly with 0xff before the first row (live), last row wins on a tie", () => {
    const d = decodePreviewStreams(tloPayload([1, 2, 3, 4], [[2, 0, 0, 22, -1], [2, 0, 0, 22, 3]]));
    expect(Array.from(d.rapid.tlo!)).toEqual([0xff, 0xff, 1, 1]);
    expect(d.tloEvents).toHaveLength(2);
    expect(d.tloEvents![1]).toEqual({ seq: 2, xyz: [0, 0, 22], tool: 3 });
    expect(d.tloEvents![0]!.tool).toBeNull();
  });

  it("omits the channel entirely when the wire carries no events", () => {
    const d = decodePreviewStreams(tloPayload([1, 2], []));
    expect(d.rapid.tlo).toBeUndefined();
    expect(d.tloEvents).toBeUndefined();
  });
});
