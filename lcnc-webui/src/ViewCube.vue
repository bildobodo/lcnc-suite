<script setup lang="ts">
import * as THREE from "three";
import { ref, onMounted, onBeforeUnmount } from "vue";
import { AXIS_CSS, AXIS_HEX } from "./axisColors";
import {
  CUBE_FACES, CUBE_SIZE, FACE_SIZE, FACE_TEX_PX, FACE_BORDER_PX, LETTER_SIZE, faceArrows, arrowOpacity, keepInCanvas,
  type CubeFace, type AxisLetter,
} from "./viewer/cubeFaces";

const props = defineProps<{
  // Getter so the cube reacts to main-camera replacement (perspective ↔ ortho swap).
  getCameraQuaternion: () => THREE.Quaternion | null;
}>();

const emit = defineEmits<{
  viewChange: [dir: THREE.Vector3, up: THREE.Vector3];
}>();

const CANVAS_PX = 140;
const CUBE_CAM_DIST = 2.5;

const canvasRef = ref<HTMLCanvasElement | null>(null);

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let cam: THREE.OrthographicCamera | null = null;
let cubeRoot: THREE.Group | null = null;
let hitGrid: THREE.Group | null = null;
let arrowRoot: THREE.Group | null = null;
let raf = 0;

interface Palette { face: string; edge: string; label: string; hover: string; tint: number; }
let palette: Palette = { face: "#cbd2da", edge: "#444444", label: "#222222", hover: "#4ea9ff", tint: 0.2 };

// Resolve a CSS expression (e.g. 'var(--viewcube-face)') to a canonical
// 'rgb(r, g, b)' string by piggy-backing on the canvas element's computed
// style. Three.js can't read CSS vars directly; this bridges the gap.
function resolveColor(cssExpr: string): string {
  const el = canvasRef.value;
  if (!el) return "#000";
  const prev = el.style.color;
  el.style.color = cssExpr;
  const computed = getComputedStyle(el).color;
  el.style.color = prev;
  return computed;
}

function readPalette(): Palette {
  const tint = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--viewcube-tint"));
  if (!Number.isFinite(tint)) console.warn("[viewcube] --viewcube-tint unreadable — the faces draw untinted");
  return {
    face:  resolveColor("var(--viewcube-face)"),
    edge:  resolveColor("var(--viewcube-edge)"),
    label: resolveColor("var(--viewcube-label)"),
    hover: resolveColor("var(--viewcube-hover)"),
    tint:  Number.isFinite(tint) ? tint / 100 : 0,
  };
}

// The UI's own face (the bundled Inter, style.css): a canvas does not wait
// for a web font, so the faces are drawn again once it has loaded.
function fontSans(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "sans-serif";
}

const AXIS_KEY: Record<AxisLetter, "x" | "y" | "z"> = { X: "x", Y: "y", Z: "z" };

