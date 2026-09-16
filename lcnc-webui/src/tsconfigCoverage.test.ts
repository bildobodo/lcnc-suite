// Every TypeScript file is type-checked by SOME project (2026-09-05).
//
// tsconfig.app.json (DOM, vue-tsc) must exclude the node-side test files —
// they import node:fs — and tsconfig.test.json must include exactly those,
// or `npm run build` silently stops type-checking them (six files were in
// that state, one of them a stale entry for a deleted test). This test keeps
// the two lists in step and refuses stale entries. It is itself node-side
// and therefore listed in both.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

// tsconfig files allow comments; strip WHOLE-LINE /* */ and // comments
// before JSON.parse. Whole-line only: a glob such as "e2e/**/*.ts" holds a
// "/**/" that a naive block-comment regex eats (found by this test's first run).
function readJsonc(path: string): any {
  const raw = readFileSync(path, "utf8")
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(raw);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// What makes a file node-side: a node built-in import or a node-only global.
const NODE_SIDE = /from\s+["']node:|from\s+["'](?:fs|path|url|os|child_process)["']|\b__dirname\b|\bprocess\.(?:argv|exit|env)\b/;

const app = readJsonc(join(ROOT, "tsconfig.app.json"));
const test = readJsonc(join(ROOT, "tsconfig.test.json"));
const exclude: string[] = app.exclude ?? [];
const include: string[] = test.include ?? [];
const nodeSideTests = walk(join(ROOT, "src"))
  .filter((f) => f.endsWith(".test.ts") && NODE_SIDE.test(readFileSync(f, "utf8")))
  .map((f) => relative(ROOT, f))
  .sort();

describe("every TypeScript file is type-checked by some project", () => {
  it("finds the node-side tests (non-vacuous)", () => {
    expect(nodeSideTests.length).toBeGreaterThan(0);
    expect(nodeSideTests).toContain("src/tsconfigCoverage.test.ts");
  });

  it("node-side tests are excluded from the DOM app project AND included in the test project", () => {
    for (const f of nodeSideTests) {
      expect(exclude, `${f} must be in tsconfig.app.json exclude`).toContain(f);
      expect(include, `${f} must be in tsconfig.test.json include`).toContain(f);
    }
  });

  it("every app-exclude entry exists on disk and is a node-side test (no stale entries, nothing else hidden)", () => {
    for (const f of exclude) {
      expect(existsSync(join(ROOT, f)), `${f} does not exist`).toBe(true);
      expect(nodeSideTests, `${f} is excluded from vue-tsc but is not node-side`).toContain(f);
    }
  });

  it("test-project includes resolve (explicit paths, or the e2e glob)", () => {
    for (const f of include) {
      if (f.includes("*")) {
        expect(f.startsWith("e2e/"), f).toBe(true);
        expect(existsSync(join(ROOT, "e2e"))).toBe(true);
      } else {
        expect(existsSync(join(ROOT, f)), `${f} does not exist`).toBe(true);
      }
    }
  });

  it("tsconfig.json references all three projects", () => {
    const refs = (readJsonc(join(ROOT, "tsconfig.json")).references ?? []).map((r: any) => r.path);
    expect(refs).toEqual(["./tsconfig.app.json", "./tsconfig.node.json", "./tsconfig.test.json"]);
  });
});
