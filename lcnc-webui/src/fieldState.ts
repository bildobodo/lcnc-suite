// A form field against the server (P5-2 a, plan v6 — Codex R440/R441; operator
// 2026-11-21/24): neutral (the server holds its value), a DRAFT (changed here,
// not held yet) or REFUSED (the server refused exactly this change).
//
// The identity is the CHANGE, not the value: every local edit of a field is a
// new change id, also when its value is one it had before, and an outcome
// belongs to the changes the save that got it carried. So a late refusal of
// the first 50 never marks the second 50, and another field's edit neither
// sets nor clears a field's refusal. Neutral is decided by the server's blob
// alone (an equal held value), never by an ack.
//
// A refusal for the writer's ARM is no refused field (operator 2026-11-24:
// disarmed controls are closed and say why on a press — never a red bar about
// arming): the change stays a draft. A lost connection refuses nothing.
// Pure state; defaults.ts feeds it.
import { ref } from "vue";

export type FieldState = "draft" | "refused" | null;

/** The gateway's reason of an unarmed writer (command_policy.NOT_ARMED). */
export const ARM_REFUSAL = "Not armed — press Arm";

interface Change { id: number; refused: string | null }

const _changes = new Map<string, Map<string, Change>>();
/** Saves on the wire: the changes each carries, by its `req_id`. */
const _sent = new Map<string, { section: string; ids: Map<string, number> }>();
/** The last save of a section was refused as stale: its change is gone, the
 *  form shows the server's state — said until the next edit or save. */
const _stale = new Map<string, string>();
let _next = 0;
const _version = ref(0);

function fieldsOf(section: string): Map<string, Change> {
  let m = _changes.get(section);
  if (!m) { m = new Map(); _changes.set(section, m); }
  return m;
}

/** Local edits: a new change per field. */
export function noteFieldsEdited(section: string, keys: readonly string[]): void {
  if (!keys.length) return;
  const m = fieldsOf(section);
  for (const k of keys) m.set(k, { id: ++_next, refused: null });
  _stale.delete(section);
  _version.value++;
}

/** The edits of a save that never reached the wire. */
export function noteFieldsBlocked(section: string, keys: readonly string[], why: string): void {
  const m = fieldsOf(section);
  for (const k of keys) { const c = m.get(k); if (c) c.refused = why; }
  _version.value++;
}

/** A save went out: it carries the section's changes as they are now. */
export function noteFieldsSent(section: string, reqId: string): void {
  _sent.set(reqId, { section, ids: new Map([...fieldsOf(section)].map(([k, c]) => [k, c.id])) });
}

/** Its answer, for exactly the changes it carried. */
export function noteFieldsReply(reqId: string, reply: { ok?: unknown; error?: unknown; stale?: unknown }): void {
  const s = _sent.get(reqId);
  if (!s) return;
  _sent.delete(reqId);
  const ok = reply.ok !== false;
  const why = typeof reply.error === "string" ? reply.error : "refused";
  if (!ok && why.startsWith(ARM_REFUSAL)) return;
  const m = fieldsOf(s.section);
  for (const [k, id] of s.ids) {
    const c = m.get(k);
    if (c && c.id === id) c.refused = ok ? null : why;
  }
  if (ok) _stale.delete(s.section);
  else if (reply.stale === true) _stale.set(s.section, why);
  _version.value++;
}

/** The socket closed: no answer comes any more — nothing is refused by it. */
export function noteFieldsConnectionLost(): void {
  _sent.clear();
}

const same = (a: unknown, b: unknown) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

/** Each field of `form` against what the server HOLDS of the section
 *  (`held`, fallbacks merged in). Reactive. */
export function fieldStates(section: string, form: object, held: object): Record<string, FieldState> {
  void _version.value;
  const m = _changes.get(section);
  const h = held as Record<string, unknown>;
  const out: Record<string, FieldState> = {};
  for (const [k, v] of Object.entries(form)) {
    out[k] = same(v, h[k]) ? null : m?.get(k)?.refused ? "refused" : "draft";
  }
  return out;
}

/** Why a change of the section was not saved — the first refused field's
 *  reason, or the stale save's; null: nothing refused. Reactive. */
export function sectionRefusal(section: string, states: Record<string, FieldState>): string | null {
  void _version.value;
  const m = _changes.get(section);
  for (const [k, st] of Object.entries(states)) {
    if (st === "refused") return m?.get(k)?.refused ?? "refused";
  }
  return _stale.get(section) ?? null;
}

export function resetFieldStatesForTests(): void {
  _changes.clear(); _sent.clear(); _stale.clear();
  _version.value++;
}
