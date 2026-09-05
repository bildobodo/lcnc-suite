// Bulk-data channels (frontend split, A1.2 — extracted from lcncWs.ts).
//
// Everything that arrives OUTSIDE the WS status stream because it's too big
// to ride the single-threaded WS writer: gcode preview polylines (HTTP +
// previewWorker decode), program text (GET /gcode), surface points and the
// compensation grid (HTTP msgpack). Owns the per-channel version sentinels,
// AbortControllers and the preview-worker singleton.
//
// Leaf module: imports vue / msgpack / defaults TYPES only; never imports
// lcncWs or its peers. lcncWs dispatches the *_ready frames here and passes
// the apply sinks for surface/grid (those write the status ref, which stays
// in lcncWs until the statusStore extraction) — reassigned scalars stay
// private to this module by design (A1 rule).
import { computed, markRaw, ref } from "vue";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import type { Vec3 } from "../defaults";

// Viewer payloads. Static `viewer_init` (machine description, INI config,
// kinematics, parts list) is delivered once per WS connection; dynamic
// `viewer_gcode` is delivered on every program load and carries the parsed
// preview polylines. Types live here so consumers (App.vue, ThreeViewer.vue)
// share one shape — no per-callsite `as any` / `as ViewerInit | null`.
export interface ViewerPart {
  id: string;
  file: string;
  group?: string | null;
  translate?: Vec3;
  rotate?: Vec3;
  // Optional default color [r,g,b] 0–1 from machine.json (STL carries no
  // color); per-part user overrides in settings still win.
  color?: Vec3;
  // STOCK body: the one thing the tool may FEED into (collision-sweep
  // cutting semantics — see viewer/collision.ts). Machine parts never are.
  stock?: boolean;
  // Legacy field names kept for backward compatibility with older payloads.
  parent?: string | null;
  t?: Vec3;
  r?: Vec3;
}
export type KinematicsList =
  | Array<{
      group: string;
      joint: number;
      type?: "translate" | "rotate";
      direction?: "x" | "y" | "z";
      axis?: [number, number, number];
      sign: number;
    }>
  | Record<string, { axis: number; sign: number }>;
