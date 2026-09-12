// Minimal headless gateway for E2E (issue #26; scripted frames added in A0.3).
//
// Serves the built frontend AND a /ws that pushes an "armed + ready" machine
// state, answering every hello/heartbeat so the connection stays up and armed
// stays set. This lets Playwright verify the connected -> armed ->
// controls-enabled path in a real browser without a real LinuxCNC. (The
// disconnected path is covered by smoke.spec.ts; the per-class armed/busy
// overlay logic by permissions.test.ts.)
//
// A0.3 (frontend split program): the state is now MUTABLE and a second WS
// endpoint at /ctl lets the SPEC script frames mid-test — status_delta,
// halshow_snapshot/update, pong all get end-to-end delivery assertions in
// frames.spec.ts. Rationale: the backend M4 regression proved a green gate
// that never asserts frame DELIVERY is blind to a dead dispatch path; these
// specs pin every frame-type → rendered-DOM pipeline BEFORE the lcncWs split.
//
// A real server is used rather than page.routeWebSocket because the app owns its
// socket inside a Web Worker, which routeWebSocket intercepts only unreliably.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { encode as msgpackEncode } from "@msgpack/msgpack";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const PORT = Number(process.env.MOCK_PORT) || 4174;

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".png": "image/png", ".wasm": "application/wasm",
};

// A tiny toolpath preview (viewer.spec.ts, A2). previewWorker fetches
// GET /preview, msgpack-decodes it, and ThreeViewer.applyGcode builds feed /
// rapid / highlight geometries from it — the per-program geometry whose
// disposal-on-rebuild the leak probe checks.
const PREVIEW = msgpackEncode({
  file: "/leak.ngc",
  feed: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
  rapid: [[0, 0, 5], [0, 0, 0]],
  feed_lines: [1, 2, 3, 4],
});

const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]);
  if (path === "/preview") {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.from(PREVIEW));
    return;
  }
  const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  const file = normalize(join(DIST, rel));
  const send = async (f, code = 200) => {
    const buf = await readFile(f);
    res.writeHead(code, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(buf);
  };
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  try {
    await send(file);
  } catch {
    try { await send(join(DIST, "index.html")); } catch { res.writeHead(404); res.end(); } // SPA fallback
  }
});

// Mutable machine state. /ctl "status_delta" folds changes in here too, so
// the 1 Hz heartbeat-triggered full status replies stay consistent with what
// a delta announced (no flicker back to stale values between frames).
const state = {
  type: "status",
  armed: true, // lcncWs.ts: any frame with `armed` sets the client's armed state
  data: {
    estop: false, enabled: true, emc_enable_in: true, homed: true,
    is_estop: false, is_enabled: true,  // backend-merged truth (review #5)
    interp_state: 1, paused: false, eoffset_enabled: false,
    work_pos: [12.345, 1.0, -5.5],      // frames.spec asserts the rendered DRO
    permissions: {
      idle: true, jog: true, override: true, ready: true, pause: false,
      resume: false, step: true, abort: true, probe: true, zero: true,
      surfaceComp: true, safety: true, setup: true, armed: true, always: true,
    },
  },
};

// Pristine snapshot for `op: "reset"`. Captured once at startup, BEFORE any
// spec can mutate `state`, so a reset restores everything rather than the few
// fields someone remembered to list.
const PRISTINE = structuredClone(state);

// App derives its axis list from viewer_init (gateway computes it from
// axis_mask), so the DRO/SetupStrip render no axis rows without this frame.
const VIEWER_INIT = {
  type: "viewer_init",
  data: {
    units: "mm",
    stl_base_url: "/machine/",
    parts: [],
    kinematics: [],
    axes: ["X", "Y", "Z"],
    machine_bounds: { origin: [0, 0, 0], size: [100, 100, 100] },
  },
};

