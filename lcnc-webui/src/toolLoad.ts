// LinuxCNC asked to load the tool table file — the client's half (TF-2, plan
// v3, Codex R476–R479): the comparison the dialog shows and what the tab says
// of a request. Pure. Never a claim that LinuxCNC loaded the file: a request
// an abort dropped beside a foreign write of the same values looks like a
// load, and STAT carries neither pocket nor remark. What is said is the
// REQUEST (its reply received) and, apart from it, what the read on screen
// shows — so the page keeps of its request only what it was made on and what
// the reply observed, and two facts of its history: already shown, and gone.
import { sameToolOwner, type ToolReadKind } from "./toolTableRead";
import type { ToolLoadBase, ToolReadOwner } from "./lcnc";

// ---- why the button is closed (the gateway's words else) -----------------------
export const LOAD_NOT_SERVED = "Gateway lacks this — restart it";
export const LOAD_NOT_READ = "Tool table not read — retry";
export const LOAD_COMPARING = "Comparing with LinuxCNC — wait";
// … and the dialog's confirm
export const LOAD_STALE = "Compared with LinuxCNC before — check again";
export const LOAD_DISCONNECTED = "Connection lost — check again";
export const LOAD_CONFIRM_REMOVED = "Confirm the removed tools first";
export const LOAD_CHECK_AGAIN = "Check again first";
/** The gateway's refusals that say the comparison is no longer today's (gateway
 *  TOOL_LOAD_*, tool_proof.LOAD_FILE_CHANGED — toolLoadWords.test holds the
 *  lists): the confirm closes and the acknowledgement goes at once, before any
 *  ping says so (Codex R491). */
export const LOAD_OUTDATED: ReadonlySet<string> = new Set([
  "Another LinuxCNC or table file — check again", "The file changed — check again",
  "LinuxCNC's table changed — check again", "Removed tools not confirmed — check again",
  "File changed while read — check again",
]);
/** "Not requested: <reason>." — at the tab and in the dialog. */
export const notRequested = (why: string) => `Not requested: ${why}.`;

// ---- the comparison (tool_table_preview) ----------------------------------------
export interface ToolLoadTool { T: number; name: string; Z: number; D: number }
export interface ToolLoadChange { T: number; name: string; fields: { f: string; now: number; file: number }[] }
export interface ToolLoadPreview {
  base: ToolLoadBase;
  basis: "partial" | "complete";
  /** when the file was last saved, ms */
  savedAt: number | null;
  /** the tool in the spindle (0: none) */
  spindle: number;
  removed: ToolLoadTool[]; changed: ToolLoadChange[]; added: ToolLoadTool[];
  /** why a load with removed tools is not requested (the gateway's switch), else null */
  removalRefusal: string | null;
}

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const text = (x: unknown): x is string => typeof x === "string";
const HEX64 = /^[0-9a-f]{64}$/;

function readBase(b: any): ToolLoadBase | null {
  return b && text(b.path) && b.path && text(b.instance) && text(b.ini) && text(b.link)
    && text(b.rev) && HEX64.test(b.rev) && text(b.memory) && HEX64.test(b.memory)
    ? { path: b.path, instance: b.instance, ini: b.ini, link: b.link, rev: b.rev, memory: b.memory } : null;
}
function readTools(l: unknown): ToolLoadTool[] | null {
  if (!Array.isArray(l) || !l.every(t => Number.isInteger(t?.T) && num(t.Z) && num(t.D))) return null;
  return l.map(t => ({ T: t.T, name: text(t.name) ? t.name : "", Z: t.Z, D: t.D }));
}
function readChanges(l: unknown): ToolLoadChange[] | null {
  if (!Array.isArray(l)) return null;
  const ok = l.every(t => Number.isInteger(t?.T) && Array.isArray(t.fields) && t.fields.length > 0
    && t.fields.every((f: any) => text(f?.f) && num(f.now) && num(f.file)));
  return ok ? l.map(t => ({ T: t.T, name: text(t.name) ? t.name : "",
                            fields: t.fields.map((f: any) => ({ f: f.f, now: f.now, file: f.file })) })) : null;
}

