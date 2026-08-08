/**
 * Scroll-edge fade affordance for content scrollers.
 *
 * Auto-attaches to `.fade-scroll` elements via MutationObserver (same
 * pattern as dragScroll) and toggles `sf-up` / `sf-down` classes; the
 * fades themselves are ::before/::after sticky gradients in style.css.
 *
 * Opt-in (`.fade-scroll`), NOT blanket on `.scroll-thin`: the fade
 * pseudo-elements become flex items in flex containers and would insert
 * a phantom gap slot (stack-* scrollers), and the fade end color must
 * match the scroller's background (`--scroll-fade-bg`, default --panel).
 * The bottom strip and macro bar have their own stronger overlay fades
 * (App.vue .stripFade) and must not carry .fade-scroll.
 */

const attached = new WeakSet<HTMLElement>()
const els = new Set<HTMLElement>()
let ro: ResizeObserver | null = null

function update() {
  for (const el of els) {
    if (!el.isConnected) { els.delete(el); continue }
    el.classList.toggle('sf-up', el.scrollTop > 1)
    el.classList.toggle('sf-down', el.scrollTop + el.clientHeight < el.scrollHeight - 1)
  }
}

function attach(el: HTMLElement) {
  if (attached.has(el)) return
  attached.add(el)
  els.add(el)
  ro ??= new ResizeObserver(update)
  el.addEventListener('scroll', update, { passive: true })
  ro.observe(el)
  for (const c of el.children) ro.observe(c)
  update()
}

function scanAndAttach(root: Element | Document = document) {
  for (const el of root.querySelectorAll<HTMLElement>('.fade-scroll')) {
    attach(el)
  }
}

let _observer: MutationObserver | null = null

export function initScrollFade() {
  // Idempotent — HMR may re-run this module during dev.
  if (_observer) return

  scanAndAttach()

  _observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.classList.contains('fade-scroll')) attach(node)
        scanAndAttach(node)
      }
    }
    // Content changes (rows added by v-for, file loaded) alter
    // scrollHeight without any observed element resizing — cheap
    // re-check on every batch keeps sf-up/sf-down honest.
    update()
  })
  _observer.observe(document.body, { childList: true, subtree: true })
}

export function stopScrollFade() {
  _observer?.disconnect()
  _observer = null
  ro?.disconnect()
  ro = null
  els.clear()
}

// Vite HMR cleanup — prevents a growing pile of observers when the file
// is replaced during development. No-op in production builds.
if (import.meta.hot) {
  import.meta.hot.dispose(() => stopScrollFade())
}
