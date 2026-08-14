// Shared machine-kinematics normalization — the single source of kinematic
// truth for everything that interprets machine.json: the live ThreeViewer
// scene (applyState) and the part-frame preview transform (partFrame.ts).
//
// Wire form (KinEntry, from viewer_init.kinematics) is normalized once into
// runtime entries with a precomputed unit axis vector, so per-frame / per-
// sample loops are pure arithmetic — no allocations, no string dispatch.
import * as THREE from "three";
import type { ViewerInit } from "../ws/bulkData";

export type KinEntry = {
  group: string;
  joint: number;
  type?: "translate" | "rotate";
  direction?: "x" | "y" | "z";
  axis?: [number, number, number];
  sign: number;
};

export type KinRuntime = {
  group: string;
  joint: number;
  rotate: boolean;
  /** Unit DOF axis, from `axis` (arbitrary) or `direction` (cartesian). */
  axisVec: THREE.Vector3;
  /** Cartesian direction if the entry used one (drives axis-color mapping). */
  direction: "x" | "y" | "z" | null;
  sign: number;
};

export const DIR_VECTORS: Record<"x" | "y" | "z", [number, number, number]> = {
  x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1],
};

export function normalizeKinematics(kin: ViewerInit["kinematics"]): KinRuntime[] {
  const entries: KinEntry[] = Array.isArray(kin)
    ? kin
    // Legacy object form: { x: { axis: 0, sign: -1 }, ... }
    : Object.entries(kin).map(([key, v]) => ({
        group: key,
        joint: v.axis,
        type: "translate" as const,
        direction: key as "x" | "y" | "z",
        sign: v.sign,
      }));
  const out: KinRuntime[] = [];
  for (const k of entries) {
    const a = k.axis ?? (k.direction ? DIR_VECTORS[k.direction] : null);
    if (!a) {
      // An entry with neither axis nor direction can't drive anything —
      // surface it (captured by error.console telemetry) instead of a
      // silently dead joint.
      console.error(`[kinematics] entry for group "${k.group}" has no axis/direction — ignored`);
      continue;
    }
    out.push({
      group: k.group,
      joint: k.joint,
      rotate: k.type === "rotate",
      axisVec: new THREE.Vector3(a[0], a[1], a[2]).normalize(),
      direction: k.direction ?? null,
      sign: k.sign ?? 1,
    });
  }
  return out;
}

/** True if any kinematics entry on the chain from `groupId` up to root is a
 *  rotary DOF — decides whether "path on part" differs from programmed XYZ. */
export function chainHasRotary(
  init: Pick<ViewerInit, "kinematics" | "groups">,
  groupId: string | undefined | null,
): boolean {
  if (!groupId || !init.groups) return false;
  const parents: Record<string, string> = {};
  for (const g of init.groups) parents[g.id] = g.parent;
  const rotaryGroups = new Set(
    normalizeKinematics(init.kinematics).filter(k => k.rotate).map(k => k.group),
  );
  let cur: string | undefined = groupId;
  let hops = 0;
  while (cur && cur !== "root" && hops++ < 64) {
    if (rotaryGroups.has(cur)) return true;
    cur = parents[cur];
  }
  return false;
}
