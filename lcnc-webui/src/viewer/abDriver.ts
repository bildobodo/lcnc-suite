// The viewer side of the A/B measurement (Codex R39 VP39-03; temporary —
// removed with the previous GL line after the acceptance): the AbDriver
// viewer/abRun.ts schedules. ThreeViewer hands in getters, never cached
// scene pointers; every phase renders EVERY frame through ThreeViewer's own
// loop (the frame hook runs at the top of animate()), so the render-on-demand
// gate cannot hide a frame the renderer should have drawn.
//
// The camera path is FIXED by the drawn path's box, not by where the
// operator left the view: an orbit at 30° elevation, one turn per 20 s, at
// the distance that fits the box; detail = the same direction at 1/12 of it.
// Finding jumps press the scrub bar's own buttons — the simulation is
// entered only the way the operator enters it (machine off), never forced.
import * as THREE from "three";
import type { AbConditions, AbDriver, AbVariant } from "./abRun";
import type { PathMemory, ToolpathController, ToolpathCtx } from "./toolpathController";
import { abCancelled } from "./abRunBus";
import { modalOpen } from "../modalRegistry";
import { setViewerPerfTap } from "../viewerPerf";
import { emitTelemetry } from "../lcncWs";

export interface AbDriverDeps {
  camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
  controls(): { target: THREE.Vector3; update(): void } | null;
  toolpath: ToolpathController;
  toolpathCtx(): ToolpathCtx;
  requestRender(): void;
  /** Install (or clear) the per-frame hook ThreeViewer's animate() calls. */
  setFrameHook(fn: ((now: number) => void) | null): void;
  /** The viewer's root element (the scrub bar lives inside). */
  root(): HTMLElement | null;
  /** The rapids layer, read and set LOCALLY (never saved). */
  rapidsLayer(on?: boolean): boolean;
  simActive(): boolean;
  sweepBusy(): boolean;
  interpIdle(): boolean;
  renderInfo(): Record<string, number>;
  meta(): Record<string, unknown>;
  /** Register the camera-touched-by-hand notifier (OrbitControls "start"). */
  onInteract(fn: (() => void) | null): void;
}

const ORBIT_PERIOD_MS = 20_000;
const ELEVATION = THREE.MathUtils.degToRad(30);
const DETAIL_FACTOR = 12;
/** A frame hook that never fires (a hidden tab, a paused viewer) must not
 *  hang the run: every wait also ends on this timer, flagged `hidden`. */
const FRAME_GRACE_MS = 5000;

