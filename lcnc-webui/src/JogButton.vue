<script setup lang="ts">
import { computed } from "vue";
import { send } from "./lcncWs";

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

const isDisabled = computed(() => !!props.disabled || !Number.isFinite(props.vel) || props.vel <= 0);
const isDiagonal = computed(() => props.axis2 != null && props.dir2 != null);

// SVG polygon points for each direction
const points = computed(() => {
  switch (props.direction) {
    case 'up':         return '50,2 98,98 2,98';
    case 'down':       return '2,2 98,2 50,98';
    case 'left':       return '98,2 2,50 98,98';
    case 'right':      return '2,2 98,50 2,98';
    case 'up-right':   return '98,2 2,50 50,98';
    case 'up-left':    return '2,2 98,50 50,98';
    case 'down-right': return '50,2 98,98 2,50';
    case 'down-left':  return '50,2 2,98 98,50';
  }
});

let jogging = false;

function startJog(e: PointerEvent) {
  if (isDisabled.value) return;

  // capture pointer so we always get pointerup even if user drags off the button
  try {
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  } catch {}

  if (jogging) return;
  jogging = true;

  // Scale velocity by 1/sqrt(2) for diagonal so resultant speed matches
  const v = isDiagonal.value ? props.vel * 0.7071 : props.vel;

  if (props.jogIncrement && props.jogIncrement > 0) {
    // Incremental jog
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
    // Continuous jog
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
}

function stopJog(e?: PointerEvent) {
  if (!jogging) return;
  jogging = false;

  if (!props.jogIncrement || props.jogIncrement <= 0) {
    // Only send stop for continuous mode
    if (isDiagonal.value) {
      send({ cmd: "jog_stop_multi", axes: [props.axis, props.axis2!] });
    } else {
      send({ cmd: "jog_stop", axis: props.axis });
    }
  }

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
    :class="[direction, { disabled: isDisabled, active: active }]"
    :disabled="isDisabled"
    @pointerdown.prevent="startJog"
    @pointerup.prevent="stopJog"
    @pointercancel.prevent="stopJog"
    @pointerleave.prevent="stopJog"
    @contextmenu.prevent
  >
    <svg class="tri" viewBox="0 0 100 100" preserveAspectRatio="none">
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
  color: var(--fg);
  cursor: pointer;
  user-select: none;
  touch-action: none; /* prevents touch scrolling from interrupting hold */
  font-weight: 650;
  font-size: 13px;
  position: relative;
  padding: 0;
  transition: opacity 0.15s ease;
}

.jbtn:active:not(:disabled),
.jbtn.active:not(:disabled) {
  opacity: 0.7;
}

.jbtn.active:not(:disabled) .tri polygon {
  fill: color-mix(in oklab, var(--fg) 20%, var(--button-bg));
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
  font-size: 10px;
}

/* Cardinal: label at centroid (1/3 from base) */
.up .jlabel {
  bottom: 22%;
  left: 50%;
  transform: translateX(-50%);
}

.down .jlabel {
  top: 22%;
  left: 50%;
  transform: translateX(-50%);
}

.left .jlabel {
  right: 22%;
  top: 50%;
  transform: translateY(-50%);
}

.right .jlabel {
  left: 22%;
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
