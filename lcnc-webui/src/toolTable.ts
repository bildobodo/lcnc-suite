// The page's tool table (P6-c plan v8 §1.1): the ONE store (toolTableStore.ts)
// on the page's connection, as refs. The Tools tab and the strip import this —
// the current read and the form of a tool — and nothing of the evidence.
import { effectScope, ref, shallowRef, watch, type ShallowRef } from "vue";
import { connected, emitTelemetry, request, toolTableVersion, viewerInit } from "./lcncWs";
import type { FormState } from "./toolForm";
import { ToolTableStore, type CurrentRead } from "./toolTableStore";
import { toolUnitsPerMillimeter } from "./toolUnits";

/** A connection's first read waits for its greeting. */
const FETCH_DELAY_MS = 500;

const cur = shallowRef<CurrentRead>({ open: false, reading: false, view: null, table: null, error: null, applied: 0 });
/** The read on screen. */
export const currentTools: Readonly<ShallowRef<CurrentRead>> = cur;
const formsRev = ref(0);

/** The machine's length unit (units per mm) as the machine model last named it
 *  — a reconnect without one yet is no other unit. */
let lastUnits: number | null = null;
function units(): number | null {
  if (viewerInit.value) lastUnits = toolUnitsPerMillimeter(viewerInit.value.units);
  return lastUnits;
}

/** A library's records come one by one: at most one redraw of the table per
 *  FORMS_VIEW_MS (the last one always). */
const FORMS_VIEW_MS = 60;
let formsTimer: ReturnType<typeof setTimeout> | undefined;
function formsChanged() {
  formsTimer ??= setTimeout(() => { formsTimer = undefined; formsRev.value++; }, FORMS_VIEW_MS);
}

export const toolTableStore = new ToolTableStore({
  ask: (have, ms) => request({ cmd: "get_tool_table", ...(have ? { have_library: have } : {}) }, ms),
  units,
  onCurrent: c => { cur.value = c; },
  onForms: formsChanged,
  trace: emitTelemetry,
});

/** A tool's form, reactive: pending, its record, or no row of the library. */
export function toolForm(T: number | null | undefined): FormState {
  void formsRev.value;
  return T == null ? null : toolTableStore.formOf(T);
}

/** Reads the table again (a panel's Retry, a write, the tool in the spindle). */
export const readToolTable = (): Promise<void> => toolTableStore.read();

let started = false;
/** Starts the store with the first component that shows a table: a connection
 *  opens a read epoch and reads, a close ends it, another client's write (the
 *  gateway's ping) reads again — ONE read a ping for the whole page. */
export function useToolTable(): void {
  if (started) return;
  started = true;
  effectScope(true).run(() => {
    if (connected.value) { toolTableStore.opened(); void toolTableStore.read(); } else toolTableStore.closed();
    watch(connected, c => {
      if (!c) { toolTableStore.closed(); return; }
      // the state says it reads while the read waits its delay: no "Not connected"
      toolTableStore.opened();
      setTimeout(() => { if (connected.value) void toolTableStore.read(); }, FETCH_DELAY_MS);
    });
    watch(toolTableVersion, () => { void toolTableStore.read(); });
    // another length unit — or the first one, after a read that had none
    watch(units, () => {
      toolTableStore.unitsChanged();
      const c = toolTableStore.current;
      if (c.open && c.view) void toolTableStore.read();
    });
  });
}
