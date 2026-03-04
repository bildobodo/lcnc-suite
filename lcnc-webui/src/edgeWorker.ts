import * as THREE from "three";

self.onmessage = (e: MessageEvent) => {
  const { id, positions, index, threshold } = e.data as {
    id: string;
    positions: Float32Array;
    index: Uint32Array | null;
    threshold: number;
  };

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (index) geom.setIndex(new THREE.BufferAttribute(index, 1));

  const edges = new THREE.EdgesGeometry(geom, threshold);
  const edgePos = (edges.attributes.position as THREE.BufferAttribute).array as Float32Array;

  // Transfer result back (zero-copy)
  self.postMessage({ id, positions: edgePos }, { transfer: [edgePos.buffer] });

  geom.dispose();
  edges.dispose();
};
