/**
 * Drag-to-scroll for touch screens and mouse.
 * Auto-attaches to all `.scroll-thin` elements via MutationObserver.
 * Uses pointer events so it works with both touch and mouse.
 */

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

  let state: DragState | null = null

  el.addEventListener('pointerdown', (e: PointerEvent) => {
    // Only primary button (touch or left-click)
    if (e.button !== 0) return
    // Skip drag-native elements (sliders, selects, text fields) and jog
    // buttons, which act on pointerdown and hold their own pointer capture
    // (touch-action: none). Plain buttons are draggable-from on purpose:
    // the strip is ~95% buttons, and they are safe because capture below
    // retargets pointerup to the container once the threshold is passed,
    // so the button's click never fires after a real drag.
    const tag = (e.target as HTMLElement).closest(
      'input, select, textarea, a, [contenteditable], .no-drag-scroll, .jogBtn'
    )
    if (tag) return

    state = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      dragging: false,
    }
    // Don't capture yet — let native scrollbar interaction work.
    // Capture is deferred to pointermove once the drag threshold is met.
  })

  el.addEventListener('pointermove', (e: PointerEvent) => {
    if (!state || e.pointerId !== state.pointerId) return

    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY

    if (!state.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      state.dragging = true
      // A selection can anchor during the pre-threshold slop (the browser
      // starts selecting at pointerdown, before we know it's a drag) —
      // clear it, or it survives the whole drag as a lasso.
      document.getSelection()?.removeAllRanges()
      // Capture now that we know this is a drag, not a scrollbar click
      el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
      el.style.userSelect = 'none'
    }

    el.scrollLeft = state.scrollLeft - dx
    el.scrollTop = state.scrollTop - dy
  })

  function end(e: PointerEvent) {
    if (!state || e.pointerId !== state.pointerId) return
    if (state.dragging) {
      el.style.cursor = ''
      el.style.userSelect = ''
    }
    state = null
  }

  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
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
