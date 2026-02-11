<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

// Adjust path as needed
import { viewerInit, viewerGcode, status } from "./lcncWs";

type Vec3 = [number, number, number];

type ViewerInit = {
  units?: "mm" | "inch" | string;
  stl_base_url: string;
  parts: Array<{
    id: string;
    file: string;
    parent: string | null; // "x" | "y" | "z" | null
    t?: Vec3;              // static translation
    r?: Vec3;              // optional static rotation
  }>;
  kinematics: {
    x: { axis: number; sign: number };
    y: { axis: number; sign: number };
    z: { axis: number; sign: number };
  };
};

type Vec3N = [number, number, number];

type ViewPreset = "top" | "left" | "right" | "front" | "back" | "iso" | "dimetric" | "reset";
type Layer = "backplot" | "toolpath" | "machine" | "workpiece" | "bounds" | "tool" | "workzero" | "hud";


type ViewerState = {
  ts?: number;

  machine_pos?: number[];
  joint_pos?: number[];
  tool_offset?: number[];

  g5x_offset?: number[];
  g92_offset?: number[];

  active_file?: string;
  motion_line?: number;

  tool_number?: number | null;
  tool_diameter?: number | null;
  tool_length?: number | null;

  work_pos?: Vec3N; // <-- stricter

  current_vel?: number | null;
  spindle_speed?: number | null;
  spindle_direction?: number | null;
};



type ViewerGcode = {
  file?: string;
  feed?: number[][];
  feed_lines?: number[];     // parallel: g-code line number per feed point
  rapid?: number[][];
};

type ColorDefaults = {
  feed: string;
  rapid: string;
  backplot: string;
  bounds: string;
  workpiece: string;
  tool: string;
};

type OpacityDefaults = {
  workpiece: number;
  bounds: number;
  machine: number;
  toolpath: number;
  backplot: number;
  hud: number;
};

const props = defineProps<{
  workpieceSize: Vec3;
  workpieceOffset: Vec3;
  colors?: ColorDefaults;
  opacities?: OpacityDefaults;
  g5xLabel?: string;
  linearUnit?: string;
  active?: boolean;
}>();

// HUD data (read from status for template)
const vst = computed(() => status.value?.data ?? null);

// ---------- DOM ----------
const host = ref<HTMLDivElement | null>(null);
const hudVisible = ref(true);

// ---------- Three globals ----------
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let raf = 0;

// Transform groups (logical)
const groups: Record<string, THREE.Group> = {};
let workOrigin: THREE.Group | null = null;

// Visual objects
let toolMarker: THREE.Object3D | null = null;
let feedLine: THREE.Line | null = null;
let rapidLine: THREE.Line | null = null;
let highlightLine: THREE.Line | null = null;
let highlightMarker: THREE.Mesh | null = null;
let workAxes: THREE.AxesHelper | null = null;

// Map g-code line number → { start, end } point-index range in feed arrays
let feedPtsCache: number[][] = [];
let feedLineMap: Map<number, { start: number; end: number }> = new Map();

// Pending layer visibility: stores calls made before scene objects exist
let pendingLayers: Map<Layer, boolean> | null = new Map();
let toolpathVisible = true;

// ---- Backplot (live toolpath history) ----
let backplotLine: THREE.Line | null = null;
let backplotGeom: THREE.BufferGeometry | null = null;
let backplotPos: Float32Array | null = null;
let backplotCount = 0;
const BACKPLOT_MAX = 20000;   // points (10 Hz -> ~33 min)
const BACKPLOT_EPS = 0.01;    // mm; min distance before adding a point
let lastBackplotPt: THREE.Vector3 | null = null;
let lastBackplotFile: string | null = null;
let lastBackplotMotionLine: number | null = null;

let machineBoundsMesh: THREE.Mesh | null = null;
let workpieceMesh: THREE.Mesh | null = null;
let machineMeshes: THREE.Mesh[] = [];

