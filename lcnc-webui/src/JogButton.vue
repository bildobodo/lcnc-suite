<script setup lang="ts">
import { computed } from "vue";
import { send } from "./lcncWs";

const props = defineProps<{
  axis: number;          // 0=X, 1=Y, 2=Z ...
  dir: 1 | -1;           // +1 or -1
  label: string;         // e.g. "X+"
  vel: number;           // jog velocity (units/sec)
  disabled?: boolean;    // safety gate from parent
}>();

const isDisabled = computed(() => !!props.disabled || !Number.isFinite(props.vel) || props.vel <= 0);

let jogging = false;

function startJog(e: PointerEvent) {
  if (isDisabled.value) return;

  // capture pointer so we always get pointerup even if user drags off the button
  try {
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  } catch {}

  if (jogging) return;
  jogging = true;

  send({
    cmd: "jog_cont",
    axis: props.axis,
    vel: props.vel * props.dir,
  });
}

function stopJog(e?: PointerEvent) {
  if (!jogging) return;
  jogging = false;

  // stop is always safe to send (still requires armed on backend, but parent disables anyway)
  send({
    cmd: "jog_stop",
    axis: props.axis,
  });

  if (e) {
    try {
      (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    } catch {}
  }
}
</script>

<template>
  <button
    class="jbtn"
    :class="{ disabled: isDisabled }"
    :disabled="isDisabled"
    @pointerdown.prevent="startJog"
    @pointerup.prevent="stopJog"
    @pointercancel.prevent="stopJog"
    @pointerleave.prevent="stopJog"
    @contextmenu.prevent
  >
    {{ label }}
  </button>
</template>

<style scoped>
.jbtn {
  padding: 14px 14px;
  border-radius: 14px;
  border: 1px solid #0002;
  background: #fff;
  cursor: pointer;
  user-select: none;
  touch-action: none; /* important: prevents touch scrolling from interrupting hold */
  min-width: 70px;
  font-weight: 650;
}

.jbtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
