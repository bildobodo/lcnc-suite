// One hold attempt on a smooth page, judged by what the PAGE saw (hold after
// a stall, Codex R401): the press's delivered length, what was sent, and the
// hints shown after THIS press's delivery (the recorders in hold-stall*.spec
// take no hint before their own press and none still on screen from an older
// gesture — an old "Page delayed" excused a silent whole press, Codex R401).
import { expect } from "./test";
import { HOLD_FIRE_MS } from "../src/machineControls";

export const STALL_HINT = "Page delayed — hold again";

export type HoldAttempt = { delivered: number | null; fired: number; hints: string[] };

/** "done": it fired once, from a press the page saw whole. "again": the page
 *  saw it short (nothing sent), or whole and stalled — and it said so. Fails:
 *  a fire from a press the page saw short, more than one fire, a whole press
 *  that sent nothing without a stall hint of its own. `log` names the
 *  attempts so far in the failure. */
export function judgeHold(a: HoldAttempt, log: unknown): "done" | "again" {
  const whole = a.delivered !== null && a.delivered >= HOLD_FIRE_MS;
  if (a.fired > 0) {
    expect(whole, `a fire from a press the page saw whole: ${JSON.stringify(log)}`).toBe(true);
    expect(a.fired, `exactly one: ${JSON.stringify(log)}`).toBe(1);
    return "done";
  }
  if (whole) expect(a.hints, `a whole hold that sent nothing says why: ${JSON.stringify(log)}`).toContain(STALL_HINT);
  return "again";
}