export interface ViewerInit {
  units?: "mm" | "inch" | string;
  stl_base_url: string;
  groups?: Array<{ id: string; parent: string; translate?: Vec3 }>;
  parts: ViewerPart[];
  kinematics: KinematicsList;
  workGroup?: string;
  toolGroup?: string;
  machine_bounds?: { origin: Vec3; size: Vec3 };
  axes?: string[];
  /** Kins declaration parsed from the INI (single source: [KINS]KINEMATICS
   *  + HALCMD setp pivot lines) — TCP+TWP plan phase 1d. DECLARATION only:
   *  the whole-track transform stays trivkins until phase 2's per-segment
   *  modes (+ TLO-flow audit) activate the real kins. null = no INI yet.
   *  Convert to a KinsSpec with viewer/kins.ts specFromWire(). */
  kins?: {
    module: string;
    type: string;
    identity_first: boolean;
    params: Record<string, number>;
  } | null;
  ini_config?: Record<string, any>;
  [key: string]: any;  // gateway adds occasional extras (e.g. timestamp, git_sha)
}
// Execution-ordered feed+rapid merge for the program scrub (stage 2), built
// off-thread by previewWorker from the per-point seq wire data. Program-space
// samples; the pose is derived per frame in viewer/scrubTrack.ts.
export interface ScrubTrack {
  pos: Float32Array;        // count*3 program XYZ, execution order
  abc: Float32Array;        // count*3 degrees (zeros when the wire had no abc)
  lines: Uint32Array;       // count — source line per point (0 = unknown)
  rapid: Uint8Array;        // count — 1 when the segment ending here is a rapid
  /** count — RAW switchkins type of the segment ending here (phase 2
   *  markers, raw types since phase 3: trsrn type 1/TCP and type 2/TOOL
   *  differ). Consumers map type → world/identity per the declared kins
   *  family via viewer/kins.ts worldModeForSpec. Absent = no mode data
   *  (untracked program/config — pose derivation stays trivkins). */
  mode?: Uint8Array;
  /** count — governing TWP frame INDEX into `frames` per segment (0xff =
   *  none). Present only on programs with WEBUI_TWPFRAME markers. */
  frame?: Uint8Array;
  /** TWP frame value triplets [preRot rad, primary deg, secondary deg],
   *  dereferenced by `frame` (wire kins_frames minus the seq column). */
  frames?: [number, number, number][];
  /** count — kins-flip relabel flag: 1 ⇒ the segment ending here is a
   *  switchkins frame relabel at a stationary pose (wire rapid_brk), zero
   *  machine motion — zero cum, never drawn/swept/lerped. Absent = legacy
   *  payload; flip segments keep the raw phantom jump. */
  brk?: Uint8Array;
  /** count — unknown-start flag (schema 6, W3 P1): 1 ⇒ this point is a
   *  suppressed first-move ENDPOINT (wire rapid_ustart) — the machine
   *  reaches it via a path no parse can know. Build time unions these
   *  into `brk` (the connector is never drawn/swept/timed/lerped); the
   *  distinct channel keeps the semantics apart (relabel = stationary,
   *  ustart = unknown motion) for labels and the entry move, which
   *  supersedes the unknown approach with a real one. Absent = none. */
  ustart?: Uint8Array;
  /** count — WCS epoch index of the segment ending here (into `wcsEvents`):
   *  which basis the point was peeled against (review P2). Absent = legacy
   *  payload (single-basis semantics). */
  wcsEpoch?: Uint8Array;
  /** count — per-point line trust (W2 P6, wire feed_lineok/rapid_lineok):
   *  1 ⇒ this point's `lines` entry is a line of THIS file that could have
   *  produced this motion (exists, can move, stream-compatible, not in a
   *  marked sub span) and may drive the text-panel highlight. Absent =
   *  pre-schema-4 payload → callers fall back to the wholesale
   *  lines_untrusted flag. */
  lineOk?: Uint8Array;
  /** count — marked-subroutine index into `subNames` per point (0xff =
   *  none): the UI says "in subroutine (name)" instead of highlighting a
   *  colliding main-file line. Present only when WEBUI_SUB markers
   *  executed. */
  sub?: Uint8Array;
  subNames?: string[];
  /** count — text-verified call-site MAIN-file line of the marked sub
   *  span the point sits in (W4, wire feed_cline/rapid_cline; 0 = none):
   *  the o-call / remap trigger line, displayable while the point's own
   *  `lines` entry is a colliding sub-file number. Present only when some
   *  span attributed (unique-site rule — never a guess). */
  cline?: Uint16Array;
  /** WCS epoch events (parsed wire wcs_frames) dereferenced by `wcsEpoch` —
   *  see viewer/wcsEpochs.ts for the re-add rules (live row vs rewritten
   *  snapshot). */
  wcsEvents?: import("../viewer/wcsEpochs").WcsEpoch[];
  /** count — TLO/tool event index of the segment ending here (into
   *  `tloEvents`; 0xff = before the program's first G43/M6 → the LIVE
   *  applied offset governs). Schema 8; absent = the program never changes
   *  tool or offset (live everywhere, the pre-8 behavior). */
  tlo?: Uint8Array;
  tloEvents?: import("../viewer/tloEvents").TloEvent[];
  /** Monotonic scrub parameter: SECONDS when `timeBased` (unified timeline
   *  phase 1 — per-segment feed + INI rapid velocities), else distance
   *  (mm, 1° ≙ 1 mm — legacy payloads / no INI MAX_VELOCITY). */
  cum: Float32Array;
  timeBased: boolean;
  count: number;
  /** Source line → cum of its first track point (built off-thread; Maps
   *  survive structured clone). Lets the UI place line-anchored marks —
   *  soft-limit violations — on the timeline without an O(track) scan. */
  lineCum: Map<number, number>;
  /** Source line → track point index range — the run playhead projects the
   *  live position onto the current line's span for smooth motion. */
  lineSpan: Map<number, { start: number; end: number }>;
}

// One per-line soft-limit overtravel record from the parse worker. `value`
// and `limit` are machine units for linear axes, degrees for rotary.
export interface LimitViolation {
  line: number;
  axis: string;
  value: number;
  limit: number;
  kind: "min" | "max";
}

// The preview wire-format generation this client build was written against —
// mirror of gateway_util.PREVIEW_SCHEMA, bumped in the SAME commit as every
// preview wire-shape change. A fetched payload whose `preview_schema` differs
// (or is absent — a legacy payload from a pre-stamp worker) gets a HUD banner
// with a Reparse action instead of being silently mis-read by newer decode
// paths.
//
// Log (mirror gateway_util): 1 = stamp introduced (W2 P1); 2 = abc ships on
// pose-dependence, not only on a sweep (W2 P3 — a pre-2 TWP payload lacks
// the abc channel entirely and would draw flat); 3 = parse_tlos snapshot +
// gateway TLO-drift auto-reparse (W2 P4 — pre-3 payloads keep limit flags
// baked with a re-measured-away tool length); 4 = per-point line trust +
// marked-sub spans, lines_untrusted means "NO point trusts" (W2 P6 —
// pre-4 payloads disable the whole run highlight on any sub call); 5 =
// uncommanded rotaries rebased to the live machine pose (a pre-5 TWP
// payload can pose a parked rotary a whole fixture-offset wrong — the
// bump reparses warm caches out of the wrong pose); 6 = suppressed
// first-move endpoints ship as zero-length unknown-start rapids
// (rapid_ustart, W3 P1) plus the unmarked_subs advisory (W3 P5) — pre-6
// the program's own first rapid vanished, so the sim entry lerped
// straight to remap-internal motion and preamble kins flips fell before
// the first recorded segment (the 962 mm phantom); 7 = call-site line
// attribution (feed_cline/rapid_cline, W4) — sub-span points whose
// unique main-file call/trigger line text-verifies highlight THAT line
// instead of going dark (pre-7 payloads show chip-only); 8 = per-segment
// TLO/tool events (tlo_events → scrubTrack.tlo / tloEvents) + a diameter
// column on parse_tlos — pre-8 the client applied ONE live tool offset to
// the whole track (a program applying its own G43 before motion posed
// every joint a tool length high on a fresh boot: the 22.000 gate catch).
export const EXPECTED_PREVIEW_SCHEMA = 8;

