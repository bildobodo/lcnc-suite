import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createMachineNormalProcessor } from "./machineNormals";

// Execute the real worker handler in-process; the browser test covers the
// actual module-worker/transfer boundary. No separate copy of the algorithm.
const scope = { onmessage: null as any, postMessage: vi.fn() };
vi.stubGlobal("self", scope);
await import("./machineNormalsWorker");
const workerHandler = scope.onmessage;
vi.unstubAllGlobals();

class WorkerMock {
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  terminate = vi.fn();
  postMessage(data: any) {
    vi.stubGlobal("self", { postMessage: (reply: any) => this.onmessage?.({ data: reply }) });
    workerHandler({ data });
  }
}
afterEach(() => vi.unstubAllGlobals());

describe("machine creased normals", () => {
  it("smooths cylinder facets while keeping the end cap sharp and vertices unchanged", async () => {
    vi.stubGlobal("Worker", WorkerMock);
    const geometry = new THREE.CylinderGeometry(100, 100, 200, 64).toNonIndexed();
    geometry.computeVertexNormals(); // the old faceted STL behaviour
    const positions = geometry.getAttribute("position");
    const originalPositions = positions.array.slice();
    const faceted = geometry.getAttribute("normal").array.slice();
    const processor = createMachineNormalProcessor();
    const result = await processor.process(geometry);
    expect(result).toBe(geometry);
    expect(result.index).toBeNull();
    expect(result.getAttribute("position").array).toEqual(originalPositions);
    const normals = result.getAttribute("normal");
    expect(normals.array).not.toEqual(faceted);
    // Side normals should be radial; caps keep their exact +/- Y normals.
    const sideCount = geometry.groups[0]!.count;
    for (let i = 0; i < normals.count; i++) {
      const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
      if (i < sideCount) {
        const radial = new THREE.Vector3(positions.getX(i), 0, positions.getZ(i)).normalize();
        expect(normal.dot(radial)).toBeGreaterThan(0.999);
        expect(normal.y).toBe(0);
      } else {
        expect(Math.abs(normal.y)).toBe(1);
      }
    }
    processor.dispose();
  });

  it("expands indexed caches without changing their triangles and preserves box corners", async () => {
    vi.stubGlobal("Worker", WorkerMock);
    const source = new THREE.BoxGeometry();
    const original = source.toNonIndexed();
    const processor = createMachineNormalProcessor();
    const result = await processor.process(source);
    expect(result.index).toBeNull();
    expect(result.getAttribute("position").array).toEqual(original.getAttribute("position").array);
    expect(result.getAttribute("normal").array).toEqual(original.getAttribute("normal").array);
    processor.dispose();
  });

  it("reuses processed geometry without starting a worker", async () => {
    const worker = vi.fn();
    vi.stubGlobal("Worker", worker);
    const geometry = new THREE.BoxGeometry();
    geometry.userData.machineNormalsVersion = 1;
    const processor = createMachineNormalProcessor();
    expect(await processor.process(geometry)).toBe(geometry);
    expect(worker).not.toHaveBeenCalled();
    processor.dispose();
  });

  it("rejects outstanding work and terminates the worker on shutdown", async () => {
    const worker = new WorkerMock();
    worker.postMessage = () => {};
    vi.stubGlobal("Worker", class { constructor() { return worker; } });
    const processor = createMachineNormalProcessor();
    const pending = processor.process(new THREE.BoxGeometry());
    const rejected = expect(pending).rejects.toThrow("worker stopped");
    processor.dispose();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(processor.process(new THREE.BoxGeometry())).rejects.toThrow("worker stopped");
  });
});
