import { describe, expect, it } from "vitest";
import { HINT_MS, hintDuration } from "./btnHint";

describe("control hint duration (design wave D1, UI-D08)", () => {
  it("short hints keep the classic 1.5 s, longer ones grow with their length, capped at 4 s", () => {
    expect(hintDuration("Hold to activate")).toBe(HINT_MS);
    expect(hintDuration("x".repeat(50))).toBe(3000);
    expect(hintDuration("x".repeat(500))).toBe(4000);
  });
});
