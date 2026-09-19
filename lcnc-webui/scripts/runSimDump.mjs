// Use the installed Vite module runner; live gates must never download an
// undeclared vite-node package through npx during a machine session.
import { createServer } from "vite";
import { fileURLToPath, URL } from "node:url";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, watch: null, ws: false, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
});
try {
  await server.ssrLoadModule("/scripts/simDump.ts");
} finally {
  await server.close();
}
