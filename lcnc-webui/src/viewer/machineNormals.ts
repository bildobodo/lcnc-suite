import { BufferAttribute, type BufferGeometry } from "three";

// Persisted with the parsed STL, so old faceted caches are upgraded once.
export const MACHINE_NORMALS_VERSION = 1;

/** One lazy worker per asset-load batch. Large STLs must not freeze controls
 * while normals are averaged. Transfer a copy: the render/collision vertices
 * remain owned by the main thread and their positions never change.
 */
export function createMachineNormalProcessor() {
  let worker: Worker | null = null;
  let stopped = false;
  let nextId = 0;
  const pending = new Map<number, { resolve: (normals: Float32Array) => void; reject: (error: Error) => void }>();
  function dispose() {
    stopped = true;
    worker?.terminate();
    worker = null;
    for (const request of pending.values()) request.reject(new Error("Machine normal worker stopped"));
    pending.clear();
  }
  function getWorker() {
    if (!worker) {
      worker = new Worker(new URL("./machineNormalsWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ id: number; normals: Float32Array; error?: string }>) => {
        const reply = event.data;
        const request = pending.get(reply.id);
        pending.delete(reply.id);
        if (reply.error) request?.reject(new Error(reply.error));
        else request?.resolve(reply.normals);
      };
      worker.onerror = (event) => {
        for (const request of pending.values()) request.reject(new Error(event.message));
        pending.clear();
        dispose();
      };
      worker.onmessageerror = dispose;
    }
    return worker;
  }
  return {
    dispose,
    async process(source: BufferGeometry): Promise<BufferGeometry> {
      if (stopped) throw new Error("Machine normal worker stopped");
      if (source.userData.machineNormalsVersion === MACHINE_NORMALS_VERSION) return source;
      // STLLoader produces unindexed triangles. Honour older indexed cache
      // entries too: creases need separate vertex normals on either face.
      const geometry = source.index ? source.toNonIndexed() : source;
      const position = geometry.getAttribute("position");
      if (!position || position.count % 3 !== 0) throw new Error("Invalid machine triangle geometry");
      const positions = new Float32Array(position.array);
      const activeWorker = getWorker();
      const id = ++nextId;
      const normals = await new Promise<Float32Array>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { activeWorker.postMessage({ id, positions }, [positions.buffer]); }
        catch (error) { pending.delete(id); reject(error); }
      });
      geometry.setAttribute("normal", new BufferAttribute(normals, 3));
      geometry.userData.machineNormalsVersion = MACHINE_NORMALS_VERSION;
      if (geometry !== source) source.dispose();
      return geometry;
    },
  };
}
