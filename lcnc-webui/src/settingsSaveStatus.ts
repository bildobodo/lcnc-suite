// The honest state of a server-side settings save (UX-08). `saveSection`
// (defaults.ts) used to be fire-and-forget: a debounced send whose reply
// nobody read, a silent no-op before the server's settings arrived and a
// console line when no saver was registered — while the Settings header
// promised "saved automatically". This module holds ONE status the header
// shows, derived from a LEDGER per section (review round 5, UI-I12): every
// change is a revision; a reply confirms only the revision it was sent
// for; a section reads "saved" only once its LATEST revision is confirmed,
// and a failed or blocked section stays visible behind every other
// section's success until its own retry succeeds. The first version kept
// one global state and a set of request ids: a foreign section's ok wiped
// a failure, and an old reply said "Saved" while the next change was
// still in the debounce. Driven by defaults.ts (pending / sent / blocked /
// failed, beaconed) and lcncWs.ts (the correlated reply, the server's
// state, a lost connection). Pure state — no transport.
//
// The page-hide path (round 6, UI-I12 rest): a change still in the debounce
// when the page is hidden goes out through `navigator.sendBeacon` and its
// timer is cleared — no WS request, no correlated reply. Such a revision is
// `unconfirmed` until the gateway's next full settings blob
// (`settings_changed` after the save, `settings_init` on a reconnect)
// carries the section: equal to what was sent → saved; different → not on
// the server (an error that a later matching blob corrects — a broadcast
// raised by another client can precede the beacon's own). `sendBeacon()`
// returning true is a hand-off, never a confirmation.
import { reactive } from "vue";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error" | "blocked" | "unconfirmed";

export const saveStatus = reactive({
  state: "idle" as SaveState,
  /** Why it failed / is blocked — operator wording, no codes; names the section(s). */
  detail: "",
  /** The section(s) the status is about, comma-separated. */
  section: "",
});

interface SectionLedger {
  /** The latest change (0 = never changed). */
  rev: number;
  /** The latest revision handed to the transport. */
  sentRev: number;
  /** The latest revision the gateway confirmed. */
  ackedRev: number;
  /** The latest revision that was refused, could not be sent or was blocked. */
  failedRev: number;
  failKind: "error" | "blocked";
  detail: string;
  /** The latest revision handed to sendBeacon on page hide, and its data. */
  beaconRev: number;
  beaconJson: string;
}

const _sections = new Map<string, SectionLedger>();
/** Saves on the wire, by the `req_id` the gateway echoes on every reply. */
const _inflight = new Map<string, { section: string; rev: number }>();

function ledger(section: string): SectionLedger {
  let s = _sections.get(section);
  if (!s) {
    s = { rev: 0, sentRev: 0, ackedRev: 0, failedRev: 0, failKind: "error", detail: "", beaconRev: 0, beaconJson: "" };
    _sections.set(section, s);
  }
  return s;
}

export type SectionSaveState = "pending" | "saving" | "saved" | "error" | "blocked" | "unconfirmed";

/** One section's state, from its ledger — null while it never changed. */
export function sectionSaveState(section: string): SectionSaveState | null {
  const s = _sections.get(section);
  if (!s || s.rev === 0) return null;
  if (s.ackedRev === s.rev) return "saved";
  if (s.failedRev === s.rev) return s.failKind;
  if (s.beaconRev === s.rev) return "unconfirmed";
  return s.sentRev === s.rev ? "saving" : "pending";
}

/** JSON with sorted object keys, so a blob the gateway re-serialised
 *  compares equal to the data this client sent. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** The header's status is the worst section: an unresolved failure or
 *  block outranks a save in progress, which outranks an unconfirmed
 *  page-hide save, which outranks "Saved". */
function recompute(): void {
  const errors: string[] = [], blocked: string[] = [], moving: string[] = [], unconfirmed: string[] = [], saved: string[] = [];
  let anySent = false;
  for (const [name, s] of _sections) {
    const st = sectionSaveState(name);
    if (st === "error") errors.push(`${name}: ${s.detail}`);
    else if (st === "blocked") blocked.push(`${name}: ${s.detail}`);
    else if (st === "saving" || st === "pending") { moving.push(name); if (st === "saving") anySent = true; }
    else if (st === "unconfirmed") unconfirmed.push(name);
    else if (st === "saved") saved.push(name);
  }
  if (errors.length) { saveStatus.state = "error"; saveStatus.detail = errors.join("; "); saveStatus.section = errors.map(e => e.split(":")[0]).join(", "); return; }
  if (blocked.length) { saveStatus.state = "blocked"; saveStatus.detail = blocked.join("; "); saveStatus.section = blocked.map(e => e.split(":")[0]).join(", "); return; }
  saveStatus.detail = "";
  if (moving.length) { saveStatus.state = anySent ? "saving" : "pending"; saveStatus.section = moving.join(", "); return; }
  if (unconfirmed.length) { saveStatus.state = "unconfirmed"; saveStatus.detail = unconfirmed.join(", "); saveStatus.section = unconfirmed.join(", "); return; }
  if (saved.length) { saveStatus.state = "saved"; saveStatus.section = saved.join(", "); return; }
  saveStatus.state = "idle"; saveStatus.section = "";
}

