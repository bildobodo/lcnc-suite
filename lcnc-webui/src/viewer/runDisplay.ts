// What the program's track shows that is NOT the simulation (settings split
// package 2, operator 2026-11-07, plan Codex R335 SS334-04): the live run on
// the program's track — the code panel's line (runLineState / subExecState),
// the run check's hint (runPlayhead), the cum the timeline's playhead follows
// (runCum) — and the code panel's tool-change and soft-limit marks (toolMarks
// / limitMarks). They used to be made inside ScrubBar.vue; a device whose
// simulation is off has no timeline and still sees its run and its marks.
// ThreeViewer runs both, once.
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { status, viewerGcode, viewerInit, gcodeContent, emitTelemetry } from "../lcncWs";
import { INTERP_IDLE } from "../lcnc";
import { simMode } from "../simMode";
import { lineRange } from "./lineIndex";
import { machineFromJoints, displayLineForPoint, atTrackEnd, lineSpanCum, programEndLine } from "./scrubTrack";
import { createRunWatcher } from "./runWatcher";
import { runPlayhead } from "./runPlayhead";
import { runLineState, subExecState } from "../trackHighlight";
import { specFromWire } from "./kins";
import { epochTermsFor, type WcsTableRow } from "./wcsEpochs";
import { EVENT_NONE } from "./eventIndex";
import { limitPlaces } from "./limitPlaces";
import { limitMarks, NO_LIMIT_MARKS, type LimitMarks } from "../limitMarks";
import { toolMarks, NO_TOOL_MARKS, type ToolMarks } from "../toolMarks";
import { toolChangeLinesFromText } from "./toolChangeScan";
import type { ScrubTrack } from "../ws/bulkData";
import type { WcsTerms } from "./partFrame";

/** The offsets a track's program coordinates are converted with. `tool`: the
 *  fallback for segments before the program's first G43/M6 row
 *  (jointsForSample / the entry inverse resolve each segment's own offset
 *  from the track's tloEvents through it) — the payload's TOOL BASIS
 *  (VP-I20: previewWorker normalised those points to it), else, for a
 *  payload without a known start, the LIVE applied offset. */
export function wcsOf(d: Record<string, any>) {
  return {
    g5x: d.g5x_offset ?? [], g92: d.g92_offset ?? [],
    rotationDeg: d.rotation_xy ?? 0, tool: viewerGcode.value?.toolBasis ?? d.tool_offset ?? [],
  };
}

/** The TWP plane frame the MACHINE is actually holding, from the kins pins
 *  (sampled only on xyzacb-trsrn configs); null when not sampled. The RUN
 *  playhead's forward kins take it — the machine's ACTUAL switchkins state
 *  is the authority for the joints being projected. Units are the pins' own
 *  (pre-rot radians, the two angles degrees), the parse markers'
 *  convention, so both feed kinsForSegment unconverted. */
export function liveKinsFrameOf(d: Record<string, any>): [number, number, number] | null {
  const p = d.kins_pre_rot, t1 = d.kins_primary_angle, t2 = d.kins_secondary_angle;
  if (typeof p !== "number" || typeof t1 !== "number" || typeof t2 !== "number") return null;
  return [p, t1, t2];
}

/** W5: marked-span execution state for GcodePanel's inline indent view —
 *  published from both the sim scrub and the run playhead; only spans with
 *  an attributed call line anchor an expansion. */
export function publishSubExec(t: ScrubTrack, i: number, subName: string | null): void {
  const cl = t.cline?.[i] ?? 0;
  const raw = t.lines[i] ?? 0;
  subExecState.value = (subName && cl > 0 && raw > 0)
    ? { name: subName, subLine: raw, callLine: cl } : null;
}

/** Where the next line that has a move STARTS moving (lineSpanCum — its first
 *  move), from `line` on: a tool change's place on the track. */
export function spanAtOrAfterLine(t: ScrubTrack, line: number): [number, number] | undefined {
  for (let l = line; l <= t.lineIndex.maxLine; l++) {
    const span = lineSpanCum(t, l);
    if (span) return span;
  }
  return undefined;
}

/** The program's tool changes, line → tool: the parse's, completed by the
 *  text's (a line the parse names wins). */
export function toolChangeLines(textLines: Iterable<readonly [number, number]>): Map<number, number> {
  const byLine = new Map<number, number>();
  for (const [line, tool] of viewerGcode.value?.tool_change_lines ?? []) byLine.set(line, tool);
  for (const [line, tool] of textLines) if (!byLine.has(line)) byLine.set(line, tool);
  return byLine;
}