function resetBackplot() {
  backplotCount = 0;
  lastBackplotPt = null;

  if (backplotGeom && backplotPos) {
    // Keep allocation, just “empty” it
    backplotGeom.setDrawRange(0, 0);
    backplotGeom.attributes.position.needsUpdate = true;
  }
}

function setView(p: ViewPreset) {
  if (!camera || !controls) return;

  if (p === "reset") {
    if (!groups?.root) return;
    const box = new THREE.Box3().setFromObject(groups.root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    controls.target.copy(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(center.x + maxDim, center.y - maxDim, center.z + maxDim * 0.8);
    camera.near = Math.max(0.1, maxDim / 1000);
    camera.far = Math.max(200000, maxDim * 20);
    camera.up.set(0, 0, 1);
    camera.updateProjectionMatrix();
    controls.update();
    return;
  }

  const target = controls.target;
  const dist = camera.position.distanceTo(target);

  const dir = new THREE.Vector3();
  let up: [number, number, number] = [0, 0, 1];

  switch (p) {
    case "top":      dir.set(0, 0, 1);     up = [0, 1, 0]; break;
    case "front":    dir.set(1, 0, 0);     break;
    case "back":     dir.set(-1, 0, 0);    break;
    case "left":     dir.set(0, -1, 0);    break;
    case "right":    dir.set(0, 1, 0);     break;
    case "iso":      dir.set(1, -1, 0.8);  break;
    case "dimetric": dir.set(0.7, -0.7, 1); break;
  }

  dir.normalize().multiplyScalar(dist);
  camera.position.copy(target).add(dir);
  camera.up.set(...up);

  camera.updateProjectionMatrix();
  controls.update();
}

function setLayerVisible(layer: Layer, on: boolean) {
  if (pendingLayers) {
    pendingLayers.set(layer, on);
  }
  switch (layer) {
    case "backplot":
      if (backplotLine) backplotLine.visible = on;
      break;
    case "toolpath":
      toolpathVisible = on;
      if (feedLine) feedLine.visible = on;
      if (rapidLine) rapidLine.visible = on;
      if (highlightLine) highlightLine.visible = on;
      if (highlightMarker) highlightMarker.visible = on;
      break;
    case "machine":
      for (const m of machineMeshes) m.visible = on;
      break;
    case "workpiece":
      if (workpieceMesh) workpieceMesh.visible = on;
      break;
    case "bounds":
      if (machineBoundsMesh) machineBoundsMesh.visible = on;
      break;
    case "tool":
      if (toolMarker) toolMarker.visible = on;
      break;
    case "workzero":
      if (workAxes) workAxes.visible = on;
      break;
    case "hud":
      hudVisible.value = on;
      break;
  }
}

function pushBackplotPoint(p: [number, number, number]) {
  if (!backplotGeom || !backplotPos || !backplotLine) return;


  const x = p[0] ?? 0;
  const y = p[1] ?? 0;
  const z = p[2] ?? 0;

  const v = new THREE.Vector3(x, y, z);

  if (lastBackplotPt) {
    if (v.distanceTo(lastBackplotPt) < BACKPLOT_EPS) return;
  }

  // Ensure objects exist (created in ensureCoreGroups)
  if (!backplotGeom || !backplotPos || !backplotLine) return;

  // If full, shift left by one (simple & robust)
  if (backplotCount >= BACKPLOT_MAX) {
    backplotPos.copyWithin(0, 3, BACKPLOT_MAX * 3);
    backplotCount = BACKPLOT_MAX - 1;
  }

  const i = backplotCount * 3;
  backplotPos[i + 0] = v.x;
  backplotPos[i + 1] = v.y;
  backplotPos[i + 2] = v.z;

  backplotCount++;
  lastBackplotPt = v;

  backplotGeom.setDrawRange(0, backplotCount);
  backplotGeom.attributes.position.needsUpdate = true;
}



// Used to ignore late async loads after rebuild
let buildToken = 0;

// ---------- Materials (muted colors requested) ----------
const MAT = {
  tool: new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.4 }),
  frame: new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.8 }),
  axisX: new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.7 }),
  axisY: new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.7 }),
  axisZ: new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.7 }),
};

