// Shared formatters — the progress wording the banner, HUD and tooltips share.
import { describe, expect, it } from "vitest";
import { fmtProgressTimes } from "./format";

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