/** The cum on the program's track the live run stands at (attached), for the
 *  timeline's playhead; null outside a run. */
export const runCum = ref<number | null>(null);
/** The machine is somewhere the program never goes (toolchange park): the
 *  playhead frozen, the line suppressed. */
export const runOffPath = ref(false);

// ui.playhead_slow telemetry: the watcher self-times; anything past the
// budget is worth a trace row, rate-limited so a bad state can't flood.
const PLAYHEAD_SLOW_MS = 30;

/** The run-time display (unified timeline phase 2 + review P3). During a
 *  real run the playhead follows the LIVE POSITION: the machine pose is
 *  projected onto the program's track POSITIONALLY (projectOntoTrack — a
 *  cum-monotonic forward-biased window around the previous playhead, with a
 *  full-track rescue). motion_line is a HINT only, and only while the
 *  payload's line attribution is trusted — sub/remap-relative numbers
 *  collide with the main file's, which is what parked the old highlight on
 *  wrong lines. Display only: the machine drives the playhead, never the
 *  reverse. The watcher itself is a pure state machine
 *  (viewer/runWatcher.ts): ATTACHED = windowed projection per frame (+
 *  trusted-line hint competing on residual); a miss pays exactly ONE
 *  full-track scan (the attach / run-from-line path) and then latches
 *  OFF-PATH — playhead frozen, highlight cleared, chip shown, ≤1 Hz strided
 *  re-probe, ZERO per-frame work. A run starts with the timeline's entry
 *  track dropped: the run is on the program's own track. */