/** Non-null when the loaded payload was parsed with a DIFFERENT tool length
 *  than the live table now holds for the spindle tool (W2 P4): the per-line
 *  soft-limit flags baked the parse-time tool table, and a toolsetter
 *  re-measure invalidates them. The gateway auto-reparses when idle; this
 *  hint is the honest in-run signal (compare uses the live table row via
 *  status tool_length, which is G43-state-independent). Values in machine
 *  units; magnitudes compared (status ships |zoffset|). Scope: the LOADED
 *  tool only — status carries no other tool's length, so other program
 *  tools are the gateway drift edge's job (evaluate_tlo_drift compares
 *  every parse row against the live table). Pure. */
export function parseTloMismatch(
  g: ViewerGcode | null | undefined,
  toolNumber: number | null | undefined,
  liveToolLength: number | null | undefined,
  eps = 1e-3,
): { tool: number; parsed: number; live: number } | null {
  if (!g?.parse_tlos?.length || !toolNumber || toolNumber <= 0) return null;
  if (liveToolLength == null) return null;
  const row = g.parse_tlos.find(r => r[0] === toolNumber);
  if (!row) return null;
  const parsed = Math.abs(row[3] ?? 0);
  return Math.abs(parsed - liveToolLength) > eps
    ? { tool: toolNumber, parsed, live: liveToolLength }
    : null;
}

/** Non-null when the loaded payload's wire-format stamp disagrees with this
 *  client build: `{ got: n }` for a differently-stamped payload, `{ got:
 *  null }` for a legacy unstamped one. Null when no program payload is loaded
 *  or the stamp matches. Pure — unit-tested; ThreeViewer's HUD banner and its
 *  Reparse action hang off this. */
export function previewSchemaMismatch(
  g: ViewerGcode | null | undefined,
): { got: number | null } | null {
  if (!g || g.file == null) return null;  // no program payload → nothing to judge
  const got = typeof g.preview_schema === "number" ? g.preview_schema : null;
  return got === EXPECTED_PREVIEW_SCHEMA ? null : { got };
}

/** Human-readable soft-limit violation, shared by the code-panel line titles
 *  and the scrub bar's findings button. `unit` = machine linear unit. */
export function limitViolationText(v: LimitViolation, unit: string): string {
  const u = "ABC".includes(v.axis) ? "°" : ` ${unit}`;
  return v.kind === "min"
    ? `${v.axis} ${v.value}${u} < min ${v.limit}${u}`
    : `${v.axis} ${v.value}${u} > max ${v.limit}${u}`;
}

