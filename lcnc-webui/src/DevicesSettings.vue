<script setup lang="ts">
// Settings › Devices (settings split, operator 2026-11-07, plan Codex
// R335–R337). Every browser profile is a DEVICE with its own look, macro
// bar and simulation switch, kept on the gateway. This tab names THIS
// device, switches its simulation and resets it to the template — no arm —
// and lists the other devices of this machine configuration: their state,
// their simulation (switched from here only armed), rename, reset and the
// delete (armed, never while that device is connected; nothing removes a
// profile on its own — R337).
import { computed, onMounted, ref, watch } from "vue";
import { Pencil, RotateCcw, Trash2 } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import FormField from "./FormField.vue";
import DialogFrame from "./DialogFrame.vue";
import Gate from "./Gate.vue";
import {
  deviceInfo, devicesVersion, loadSimulationDefaults, loadSimulationDraft, saveSimulationDefaults,
  settingsVersion,
} from "./defaults";
import { deviceStorage } from "./deviceToken";
import { fetchDevices, type DeviceRow } from "./lcncApi";
import { request } from "./lcncWs";
import { NO_VALUE } from "./format";

// ── This device ──
const name = ref(deviceInfo.value.name);
const simOn = ref(loadSimulationDraft().enabled);
/** Shown while this tab's switch is not what the server holds yet. */
const simPending = computed(() => simOn.value !== loadSimulationDefaults().enabled);
watch([settingsVersion, () => deviceInfo.value.name], () => {
  simOn.value = loadSimulationDraft().enabled;
  name.value = deviceInfo.value.name;
});
const bound = computed(() => deviceInfo.value.id !== null);
const unboundWhy = computed(() => deviceStorage() === "failed"
  ? "Browser storage unavailable — this device's settings are not saved"
  : "Device not bound yet — reconnecting");

function saveSim(on: boolean) {
  saveSimulationDefaults({ enabled: on });
}

const note = ref<{ kind: "error" | "ok"; text: string } | null>(null);

/** A device command's refusal, or null when it was done. */
async function deviceCmd(cmd: { cmd: "device_rename"; name: string; device?: string }
                         | { cmd: "device_reset"; device?: string }
                         | { cmd: "device_delete"; device: string }): Promise<string | null> {
  const r = await request(cmd);
  void loadDevices();
  if (!r) return "No answer from the gateway — try again";
  return r.ok === false ? String(r.error ?? "Refused") : null;
}

async function saveName() {
  const why = await deviceCmd({ cmd: "device_rename", name: name.value });
  note.value = why ? { kind: "error", text: why } : { kind: "ok", text: "Name saved" };
}

// ── The devices of this machine ──
const devices = ref<DeviceRow[] | null>(null);
const listError = ref<string | null>(null);
async function loadDevices() {
  try {
    devices.value = await fetchDevices();
    listError.value = null;
  } catch (e) {
    listError.value = `Device list not read — ${(e as Error).message}`;
  }
}
onMounted(loadDevices);
watch(devicesVersion, loadDevices);
const others = computed(() => (devices.value ?? []).filter(d => !d.this));

function label(d: DeviceRow): string {
  return d.name || `Unnamed device ${d.id.slice(0, 4)}`;
}
function when(iso: string | null): string {
  return iso ? iso.replace("T", " ").slice(0, 16) : NO_VALUE;
}
function state(d: DeviceRow): string {
  if (d.online) return d.tabs === 1 ? "Online · 1 tab" : `Online · ${d.tabs} tabs`;
  return `Offline · last seen ${when(d.last_seen)}`;
}

/** Another device's simulation: saved into ITS profile on the revision the
 *  list showed (a newer change there refuses this one as stale). */
async function setOtherSim(d: DeviceRow, on: boolean) {
  const r = await request({ cmd: "save_settings", section: "simulation", data: { enabled: on },
                            base_rev: d.simulation_rev, device: d.id });
  void loadDevices();
  if (!r) note.value = { kind: "error", text: "No answer from the gateway — try again" };
  else if (r.ok === false) note.value = { kind: "error", text: String(r.error ?? "Refused") };
  else note.value = { kind: "ok", text: `${label(d)}: simulation ${on ? "on" : "off"}` };
}

// ── The asks ──
type Ask = { kind: "rename"; d: DeviceRow; name: string } | { kind: "reset"; d: DeviceRow | null }
  | { kind: "delete"; d: DeviceRow };
const ask = ref<Ask | null>(null);
const askError = ref<string | null>(null);
watch(ask, () => { askError.value = null; });
const askTitle = computed(() => {
  const a = ask.value;
  if (!a) return "";
  if (a.kind === "rename") return `Rename ${label(a.d)}?`;
  if (a.kind === "reset") return a.d ? `Reset ${label(a.d)}?` : "Reset this device?";
  return `Delete ${label(a.d)}?`;
});
async function confirmAsk() {
  const a = ask.value;
  if (!a) return;
  const why = a.kind === "rename" ? await deviceCmd({ cmd: "device_rename", name: a.name, device: a.d.id })
    : a.kind === "reset" ? await deviceCmd(a.d ? { cmd: "device_reset", device: a.d.id } : { cmd: "device_reset" })
    : await deviceCmd({ cmd: "device_delete", device: a.d.id });
  if (why) { askError.value = why; return; }
  ask.value = null;
  note.value = { kind: "ok", text: a.kind === "rename" ? "Name saved" : a.kind === "reset" ? "Device reset" : "Device deleted" };
}
</script>

