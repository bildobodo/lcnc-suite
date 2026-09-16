import { describe, it, expect } from "vitest";
import { decodePreviewStreams, parseRotaryCmd } from "./previewDecode";
import { EVENT_NONE } from "./viewer/eventIndex";
import { TLO_NONE } from "./viewer/tloEvents";

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
// event take the fill value — EVENT_NONE for frames ("no frame", never guessed) and
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
    expect(frames).toEqual([EVENT_NONE, 0, 0, 0, 0]);
    expect(epochs).toEqual([0, 1, 1, 2, 2]);
    // The trailing vertices land in the NEW epoch — the post-g69 restore.
    expect(epochs.slice(-2)).toEqual([2, 2]);
  });

  it("fills honestly before the first event: no frame is EVENT_NONE, not frame 0", () => {
    const d = decodePreviewStreams(payload([1, 5], [3], [0]));
    expect(Array.from(d.rapid.frame!)).toEqual([EVENT_NONE, 0]);
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

describe("event indices are 32-bit (TWP-05, review 2026-09-14)", () => {
  it("257 distinct events resolve to index 256 on every channel (the u8 cap was 254)", () => {
    const events = Array.from({ length: 257 }, (_, i) => i);
    const d = decodePreviewStreams({
      rapid: new Float32Array(3).buffer,
      rapid_seq: new Uint8Array(new Uint32Array([999]).buffer),
      kins_frames: events.map(i => [i, 0, i, 0]),
      wcs_frames: events.map(i => [i, 1, 0, 0, ...Array(12).fill(0)]),
      tlo_events: events.map(i => [i, 0, 0, i, 1]),
    });
    expect(d.rapid.frame).toBeInstanceOf(Uint32Array);
    expect(d.rapid.frame![0]).toBe(256);
    expect(d.rapid.wcs![0]).toBe(256);
    expect(d.rapid.tlo![0]).toBe(256);
  });

  it("preserves the exact event at every vertex across 1000+ events", () => {
    const E = 1200;
    const seqs = Array.from({ length: 3 * E }, (_, v) => v);          // vertex v at seq v
    const eventSeqs = Array.from({ length: E }, (_, i) => 3 * i + 1);  // event i at seq 3i+1
    const d = decodePreviewStreams(payload(seqs, eventSeqs, eventSeqs));
    for (let v = 0; v < seqs.length; v++) {
      // event i governs seq v iff 3i+1 < v — the last such i, or none.
      const last = v < 2 ? null : Math.floor((v - 2) / 3);
      expect(d.rapid.frame![v], `frame at seq ${v}`).toBe(last == null ? EVENT_NONE : last);
      expect(d.rapid.wcs![v], `epoch at seq ${v}`).toBe(last == null ? 0 : last);
    }
  });

  it("a vertex out of seq order resolves on its own without disturbing the rest", () => {
    const d = decodePreviewStreams(payload([2, 16, 17, 5, 18], [], [0, 16]));
    expect(Array.from(d.rapid.wcs!)).toEqual([0, 0, 1, 0, 1]);
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

  it("governs strictly with TLO_NONE before the first row (live), last row wins on a tie", () => {
    const d = decodePreviewStreams(tloPayload([1, 2, 3, 4], [[2, 0, 0, 22, -1], [2, 0, 0, 22, 3]]));
    expect(Array.from(d.rapid.tlo!)).toEqual([TLO_NONE, TLO_NONE, 1, 1]);
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

describe("rotary_cmd (2026-09-11)", () => {
  it("parses the wire key and rejects malformed shapes", () => {
    expect(parseRotaryCmd({ A: 12, B: null, unknown: null, seed: { A: 0, B: 35.5 } }))
      .toEqual({ A: 12, B: null, unknown: null, seed: { A: 0, B: 35.5 } });
    expect(parseRotaryCmd({ unknown: 7, seed: {} })).toEqual({ unknown: 7, seed: {} });
    expect(parseRotaryCmd(undefined)).toBeUndefined();
    expect(parseRotaryCmd(null)).toBeUndefined();
    expect(parseRotaryCmd({ A: 1 })).toBeUndefined();               // no unknown key
    expect(parseRotaryCmd({ A: -1, unknown: null })).toBeUndefined();
    expect(parseRotaryCmd({ A: "3", unknown: null })).toBeUndefined();
  });
  it("rides the decoded preview", () => {
    const g = { feed: [[0, 0, 0], [1, 0, 0]], feed_seq: [1, 2], rapid: [], rotary_cmd: { A: null, unknown: null, seed: { A: 0 } } };
    expect(decodePreviewStreams(g).rotaryCmd).toEqual({ A: null, unknown: null, seed: { A: 0 } });
    expect(decodePreviewStreams({ feed: [[0, 0, 0]], rapid: [] }).rotaryCmd).toBeUndefined();
  });
});
