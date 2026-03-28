<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, toRefs } from "vue";
import * as THREE from "three";
import { buildToolProfile, splitProfileAt, buildToolGeometry, type ToolMeta } from "./toolGeometry";

const props = withDefaults(
  defineProps<{
    diameter: number;
    length: number;
    fluteLength: number;
    shaftDiameter?: number;
    toolType?: string;
    cornerRadius?: number;
    taperAngle?: number;
    pointAngle?: number;
    tipDiameter?: number;
    bodyLength?: number;
    width?: number;
    height?: number;
  }>(),
  { width: 80, height: 120 }
);

const { diameter, length, fluteLength, shaftDiameter, toolType,
        cornerRadius, taperAngle, pointAngle, tipDiameter, bodyLength,
        width, height } = toRefs(props);

const container = ref<HTMLDivElement | null>(null);

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.OrthographicCamera | null = null;
let currentGroup: THREE.Group | null = null;

const cutterColor = new THREE.Color(0xffdd00);
const shaftColor = new THREE.Color(0xc0c0c0);

function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  camera.up.set(0, 0, 1);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(100, 0, 25);
  scene.add(dirLight);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(props.width, props.height);
  container.value?.appendChild(renderer.domElement);
}

function clearMesh() {
  if (!currentGroup || !scene) return;
  currentGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
  scene.remove(currentGroup);
  currentGroup = null;
}

function fitCamera(group: THREE.Group) {
  if (!camera) return;
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const aspect = props.width / props.height;
  const pad = 1.15;
  const worldW = (size.y || 1) * pad;
  const worldH = (size.z || 1) * pad;
  let halfW: number, halfH: number;
  if (worldW / worldH > aspect) {
    halfW = worldW / 2;
    halfH = halfW / aspect;
  } else {
    halfH = worldH / 2;
    halfW = halfH * aspect;
  }
  camera.left = -halfW;
  camera.right = halfW;
  camera.bottom = -halfH;
  camera.top = halfH;
  camera.position.set(center.x + 100, center.y, center.z);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

function buildPreview() {
  if (!scene || !camera || !renderer) return;
  clearMesh();

  const group = new THREE.Group();

  const meta: ToolMeta = {
    type: toolType?.value ?? "other",
    oal: length.value,
    flute_length: fluteLength.value,
    body_length: bodyLength?.value ?? undefined,
    shaft_diameter: shaftDiameter?.value ?? undefined,
    corner_radius: cornerRadius?.value ?? undefined,
    taper_angle: taperAngle?.value ?? undefined,
    point_angle: pointAngle?.value ?? undefined,
    tip_diameter: tipDiameter?.value ?? undefined,
  };

  const { pts, fluteY } = buildToolProfile(diameter.value, length.value, meta);
  const { cutter, shaft } = splitProfileAt(pts, fluteY);

  const cutterMat = new THREE.MeshStandardMaterial({
    color: cutterColor, metalness: 0.1, roughness: 0.5,
  });
  const shaftMat = new THREE.MeshStandardMaterial({
    color: shaftColor, metalness: 0.1, roughness: 0.5,
  });

  if (cutter.length >= 3) {
    group.add(new THREE.Mesh(buildToolGeometry(cutter), cutterMat));
  }
  if (shaft.length >= 3) {
    group.add(new THREE.Mesh(buildToolGeometry(shaft), shaftMat));
  }

  scene.add(group);
  currentGroup = group;
  fitCamera(group);

  renderer.setSize(width.value, height.value);
  renderer.render(scene, camera);
}

function dispose() {
  clearMesh();
  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
    renderer = null;
  }
  scene = null;
  camera = null;
}

onMounted(() => {
  initScene();
  buildPreview();
});

onBeforeUnmount(dispose);

watch(
  [diameter, length, fluteLength, shaftDiameter, toolType,
   cornerRadius, taperAngle, pointAngle, tipDiameter, bodyLength,
   width, height],
  () => {
    buildPreview();
  }
);
</script>

<template>
  <div ref="container" class="toolPreview"></div>
</template>

<style scoped>
.toolPreview {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