// light gray frame
MAT.frame.color.setHex(0xbfbfbf);
// muted red/green/blue axes
MAT.axisX.color.setHex(0x9b4a4a); // X muted red
MAT.axisY.color.setHex(0x4a8f5a); // Y muted green
MAT.axisZ.color.setHex(0x4a6f9b); // Z muted blue
MAT.tool.color.setHex(0xf5f5f5);  // near-white tool

/** Apply machine STL opacity to all MAT materials */
function applyMachineOpacity(op: number) {
  for (const mat of [MAT.frame, MAT.axisX, MAT.axisY, MAT.axisZ]) {
    mat.transparent = op < 1;
    mat.opacity = op;
    mat.depthWrite = op >= 1;
    mat.needsUpdate = true;
  }
}

// ---------- helpers ----------
function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child: any) => {
    if (child.geometry) child.geometry.dispose?.();
    // IMPORTANT: don’t dispose shared MAT.* materials
    // so we intentionally skip disposing child.material here.
  });
}

function clearScene() {
  if (!scene) return;
  while (scene.children.length) {
    const c = scene.children.pop()!;
    disposeObject(c);
  }
}

function applyBox(mesh: THREE.Mesh, size: Vec3, origin: Vec3) {
  const [sx, sy, sz] = size;
  const [ox, oy, oz] = origin;

  mesh.scale.set(Math.max(0.001, sx), Math.max(0.001, sy), Math.max(0.001, sz));
  mesh.position.set(ox + sx / 2, oy + sy / 2, oz + sz / 2);
}

function makeLine(points: number[][], colorHex: number | string, dashed = false, opacity = 1.0) {
  const geom = new THREE.BufferGeometry();
  const flat = new Float32Array(points.flat());
  geom.setAttribute("position", new THREE.BufferAttribute(flat, 3));

  // Important: stable bounds so Three doesn't cull it incorrectly
  geom.computeBoundingSphere();

  let mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial;

  if (dashed) {
    mat = new THREE.LineDashedMaterial({
      color: colorHex,
      dashSize: 10,
      gapSize: 6,
      transparent: opacity < 1,
      opacity,
    });
    mat.depthTest = true;
    mat.depthWrite = opacity >= 1;
  } else {
    mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: opacity < 1, opacity });
    mat.depthTest = false;
    mat.depthWrite = false;
  }

  const line = new THREE.Line(geom, mat);
  line.renderOrder = 10;

  // Important: prevent disappearing when workOrigin shifts / bounds get odd
  line.frustumCulled = false;

  if (dashed) (line as any).computeLineDistances?.();
  return line;
}


/**
 * Robust STL fetch + parse
 * - avoids CORS surprises (already fixed on your backend)
 * - avoids binary header trash on HTML/spa responses
 */
async function loadStl(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const head200 = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 200)).toLowerCase();

  // reject HTML
  if (head200.includes("<!doctype") || head200.includes("<html")) {
    throw new Error(`Not an STL (got HTML) from ${url}`);
  }

  const loader = new STLLoader();

  const looksAscii = head200.startsWith("solid") && head200.includes("facet");
  if (looksAscii) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return loader.parse(text);
  }

  // binary sanity check
  if (buf.byteLength >= 84) {
    const dv = new DataView(buf);
    const triCount = dv.getUint32(80, true);
    const expected = 84 + triCount * 50;

    if (expected <= buf.byteLength && triCount < 50_000_000) {
      return loader.parse(buf);
    }

    // fallback: try ASCII
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return loader.parse(text);
  }

  throw new Error(`STL too small / invalid: ${url}`);
}