export interface ViewerGcode {
  file?: string | null;
  // Wire-format generation stamp (P1) — gateway_util.PREVIEW_SCHEMA at parse
  // time. The gateway cache keys payloads on file+mtime only, so a gateway
  // process that outlives a code upgrade serves pre-upgrade payloads to
  // hot-reloaded clients; this stamp is how the client notices. Absent =
  // legacy payload (pre-stamp worker) — bannered with a Reparse action, never
  // silently accepted. Compare via previewSchemaMismatch().
  preview_schema?: number;
  feed?: number[][] | Uint8Array;  // wire: LE float32 bin (preferred) | legacy nested
  rapid?: number[][] | Uint8Array;
  feed_lines?: number[] | Uint32Array | Uint8Array;  // wire: LE uint32 bin | legacy list
  // P4.1: flat position buffers produced off-thread by previewWorker (preferred
  // over the nested arrays — ThreeViewer builds BufferAttributes directly).
  feedPos?: Float32Array;          // flat [x,y,z, ...]
  rapidPos?: Float32Array;
  // Rotary-aware preview: per-vertex A/B/C (degrees, per-epoch-peeled
  // program coords), index-aligned with feedPos/rapidPos. Present whenever
  // abc is NEEDED to pose tool-vs-work (should_ship_abc, W2 P3): a rotary
  // sweeps, raw abc ≠ 0 anywhere (a constant tilt — the per-epoch peel can
  // zero it), or switchkins markers are present. Absence means the
  // programmed polyline is already exact and no part-frame transform is
  // needed.
  feedAbc?: Float32Array;          // flat [a,b,c, ...]
  rapidAbc?: Float32Array;
  // Section breaks for the drawn streams (previewWorker, track-derived):
  // vertex indices that OPEN a section — no segment is drawn into them.
  // The raw wire streams are endpoint lists that lose the feed/rapid
  // interleaving; rendered as plain strips they draw FALSE connectors
  // across every stream switch (a feed after a G0 lift appeared to start
  // pre-lift). Absent on track-less legacy payloads → strip rendering.
  feedBreaks?: Uint32Array;
  rapidBreaks?: Uint32Array;
  // Per-vertex RAW switchkins types for the DRAWN streams (previewWorker,
  // track-derived — aligned with feedPos/rapidPos). Present iff the wire
  // carried feed_kinstype/rapid_kinstype. The part-frame transform maps
  // type → world per the declared kins family (worldModeForSpec) and
  // routes non-identity segments through the machine's declared kins.
  feedMode?: Uint8Array;
  rapidMode?: Uint8Array;
  // Per-vertex governing TWP frame index for the DRAWN streams (0xff =
  // none; dereference into kinsFrames). Present iff kins_frames arrived.
  feedFrame?: Uint8Array;
  rapidFrame?: Uint8Array;
  // Per-vertex WCS epoch index for the DRAWN streams (dereference into
  // wcsEvents) — consumed by the display rebase. Present iff wcs_frames
  // arrived with an epoch-aware track.
  feedWcs?: Uint8Array;
  rapidWcs?: Uint8Array;
  // Source TRACK index per drawn feed vertex (ascending; subdivided in
  // part-frame mode) — the positional 3D highlight's address space
  // (review P3). Present iff the track-derived streams were built.
  feedSrc?: Uint32Array;
  // WCS epoch events parsed from wire wcs_frames (previewWorker) — the
  // per-section bases this preview was peeled against (review P2).
  wcsEvents?: import("../viewer/wcsEpochs").WcsEpoch[];
  // TWP frame triplets [preRot rad, primary deg, secondary deg] — wire
  // kins_frames minus the seq column, shared by the per-vertex indices
  // above and scrubTrack.frames.
  kinsFrames?: [number, number, number][];
  // P4.1: bounding boxes of the rendered polylines, computed in the parse worker
  // so ThreeViewer skips an O(n) main-thread scan per load. `bounds` is the cut
  // envelope shown as the toolpath bounds box (X/Y over feed+rapid, Z over feed
  // only — vertical rapids don't inflate the displayed Z extent);
  // `motion_bounds` is the full feed+rapid envelope for the machine-limit
  // overflow check.
  bounds?: { min: number[]; max: number[] } | null;
  motion_bounds?: { min: number[]; max: number[] } | null;
  // Offline dry run stage 1: per-line soft-limit overtravels from the parse
  // worker (checked pre-decimation in the machine frame, joint-side w/ TLO,
  // all axes incl. rotary). null = the INI had no MIN/MAX_LIMIT to check
  // against (unchecked ≠ clean). List capped at 200 records; violations_total
  // is the true distinct (line, axis) count.
  violations?: LimitViolation[] | null;
  violations_total?: number;
  // World-mode (TCP) segments the parse worker could NOT limit-check: the
  // declared kins module has no Python twin. Present only when > 0 —
  // unchecked ≠ clean, so the stats dialog must say "not validated" for
  // these instead of implying the violations list covered them.
  violations_world_unchecked?: number;
  // Load-time lint: the switchkins type the program's LAST marker leaves in
  // effect (M2 restores G54, not the kins pin). Present only when the program
  // itself switches kinematics; non-zero = it does not restore Machine before
  // M2 and the next program would run in the tilted/TCP frame.
  kins_end_type?: number;
  // Stage 2 (program scrub): execution-ordered feed+rapid merge built
  // off-thread by previewWorker. null/absent = no track (no program, or a
  // stale pre-seq payload) — the scrub bar doesn't offer itself.
  scrubTrack?: ScrubTrack | null;
  // Unified timeline phase 1: INI rapid velocities (machine units/s, deg/s)
  // for the client-built entry move's duration; null = INI didn't say.
  rapid_rate?: number | null;
  rot_rapid_rate?: number | null;
  // Executed tool changes as [line, tool] in execution order (canon M6 only
  // — a preview-skipped M600 remap contributes none, same as the stats).
  tool_change_lines?: [number, number][];
  // P4.1: source-line → point-index range map, built off-thread by previewWorker
  // (Maps survive structured clone) so ThreeViewer skips the O(points) build.
  feedLineMap?: Map<number, { start: number; end: number }>;
  // P4.1: cumulative lineDistance for the dashed rapid line, computed off-thread so
  // ThreeViewer sets the attribute directly instead of Three.computeLineDistances().
  rapidDist?: Float32Array;
  // RAW switchkins type per vertex (u8, index-aligned with feed/rapid) —
  // TCP+TWP phase 2a, raw types since phase 3 (renamed from the world-bool
  // feed_mode/rapid_mode so pre-rename clients see no mode field and
  // degrade to the honest "untracked" path). Present ONLY when the program
  // carried switchkins `(WEBUI_KINSTYPE=n)` markers from the toggle
  // remaps; absent = NO mode data (a config switching kins without
  // markers is untracked, not identity). The client maps type →
  // world/identity per the declared kins family (worldModeForSpec).
  feed_kinstype?: Uint8Array;
  rapid_kinstype?: Uint8Array;
  // TWP plane frames (phase 3), execution-ordered [seq, pre_rot_rad,
  // primary_deg, secondary_deg] from the forked TWP remap's
  // `(WEBUI_TWPFRAME=...)` markers — the three kins-pin values that pin
  // the TOOL-kins (type 2) frame. A frame at seq N governs type-2
  // segments with seq > N (same convention as the type markers). Present
  // only alongside kinstype arrays on programs that call G53.x.
  kins_frames?: [number, number, number, number][];
  // Which WCS this preview is expressed relative to (the active one the parse
  // was forced into), and which fixtures the program actually PRODUCED MOTION
  // in — g5x indices, 1=G54 … 9=G59.3, sampled at motion so M2's reset to G54
  // never counts. An entry differing from wcs_basis_index is a fixture the
  // program cuts in but the operator's DRO does not read. Authoritative
  // replacement for a regex over the first 8 KB of source (W5d).
  wcs_basis_index?: number | null;
  wcs_used?: number[];
  // The offsets this preview was parsed against, in MACHINE units so they can
  // be compared straight against the live status values. Differing means the
  // preview is STALE — a touch-off after load — and `reparse_preview` fixes it.
  wcs_basis?: { g5x: number[]; g92: number[]; rotation: number } | null;
  // Parse-time tool-table rows [[tool, xo, yo, zo, diameter]…] for the
  // tools the program touches plus the spindle tool (W2 P4; diameter since
  // schema 8) — the offsets the per-line limit flags were baked with, in
  // machine units, and the dims the sweep/marker use for program tools.
  // Compared against the live table via parseTloMismatch(); the gateway
  // also auto-reparses on drift when idle. Absent = pre-schema-3 payload.
  parse_tlos?: [number, number, number, number, number?][];
  // TLO/tool event rows [seq, xo, yo, zo, tool] (schema 8; machine units;
  // present only when the program changes tool or offset) — decoded into
  // `tloEvents` + the per-point track index. See viewer/tloEvents.ts.
  tlo_events?: number[][];
  tloEvents?: import("../viewer/tloEvents").TloEvent[];
  // Per-vertex TLO event index for the DRAWN streams (like feedWcs).
  feedTlo?: Uint8Array;
  rapidTlo?: Uint8Array;
  // Per-point line trust + marked-sub spans (W2 P6, schema 4): u8 wire
  // bytes, index-aligned with feed/rapid — consumed via the merged track
  // (previewWorker strips them into scrubTrack.lineOk / .sub / .subNames,
  // so they do not appear as fields on the decoded object). Documented
  // here for the wire shape only.
  //   feed_lineok / rapid_lineok : 1 = the point's line number belongs to
  //     this file and could have produced this motion (exists, can move,
  //     stream-compatible, not in a marked sub span).
  //   feed_sub / rapid_sub : index into sub_names, 0xff = none.
  //   feed_cline / rapid_cline (u16, W4, schema 7): text-verified UNIQUE
  //     main-file call/trigger line of the span the point sits in, 0 =
  //     none — stripped into scrubTrack.cline.
  // Since schema 4, `lines_untrusted` below means NO point trusts (the
  // honest kill switch) — a program calling subs keeps its own lines
  // highlightable through the per-point channel.
  sub_names?: string[];
  // Motion line numbers do NOT index this file: NO motion point attributes
  // to a line of this file (per-point trust, W2 P6) — the program's motion
  // runs in called subroutines or remaps whose per-file line numbers
  // collide with the main file's (gateway_util.check_line_attribution —
  // unfixable, a queued motion carries no file identity). The run
  // highlight must be suppressed rather than pointed at an unrelated
  // line; the reason string is shown to the operator.
  lines_untrusted?: boolean;
  lines_untrusted_reason?: string;
  // Called EXTERNAL subroutines whose files carry no WEBUI_SUB marker
  // (W3 P5, schema 6): their motion's line numbers collide with the main
  // file's and can false-positively trust — surfaced as one info-tier
  // stats-dialog hint. Present only when non-empty.
  unmarked_subs?: string[];
  // Kins-flip relabel flags (u8, index-aligned with rapid): brk[i]=1 means
  // the segment INTO point i is a switchkins frame relabel at a stationary
  // pose — zero machine motion, never drawn/swept/timed/lerped. Present
  // (zeros included) whenever kinstype arrays ship; absent-with-modes =
  // legacy payload whose flip segments still carry the raw phantom jump.
  rapid_brk?: Uint8Array;
  // Unknown-start flags (u8, index-aligned with rapid, schema 6 / W3 P1):
  // ustart[i]=1 means point i is a suppressed first-move ENDPOINT (program
  // start, post-M6 excursion, post-G43 shift) — the machine reaches it via
  // a path no parse can know, so the segment INTO it is never drawn/swept/
  // timed/lerped (unioned into the track's brk), while the vertex itself
  // is a real commanded pose. Present only when the program has suppressed
  // moves; absent under schema ≥ 6 = none.
  rapid_ustart?: Uint8Array;
  // Kins flips the parse worker could NOT resolve through a twin (unknown
  // family, or a frameless type-2 side): those segments keep the phantom
  // geometry. Present only when > 0 — unresolved ≠ handled.
  kins_flips_unresolved?: number;
  // Tuples whose shipped geometry a frame-relabel CARRY moved (the g69-tail
  // fix): canon-endpoint replay cannot tell "axis held" from "axis
  // commanded to exactly the stale value", so the reach of every carry is
  // reported rather than assumed. Present only when > 0.
  kins_carry_spans?: number;
  // WCS epoch rows (review P2): [seq, g5x_index, rotation_deg, rewritten,
  // g5x x6, g92 x6] in machine units — the basis each epoch's endpoints
  // were peeled against. ≥1 row whenever motion exists; absence = legacy
  // single-basis payload. Parsed into `wcsEvents` by previewWorker.
  wcs_frames?: number[][];
  // Parse worker aborted partway: interpreter error text + the source line it
  // stopped on (e.g. an axis word this machine doesn't have). The payload
  // still carries whatever parsed before the abort, but scrubTrack is absent
  // — surfaced via previewParseError so the operator learns WHY at load time
  // instead of at cycle start. null/absent = clean parse.
  parse_error?: string | null;
  error_line?: number | null;
  // A TWP remap REFUSED the program in preview (2026-09-05). The preview
  // interpreter runs from the machine's LIVE state (active fixture, kins),
  // and the fork's refusal paths `yield INTERP_EXIT` — an EMPTY success to
  // gcode.parse (its CANON_ERROR is a stub). `line` is the main-file line
  // (the verified caller line when the refusal happened inside a marked sub
  // span; null when unattributable), `sub` / `sub_line` name that span and
  // the refusal's own line in that file. Absent = no refusal. Task would
  // refuse the same line — the preview is correct; this is its reason.
  parse_refused?: { line: number | null; sub?: string | null; sub_line?: number | null; message: string } | null;
  [key: string]: any;  // stats fields are folded in by GcodePanel watcher
}

