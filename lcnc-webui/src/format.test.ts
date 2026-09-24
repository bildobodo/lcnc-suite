// Shared formatters — the progress wording the banner, HUD and tooltips
// share, and the ONE placeholder and unit spacing of the design wave (D0).
import { describe, expect, it } from "vitest";
import {
  fmtProgressTimes, NO_VALUE, fmtPct, fmtMs, fmtQty, fmtUnit,
  fmtCoord, fmtNum, fmtCell, fmtOffset, fmtRpm, fmtAxisValue,
} from "./format";
import { g5xLabel } from "./wcs";
import { toolTypeLabel } from "./toolTypes";

describe("fmtProgressTimes", () => {
  it("reads elapsed of the expected duration, whole seconds, expectation never below 1 s", () => {
    expect(fmtProgressTimes(3400, 12000)).toBe("00:03 of ~00:12");
    expect(fmtProgressTimes(0, 400)).toBe("00:00 of ~00:01");
    expect(fmtProgressTimes(3_725_000, 7_200_000)).toBe("1:02:05 of ~2:00:00");
  });
  it("reads elapsed alone when nothing was expected, and never negative", () => {
    expect(fmtProgressTimes(9500, null)).toBe("00:09 elapsed");
    expect(fmtProgressTimes(9500, undefined)).toBe("00:09 elapsed");
    expect(fmtProgressTimes(-50, 0)).toBe("00:00 elapsed");
  });
});

describe("NO_VALUE — one display placeholder (UI-N05)", () => {
  it("is the em dash, and every display formatter uses it for a missing value", () => {
    expect(NO_VALUE).toBe("\u2014");
    for (const out of [fmtCoord(null), fmtNum(undefined), fmtCell(null), fmtCell(""),
      fmtOffset(NaN), fmtRpm(null), fmtPct(null), fmtMs(undefined), fmtQty(null, "mm"),
      g5xLabel(null), toolTypeLabel("")]) {
      expect(out).toBe(NO_VALUE);
    }
  });
  it("never reaches an editable value", () => {
    expect(fmtAxisValue(null, "X")).toBe("");
  });
});

describe("units are set off by a space (UI-N02–N04)", () => {
  it("fmtPct reads a RATIO", () => {
    expect(fmtPct(1.2)).toBe("120 %");
    expect(fmtPct(0.155, 1)).toBe("15.5 %");
    expect(fmtPct(0)).toBe("0 %");
  });
  it("fmtMs, fmtQty and fmtUnit", () => {
    expect(fmtMs(12)).toBe("12 ms");
    expect(fmtQty(12, "mm")).toBe("12.0000 mm");
    expect(fmtQty(0.5, "in", 3)).toBe("0.500 in");
    expect(fmtQty(null, "mm")).toBe(NO_VALUE);
    expect(fmtUnit(7, "ms")).toBe("7 ms");
    expect(fmtUnit(7, "")).toBe("7");
  });
});
