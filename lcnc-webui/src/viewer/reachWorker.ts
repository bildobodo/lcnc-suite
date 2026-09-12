// Off-main-thread reachable-volume computation (2026-09-12): the hull of a
// few thousand chain evaluations plus per-slice ray sweeps take tens to a
// few hundred ms — never on the UI thread. The math lives in
// reachEnvelope.ts (pure, unit-tested); this shell just marshals.
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
    const transfer: Transferable[] = [r.roomTris.buffer as ArrayBuffer];
    if (r.partTris) transfer.push(r.partTris.buffer as ArrayBuffer);
    self.postMessage({ id, roomTris: r.roomTris, partTris: r.partTris, info: r.info }, { transfer });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
