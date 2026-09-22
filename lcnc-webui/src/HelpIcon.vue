<script setup lang="ts">
import { useId, ref, onMounted, onBeforeUnmount } from 'vue'
import { placePopover } from './helpPlacement'

// The one tap-friendly help pattern (UX-11): a popover on a focusable
// button, named for its topic so a page with several helps reads as
// "Help: Kinematics frame", not "Show help" five times.
defineProps<{ label?: string }>()

const id = `hp-${useId()}`
const btn = ref<HTMLButtonElement | null>(null)
const pop = ref<HTMLDivElement | null>(null)

const MARGIN = 6

// CSS zoom (the tests' 150 % emulation; an operator's page zoom is not
// this): getBoundingClientRect() and window.innerWidth/Height are viewport
// px, the element's own left/top/max-height are its CSS px — one factor
// apart. `currentCSSZoom` where the browser has it, else the ratio of the
// two measures of a laid-out element; 1 without zoom.
function zoomOf(el: HTMLElement): number {
  const z = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom
  if (typeof z === 'number' && z > 0) return z
  const w = el.offsetWidth
  return w > 0 ? el.getBoundingClientRect().width / w : 1
}

// Placement reads the popover AS LAID OUT in the top layer: the first
// version positioned it in `beforetoggle`, while it was still display:none
// and measured 0 × 0 — the fit check was vacuous, every popover opened
// below its trigger and the Setup help ran off the bottom of the viewport
// (review round 5, UI-I13). `beforetoggle` schedules this for the next
// animation frame, after showPopover() has put the element in the top
// layer and before that frame paints — no wrong-position flash. The
// stale inline left/width from a previous opening are reset first: a
// shrink-to-fit fixed box measures against the space to the right of its
// `left`, so a stale left narrowed it (309 px instead of 336, measured).
function position() {
  const b = btn.value
  const p = pop.value
  if (!b || !p || !p.matches(':popover-open')) return
  p.style.left = '0px'
  p.style.top = '0px'
  p.style.maxHeight = ''
  p.style.maxWidth = ''
  const z = zoomOf(p)
  const vw = window.innerWidth
  const vh = window.innerHeight
  let size = p.getBoundingClientRect()
  if (size.width > vw - 2 * MARGIN) {
    p.style.maxWidth = `${(vw - 2 * MARGIN) / z}px`
    size = p.getBoundingClientRect()
  }
  const r = b.getBoundingClientRect()
  const at = placePopover(
    { left: r.left, top: r.top, width: r.width, height: r.height },
    { width: size.width, height: size.height },
    { width: vw, height: vh }, MARGIN)
  p.style.top = `${at.top / z}px`
  p.style.left = `${at.left / z}px`
  p.style.maxHeight = at.maxHeight === null ? '' : `${at.maxHeight / z}px`
}

function onBeforeToggle(e: Event) {
  if ((e as ToggleEvent).newState === 'open') {
    requestAnimationFrame(position)
    window.addEventListener('resize', position)
  } else {
    window.removeEventListener('resize', position)
  }
}

onMounted(() => {
  pop.value?.addEventListener('beforetoggle', onBeforeToggle)
})
onBeforeUnmount(() => {
  pop.value?.removeEventListener('beforetoggle', onBeforeToggle)
  window.removeEventListener('resize', position)
})
</script>

<template>
  <button
    ref="btn"
    type="button"
    class="helpIcon"
    :popovertarget="id"
    :aria-label="label ? `Help: ${label}` : 'Show help'"
    :title="label ? `Help: ${label}` : 'Show help'"
  >?</button>
  <div ref="pop" :id="id" popover="auto" class="helpPopover">
    <slot />
  </div>
</template>