// viewer.spec.ts forces in-session scene rebuilds: ThreeViewer dedups
// viewer_init by content, so a monotonic _rev busts the dedup and drives a
// real buildFromInit (clearScene + rebuild) without a page reload. A
// monotonic gcode version drives applyGcode (new toolpath geometry).
let _initRev = 0;
let _gcodeVer = 0;

const HALSHOW_SNAPSHOT = {
  type: "halshow_snapshot",
  pins: [
    { comp: "mock", type: "bit", dir: "OUT", value: "TRUE", name: "mock.heartbeat-ok", signal: "hb-ok", arrow: "=>" },
    { comp: "mock", type: "s32", dir: "OUT", value: "0", name: "mock.counter" },
  ],
  signals: [],
  params: [],
};

// Two WS endpoints on one HTTP server: route upgrades manually (noServer) —
// attaching two path'd WebSocketServers to the same server is unreliable.
const wss = new WebSocketServer({ noServer: true });     // app traffic
const ctlWss = new WebSocketServer({ noServer: true });  // spec control channel

server.on("upgrade", (req, socket, head) => {
  const path = (req.url || "").split("?")[0];
  const target = path === "/ws" ? wss : path === "/ctl" ? ctlWss : null;
  if (!target) { socket.destroy(); return; }
  target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});

function broadcast(frame) {
  const s = JSON.stringify(frame);
  for (const client of wss.clients) if (client.readyState === 1) client.send(s);
}

// While true, the mock stops echoing full status on incoming messages (initial
// connect frames, pong, and halshow snapshot still flow). frames.spec flips
// this around its status_delta assertion so the heartbeat-triggered FULL
// status replies can't mask a dead status_delta dispatch path — proven
// necessary adversarially: with echoes on, a killed delta case still passed
// because the next heartbeat reply delivered the folded value as full status.
let quiet = false;
// lifecycle.spec.ts (A1.6): record hellos so specs can assert the
// resume_armed contract; refuse mode keeps closing reconnects with 1001 so
// the shutdown banner has a stable window to assert against. lifecycle runs
// in its own SERIAL playwright project (dependencies) — these globals would
// otherwise interfere with parallel specs.
const hellos = [];
let refuseWs = false;

wss.on("connection", (ws) => {
  ws.on("error", () => {}); // page teardown mid-write is routine in e2e
  ws.send(JSON.stringify(state));
  ws.send(JSON.stringify(VIEWER_INIT));
  ws.on("message", (buf) => {
    let msg = null;
    try { msg = JSON.parse(String(buf)); } catch { /* non-JSON — fall through */ }
    const cmd = msg?.cmd ?? null;
    if (cmd === "hello") {
      hellos.push(msg);
      if (hellos.length > 50) hellos.shift();
      if (refuseWs) { try { ws.close(1001, "server shutdown"); } catch { /* ignore */ } return; }
    }
    if (cmd === "heartbeat") ws.send(JSON.stringify({ type: "pong" }));
    if (cmd === "halshow_live") ws.send(JSON.stringify(HALSHOW_SNAPSHOT));
    if (!quiet) ws.send(JSON.stringify(state)); // answer everything -> stay connected & armed
  });
});

