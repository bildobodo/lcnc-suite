import { describe, it, expect } from "vitest";
import { applyClientOverlayReasons, CLIENT_REASONS, explainKeydown } from "./permissions";
import { applyClientOverlay, type MachinePermissions } from "./permissions";

// The policy itself (which machine state opens which gate) now lives on the
// backend and is tested in lcnc-gateway/test_command_policy.py. These tests
// cover only the FRONTEND's job: the client-local armed + busy overlay.

// What the backend broadcasts for a fully-ready machine (computed armed=true):
// every machine-state gate open except pause/resume (need running/paused).
const MACHINE_READY: MachinePermissions = {
  idle: true, jog: true, override: true, ready: true, run: true, machineFrame: true, goZero: true, planeFrame: true,
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

describe("run gate (program start)", () => {
  it("is a busy-subset gate that follows armed, independent of ready", () => {
    const machine = { ...MACHINE_READY, run: false };
    expect(applyClientOverlay(MACHINE_READY, true, false).run).toBe(true);
    expect(applyClientOverlay(MACHINE_READY, true, true).run).toBe(false);
    expect(applyClientOverlay(MACHINE_READY, false, false).run).toBe(false);
    // backend closed `run` (stranded Plane kins) while `ready` stays open for the MDI fix
    const p = applyClientOverlay(machine, true, false);
    expect(p.run).toBe(false);
    expect(p.ready).toBe(true);
  });
});

describe("run gate — backend without the class (mixed-version window)", () => {
  it("reads run as ready when the backend ships no run key, and stays closed when it does", () => {
    const { run: _r, ...legacy } = MACHINE_READY as any;
    expect(applyClientOverlay(legacy, true, false).run).toBe(true);
    expect(applyClientOverlay({ ...legacy, ready: false }, true, false).run).toBe(false);
    expect(applyClientOverlay({ ...MACHINE_READY, run: false }, true, false).run).toBe(false);
  });
});

describe("machineFrame / goZero gates", () => {
  it("follow armed/busy like ready and read as ready on a pre-class backend", () => {
    expect(applyClientOverlay(MACHINE_READY, true, false).machineFrame).toBe(true);
    expect(applyClientOverlay(MACHINE_READY, true, true).goZero).toBe(false);
    const { machineFrame: _m, goZero: _g, ...legacy } = MACHINE_READY as any;
    const p = applyClientOverlay(legacy, true, false);
    expect(p.machineFrame).toBe(true);
    expect(p.goZero).toBe(true);
    expect(applyClientOverlay({ ...MACHINE_READY, machineFrame: false }, true, false).machineFrame).toBe(false);
  });
});

describe("applyClientOverlayReasons (U-06, review 2026-09-14)", () => {
  const backend = { goZero: "Go to WCS 0 under TCP …", ready: "Machine not homed" };
  it("names the client-local terms and passes the backend's reason through otherwise", () => {
    const r = applyClientOverlayReasons(backend, true, false, false);
    expect(r.goZero).toBe("Go to WCS 0 under TCP …");
    expect(r.ready).toBe("Machine not homed");
    expect(r.jog).toBeUndefined();          // open on the backend, no client term
    expect(r.always).toBeUndefined();
    expect(applyClientOverlayReasons(backend, false, false, false).jog).toBe(CLIENT_REASONS.notArmed);
    expect(applyClientOverlayReasons(backend, true, true, false).ready).toBe(CLIENT_REASONS.settling);
    expect(applyClientOverlayReasons(backend, true, true, false).jog).toBeUndefined();   // jog has no busy term
    const sim = applyClientOverlayReasons(backend, true, false, true);
    expect(sim.ready).toBe(CLIENT_REASONS.sim);
    expect(sim.setup).toBeUndefined();      // stays open in sim
  });
  it("a closed gate without a shipped reason stays unexplained, never invented", () => {
    expect(applyClientOverlayReasons(null, true, false, false)).toEqual({});
    expect(applyClientOverlayReasons({}, true, false, false).goZero).toBeUndefined();
  });
});


describe("explainKeydown (R-05 access, R-06 containment)", () => {
  const ev = (key: string) => {
    const calls = { prevented: 0, stopped: 0 };
    const e = {
      key,
      preventDefault: () => { calls.prevented++; },
      stopPropagation: () => { calls.stopped++; },
    } as unknown as KeyboardEvent;
    return { e, calls };
  };

  it("explains on Enter and Space, and consumes the key", () => {
    for (const key of ["Enter", " ", "Spacebar"]) {
      const { e, calls } = ev(key);
      let said = 0;
      explainKeydown(e, () => { said++; });
      expect(said).toBe(1);
      // preventDefault alone left the key travelling to the window, where
      // Space is Cycle Start by default — asking why started the program.
      expect(calls.prevented).toBe(1);
      expect(calls.stopped).toBe(1);
    }
  });

  it("ignores every other key, so ordinary shortcuts still work", () => {
    for (const key of ["a", "Escape", "ArrowUp", "Tab"]) {
      const { e, calls } = ev(key);
      let said = 0;
      explainKeydown(e, () => { said++; });
      expect(said).toBe(0);
      expect(calls.prevented).toBe(0);
      expect(calls.stopped).toBe(0);
    }
  });
});
