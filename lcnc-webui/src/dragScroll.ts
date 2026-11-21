/**
 * Drag-to-scroll for touch screens and mouse.
 * Auto-attaches to all `.scroll-thin` elements via MutationObserver.
 * Uses pointer events so it works with both touch and mouse.
 */
import { noteScrollGesture } from './releaseClick'

const DRAG_THRESHOLD = 5 // px — must move this far before drag starts

interface DragState {
  pointerId: number
  startX: number
  startY: number
  scrollLeft: number
  scrollTop: number
  dragging: boolean
}

const attached = new WeakSet<HTMLElement>()

function attach(el: HTMLElement) {
  if (attached.has(el)) return
  attached.add(el)

  // ONE state per POINTER (Codex R421 MT-I02 rest A): a second finger on
  // the same scroller used to replace the first's state, so the first never
  // reached its threshold's scroll decision and its release clicked Power.
  // Every pointer decides its own "this press became a scroll"; only the
  // first one past the threshold moves the container.
  const states = new Map<number, DragState>()
  let scroller: number | null = null

  el.addEventListener('pointerdown', (e: PointerEvent) => {
    // Only primary button (touch or left-click)
    if (e.button !== 0) return
    // Skip drag-native elements (sliders, selects, text fields) and jog
    // buttons, which act on pointerdown and hold their own pointer capture
    // (touch-action: none). Plain buttons are draggable-from on purpose:
    // the strip is ~95% buttons, and they are safe because the drag's
    // threshold below is the release click's scroll decision: no click acts
    // after a real drag (capture alone did not stop Chromium's, Codex R420).
    const tag = (e.target as HTMLElement).closest(
      'input, select, textarea, a, [contenteditable], .no-drag-scroll, .jogBtn'
    )
    if (tag) return

    states.set(e.pointerId, {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      dragging: false,
    })
    // Don't capture yet — let native scrollbar interaction work.
    // Capture is deferred to pointermove once the drag threshold is met.
  })

  el.addEventListener('pointermove', (e: PointerEvent) => {
    const state = states.get(e.pointerId)
    if (!state) return

    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY

    if (!state.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      state.dragging = true
      // ONE decision "this press became a scroll" (Codex R420 MT-I02), taken
      // first and for EVERY pointer: the release click gives it no click and
      // swallows the browser's own — Chromium still clicked the control under
      // the finger after a 6 px drag despite the capture (Power off).
      noteScrollGesture(e.pointerId)
      if (scroller !== null) return   // another finger already moves the container
      scroller = e.pointerId
      // A selection can anchor during the pre-threshold slop (the browser
      // starts selecting at pointerdown, before we know it's a drag) —
      // clear it, or it survives the whole drag as a lasso.
      document.getSelection()?.removeAllRanges()
      // Capture now that we know this is a drag, not a scrollbar click —
      // best effort: the pointer may already be gone
      try { el.setPointerCapture(e.pointerId) } catch { /* the drag goes on without it */ }
      el.style.cursor = 'grabbing'
      el.style.userSelect = 'none'
    }
    if (scroller !== e.pointerId) return

    el.scrollLeft = state.scrollLeft - dx
    el.scrollTop = state.scrollTop - dy
  })

  function end(e: PointerEvent) {
    if (!states.delete(e.pointerId)) return
    if (scroller === e.pointerId) {
      scroller = null
      el.style.cursor = ''
      el.style.userSelect = ''
    }
  }

  // the release may land outside the scroller (no capture yet): watch it on the window
  window.addEventListener('pointerup', end, true)
  window.addEventListener('pointercancel', end, true)
}

function scanAndAttach(root: Element | Document = document) {
  for (const el of root.querySelectorAll<HTMLElement>('.scroll-thin')) {
    attach(el)
  }
}

let _observer: MutationObserver | null = null

export function initDragScroll() {
  // Idempotent — HMR may re-run this module during dev.
  if (_observer) return

  // Attach to existing elements
  scanAndAttach()

  // Watch for dynamically added .scroll-thin elements
  _observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.classList.contains('scroll-thin')) attach(node)
        scanAndAttach(node)
      }
    }
  })
  _observer.observe(document.body, { childList: true, subtree: true })
}

export function stopDragScroll() {
  _observer?.disconnect()
  _observer = null
}

// Vite HMR cleanup — prevents a growing pile of observers when the file is
// replaced during development. No-op in production builds.
if (import.meta.hot) {
  import.meta.hot.dispose(() => stopDragScroll())
}
