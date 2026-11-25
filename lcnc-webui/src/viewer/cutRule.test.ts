// The cutting state's step function (viewer/cutRule.ts; stock-mute plan v3
// §B, Codex R488 / R490): total over every state and sample class, and the
// own-hole question asked ONLY from NONE — proven with a counting stub that
// would answer yes, apart from any geometry (an open body's free side or a
// refused basis would hide a mutant there, R490).
import { describe, expect, it } from "vitest";
import {
  BEGIN_MACHINING, BEGIN_NONE, BEGIN_RAPID, CUT_MACHINING, CUT_NONE, CUT_RAPID, CUT_SEP, CUT_UNRESOLVED,
  SAMPLE_APART, SAMPLE_NOTHING, SAMPLE_TOUCH, SAMPLE_UNRESOLVED, cutBreak, cutSample, cutStep, type CutSample, type CutState,
} from "./cutRule";

const STATES: CutState[] = [CUT_NONE, CUT_UNRESOLVED, CUT_MACHINING, CUT_RAPID];
const SAMPLES: CutSample[] = [SAMPLE_NOTHING, SAMPLE_TOUCH, SAMPLE_APART, SAMPLE_UNRESOLVED];
const NAME = ["N", "U", "M", "R"];

/** Every step with a hole that WOULD excuse: what it asks and what it gives. */
function step(state: CutState, sample: CutSample, onFeed: boolean) {
  let feedAsked = 0, holeAsked = 0;
  const r = cutStep(state, sample, () => { feedAsked++; return onFeed; }, () => { holeAsked++; return true; });
  return { ...r, feedAsked, holeAsked };
}

describe("the cutting state's step (plan v3 §B)", () => {
  it("is the table, for every state, sample and entry", () => {
    const got: string[] = [];
    for (const st of STATES) for (const sm of SAMPLES) for (const onFeed of [true, false]) {
      const r = step(st, sm, onFeed);
      got.push(`${NAME[st]} ${["nothing", "touch", "apart", "unresolved"][sm]} ${onFeed ? "feed" : "rapid"} → ${NAME[r.state]}${["", " begins machining", " begins rapid"][r.begins]}${r.holeAsked ? " (hole asked)" : ""}`);
    }
    expect(got).toEqual([
      "N nothing feed → N", "N nothing rapid → N",
      "N touch feed → M begins machining", "N touch rapid → M begins machining (hole asked)",
      "N apart feed → N", "N apart rapid → N",
      "N unresolved feed → U", "N unresolved rapid → U",
      "U nothing feed → U", "U nothing rapid → U",
      "U touch feed → M begins machining", "U touch rapid → R begins rapid",
      "U apart feed → N", "U apart rapid → N",
      "U unresolved feed → U", "U unresolved rapid → U",
      "M nothing feed → M", "M nothing rapid → M",
      "M touch feed → M", "M touch rapid → M",
      "M apart feed → N", "M apart rapid → N",
      "M unresolved feed → U", "M unresolved rapid → U",
      "R nothing feed → R", "R nothing rapid → R",
      "R touch feed → R", "R touch rapid → R",
      "R apart feed → N", "R apart rapid → N",
      "R unresolved feed → U", "R unresolved rapid → U",
    ]);
  });

  it("asks the own hole from NONE only, and only for a touch whose entry lies on a rapid", () => {
    for (const st of STATES) for (const sm of SAMPLES) for (const onFeed of [true, false]) {
      const r = step(st, sm, onFeed);
      expect(r.holeAsked, `${NAME[st]} ${sm} ${onFeed}`).toBe(st === CUT_NONE && sm === SAMPLE_TOUCH && !onFeed ? 1 : 0);
    }
    // from UNRESOLVED a hole that would excuse is never asked: the rapid's touch is a finding
    expect(step(CUT_UNRESOLVED, SAMPLE_TOUCH, false)).toMatchObject({ state: CUT_RAPID, begins: BEGIN_RAPID, holeAsked: 0 });
    // and from NONE a hole that refuses gives the finding too
    expect(cutStep(CUT_NONE, SAMPLE_TOUCH, () => false, () => false)).toEqual({ state: CUT_RAPID, begins: BEGIN_RAPID });
  });

  it("a discontinuity ends machining and keeps an unknown inside", () => {
    expect(STATES.map(cutBreak)).toEqual([CUT_NONE, CUT_UNRESOLVED, CUT_NONE, CUT_RAPID]);
  });

  it("a sample's class: a touch, nothing, apart or unresolved", () => {
    let asked = 0;
    const ex = (v: boolean) => () => { asked++; return v; };
    expect(cutSample(0, 1e-4, false, false, ex(true))).toBe(SAMPLE_TOUCH);
    expect(cutSample(1e-4, 1e-4, false, false, ex(true))).toBe(SAMPLE_TOUCH);
    expect(cutSample(5e-4, 1e-4, false, false, ex(true))).toBe(SAMPLE_NOTHING);   // between the touch and the separation
    expect(cutSample(CUT_SEP, 1e-4, false, false, ex(true))).toBe(SAMPLE_NOTHING);
    expect(asked).toBe(0);
    expect(cutSample(0.5, 1e-4, false, false, ex(true))).toBe(SAMPLE_APART);
    expect(cutSample(0.5, 1e-4, false, false, ex(false))).toBe(SAMPLE_UNRESOLVED);
    expect(cutSample(0.5, 1e-4, true, false, ex(true))).toBe(SAMPLE_NOTHING);     // undecidable
    expect(cutSample(0, 1e-4, false, true, ex(true))).toBe(SAMPLE_NOTHING);       // a braking range proves nothing
    expect(asked).toBe(2);
    expect([BEGIN_NONE, BEGIN_MACHINING, BEGIN_RAPID]).toEqual([0, 1, 2]);
  });
});
