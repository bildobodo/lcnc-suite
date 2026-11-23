/**
 * The collision MODEL's key (P2b-1, machine day 2026-11-22, Codex R439): the
 * worker keeps one resident model per key, and a request whose key it holds
 * sends no bodies. The key carries EVERY input that builds the model — the
 * machine tree with its groups and kinematics, each colliding part's fields
 * and the mesh / proxy actually loaded (its geometry's identity: a reload is
 * a new one), the unit scale, and that the model has a tool body — and NOT
 * the live tool's dims: a tool change gives the run its own base variant in
 * the worker; it used to rebuild every machine BVH (62–94 s on the operator's
 * panel). Pure.
 */
export interface ModelKeyPart {
  id: string;
  file: string | null | undefined;
  collision: string | null | undefined;
  group: string;
  translate: unknown;
  rotate: unknown;
  stock: boolean;
  /** The loaded display mesh's identity (a BufferGeometry uuid), null when none. */
  mesh: string | null;
  /** The loaded collision proxy's identity, null when the part declares none or it did not load. */
  proxy: string | null;
}

/** The key — no tool input by construction (P2b-1). `machine` is the plain
 *  machine description the sweep gets (tree, groups, kinematics, unit scale). */
export function collisionModelKey(machine: unknown, parts: readonly ModelKeyPart[], unitScale: number): string {
  return JSON.stringify([machine, parts.map(p => [p.id, p.file ?? null, p.collision ?? null, p.group, p.translate ?? null,
    p.rotate ?? null, p.stock ? 1 : 0, p.mesh, p.proxy]), unitScale, "tool-body"]);
}