// Control protocol (frames.spec.ts): each message gets an {ok} reply so the
// spec can sequence assert-before -> broadcast -> assert-after without races.
//   {op: "status_delta", data: {...}}  fold into state.data + broadcast delta
//   {op: "raw", frame: {...}}          broadcast any frame verbatim
ctlWss.on("connection", (ws) => {
  ws.on("error", () => {}); // spec closes the ctl socket right after the reply
  ws.on("message", (buf) => {
    let m;
    try { m = JSON.parse(String(buf)); } catch { ws.send(JSON.stringify({ ok: false, error: "bad json" })); return; }
    if (m.op === "status_delta") {
      Object.assign(state.data, m.data);
      // Geometry is an envelope field in the real gateway, not a data member.
      if ("tool_meta" in m) state.tool_meta = m.tool_meta;
      broadcast({ type: "status_delta", armed: true, data: m.data,
        ...("tool_meta" in m ? { tool_meta: m.tool_meta } : {}) });
    } else if (m.op === "quiet") {
      quiet = m.on === true;
    } else if (m.op === "reset") {
      // Restore pristine state between tests. The mock is ONE process shared by
      // every spec (frames.spec mutates state.data via status_delta, and
      // nine-axis.spec swaps the axis set), so serial specs call this in
      // beforeEach to avoid order-dependent bleed.
      //
      // Restores the WHOLE snapshot rather than a hand-picked field list (F5):
      // `delta` does Object.assign(state.data, …) with ARBITRARY fields and
      // `setAxes` rewrites work_pos/g92_offset/tool_offset/wcs_table, so
      // anything a spec touched beyond work_pos used to bleed into the next
      // one — silently, as a passing test that depended on the previous spec.
      quiet = false;
      refuseWs = false;
      state.armed = PRISTINE.armed;
      state.data = structuredClone(PRISTINE.data);
      hellos.length = 0;   // lifecycle.spec asserts on hello COUNTS
      _initRev++;
      broadcast({ ...VIEWER_INIT, data: { ...VIEWER_INIT.data, _rev: _initRev } });
      broadcast(state);
    } else if (m.op === "setAxes") {
      // WS-D 9-axis fixture: re-ship viewer_init with the given axis letters
      // and size every per-axis status field to match, so every axis-driven
      // surface (SetupStrip grid, viewer HUD DRO, OffsetPanel table) renders
      // one row/column per axis.
      const axes = Array.isArray(m.axes) && m.axes.length ? m.axes : ["X", "Y", "Z"];
      _initRev++;
      state.data.work_pos = axes.map((_, i) => (i + 1) * 1.111);
      state.data.g92_offset = axes.map(() => 0);
      state.data.tool_offset = axes.map(() => 0);
      state.data.wcs_table = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"]
        .map((name, r) => Object.fromEntries([
          ["name", name],
          ...axes.map((l, i) => [l.toLowerCase(), r === 0 ? (i + 1) * 10.123 : 0]),
          ["r", 0],
        ]));
      broadcast({ ...VIEWER_INIT, data: { ...VIEWER_INIT.data, axes, _rev: _initRev } });
      broadcast(state);
    } else if (m.op === "rebuildInit") {
      // Force a real in-session scene rebuild: _rev busts ThreeViewer's
      // content-dedup so buildFromInit (clearScene + rebuild) actually runs.
      _initRev++;
      broadcast({ ...VIEWER_INIT, data: { ...VIEWER_INIT.data, _rev: _initRev } });
    } else if (m.op === "loadGcode") {
      // viewer_gcode_ready → frontend fetches GET /preview?v=N → applyGcode
      // builds fresh feed/rapid/highlight geometry.
      _gcodeVer++;
      broadcast({ type: "viewer_gcode_ready", version: _gcodeVer, file: "/leak.ngc" });
    } else if (m.op === "raw") {
      broadcast(m.frame);
    } else if (m.op === "lastHellos") {
      ws.send(JSON.stringify({ ok: true, op: m.op, hellos }));
      return;
    } else if (m.op === "refuseWs") {
      refuseWs = m.on === true;
    } else if (m.op === "shutdownClose") {
      // Server-going-away: close every app client like the gateway's
      // lifespan path does (1001).
      for (const client of wss.clients) {
        try { client.close(1001, "server shutdown"); } catch { /* ignore */ }
      }
    } else {
      ws.send(JSON.stringify({ ok: false, error: `unknown op ${m.op}` }));
      return;
    }
    ws.send(JSON.stringify({ ok: true, op: m.op }));
  });
});

server.listen(PORT, process.env.MOCK_HOST, () => console.log(`mock-gateway: http://localhost:${PORT}`));
