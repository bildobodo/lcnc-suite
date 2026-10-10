import { defineConfig } from "vitest/config";
export default defineConfig({cacheDir: "/tmp/codex-r133-d06eos78/vite-cache", test: {environment: "node", include: ["src/**/*.test.ts"], maxWorkers: 1, execArgv: ["--expose-gc"]}});
