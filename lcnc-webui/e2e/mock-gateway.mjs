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
import { existsSync } from "node:fs";
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

// A toolpath preview (viewer.spec.ts, A2). previewWorker fetches
// GET /preview, msgpack-decodes it, and ThreeViewer.applyGcode builds feed /
// rapid / highlight geometries from it — the per-program geometry whose
// disposal-on-rebuild the leak probe checks. The feed is a zigzag over the
// mock machine's 100 mm box (the camera frames that box, and a chunk the
// frustum culls is never uploaded, so it must all be in view) in 12.5 mm
// segments: the controller bins a flat program into an 8 × 8 spatial grid
// (lineChunks.chunkGrid, 64 cells), so every cell holds segments and the
// drawn path is 64 CHUNKS — the probe then covers the chunked-draw
// disposal path (2026-09-12), not a single line. Every vertex is a real
// corner (1 mm alternation, far above the coarsest LOD tolerance of
// ~0.07 mm): a collinear row would decimate to one chord per row at the
// level the framed view draws, leaving most cells empty there — and a
// chunk with nothing to draw at the drawn level is never uploaded.
function zigzag() {
  const feed = [], feed_lines = [];
  for (let r = 0; r < 64; r++) {
    const y = (r * 100) / 63;
    for (let c = 0; c <= 8; c++) {
      const x = (r % 2 === 0 ? c : 8 - c) * 12.5;
      feed.push([x, y + (c % 2), 0]);
      feed_lines.push(feed.length);
    }
  }
  return { feed, feed_lines };
}
const PREVIEW = msgpackEncode({
  file: "/leak.ngc",
  ...zigzag(),
  rapid: [[0, 0, 5], [0, 0, 0]],
  // The parse worker's program statistics (gcode_parse_worker.py): the
  // Program panel offers its Stats dialog only when a payload carries them.
  stats: {
    feedMoves: 64, rapidMoves: 1, linearMoves: 64, arcMoves: 0,
    feedDist: 1280, rapidDist: 5, linearDist: 1280, arcDist: 0,
    feedTime: 768, rapidTime: 1, totalTime: 769,
    feedRates: [100], toolChanges: 0, toolsUsed: [], unit: "mm", fileSize: 2048,
  },
});

const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]);
  if (path === "/macros") {
    // Package 5: the macro folder of a configuration without one (specs that
    // need files serve their own folder through page.route)
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, dir: null, problems: ["No macro folder — set [DISPLAY] WEBUI_MACRO_DIR"], macros: [] }));
    return;
  }
  if (path === "/settings") {
    // the page's first settings (main.ts): this device's view — the stored
    // blob with the simulation ON unless a spec set it (the fixture default)
    res.writeHead(200, { "content-type": "application/json" });
    const v = withDevice({ settings: settingsStore });
    res.end(JSON.stringify({ ok: true, settings: v.settings, revs: v.revs, device: v.device }));
    return;
  }
  if (path === "/devices") {
    // Settings › Devices (settings split): this device and what a spec set
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, devices: [{ ...MOCK_DEVICE_ROW, name: MOCK_DEVICE.name }, ...devicesList] }));
    return;
  }
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
      // every class the gateway ships (button gates BG-15: a missing class
      // is closed — the client no longer reads run / machineFrame / goZero
      // from ready); planeFrame, g30Capture and the M6 confirmation closed
      idle: true, jog: true, override: true, ready: true, run: true, machineFrame: true,
      goZero: true, planeFrame: false, g30Capture: false, pause: false,
      resume: false, step: true, abort: true, spindleStop: true, toolChangeConfirm: false,
      probe: true, zero: true,
      touchoff: true, touchoffRotary: true, twpCapture: true,
      surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true,
      // button gates D: load, the task mode per target, the G30 read / save,
      // the manual spindle, the recovery (no trip: arming and Reset open)
      programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true,
      spindleManual: true, armEnable: true, estopReset: true,
      armed: true, always: true,
    },
  },
};

// Pristine snapshot for `op: "reset"`. Captured once at startup, BEFORE any
// spec can mutate `state`, so a reset restores everything rather than the few
// fields someone remembered to list — a top-level key a test ADDED (tool_meta)
// included (Codex R263 PM263-01).
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

const PRISTINE_INIT = structuredClone(VIEWER_INIT);   // setKins writes into it before the first reset
let activeViewerInit = VIEWER_INIT;

