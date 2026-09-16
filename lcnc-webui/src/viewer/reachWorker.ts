// Off-main-thread reachable-volume computation (2026-09-12): the hull of a
// few thousand chain evaluations plus per-slice ray sweeps take tens to a
// few hundred ms — never on the UI thread. The math lives in
// reachEnvelope.ts (pure, unit-tested); this shell just marshals.
import * as THREE from "three";
import { computeReach, type ReachOptions } from "./reachEnvelope";
import type { JointLimitList, PartFrameMachine } from "./partFrame";

interface Req {
  id: number;
  machine: PartFrameMachine;
  jointLimits: JointLimitList;
  tlo: number[];
  opts?: ReachOptions;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, machine, jointLimits, tlo, opts } = e.data;
  try {
    const r = computeReach(machine, jointLimits, tlo, opts);
    // Outlines only (operator, 2026-09-12): the room hull's facet creases at
    // 8° (the box edges + the head-lever fillets as a fan of lines), the
    // swept solid's cage. Line-segment soups; no fills cross the wire.
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(r.roomTris, 3));
    const roomLines = (new THREE.EdgesGeometry(geom, 8).getAttribute("position").array as Float32Array).slice();
    geom.dispose();
    // Reach-diagram density (operator, 2026-09-12: "must it remain a mesh?"):
    // a ring every 16th slice (5 over the length, inner + outer so the hole
    // reads) and a profile line every 45° — the two knobs of the cage.
    const partLines = r.part?.cage(16, 45) ?? null;
    const transfer: Transferable[] = [roomLines.buffer as ArrayBuffer];
    if (partLines) transfer.push(partLines.buffer as ArrayBuffer);
    self.postMessage({ id, roomLines, partLines, info: r.info }, { transfer });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
