<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { FileEntry, DirectoryListing } from "./lcncApi";
import { usePermissions } from "./permissions";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";

// Shared by Program and Tools. Parents only supply their listing/selection
// operations; navigation, cancellation, file rows and layout stay identical.
const props = defineProps<{
  label: string;
  emptyText: string;
  activeFile?: string | null;
  loadDirectory: (subdir: string, signal: AbortSignal) => Promise<DirectoryListing>;
  selectFile: (entry: FileEntry, signal: AbortSignal) => void | Promise<void>;
}>();
const subdir = defineModel<string>("subdir", { default: "" });
const can = usePermissions();
const files = ref<FileEntry[]>([]);
const directory = ref("");
const browserPath = computed(() =>
  [directory.value.replace(/\/$/, ""), subdir.value].filter(Boolean).join("/") || "/");
const busy = ref(false);
const error = ref("");
const failedDirectory = ref<string | null>(null);
const listRef = ref<HTMLDivElement | null>(null);
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());

async function browse(next = subdir.value) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  failedDirectory.value = null;
  try {
    const data = await props.loadDirectory(next, controller.signal);
    if (controller.signal.aborted) return;
    files.value = data.entries;
    directory.value = data.directory;
    subdir.value = data.subdir;
    if (listRef.value) listRef.value.scrollTop = 0;
  } catch (e) {
    if (controller.signal.aborted) return;
    error.value = e instanceof Error ? e.message : "Could not list files";
    failedDirectory.value = next;
  } finally { busy.value = false; }
}

async function select(entry: FileEntry) {
  if (busy.value || !can.value.setup) return;
  if (entry.type === "directory") return browse(entry.path);
  busy.value = true;
  error.value = "";
  failedDirectory.value = null;
  try {
    await props.selectFile(entry, controller.signal);
  } catch (e) {
    if (!controller.signal.aborted) error.value = e instanceof Error ? e.message : "Could not open file";
  } finally { busy.value = false; }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

onMounted(() => browse());
</script>

<template>
  <Gate gate="setup" class="fileBrowser" role="region" :aria-label="label" :aria-busy="busy">
    <div class="browserHeader">
      <MachineBtn v-if="subdir" type="inline" class="backBtn" aria-label="Parent folder" :disabled="busy"
        @click="browse(subdir.split('/').slice(0, -1).join('/'))">..</MachineBtn>
      <span class="browserPath" :title="browserPath">{{ browserPath }}</span>
    </div>
    <div class="sep"></div>
    <div v-if="error" class="errorBanner row-controls" role="alert">
      <span>{{ error }}</span>
      <MachineBtn v-if="failedDirectory !== null" type="fileOp" :disabled="busy"
        @click="browse(failedDirectory)">Retry</MachineBtn>
    </div>
    <div ref="listRef" class="fileList scroll-thin fade-scroll">
      <button v-for="entry in files" :key="entry.path" type="button" class="fileItem"
        :class="{ directory: entry.type === 'directory', activeItem: entry.type === 'file' && entry.path === activeFile }"
        :disabled="busy" :aria-label="entry.name" :title="entry.name" @click="select(entry)">
        <span class="fileIcon">{{ entry.type === 'directory' ? '/' : '' }}</span>
        <span class="fileEntryName">{{ entry.name }}</span>
        <span v-if="entry.size != null" class="fileSize">{{ formatSize(entry.size) }}</span>
      </button>
      <div v-if="busy" class="emptyBrowser" role="status">Loading…</div>
      <div v-else-if="!files.length && !error" class="emptyBrowser">{{ emptyText }}</div>
    </div>
  </Gate>
</template>

<style scoped>
.fileBrowser {
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: color-mix(in oklab, var(--panel) 70%, transparent);
  /* Fill the available workspace, or share 2:1 with a loaded program's code.
     File count must never collapse the pane. The list owns its scrolling. */
  flex: 2 1 0;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.browserHeader {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  padding: var(--gap-tight) var(--gap-controls);
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
  flex-shrink: 0;
  min-width: 0;
}
.backBtn { font-size: var(--fs-sm); padding: var(--gap-tight) var(--gap-controls); border-radius: var(--radius-md); }
.browserPath { font-size: var(--fs-sm); overflow-wrap: anywhere; min-width: 0; }
.fileList { overflow-y: auto; flex: 1; min-height: 0; }
.fileItem {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  width: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: var(--gap-tight) var(--gap-controls);
  text-align: left;
  font-size: var(--fs-base);
  font-weight: inherit;
}
.fileItem.activeItem { background: color-mix(in oklab, var(--info) 15%, var(--panel)); }
.fileItem.directory .fileEntryName { font-weight: var(--fw-semibold); }
.fileIcon { opacity: var(--opacity-muted); width: 10px; flex-shrink: 0; text-align: center; }
.fileEntryName { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fileSize { font-size: var(--fs-sm); opacity: var(--opacity-muted); flex-shrink: 0; }
.emptyBrowser { padding: var(--gap-section); text-align: center; font-size: var(--fs-base); opacity: var(--opacity-muted); }
.errorBanner { padding: var(--gap-tight) var(--gap-controls); color: var(--danger); font-size: var(--fs-base); flex-shrink: 0; }
.errorBanner span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
</style>