function ensureCoreGroups() {
  if (!scene) return;

  // reset pointers
  workOrigin = null;
  workAxes = null;
  machineBoundsMesh = null;
  workpieceMesh = null;
  machineMeshes = [];

  groups.root = new THREE.Group();
  groups.x = new THREE.Group();
  groups.y = new THREE.Group();
  groups.z = new THREE.Group();
  groups.tool = new THREE.Group();
 
  scene.add(groups.root);

  // ✅ Your topology:
  // root → x
  // root → y
  // y → z
  // z → tool
  groups.root.add(groups.x);
  groups.root.add(groups.y);
  groups.y.add(groups.z);
  groups.z.add(groups.tool);

  // Work origin (DRO zero frame) — must sit on X like your vismach toolpath/work_cs
  workOrigin = new THREE.Group();
  groups.x.add(workOrigin);

  // Work/DRO axes helper (the one you kept)
  workAxes = new THREE.AxesHelper(120);
  workOrigin.add(workAxes);

  // ---- Backplot line (tool history in WORK coordinates) ----
{
  backplotGeom = new THREE.BufferGeometry();
  backplotPos = new Float32Array(BACKPLOT_MAX * 3);
  backplotGeom.setAttribute("position", new THREE.BufferAttribute(backplotPos, 3));
  backplotGeom.setDrawRange(0, 0);

  const bpColor = props.colors?.backplot ?? "#ff00ff";
  const bpOpacity = props.opacities?.backplot ?? 0.55;
  const mat = new THREE.LineBasicMaterial({
    color: bpColor,
    transparent: true,
    opacity: bpOpacity,
    depthTest: false,
    depthWrite: false,
  });

  backplotLine = new THREE.Line(backplotGeom, mat);
  backplotLine.renderOrder = 10;
  backplotLine.frustumCulled = false;   // ✅ prevents disappearing when origin is off-screen
  groups.x.add(backplotLine);

resetBackplot();


}


  // Tool marker (TIP pinned at local origin, extends +Z into holder)
  function makeToolMesh(diam: number, len: number) {
    const r = Math.max(0.2, diam * 0.5);
    const L = Math.max(5, len);

    const g = new THREE.CylinderGeometry(r, r, L, 20);

    // CylinderGeometry is Y-up by default.
    // Rotate geometry to Z-up and translate so tip is at Z=0.
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, L / 2);

    return new THREE.Mesh(g, MAT.tool);
  }

  // Default until viewer_state arrives
  toolMarker = makeToolMesh(6, 60);
  groups.tool.add(toolMarker);



  // --- Machine bounds box (also sits on X, like your vismach limits_vis) ---
  {
    const boundsColor = props.colors?.bounds ?? "#ffffff";
    const boundsOp = props.opacities?.bounds ?? 0.10;
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: boundsColor,
      transparent: true,
      opacity: boundsOp,
      depthWrite: false,
    });
    machineBoundsMesh = new THREE.Mesh(geom, mat);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geom),
      new THREE.LineBasicMaterial({ color: boundsColor, transparent: true, opacity: Math.min(1, boundsOp * 2.5) })
    );
    machineBoundsMesh.add(edges);

    groups.x.add(machineBoundsMesh);
  }

  // --- Workpiece box (in work coordinates, relative to DRO zero, and sits on X via workOrigin) ---
  {
    const wpColor = props.colors?.workpiece ?? "#ffffff";
    const wpOp = props.opacities?.workpiece ?? 0.16;
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: wpColor,
      transparent: true,
      opacity: wpOp,
      depthWrite: false,
    });
    workpieceMesh = new THREE.Mesh(geom, mat);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geom),
      new THREE.LineBasicMaterial({ color: wpColor, transparent: true, opacity: Math.min(1, wpOp * 2.2) })
    );
    workpieceMesh.add(edges);

    workOrigin.add(workpieceMesh);
    applyBox(workpieceMesh, props.workpieceSize, props.workpieceOffset);
  }

  // Apply machine STL opacity
  applyMachineOpacity(props.opacities?.machine ?? 1.0);

  // Apply tool color
  MAT.tool.color.set(props.colors?.tool ?? "#ffdd00");
}

function sceneBgFromTheme(): THREE.Color {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  return new THREE.Color(bg);
}

