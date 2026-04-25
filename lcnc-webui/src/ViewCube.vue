<script setup lang="ts">
import * as THREE from "three";
import { ref, onMounted, onBeforeUnmount } from "vue";

const props = defineProps<{
  // Getter so the cube reacts to main-camera replacement (perspective ↔ ortho swap).
  getCameraQuaternion: () => THREE.Quaternion | null;
}>();

const emit = defineEmits<{
  viewChange: [dir: THREE.Vector3, up: THREE.Vector3];
}>();

const CANVAS_PX = 140;
const CUBE_SIZE = 1;
const CUBE_CAM_DIST = 2.5;

const canvasRef = ref<HTMLCanvasElement | null>(null);

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let cam: THREE.OrthographicCamera | null = null;
let cubeRoot: THREE.Group | null = null;
let hitGrid: THREE.Group | null = null;
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
//
// Click handling lives on a separate 3x3x3 grid of invisible hit boxes built
// after the labels — see buildHitGrid(). Face label meshes carry no userData
// so the raycaster only sees the hit grid.
function buildCube(): THREE.Group {
  const g = new THREE.Group();
  const half = CUBE_SIZE / 2;
  const faces: Array<{ label: string; pos: THREE.Vector3; visualUp: THREE.Vector3 }> = [
    { label: "FRONT",  pos: new THREE.Vector3(+half, 0, 0), visualUp: new THREE.Vector3(0, 0, 1) },
    { label: "BACK",   pos: new THREE.Vector3(-half, 0, 0), visualUp: new THREE.Vector3(0, 0, 1) },
    { label: "RIGHT",  pos: new THREE.Vector3(0, +half, 0), visualUp: new THREE.Vector3(0, 0, 1) },
    { label: "LEFT",   pos: new THREE.Vector3(0, -half, 0), visualUp: new THREE.Vector3(0, 0, 1) },
    { label: "TOP",    pos: new THREE.Vector3(0, 0, +half), visualUp: new THREE.Vector3(0, 1, 0) },
    { label: "BOTTOM", pos: new THREE.Vector3(0, 0, -half), visualUp: new THREE.Vector3(0, -1, 0) },
  ];
  for (const f of faces) {
    const geom = new THREE.PlaneGeometry(CUBE_SIZE * 0.96, CUBE_SIZE * 0.96);
    const mat = new THREE.MeshBasicMaterial({ map: makeFaceTexture(f.label) });
    const m = new THREE.Mesh(geom, mat);
    m.position.copy(f.pos);
    m.up.copy(f.visualUp);
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

// 3x3x3 grid of invisible hit boxes covering the cube. The 26 outer cells
// (interior excluded) classify a click into face / edge / corner by how many
// axes are non-zero:
//   1 axis  -> face   (6)   e.g. (+1,0,0)   = FRONT  orthographic
//   2 axes  -> edge  (12)   e.g. (+1,0,+1)  = front-top 45deg tilted
//   3 axes  -> corner (8)   e.g. (+1,+1,+1) = front-right-top isometric
// viewUp is always world +Z so OrbitControls keeps the CNC turntable feel.
// applyViewDirection() in the parent handles the off-pole nudge for face hits.
function buildHitGrid(): THREE.Group {
  const g = new THREE.Group();
  const cell = CUBE_SIZE / 3;
  const half = CUBE_SIZE / 2;
  const DECAL_OFFSET = 0.002; // tiny lift to avoid z-fight with face label planes
  const DECAL_SIZE = cell * 0.96;
  const hitGeom = new THREE.BoxGeometry(cell, cell, cell);
  const VIEW_UP = new THREE.Vector3(0, 0, 1);
  // Per cell: one invisible picker box for raycast, plus 1-3 flat decals
  // sitting just above each cube face the cell touches. The decals are the
  // hover indicator; they hug the outer surface so nothing protrudes inward.
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (let k = -1; k <= 1; k++) {
        if (i === 0 && j === 0 && k === 0) continue;
        const pickMat = new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0, depthWrite: false,
        });
        const pick = new THREE.Mesh(hitGeom, pickMat);
        pick.position.set(i * cell, j * cell, k * cell);
        pick.userData.viewDir = new THREE.Vector3(i, j, k).normalize();
        pick.userData.viewUp = VIEW_UP.clone();
        const decals: THREE.Mesh[] = [];
        const axes: Array<{ axis: 0 | 1 | 2; sign: number }> = [];
        if (i !== 0) axes.push({ axis: 0, sign: i });
        if (j !== 0) axes.push({ axis: 1, sign: j });
        if (k !== 0) axes.push({ axis: 2, sign: k });
        for (const { axis, sign } of axes) {
          const dPos = new THREE.Vector3(i * cell, j * cell, k * cell);
          const outward = new THREE.Vector3();
          if (axis === 0) { dPos.x = sign * (half + DECAL_OFFSET); outward.set(sign, 0, 0); }
          else if (axis === 1) { dPos.y = sign * (half + DECAL_OFFSET); outward.set(0, sign, 0); }
          else { dPos.z = sign * (half + DECAL_OFFSET); outward.set(0, 0, sign); }
          const decalMat = new THREE.MeshBasicMaterial({
            color: 0x4ea9ff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          });
          const decal = new THREE.Mesh(new THREE.PlaneGeometry(DECAL_SIZE, DECAL_SIZE), decalMat);
          decal.position.copy(dPos);
          // Object3D.lookAt for non-cameras orients local +Z away from target,
          // so targeting along the outward normal makes the plane face outward.
          decal.lookAt(dPos.clone().add(outward));
          // Decals must not be raycast targets — only picker boxes are.
          decal.raycast = () => {};
          decals.push(decal);
          g.add(decal);
        }
        pick.userData.decals = decals;
        g.add(pick);
      }
    }
  }
  return g;
}

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const HOVER_OPACITY = 0.35;
let hoveredCell: THREE.Mesh | null = null;

