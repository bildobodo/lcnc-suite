import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import gate from "./playwright.gate.config";

// The Firefox core (test strategy TS248-05, plan vor-maschine R385): the
// tests e2e/firefox-core.json names, in the PINNED Mozilla Firefox
// (e2e/firefox.json) through WebDriver BiDi — never Playwright's bundled
// Firefox: the channel is fixed and the binary comes only from
// LCNC_FIREFOX (scripts/fetch_firefox.py path), else this config throws.
// On the gate's settings: the per-worker mocks, its own servers, no focused
// test. Mouse and keyboard only (touch is silent under BiDi — e2e/test.ts
// throws on every touch call in Firefox); no hasTouch.
//
//   LCNC_FIREFOX=$(python3 scripts/fetch_firefox.py path) \
//     npx playwright test -c playwright.firefox.config.ts
//
// Its own references, by version and arch: e2e/__screenshots__/firefox-
// <version>-<arch>/…; the Chromium ones stay where they are. Reference
// images are compared on linux/arm64 only (probe-visual.spec.ts, R385 F1 b).
interface Pin { version: string; archives: Record<string, { sha256: string }> }
interface CoreEntry { file: string; titles: string[] }
interface Core { required: CoreEntry[]; buildup: CoreEntry[] }

const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as T;
export const PIN = read<Pin>("./e2e/firefox.json");
export const CORE = read<Core>("./e2e/firefox-core.json");
// LCNC_FIREFOX_SET=required: the required part only (CI, R385 F3)
export const CORE_TESTS = process.env.LCNC_FIREFOX_SET === "required" ? CORE.required : [...CORE.required, ...CORE.buildup];

const ARCH = { arm64: "linux-aarch64", x64: "linux-x86_64" }[process.arch as "arm64" | "x64"] ?? `${process.platform}-${process.arch}`;
const FIREFOX = process.env.LCNC_FIREFOX;
if (!FIREFOX) throw new Error("LCNC_FIREFOX names no Firefox binary: run scripts/fetch_firefox.py fetch, then path");
// the started browser is checked against this in every worker (e2e/test.ts browserPin)
process.env.LCNC_FIREFOX_VERSION = PIN.version;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const files = [...new Set(CORE_TESTS.map(t => t.file))];

export default defineConfig({
  ...gate,
  testMatch: new RegExp(`/(${files.map(escape).join("|")})$`),
  // the exact titles: the gate compares the listing to firefox-core.json
  grep: new RegExp(`(${CORE_TESTS.flatMap(t => t.titles).map(escape).join("|")})$`),
  snapshotPathTemplate: `{testDir}/__screenshots__/firefox-${PIN.version}-${ARCH}/{testFilePath}/{arg}{ext}`,
  updateSnapshots: "none",
  use: {
    ...gate.use,
    // a Chromium-only argument (its scrollbars): Firefox shows its own
    launchOptions: { executablePath: FIREFOX },
  },
  projects: [
    { name: "firefox-core", use: { browserName: "firefox", channel: "moz-firefox" } },
  ],
});
