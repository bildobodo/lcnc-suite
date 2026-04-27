<script setup lang="ts">
import { useId, ref, onMounted, onBeforeUnmount } from 'vue'

const id = `hp-${useId()}`
const btn = ref<HTMLButtonElement | null>(null)
const pop = ref<HTMLDivElement | null>(null)

const MARGIN = 6

function position() {
  const b = btn.value
  const p = pop.value
  if (!b || !p) return
  const r = b.getBoundingClientRect()
  const pw = p.offsetWidth
  const ph = p.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight

  let left = r.left + r.width / 2 - pw / 2
  if (left + pw > vw - MARGIN) left = vw - pw - MARGIN
  if (left < MARGIN) left = MARGIN

  let top = r.bottom + MARGIN
  if (top + ph > vh - MARGIN) top = r.top - ph - MARGIN
  if (top < MARGIN) top = MARGIN

  p.style.top = `${top}px`
  p.style.left = `${left}px`
}

function onToggle(e: Event) {
  if ((e as ToggleEvent).newState === 'open') position()
}

onMounted(() => {
  pop.value?.addEventListener('beforetoggle', onToggle)
})
onBeforeUnmount(() => {
  pop.value?.removeEventListener('beforetoggle', onToggle)
})
</script>

<template>
  <button
    ref="btn"
    type="button"
    class="helpIcon"
    :popovertarget="id"
    aria-label="Show help"
  >?</button>
  <div ref="pop" :id="id" popover="auto" class="helpPopover">
    <slot />
  </div>
</template>