function pickCell(e: MouseEvent): THREE.Mesh | null {
  if (!cam || !hitGrid || !canvasRef.value) return null;
  const rect = canvasRef.value.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, cam);
  const hit = raycaster.intersectObjects(hitGrid.children, false)[0];
  return hit ? (hit.object as THREE.Mesh) : null;
}

function setCellOpacity(cell: THREE.Mesh, opacity: number) {
  const decals = cell.userData.decals as THREE.Mesh[] | undefined;
  if (!decals) return;
  for (const d of decals) {
    (d.material as THREE.MeshBasicMaterial).opacity = opacity;
  }
}

function setHover(cell: THREE.Mesh | null) {
  if (cell === hoveredCell) return;
  if (hoveredCell) setCellOpacity(hoveredCell, 0);
  if (cell) setCellOpacity(cell, HOVER_OPACITY);
  hoveredCell = cell;
}

function onClick(e: MouseEvent) {
  const cell = pickCell(e);
  if (!cell) return;
  const ud = cell.userData as { viewDir?: THREE.Vector3; viewUp?: THREE.Vector3 };
  if (ud.viewDir && ud.viewUp) {
    emit("viewChange", ud.viewDir.clone(), ud.viewUp.clone());
  }
}

function onPointerMove(e: PointerEvent) {
  setHover(pickCell(e));
}

function onPointerLeave() {
  setHover(null);
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
  hitGrid = buildHitGrid();
  cubeRoot.add(hitGrid);
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
  hitGrid = null;
  hoveredCell = null;
  scene = null;
  cam = null;
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
});
</script>

<template>
  <canvas
    ref="canvasRef"
    class="viewCube"
    @click="onClick"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  />
</template>

<style scoped>
.viewCube {
  position: absolute;
  z-index: 1;
  top: 12px;
  right: 12px;
  width: 140px;
  height: 140px;
  cursor: pointer;
}
</style>
