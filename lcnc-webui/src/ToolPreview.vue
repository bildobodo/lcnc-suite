<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, toRefs } from "vue";
import * as THREE from "three";
import { buildToolGeometries, buildHolderGeometry, type ToolMeta } from "./toolGeometry";
import { nominalHolderBase } from "./toolHolder";

const props = withDefaults(
  defineProps<{
    diameter: number;
    length: number;
    meta?: ToolMeta | null;
    unitsPerMm?: number;
    showNominalHolder?: boolean;
    width?: number;
    height?: number;
  }>(),
  { width: 80, height: 120, unitsPerMm: 1 }
);

const { diameter, length, meta, width, height, unitsPerMm, showNominalHolder } = toRefs(props);

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

  const { cutter, shaft } = buildToolGeometries(diameter.value, length.value, meta.value ?? null, unitsPerMm.value);

  if (cutter) {
    group.add(new THREE.Mesh(cutter, new THREE.MeshStandardMaterial({
      color: cutterColor, metalness: 0.1, roughness: 0.5,
    })));
  }
  if (shaft) {
    group.add(new THREE.Mesh(shaft, new THREE.MeshStandardMaterial({
      color: shaftColor, metalness: 0.1, roughness: 0.5,
    })));
  }
  const holderBase = nominalHolderBase(meta.value);
  if (showNominalHolder.value && holderBase !== null) {
    const holder = buildHolderGeometry(meta.value!.holder_segments!, holderBase);
    if (holder) group.add(new THREE.Mesh(holder, new THREE.MeshStandardMaterial({
      color: 0x888888, metalness: 0.7, roughness: 0.3,
    })));
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
  [diameter, length, meta, width, height, unitsPerMm, showNominalHolder],
  () => {
    buildPreview();
  },
  { deep: true }
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
