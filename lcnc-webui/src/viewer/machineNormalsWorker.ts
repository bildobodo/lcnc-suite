import { BufferAttribute, BufferGeometry } from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

self.onmessage = (event: MessageEvent<{ id: number; positions: Float32Array }>) => {
  const { id, positions } = event.data;
  try {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    toCreasedNormals(geometry, Math.PI / 6);
    const normals = geometry.getAttribute("normal").array as Float32Array;
    self.postMessage({ id, normals }, { transfer: [normals.buffer] });
    geometry.dispose();
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
