import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Project } from "@playwright/test";
import full from "./playwright.config";

// The selected browser run (test strategy step 3, Codex R248 TS248-03): the
// FULL run's projects, chain and settings, each project narrowed to the
// selected spec files it would run anyway. No unselected file runs (a
// dependency project keeps only its selected files; an empty one drops out
// and the chain closes over it), the mock keeps the owners the full run gives
// it, and the files run in the full run's order — the chain, then the path
// within a project. Proof: `--list` names exactly the selection, each file in
// the project the full config gives it (scripts/test_select checks both).
//
//   LCNC_E2E_SELECTION=<sel.json> npx playwright test -c playwright.select.config.ts
//
// sel.json: the selector's record ({"browser": {"run": [names]}}) or a plain
// list of spec names. A missing or empty selection, "full", or a name that
// is not a spec of the full config is an error — never a silent full run.

const SELECTION = process.env.LCNC_E2E_SELECTION;
if (!SELECTION) throw new Error("LCNC_E2E_SELECTION names no selection file");
const raw = JSON.parse(readFileSync(SELECTION, "utf8")) as unknown;
const names = Array.isArray(raw) ? raw : (raw as { browser?: { run?: unknown } }).browser?.run;
if (!Array.isArray(names) || names.length === 0)
  throw new Error(`${SELECTION}: no browser specs selected (a full run uses playwright.config.ts)`);

const testDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), full.testDir ?? ".");
const files = (names as string[]).map(n => path.join(testDir, `${n}.spec.ts`));

const asList = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const DEFAULT_MATCH = /\.(spec|test)\.[cm]?[jt]sx?$/;

/** Whether a project of the full config runs a file (RegExp filters only). */
function runs(p: Project, file: string): boolean {
  const filter = (f: unknown) => {
    if (!(f instanceof RegExp)) throw new Error(`project ${p.name}: only RegExp test filters are supported`);
    return f.test(file);
  };
  const match = asList(p.testMatch);
  const inMatch = match.length === 0 ? DEFAULT_MATCH.test(file) : match.some(filter);
  return inMatch && !asList(p.testIgnore).some(filter);
}

const projects = full.projects ?? [];
const owner = new Map<string, string>();
for (const f of files) {
  const hits = projects.filter(p => runs(p, f)).map(p => p.name!);
  if (hits.length !== 1) throw new Error(`${path.basename(f)}: run by ${hits.length} projects of the full config (${hits.join(", ") || "none"})`);
  owner.set(f, hits[0]!);
}

// The chain order: every project after its dependencies.
const order: Project[] = [];
const placed = new Set<string>();
while (order.length < projects.length) {
  const next = projects.find(p => !placed.has(p.name!) && asList(p.dependencies).every(d => placed.has(d)));
  if (!next) throw new Error("the full config's projects form no chain");
  order.push(next);
  placed.add(next.name!);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const kept: Project[] = [];
for (const p of order) {
  const mine = files.filter(f => owner.get(f) === p.name);
  if (mine.length === 0) continue;
  const prev = kept[kept.length - 1];
  kept.push({
    ...p,
    testMatch: new RegExp(`^(?:${mine.map(escape).join("|")})$`),
    testIgnore: [],
    dependencies: prev ? [prev.name!] : [],
  });
}

export default defineConfig({
  ...full,
  testDir,
  projects: kept,
  // No focused test: a test.only would run alone and the rest silently not
  // (Codex R256 TS256-04 — round_gate also matches the listing to the run).
  forbidOnly: true,
  // The worker count from ONE place: round_gate checks the same slot ports
  // (4500 … 4500 + N - 1) before the run (Codex R262).
  workers: Number(process.env.LCNC_E2E_WORKERS ?? 3),
  // Never a server that was already running: its build or mock would be
  // checked silently in place of this tree's.
  webServer: asList(full.webServer).map(w => ({ ...w, reuseExistingServer: false })),
});
