// The gateway's macro folder for the browser tests (package 5): an
// in-memory folder served through page.route — saves, imports and deletes
// change it for real, with sha256 revisions and the gateway's 409
// contracts, so a revision a client saw and a conflict behave as in the
// product. ONE mechanism for every spec that needs macro files (the earlier
// settings macros were dropped 2026-10-02). serve() may run after the page
// loaded: send `macros_changed` and the app reads the list again.
import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { ctl } from "./ctl";

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

/** The gateway's macro folder, in memory. */
export class Folder {
  files = new Map<string, Entry>();
  problems: string[] = [];
  /** The gateway's verdict "may not run", by name (a header error, shadowed). */
  blocked = new Map<string, string>();
  constructor() {
    this.files.set("park", { text: PARK, meta: { title: "Park", units: null, frame: "machine", params: [] } });
    this.files.set("face_top", { text: FACE, meta: { title: "Face top", units: "mm", frame: null, params: [
      { n: 1, key: "depth", label: "Depth", unit: "length", default: 0.5, min: 0, max: 5, integer: false },
      { n: 2, key: "feed", label: "Feed", unit: "feed", default: 600, min: 1, max: null, integer: false }] } });
  }
  entry(name: string) {
    const e = this.files.get(name)!;
    return { name, description: [], errors: [], warnings: [], mtime: 0, runnable: !this.blocked.has(name),
             reason: this.blocked.get(name) ?? null, revision: rev(e.text), ...e.meta };
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
    if (method === "PUT") {
      const text = r.request().postData() ?? "";
      if (base === "new" ? !!e : !e || rev(e.text) !== base) {
        return r.fulfill({ status: 409, json: { detail: { error: "refused",
          reason: base === "new" ? "A macro of that name exists — reload" : "Changed on disk — reload or keep editing",
          revision: e ? rev(e.text) : null } } });
      }
      if (e) e.text = text;
      else folder.files.set(name, { text, meta: { title: name, units: null, frame: null, params: [] } });
      return r.fulfill({ json: { ok: true, macro: folder.entry(name) } });
    }
    if (method === "DELETE") {
      if (!e || rev(e.text) !== base) return r.fulfill({ status: 409, json: { detail: { error: "refused", reason: "Changed on disk", revision: e ? rev(e.text) : null } } });
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