// viewer.spec.ts forces in-session scene rebuilds: ThreeViewer dedups
// viewer_init by content, so a monotonic _rev busts the dedup and drives a
// real buildFromInit (clearScene + rebuild) without a page reload. A
// monotonic gcode version drives applyGcode (new toolpath geometry).
let _initRev = 0;
let _gcodeVer = 0;
// Axis set installed by `setAxes` — every later viewer_init re-ship
// (setKins, rebuildInit) must carry it, or the six-axis strip collapses
// back to XYZ mid-spec.
let _axes = null;
function initFrame() {
  _initRev++;
  activeViewerInit = { ...activeViewerInit, data: { ...activeViewerInit.data, ...(_axes ? { axes: _axes } : {}), _rev: _initRev } };
  return activeViewerInit;
}

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
// Commands the UI SENT, newest last (R-01: a spec asserts which frame the
// kinematics selector emits, and that a refused control emits nothing).
const cmds = [];
let refuseWs = false;
// Correlated replies the UI WAITS for (request() in lcncWs): cmd -> reply
// fields, answered with the command's own req_id (toolsetter-setup.spec:
// tool_measure with mdi_set true / false / refused).
let replies = {};
// Envelope keys the real gateway sends with EVERY status frame (top level,
// beside `data`): run_basis, preview_origin (plan „Prüfung im Lauf“ 1a/1b).
// A key set once rides every frame after — full and delta — until a spec
// sets it null or resets; the client drops a key a frame lacks.
let envelope = {};
const withEnvelope = (frame) => ({ ...frame, ...envelope });
// The gateway's settings store (button gates BG-19): a protected section
// acts on the page only once the SERVER holds it — the real gateway answers
// a save_settings and sends every client the full blob (settings_changed).
// The mock does the same with the blob a spec last sent (a raw
// settings_init / settings_changed) plus the page's saves. A spec that
// answers saves itself (the save-status ledger) turns it off: settingsEcho.
let settingsStore = {};
let settingsEcho = true;
// Device profiles (settings split, R335–R337): the mock's page is ONE bound
// device whose simulation is ON — the fixture default the timeline, Sim tab
// and collision specs run under. Every settings frame a spec sends carries
// this device, the section revisions and `simulation` unless it names its
// own (a NEW device's spec sends `simulation: {enabled: false}`).
const MOCK_DEVICE = { id: "dev-mock", name: "" };
const MOCK_DEVICE_ROW = { id: "dev-mock", created: null, last_seen: null, last_address: "127.0.0.1",
  changed: true, simulation: true, simulation_rev: 0, online: true, tabs: 1, this: true };
let settingsRevs = {};
let devicesList = [];
// The gateway answers a hello with the connection's settings (settings_init,
// its device bound): every connection, a reconnect too. A spec of the state
// "no server settings yet" turns it off (settingsOnHello).
let settingsOnHello = true;
const withDevice = (frame) => ({
  ...frame,
  settings: { simulation: { enabled: true }, ...(frame.settings ?? {}) },
  revs: frame.revs ?? { ...settingsRevs },
  device: frame.device ?? MOCK_DEVICE,
});

// What a fresh app client receives on connect — also what `snapshot` reports.
const connectFrames = () => [withEnvelope(state), activeViewerInit];

