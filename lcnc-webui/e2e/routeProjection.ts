// A request's route and variant (FI265-02 Rest B, Codex R267/R268, R389 D6):
// the route template from the gateway's own route list (the inventory's
// `http:` atoms, scripts/inventory/atoms.py.json — ONE source), and per
// route a small agreed projection to a variant. It may read query KEY names,
// values of an enumerated class, header names, a path parameter that is
// enumerated (the settings section, against the inventory's `section:`
// atoms). It never returns a raw query value, a body or a token: a value
// outside its class is the class's own word ("other"), a section outside
// the list is "unknown section". A route without a projection has the
// variant null: "variant not derived", named by the replay.
import { readFileSync } from "node:fs";

interface Atom { id: string }
const atoms = JSON.parse(readFileSync(new URL("../../scripts/inventory/atoms.py.json", import.meta.url), "utf8")) as
  { adapters: { http: { atoms: Atom[] }; sections: { atoms: Atom[] } } };

/** The gateway's routes, method + template (`PUT /settings/{section}`). */
export const ROUTES: ReadonlyArray<{ method: string; template: string; re: RegExp }> = atoms.adapters.http.atoms
  .map(a => a.id.slice("http:".length))
  .filter(s => /^(GET|POST|PUT|DELETE) \//.test(s))
  .map(s => {
    const [method, template] = s.split(" ");
    const re = new RegExp("^" + template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+") + "$");
    return { method, template, re };
  });
export const SECTIONS: ReadonlySet<string> = new Set(atoms.adapters.sections.atoms.map(a => a.id.slice("section:".length)));

export interface Projection { route: string | null; variant: string | null }

/** The class of a value that is either the literal `new` or a revision. */
const baseClass = (v: string | null) => v === null ? "none" : v === "new" ? "new" : "revision";

const PROJECTIONS: Record<string, (u: URL) => string> = {
  // a save or a rename (`rename_from`), its base new | a revision (macroFolder.ts, lcncApi.saveMacroFile)
  "PUT /macro": (u) => u.searchParams.has("rename_from")
    ? `rename base=${baseClass(u.searchParams.get("base"))} rename_base=${baseClass(u.searchParams.get("rename_base"))}`
    : `save base=${baseClass(u.searchParams.get("base"))}`,
  "DELETE /macro": (u) => `delete base=${baseClass(u.searchParams.get("base"))}`,
  // an import creates only, or replaces exactly a revision (lcncApi.uploadMacroFile)
  "POST /macro-upload": (u) => u.searchParams.has("replace") ? "replace" : "create",
  // overwrite=1 replaces, anything else refuses an existing name (lcncApi.uploadFile)
  "POST /upload": (u) => `overwrite=${u.searchParams.get("overwrite") === "1" ? "1" : "0"}`,
  "PUT /settings/{section}": (u) => sectionOf(u),
  "POST /settings/{section}": (u) => sectionOf(u),
};
/** A path segment decoded — or null when its encoding is malformed (never a throw). */
function decoded(seg: string): string | null {
  try { return decodeURIComponent(seg); } catch { return null; }
}
function sectionOf(u: URL): string {
  const s = decoded(u.pathname.split("/")[2] ?? "");
  return s !== null && SECTIONS.has(s) ? `section=${s}` : "unknown section";
}

/** The path the record keeps: a route's path parameter appears as its
 *  template name unless its value is enumerated (R268 Rest B) — today only
 *  `/settings/{section}`: a section the inventory names stays, anything else
 *  is the template. Every other path is kept as it is (no parameter). */
export function recordedPath(url: URL): string {
  // by the path alone, whatever the method: a value in a parameter's place
  // is never kept (the mock logs it the same way)
  const hit = ROUTES.find(r => r.template.includes("{") && r.re.test(url.pathname));
  if (!hit) return url.pathname;
  const s = decoded(url.pathname.split("/")[2] ?? "");
  return hit.template === "/settings/{section}" && s !== null && SECTIONS.has(s) ? url.pathname : hit.template;
}

/** The route a request takes and its variant — or no route (a static file,
 *  the page, a path the gateway does not serve). */
export function project(method: string, url: URL): Projection {
  const hit = ROUTES.find(r => r.method === method && r.re.test(url.pathname));
  if (!hit) return { route: null, variant: null };
  const route = `${hit.method} ${hit.template}`;
  const p = PROJECTIONS[route];
  return { route, variant: p ? p(url) : null };
}
