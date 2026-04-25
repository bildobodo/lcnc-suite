<script setup lang="ts">
import * as THREE from "three";
import { ref, onMounted, onBeforeUnmount } from "vue";

const props = defineProps<{
  // Getter so the cube reacts to main-camera replacement (perspective ↔ ortho swap).
  getCameraQuaternion: () => THREE.Quaternion | null;
}>();

const CANVAS_PX = 140;
const CUBE_SIZE = 1;
const CUBE_CAM_DIST = 2.5;

const canvasRef = ref<HTMLCanvasElement | null>(null);

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let cam: THREE.OrthographicCamera | null = null;
let cubeRoot: THREE.Group | null = null;
let raf = 0;

function makeFaceTexture(label: string): THREE.CanvasTexture {
  const px = 256;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#cbd2da";
  ctx.fillRect(0, 0, px, px);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, px - 6, px - 6);
  ctx.fillStyle = "#222";
  ctx.font = `bold ${Math.floor(px * 0.20)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, px / 2, px / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// Face labels match setView() preset directions in ThreeViewer.vue:
// +X = FRONT, -X = BACK, +Y = RIGHT, -Y = LEFT, +Z = TOP, -Z = BOTTOM.
//
// Each face's `up` matches the existing setView() camera-up convention so the
// label reads right-side-up when the user clicks into that view.
// Object3D.lookAt() for non-cameras orients local +Z away from the target, so
// targeting a point outward of the face puts the textured side facing outward.
function buildCube(): THREE.Group {
  const g = new THREE.Group();
  const half = CUBE_SIZE / 2;
  const faces: Array<{ label: string; pos: THREE.Vector3; up: THREE.Vector3 }> = [
    { label: "FRONT",  pos: new THREE.Vector3(+half, 0, 0), up: new THREE.Vector3(0, 0, 1) },
    { label: "BACK",   pos: new THREE.Vector3(-half, 0, 0), up: new THREE.Vector3(0, 0, 1) },
    { label: "RIGHT",  pos: new THREE.Vector3(0, +half, 0), up: new THREE.Vector3(0, 0, 1) },
    { label: "LEFT",   pos: new THREE.Vector3(0, -half, 0), up: new THREE.Vector3(0, 0, 1) },
    { label: "TOP",    pos: new THREE.Vector3(0, 0, +half), up: new THREE.Vector3(0, 1, 0) },
    { label: "BOTTOM", pos: new THREE.Vector3(0, 0, -half), up: new THREE.Vector3(0, -1, 0) },
  ];
  for (const f of faces) {
    const geom = new THREE.PlaneGeometry(CUBE_SIZE * 0.96, CUBE_SIZE * 0.96);
    const mat = new THREE.MeshBasicMaterial({ map: makeFaceTexture(f.label) });
    const m = new THREE.Mesh(geom, mat);
    m.position.copy(f.pos);
    m.up.copy(f.up);
    m.lookAt(f.pos.clone().multiplyScalar(2));
    g.add(m);
  }
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE)),
    new THREE.LineBasicMaterial({ color: 0x444444 }),
  );
  g.add(wire);
  return g;
}

function tick() {
  raf = requestAnimationFrame(tick);
  if (!renderer || !scene || !cam) return;
  const q = props.getCameraQuaternion();
  if (q) {
    // Mirror the main camera's orientation: position the cube cam along its own
    // back direction (local +Z rotated by q) and copy the orientation outright.
    // Skipping lookAt() avoids gimbal lock when the back direction parallels up
    // (e.g. top/bottom views). Same pattern as the bottom-left orientation gizmo.
    cam.position.set(0, 0, CUBE_CAM_DIST).applyQuaternion(q);
    cam.quaternion.copy(q);
  }
  renderer.render(scene, cam);
}

onMounted(() => {
  if (!canvasRef.value) return;
  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(CANVAS_PX, CANVAS_PX, false);

  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-0.85, 0.85, 0.85, -0.85, 0.1, 100);

  cubeRoot = buildCube();
  scene.add(cubeRoot);

  tick();
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  raf = 0;
  if (cubeRoot) {
    cubeRoot.traverse((obj) => {
      const g = (obj as THREE.Mesh).geometry;
      if (g) g.dispose();
      const mat = (obj as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    cubeRoot = null;
  }
  scene = null;
  cam = null;
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
});
</script>

<template>
  <canvas ref="canvasRef" class="viewCube" />
</template>

<style scoped>
.viewCube {
  position: absolute;
  z-index: 1;
  top: 12px;
  right: 12px;
  width: 140px;
  height: 140px;
  pointer-events: none;
}
</style>