<template>
  <div class="stack-panel scrollContent scroll-thin fade-scroll">
    <div class="stack-controls" data-devices="this">
      <div class="sub">This Device</div>
      <div class="settingDesc">How this browser looks, its macro bar and its simulation are its own. A new device starts without the simulation.</div>
      <div v-if="!bound" class="statusNote warn" role="status" data-device-unbound>{{ unboundWhy }}</div>
      <template v-else>
        <div class="formGrid">
          <FormField label="Name">
            <template #default="{ input }">
              <MachineInput v-bind="input" gate="deviceSetting" type="text" v-model="name" maxlength="40"
                            placeholder="e.g. Machine panel" @change="saveName" />
            </template>
          </FormField>
        </div>
        <MachineToggle gate="deviceSetting" v-model="simOn" @update:modelValue="saveSim"
                       label="Simulation: timeline, collision check, Sim tab" data-device-sim />
        <div v-if="simPending" class="settingDesc" role="status">Not active until the gateway holds it</div>
      </template>
      <div v-if="note" class="statusNote" :class="note.kind" role="status">{{ note.text }}</div>
      <div v-if="bound" class="resetRow">
        <MachineBtn type="deviceOwnAction" @click="ask = { kind: 'reset', d: null }">Reset This Device</MachineBtn>
      </div>
    </div>

    <div class="sep"></div>

    <div class="stack-controls" data-devices="others">
      <div class="sub">Other Devices</div>
      <div class="settingDesc">Changing another device needs Arm. A device is deleted only by hand, and never while it is connected.</div>
      <div v-if="listError" class="statusNote error" role="status">{{ listError }}</div>
      <div v-else-if="devices === null" class="emptyState loading">Reading the device list…</div>
      <div v-else-if="others.length === 0" class="emptyState">No other devices</div>
      <div v-else class="dataTable">
        <table>
          <thead><tr><th>Name</th><th>State</th><th>Address</th><th>Simulation</th><th></th></tr></thead>
          <tbody>
            <tr v-for="d in others" :key="d.id" :data-device-row="d.id">
              <td>{{ label(d) }}<span v-if="!d.changed" class="text-muted"> · never changed</span></td>
              <td>{{ state(d) }}</td>
              <td class="mono">{{ d.last_address ?? NO_VALUE }}</td>
              <td>
                <MachineToggle gate="deviceSettingOther" :modelValue="d.simulation"
                               @update:modelValue="setOtherSim(d, $event!)" :aria-label="`Simulation on ${label(d)}`" />
              </td>
              <td class="row-tight">
                <MachineBtn type="listActionSetting" :aria-label="`Rename ${label(d)}`"
                            @click="ask = { kind: 'rename', d, name: d.name }"><Pencil :size="14" /></MachineBtn>
                <MachineBtn type="listActionSetting" :aria-label="`Reset ${label(d)}`"
                            @click="ask = { kind: 'reset', d }"><RotateCcw :size="14" /></MachineBtn>
                <MachineBtn type="listActionSetting" :aria-label="`Delete ${label(d)}`" :disabled="d.online"
                            reason="Device connected — close it first"
                            @click="ask = { kind: 'delete', d }"><Trash2 :size="14" /></MachineBtn>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <DialogFrame v-if="ask" kind="confirm" :title="askTitle" :danger="ask.kind !== 'rename'" @close="ask = null">
      <div v-if="ask.kind === 'rename'" class="dialogBody formGrid">
        <FormField label="Name">
          <template #default="{ input }">
            <MachineInput v-bind="input" gate="deviceSettingOther" type="text" v-model="ask.name" maxlength="40" />
          </template>
        </FormField>
      </div>
      <div v-else-if="ask.kind === 'reset'" class="dialogBody">Its look, macro bar and simulation return to what a new device starts with (simulation off). This cannot be undone.</div>
      <div v-else class="dialogBody">Its settings are removed. If that browser comes back, it starts as a new device. This cannot be undone.</div>
      <div v-if="askError" class="statusNote error" role="status">{{ askError }}</div>
      <template #actions>
        <MachineBtn type="dialogCancel" @click="ask = null">Cancel</MachineBtn>
        <!-- This device's own reset needs no arm; another device's change does -->
        <Gate :gate="ask.kind === 'reset' && !ask.d ? 'always' : 'armed'" class="row-controls">
          <MachineBtn :type="ask.kind === 'rename' ? 'dialogConfirm' : 'dialogDanger'" @click="confirmAsk">
            {{ ask.kind === 'rename' ? 'Rename' : ask.kind === 'reset' ? 'Reset' : 'Delete' }}
          </MachineBtn>
        </Gate>
      </template>
    </DialogFrame>
  </div>
</template>
