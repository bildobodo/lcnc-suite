import { describe, it, expect } from "vitest";
import { applyClientOverlay, type MachinePermissions } from "./permissions";

// The policy itself (which machine state opens which gate) now lives on the
// backend and is tested in lcnc-gateway/test_command_policy.py. These tests
// cover only the FRONTEND's job: the client-local armed + busy overlay.

// What the backend broadcasts for a fully-ready machine (computed armed=true):
// every machine-state gate open except pause/resume (need running/paused).
const MACHINE_READY: MachinePermissions = {
  idle: true, jog: true, override: true, ready: true,
  pause: false, resume: false, step: true, abort: true,
  probe: true, zero: true, touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true,
  armed: true, always: true,
};

describe("applyClientOverlay", () => {
  it("armed + not busy passes the backend gates through", () => {
    const p = applyClientOverlay(MACHINE_READY, true, false);
    expect(p.ready).toBe(true);
    expect(p.probe).toBe(true);
    expect(p.jog).toBe(true);
    expect(p.zero).toBe(true);
    expect(p.always).toBe(true);
  });

  it("disarmed closes everything except always", () => {
    const p = applyClientOverlay(MACHINE_READY, false, false);
    expect(p.ready).toBe(false);
    expect(p.safety).toBe(false);
    expect(p.armed).toBe(false);
    expect(p.abort).toBe(false);
    expect(p.always).toBe(true);
  });

  it("busy closes the busy-subset but not jog/abort", () => {
    const p = applyClientOverlay(MACHINE_READY, true, true);
    // busy-subset gates close
    expect(p.idle).toBe(false);
    expect(p.override).toBe(false);
    expect(p.ready).toBe(false);
    expect(p.probe).toBe(false);
    expect(p.zero).toBe(false);
    expect(p.setup).toBe(false);
    // gates without a busy term stay open
    expect(p.jog).toBe(true);
    expect(p.abort).toBe(true);
  });

  it("absent backend permissions yield all-false except always (safe default)", () => {
    const p = applyClientOverlay(null, true, false);
    expect(p.ready).toBe(false);
    expect(p.jog).toBe(false);
    expect(p.safety).toBe(false);
    expect(p.always).toBe(true);
  });

  it("a backend-closed gate stays closed even when armed and idle", () => {
    const p = applyClientOverlay({ ...MACHINE_READY, ready: false }, true, false);
    expect(p.ready).toBe(false);
    expect(p.jog).toBe(true);
  });
});

describe("simulation-mode overlay (client-local, simMode.ts)", () => {
  it("closes every machine-action gate while sim is active", () => {
    const p = applyClientOverlay(MACHINE_READY, true, false, true);
    // The display is intentionally wrong in sim — acting on it is the hazard.
    expect(p.jog).toBe(false);
    expect(p.ready).toBe(false);
    expect(p.probe).toBe(false);
    expect(p.zero).toBe(false);
    expect(p.idle).toBe(false);
    expect(p.override).toBe(false);
    expect(p.step).toBe(false);
    expect(p.abort).toBe(false);
    // Machine On needs a purposeful sim exit first.
    expect(p.safety).toBe(false);
  });

  it("keeps always, armed, and setup open in sim", () => {
    const p = applyClientOverlay(MACHINE_READY, true, false, true);
    expect(p.always).toBe(true);   // Arm / E-Stop
    expect(p.armed).toBe(true);    // navigation
    expect(p.setup).toBe(true);    // file browsing (loading a file exits sim)
  });

  it("sim=false (default) changes nothing", () => {
    const a = applyClientOverlay(MACHINE_READY, true, false);
    const b = applyClientOverlay(MACHINE_READY, true, false, false);
    expect(b).toEqual(a);
  });

  it("surfaceComp passes through from the backend and carries the busy term", () => {
    // The rotary requirement itself is backend policy (tested in
    // test_command_policy.py); the frontend must neither re-derive it nor
    // drop it. A tilted machine broadcasts surfaceComp:false while `ready`
    // stays open, so turning compensation OFF remains possible.
    const tilted = applyClientOverlay({ ...MACHINE_READY, surfaceComp: false }, true, false);
    expect(tilted.surfaceComp).toBe(false);
    expect(tilted.ready).toBe(true);
    expect(applyClientOverlay(MACHINE_READY, true, true).surfaceComp).toBe(false);  // busy
    expect(applyClientOverlay(MACHINE_READY, false, false).surfaceComp).toBe(false); // disarmed
    expect(applyClientOverlay(MACHINE_READY, true, false, true).surfaceComp).toBe(false); // sim
  });
});
