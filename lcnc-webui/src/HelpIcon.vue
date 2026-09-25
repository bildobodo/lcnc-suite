<script setup lang="ts">
import { useId, ref, onMounted, onBeforeUnmount } from 'vue'
import { placePopover, cssZoomOf } from './helpPlacement'

// The one tap-friendly help pattern (UX-11): a popover on a focusable
// trigger, named for its topic so a page with several helps reads as
// "Help: Kinematics Frame", not "Show help" five times.
//
// The trigger is a `span role="button"`, not a <button> (design wave D1
// live look): a <button> inside a Gate's disabled fieldset is disabled —
// the help went dead and dimmed with its section, although reading help is
// never a machine action. A span is outside the fieldset's disabled
// cascade; it toggles its popover itself (no `popovertarget`, which only
// buttons carry) and cancels its click, so a "?" inside a toggle's label
// never flips the toggle and never triggers the label's own tap-to-explain.
defineProps<{ label?: string }>()

const id = `hp-${useId()}`
const btn = ref<HTMLElement | null>(null)
const open = ref(false)
const pop = ref<HTMLDivElement | null>(null)

const MARGIN = 6

// CSS zoom (the tests' 150 % emulation; an operator's page zoom is not
// this): getBoundingClientRect() and window.innerWidth/Height are viewport
// px, the element's own left/top/max-height are its CSS px — one factor
// apart. `currentCSSZoom` where the browser has it, else the ratio of the
// two measures of a laid-out element; 1 without zoom (`cssZoomOf`,
// shared with the control hint in helpPlacement.ts).

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
  const z = cssZoomOf(p)
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
  open.value = (e as ToggleEvent).newState === 'open'
  if (open.value) {
    requestAnimationFrame(position)
    window.addEventListener('resize', position)
  } else {
    window.removeEventListener('resize', position)
  }
}

// A press on the trigger is OUTSIDE the popover, so light dismiss has
// closed an open popover by the time the click arrives (a <button> is
// exempt as its invoker; a span is not): the state at pointerdown decides —
// open then means this tap closes it.
let openAtPress = false
function onPointerDown() { openAtPress = !!pop.value?.matches(':popover-open') }
function toggle() {
  const p = pop.value
  if (!p) return
  const wasOpen = openAtPress || p.matches(':popover-open')
  openAtPress = false
  if (wasOpen) { if (p.matches(':popover-open')) p.hidePopover() }
  else p.showPopover()
}
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
  // Enter / Space act on the focused trigger only — the shortcut map never
  // sees them (Space is Cycle Start there).
  e.preventDefault()
  e.stopPropagation()
  if (!e.repeat) toggle()
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
  <span
    ref="btn"
    class="helpIcon"
    role="button"
    tabindex="0"
    aria-haspopup="dialog"
    :aria-controls="id"
    :aria-expanded="open"
    :aria-label="label ? `Help: ${label}` : 'Show help'"
    :title="label ? `Help: ${label}` : 'Show help'"
    @pointerdown="onPointerDown"
    @click.prevent.stop="toggle"
    @keydown="onKeydown"
  >?</span>
  <div ref="pop" :id="id" popover="auto" class="helpPopover">
    <slot />
  </div>
</template>
