// A program LOAD as the gateway names it (P2b-F1, Codex R449 MT449-02, R450
// C3): ONE helper for every spec that shows a program. The load's identity is
// fixed when the load is CREATED (`newLoad`); every frame and answer made from
// it carries that identity — a frame sent later keeps it, nothing stamps a
// frame at its send. A spec that needs a foreign, a missing or a null
// identity builds that frame itself (they stay sendable).
//
// - the status names the load: `active_file` + `program_id`;
// - an announcement names its publication's identity and the fingerprint of
//   the text it was parsed from (`origin.source`);
// - GET /gcode names the fingerprint of exactly its bytes (X-Program-Source):
//   the page shows a text as its publication's only when the two agree;
// - GET /preview names the pair it serves; the mock serves the asked one.
import { createHash } from "node:crypto";
import type { BrowserContext, Page, Route } from "@playwright/test";
import { ctl } from "./ctl";

export interface Load {
  file: string;
  /** `<epoch>.<n>` like the gateway's; null = no program proven. */
  id: string | null;
  /** The sha256 of the program text this load's publications were parsed from. */
  source: string | null;
}

let _seq = 0;
/** The fingerprint the gateway gives a text (sha256 of its bytes, hex). */
export const sourceOf = (text: string): string => createHash("sha256").update(text).digest("hex");

/** A new load of `file` whose text is `text` — a NEW identity every time
 *  (the same path loaded again is another load). */
export function newLoad(file: string, text: string | null = null, id?: string | null): Load {
  return { file, id: id === undefined ? `mock.${++_seq}` : id, source: text == null ? null : sourceOf(text) };
}

/** The status fields that name the load. */
export const loadStatus = (load: Load): Record<string, unknown> => ({ active_file: load.file, program_id: load.id });

/** The announcement of the load's publication `version`. */
export function announcement(load: Load, version: number): Record<string, unknown> {
  return { type: "viewer_gcode_ready", version, file: load.file, program_id: load.id, origin: { source: load.source } };
}

/** The status names the load (with `data`), then its publication is announced. */
export async function publish(load: Load, version: number, data: Record<string, unknown> = {}): Promise<void> {
  await ctl({ op: "status_delta", data: { ...loadStatus(load), ...data } });
  await ctl({ op: "raw", frame: announcement(load, version) });
}

/** Only the announcement (the status already names the load). */
export async function announce(load: Load, version: number): Promise<void> {
  await ctl({ op: "raw", frame: announcement(load, version) });
}

type Fulfill = Parameters<Route["fulfill"]>[0];

/** A GET /preview answer naming the pair it was asked for — the gateway
 *  serves the asked pair (else 409); which publication that is, the
 *  announcement the page followed decided. */
export function fulfillPreview(r: Route, opts: NonNullable<Fulfill>): Promise<void> {
  const q = new URL(r.request().url()).searchParams;
  return r.fulfill({ ...opts, headers: { ...(opts.headers ?? {}),
    "X-Preview-Version": q.get("v") ?? "", "X-Preview-Program": q.get("p") ?? "" } });
}

/** A GET /gcode answer naming the fingerprint of exactly its bytes. */
export function fulfillText(r: Route, opts: NonNullable<Fulfill> & { body: string }): Promise<void> {
  return r.fulfill({ contentType: "text/plain", ...opts,
    headers: { ...(opts.headers ?? {}), "X-Program-Source": sourceOf(opts.body) } });
}

// ── One load per file, for the specs that show a program ──
// (a publication of the same file again is a re-parse of the SAME load —
// its identity kept, its text's source the one given last)
const _loads = new Map<string, Load>();
/** The load of `file` this spec file shows, made once; `text` (when given)
 *  names the text its publications are parsed from from now on. */
export function loadOf(file: string, text: string | null = null): Load {
  let l = _loads.get(file);
  if (!l) { l = newLoad(file, text); _loads.set(file, l); }
  else if (text != null) { l = { ...l, source: sourceOf(text) }; _loads.set(file, l); }
  return l;
}
/** Publish version `version` of the load of `file` (parsed from `text`): the
 *  status names the load's identity (and `data`), then the announcement. */
export async function publishFile(file: string, version: number, text: string | null = null,
                                  data: Record<string, unknown> = {}): Promise<void> {
  const load = loadOf(file, text ?? _served);
  await ctl({ op: "status_delta", data: { program_id: load.id, ...data } });
  await ctl({ op: "raw", frame: announcement(load, version) });
}

// ── The text a spec serves at GET /gcode ──
// Fixed when the route is installed; the publications that follow name its
// fingerprint (the text a spec serves IS the text its program was parsed
// from — unless the spec says otherwise, passing another text or source).
let _served: string | null = null;
/** Serve `text` at GET /gcode (with its fingerprint); `publishFile` without a
 *  text of its own names this one from now on. */
export async function routeText(target: Page | BrowserContext, text: string): Promise<void> {
  _served = text;
  await target.route(/\/gcode(\?|$)/, r => fulfillText(r, { contentType: "text/plain", body: text }));
}
/** The text routeText serves now (null: none). */
export const servedText = (): string | null => _served;