export const viewerInit = ref<ViewerInit | null>(null);
export const viewerGcode = ref<ViewerGcode | null>(null);
// Tool-table version pinged by gateway after every save/add/delete/import.
// Components watch this ref and re-fetch via the existing get_tool_table RPC,
// so a remote edit propagates without manual refresh.
export const toolTableVersion = ref(0);
// File text for the currently loaded program. Fetched over HTTP (not WS) from
// GET /gcode when viewer_gcode arrives with a new file — keeps multi-MB bodies
// off the WS writer so the gateway's heartbeat loop isn't delayed by N-way
// broadcasts. Null when no program is loaded or the fetch failed.
export const gcodeContent = ref<string | null>(null);

// Per-channel load errors so a success on one fetch channel can't clear a real
// error on another (the three channels are independent HTTP fetches). The
// banner shows the union — first non-null wins.
const _previewErr = ref<string | null>(null);
const _surfaceErr = ref<string | null>(null);
const _compGridErr = ref<string | null>(null);
export const previewLoadError = computed<string | null>(
  () => _previewErr.value ?? _surfaceErr.value ?? _compGridErr.value,
);

// Interpreter abort inside the parse worker (distinct from the transport
// errors above — the payload ARRIVED, but the program didn't parse). Derived
// from the payload itself so it clears naturally when a new program loads.
export const previewParseError = computed<string | null>(() => {
  const g = viewerGcode.value;
  if (!g?.parse_error) return null;
  return g.error_line != null ? `${g.parse_error} (line ${g.error_line})` : g.parse_error;
});

