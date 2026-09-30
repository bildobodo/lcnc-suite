// The A/B measurement's one shared state (Codex R39 VP39-03; temporary —
// removed with the previous GL line after the acceptance): ThreeViewer
// registers its driver, Settings → Debug switches the line renderer and
// starts / cancels the run, the viewer's findings card says that it runs.
import { reactive } from "vue";
import { modalOpen } from "../modalRegistry";
import { runAb, AB_LABELS, type AbDriver, type AbDurations, type AbProgress, type AbVariant } from "./abRun";

export const abState = reactive({
  /** A viewer is up and registered its driver. */
  available: false,
  mode: "fat" as AbVariant,
  running: false,
  /** The run waits for Settings (or any dialog) to close before it starts. */
  waiting: false,
  progress: null as AbProgress | null,
  /** The last run's outcome, one line (Debug tab). */
  last: "",
});

let _driver: AbDriver | null = null;
let _cancel: { cancelled: boolean } | null = null;

export function registerAbDriver(d: AbDriver | null): void {
  _driver = d;
  abState.available = !!d;
  if (d) abState.mode = d.lineMode();
}

/** The running run's cancel token — the driver's long phases poll it. */
export function abCancelled(): boolean {
  return !!_cancel?.cancelled;
}

export async function setAbLineMode(v: AbVariant): Promise<void> {
  if (!_driver || abState.running) return;
  await _driver.setLineMode(v);
  abState.mode = _driver.lineMode();
}

/** Why a run cannot start now (the Debug tab disables its button with it). */
export function abBlocker(): string | null {
  if (!_driver) return "No 3D view — open the viewer";
  if (abState.running) return "A measurement is running";
  return _driver.blocker();
}

const DIALOG_WAIT_MS = 60_000;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Start a run: it waits (up to a minute) until no dialog is open — the
 *  Debug tab lives in Settings, and a dialog over the viewer is part of what
 *  would be measured — then runs the fixed sequence. */
export async function startAbRun(o: { durations?: Partial<AbDurations> } = {}): Promise<void> {
  const blocked = abBlocker();
  if (blocked || !_driver) { abState.last = blocked ?? "No 3D view"; return; }
  const d = _driver;
  abState.running = true;
  abState.waiting = true;
  abState.last = "";
  _cancel = { cancelled: false };
  const cancel = _cancel;
  try {
    const t0 = performance.now();
    while (modalOpen.value && !cancel.cancelled && performance.now() - t0 < DIALOG_WAIT_MS) await sleep(250);
    abState.waiting = false;
    if (cancel.cancelled) { abState.last = "Cancelled before the start"; return; }
    if (modalOpen.value) { abState.last = "Not started — close Settings within a minute of pressing Run"; return; }
    const runId = `ab-${Date.now().toString(36)}`;
    const r = await runAb(d, { runId, durations: o.durations, cancel, onProgress: p => { abState.progress = p; } });
    abState.last = r.ok
      ? `${runId}: done, ${r.skipped.length} phase${r.skipped.length === 1 ? "" : "s"} skipped${r.skipped.length ? ` (${r.skipped[0]}${r.skipped.length > 1 ? ", …" : ""})` : ""}`
      : `${runId}: ${r.reason ?? "stopped"}`;
  } finally {
    abState.running = false;
    abState.waiting = false;
    abState.progress = null;
    abState.mode = d.lineMode();
    _cancel = null;
  }
}

export function cancelAbRun(): void {
  if (_cancel) _cancel.cancelled = true;
}

/** The findings card's line while a run is under way. */
export function abRunLine(): string {
  if (!abState.running) return "";
  if (abState.waiting) return "A/B measurement — starts when Settings is closed";
  const p = abState.progress;
  if (p && p.rep < 0) return "A/B measurement · calibrating — hands off the view";
  return p ? `A/B measurement ${p.rep + 1}/${p.reps} · ${AB_LABELS[p.variant]} · ${p.phase} — hands off the view` : "A/B measurement";
}
