// The gateway's macro folder for the browser tests (package 5): an
// in-memory folder served through page.route — saves, imports and deletes
// change it for real, with sha256 revisions and the gateway's 409
// contracts, so a revision a client saw and a conflict behave as in the
// product. ONE mechanism for every spec that needs macro files (the earlier
// settings macros were dropped 2026-10-02). serve() may run after the page
// loaded: send `macros_changed` and the app reads the list again.
import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
import { readHeader } from "../src/macroHeader";

export const rev = (t: string) => createHash("sha256").update(t).digest("hex");

export const PARK = "(MACRO Park)\n(FRAME machine)\no<park> sub\n  M73\n  G90\n  G53 G0 Z0\no<park> endsub\n";
export const FACE = `(MACRO Face top)
(UNITS mm)
(PARAM 1 depth "Depth" length 0.5 min=0 max=5)
(PARAM 2 feed "Feed" feed 600 min=1)
o<face_top> sub
  M73
  G21 G90 G94
  G1 Z[-#1] F#2
o<face_top> endsub
`;

export interface Entry { text: string; meta: Record<string, unknown> }

/** The gateway's 409 body per refusal kind — scripts/test_fixtures/
 *  macro_refusals.json, which test_macros_gateway.RefusalShape holds the
 *  gateway to: the mock answers exactly what the route answers, with
 *  exactly its keys (Codex R70 VP-I31 — it used to add a revision the route
 *  never sent, and the specs passed on a Keep editing the product broke). */
const REFUSALS: Record<string, { kind: string; keys: string[]; reason?: string }> = JSON.parse(
  readFileSync(new URL("../../scripts/test_fixtures/macro_refusals.json", import.meta.url), "utf8"));
export type RefusalCase = "busy" | "conflict" | "deleted" | "exists" | "taken" | "outside";
export function refusal(c: RefusalCase, fields: { name?: string; revision?: string | null; reason?: string } = {}) {
  const spec = REFUSALS[c]!;
  const all: Record<string, unknown> = { error: "refused", kind: spec.kind, ...fields, reason: spec.reason ?? fields.reason };
  return { status: 409, json: { detail: Object.fromEntries(spec.keys.map(k => [k, all[k]])) } };
}

/** The gateway's macro folder, in memory. */
export class Folder {
  files = new Map<string, Entry>();
  problems: string[] = [];
  /** The gateway's verdict "may not run", by name (a header error, shadowed). */
  blocked = new Map<string, string>();
  /** A write refusal while a start is open or the interpreter runs (the
   *  gate's first check) — null: none. */
  busy: string | null = null;
  constructor() {
    this.files.set("park", { text: PARK, meta: { title: "Park", units: null, frame: "machine", params: [] } });
    this.files.set("face_top", { text: FACE, meta: { title: "Face top", units: "mm", frame: null, params: [
      { n: 1, key: "depth", label: "Depth", unit: "length", default: 0.5, min: 0, max: 5, integer: false },
      { n: 2, key: "feed", label: "Feed", unit: "feed", default: 600, min: 1, max: null, integer: false }] } });
  }
  /** As the gateway lists it: the title and the short description read
   *  from the TEXT (macroHeader mirrors the gateway's parser), the rest
   *  from `meta`. */
  entry(name: string) {
    const e = this.files.get(name)!;
    const h = readHeader(e.text);
    return { name, errors: [], warnings: [], mtime: 0, runnable: !this.blocked.has(name),
             reason: this.blocked.get(name) ?? null, revision: rev(e.text), ...e.meta,
             title: h.title ?? (e.meta.title as string | null) ?? null, description: h.description ? [h.description] : [] };
  }
  list() {
    return { ok: true, dir: "/home/cnc/linuxcnc/macros", problems: this.problems,
             macros: [...this.files.keys()].sort().map(n => this.entry(n)) };
  }
  /** Another client (or an editor outside the suite) changes a file. */
  touch(name: string, text: string) { this.files.get(name)!.text = text; }
}

export async function serve(page: Page, folder: Folder) {
  await page.route("**/macros", r => r.fulfill({ json: folder.list() }));
  await page.route(/\/macro\?/, async r => {
    const url = new URL(r.request().url());
    const name = url.searchParams.get("name")!;
    const method = r.request().method();
    const e = folder.files.get(name);
    if (method === "GET") {
      if (!e) return r.fulfill({ status: 404, json: { detail: "Macro not found" } });
      return r.fulfill({ body: e.text, contentType: "text/plain", headers: { "X-Macro-Revision": rev(e.text) } });
    }
    const base = url.searchParams.get("base")!;
    // the gateway's gate, in its order: busy, then the file against its base
    const against = (n: string, b: string) => {
      const f = folder.files.get(n);
      if (b === "new") return f ? refusal("exists", { name: n, revision: rev(f.text) }) : null;
      if (!f) return refusal("deleted", { name: n, revision: null });
      return rev(f.text) !== b ? refusal("conflict", { name: n, revision: rev(f.text) }) : null;
    };
    if (method !== "GET" && folder.busy) return r.fulfill(refusal("busy", { reason: folder.busy }));
    if (method === "PUT" && url.searchParams.has("rename_from")) {
      // a rename: the new name free, the old file still the revision the
      // editor read — then one step, as the gateway does it
      const from = url.searchParams.get("rename_from")!, old = folder.files.get(from);
      const refused = against(name, "new") ?? against(from, url.searchParams.get("rename_base")!);
      if (refused || !old) return r.fulfill(refused ?? refusal("deleted", { name: from, revision: null }));
      folder.files.delete(from);
      folder.files.set(name, { text: r.request().postData() ?? "", meta: old.meta });
      return r.fulfill({ json: { ok: true, macro: folder.entry(name) } });
    }
    if (method === "PUT") {
      const text = r.request().postData() ?? "";
      const refused = against(name, base);
      if (refused) return r.fulfill(refused);
      if (e) e.text = text;
      else folder.files.set(name, { text, meta: { title: name, units: null, frame: null, params: [] } });
      return r.fulfill({ json: { ok: true, macro: folder.entry(name) } });
    }
    if (method === "DELETE") {
      const refused = against(name, base);
      if (refused) return r.fulfill(refused);
      folder.files.delete(name);
      return r.fulfill({ json: { ok: true } });
    }
    return r.fallback();
  });
}

/** A macro file without parameters, for a spec that needs more of them. */
export function addPlain(folder: Folder, name: string, title: string | null = null) {
  folder.files.set(name, { text: `o<${name}> sub\n  M73\no<${name}> endsub\n`,
    meta: { title, units: null, frame: null, params: [] } });
}

/** The folder after the page loaded: served, and the app told to read it. */
export async function serveNow(page: Page, folder: Folder, version = 2) {
  await serve(page, folder);
  await ctl({ op: "raw", frame: { type: "macros_changed", version } });
}
