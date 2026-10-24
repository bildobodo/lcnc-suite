// The path's re-bake HOLD (VP188-02 E2, plan basiswechsel-last Fassung 4
// 3a, Codex R193/R194): while the gateway re-parses the loaded program, an
// offset change does not re-bake the drawn path — the parse's publication
// replaces it anyway (the S run: 7 of 8 bakes thrown away, each 73 ms on the
// main thread). Pure: the viewer feeds it the events and does what a step
// says; the drawn path's own state (current or behind) is pathBasis.ts.
//
//   free ── an admitted preview_refresh ──▶ parsing
//   parsing ── the refresh gone ──▶ after_parse (6 s: a supersede's gap)
//   parsing / after_parse ── the program's newer version arrives ──▶ loading (20 s)
//   after_parse ── a refresh again ──▶ parsing
//   loading ── that version adopted ──▶ free (the adoption bakes itself)
//
// Ending without an adoption — a window ran out, THIS decode failed, the
// connection, a run or the simulation — bakes once when a change was held:
// no change is lost. Another program ends it without (it brings its own).
//
// The collision check waits at the SAME hold (E1, plan Fassung 5 3e, Codex
// R197): beside the gateway's parse its restart took the browser's frames
// (the S runs: 153–162 of 180 a row; a file-time run without the restarts:
// 180). A check asked for while holding is noted apart from the bake and
// asked again once on an end without an adoption — an adoption schedules the
// new version's own check.

export type HoldState = "free" | "parsing" | "after_parse" | "loading";

/** The supersede gap's window (a cancelled parse restarts within a tick —
 *  37 ms in the S run — but the gateway's debounce may take 2 s). */
export const AFTER_PARSE_MS = 6000;
/** A chosen finite wait for the arrived version's adoption — no proof of a
 *  failure (Codex R193). */
export const LOADING_MS = 20000;

export interface Hold {
  state: HoldState;
  /** Bumped at every transition: a window's timer names it, an old one does
   *  nothing. */
  n: number;
  /** The displayed program the hold is for — its full path and published
   *  version — and the connection it began in. */
  owner: { file: string; version: number; epoch: number } | null;
  /** A re-bake was asked for while holding. */
  held: boolean;
  /** A collision re-check was asked for while holding (E1). */
  checkHeld: boolean;
  /** `loading`: the version that arrived. */
  loading: number | null;
  /** The current window's end (the caller's ms clock), null without one. */
  deadline: number | null;
}

export type HoldEvent =
  /** A parse of the program is in the status. `admitted`: connected, the
   *  interpreter known idle, no simulation, the displayed program — checked
   *  at EVERY refresh, not only at an edge. (No path scope since E1: the
   *  check follows the offsets for every program; a path outside the scope
   *  never asks to bake.) */
  | { kind: "refresh"; admitted: boolean; file: string; version: number; epoch: number }
  | { kind: "refreshGone"; now: number }
  | { kind: "arrival"; file: string; version: number; now: number }
  | { kind: "adopted"; file: string | null; version: number | null }
  | { kind: "decodeFailure"; file: string | null; version: number }
  | { kind: "deadline"; n: number }
  /** The connection, a run or the simulation (`catchUp`), another program
   *  (none). */
  | { kind: "end"; catchUp: boolean }
  /** A debounced re-bake is due. */
  | { kind: "bake" }
  /** A debounced collision re-check is due (E1). */
  | { kind: "check" };

export interface HoldStep {
  hold: Hold;
  /** Bake now (applyGcode on the displayed preview, live offsets). */
  bake: boolean;
  /** Check now (the collision re-check at the live state). */
  check: boolean;
}

export function freeHold(n = 0): Hold {
  return { state: "free", n, owner: null, held: false, checkHeld: false, loading: null, deadline: null };
}

function ended(h: Hold, catchUp: boolean): HoldStep {
  return { hold: freeHold(h.n + 1), bake: catchUp && h.held, check: catchUp && h.checkHeld };
}

export function holdStep(h: Hold, e: HoldEvent): HoldStep {
  const keep: HoldStep = { hold: h, bake: false, check: false };
  switch (e.kind) {
    case "bake":
      if (h.state === "free") return { hold: h, bake: true, check: false };
      return h.held ? keep : { hold: { ...h, held: true }, bake: false, check: false };
    case "check":
      if (h.state === "free") return { hold: h, bake: false, check: true };
      return h.checkHeld ? keep : { hold: { ...h, checkHeld: true }, bake: false, check: false };
    case "refresh":
      if (!e.admitted) return h.state === "free" ? keep : ended(h, true);
      if (h.state === "free") {
        return { hold: { state: "parsing", n: h.n + 1, owner: { file: e.file, version: e.version, epoch: e.epoch },
                         held: false, checkHeld: false, loading: null, deadline: null }, bake: false, check: false };
      }
      if (h.owner && (h.owner.file !== e.file || h.owner.epoch !== e.epoch)) return ended(h, true);
      if (h.state === "after_parse") return { hold: { ...h, state: "parsing", n: h.n + 1, deadline: null }, bake: false, check: false };
      return keep;   // parsing: another job of the burst; loading: its adoption decides
    case "refreshGone":
      if (h.state !== "parsing") return keep;
      return { hold: { ...h, state: "after_parse", n: h.n + 1, deadline: e.now + AFTER_PARSE_MS }, bake: false, check: false };
    case "arrival": {
      if (h.state === "free" || !h.owner || e.file !== h.owner.file) return keep;
      if (e.version <= h.owner.version || (h.loading != null && e.version <= h.loading)) return keep;
      return { hold: { ...h, state: "loading", n: h.n + 1, loading: e.version, deadline: e.now + LOADING_MS },
               bake: false, check: false };
    }
    case "adopted":
      if (h.state === "free" || !h.owner) return keep;
      if (e.file !== h.owner.file) return ended(h, false);          // another program
      if (e.version != null && e.version > h.owner.version) {
        return { hold: freeHold(h.n + 1), bake: false, check: false };   // the adoption bakes and checks
      }
      return keep;    // the same version again (a tool-basis re-decode)
    case "decodeFailure":
      if (h.state !== "loading" || !h.owner || e.file !== h.owner.file || e.version !== h.loading) return keep;
      return ended(h, true);
    case "deadline":
      if (e.n !== h.n || (h.state !== "after_parse" && h.state !== "loading")) return keep;
      return ended(h, true);
    case "end":
      return h.state === "free" ? keep : ended(h, e.catchUp);
  }
}
