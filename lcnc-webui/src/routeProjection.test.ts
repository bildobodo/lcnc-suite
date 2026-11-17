import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { project, recordedPath, ROUTES, SECTIONS } from "../e2e/routeProjection";

// The replay's projection (FI265-02 Rest B, replay step 5b): a request's
// route template from the gateway's own route list and its variant — the
// agreed classes only, never a raw query value.

const at = (path: string) => new URL(path, "http://localhost:4500");

describe("route projection", () => {
  it("names exactly the inventory's method routes", () => {
    const inv = JSON.parse(readFileSync(new URL("../../scripts/inventory/atoms.py.json", import.meta.url), "utf8")) as
      { adapters: { http: { atoms: Array<{ id: string }> } } };
    const want = inv.adapters.http.atoms.map(a => a.id.slice(5)).filter(s => /^(GET|POST|PUT|DELETE) \//.test(s)).sort();
    expect(ROUTES.map(r => `${r.method} ${r.template}`).sort()).toEqual(want);
    expect(want.length).toBeGreaterThan(25);
  });

  it("reads the gateway's routes and settings sections from the inventory", () => {
    expect(ROUTES.some(r => r.method === "PUT" && r.template === "/settings/{section}")).toBe(true);
    expect(ROUTES.some(r => r.method === "GET" && r.template === "/g30")).toBe(true);
    expect(SECTIONS.has("machine") && SECTIONS.has("macroBar")).toBe(true);
  });

  it("save and rename of the same macro are two variants", () => {
    expect(project("PUT", at("/macro?name=a.ngc&base=new"))).toEqual({ route: "PUT /macro", variant: "save base=new" });
    expect(project("PUT", at("/macro?name=a.ngc&base=abc123"))).toEqual({ route: "PUT /macro", variant: "save base=revision" });
    expect(project("PUT", at("/macro?name=b.ngc&base=new&rename_from=a.ngc&rename_base=abc123")))
      .toEqual({ route: "PUT /macro", variant: "rename base=new rename_base=revision" });
    expect(project("DELETE", at("/macro?name=a.ngc&base=abc123"))).toEqual({ route: "DELETE /macro", variant: "delete base=revision" });
  });

  it("upload, macro import and the settings section take their enumerated class", () => {
    expect(project("POST", at("/upload?overwrite=1")).variant).toBe("overwrite=1");
    expect(project("POST", at("/upload")).variant).toBe("overwrite=0");
    expect(project("POST", at("/upload?overwrite=yes")).variant).toBe("overwrite=0");
    expect(project("POST", at("/macro-upload?replace=abc")).variant).toBe("replace");
    expect(project("POST", at("/macro-upload")).variant).toBe("create");
    expect(project("PUT", at("/settings/machine"))).toEqual({ route: "PUT /settings/{section}", variant: "section=machine" });
    expect(project("POST", at("/settings/no-such")).variant).toBe("unknown section");
  });

  it("a route without a projection has no variant; a path the gateway does not serve has no route", () => {
    expect(project("GET", at("/g30"))).toEqual({ route: "GET /g30", variant: null });
    expect(project("GET", at("/static/index.js"))).toEqual({ route: null, variant: null });
    expect(project("POST", at("/g30"))).toEqual({ route: null, variant: null });
  });

  it("keeps a path parameter as its template unless the value is enumerated, for any method", () => {
    expect(recordedPath(at("/settings/machine"))).toBe("/settings/machine");
    expect(recordedPath(at("/settings/e2e-invented-token"))).toBe("/settings/{section}");
    expect(recordedPath(at("/g30"))).toBe("/g30");
    expect(recordedPath(at("/static/index.js"))).toBe("/static/index.js");
  });

  it("never returns a raw value: an invented token in every query slot appears in no projection", () => {
    const token = "e2e-invented-token-9f3c";
    for (const r of ["/macro", "/upload", "/macro-upload", "/settings/" + token]) {
      for (const m of ["GET", "PUT", "POST", "DELETE"]) {
        const u = at(`${r}?name=${token}&base=${token}&rename_from=${token}&rename_base=${token}&overwrite=${token}&replace=${token}`);
        expect(JSON.stringify(project(m, u))).not.toContain(token);
      }
    }
  });
});