// A remap refusal in preview (distinct from the interpreter abort above: the
// payload is a structurally clean EMPTY parse). Derived from the payload, so
// it clears when a new program loads or a state change reparses this one.
export const previewRefusal = computed<{ line: number | null; sub: string | null; message: string; text: string } | null>(() => {
  const r = viewerGcode.value?.parse_refused;
  if (!r || !r.message) return null;
  const line = typeof r.line === "number" ? r.line : null;
  const sub = r.sub ?? null;
  const where = line != null ? `line ${line}`
    : sub ? `inside ${sub}.ngc${r.sub_line != null ? ` line ${r.sub_line}` : ""}`
    : "an unknown line";
  return { line, sub, message: r.message, text: `${r.message} (${where})` };
});

let _gcodeContentFile: string | null = null;
// Preview version of the currently-fetched text. An in-place edit (web Save or
// external edit) keeps the path constant but bumps the version, so we must
// refetch on a version change too — otherwise the text panel shows stale code
// even though the file on disk (and the 3D preview) changed.
let _gcodeContentVersion = -1;
let _gcodeFetchAbort: AbortController | null = null;

// Fetched preview state (polylines, stats, line numbers) for the currently
// loaded file. Loaded off-thread by previewWorker on viewer_gcode_ready;
// staleness handled by the _previewLastVersion guard on the worker reply.
let _previewLastVersion = -1;

