// Unit tests for ws/halshowStore.ts (A1.1) — behavior pinned at extraction
// time from the lcncWs.ts monolith; any drift here is a split regression.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyHalshowSnapshot, applyHalshowUpdate, resetHalshow,
  halInitialized, halParams, halPins, halSignals,
} from "./halshowStore";

const SNAPSHOT = () => ({
  pins: [
    { comp: "mock", type: "bit", dir: "OUT", value: "TRUE", name: "mock.ok" },
    { comp: "mock", type: "s32", dir: "OUT", value: "0", name: "mock.counter" },
  ],
  signals: [
    { type: "bit", value: "FALSE", name: "hb-ok", pins: [{ arrow: "=>", pin: "mock.ok" }] },
  ],
  params: [
    { comp: "mock", type: "float", dir: "RW", value: "1.5", name: "mock.gain" },
  ],
});

beforeEach(() => {
  resetHalshow();
});

describe("halshowStore", () => {
  it("snapshot replaces state and marks initialized", () => {
    applyHalshowSnapshot(SNAPSHOT());
    expect(halPins.value.map(p => p.name)).toEqual(["mock.ok", "mock.counter"]);
    expect(halSignals.value).toHaveLength(1);
    expect(halParams.value).toHaveLength(1);
    expect(halInitialized.value).toBe(true);
  });

  it("snapshot with missing arrays falls back to empty (?? [])", () => {
    applyHalshowSnapshot({});
    expect(halPins.value).toEqual([]);
    expect(halSignals.value).toEqual([]);
    expect(halParams.value).toEqual([]);
    expect(halInitialized.value).toBe(true);
  });

  it("update applies only the delta keys across all three sections", () => {
    applyHalshowSnapshot(SNAPSHOT());
    applyHalshowUpdate({
      pins: { "mock.counter": "42" },
      signals: { "hb-ok": "TRUE" },
      params: { "mock.gain": "2.0" },
    });
    expect(halPins.value[1]!.value).toBe("42");
    expect(halPins.value[0]!.value).toBe("TRUE");      // untouched
    expect(halSignals.value[0]!.value).toBe("TRUE");
    expect(halParams.value[0]!.value).toBe("2.0");
    expect(halInitialized.value).toBe(true);
  });

  it("unknown delta key marks the snapshot stale (initialized -> false) and warns", () => {
    applyHalshowSnapshot(SNAPSHOT());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      applyHalshowUpdate({ pins: { "ghost.pin": "1", "mock.counter": "7" } });
      // Known keys still applied; the unknown one flips initialized.
      expect(halPins.value[1]!.value).toBe("7");
      expect(halInitialized.value).toBe(false);
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]![0])).toContain("1 unknown key(s)");
    } finally {
      warn.mockRestore();
    }
  });

  it("unknown keys while uninitialized stay quiet (no double warning after reset)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      applyHalshowUpdate({ pins: { "ghost.pin": "1" } });
      expect(halInitialized.value).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("reset clears everything (WS close: stale values must not shadow reality)", () => {
    applyHalshowSnapshot(SNAPSHOT());
    resetHalshow();
    expect(halPins.value).toEqual([]);
    expect(halSignals.value).toEqual([]);
    expect(halParams.value).toEqual([]);
    expect(halInitialized.value).toBe(false);
  });
});
