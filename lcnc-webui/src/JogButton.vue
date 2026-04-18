<script setup lang="ts">
import { computed, ref } from "vue";
import { send } from "./lcncWs";
import { INPUT_DEFS } from "./machineControls";
import { usePermissions } from "./permissions";
import { registerJog, unregisterJog, activeJogKeys } from "./useJogPointers";

type Direction = 'up' | 'down' | 'left' | 'right' | 'up-left' | 'up-right' | 'down-left' | 'down-right';

const props = defineProps<{
  axis: number;          // 0=X, 1=Y, 2=Z ...
  dir: 1 | -1;           // +1 or -1
  label: string;         // e.g. "X+"
  vel: number;           // jog velocity (units/sec)
  disabled?: boolean;    // safety gate from parent
  active?: boolean;      // externally active (e.g. keyboard jog)
  jogIncrement?: number; // 0 = continuous, >0 = step distance
  direction: Direction;
  axis2?: number;        // optional second axis for diagonal jog
  dir2?: 1 | -1;         // direction for second axis
}>();

const can = usePermissions();
const isDisabled = computed(() => !can.value[INPUT_DEFS.jogAxis.gate] || !!props.disabled || !Number.isFinite(props.vel) || props.vel <= 0);
const isDiagonal = computed(() => props.axis2 != null && props.dir2 != null);

// SVG polygon points for each direction
const points = computed(() => {
  switch (props.direction) {
    case 'up':         return '50,6.7 97,93.3 3,93.3';
    case 'down':       return '3,6.7 97,6.7 50,93.3';
    case 'left':       return '93.3,3 93.3,97 6.7,50';
    case 'right':      return '6.7,3 6.7,97 93.3,50';
    case 'up-right':   return '98,2 2,50 50,98';
    case 'up-left':    return '2,2 98,50 50,98';
    case 'down-right': return '50,2 98,98 2,50';
    case 'down-left':  return '50,2 2,98 98,50';
  }
});

const isHovered = ref(false);

function onPointerEnter(e: PointerEvent) {
  if (e.pointerType === "mouse") isHovered.value = true;
}
function onPointerLeave(e: PointerEvent) {
  isHovered.value = false;
  stopJog(e);
}

function sendStop() {
  if (!props.jogIncrement || props.jogIncrement <= 0) {
    if (isDiagonal.value) {
      send({ cmd: "jog_stop_multi", axes: [props.axis, props.axis2!] });
    } else {
      send({ cmd: "jog_stop", axis: props.axis });
    }
  }
}

function startJog(e: PointerEvent) {
  if (isDisabled.value) return;
  if (activeJogKeys.has(props.label)) return;

  const el = e.currentTarget as HTMLElement;
  try { el?.setPointerCapture?.(e.pointerId); } catch {}

  // Scale velocity by 1/sqrt(2) for diagonal so resultant speed matches
  const v = isDiagonal.value ? props.vel * 0.7071 : props.vel;

  if (props.jogIncrement && props.jogIncrement > 0) {
    if (isDiagonal.value) {
      const dist = props.jogIncrement * 0.7071;
      send({
        cmd: "jog_incr_multi",
        axes: [
          { axis: props.axis, vel: v * props.dir, distance: dist * props.dir },
          { axis: props.axis2!, vel: v * props.dir2!, distance: dist * props.dir2! },
        ],
      });
    } else {
      send({ cmd: "jog_incr", axis: props.axis, vel: v * props.dir, distance: props.jogIncrement * props.dir });
    }
  } else {
    if (isDiagonal.value) {
      send({
        cmd: "jog_cont_multi",
        axes: [
          { axis: props.axis, vel: v * props.dir },
          { axis: props.axis2!, vel: v * props.dir2! },
        ],
      });
    } else {
      send({ cmd: "jog_cont", axis: props.axis, vel: v * props.dir });
    }
  }

  registerJog(e.pointerId, props.label, sendStop, el);
}

function stopJog(e?: PointerEvent) {
  if (!e) return;
  if (!activeJogKeys.has(props.label)) return;

  sendStop();
  unregisterJog(e.pointerId);

  const el = e.currentTarget as HTMLElement;
  try { el?.releasePointerCapture?.(e.pointerId); } catch {}
  // Blur clears sticky CSS :active state on touch browsers that report hover:hover
  if (e.pointerType !== "mouse") el?.blur?.();
}
</script>

<template>
  <button
    class="jbtn"
    :class="[direction, { disabled: isDisabled, active: activeJogKeys.has(label) || active, hover: isHovered }]"
    :disabled="isDisabled"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @pointerdown.prevent="startJog"
    @pointerup.prevent="stopJog"
    @pointercancel.prevent="stopJog"
    @contextmenu.prevent
  >
    <svg class="tri" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
      <polygon :points="points" />
    </svg>
    <span class="jlabel" :class="{ small: isDiagonal }">{{ label }}</span>
  </button>
</template>

<style scoped>
.jbtn {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  user-select: none;
  touch-action: none; /* prevents touch scrolling from interrupting hold */
  font-weight: var(--fw-semibold);
  font-size: var(--fs-md);
  position: relative;
  padding: 0;
  transition: opacity 0.15s ease;
  border-radius: 0;
}

/* Override global button styles — highlight inside the triangle only.
   All highlights are JS-driven classes (no :hover/:active pseudo-classes)
   to prevent sticky highlights on touchscreens. */
.jbtn.hover:not(:disabled),
.jbtn.active:not(:disabled),
.jbtn:active:not(:disabled) {
  background: transparent;
  border: none;
}

.jbtn.hover:not(:disabled) .tri polygon {
  fill: var(--hl-hover);
}

.jbtn.active:not(:disabled) .tri polygon {
  fill: var(--hl-active);
}

.tri {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.tri polygon {
  fill: var(--button-bg);
  stroke: var(--border);
  stroke-width: 2;
  stroke-linejoin: round;
}

.jlabel {
  position: absolute;
  pointer-events: none;
}

.jlabel.small {
  font-size: var(--fs-xs);
}

/* Cardinal: label at centroid (1/3 from base) */
.up .jlabel {
  bottom: 28%;
  left: 50%;
  transform: translateX(-50%);
}

.down .jlabel {
  top: 28%;
  left: 50%;
  transform: translateX(-50%);
}

.left .jlabel {
  right: 28%;
  top: 50%;
  transform: translateY(-50%);
}

.right .jlabel {
  left: 28%;
  top: 50%;
  transform: translateY(-50%);
}

/* Diagonal: label at centroid */
.up-right .jlabel {
  bottom: 28%;
  left: 28%;
}

.up-left .jlabel {
  bottom: 28%;
  right: 28%;
}

.down-right .jlabel {
  top: 28%;
  left: 28%;
}

.down-left .jlabel {
  top: 28%;
  right: 28%;
}
</style>