// Surface-scan / comp-grid fetch guards. Same pattern as preview: per-channel
// AbortController so a newer version cancels an in-flight older fetch, and a
// "last version" sentinel to skip duplicate pings.
let _surfaceFetchAbort: AbortController | null = null;
let _surfaceLastVersion = -1;
let _compGridFetchAbort: AbortController | null = null;
let _compGridLastVersion = -1;

function _fetchBulk(
  url: string,
  version: number,
  getLast: () => number,
  setLast: (v: number) => void,
  getAbort: () => AbortController | null,
  setAbort: (ac: AbortController | null) => void,
  apply: (data: any) => void,
  setError: (e: string | null) => void,
) {
  if (version === getLast()) return;
  setLast(version);
  const prev = getAbort();
  if (prev) { prev.abort(); }
  const ac = new AbortController();
  setAbort(ac);
  fetch(`${url}?v=${version}`, { signal: ac.signal })
    .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(buf => {
      if (getLast() !== version) return;  // newer version already won
      const data = msgpackDecode(new Uint8Array(buf));
      apply(data);
      setError(null);  // clear only THIS channel's error
    })
    .catch(err => {
      if (err?.name === "AbortError") {
        // Today the only abort is the supersede at the top of this function,
        // where getLast() has already moved to the newer version — so this is
        // a no-op and the newer fetch keeps ownership of the sentinel.
        //
        // It is written as a condition rather than a bare `return` because an
        // abort WITHOUT a successor (e.g. if teardown ever cancels in-flight
        // fetches) would otherwise leave the sentinel pointing at data that
        // never arrived, and the dedupe at the top would then swallow every
        // future ping of that same version.
        if (getLast() === version) setLast(-1);
        return;
      }
      console.error(`GET ${url} failed`, err);
      setError(`${url} failed: ${err?.message ?? err}`);
      if (getLast() === version) setLast(-1);  // let next bump retry
    });
}

/**
 * Drop the bulk version sentinels on socket close.
 *
 * The gateway tracks "what did I last send THIS connection" per connection and
 * starts a reconnect at zero, so it re-pings versions this client may already
 * hold. Those pings are the only trigger for a fetch, and the sentinels were
 * module-level — so the dedupe at the top of _fetchBulk swallowed the re-ping
 * and nothing was refetched. Combined with the old status-patch wipe that made
 * the surface map disappear for the life of the page; the carry
 * (statusStore.noteBulkData) keeps it on screen now, and this makes the
 * refetch actually happen instead of relying on carried data.
 */
export function resetBulkVersionsOnClose(): void {
  _surfaceLastVersion = -1;
  _compGridLastVersion = -1;
}

