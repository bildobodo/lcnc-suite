// The macro bar's items and a macro file's run state (package 5, stage C;
// plan docs/reviews/makros.plan.md). Pure — App and the Macros tab derive
// from the SAME functions, so the bar button, the tab's Run, a hold and the
// parameter dialog can never disagree about whether a macro may run.

import type { MacroFile, MacroFolder } from "./lcncApi";

/** The open macro editor's relation to its file (Codex VP69-05): the run of
 *  THAT file waits until the visible text and the file on disk agree. */
export interface MacroEditorBasis {
  name: string;
  state: "clean" | "draft" | "loading" | "conflict";
  /** The revision of the text the editor shows (its base); a CLEAN editor
   *  on another revision than the listed file is no basis to run that file
   *  (Codex R70 VP-I32). */
  revision?: string | null;
}

export interface MacroBarItem { key: string; label: string; file: MacroFile }

/** Why a macro FILE may not run now, or null: the open editor first (its
 *  visible text is what the operator believes runs), then the gateway's
 *  verdict (header error, shadowed, folder problem). */
export function macroRunBlock(file: MacroFile, editor: MacroEditorBasis | null): string | null {
  if (editor && editor.name === file.name) {
    if (editor.state === "draft") return "Unsaved edit — Save or Discard";
    if (editor.state === "loading") return "Loading macro — wait";
    if (editor.state === "conflict") return "Changed on disk — Reload or Keep editing";
    if (editor.state === "clean" && editor.revision !== undefined && editor.revision !== file.revision) {
      return "Editor shows another revision — wait";
    }
  }
  if (!file.runnable) return file.reason ?? "Macro cannot run";
  return null;
}

/** What a hold on a macro FILE is bound to: its name and revision — a save
 *  from any client during the hold cancels it (MachineBtn holdKey). */
export function fileHoldKey(file: MacroFile): string {
  return `file:${file.name}\n${file.revision}`;
}

/** The bar: the macro files named in `bar`, in its order. A name with no
 *  file is `missing` — shown once in the Macros tab, never silently dropped
 *  from the setting. */
export function macroBarItems(bar: string[] | undefined,
                              folder: MacroFolder | null): { items: MacroBarItem[]; missing: string[] } {
  const items: MacroBarItem[] = [];
  const missing: string[] = [];
  for (const name of bar ?? []) {
    const file = folder?.macros.find(f => f.name === name);
    if (!file) {
      if (folder) missing.push(name);   // before the first list nothing is known
      continue;
    }
    items.push({ key: `file:${name}`, label: file.title ?? name, file });
  }
  return { items, missing };
}

/** The unit a macro parameter shows: its declared kind in the macro's own
 *  UNITS (never the machine's — the entry rule makes the value mean that). */
export function macroParamUnit(unit: MacroFile["params"][number]["unit"], units: MacroFile["units"]): string {
  const len = units === "inch" ? "in" : "mm";
  switch (unit) {
    case "length": return len;
    case "feed": return `${len}/min`;
    case "angle": return "°";
    case "rpm": return "rpm";
    case "time": return "s";
    default: return "";
  }
}
