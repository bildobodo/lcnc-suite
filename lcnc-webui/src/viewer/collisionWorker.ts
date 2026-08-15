// Off-main-thread collision sweep (offline dry run, stage 3). BVH builds and
// the per-sample mesh distance queries are seconds-of-CPU on a real program —
// exactly the class of work that must never touch the UI thread (heartbeat).
//
// Cancellation: the sweep is synchronous inside the worker, so a cancel
// message could not be observed mid-run — the owner cancels by terminating
// the worker and lazily recreating it. Progress messages posted from inside
// the sync loop still flush to the main thread while the worker computes.
import {
  buildCollisionModel, sweepCollisions, toolCylinderPositions,
  type CollisionBody, type CollisionMachine, type CollisionOptions,
} from "./collision";
import type { PartFrameWcs } from "./partFrame";
import type { ScrubTrack } from "../ws/bulkData";

export interface CollisionReq {
  id: number;
  machine: CollisionMachine;
  bodies: CollisionBody[];
  /** Parametric tool body attached to the tool group (viewer marker dims,
   *  machine units). null = no tool body (bodies-only check). */
  tool: { diam: number; len: number } | null;
  track: ScrubTrack;
  wcs: PartFrameWcs;
  options: CollisionOptions;
}

self.onmessage = (e: MessageEvent<CollisionReq>) => {
  const { id, machine, bodies, tool, track, wcs, options } = e.data;
  try {
    if (tool) {
      bodies.push({
        id: "tool",
        group: machine.toolGroup,
        // toolCylinderPositions works in machine units already; the model
        // builder multiplies by unitScale (machine.json mm → machine units),
        // so pre-divide to make that a no-op for the parametric body.
        positions: toolCylinderPositions(tool.diam / machine.unitScale, tool.len / machine.unitScale),
      });
    }
    const model = buildCollisionModel(machine, bodies);
    if (model.pairs.length === 0) {
      // Not an error and not "clean": no body pair has program-driven
      // relative motion — nothing to check. Surface it honestly.
      self.postMessage({ id, result: { hits: [], staticContacts: [], samples: 0, coarsened: false, pairCount: 0, bvhMs: model.bvhMs, sweepMs: 0 } });
      return;
    }
    const result = sweepCollisions(model, track, wcs, options, (frac) => {
      self.postMessage({ id, progress: frac });
    });
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