function _applyGcodeFile(nextFile: string | null, version = -1) {
  // Refetch when the path OR the preview version changed. Same-path edits keep
  // the path but bump the version (see _gcodeContentVersion).
  if (nextFile === _gcodeContentFile && version === _gcodeContentVersion) return;
  _gcodeContentFile = nextFile;
  _gcodeContentVersion = version;
  if (_gcodeFetchAbort) { _gcodeFetchAbort.abort(); _gcodeFetchAbort = null; }
  if (!nextFile) {
    gcodeContent.value = null;
    return;
  }
  const ac = new AbortController();
  _gcodeFetchAbort = ac;
  const target = nextFile;
  const ver = version;
  // `v` is a cache-buster: FileResponse sets an mtime ETag but no immutable
  // header, so a same-path refetch could otherwise be served from cache. The
  // gateway ignores the unknown query param.
  fetch(`/gcode?path=${encodeURIComponent(target)}&v=${ver}`, { signal: ac.signal })
    .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(text => {
      if (_gcodeContentFile === target && _gcodeContentVersion === ver) gcodeContent.value = text;
    })
    .catch(err => {
      if (err?.name !== "AbortError") {
        console.error("GET /gcode failed", err);
        if (_gcodeContentFile === target && _gcodeContentVersion === ver) gcodeContent.value = null;
      }
    });
}

// Off-main-thread preview loader (P4.1). The fetch + multi-MB msgpack decode +
// nested→flat conversion run in previewWorker so they don't block the UI thread
// (which starved the heartbeat worker → disarm-on-load). Staleness is handled by
// the version guard on the reply rather than an AbortController across the worker
// boundary; a superseded decode still completes off-thread but its result is
// dropped.
let _previewWorker: Worker | null = null;

function _ensurePreviewWorker(): Worker {
  if (_previewWorker) return _previewWorker;
  _previewWorker = new Worker(new URL("../previewWorker.ts", import.meta.url), { type: "module" });
  _previewWorker.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { version: number; gcode?: ViewerGcode; error?: string };
    if (m.version !== _previewLastVersion) return;  // stale — newer load in flight
    if (m.error) {
      console.error("preview load failed", m.error);
      _previewErr.value = `/preview failed: ${m.error}`;
      if (_previewLastVersion === m.version) _previewLastVersion = -1;  // allow retry
      return;
    }
    // markRaw: the payload holds transferred Float32Array/Uint32Array buffers;
    // letting Vue deep-proxy them would wrap the typed arrays in a Proxy, which
    // breaks/slows THREE.BufferAttribute's GPU upload. Consumers only react to
    // the ref reassignment, not deep mutation, so raw is correct here.
    viewerGcode.value = m.gcode ? markRaw(m.gcode) : null;
    _previewErr.value = null;
  };
  _previewWorker.onerror = (ev) => {
    console.error("previewWorker error", ev.message);
    _previewErr.value = `preview worker error: ${ev.message}`;
    _previewLastVersion = -1;
  };
  return _previewWorker;
}

function _fetchPreview(version: number) {
  if (version === _previewLastVersion) return;
  _previewLastVersion = version;
  _ensurePreviewWorker().postMessage({ version, url: `/preview?v=${version}` });
}

/** viewer_init frame: static machine description, once per WS connection. */
export function handleViewerInit(msg: { data?: ViewerInit | null }): void {
  viewerInit.value = msg.data ?? null;
}

/**
 * viewer_gcode frame — the empty-state path (file unloaded): gateway sends a
 * plain viewer_gcode with data.file = null. The "has data" case uses
 * viewer_gcode_ready.
 */
export function handleViewerGcode(msg: { data?: ViewerGcode | null }): void {
  viewerGcode.value = msg.data ?? null;
  _applyGcodeFile(msg.data?.file ?? null);
}

/**
 * viewer_gcode_ready frame: full preview lives on the server; fetch the cached
 * msgpack bytes via HTTP so multi-MB polylines don't ride the single-threaded
 * WS writer and stall the heartbeat loop. `version` is a cache-buster.
 */
export function handleViewerGcodeReady(msg: { version?: number; file?: string | null }): void {
  const version: number = msg.version ?? 0;
  const file: string | null = msg.file ?? null;
  _fetchPreview(version);
  _applyGcodeFile(file, version);
}

/** surface_points_ready: fetch + decode, then hand the data to the sink. */
export function fetchSurfacePoints(version: number, apply: (data: any) => void): void {
  _fetchBulk(
    "/surface_points", version,
    () => _surfaceLastVersion, v => { _surfaceLastVersion = v; },
    () => _surfaceFetchAbort, ac => { _surfaceFetchAbort = ac; },
    apply,
    e => { _surfaceErr.value = e; },
  );
}

/** comp_grid_ready: fetch + decode, then hand the data to the sink. */
export function fetchCompGrid(version: number, apply: (data: any) => void): void {
  _fetchBulk(
    "/comp_grid", version,
    () => _compGridLastVersion, v => { _compGridLastVersion = v; },
    () => _compGridFetchAbort, ac => { _compGridFetchAbort = ac; },
    apply,
    e => { _compGridErr.value = e; },
  );
}

/** tool_table_changed frame: bump so watchers re-fetch via get_tool_table. */
export function handleToolTableChanged(msg: { version?: number }): void {
  toolTableVersion.value = msg.version ?? 0;
}
