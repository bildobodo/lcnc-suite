// The honest state of a server-side settings save (UX-08). `saveSection`
// (defaults.ts) used to be fire-and-forget: a debounced send whose reply
// nobody read, a silent no-op before the server's settings arrived and a
// console line when no saver was registered — while the Settings header
// promised "saved automatically". This module holds ONE status the header
// shows: what the last save did, from the debounce to the gateway's reply,
// driven by defaults.ts (pending / sent / blocked / failed) and lcncWs.ts
// (the correlated reply, a lost connection). Pure state — no transport.
import { reactive } from "vue";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error" | "blocked";

export const saveStatus = reactive({
  state: "idle" as SaveState,
  /** Why it failed / is blocked — operator wording, no codes. */
  detail: "",
  /** The section the status is about (the last one that moved). */
  section: "",
});

/** Saves on the wire, by the `req_id` the gateway echoes on every reply. */
const _inflight = new Map<string, string>();

/** A change is waiting for the debounce flush. */
export function noteSavePending(section: string): void {
  saveStatus.state = "pending"; saveStatus.section = section; saveStatus.detail = "";
}

/** The save was refused before the wire (no server settings yet). */
export function noteSaveBlocked(section: string, reason: string): void {
  saveStatus.state = "blocked"; saveStatus.section = section; saveStatus.detail = reason;
}

/** The flush could not hand the save to the transport. */
export function noteSaveFailed(section: string, reason: string): void {
  saveStatus.state = "error"; saveStatus.section = section; saveStatus.detail = reason;
}

/** The save went out under `reqId`; the reply decides. */
export function noteSaveSent(section: string, reqId: string): void {
  _inflight.set(reqId, section);
  saveStatus.state = "saving"; saveStatus.section = section; saveStatus.detail = "";
}

/** A reply arrived. True when it belonged to a settings save. */
export function noteSaveReply(reqId: string, ok: boolean, error?: string): boolean {
  const section = _inflight.get(reqId);
  if (section === undefined) return false;
  _inflight.delete(reqId);
  saveStatus.section = section;
  if (!ok) { saveStatus.state = "error"; saveStatus.detail = error || "rejected by the gateway"; return true; }
  saveStatus.state = _inflight.size ? "saving" : "saved";
  saveStatus.detail = "";
  return true;
}

/** The socket closed: whatever was in flight or waiting is not saved. */
export function noteSaveConnectionLost(): void {
  const waiting = _inflight.size > 0 || saveStatus.state === "pending" || saveStatus.state === "saving";
  _inflight.clear();
  if (!waiting) return;
  saveStatus.state = "error"; saveStatus.detail = "connection lost — not saved";
}

/** The header text for a state — empty while nothing has been saved yet. */
export function saveStatusText(s: { state: SaveState; detail: string } = saveStatus): string {
  switch (s.state) {
    case "pending":
    case "saving": return "Saving…";
    case "saved": return "Saved";
    case "error": return `Save failed — ${s.detail}`;
    case "blocked": return `Not saved — ${s.detail}`;
    default: return "";
  }
}

export function resetSaveStatusForTests(): void {
  _inflight.clear(); saveStatus.state = "idle"; saveStatus.detail = ""; saveStatus.section = "";
}
