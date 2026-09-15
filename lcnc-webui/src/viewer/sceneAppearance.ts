import * as THREE from "three";

/** Broad studio lighting, with the sky along machine Z (Three defaults to Y). */
export function createMachineLighting(): THREE.Group {
  const rig = new THREE.Group();
  const sky = new THREE.HemisphereLight(0xffffff, 0x657175, 2.5);
  sky.position.set(0, 0, 1);
  rig.add(sky);
  for (const [x, y, z, intensity] of [
    [3, -4.5, 10, 3], [-7, -1, 5, 2], [0, 7, 7, 2],
  ] as const) {
    const light = new THREE.DirectionalLight(0xffffff, intensity);
    light.position.set(x, y, z);
    rig.add(light);
  }
  return rig;
}

export const MACHINE_SURFACE = {
  metalness: 0.12, roughness: 0.48,
  // Keep coplanar edge overlays from stippling against their own surfaces.
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
};

/** A visual reference below the assembly, never an occluding floor plane.
 * Bounds are the model's static assembly pose, already in machine units.
 * Choose spacing in mm so inch and metric configurations look identical.
 */
export function createGroundGrid(bounds: THREE.Box3, unitsPerMm: number): THREE.GridHelper | null {
  if (bounds.isEmpty() || ![...bounds.min, ...bounds.max].every(Number.isFinite)) return null;
  const size = bounds.getSize(new THREE.Vector3());
  const spanMm = Math.max(size.x, size.y, size.z) / unitsPerMm;
  if (!(spanMm > 0)) return null;
  const desiredStep = spanMm / 12;
  const decade = 10 ** Math.floor(Math.log10(desiredStep));
  const step = [1, 2, 5, 10].find(n => n * decade >= desiredStep)! * decade * unitsPerMm;
  const grid = new THREE.GridHelper(step * 24, 24);
  grid.name = "ground-grid";
  grid.rotation.x = Math.PI / 2;
  const center = bounds.getCenter(new THREE.Vector3());
  grid.position.set(center.x, center.y, bounds.min.z - spanMm * unitsPerMm * 0.002);
  grid.material.depthWrite = false;
  grid.material.toneMapped = false;
  return grid;
}

/** Use existing theme colours; line contrast is independent of part colour. */
export function updateGroundGridColors(grid: THREE.GridHelper, background: THREE.Color, foreground: THREE.Color): void {
  // Blend display values so dark-theme lines stay as subtle as light ones.
  const bg = background.clone().convertLinearToSRGB();
  const fg = foreground.clone().convertLinearToSRGB();
  const minor = bg.clone().lerp(fg, 0.12).convertSRGBToLinear();
  const major = bg.clone().lerp(fg, 0.25).convertSRGBToLinear();
  const colors = grid.geometry.getAttribute("color");
  // GridHelper emits X and Y lines (4 vertices) per division; the middle
  // division contains the two stronger centre lines.
  const middle = (colors.count / 4 - 1) / 2;
  for (let i = 0; i < colors.count; i++) {
    const color = Math.floor(i / 4) === middle ? major : minor;
    colors.setXYZ(i, color.r, color.g, color.b);
  }
  colors.needsUpdate = true;
}

export function createMachineEdgeMaterial(color: THREE.Color): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false });
}
