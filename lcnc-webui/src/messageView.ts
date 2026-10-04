// What the message center shows (pure): the rows for a search, a filter and
// a sort — laid out like the G-code reference and the Macros tab (operator
// 2026-10-04: categorised, a sortable head, a filter and a search row).
import type { LcncMessage } from "./ws/statusStore";

export type MessageType = "error" | "info" | "display";
export type MessageSource = "linuxcnc" | "webui";

/** LinuxCNC's six kinds as three types: NML/OPERATOR × ERROR / TEXT / DISPLAY. */
export function messageType(kind: number): MessageType {
  if (kind <= 2) return "error";
  if (kind <= 4) return "info";
  return "display";
}
export const TYPE_LABEL: Record<MessageType, string> = { error: "Error", info: "Info", display: "Display" };
export const SOURCE_LABEL: Record<MessageSource, string> = { linuxcnc: "LinuxCNC", webui: "WebUI" };

/** The filter's options: all, a type, or an origin (one select, like the
 *  Macros tab's bar filter). */
export const MESSAGE_FILTERS = [
  { value: "", label: "All messages" },
  { value: "type:error", label: "Errors" },
  { value: "type:info", label: "Info" },
  { value: "type:display", label: "Display" },
  { value: "source:linuxcnc", label: "From LinuxCNC" },
  { value: "source:webui", label: "From the WebUI" },
] as const;

export type MessageSortKey = "time" | "type" | "source";
export interface MessageQuery {
  search: string;
  filter: string;
  sortKey: MessageSortKey;
  /** time: ascending = oldest first. */
  asc: boolean;
}

/** A message's origin; one stored before origins were kept says nothing. */
export function sourceOf(m: LcncMessage): MessageSource | null {
  return m.source ?? null;
}

const TYPE_ORDER: Record<MessageType, number> = { error: 0, info: 1, display: 2 };
const SOURCE_ORDER: Record<MessageSource, number> = { linuxcnc: 0, webui: 1 };
/** An unknown origin sorts last either way round (localeCompare put "~" first). */
const sourceKey = (m: LcncMessage, dir: number) => { const s = sourceOf(m); return s ? SOURCE_ORDER[s] * dir : 99; };

export function messageRows(messages: readonly LcncMessage[], q: MessageQuery): LcncMessage[] {
  let rows = [...messages];
  if (q.filter.startsWith("type:")) {
    const t = q.filter.slice(5);
    rows = rows.filter(m => messageType(m.kind) === t);
  } else if (q.filter.startsWith("source:")) {
    const s = q.filter.slice(7);
    rows = rows.filter(m => sourceOf(m) === s);
  }
  const s = q.search.trim().toLowerCase();
  if (s) rows = rows.filter(m => m.text.toLowerCase().includes(s));
  const dir = q.asc ? 1 : -1;
  const byTime = (a: LcncMessage, b: LcncMessage) => (a.ts - b.ts) || (a.id - b.id);
  return rows.sort((a, b) => {
    if (q.sortKey === "type") return (TYPE_ORDER[messageType(a.kind)] - TYPE_ORDER[messageType(b.kind)]) * dir || -byTime(a, b);
    if (q.sortKey === "source") {
      return (sourceKey(a, dir) - sourceKey(b, dir)) || -byTime(a, b);
    }
    return byTime(a, b) * dir;
  });
}

/** One line for the clipboard. */
export function messageLine(m: LcncMessage, time: string): string {
  const src = sourceOf(m);
  return `[${TYPE_LABEL[messageType(m.kind)].toUpperCase()}${src ? " · " + SOURCE_LABEL[src] : ""}] ${time} — ${m.text}`;
}
