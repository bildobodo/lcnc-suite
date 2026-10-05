import { describe, expect, it } from "vitest";
import { onFlashStart } from "./flashClock";

type Fake = { animationName?: string; startTime: number | null };
const el = (anims: Fake[]) => ({ getAnimations: () => anims as unknown as Animation[] });

describe("flashClock", () => {
  it("puts a started flash on the document timeline's phase (startTime 0)", () => {
    const flash: Fake = { animationName: "flash-estop-1a2b3c", startTime: 1925 };
    onFlashStart({ animationName: "flash-estop-1a2b3c", target: el([flash]) as unknown as EventTarget });
    expect(flash.startTime).toBe(0);
  });

  it("leaves everything else on the element alone: a transition, a pulse, another animation", () => {
    const flash: Fake = { animationName: "flash-danger-9f", startTime: 1610 };
    const transition: Fake = { startTime: 1600 };
    const pulse: Fake = { animationName: "banner-pulse-9f", startTime: 1200 };
    const fade: Fake = { animationName: "banner-fade-enter", startTime: 1590 };
    onFlashStart({ animationName: "flash-danger-9f", target: el([transition, pulse, fade, flash]) as unknown as EventTarget });
    expect([transition, pulse, fade, flash].map(a => a.startTime)).toEqual([1600, 1200, 1590, 0]);
  });

  it("ignores a start that is no flash, and a target without animations", () => {
    const pulse: Fake = { animationName: "pulse-warn-77", startTime: 500 };
    onFlashStart({ animationName: "pulse-warn-77", target: el([pulse]) as unknown as EventTarget });
    expect(pulse.startTime).toBe(500);
    expect(() => onFlashStart({ animationName: "flash-estop", target: null })).not.toThrow();
  });
});