wss.on("connection", (ws) => {
  ws.on("error", () => {}); // page teardown mid-write is routine in e2e
  for (const frame of connectFrames()) ws.send(JSON.stringify(frame));
  ws.on("message", (buf) => {
    let msg = null;
    try { msg = JSON.parse(String(buf)); } catch { /* non-JSON — fall through */ }
    const cmd = msg?.cmd ?? null;
    if (cmd === "hello") {
      hellos.push(msg);
      if (hellos.length > 50) hellos.shift();
      if (refuseWs) { try { ws.close(1001, "server shutdown"); } catch { /* ignore */ } return; }
      if (settingsOnHello) ws.send(JSON.stringify(withDevice({ type: "settings_init", settings: settingsStore })));
    }
    if (cmd && cmd !== "heartbeat") {
      cmds.push(msg);
      if (cmds.length > 50) cmds.shift();
    }
    if (cmd === "heartbeat") {
      ws.send(JSON.stringify({ type: "pong" }));
      if (Number.isInteger(msg?.seq)) ws.lastHbSeq = msg.seq;   // for {op: "hb_answer"} in quiet mode
    }
    // "silent": a gateway that does not answer (yet) — the scripted slow read
    if (cmd && replies[cmd] === "silent") { /* no reply */ }
    else if (cmd && replies[cmd]) ws.send(JSON.stringify({ type: "reply", cmd, req_id: msg.req_id, ...replies[cmd] }));
    else if (cmd === "save_settings" && settingsEcho && typeof msg.device === "string" && msg.device !== MOCK_DEVICE.id) {
      // ANOTHER device's profile (Settings › Devices): its reply names it,
      // nothing here changes (the gateway's contract, R338 SS-I01)
      ws.send(JSON.stringify({ type: "reply", cmd, req_id: msg.req_id, ok: true, section: msg.section,
                               device: msg.device, rev: 1 }));
    }
    else if (cmd === "save_settings" && settingsEcho && typeof msg.section === "string") {
      settingsStore = { ...settingsStore, [msg.section]: msg.data };
      settingsRevs[msg.section] = (settingsRevs[msg.section] ?? 0) + 1;
      ws.send(JSON.stringify({ type: "reply", cmd, req_id: msg.req_id, ok: true, section: msg.section,
                               rev: settingsRevs[msg.section] }));
      broadcast(withDevice({ type: "settings_changed", settings: settingsStore }));
    }
    else if (cmd === "device_rename" || cmd === "device_reset" || cmd === "device_delete") {
      if (cmd === "device_rename" && !msg.device) MOCK_DEVICE.name = String(msg.name ?? "");
      ws.send(JSON.stringify({ type: "reply", cmd, req_id: msg.req_id, ok: true }));
    }
    // a gateway always answers a table read: an empty table unless scripted
    // (the Tools tab says a missing reply after 8 s — 2026-10-04)
    else if (cmd === "get_tool_table") ws.send(JSON.stringify({ type: "reply", cmd, req_id: msg.req_id, ok: true, tools: [] }));
    if (cmd === "halshow_live") ws.send(JSON.stringify(HALSHOW_SNAPSHOT));
    // answer everything -> stay connected & armed; the status answering a
    // heartbeat carries the gateway's hold and that heartbeat's number like
    // the gateway's first status after one (`timing.server_ms`, `hb_seq` —
    // the page's round-trip bound pairs them), with its monotonic stamp and
    // pid (`g_mono_ms`, `g_pid` — the browser-PC report's ordering, R185)
    if (!quiet) ws.send(JSON.stringify(cmd === "heartbeat"
      ? { ...withEnvelope(state), timing: { server_ms: 0.2, ...(Number.isInteger(msg?.seq) ? { hb_seq: msg.seq } : {}),
                                            g_mono_ms: Math.round(performance.now() * 1000) / 1000, g_pid: process.pid } }
      : withEnvelope(state)));
  });
});

