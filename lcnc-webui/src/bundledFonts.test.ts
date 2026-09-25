// The UI ships its fonts (operator decision 2026-09-25): both font stacks
// start with a family style.css declares with @font-face, and every face's
// file is in src/assets/fonts. A stack that starts with a system family, or
// a face whose file is missing, renders each machine's own font again — the
// layout tests would measure one face and the operator see another.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// node:fs, not an import: vitest empties every CSS import, `?raw` included.
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const FILES = readdirSync(new URL("./assets/fonts/", import.meta.url)).map(f => `assets/fonts/${f}`);

describe("bundled fonts", () => {
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(m => ({
    family: /font-family:\s*"([^"]+)"/.exec(m[1]!)?.[1],
    url: /url\("\.\/([^"]+)"\)/.exec(m[1]!)?.[1],
  }));

  it("every @font-face names a family and a file that exists", () => {
    expect(faces.length).toBeGreaterThanOrEqual(3);
    for (const f of faces) {
      expect(f.family, JSON.stringify(f)).toBeTruthy();
      expect(FILES, `@font-face ${f.family}: ${f.url}`).toContain(f.url);
    }
  });

  for (const token of ["--font-sans", "--font-mono"]) {
    it(`${token} starts with a bundled family`, () => {
      const stack = new RegExp(`${token}:\\s*([^;]+);`).exec(css)?.[1] ?? "";
      const first = stack.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
      expect(faces.map(f => f.family), `${token}: ${stack}`).toContain(first);
    });
  }
});
