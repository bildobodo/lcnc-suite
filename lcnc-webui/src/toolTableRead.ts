// Tool files read, the client's half (P6, plan maschinentag.r465 v4 §6,
// Codex R461 C1-S / R465): what a `get_tool_table` reply may show, and which
// reply may apply at all. Pure — the Tools tab and the strip read through it.
//
// 1. An old connection's reply never applies, even after a sequence restart:
//    every read carries (epoch, seq); the epoch counts every connection OPEN
//    and is never reused in the page's life, seq restarts per connection; a
//    reply applies only for the current epoch's newest seq. A close ends the
//    epoch (nothing of it applies any more).
// 2. An error or a missing reply never shows as an empty table: `failed`
//    shows no rows ("Tool table not read."); `partial` shows the file's rows
//    with the named note — neutral, "file incomplete or differs from
//    LinuxCNC", never "is being written" (a paused writer and a closed
//    incomplete file look the same, Codex R465); "No tools" only for a
//    `complete` read with zero rows.
//    The note ends with what an edit would be refused with — the gateway's
//    own words (`edit_refusal`, tool_proof.partial_reason: cause and way
//    out; Codex R468 TF-1), never a second wording of them here.
// 3. An unread line without a readable T is attached to NOTHING: it is named
//    by its line number; a line with one whole T token names that tool.
// The gateway's rule R (tool_proof.py) proves the listed values per line
// within TOL — not P, not the remark, not an atomic snapshot.

/** get_tool_table's proof (tool_proof.compare + attempts). */
import type { ToolTableIdentity } from "./lcnc";

export interface ToolTableProof {
  state: "complete" | "partial" | "unchecked";
  proven: number[];
  differs: { T: number; fields: string[] }[];
  missing: number[];
  extra: number[];
  duplicates: number[];
  why: string | null;
  attempts?: number;
  /** the bytes end in a line end (false: the file ends inside a line) */
  ends_newline?: boolean;
}
/** A line the gateway did not read: its number and the tool it names (a
 *  single whole T token), else null. */
export interface UnreadLine { line: number; T: number | null }

export type ToolReadKind = "failed" | "complete" | "partial" | "unchecked";

export interface ToolTableView<R> {
  kind: ToolReadKind;
  /** the rows to show — none for `failed` */
  rows: R[];
  /** failed: why */
  error: string | null;
  /** partial / unchecked: the named note */
  note: string | null;
  /** what an empty table body says — "No tools" only for complete */
  empty: string;
  /** the tools a proof names as proven (complete: every row) */
  proven: ReadonlySet<number>;
  /** unread lines by the tool they name — only a readable T */
  unreadByTool: ReadonlyMap<number, number[]>;
  /** unread lines without a readable T: attached to no tool */
  unreadLoose: number[];
}

export const TOOL_TABLE_NOT_READ = "Tool table not read.";
export const TOOL_TABLE_NO_TOOLS = "No tools in the table. Add tools manually or import a Fusion 360 or FreeCAD library.";
export const TOOL_TABLE_NOT_CONFIRMED = "Tool table not confirmed.";
export const TOOL_TABLE_NOT_CHECKED = "Tool table not checked.";
/** a reply from a gateway that sends no proof (an older one) */
export const NO_PROOF = "the gateway sends no proof — restart it";
/** how many tools or lines a note names before it counts the rest */
export const NOTE_NAMES_MAX = 5;

function names(list: (number | string)[], fmt: (x: number | string) => string): string {
  const shown = list.slice(0, NOTE_NAMES_MAX).map(fmt).join(", ");
  return list.length > NOTE_NAMES_MAX ? `${shown} +${list.length - NOTE_NAMES_MAX}` : shown;
}

const isNums = (x: unknown): x is number[] => Array.isArray(x) && x.every(n => Number.isInteger(n));

function readProof(p: unknown): ToolTableProof | null {
  const q = p as Partial<ToolTableProof> | null;
  if (!q || (q.state !== "complete" && q.state !== "partial" && q.state !== "unchecked")) return null;
  if (!isNums(q.proven) || !isNums(q.missing) || !isNums(q.extra)) return null;
  const differs = Array.isArray(q.differs)
    ? q.differs.filter(d => d && Number.isInteger(d.T)).map(d => ({ T: d.T, fields: Array.isArray(d.fields) ? d.fields.map(String) : [] }))
    : [];
  return { state: q.state, proven: q.proven, differs, missing: q.missing, extra: q.extra,
           duplicates: isNums(q.duplicates) ? q.duplicates : [], why: typeof q.why === "string" ? q.why : null,
           attempts: typeof q.attempts === "number" ? q.attempts : undefined,
           ends_newline: typeof q.ends_newline === "boolean" ? q.ends_newline : undefined };
}

