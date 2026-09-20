// The transient control hint (WP6, review "Hold verständlich"): "Hold to
// activate" after a short tap on a hold-to-fire button, "Busy — try again"
// when the busy latch drops a click. ONE hint at a time, rendered ONCE by
// FloatingOverlays.vue (App): a per-button Teleport made MachineBtn a
// fragment root, which strips the parent's scoped-CSS id from the rendered
// button — every `.nkKey` / `.tkKey` / `.safetyBtn` rule stopped applying
// (implementation review UI-I07).
import { reactive } from "vue";

export const HINT_MS = 1500;
export const btnHint = reactive({ text: "", left: 0, top: 0 });
let timer = 0;

/** Show `text` above `anchor` for HINT_MS; a new hint replaces the old. */
export function showBtnHint(anchor: unknown, text: string): void {
  if (anchor instanceof HTMLElement) {
    const r = anchor.getBoundingClientRect();
    btnHint.left = r.left + r.width / 2;
    btnHint.top = r.top - 4;
  }
  btnHint.text = text;
  clearTimeout(timer);
  timer = window.setTimeout(() => { btnHint.text = ""; }, HINT_MS);
}
