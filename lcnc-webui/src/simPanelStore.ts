// The Simulation tab's state (operator 2026-10-05): ScrubBar — hosted in the
// viewer, the ONE owner of the simulation, its position and the finding
// navigation (Codex R31–R34) — publishes what the side pane's Simulation tab
// shows, and the tab acts through the bar's own functions. Nothing here
// decides anything: a second navigation would drift from the bar's marks.
import { reactive, shallowRef } from "vue";
import type { SimRow, SimRowKind } from "./viewer/simRows";
import type { CardView } from "./viewer/checkContext";

/** The collision check as the tab says it. */
export interface SimSweepView {
  /** checking = running; paused = parked by a rotary jog; partial = stopped
   *  short; done = the whole route; nopairs = nothing moves against anything. */
  state: "checking" | "paused" | "partial" | "done" | "nopairs";
  /** Swept fraction of the displayed track, 0…1 (the timeline's swept band). */
  frac: number;
  /** The verdict in words ("Clear", "2 collisions", "2 collisions so far" …). */
  verdict: string;
  tone: "ok" | "warn" | "danger" | "muted";
  /** The guarantee does not hold for this sweep (the bar's old "*"). */
  caveat: boolean;
  /** The "?": how much was checked, what was excluded, with which tools. */
  detail: string;
  /** The check's name when it is not the standstill check: the check during
   *  a run (plan „Prüfung im Lauf“ 3d). */
  label?: string;
  /** The verdict's parts (Codex R136 VP-I94): the result by kind, the
   *  coverage with the cap's caveat (empty for a verdict that is all result),
   *  and the result as a count ("200+" past the cap's contacts) — the tab
   *  shortens the result before the coverage. */
  result: string;
  coverage: string;
  /** The coverage in the fewest words ("in full", "41 %", "from L7"), no
   *  caveat words — the tab's last form (Codex R137 VP-I94). */
  coverageShort: string;
  short: string;
}

/** What the list shows: every kind, or one. */
export type SimFilter = "all" | SimRowKind;
export const SIM_FILTER_KINDS: Record<SimFilter, readonly SimRowKind[]> = {
  all: ["clash", "limit", "tool"], clash: ["clash"], limit: ["limit"], tool: ["tool"],
};

/** The list's rows: a WINDOW of at most simWindow.LIST_WINDOW rows of the
 *  filter's kinds around the shown or next one (step 4 package 2, plan 4.4) —
 *  ‹ › and the counts reach every target, the list shows a window. */
export const simRows = shallowRef<SimRow[]>([]);

export const simView = reactive({
  /** A program track exists (the bar shows). */
  available: false,
  /** The finding the last jump showed, while the timeline stands there. */
  shownKey: null as string | null,
  /** The first row after the position — the run's and playback's look-ahead. */
  nextKey: null as string | null,
  /** Where the simulation (or the run) stands: the line readout and the time. */
  line: "",
  lineOffPath: false,
  lineTitle: "",
  time: "",
  sweep: null as SimSweepView | null,
  /** The verdict of the preview shown before the one displayed now — a run
   *  published another (its tool table changed) — said in words only: no
   *  marks, counts or jumps of the current preview (plan „Prüfung im Lauf“
   *  1c). Null otherwise. */
  previous: null as string | null,
  /** The card "Check basis" (step 4 plan 1c): what the check on screen was
   *  computed with, taken when it was requested. Null without a check. */
  card: null as CardView | null,
  /** The program's soft-limit records: `total` distinct (line, axis) records
   *  (null = not validated — unchecked ≠ clean), `records` the ones the
   *  payload carries (the gateway caps the list at 200). */
  limits: { total: null as number | null, records: 0 },
  /** A tool measurement the preview cannot predict (M600): what and why —
   *  from there no path, no time, no collision or limit check. */
  stop: null as string | null,
  /** Where the toolsetter values the routine was predicted with come from
   *  (probeStop.toolsetterBasisLine), null without the routine. */
  basis: null as string | null,
  /** Tool measurements whose call line is not verified: their notes stand
   *  in Program Stats, never on every row of the tool (Codex R105 VP-I63). */
  unboundMeasurements: 0,
  /** …and how many of them carry a probe warning (parity-ef F3): the
   *  summary says the warnings stand there too (Codex R126 VP-I75). */
  unboundWarnings: 0,
  /** Why a row cannot be shown now (the machine is on), else undefined. */
  jumpReason: undefined as string | undefined,
  /** Playback speed, ×0.1 … ×100 in fixed steps. */
  speed: 1,
  /** What the list shows. */
  filter: "all" as SimFilter,
  /** Every target of each kind — the window shows some of them. */
  counts: { clash: 0, limit: 0, tool: 0 } as Record<SimRowKind, number>,
  /** How many rows of the filter's kinds lie before and after the window. */
  window: { before: 0, after: 0 },
});

/** The speed steps the tab offers (operator 2026-10-05: fixed steps, not a
 *  slider): 1-2-5 from a tenth to a hundredfold. */
export const SIM_SPEEDS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] as const;

interface SimActions {
  /** Show the row's finding (enters the simulation when it can); `near`
   *  where it lies — a key is found there without a walk over every target. */
  jump(key: string, near?: number): void;
  /** The next / previous row of these kinds from the current position. */
  step(kinds: readonly SimRowKind[], dir: 1 | -1): void;
}
let _actions: SimActions | null = null;
let _owner: object | null = null;
/** ScrubBar claims the tab while mounted; the returned release ends only ITS
 *  claim — the actions and what the tab shows. A re-mount (a hot reload in
 *  dev, any keyed swap) builds the new bar BEFORE the old bar's onUnmounted
 *  runs: an unconditional clear there disconnected the new bar, and ‹ › and
 *  the rows did nothing until a page reload (operator 2026-10-06, live). */
export function claimSimActions(a: SimActions): () => void {
  const claim = {};
  _owner = claim;
  _actions = a;
  return () => {
    if (_owner !== claim) return;
    _owner = null;
    _actions = null;
    simView.available = false;
    simView.counts = { clash: 0, limit: 0, tool: 0 };
    simView.window = { before: 0, after: 0 };
    simRows.value = [];
  };
}
export function simJump(key: string, near?: number): void { _actions?.jump(key, near); }
export function simStep(kinds: readonly SimRowKind[], dir: 1 | -1): void { _actions?.step(kinds, dir); }