export function useRunDisplay(): void {
  const st = computed<Record<string, any>>(() => status.value?.data ?? {});
  const track = computed(() => viewerGcode.value?.scrubTrack ?? null);
  const running = computed(() => (st.value.interp_state ?? INTERP_IDLE) !== INTERP_IDLE);
  // Wire kins declaration → spec, cached: specFromWire allocates.
  const kinsSpec = computed(() => specFromWire(viewerInit.value?.kins));
  /** Per-epoch WCS re-add terms (review P2): the run playhead converts
   *  program coords through the segment's OWN epoch basis. undefined =
   *  legacy single-basis track. */
  const epochTerms = computed<WcsTerms[] | undefined>(() => {
    const evs = track.value?.wcsEvents;
    if (!evs?.length) return undefined;
    return epochTermsFor(evs, wcsOf(st.value), st.value.wcs_table as WcsTableRow[] | undefined);
  });
  // W5: the unique program-end line (M2/M30 text scan) — what the playhead
  // displays when pinned at the track's terminal vertex.
  const endLine = computed(() => programEndLine(gcodeContent.value));
  const watcher = createRunWatcher();
  let lastSlowEmit = 0;
  let wasRunning = false;

  watch(st, (d) => {
    // A run's start and end reset the display FIRST, in this frame — a
    // separate watch on `running` ran after this one and wiped the first
    // frame's projection (an off-path start read "···" until the next frame).
    const r = running.value;
    if (r !== wasRunning) {
      wasRunning = r;
      watcher.reset();
      runPlayhead.value = null;
      runOffPath.value = false;
      runCum.value = null;
      if (!r) runLineState.value = null;
      if (!r && !simMode.value) subExecState.value = null;
    }
    if (!r || simMode.value) return;
    const t = track.value;
    const jp = d.joint_pos;
    if (!t || !Array.isArray(jp)) return;
    const trusted = !viewerGcode.value?.lines_untrusted;
    const line = trusted ? (d.motion_line as number | null | undefined) : null;
    const span = line ? lineRange(t.lineIndex, line) : undefined;
    // Forward kins for the live joints: the machine's ACTUAL switchkins pin
    // and plane frame when sampled — same authority as the joints being
    // inverted; the hint span's (or track-start) segment mode stands in.
    const ktLive = d.kins_type;
    const ktNow = ktLive != null ? ktLive : (t.mode?.[span?.end ?? 0] ?? null);
    const fN = t.frame?.[span?.end ?? 0];
    const frameNow = liveKinsFrameOf(d)
      ?? ((fN != null && fN !== EVENT_NONE && t.frames) ? t.frames[fN] ?? null : null);
    const m = machineFromJoints(jp, viewerInit.value?.axes ?? [], wcsOf(d), kinsSpec.value, ktNow, frameNow);
    const out = watcher.update({
      track: t, machine: m, wcs: wcsOf(d), epochTerms: epochTerms.value,
      hintSpan: span ?? null, nowMs: performance.now(),
    });
    runOffPath.value = out.phase === "offPath";
    if (out.costMs > PLAYHEAD_SLOW_MS && performance.now() - lastSlowEmit > 10_000) {
      lastSlowEmit = performance.now();
      emitTelemetry("ui.playhead_slow", { cost_ms: Math.round(out.costMs), probed: out.probed,
                                          points: t.count, phase: out.phase });
    }
    // the run check's hint (plan „Prüfung im Lauf“ 3b): attached only
    runPlayhead.value = out.phase === "attached" && out.index != null ? { track: t, index: out.index } : null;
    if (out.phase === "offPath") {
      // Frozen playhead — the machine is somewhere the program never goes
      // (toolchange park); pretending otherwise is the old bug. The
      // published state is SUPPRESS, never null: null would let App.vue fall
      // back to motion_line's colliding sub numbers. offPath (W5) lets
      // resolveCurrentLine apply the text-trusted motion_line rescue (the
      // approach executing a real main line).
      runLineState.value = { line: 0, trusted: false, subName: null, offPath: true };
      subExecState.value = null;
      return;
    }
    if (out.cum == null) return;
    runCum.value = out.cum;
    // End state (W3 P4): the playhead pinned at the terminal vertex has
    // nothing further to attribute — trailing non-motion lines (M2) are
    // unknowable, so present "end" instead of freezing on the last line.
    const i = out.index!;
    if (i === t.count - 1 && atTrackEnd(t, out.cum)) {
      // W5: the unique text-scanned program-end line displays here — the
      // track cannot know what follows the last move, the text can.
      runLineState.value = { line: endLine.value ?? 0, trusted: endLine.value != null, subName: null, atEnd: true };
      subExecState.value = null;
      return;
    }
    // Text-panel line state (W2 P6): the ONE shared gating rule (W3 P4) —
    // per-point trust from the wire when the track carries it; legacy
    // tracks fall back to the wholesale flag. The published line is the
    // GATED display line (W4: inside an attributed sub span that is the
    // CALL/trigger line, viaCall) — never the raw colliding sub number.
    const disp = displayLineForPoint(t, i, trusted);
    runLineState.value = {
      line: disp.line ?? 0, trusted: disp.line != null, subName: disp.subName,
      viaCall: disp.viaCall, subLine: disp.subName ? t.lines[i] ?? null : null,
    };
    publishSubExec(t, i, disp.subName);
  });
  // Another program (or the same one re-parsed): the watcher starts over.
  watch(track, () => {
    watcher.reset();
    runOffPath.value = false;
    runCum.value = null;
    runLineState.value = null;
    subExecState.value = null;
  });
}

/** The code panel's marks of the program (Codex R177/R178): the soft-limit
 *  records' lines (limitMarks — found on the program's track, never a raw
 *  number) and the tool changes' lines (toolMarks — where a move follows).
 *  A re-mounted viewer (a hot reload) is built before the old one's
 *  onUnmounted runs: each clears only what it set. */
export function useProgramMarks(): void {
  const track = computed(() => viewerGcode.value?.scrubTrack ?? null);
  const place = computed(() => limitPlaces(viewerGcode.value?.violations ?? null, track.value, track.value,
                                           !viewerGcode.value?.lines_untrusted));
  let limitSet: LimitMarks | null = null;
  watch(place, p => { limitSet = p.lines; limitMarks.value = p.lines; }, { immediate: true });
  onUnmounted(() => { if (limitMarks.value === limitSet) limitMarks.value = NO_LIMIT_MARKS; });

  const textToolLines = computed(() => toolChangeLinesFromText(gcodeContent.value));
  const tools = shallowRef<ToolMarks>(NO_TOOL_MARKS);
  watch([track, viewerGcode, textToolLines], ([t]) => {
    const m = new Map<number, number>();
    if (t) for (const [line, tool] of toolChangeLines(textToolLines.value)) if (spanAtOrAfterLine(t, line)) m.set(line, tool);
    tools.value = m;
    toolMarks.value = m;
  }, { immediate: true });
  onUnmounted(() => { if (toolMarks.value === tools.value) toolMarks.value = NO_TOOL_MARKS; });
}