// A face: the theme's face colour, its axis colour over it at
// --viewcube-tint (alpha compositing — a canvas fill does not take every
// CSS colour syntax a computed color-mix() serialises to), the border the
// edge arrows lie on (cubeFaces FACE_BORDER_PX), the axis name.
function makeFaceTexture(face: CubeFace, p: Palette): THREE.CanvasTexture {
  const px = FACE_TEX_PX;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = p.face;
  ctx.fillRect(0, 0, px, px);
  ctx.globalAlpha = p.tint;
  ctx.fillStyle = AXIS_CSS[AXIS_KEY[face.axis]];
  ctx.fillRect(0, 0, px, px);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = p.edge;
  ctx.lineWidth = 2 * FACE_BORDER_PX;
  ctx.strokeRect(FACE_BORDER_PX, FACE_BORDER_PX, px - 2 * FACE_BORDER_PX, px - 2 * FACE_BORDER_PX);
  ctx.fillStyle = p.label;
  ctx.font = `bold ${Math.floor(px * 0.20)}px ${fontSans()}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(face.label, px / 2, px / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// The faces are named by axis (viewer/cubeFaces.ts): the face a straight
// view along −n shows is the n face — setView("z+") looks from above at Z+.
// Each face's `up` matches the setView() camera-up convention so the label
// reads right-side-up when the user clicks into that view.
// Object3D.lookAt() for non-cameras orients local +Z away from the target, so
// targeting a point outward of the face puts the textured side facing outward.
//
// Click handling lives on a separate 3x3x3 grid of invisible hit boxes built
// after the labels — see buildHitGrid(); the raycaster only sees that grid.
function buildCube(): THREE.Group {
  const g = new THREE.Group();
  for (const f of CUBE_FACES) {
    const pos = new THREE.Vector3(...f.normal).multiplyScalar(CUBE_SIZE / 2);
    const geom = new THREE.PlaneGeometry(FACE_SIZE, FACE_SIZE);
    const mat = new THREE.MeshBasicMaterial({ map: makeFaceTexture(f, palette) });
    const m = new THREE.Mesh(geom, mat);
    m.position.copy(pos);
    m.up.set(...f.visualUp);
    m.lookAt(pos.clone().multiplyScalar(2));
    m.userData.face = f;
    g.add(m);
  }
  return g;
}

// A letter as a sprite: the axis colour with a fine dark outline, like the
// labels of the corner gizmo this replaces.
function letterTexture(letter: string, css: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = `bold 46px ${fontSans()}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#000";
  ctx.strokeText(letter, 32, 35);
  ctx.fillStyle = css;
  ctx.fillText(letter, 32, 35);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// The in-plane axes of each face as plain arrows ON its displayed border,
// the full side long, the letter outside past the tip (cubeFaces
// faceArrows). Drawn over the cube (no depth test) and faded by tick() so
// only the face a straight view looks at shows them. Never a raycast target.
const ARROW_SHAFT_R = 0.013, ARROW_HEAD_R = 0.045, ARROW_HEAD_LEN = 0.15;
/** The letter's dark outline reaches this far past its quad (CSS px). */
const LETTER_OUTLINE_PX = 1.5;
function buildArrows(): THREE.Group {
  const root = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  for (const f of CUBE_FACES) {
    const g = new THREE.Group();
    g.userData.face = f;
    g.userData.materials = [] as THREE.Material[];
    g.userData.arrows = faceArrows(f);
    for (const a of faceArrows(f)) {
      const key = AXIS_KEY[a.axis];
      const dir = new THREE.Vector3(...a.dir);
      const start = new THREE.Vector3(...a.start), len = new THREE.Vector3(...a.tip).sub(start).length();
      const mat = new THREE.MeshBasicMaterial({ color: AXIS_HEX[key], depthTest: false, transparent: true, opacity: 0 });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(ARROW_SHAFT_R, ARROW_SHAFT_R, len - ARROW_HEAD_LEN, 12), mat);
      shaft.quaternion.setFromUnitVectors(up, dir);
      shaft.position.copy(start).addScaledVector(dir, (len - ARROW_HEAD_LEN) / 2);
      const head = new THREE.Mesh(new THREE.ConeGeometry(ARROW_HEAD_R, ARROW_HEAD_LEN, 16), mat);
      head.quaternion.setFromUnitVectors(up, dir);
      head.position.copy(start).addScaledVector(dir, len - ARROW_HEAD_LEN / 2);
      const smat = new THREE.SpriteMaterial({ map: letterTexture(a.axis, AXIS_CSS[key]), depthTest: false, transparent: true, opacity: 0 });
      const letter = new THREE.Sprite(smat);
      letter.scale.set(LETTER_SIZE, LETTER_SIZE, 1);
      letter.position.set(...a.label);
      letter.userData.letter = a.axis;
      letter.userData.home = new THREE.Vector3(...a.label);
      for (const o of [shaft, head, letter]) { o.renderOrder = 10; o.raycast = () => {}; g.add(o); }
      g.userData.materials.push(mat, smat);
    }
    g.visible = false;
    root.add(g);
  }
  return root;
}