async function buildFromInit(init: ViewerInit) {
  if (!scene) return;

  buildToken++;
  const myToken = buildToken;

  clearScene();

  scene.background = sceneBgFromTheme();

  // lights (no grid)
  scene.add(new THREE.AmbientLight());

  const dl = new THREE.DirectionalLight();
  dl.position.set(800, -800, 1200);
  scene.add(dl);

  ensureCoreGroups();
  // Apply machine bounds from viewer_init (INI-derived)
  const mb = (init as any).machine_bounds;
  if (machineBoundsMesh && mb?.size && mb?.origin) {
    applyBox(machineBoundsMesh, mb.size as Vec3, mb.origin as Vec3);
  } else {
    console.warn("No machine_bounds in viewer_init; bounds box will remain default");
  }


  const base = init.stl_base_url;
  const parts = init.parts ?? [];

  // Load STLs
  for (const p of parts) {
    if (myToken !== buildToken) return;

    const url = base.endsWith("/") ? `${base}${p.file}` : `${base}/${p.file}`;

    try {
      const geom = await loadStl(url);
      geom.computeVertexNormals();

      // choose material by parent group
      let mat = MAT.frame;
      if (p.parent === "x") mat = MAT.axisX;
      else if (p.parent === "y") mat = MAT.axisY;
      else if (p.parent === "z") mat = MAT.axisZ;

      const mesh = new THREE.Mesh(geom, mat);

      if (p.t) mesh.position.set(p.t[0], p.t[1], p.t[2]);
      if (p.r) mesh.rotation.set(p.r[0], p.r[1], p.r[2]);

      const parent = (p.parent ? groups[p.parent] : groups.root) ?? groups.root;
      parent.add(mesh);
      machineMeshes.push(mesh);
    } catch (e) {
      console.error("Failed STL:", p.id, url, e);
    }
  }

  // Auto-frame camera to model (makes it impossible to “miss” the machine)
  if (camera && controls) {
    const box = new THREE.Box3().setFromObject(groups.root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    controls.target.copy(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(center.x + maxDim, center.y - maxDim, center.z + maxDim * 0.8);
    camera.near = Math.max(0.1, maxDim / 1000);
    camera.far = Math.max(200000, maxDim * 20);
    camera.updateProjectionMatrix();
    controls.update();
  }

  // Apply any layer visibility that was requested before objects existed
  if (pendingLayers) {
    for (const [layer, on] of pendingLayers) {
      setLayerVisible(layer, on);
    }
    pendingLayers = null;
  }
}

function applyState(init: ViewerInit, st: ViewerState) {
  // Drive machine axes from JOINT positions (spindle nose / carriage reference)
  const jp = st.joint_pos;
  if (!jp) return;

  if (!groups.x || !groups.y || !groups.z || !groups.tool) return;

  const kin = init.kinematics;
  const ax = (idx: number) => (idx >= 0 && idx < jp.length ? jp[idx] : 0);

  // Apply to your group topology (machine model motion)
  groups.x.position.x = ax(kin.x.axis) * (kin.x.sign ?? 1);
  groups.y.position.y = ax(kin.y.axis) * (kin.y.sign ?? 1);
  groups.z.position.z = ax(kin.z.axis) * (kin.z.sign ?? 1);

  // Tool spatial compensation:
  // Put the tool TIP at TCP by moving the tool group by -tool_offset relative to spindle nose.
  const tofs = st.tool_offset;
  if (tofs && tofs.length >= 3) {
    groups.tool.position.set(-(tofs[0] ?? 0), -(tofs[1] ?? 0), -(tofs[2] ?? 0));
  } else {
    groups.tool.position.set(0, 0, 0);
  }

  // Work origin offset: place DRO/work zero in machine space.
  // workOrigin is parented under X, matching your vismach structure.
  const g5x = st.g5x_offset ?? [];
  const g92 = st.g92_offset ?? [];

  const ox = (g5x[0] ?? 0) + (g92[0] ?? 0);
  const oy = (g5x[1] ?? 0) + (g92[1] ?? 0);
  const oz = (g5x[2] ?? 0) + (g92[2] ?? 0);

  if (workOrigin) workOrigin.position.set(ox, oy, oz);

  // ---- Tool visual: diameter + length (TIP stays at local z=0) ----
  if (toolMarker && (toolMarker as any).geometry) {
    const diam = st.tool_diameter ?? 6.0;
    const rawLen = st.tool_length ?? 60.0;

    const sinkIntoHolder = 20;  // mm visual “embed”
    const minVisualLen = 40;    // mm minimum so short tools don’t float
    const visLen = Math.max(minVisualLen, rawLen + sinkIntoHolder);

    const r = Math.max(0.2, diam * 0.5);

    const mesh = toolMarker as THREE.Mesh;

    // Only rebuild if it meaningfully changed (prevents churn)
    const prev = (mesh.userData.toolVis as any) || {};
    const changed = Math.abs((prev.r ?? 0) - r) > 0.01 || Math.abs((prev.L ?? 0) - visLen) > 0.5;

    if (changed) {
      mesh.geometry.dispose();

      const g = new THREE.CylinderGeometry(r, r, visLen, 20);
      g.rotateX(Math.PI / 2);      // axis -> Z
      g.translate(0, 0, visLen / 2); // tip at z=0

      mesh.geometry = g;
      mesh.userData.toolVis = { r, L: visLen };
    }
  }
    if (toolMarker) {
    toolMarker.visible = true;
  }


  
  // ---- Backplot update (use WORK tool-tip position directly) ----
  const curFile = st.active_file ?? null;
  const curLine = typeof st.motion_line === "number" ? st.motion_line : null;

  lastBackplotFile = curFile;
  lastBackplotMotionLine = curLine;

  // Append the actual rendered tool tip position, expressed in groups.x local space.
  // This guarantees the backplot starts exactly at the tooltip (independent of joint_pos vs machine_pos nuances).
  if (toolMarker && groups.x) {
    const w = new THREE.Vector3();
    toolMarker.getWorldPosition(w);

    const xl = groups.x.worldToLocal(w.clone());
    pushBackplotPoint([xl.x, xl.y, xl.z]);
  }

  // ---- Highlight current motion line in toolpath ----
  if (highlightLine && curLine != null) {
    const range = feedLineMap.get(curLine);
    if (range) {
      const s = Math.max(0, range.start - 1);
      highlightLine.geometry.setDrawRange(s, range.end - s + 1);
      // Position marker sphere at the endpoint of the current segment
      if (highlightMarker && feedPtsCache[range.end]) {
        const p = feedPtsCache[range.end];
        highlightMarker.position.set(p[0], p[1], p[2]);
        highlightMarker.visible = toolpathVisible;
      }
    } else {
      highlightLine.geometry.setDrawRange(0, 0);
      if (highlightMarker) highlightMarker.visible = false;
    }
  } else {
    if (highlightLine) highlightLine.geometry.setDrawRange(0, 0);
    if (highlightMarker) highlightMarker.visible = false;
  }
}



function applyGcode(g: ViewerGcode) {
  if (!scene || !workOrigin) return;

  // Remove old lines
  if (feedLine) {
    workOrigin.remove(feedLine);
    disposeObject(feedLine);
    feedLine = null;
  }
  if (rapidLine) {
    workOrigin.remove(rapidLine);
    disposeObject(rapidLine);
    rapidLine = null;
  }
  if (highlightLine) {
    workOrigin.remove(highlightLine);
    disposeObject(highlightLine);
    highlightLine = null;
  }
  if (highlightMarker) {
    workOrigin.remove(highlightMarker);
    disposeObject(highlightMarker);
    highlightMarker = null;
  }
  feedPtsCache = [];
  feedLineMap = new Map();

  const feedPts = g.feed ?? [];
  const feedLines = g.feed_lines ?? [];
  const rapidPts = g.rapid ?? [];

  // Build line-number → point-index range map
  for (let i = 0; i < feedLines.length; i++) {
    const ln = feedLines[i];
    const entry = feedLineMap.get(ln);
    if (entry) {
      entry.end = i;
    } else {
      feedLineMap.set(ln, { start: i, end: i });
    }
  }

  // Feed + Rapid toolpath lines (colors + opacity from props or defaults)
  const feedColor = props.colors?.feed ?? "#22b8cf";
  const rapidColor = props.colors?.rapid ?? "#f5a623";
  const toolpathOp = props.opacities?.toolpath ?? 1.0;
  if (feedPts.length >= 2) {
    feedLine = makeLine(feedPts, feedColor, false, toolpathOp);
    workOrigin.add(feedLine);
  }
  if (rapidPts.length >= 2) {
    rapidLine = makeLine(rapidPts, rapidColor, true, toolpathOp);
    workOrigin.add(rapidLine);
  }

  // Prepare highlight line (reuses feed geometry, drawn on top with bright color)
  feedPtsCache = feedPts;
  if (feedPts.length >= 2) {
    const hlGeom = new THREE.BufferGeometry();
    const flat = new Float32Array(feedPts.flat());
    hlGeom.setAttribute("position", new THREE.BufferAttribute(flat, 3));
    hlGeom.setDrawRange(0, 0); // hidden until motion_line updates
    const hlMat = new THREE.LineBasicMaterial({ color: 0xff3333 });
    hlMat.depthTest = false;
    hlMat.depthWrite = false;
    highlightLine = new THREE.Line(hlGeom, hlMat);
    highlightLine.renderOrder = 11;
    highlightLine.frustumCulled = false;
    workOrigin.add(highlightLine);

    // Bright sphere marker at current segment endpoint
    const markerGeom = new THREE.SphereGeometry(1.5, 8, 8);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
    markerMat.depthTest = false;
    highlightMarker = new THREE.Mesh(markerGeom, markerMat);
    highlightMarker.renderOrder = 12;
    highlightMarker.visible = false;
    workOrigin.add(highlightMarker);
  }
}

// ---------- lifecycle ----------
let resizeObs: ResizeObserver | null = null;

function resize() {
  if (!renderer || !camera || !host.value) return;
  const w = host.value.clientWidth;
  const h = host.value.clientHeight;
  if (w === 0 || h === 0) return; // hidden (v-show)
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

let pendingState: any = null;

function animate() {
  if (props.active === false) return; // paused — don't schedule next frame
  raf = requestAnimationFrame(animate);

  // Apply pending state before render (natural frame dropping —
  // if multiple status updates arrive between frames, only the latest is used)
  if (pendingState && viewerInit.value) {
    applyState(viewerInit.value as ViewerInit, pendingState as ViewerState);
    pendingState = null;
  }

  controls?.update();
  renderer?.render(scene!, camera!);
}

const themeMql = window.matchMedia('(prefers-color-scheme: dark)');
function onThemeChange() {
  if (scene) scene.background = sceneBgFromTheme();
}

onMounted(() => {
  scene = new THREE.Scene();
  scene.background = sceneBgFromTheme();

  camera = new THREE.PerspectiveCamera(45, 1, 1, 20000);
  camera.up.set(0, 0, 1); // Z-up
  camera.position.set(1200, -1200, 800);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  if (host.value) {
    host.value.appendChild(renderer.domElement);
  }

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.target.set(0, 0, 0);

  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.8;

  controls.enablePan = true;
  controls.screenSpacePanning = true;

  themeMql.addEventListener('change', onThemeChange);

  resizeObs = new ResizeObserver(() => resize());
  resizeObs.observe(host.value!);

  resize();
  animate();

  // Initialize from existing data (for dynamically added viewers where
  // viewerInit/viewerGcode were already set before this component mounted)
  if (viewerInit.value) buildFromInit(viewerInit.value as ViewerInit);
  if (viewerGcode.value) applyGcode(viewerGcode.value as ViewerGcode);
});

onUnmounted(() => {
  themeMql.removeEventListener('change', onThemeChange);
  resizeObs?.disconnect();
  resizeObs = null;
  cancelAnimationFrame(raf);

  controls?.dispose();

  if (renderer) {
    renderer.dispose();
    if (renderer.domElement.parentElement) {
      renderer.domElement.parentElement.removeChild(renderer.domElement);
    }
  }

  if (scene) clearScene();

  renderer = null;
  scene = null;
  camera = null;
  controls = null;
});

// ---------- reactive wiring ----------

// Rebuild when init arrives
watch(
  () => viewerInit.value as ViewerInit | null,
  (init) => {
    if (init) buildFromInit(init);
  },
  { immediate: true }
);

// Pause/resume RAF loop when active prop changes
watch(() => props.active, (now) => {
  if (now !== false && renderer) {
    resize();
    animate();
  } else {
    cancelAnimationFrame(raf);
  }
});

// Buffer latest status for rAF consumption (frame dropping)
watch(
  () => status.value,
  (msg) => {
    if (props.active === false) return; // skip when hidden
    if (msg?.data) pendingState = msg.data;
  },
);

// Apply gcode preview when it arrives
watch(
  () => viewerGcode.value as ViewerGcode | null,
  (g) => {
    if (g) applyGcode(g);
  },
);


// Update workpiece live from UI
watch(
  () => [props.workpieceSize, props.workpieceOffset] as const,
  () => {
    if (workpieceMesh) applyBox(workpieceMesh, props.workpieceSize, props.workpieceOffset);
  },
  { deep: true }
);


// Format coordinate for HUD display
function formatCoord(val: number | null | undefined): string {
  if (val == null) return '---';
  return val.toFixed(3);
}

defineExpose({
  resetBackplot,
  setView,
  setLayerVisible,
});


</script>

<template>
  <div class="viewerWrapper">
    <div ref="host" class="viewerHost" />

    <!-- HUD Overlay -->
    <div v-show="hudVisible" class="hud" :style="{ opacity: props.opacities?.hud ?? 1 }">
      <div class="hudSection">
        <div class="hudLabel">Machine Position</div>
        <div class="hudValue">
          X: {{ formatCoord(vst?.machine_pos?.[0]) }}
          Y: {{ formatCoord(vst?.machine_pos?.[1]) }}
          Z: {{ formatCoord(vst?.machine_pos?.[2]) }}
        </div>
      </div>

      <div class="hudSection">
        <div class="hudLabel">Work Position ({{ props.g5xLabel || '-' }})</div>
        <div class="hudValue">
          X: {{ formatCoord(vst?.work_pos?.[0]) }}
          Y: {{ formatCoord(vst?.work_pos?.[1]) }}
          Z: {{ formatCoord(vst?.work_pos?.[2]) }}
        </div>
      </div>

      <div class="hudSection">
        <div class="hudLabel">Tool</div>
        <div class="hudValue">
          T{{ vst?.tool_number ?? '-' }}
          Ø{{ formatCoord(vst?.tool_diameter) }} {{ props.linearUnit || 'mm' }}
          L{{ formatCoord(vst?.tool_length) }} {{ props.linearUnit || 'mm' }}
        </div>
      </div>

      <div class="hudSection">
        <div class="hudLabel">Feed</div>
        <div class="hudValue">{{ vst?.current_vel != null ? (vst.current_vel * 60).toFixed(1) : '---' }} {{ props.linearUnit || 'mm' }}/min</div>
      </div>

      <div class="hudSection">
        <div class="hudLabel">Spindle</div>
        <div class="hudValue">{{ formatCoord(vst?.spindle_speed_actual) }} RPM</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.viewerWrapper {
  position: relative;
  width: 100%;
  height: 650px;
}

.viewerHost {
  width: 100%;
  height: 100%;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: color-mix(in oklab, var(--panel) 70%, transparent);
}

.hud {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  user-select: none;
}

.hudSection {
  background: color-mix(in oklab, #000 75%, transparent);
  backdrop-filter: blur(8px);
  border: 1px solid color-mix(in oklab, #fff 15%, transparent);
  border-radius: 8px;
  padding: 8px 12px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.4;
}

.hudLabel {
  color: color-mix(in oklab, #fff 60%, transparent);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.hudValue {
  color: #00ff88;
  font-weight: 500;
  white-space: nowrap;
}
</style>

