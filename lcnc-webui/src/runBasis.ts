// The run's start and the origin of the published preview (plan „Prüfung im
// Lauf“ 1a/1b, Codex R112–R115) — the wire shapes the status envelope carries
// as `run_basis` and `preview_origin`, read into typed values. Pure: no Vue.
//
// `run_basis` is taken by the gateway BEFORE an AUTO run or a first step from
// idle is written; `start` is the controller's state from a fresh poll then,
// in the status's own fields. A client never reconstructs a run's start from
// the first frame it sees — an early G92 / G43.1 may already have run (R113),
// and a client connecting mid-run never saw it at all.
import type { WcsTableRow } from "./viewer/wcsEpochs";

export interface RunStart {
  g5xIndex: number | null;
  g5xOffset: number[] | null;
  g92Offset: number[] | null;
  rotationXy: number | null;
  wcsTable: WcsTableRow[] | null;
  toolNumber: number | null;
  toolDiameter: number | null;
  toolLength: number | null;
  toolTableZ: number | null;
  toolOffset: number[] | null;
  /** The external Z offset at the start (the reader's): its value and its
   *  enable — null where the gateway read none (never an "off"). */
  eoffsetZ: number | null;
  eoffsetEnabled: boolean | null;
}

export type RunState = "sending" | "sent" | "unsent";

export interface RunBasis {
  runId: number;
  /** sent: the start was written; unsent: it failed (no run); sending: in flight. */
  state: RunState;
  file: string | null;
  source: string | null;
  version: number | null;
  ctxDigest: string | null;
  toolBasisRev: number;
  start: RunStart | null;
  /** The published preview is this program's start (gateway's direct comparison). */
  verified: boolean;
  why: string | null;
}

export interface ForRun {
  runId: number;
  ctxDigest: string | null;
  toolBasisRev: number;
}

export interface PreviewOrigin {
  version: number;
  file: string;
  source: string | null;
  reason: string;
  pinned: boolean;
  /** The run a pinned parse was planned for — and still belonged to at its publish. */
  forRun: ForRun | null;
  table: { mtime: number | null; rows: string } | null;
  /** The tool basis revision the payload was published with … */
  toolBasisRev: number;
  /** … and the revision now: a verify without a new version moves it. */
  toolBasisRevNow: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** A HAL bit as the reader ships it (bool, or 0 / 1); anything else unknown. */
const flag = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v === 0 || v === 1 ? v === 1 : null);
const vec = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every(x => typeof x === "number" && Number.isFinite(x)) ? (v as number[]).slice() : null;

function readStart(raw: unknown): RunStart | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const table = Array.isArray(s.wcs_table)
    ? (s.wcs_table as unknown[]).filter(r => r && typeof r === "object").map(r => ({ ...(r as WcsTableRow) }))
    : null;
  return {
    g5xIndex: num(s.g5x_index), g5xOffset: vec(s.g5x_offset), g92Offset: vec(s.g92_offset),
    rotationXy: num(s.rotation_xy), wcsTable: table,
    toolNumber: num(s.tool_number), toolDiameter: num(s.tool_diameter), toolLength: num(s.tool_length),
    toolTableZ: num(s.tool_table_z), toolOffset: vec(s.tool_offset),
    eoffsetZ: num(s.eoffset_z), eoffsetEnabled: flag(s.eoffset_enabled),
  };
}

/** `run_basis` from the envelope; null when absent or malformed (no run id
 *  or no known state — never a guessed run). */
export function parseRunBasis(raw: unknown): RunBasis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const runId = num(r.run_id);
  const state = r.state;
  if (runId == null || (state !== "sending" && state !== "sent" && state !== "unsent")) return null;
  return {
    runId, state, file: str(r.file), source: str(r.source), version: num(r.version),
    ctxDigest: str(r.ctx_digest), toolBasisRev: num(r.tool_basis_rev) ?? -1,
    start: readStart(r.start), verified: r.verified === true, why: str(r.why),
  };
}

function readForRun(raw: unknown): ForRun | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const runId = num(f.run_id), rev = num(f.tool_basis_rev);
  if (runId == null || rev == null) return null;
  return { runId, ctxDigest: str(f.ctx_digest), toolBasisRev: rev };
}

/** `preview_origin` from the envelope (or a viewer_gcode_ready ping); null
 *  when absent or malformed. */
export function parsePreviewOrigin(raw: unknown): PreviewOrigin | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const version = num(o.version), file = str(o.file);
  const rev = num(o.tool_basis_rev), revNow = num(o.tool_basis_rev_now);
  if (version == null || file == null || rev == null || revNow == null) return null;
  const t = o.table && typeof o.table === "object" ? (o.table as Record<string, unknown>) : null;
  return {
    version, file, source: str(o.source), reason: str(o.reason) ?? "", pinned: o.pinned === true,
    forRun: readForRun(o.for_run),
    table: t ? { mtime: num(t.mtime), rows: str(t.rows) ?? "" } : null,
    toolBasisRev: rev, toolBasisRevNow: revNow,
  };
}

/** A run in progress, as one status frame shows it: the gateway wrote its
 *  start (state sent), the task runs a program (AUTO) and the interpreter is
 *  not idle. An MDI after a run is no run (MODE_MDI) — its G92 is the
 *  operator's, not the program's; a start the controller refused leaves the
 *  interpreter idle. */
export function runInProgress(rb: RunBasis | null, taskMode: unknown, interpState: unknown,
                              modeAuto: number, interpIdle: number): boolean {
  return !!rb && rb.state === "sent" && taskMode === modeAuto && interpState != null && interpState !== interpIdle;
}