// 3x3x3 grid of invisible hit boxes covering the cube. The 26 outer cells
// (interior excluded) classify a click into face / edge / corner by how many
// axes are non-zero:
//   1 axis  -> face   (6)   e.g. (+1,0,0)   = the X+ face, orthographic
//   2 axes  -> edge  (12)   e.g. (+1,0,+1)  = the X+/Z+ edge, 45deg tilted
//   3 axes  -> corner (8)   e.g. (+1,+1,+1) = the X+/Y+/Z+ corner, isometric
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
            color: palette.hover,
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
    // (e.g. top/bottom views).
    cam.position.set(0, 0, CUBE_CAM_DIST).applyQuaternion(q);
    cam.quaternion.copy(q);
  }
  fadeArrows();
  renderer.render(scene, cam);
}

// Each face's arrows by how straight the view looks at it (cubeFaces
// arrowOpacity: none beyond 16°, whole within 6°), and every shown letter
// whole inside the canvas (keepInCanvas — near Z± the face turns with the
// azimuth and a letter past a tip ran out of the canvas, Codex R74 VP-I35).
const _toCam = new THREE.Vector3(), _ndc = new THREE.Vector3();
function fadeArrows() {
  if (!arrowRoot || !cam) return;
  _toCam.copy(cam.position).normalize();
  cam.updateMatrixWorld();
  const unitsPerNdc = (cam.right - cam.left) / 2 / cam.zoom;
  const halfNdc = LETTER_SIZE / 2 / unitsPerNdc + (2 * LETTER_OUTLINE_PX) / CANVAS_PX;
  for (const g of arrowRoot.children) {
    const f = g.userData.face as CubeFace;
    const o = arrowOpacity(_toCam.x * f.normal[0] + _toCam.y * f.normal[1] + _toCam.z * f.normal[2]);
    g.visible = o > 0;
    for (const m of g.userData.materials as THREE.MeshBasicMaterial[]) m.opacity = o;
    if (!g.visible) continue;
    for (const obj of g.children) {
      const home = obj.userData.home as THREE.Vector3 | undefined;
      if (!home) continue;
      _ndc.copy(home).project(cam);
      const [x, y] = keepInCanvas([_ndc.x, _ndc.y], halfNdc);
      if (x === _ndc.x && y === _ndc.y) obj.position.copy(home);
      else obj.position.copy(_ndc.set(x, y, _ndc.z).unproject(cam));
    }
  }
}

function rebuildPalette() {
  palette = readPalette();
  if (cubeRoot) {
    cubeRoot.traverse((obj) => {
      const face = obj.userData.face as CubeFace | undefined;
      if (!face) return;
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = makeFaceTexture(face, palette);
      mat.needsUpdate = true;
    });
  }
  // the letters too: drawn before the bundled face had loaded they kept
  // the fallback font
  arrowRoot?.traverse((obj) => {
    const letter = obj.userData.letter as AxisLetter | undefined;
    if (!letter) return;
    const mat = (obj as THREE.Sprite).material;
    mat.map?.dispose();
    mat.map = letterTexture(letter, AXIS_CSS[AXIS_KEY[letter]]);
    mat.needsUpdate = true;
  });
  if (hitGrid) {
    for (const cell of hitGrid.children) {
      const decals = cell.userData.decals as THREE.Mesh[] | undefined;
      if (!decals) continue;
      for (const d of decals) {
        (d.material as THREE.MeshBasicMaterial).color.set(palette.hover);
      }
    }
  }
}

