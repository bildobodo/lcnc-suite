import { describe, it, expect } from "vitest";
import { lineMaskFrom } from "./viewer/lineIndex";
import { resolveCurrentLine, type RunLineState } from "./trackHighlight";

// W5: the display spec's precedence chain — this chain has produced three
// operator-visible defect waves (colliding sub linenos, dark approach,
// stale idle line), so every branch is pinned here.
describe("resolveCurrentLine (W5 display spec)", () => {
  const base = {
    running: true,
    motionLine: 0 as number | null,
    linesUntrusted: false,
    trustedLines: lineMaskFrom([4, 7, 9, 12]) as Uint8Array | null,
  };
  const rls = (p: Partial<RunLineState>): RunLineState =>
    ({ line: 0, trusted: false, subName: null, ...p });

  it("trusted positional state wins (own line / call line / end line)", () => {
    expect(resolveCurrentLine({ ...base, rls: rls({ line: 4, trusted: true }) })).toBe(4);
    expect(resolveCurrentLine({ ...base, rls: rls({ line: 9, trusted: true, viaCall: true, subName: "square" }) })).toBe(9);
    expect(resolveCurrentLine({ ...base, rls: rls({ line: 12, trusted: true, atEnd: true }) })).toBe(12);
    // Trusted state beats any motion_line value.
    expect(resolveCurrentLine({ ...base, motionLine: 7, rls: rls({ line: 4, trusted: true }) })).toBe(4);
  });

  it("off-path rescue: motion_line displays iff text-trusted", () => {
    const off = rls({ offPath: true });
    // The approach: interp executes main line 4, machine not yet on the track.
    expect(resolveCurrentLine({ ...base, motionLine: 4, rls: off })).toBe(4);
    // Toolchange park reporting an untrusted line (M6 line, sub lineno): dark.
    expect(resolveCurrentLine({ ...base, motionLine: 3, rls: off })).toBe(null);
    expect(resolveCurrentLine({ ...base, motionLine: 0, rls: off })).toBe(null);
    // Legacy track (no per-point trust): no set to vouch — no rescue.
    expect(resolveCurrentLine({ ...base, motionLine: 4, trustedLines: null, rls: off })).toBe(null);
    // Rescue never fires when not running (defensive — rls is normally gone).
    expect(resolveCurrentLine({ ...base, running: false, motionLine: 4, rls: off })).toBe(null);
  });

  it("on-path untrusted span suppresses (chip/indent carries it)", () => {
    const span = rls({ subName: "square", subLine: 5 });
    expect(resolveCurrentLine({ ...base, motionLine: 4, rls: span })).toBe(null);
    // atEnd with no unique end line publishes untrusted → dark, not a guess.
    expect(resolveCurrentLine({ ...base, motionLine: 4, rls: rls({ atEnd: true }) })).toBe(null);
  });

  it("no positional playhead while running: per-line gate, wholesale for legacy", () => {
    // Track with per-point trust: set membership decides.
    expect(resolveCurrentLine({ ...base, rls: null, motionLine: 7 })).toBe(7);
    expect(resolveCurrentLine({ ...base, rls: null, motionLine: 8 })).toBe(null);
    // Legacy track: wholesale flag decides (pre-W2 behavior preserved).
    expect(resolveCurrentLine({ ...base, rls: null, motionLine: 8, trustedLines: null })).toBe(8);
    expect(resolveCurrentLine({ ...base, rls: null, motionLine: 8, trustedLines: null, linesUntrusted: true })).toBe(null);
  });

  it("not running: NEVER displays — stale motion-queue ids stay dark", () => {
    // The screenshot bug: post-run motion_line froze at square.ngc's line 8,
    // which is a blank line of the main file.
    expect(resolveCurrentLine({ ...base, running: false, rls: null, motionLine: 8, trustedLines: null })).toBe(null);
    // Even a value that collides with a trusted main line stays dark at idle.
    expect(resolveCurrentLine({ ...base, running: false, rls: null, motionLine: 4 })).toBe(null);
  });

  it("paused keeps the highlight (running covers any non-idle interp state)", () => {
    // The caller passes running = interp_state !== IDLE, so a paused program
    // resolves exactly like a running one.
    expect(resolveCurrentLine({ ...base, rls: rls({ line: 9, trusted: true }) })).toBe(9);
  });
});
