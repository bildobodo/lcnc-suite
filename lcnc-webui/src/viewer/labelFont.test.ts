// Every 3D text label sets the bundled font (viewer/labelFont.ts). A troika
// Text without one resolves its fonts from cdn.jsdelivr.net at run time — on
// a machine without internet the label never renders. The viewer spec
// "fetches nothing from outside the gateway" proves it for the viewer's own
// labels; this source-shape guard covers every other `new Text()` (the probe
// surface map's labels have no e2e path).
import { describe, it, expect } from "vitest";

// Vite's glob rather than node:fs — this suite typechecks under the browser
// tsconfig, which has no node types.
const SOURCES = import.meta.glob(["../*.{ts,vue}", "./*.ts"], {
  query: "?raw", import: "default", eager: true,
}) as Record<string, string>;

describe("3D text labels", () => {
  it("every new Text() sets the bundled label font before it syncs", () => {
    const sites: string[] = [];
    const missing: string[] = [];
    for (const [file, src] of Object.entries(SOURCES)) {
      if (file.endsWith(".test.ts")) continue;
      for (const m of src.matchAll(/\b(\w+)\s*=\s*new Text\(\)/g)) {
        const at = `${file}:${src.slice(0, m.index).split("\n").length}`;
        sites.push(at);
        const rest = src.slice(m.index!, src.indexOf(".sync(", m.index) + 1 || undefined);
        if (!new RegExp(`\\b${m[1]}\\.font\\s*=\\s*LABEL_FONT_URL\\b`).test(rest)) missing.push(at);
      }
    }
    expect(sites.length, "no troika Text found — the scan is looking in the wrong place").toBeGreaterThanOrEqual(3);
    expect(missing, "a troika Text without the bundled font fetches it from a CDN").toEqual([]);
  });
});