// Control protocol (frames.spec.ts): each message gets an {ok} reply so the
// spec can sequence assert-before -> broadcast -> assert-after without races.
//   {op: "status_delta", data: {...}}  fold into state.data + broadcast delta
//   {op: "raw", frame: {...}}          broadcast any frame verbatim
//   {op: "hb_answer"}                  answer each client's latest heartbeat (quiet mode)
ctlWss.on("connection", (ws) => {
  ws.on("error", () => {}); // spec closes the ctl socket right after the reply
  ws.on("message", (buf) => {
    let m;
    try { m = JSON.parse(String(buf)); } catch { ws.send(JSON.stringify({ ok: false, error: "bad json" })); return; }
    if (m.op === "status_delta") {
      Object.assign(state.data, m.data ?? {});
      if (typeof m.armed === "boolean") state.armed = m.armed;
      // Geometry is an envelope field in the real gateway, not a data member.
      if ("tool_meta" in m) state.tool_meta = m.tool_meta;
      // {envelope: {key: value | null}} — persistent top-level keys (above)
      for (const [k, v] of Object.entries(m.envelope ?? {})) {
        if (v === null) delete envelope[k]; else envelope[k] = v;
      }
      broadcast(withEnvelope({ type: "status_delta", armed: state.armed, data: m.data ?? {},
        ...("tool_meta" in m ? { tool_meta: m.tool_meta } : {}) }));
    } else if (m.op === "quiet") {
      quiet = m.on === true;
    } else if (m.op === "hb_answer") {
      // quiet mode answers no heartbeat on its own: this answers each
      // client's latest one (a status_delta with its timing, as the gateway's)
      // — the browser-PC witness ticks follow answers (Codex R186)
      for (const client of wss.clients) {
        if (client.readyState !== 1 || !Number.isInteger(client.lastHbSeq)) continue;
        client.send(JSON.stringify(withEnvelope({ type: "status_delta", armed: state.armed, data: {},
          timing: { server_ms: 0.2, hb_seq: client.lastHbSeq, g_mono_ms: Math.round(performance.now() * 1000) / 1000, g_pid: process.pid } })));
      }
    } else if (m.op === "reset") {
      // Restore the pristine state: the worker's baseline fixture sends this
      // before every test (e2e/test.ts — the mock belongs to one worker, its
      // tests run one after another), and confirms it from `snapshot` and a
      // fresh app client's connect frames.
      //
      // Restores the WHOLE snapshot rather than a hand-picked field list (F5):
      // `delta` does Object.assign(state.data, …) with ARBITRARY fields and
      // `setAxes` rewrites work_pos/g92_offset/tool_offset/wcs_table, so
      // anything a spec touched beyond work_pos used to bleed into the next
      // one — silently, as a passing test that depended on the previous spec.
      // `state` keeps its identity (the connect and heartbeat replies send it):
      // every key goes, the pristine ones come back. `_initRev` / `_gcodeVer`
      // stay monotonic — a revision that went back would read as unchanged.
      quiet = false;
      refuseWs = false;
      replies = {};
      envelope = {};
      settingsStore = {};
      settingsEcho = true;
      settingsRevs = {};
      devicesList = [];
      settingsOnHello = true;
      MOCK_DEVICE.name = "";
      activeViewerInit = VIEWER_INIT;
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, structuredClone(PRISTINE));
      VIEWER_INIT.data = structuredClone(PRISTINE_INIT.data);   // setKins is per-test state too
      _axes = null;
      hellos.length = 0;   // lifecycle.spec asserts on hello COUNTS
      cmds.length = 0;
      broadcast(initFrame());
      broadcast(withEnvelope(state));
    } else if (m.op === "setAxes") {
      // WS-D 9-axis fixture: re-ship viewer_init with the given axis letters
      // and size every per-axis status field to match, so every axis-driven
      // surface (SetupStrip grid, viewer HUD DRO, OffsetPanel table) renders
      // one row/column per axis.
      const axes = Array.isArray(m.axes) && m.axes.length ? m.axes : ["X", "Y", "Z"];
      _axes = axes;
      state.data.work_pos = axes.map((_, i) => (i + 1) * 1.111);
      // The offset vectors are CANONICAL 9-wide on the real wire (STAT's
      // tuples, X..W at fixed slots) — never per axis (operator P5/P6: the
      // Offsets panel reads them by the letter's canonical slot).
      state.data.g92_offset = Array(9).fill(0);
      state.data.tool_offset = Array(9).fill(0);
      state.data.wcs_table = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"]
        .map((name, r) => Object.fromEntries([
          ["name", name],
          ...axes.map((l, i) => [l.toLowerCase(), r === 0 ? (i + 1) * 10.123 : 0]),
          ["r", 0],
        ]));
      broadcast(initFrame());
      broadcast(withEnvelope(state));
    } else if (m.op === "setIncrements") {
      // The INI's jog increments (operator P7: the step group is a row only
      // with few, short options, else a select) — viewer_init.ini_config.
      activeViewerInit = { ...activeViewerInit, data: { ...activeViewerInit.data,
        ini_config: { ...(activeViewerInit.data.ini_config ?? {}), increments: m.increments } } };
      broadcast(initFrame());
    } else if (m.op === "setJointJog") {
      // Button gates package E: jogging before homing — the gateway's
      // viewer_init.ini_config.joint_jog (null: no declaration).
      activeViewerInit = { ...activeViewerInit, data: { ...activeViewerInit.data,
        ini_config: { ...(activeViewerInit.data.ini_config ?? {}), joint_jog: m.jointJog ?? null } } };
      broadcast(initFrame());
    } else if (m.op === "setKins") {
      // TWP-08b: re-ship viewer_init with a kins declaration (or none) — the
      // capability twin the strips key the Plane frame, the TWP action row
      // and the reserved G59 rows on (App.vue twpCapable).
      if (m.kins) activeViewerInit.data.kins = m.kins; else delete activeViewerInit.data.kins;
      broadcast(initFrame());
    } else if (m.op === "setViewerInit") {
      // Persist a real-STL fixture for reload/cache tests in serial-viewer.
      _initRev++;
      activeViewerInit = { type: "viewer_init", data: { ...m.data, _rev: _initRev } };
      broadcast(activeViewerInit);
    } else if (m.op === "rebuildInit") {
      // Force a real in-session scene rebuild: _rev busts ThreeViewer's
      // content-dedup so buildFromInit (clearScene + rebuild) actually runs.
      broadcast(initFrame());
    } else if (m.op === "loadGcode") {
      // viewer_gcode_ready → frontend fetches GET /preview?v=N → applyGcode
      // builds fresh feed/rapid/highlight geometry.
      _gcodeVer++;
      broadcast({ type: "viewer_gcode_ready", version: _gcodeVer, file: "/leak.ngc" });
    } else if (m.op === "raw") {
      let frame = m.frame;
      if (frame?.type === "settings_init" || frame?.type === "settings_changed") {
        frame = withDevice(frame);
        settingsStore = structuredClone(frame.settings);
      }
      broadcast(frame);
    } else if (m.op === "settingsOnHello") {
      settingsOnHello = m.on !== false;
    } else if (m.op === "devices") {
      devicesList = Array.isArray(m.devices) ? m.devices : [];
    } else if (m.op === "settingsEcho") {
      settingsEcho = !!m.on;
    } else if (m.op === "snapshot") {
      // What a reset restores, read back (per-worker mock, Codex R262
      // PM261-01): the baseline fixture and the isolation harness compare it.
      // `clients` counts the APP's sockets — a test's leftover page shows here.
      // `connect` is what a fresh app client would get (R263 PM263-01), the
      // viewer_init without its `_rev` (a revision every re-ship bumps).
      const [status, init] = connectFrames();
      const initData = { ...init.data };
      delete initData._rev;
      ws.send(JSON.stringify({ ok: true, op: "snapshot", snapshot: {
        connect: { status, viewerInit: { ...init, data: initData } },
        armed: state.armed, axes: _axes ?? VIEWER_INIT.data.axes, kins: VIEWER_INIT.data.kins ?? null,
        work_pos: state.data.work_pos, replies: Object.keys(replies).sort(), envelope: Object.keys(envelope).sort(),
        quiet, refuseWs, settingsEcho, settings: Object.keys(settingsStore).sort(),
        settingsRevs: { ...settingsRevs }, devices: devicesList.length, deviceName: MOCK_DEVICE.name, settingsOnHello,
        cmds: cmds.length, hellos: hellos.length, clients: wss.clients.size,
        instance: process.env.MOCK_INSTANCE ?? null,
      } }));
      return;
    } else if (m.op === "lastCmds") {
      ws.send(JSON.stringify({ ok: true, op: m.op, cmds }));
      return;
    } else if (m.op === "clearCmds") {
      cmds.length = 0;
    } else if (m.op === "lastHellos") {
      ws.send(JSON.stringify({ ok: true, op: m.op, hellos }));
      return;
    } else if (m.op === "replies") {
      replies = m.replies && typeof m.replies === "object" ? m.replies : {};
    } else if (m.op === "replyFor") {
      // one command's correlated reply, the others kept (null removes it)
      replies = { ...replies, [m.cmd]: m.reply ?? undefined };
      if (m.reply == null) delete replies[m.cmd];
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

// A port already taken is a failure with its reason — never another mock
// answering in this one's place (per-worker mock, PM261-03).
server.on("error", (e) => { console.error(`mock-gateway: ${e.message}`); process.exit(1); });
server.listen(PORT, process.env.MOCK_HOST, () => {
  console.log(`mock-gateway: http://localhost:${PORT}`);
  // The e2e worker fixture waits for exactly this line of ITS child: the bind
  // confirmed, not a reachable page (whose could it be?).
  if (process.env.MOCK_INSTANCE) console.log(`MOCK-BOUND ${server.address().port} ${process.env.MOCK_INSTANCE}`);
});

// Started by the e2e worker fixture: end with the worker. Its stdin is the
// fixture's pipe — EOF means the worker is gone (a crash included), so no
// mock outlives it holding the port its replacement needs. A manual
// `node e2e/mock-gateway.mjs` (stdin a terminal or /dev/null) is untouched.
// MOCK_EXIT_HOLD_UNTIL: the isolation harness only — hold the exit until that
// file exists, to steer a slow predecessor against the handoff wait.
if (process.env.MOCK_EXIT_ON_STDIN_EOF === "1") {
  const leave = () => {
    const hold = process.env.MOCK_EXIT_HOLD_UNTIL;
    if (!hold) process.exit(0);
    const poll = setInterval(() => {
      if (existsSync(hold)) { clearInterval(poll); process.exit(0); }
    }, 50);
  };
  process.stdin.on("end", leave);
  process.stdin.on("close", leave);
  process.stdin.resume();
}
