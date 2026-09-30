import { defineConfig } from "vitest/config";

// Unit tests for pure logic (permissions evaluation, command classification).
// No DOM needed, so the lightweight node environment is enough.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // gc() for the path ledger's HELD-memory guard (fatPaths.test.ts): what
    // survives a full collection after a build must be in the ledger.
    execArgv: ["--expose-gc"],
  },
});
