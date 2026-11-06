import { defineConfig } from "@playwright/test";
import full from "./playwright.config";
export default defineConfig({
  ...full, webServer: [], workers: 1, retries: 0, forbidOnly: true,
  testMatch: /(?:jog-buttons|feedback-channels|editor-guards)\.spec\.ts$/,
  grep: /F-JOG\.S5b|F-TRIP\.S1b|F-LOAD\.S3/,
  reporter: [["line"], ["json", {outputFile:"/tmp/r323-evidence/browser-targeted.json"}]],
});