function readUnread(u: unknown): UnreadLine[] {
  if (!Array.isArray(u)) return [];
  return u.filter(x => x && Number.isInteger(x.line))
    .map(x => ({ line: x.line as number, T: Number.isInteger(x.T) ? (x.T as number) : null }));
}

/** The note of a partial read: neutral, the tools and lines named; then, in
 *  the gateway's words, why edits are refused and what to do about it. ONE
 *  fact is said once: the refusal names it with its way out. */
export function partialNote(proof: ToolTableProof, unread: UnreadLine[], editRefusal: string | null = null): string {
  const parts: string[] = [];
  const t = (x: number | string) => `T${x}`;
  if (proof.differs.length) parts.push(`${names(proof.differs.map(d => d.T), t)} ${proof.differs.length === 1 ? "differs" : "differ"}`);
  if (proof.missing.length) parts.push(`${names(proof.missing, t)} missing in the file`);
  if (proof.extra.length) parts.push(`${names(proof.extra, t)} not in LinuxCNC`);
  if (proof.duplicates.length) parts.push(`${names(proof.duplicates, t)} twice`);
  if (unread.length) parts.push(`${unread.length === 1 ? "line" : "lines"} ${names(unread.map(u => u.line), String)} not read`);
  if (proof.ends_newline === false) parts.push("the last line has no line end");
  if (!parts.length && proof.why === "file changed while read") parts.push("it changed while read");
  const facts = proof.differs.length + proof.missing.length + proof.extra.length + proof.duplicates.length
    + unread.length + (proof.ends_newline === false ? 1 : 0);
  if (editRefusal && parts.length === 1 && facts <= 1) return `Edits refused: ${editRefusal}.`;
  return `File incomplete or differs from LinuxCNC${parts.length ? " — " + parts.join("; ") : ""}.`
    + (editRefusal ? ` Edits refused: ${editRefusal}.` : "");
}

/** What a get_tool_table reply shows (null: the read got no reply). */
export function toolTableView<R extends { T: number }>(reply: any, noReply = "No reply from the gateway — retry"): ToolTableView<R> {
  const none = { proven: new Set<number>(), unreadByTool: new Map<number, number[]>(), unreadLoose: [] as number[] };
  if (!reply?.ok || !Array.isArray(reply.tools)) {
    const error = reply == null ? noReply : (typeof reply.error === "string" && reply.error ? reply.error : "Tool table unavailable");
    return { kind: "failed", rows: [], error, note: null, empty: TOOL_TABLE_NOT_READ, ...none };
  }
  const rows = reply.tools as R[];
  const unread = readUnread(reply.unread);
  const unreadByTool = new Map<number, number[]>();
  const unreadLoose: number[] = [];
  for (const u of unread) {
    if (u.T === null) unreadLoose.push(u.line);
    else unreadByTool.set(u.T, [...(unreadByTool.get(u.T) ?? []), u.line]);
  }
  const proof = readProof(reply.proof);
  if (!proof) {
    return { kind: "unchecked", rows, error: null, note: `Not checked against LinuxCNC — ${NO_PROOF}.`,
             empty: TOOL_TABLE_NOT_CHECKED, proven: new Set(), unreadByTool, unreadLoose };
  }
  if (proof.state === "complete") {
    return { kind: "complete", rows, error: null, note: null, empty: TOOL_TABLE_NO_TOOLS,
             proven: new Set(rows.map(r => r.T)), unreadByTool, unreadLoose };
  }
  if (proof.state === "unchecked") {
    return { kind: "unchecked", rows, error: null, note: `Not checked against LinuxCNC — ${proof.why ?? "no reason given"}.`,
             empty: TOOL_TABLE_NOT_CHECKED, proven: new Set(), unreadByTool, unreadLoose };
  }
  const refusal = typeof reply.edit_refusal === "string" && reply.edit_refusal ? reply.edit_refusal as string : null;
  return { kind: "partial", rows, error: null, note: partialNote(proof, unread, refusal), empty: TOOL_TABLE_NOT_CONFIRMED,
           proven: new Set(proof.proven), unreadByTool, unreadLoose };
}

