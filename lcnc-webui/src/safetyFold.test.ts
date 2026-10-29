import { describe, it, expect } from "vitest";
import { safetyFoldNeeded } from "./safetyFold";

// Portrait, a helper open: the machine info folds only where the strip
// column cannot hold the helper with it (operator 2026-10-29). The measured
// shapes are in safety-during-edit.spec (900 × 1200 at 100 % keeps it, at
// 150 % the keyboard and the keypad under Setup fold it).
describe("safetyFoldNeeded", () => {
  it("shown: keeps it while the content fits the column, folds once it does not", () => {
    expect(safetyFoldNeeded({ room: 1000, need: 1000, infoAdds: 180 }, 180)).toBe(false);
    expect(safetyFoldNeeded({ room: 1000, need: 1000.4, infoAdds: 180 }, 180)).toBe(false);
    expect(safetyFoldNeeded({ room: 1000, need: 1001, infoAdds: 180 }, 180)).toBe(true);
  });

  it("folded: unfolds only when the content plus the info's last measured addition fits", () => {
    expect(safetyFoldNeeded({ room: 1000, need: 820, infoAdds: null }, 180)).toBe(false);
    expect(safetyFoldNeeded({ room: 1000, need: 821, infoAdds: null }, 180)).toBe(true);
  });

  it("folded with the addition never measured: stays folded", () => {
    expect(safetyFoldNeeded({ room: 1000, need: 100, infoAdds: null }, null)).toBe(true);
  });
});
