// The words for a program whose own preview or text is not on screen
// (P2b-F1-2 / F1-3, Codex R449 MT449-02/03, R450 MT450-02, R451). ONE state
// decider for the viewer HUD, the code panel, the Sim tab and the run banner
// — per kind of data: the preview's words end when the program's own
// payload is on screen, the code panel's when its own text is. The page's
// guard itself is the identity gate in ws/bulkData.ts; these words only say
// why something is not shown. Pure: no Vue.

/** What the page holds of the active program, per kind of data. */
export interface PreviewWaitInputs {
  /** The loaded program's path (status `active_file`); null: none. */
  activeFile: string | null;
  /** Its identity (status `program_id`); null while none is proven. */
  activeId: string | null;
  /** The program's OWN payload is on screen. */
  previewShown: boolean;
  /** The running/starting parse (`preview_refresh`): its identity and whether
   *  it is the program's first publication. */
  refresh: { programId: string | null; first: boolean } | null;
  /** The gateway's wait record (`preview_wait`). */
  wait: { programId: string; reasons: string[]; lastEnd: { job: number; why: string } | null } | null;
  /** The interpreter runs a program or MDI (not idle). */
  running: boolean;
  /** The run's start was verified against a publication (`run_basis.verified`). */
  runVerified: boolean;
  /** The program's own text: none announced yet, loading, on screen, failed, or
   *  without the proof that it is its publication's text. */
  textState: "none" | "loading" | "ok" | "failed" | "differs";
}

export interface PreviewWaitWords {
  /** The viewer's HUD line (a `.hudWarn`), null: none. */
  hud: string | null;
  /** Its help (≤ 120 characters). */
  help: string | null;
  /** The code panel's body instead of the text, null: the text shows. */
  panel: string | null;
  /** The run banner's addition (UPPERCASE in the banner), null: none. */
  banner: string | null;
  /** The Sim tab's empty state for a loaded program, null: its preview shows. */
  sim: string | null;
}

const NONE: PreviewWaitWords = { hud: null, help: null, panel: null, banner: null, sim: null };

/** The open actions' names, as the operator reads them. A name without one
 *  shows as it is (the gateway's command or writer name). */
export const WAIT_ACTION_LABELS: Record<string, string> = {
  mdi: "the MDI command",
  set_mode: "the mode switch",
  run_macro: "the macro",
  tool_change: "the tool change",
  go_to_zero: "the move to zero",
  set_kins_mode: "the kinematics switch",
  set_wcs: "the work offset write",
  clear_wcs: "the work offset write",
  touchoff: "the touch-off",
  twp_capture: "the plane capture",
  set_params: "the parameter write",
  probe_run: "probing",
  surface_scan_run: "the surface scan",
  tool_measure: "the tool measurement",
  tool_unload_measure: "the tool measurement",
  read_g30: "the G30 read",
  capture_g30: "the G30 read",
  set_g30: "the G30 write",
  save_tool: "the tool table write",
  add_tool: "the tool table write",
  delete_tool: "the tool table write",
  renumber_tool: "the tool table write",
  tool_import: "the tool import",
  load_file: "the program load",
  unload_file: "the program unload",
  program_file: "the program write",
  macro_file: "the macro write",
  tool_table_file: "the tool table write",
  var_file: "the parameter file write",
  var_file_rows: "the parameter file write",
};

/** A file writer's name (`…_file`, `var_file_rows`): named after a run too. */
const isWriter = (what: string) => /_file(_rows)?$/.test(what);
const label = (what: string) => WAIT_ACTION_LABELS[what] ?? what;

function waitHud(i: PreviewWaitInputs): { hud: string; help: string; banner: string | null } {
  const w = i.wait && i.wait.programId === i.activeId ? i.wait : null;
  if (!w) return { hud: "Preview not ready", help: "This program has no preview yet.", banner: null };
  const reasons = w.reasons;
  const what = (prefix: string) => reasons.filter(r => r.startsWith(prefix)).map(r => r.slice(prefix.length));
  const overdue = what("overdue:");
  const open = [...what("held:"), ...what("observed:")];
  if (reasons.includes("running") && i.running && !i.runVerified) {
    const writers = [...new Set([...overdue, ...open].filter(isWriter))];
    return {
      hud: writers.length ? `Preview after the run and ${label(writers[0]!)}` : "Preview after the run",
      help: "Started before its preview was ready. Path, limits and collision check follow after the run.",
      banner: "PREVIEW AFTER THE RUN",
    };
  }
  if (reasons.includes("running")) {
    return { hud: "Preview waits for the run", help: "The preview reads the machine's state; it waits while a program runs.", banner: null };
  }
  if (overdue.length) {
    return { hud: `Preview waits for ${label(overdue[0]!)} — still open`,
             help: `The preview reads the machine's state; it waits while ${label(overdue[0]!)} is open.`, banner: null };
  }
  if (open.length) {
    return { hud: `Preview waits for ${label(open[0]!)}`,
             help: `The preview reads the machine's state; it waits while ${label(open[0]!)} is open.`, banner: null };
  }
  if (reasons.includes("moving")) {
    return { hud: "Preview waits for standstill", help: "The preview reads the machine's state; it waits while the machine moves.", banner: null };
  }
  if (reasons.includes("debounce")) {
    return { hud: "Preview waits for the machine to settle", help: "The preview waits until no command has run for a moment.", banner: null };
  }
  if (reasons.includes("settle:rotary")) {
    return { hud: "Preview waits for the rotary axes to rest", help: "The preview reads the rotary pose; it waits while the rotary axes move.", banner: null };
  }
  if (w.lastEnd) {
    return { hud: "Preview not ready — last parse failed", help: `The last parse of this program ended without a preview (${w.lastEnd.why}).`, banner: null };
  }
  return { hud: "Preview not ready", help: "This program has no preview yet.", banner: null };
}

/** The preview's words as the code panel's, for a program whose text has not
 *  been announced yet: "Preview waits …" → "Text and preview wait …". */
function asTextAndPreview(hud: string): string {
  return hud.startsWith("Preview waits") ? `Text and preview wait${hud.slice("Preview waits".length)}`
    : `Text and preview${hud.slice("Preview".length)}`;
}

/** The words for the active program's missing preview and text. */
export function previewWaitWords(i: PreviewWaitInputs): PreviewWaitWords {
  if (!i.activeFile) return NONE;
  if (!i.activeId) return { ...NONE, panel: "Loading program", sim: "Loading program" };
  let preview: { hud: string; help: string; banner: string | null } | null = null;
  let loading = false;
  if (!i.previewShown) {
    if (i.refresh && i.refresh.programId === i.activeId) {
      loading = true;   // its parse runs: the viewer's re-parse line says it ("Preview loading" for a first)
    } else {
      preview = waitHud(i);
    }
  }
  let panel: string | null = null;
  if (i.textState === "loading") panel = "Program text loading";
  else if (i.textState === "failed") panel = "Program text not loaded — reload the program";
  else if (i.textState === "differs") panel = "Program text differs from its preview — reload the program";
  else if (i.textState === "none") panel = asTextAndPreview(preview?.hud ?? "Preview loading");
  const sim = i.previewShown ? null : (preview?.hud ?? (loading ? "Preview loading" : "Preview not ready"));
  return { hud: preview?.hud ?? null, help: preview?.help ?? null, panel, banner: preview?.banner ?? null, sim };
}