/** A change is waiting for the debounce flush: a new revision. */
export function noteSavePending(section: string): void {
  const s = ledger(section);
  s.rev++;
  recompute();
}

/** The change was refused before the wire (no server settings yet) — it is
 *  not cached either, so the section stays "not saved" until a later change. */
export function noteSaveBlocked(section: string, reason: string): void {
  const s = ledger(section);
  s.rev++; s.failedRev = s.rev; s.failKind = "blocked"; s.detail = reason;
  recompute();
}

/** The flush could not hand the latest revision to the transport. */
export function noteSaveFailed(section: string, reason: string): void {
  const s = ledger(section);
  if (s.rev === 0) s.rev = 1;
  s.failedRev = s.rev; s.failKind = "error"; s.detail = reason;
  recompute();
}

/** The latest revision went out under `reqId`; the reply decides. */
export function noteSaveSent(section: string, reqId: string): void {
  const s = ledger(section);
  if (s.rev === 0) s.rev = 1;
  s.sentRev = s.rev;
  _inflight.set(reqId, { section, rev: s.rev });
  recompute();
}

/** A reply arrived. True when it belonged to a settings save. It confirms
 *  (or fails) exactly the revision it was sent for — never a newer one. */
export function noteSaveReply(reqId: string, ok: boolean, error?: string): boolean {
  const sent = _inflight.get(reqId);
  if (sent === undefined) return false;
  _inflight.delete(reqId);
  const s = ledger(sent.section);
  if (ok) {
    if (sent.rev > s.ackedRev) s.ackedRev = sent.rev;
  } else if (sent.rev > s.ackedRev && sent.rev >= s.failedRev) {
    s.failedRev = sent.rev; s.failKind = "error"; s.detail = error || "rejected by the gateway";
  }
  recompute();
  return true;
}

/** The latest revision left through sendBeacon on page hide (the debounce
 *  timer is gone, no WS request follows): unconfirmed until the server's
 *  state shows it; a refused hand-off is a failure. */
export function noteSaveBeaconed(section: string, data: unknown, handedOff: boolean): void {
  const s = ledger(section);
  if (s.rev === 0) s.rev = 1;
  if (!handedOff) {
    s.failedRev = s.rev; s.failKind = "error"; s.detail = "not sent on page hide";
  } else {
    s.beaconRev = s.rev; s.beaconJson = stableJson(data);
  }
  recompute();
}

/** The gateway's full settings blob (settings_changed / settings_init):
 *  the only confirmation a page-hide save can get. The blob is COMPLETE —
 *  the gateway always sends the whole per-INI store (see updateServerCache
 *  in defaults.ts) — so a section it carries equal to the beaconed data is
 *  saved, and a different or ABSENT one is not on the server (round 7,
 *  UI-I12 rest B: skipping an absent section left a first beacon that never
 *  arrived "unconfirmed" for good); a later blob that matches corrects it.
 *  The store caches only written states (settings_store.py), so an equal
 *  section is a stored one. */
export function noteSaveServerState(settings: Record<string, unknown> | null | undefined): void {
  if (!settings || typeof settings !== "object") return;
  let moved = false;
  for (const [name, s] of _sections) {
    if (s.rev === 0 || s.beaconRev !== s.rev || s.ackedRev === s.rev) continue;
    const present = Object.prototype.hasOwnProperty.call(settings, name);
    if (present && stableJson(settings[name]) === s.beaconJson) {
      s.ackedRev = s.rev;
    } else if (s.failedRev !== s.rev) {
      s.failedRev = s.rev; s.failKind = "error"; s.detail = "page-hide save not on the server — change it again";
    }
    moved = true;
  }
  if (moved) recompute();
}

/** The socket closed: every section whose latest revision is not confirmed
 *  is not saved — in flight or still in the debounce alike. A page-hide
 *  save went by HTTP and waits for the server's state on reconnect. */
export function noteSaveConnectionLost(): void {
  _inflight.clear();
  for (const s of _sections.values()) {
    if (s.rev === 0 || s.ackedRev === s.rev || s.failedRev === s.rev || s.beaconRev === s.rev) continue;
    s.failedRev = s.rev; s.failKind = "error"; s.detail = "connection lost — not saved";
  }
  recompute();
}

/** The header text for a state — empty while nothing has been saved yet. */
export function saveStatusText(s: { state: SaveState; detail: string } = saveStatus): string {
  switch (s.state) {
    case "pending":
    case "saving": return "Saving…";
    case "saved": return "Saved";
    case "error": return `Save failed — ${s.detail}`;
    case "blocked": return `Not saved — ${s.detail}`;
    case "unconfirmed": return `Sent on page hide — not yet confirmed (${s.detail})`;
    default: return "";
  }
}

export function resetSaveStatusForTests(): void {
  _inflight.clear(); _sections.clear();
  saveStatus.state = "idle"; saveStatus.detail = ""; saveStatus.section = "";
}