/** A preview's reply: the comparison, or why there is none. A reply that is
 *  not whole is no comparison (an older or another gateway). */
export function readPreview(reply: any, noReply: string): ToolLoadPreview | { refusal: string } {
  if (reply == null) return { refusal: noReply };
  if (!reply.ok) return { refusal: text(reply.error) && reply.error ? reply.error : LOAD_NOT_SERVED };
  if (text(reply.refusal) && reply.refusal) return { refusal: reply.refusal };
  const base = readBase(reply.base), removed = readTools(reply.removed), changed = readChanges(reply.changed), added = readTools(reply.added);
  if (reply.refusal !== null || !base || !removed || !changed || !added || !Number.isInteger(reply.spindle)
      || (reply.basis !== "partial" && reply.basis !== "complete")) return { refusal: LOAD_NOT_SERVED };
  return { base, basis: reply.basis, savedAt: num(reply.saved_at) ? reply.saved_at * 1000 : null, spindle: reply.spindle,
           removed, changed, added, removalRefusal: text(reply.removal_refusal) ? reply.removal_refusal : null };
}

/** The time of day a file was saved, "14:02:11". */
function clock(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms), p = (n: number) => String(n).padStart(2, "0");
  return `, saved ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/** "tool.tbl, saved 14:02:11: 2 removed, 1 changed, 3 added." */
export function loadCounts(p: ToolLoadPreview): string {
  const file = p.base.path.split("/").pop() || p.base.path;
  const parts = [p.removed.length && `${p.removed.length} removed`, p.changed.length && `${p.changed.length} changed`,
                 p.added.length && `${p.added.length} added`].filter(Boolean);
  return `${file}${clock(p.savedAt)}: ${parts.length ? parts.join(", ") : "same tools and values as LinuxCNC"}.`;
}
export const loadReplaces = (p: ToolLoadPreview) => p.removed.length + p.changed.length > 0;
export const LOAD_NOT_COMPARED = "Pockets and remarks are not compared. The tool library stays as it is.";
export const LOAD_COMPLETE_BASIS = "LinuxCNC shows no pockets or remarks — whether it takes them cannot be shown.";
export const LOAD_IRREVERSIBLE = "LinuxCNC's values of these tools are replaced. This cannot be undone.";
/** The tool in the spindle is among the changed ones (it can never be a removed one). */
export function loadSpindleNote(p: ToolLoadPreview): string | null {
  return p.changed.some(c => c.T === p.spindle) ? `T${p.spindle} is in the spindle — its offset in effect stays until the next G43.` : null;
}
export const loadRemoveLabel = (p: ToolLoadPreview) =>
  `Remove ${p.removed.length} tool${p.removed.length === 1 ? "" : "s"} from LinuxCNC`;

/** A value as a person reads it: up to six decimals, no trailing zeros, a real minus. */
function value(v: number): string {
  const t = v.toFixed(6).replace(/\.?0+$/, "");
  return (t === "-0" ? "0" : t).replace(/^-/, "−");
}
/** Two values that differ never read the same. */
function fromTo(now: number, file: number): string {
  const a = value(now), b = value(file);
  return a === b ? `${String(now).replace(/^-/, "−")} → ${String(file).replace(/^-/, "−")}` : `${a} → ${b}`;
}
const letter = (f: string) => (f === "D" ? "Ø" : f);

export interface ToolLoadRow { key: string; tool: string; name: string; text: string }
/** The list: removed → changed → added. */
export function loadRows(p: ToolLoadPreview): ToolLoadRow[] {
  const one = (kind: string, t: ToolLoadTool): ToolLoadRow =>
    ({ key: `${kind}${t.T}`, tool: `T${t.T}`, name: t.name, text: `${kind} · Z ${value(t.Z)} · Ø ${value(t.D)}` });
  return [...p.removed.map(t => one("Removed", t)),
          ...p.changed.map(t => ({ key: `Changed${t.T}`, tool: `T${t.T}`, name: t.name,
                                   text: t.fields.map(f => `${letter(f.f)} ${fromTo(f.now, f.file)}`).join(" · ") })),
          ...p.added.map(t => one("Added", t))];
}
/** How many rows the list shows at first, and more each time its end comes into view. */
export const LOAD_ROWS_STEP = 200;

// ---- what the tab says of a request (§2.5) ---------------------------------------
export interface ToolLoadResult {
  base: ToolLoadBase;
  /** "complete": the values matched before the request */
  basis: "partial" | "complete";
  values: "shown" | "not shown" | "not awaited";
  why: string | null;
  /** a read has shown it: from then on a read that does not ends it */
  shown: boolean;
  /** under another owner, its wait ended by that: says so until dismissed */
  foreign: boolean;
}
/** The read on screen, as far as a result asks it. */
export interface ToolLoadSeen { kind: ToolReadKind; owner: ToolReadOwner | null; rev: string | null }

const WHY: Record<string, string> = {
  "in time": "LinuxCNC did not show them in time",
  "file changed": "the file changed meanwhile",
  "superseded": "a newer table write came",
  "controller changed": "connection to LinuxCNC changed",
  "unknown": "its outcome is unknown",
};

/** What is kept of a RECEIVED `ok: true, load: requested` reply — null for
 *  anything else: a refusal, a lost reply. */
export function toolLoadResult(reply: any, base: ToolLoadBase): ToolLoadResult | null {
  if (!reply?.ok || reply.load !== "requested") return null;
  const values = reply.values === "shown" || reply.values === "not awaited" ? reply.values : "not shown";
  return { base: { ...base }, basis: reply.basis === "complete" ? "complete" : "partial", values,
           why: values === "not shown" ? (text(reply.why) && reply.why in WHY ? reply.why : "unknown") : null,
           shown: false, foreign: false };
}

/** Does this read SHOW the request's file values: the same owner, the same
 *  revision, rule R complete? */
export function showsLoad(read: ToolLoadSeen, base: ToolLoadBase): boolean {
  return read.kind === "complete" && read.owner !== null && sameToolOwner(read.owner, base) && read.rev === base.rev;
}

/** What is kept after an APPLIED read (a read under way, a closed connection:
 *  no step — what is kept stays kept). null: gone for good, no later read
 *  brings it back. A failed read names no owner: it proves no other one —
 *  before the first time shown it is unknown, after it the end. */
export function toolLoadStep(r: ToolLoadResult | null, read: ToolLoadSeen): ToolLoadResult | null {
  if (!r || r.foreign) return r;
  if (read.owner && !sameToolOwner(read.owner, r.base))
    return !r.shown && r.why === "controller changed" ? { ...r, foreign: true } : null;
  if (showsLoad(read, r.base)) return r.shown ? r : { ...r, shown: true };
  return r.shown ? null : r;
}

export interface ToolLoadNote { tone: "ok" | "warn"; text: string }
const NOT_COMPARED = "pockets and remarks are not compared.";

/** What the tab says, from the read on screen — never from the reply alone.
 *  `lead`: say that a load was requested (not where the write note does). */
export function toolLoadNote(r: ToolLoadResult | null, read: ToolLoadSeen | null, lead = true): ToolLoadNote | null {
  if (!r || !read) return null;
  const warn = (what: string): ToolLoadNote =>
    ({ tone: "warn", text: lead ? `Load requested, ${what}` : what[0]!.toUpperCase() + what.slice(1) });
  if (r.foreign) return warn(`values not shown — ${WHY["controller changed"]}.`);
  if (showsLoad(read, r.base)) {
    const shows = r.basis === "complete" ? `LinuxCNC shows the file's tool values, as before; ${NOT_COMPARED}`
      : `LinuxCNC now shows the file's tool values; ${NOT_COMPARED}`;
    return { tone: "ok", text: lead ? `Load requested. ${shows}` : shows };
  }
  if (r.values === "not awaited") return warn("not awaited — the table shows the result.");
  return warn(`values not shown — ${r.values === "shown" ? "the table changed since" : WHY[r.why ?? "unknown"]}.`);
}