// ---- a WRITTEN table's rest (Codex R471 MT-I42) ----------------------------
// `ok: true` to a tool edit or a full import means the table IS written; the
// reply names what came of its load into LinuxCNC (`reload`) and, only when
// they were not saved, of its metadata (`metadata`). Nothing of the edit is
// unsaved as a draft, so its dialog closes; what stays open is said in the
// tab. The read that follows the write says most of it already — a load not
// taken or not confirmed reads `partial` ("T5 differs from LinuxCNC — a
// restart loads the file"), an unread controller `unchecked` —, so a word of
// its own stands only where it cannot: a load that was not sent or failed,
// with a pocket or a remark (no part of rule R) or no rule R at all (a random
// changer), and the metadata, which no table read speaks of.

/** The load into LinuxCNC was not sent, or failed on its way. */
export const LOAD_FAILED = "load into LinuxCNC failed — restart loads it";
export const WRITE_NOT_LOADED = `Table saved, ${LOAD_FAILED}`;
export const WRITE_NO_METADATA = "Table saved, metadata not — check tool_library.json";

/** `of`: the table it was written to (the read the write began from) — null: not known. */
export interface ToolWriteOutcome { notLoaded: boolean; noMetadata: boolean; of: ToolTableIdentity | null }

/** What a written table's reply leaves open (a WS edit's, the import's). */
export function toolWriteOutcome(reply: any, of: ToolTableIdentity | null): ToolWriteOutcome {
  return { notLoaded: reply?.reload === "reload not sent" || reply?.reload === "reload failed",
           noMetadata: typeof reply?.metadata === "string", of };
}

/** No LinuxCNC bound: says nothing about one that started. */
const UNBOUND = "unbound";

/** What of it still stands once a read names its table `now` (Codex R472
 *  MT-I43). A lost socket proves nothing — nor does a `complete` read, which
 *  holds no pocket and no remark: it stands for the SAME table under the same
 *  LinuxCNC until it is dismissed or the next write takes its place. Another
 *  LinuxCNC on the same file loaded the file when it started; the metadata
 *  are still not saved. Another table file: not this table's outcome. No
 *  identity (a failed read, an older gateway, no LinuxCNC): nothing is proven. */
export function toolWriteStands(o: ToolWriteOutcome | null, now: ToolTableIdentity | null): ToolWriteOutcome | null {
  if (!o?.of || !now) return o;
  if (now.path !== o.of.path) return null;
  if (now.instance === o.of.instance || now.instance === UNBOUND || o.of.instance === UNBOUND) return o;
  return o.noMetadata ? { ...o, notLoaded: false, of: now } : null;
}

/** Its note beside the read of that kind (null: nothing to add). */
export function toolWriteNote(o: ToolWriteOutcome | null, read: ToolReadKind | null): string | null {
  // a partial read names the difference and the way out: one fact, said once;
  // with no read on screen (a closed connection) the next one decides it
  const notLoaded = !!o?.notLoaded && read !== null && read !== "partial";
  if (o?.noMetadata) return notLoaded ? `${WRITE_NO_METADATA}; ${LOAD_FAILED}.` : `${WRITE_NO_METADATA}.`;
  return notLoaded ? `${WRITE_NOT_LOADED}.` : null;
}

/** A read's ticket: the connection's epoch and the read's number in it. */
export interface ToolReadTicket { epoch: number; seq: number }

/** Which read's reply may apply (store point 1). */
export class ToolTableReads {
  private epoch = 0;
  private seq = 0;
  private open = false;

  /** A connection opened: a new epoch (never reused), seq from 1 again. */
  opened(): void { this.epoch += 1; this.seq = 0; this.open = true; }
  /** The connection closed: nothing of its epoch applies any more. */
  closed(): void { this.open = false; }
  get isOpen(): boolean { return this.open; }
  /** A new read: its ticket — the newest of the current epoch. */
  begin(): ToolReadTicket { this.seq += 1; return { epoch: this.epoch, seq: this.seq }; }
  /** Whether a reply to `t` applies NOW. */
  applies(t: ToolReadTicket): boolean { return this.open && t.epoch === this.epoch && t.seq === this.seq; }
}
