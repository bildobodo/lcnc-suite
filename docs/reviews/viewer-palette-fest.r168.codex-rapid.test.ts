import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, IV_RAPID, NONE } from "./contactStore";
import { buildContactView, targetAt, targetKind, T_RAPID } from "./contactView";
function table(g: number, rapid: boolean, end: number) {
  const st = new ContactStore(1, g);
  const ep = st.episodes.append({ pair: 0, ordinal: 0, flags: 0, onset: 1, end, closeAt: 1, closeDist: 0, firstIv: 0, ivCount: 1 });
  st.intervals.append({ episode: ep, enter: 1, exit: end, flags: IV_ENTER_DECIDED | (Number.isNaN(end) ? 0 : IV_EXIT_DECIDED) | (rapid ? IV_RAPID : 0), next: NONE, witness: 1.5, freeAt: NaN, freeR: 0 });
  return st;
}
const names = () => ({ a: "head", b: "stock" });
describe("R168: a fallback's continued contact acquires a rapid touch", () => {
  it("keeps the earlier key and the newly observed rapid flag", () => {
    // The held generation reached 3 while this feed-begun contact was open.
    // The new generation reached 10: it saw a rapid while the same contact
    // continued and then a decided exit at 8. No new onset or separator.
    const held = table(0, false, NaN), current = table(1, true, 8);
    const union = buildContactView({ sources: [{ stores: [current], held: [held], heldCoverage: [3], ownCoverage: 10, at: c => c }], pairName: names, coverage: 10 });
    const alone = buildContactView({ sources: [{ stores: [current], ownCoverage: 10, at: c => c }], pairName: names, coverage: 10 });
    const result = { heldFlags: held.intervals.get(0, "flags"), currentFlags: current.intervals.get(0, "flags"),
      union: targetAt(union, 0, () => 2), alone: targetAt(alone, 0, () => 2) };
    writeFileSync(process.env.R168_OUT! + "/rapid-union.json", JSON.stringify(result, null, 2) + "\n");
    expect(union.n).toBe(1);
    expect(result.union.key).toBe("C0|0|0");
    expect(targetKind(alone, 0) & T_RAPID).toBe(T_RAPID);
    expect(targetKind(union, 0) & T_RAPID, "same contact, rapid seen by the new generation").toBe(T_RAPID);
  });
});