export function createAbDriver(deps: AbDriverDeps): AbDriver & { dispose(): void } {
  const flags: AbConditions = { hidden: false, dialog: false, interacted: false, sweepBusy: false };
  let saved: { pos: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; zoom: number } | null = null;
  let simBefore: boolean | null = null;
  let rapidsBefore: boolean | null = null;
  const onVisibility = () => { if (document.hidden) flags.hidden = true; };
  document.addEventListener("visibilitychange", onVisibility);
  deps.onInteract(() => { flags.interacted = true; });

  function note() {
    if (document.hidden) flags.hidden = true;
    if (modalOpen.value) flags.dialog = true;
    if (deps.sweepBusy()) flags.sweepBusy = true;
  }

  /** Render every frame for `ms`, calling `each(elapsed)` first. */
  function frames(ms: number, each?: (elapsed: number) => void): Promise<void> {
    return new Promise(resolve => {
      const t0 = performance.now();
      let done = false;
      const finish = () => { if (done) return; done = true; deps.setFrameHook(null); clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { flags.hidden = true; finish(); }, ms + FRAME_GRACE_MS);
      deps.setFrameHook(now => {
        note();
        const el = now - t0;
        if (el >= ms || abCancelled()) { finish(); return; }
        each?.(el);
        deps.requestRender();
      });
      deps.requestRender();
    });
  }

  /** The fixed camera frame: the drawn path's box, the distance that fits it. */
  function frame() {
    const cam = deps.camera();
    const box = deps.toolpath.pathWorldBox();
    if (!cam || !box) return null;
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(1e-3, box.getSize(new THREE.Vector3()).length() / 2);
    const persp = (cam as THREE.PerspectiveCamera).isPerspectiveCamera;
    const dist = persp ? 1.1 * r / Math.sin(THREE.MathUtils.degToRad((cam as THREE.PerspectiveCamera).fov) / 2) : 4 * r;
    return { cam, center, r, dist, persp };
  }

  /** Place the camera at azimuth `az` (radians) and `scale` × the fit distance. */
  function place(f: NonNullable<ReturnType<typeof frame>>, az: number, scale: number) {
    const d = f.dist * scale;
    const dir = new THREE.Vector3(Math.cos(ELEVATION) * Math.cos(az), Math.cos(ELEVATION) * Math.sin(az), Math.sin(ELEVATION));
    f.cam.up.set(0, 0, 1);
    f.cam.position.copy(f.center).addScaledVector(dir, d);
    if (!f.persp) {
      const oc = f.cam as THREE.OrthographicCamera;
      oc.zoom = Math.abs(oc.top - oc.bottom) / 2 / (1.2 * f.r * scale);
      oc.updateProjectionMatrix();
    }
    f.cam.lookAt(f.center);
    const c = deps.controls();
    if (c) { c.target.copy(f.center); c.update(); }
  }

  function saveView() {
    const cam = deps.camera(), c = deps.controls();
    if (!cam || !c || saved) return;
    saved = { pos: cam.position.clone(), target: c.target.clone(), up: cam.up.clone(),
      zoom: (cam as THREE.OrthographicCamera).zoom ?? 1 };
  }

  async function orbitFor(ms: number) {
    const f = frame();
    if (!f) { await frames(ms); return; }
    saveView();
    await frames(ms, el => place(f, (2 * Math.PI * el) / ORBIT_PERIOD_MS, 1));
  }

  function scrubButtons(): { usable: HTMLButtonElement[]; reason: string | null } {
    const bar = deps.root()?.querySelector(".scrubBar");
    if (!bar) return { usable: [], reason: "No timeline for this program" };
    const all = ["Next limit violation", "Next collision"]
      .map(l => bar.querySelector<HTMLButtonElement>(`[aria-label="${l}"]`))
      .filter((b): b is HTMLButtonElement => !!b);
    if (!all.length) return { usable: [], reason: "No findings to jump to in this program" };
    const usable = all.filter(b => !b.disabled);
    if (!usable.length) {
      const why = all[0]!.closest(".btnTip")?.getAttribute("title");
      return { usable: [], reason: why || "Finding jumps unavailable" };
    }
    return { usable, reason: null };
  }

  async function jumps(n: number, ms: number): Promise<string | null> {
    const { usable, reason } = scrubButtons();
    if (reason) return reason;
    if (simBefore === null) simBefore = deps.simActive();
    for (let i = 0; i < n && !abCancelled(); i++) {
      usable[i % usable.length]!.click();
      await frames(ms);
    }
    return null;
  }

  const driver: AbDriver & { dispose(): void } = {
    blocker() {
      if (!deps.camera()) return "No 3D view";
      if (deps.toolpath.feedSegs + deps.toolpath.rapidSegs === 0) return "No program drawn — load one first";
      if (!deps.interpIdle()) return "A program is running — measure at idle";
      if (deps.sweepBusy()) return "Collision check running — wait until it ends";
      return null;
    },
    lineMode: () => deps.toolpath.lineMode as AbVariant,
    async setLineMode(v) {
      deps.toolpath.setLineMode(v, deps.toolpathCtx());
      deps.requestRender();
      await frames(100);
    },
    warmUp: ms => { saveView(); const f = frame(); return frames(ms, f ? () => place(f, 0, 1) : undefined); },
    orbit: ms => orbitFor(ms),
    async fitDetail(cycles, holdMs) {
      const f = frame();
      if (!f) { await frames(cycles * holdMs); return; }
      saveView();
      for (let i = 0; i < cycles && !abCancelled(); i++) {
        const scale = i % 2 ? 1 / DETAIL_FACTOR : 1;
        await frames(holdMs, () => place(f, Math.PI / 4, scale));
      }
    },
    findingJumps: (n, ms) => jumps(n, ms),
    async overlayOff(ms) {
      if (!deps.toolpath.hasOverlays) return "No limit overlay in this program";
      deps.toolpath.holdOverlays(true);
      try { await orbitFor(ms); } finally { deps.toolpath.holdOverlays(false); }
      return null;
    },
    async revealJumps(n, ms) {
      if (rapidsBefore === null) rapidsBefore = deps.rapidsLayer();
      if (deps.rapidsLayer()) deps.rapidsLayer(false);
      return jumps(n, ms);
    },
    async revealEnd() {
      if (rapidsBefore !== null && deps.rapidsLayer() !== rapidsBefore) deps.rapidsLayer(rapidsBefore);
      rapidsBefore = null;
    },
    async restore() {
      deps.toolpath.holdOverlays(false);
      await driver.revealEnd();
      // Leave the simulation the run entered — through the bar's own switch.
      if (simBefore === false && deps.simActive()) {
        deps.root()?.querySelector<HTMLInputElement>(".scrubBar .scrubRow input.toggle")?.click();
      }
      simBefore = null;
      const cam = deps.camera(), c = deps.controls();
      if (saved && cam && c) {
        cam.position.copy(saved.pos);
        cam.up.copy(saved.up);
        if (!(cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
          (cam as THREE.OrthographicCamera).zoom = saved.zoom;
          cam.updateProjectionMatrix();
        }
        c.target.copy(saved.target);
        c.update();
      }
      saved = null;
      deps.requestRender();
    },
    memory: (): PathMemory => deps.toolpath.pathMemory(),
    render: () => ({ ...deps.renderInfo(), draw_segs: deps.toolpath.drawSegs, chunks: deps.toolpath.chunks,
      chunks_visible: deps.toolpath.chunksVisible, lod_min: deps.toolpath.lodMin, lod_max: deps.toolpath.lodMax }),
    conditions() {
      note();
      const c = { ...flags };
      flags.hidden = flags.dialog = flags.interacted = flags.sweepBusy = false;
      return c;
    },
    meta: () => deps.meta(),
    tap: fn => setViewerPerfTap(fn),
    emit: (kind, f) => emitTelemetry(kind, f),
    now: () => performance.now(),
    dispose() {
      document.removeEventListener("visibilitychange", onVisibility);
      deps.onInteract(null);
      deps.setFrameHook(null);
      setViewerPerfTap(null);
    },
  };
  return driver;
}