/** For the viewer spec (ThreeViewer puts it on __viewerDiag): each face's
 *  label and arrow opacity, its displayed border's corners and its arrows'
 *  start, tip and letter projected into the cube canvas (CSS px). The
 *  border is read from the face MESH (its plane's size and the texture's
 *  border), the arrows from the built arrow data — so a test compares two
 *  things that are built apart. */
function diag() {
  if (!cam || !cubeRoot || !arrowRoot || !canvasRef.value) return null;
  const el = canvasRef.value, w = el.clientWidth, h = el.clientHeight;
  cam.updateMatrixWorld();
  const px = (v: THREE.Vector3) => { const p = v.clone().project(cam!); return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h]; };
  const faces = cubeRoot.children.filter(o => o.userData.face).map(o => {
    const f = o.userData.face as CubeFace;
    const mesh = o as THREE.Mesh<THREE.PlaneGeometry>;
    const size = mesh.geometry.parameters.width, half = size / 2 - size * FACE_BORDER_PX / FACE_TEX_PX;
    const corners = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, y]) =>
      px(new THREE.Vector3(x, y, 0).applyMatrix4(mesh.matrixWorld)));
    const g = arrowRoot!.children.find(a => a.userData.face === f)!;
    const sprites = g.children.filter(o => o.userData.home);
    const letterHalf = LETTER_SIZE / 2 * w / ((cam!.right - cam!.left) / cam!.zoom);
    const arrows = (g.userData.arrows as ReturnType<typeof faceArrows>).map(a => ({
      axis: a.axis, start: px(new THREE.Vector3(...a.start)), tip: px(new THREE.Vector3(...a.tip)),
      // where the letter IS drawn (kept inside the canvas), and its half side
      letter: px(sprites.find(o => o.userData.letter === a.axis)!.position), letterHalf,
    }));
    const opacity = g.visible ? (g.userData.materials as THREE.MeshBasicMaterial[])[0]!.opacity : 0;
    return { label: f.label, opacity, border: corners, arrows };
  });
  return { canvas: [w, h], faces };
}
defineExpose({ diag });

let themeObserver: MutationObserver | null = null;
let themeMql: MediaQueryList | null = null;
const onThemeMqlChange = () => rebuildPalette();

onMounted(() => {
  if (!canvasRef.value) return;
  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(CANVAS_PX, CANVAS_PX, false);

  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-0.85, 0.85, 0.85, -0.85, 0.1, 100);

  palette = readPalette();
  cubeRoot = buildCube();
  hitGrid = buildHitGrid();
  cubeRoot.add(hitGrid);
  scene.add(cubeRoot);
  arrowRoot = buildArrows();
  scene.add(arrowRoot);

  themeObserver = new MutationObserver(rebuildPalette);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  themeMql = window.matchMedia("(prefers-color-scheme: dark)");
  themeMql.addEventListener("change", onThemeMqlChange);
  void document.fonts?.load(`bold 51px ${fontSans()}`).then(() => { if (cubeRoot) rebuildPalette(); });

  tick();
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  raf = 0;
  themeObserver?.disconnect();
  themeObserver = null;
  themeMql?.removeEventListener("change", onThemeMqlChange);
  themeMql = null;
  for (const root of [cubeRoot, arrowRoot]) {
    root?.traverse((obj) => {
      const g = (obj as THREE.Mesh).geometry;
      if (g && !(obj instanceof THREE.Sprite)) g.dispose();
      const mat = (obj as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) {
        const mm = mat as THREE.MeshBasicMaterial;
        mm.map?.dispose();
        mat.dispose();
      }
    });
  }
  cubeRoot = null;
  arrowRoot = null;
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
/* --viewcube-size is the one token ThreeViewer's quick grid offsets by;
   CANVAS_PX above is the canvas resolution at that CSS size. */
.viewCube {
  position: absolute;
  z-index: var(--z-raised);
  top: var(--gap-section);
  right: var(--gap-section);
  width: var(--viewcube-size);
  height: var(--viewcube-size);
  cursor: pointer;
}
</style>
