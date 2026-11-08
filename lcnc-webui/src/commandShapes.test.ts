// The commands the UI sends against the gateway's payload schema (test
// strategy step 2, Codex R248–R251 TS248-04): every command object is CLOSED —
// its fields come from `WsCommand` (lcnc.ts) through the TypeScript checker,
// and `fire` / `send` / `request` take nothing else, so the union is what goes
// out. Each field the gateway bounds (`COMMAND_SCHEMA`, command_policy.py) is a
// field the client declares for that command; each field the client sends
// without a bound is named here with its reason; a map or an opaque value is a
// named path with its contract. The worker's own frames are an inventory of
// their own. The gap this closes: `renumber_tool`'s schema bounded a
// `new_number` the client never sends, its `old_tool_number` had no bound —
// behind an open `[key: string]: any` and an untyped `fire(payload: any)`.
// Node-side: it reads the repository and asks Python for the schema.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const LCNC_TS = fileURLToPath(new URL("./lcnc.ts", import.meta.url));
const WORKER_TS = fileURLToPath(new URL("./wsWorker.ts", import.meta.url));
const GATEWAY = fileURLToPath(new URL("../../lcnc-gateway", import.meta.url));

interface ClientCommand { fields: Record<string, { optional: boolean; type: string }>; index: boolean }
type ClientCommands = Record<string, ClientCommand>;
interface Gateway { schema: Record<string, Record<string, string>>; gated: string[] }

/** `WsCommand`'s members through the checker: intersections and named
 *  interfaces resolved, an index signature reported. */
function readClient(path: string): ClientCommands {
  const program = ts.createProgram([path], { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022 });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(path)!;
  const alias = sf.statements.find((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === "WsCommand");
  if (!alias) throw new Error("WsCommand not found in lcnc.ts");
  const union = checker.getTypeAtLocation(alias.name);
  if (!union.isUnion()) throw new Error("WsCommand is no union");
  const out: ClientCommands = {};
  for (const member of union.types) {
    const cmdSym = member.getProperty("cmd");
    const cmdType = cmdSym && checker.getTypeOfSymbolAtLocation(cmdSym, alias);
    if (!cmdType || !cmdType.isStringLiteral()) throw new Error(`a WsCommand member without a literal cmd: ${checker.typeToString(member)}`);
    const fields: ClientCommand["fields"] = {};
    for (const p of checker.getPropertiesOfType(member)) {
      if (p.name === "cmd") continue;
      fields[p.name] = { optional: (p.flags & ts.SymbolFlags.Optional) !== 0,
        type: checker.typeToString(checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(p, alias))) };
    }
    out[cmdType.value] = { fields, index: checker.getIndexInfosOfType(member).length > 0 };
  }
  return out;
}

function readGateway(): Gateway {
  const py = `import sys, json; sys.path.insert(0, ${JSON.stringify(GATEWAY)}); import command_policy as cp
print(json.dumps({"schema": {c: {f: type(s).__name__ for f, s in fs.items()} for c, fs in cp.COMMAND_SCHEMA.items()},
                  "gated": sorted(cp.COMMAND_GATES)}))`;
  return JSON.parse(execFileSync("python3", ["-I", "-c", py]).toString()) as Gateway;
}

/** Commands the gateway knows and the UI never sends — each with its reason. */
const SERVER_ONLY: Record<string, string> = {
  set_max_velocity: "no control sends it (only a cooldown entry in lcnc.ts); kept for a script or a later control",
};
/** Commands the UI sends that have no gate entry — each with its reason. */
const UNGATED: Record<string, string> = {
  get_tool_table: "a read", list_probe_macros: "a read", get_probe_results: "a read",
  get_comp_grid: "a read", get_wcs_table: "a read",
  heartbeat: "the worker's frame, handled by the reader", tab_visibility: "the worker's frame, handled by the reader",
  save_settings: "admitted per section by the settings store (BG-19), not by a command gate",
  device_rename: "a device profile, admitted by the settings store: own device free, another armed",
  device_reset: "a device profile, admitted by the settings store: own device free, another armed",
  device_delete: "another device's profile, armed, refused while it is connected",
  timing_log: "diagnostics", client_diag: "diagnostics", halshow_live: "diagnostics (the HAL tab)",
  safety_trip_ack: "handled by the reader: the acknowledgement must pass whatever the state",
};
/** Fields the UI sends that the schema does not bound — each with its reason. */
const UNBOUNDED: Record<string, string> = {
  "arm.armed": "a boolean",
  "set_mode.mode": "checked by the handler against the task modes",
  "auto_run.file": "the handler binds it to the loaded program", "auto_run.spindle_dir": "an enum the handler checks",
  "auto_run.safe_z": "a boolean", "auto_run.entry_x": "the program's own coordinate", "auto_run.entry_y": "the program's own coordinate",
  "auto_run.entry_wcs": "an enum the handler checks", "auto_run.entry_units": "an enum the handler checks",
  "load_file.path": "the handler admits only paths inside PROGRAM_PREFIX",
  "jog_incr.distance": "bounded by the handler against the axis window",
  "set_optional_stop.value": "a boolean", "set_block_delete.value": "a boolean", "set_compensation.enable": "a boolean",
  "confirm_tool_change.request": "matched against the pending request (BG-17)",
  "clear_wcs.target": "an enum the handler checks", "set_wcs.target": "an enum the handler checks",
  "save_settings.section": "checked against _VALID_SETTINGS_SECTIONS",
  "save_settings.base_rev": "the store refuses anything but a non-negative integer",
  "save_settings.device": "a public profile id the store looks up (unknown = refused)",
  "device_rename.name": "trimmed and bounded (40 characters) by the store",
  "device_rename.device": "a public profile id the store looks up", "device_reset.device": "a public profile id the store looks up",
  "device_delete.device": "a public profile id the store looks up",
  "timing_log.enable": "a boolean", "halshow_live.on": "a boolean", "tab_visibility.hidden": "a boolean",
};
/** The tool editor's fields beyond the bounded ones (ToolFields): the
 *  metadata the handler writes to the tool library. */
const TOOL_METADATA = ["z_offset", "remark", "description", "type", "flutes", "oal", "flute_length", "corner_radius",
  "body_length", "shaft_diameter", "taper_angle", "point_angle", "tip_diameter", "material", "holder"];
for (const c of ["save_tool", "add_tool", "renumber_tool"]) for (const f of TOOL_METADATA) UNBOUNDED[`${c}.${f}`] = "tool metadata, written as given";
/** Maps: a path, its keys and values — the contract the replay checks. */
const DATA_MAPS: Record<string, string> = {
  "mdi.vars": "keys ^\\d+$, finite numbers, each declared in the var file (VarNumbers) — the generic parameter path",
  "set_params.sets": "purpose (features.PURPOSE_VARS) → VarNumbers; each set its purpose's own, a shared number one value — or refused whole (PurposeSets)",
  "probe_run.vars": "VarNumbers, and every key of the probe purpose or refused whole",
  "surface_scan_run.vars": "VarNumbers, and every key of the surface purpose or refused whole",
  "auto_run.probe_vars": "keys ^\\d+$, finite numbers, each declared in the var file (VarNumbers)",
  "touchoff.axes": "keys TOUCHOFF_LETTERS, finite numbers (AxisMap)",
  "set_g30.values": "keys axis letters, finite numbers", "set_g30.based_on": "keys axis letters, finite numbers",
  "touchoff.expect": "kins_type, g5x_index: integers or null (ExpectMap)",
  // OPEN (test strategy step 2, raised in its review): the schema bounds only
  // the count (Seq ≤ n_axes); the homed handler passes each entry's axis and
  // vel on without the single jog's bounds (axis index, ±max_jog_velocity —
  // LinuxCNC caps the velocity itself). Per-entry bounds are owed, with the
  // motion buttons' live check (twp_buttons_check.py).
  "jog_cont_multi.axes": "entries {axis, vel}: count ≤ n_axes; per-entry bounds OPEN",
  "jog_incr_multi.axes": "entries {axis, vel, distance}: count ≤ n_axes; per-entry bounds OPEN",
};
/** Opaque values: the exact path and why this check stops there. */
const OPAQUE: Record<string, string> = {
  "save_settings.data": "the section, checked by the settings store per section",
  "client_diag.data": "diagnostics without effect",
};
/** The worker's own frames (wsWorker.ts): the fields each carries. */
const WORKER_FRAMES: Record<string, string[]> = { hello: ["session", "resume_armed", "device_token", "device_storage"], tab_visibility: ["hidden"], heartbeat: ["seq"] };

const isMapType = (t: string) => /^Record<|^\{|^any$|^unknown$|\[\]$/.test(t) && !/^(string|number|boolean)\[\]$/.test(t);

/** Every finding; [] when the client and the gateway agree. Pure. */
export function commandShapeFindings(client: ClientCommands, gw: Gateway, lists = { SERVER_ONLY, UNGATED, UNBOUNDED, DATA_MAPS, OPAQUE }): string[] {
  const out: string[] = [];
  const known = new Set([...Object.keys(gw.schema), ...gw.gated]);
  for (const c of known) if (!client[c] && !lists.SERVER_ONLY[c]) out.push(`${c}: the gateway knows it, the UI never sends it and no reason is named`);
  for (const c of Object.keys(lists.SERVER_ONLY)) if (client[c]) out.push(`${c}: listed as server-only but the UI sends it`);
  for (const [c, cc] of Object.entries(client)) {
    if (cc.index) out.push(`${c}: an open index signature — the command must be closed`);
    if (!gw.gated.includes(c) && !lists.UNGATED[c]) out.push(`${c}: sent without a gate entry and no reason is named`);
    for (const f of Object.keys(gw.schema[c] ?? {})) if (!(f in cc.fields)) out.push(`${c}.${f}: the schema bounds a field the UI never sends`);
    for (const [f, d] of Object.entries(cc.fields)) {
      const path = `${c}.${f}`;
      if (isMapType(d.type) && !lists.DATA_MAPS[path] && !lists.OPAQUE[path]) out.push(`${path}: a map or opaque value (${d.type}) without a named contract`);
      if (!(f in (gw.schema[c] ?? {})) && !lists.UNBOUNDED[path] && !lists.DATA_MAPS[path] && !lists.OPAQUE[path])
        out.push(`${path}: sent without a schema bound and no reason is named`);
    }
  }
  for (const p of [...Object.keys(lists.UNBOUNDED), ...Object.keys(lists.DATA_MAPS), ...Object.keys(lists.OPAQUE)]) {
    const [c, f] = p.split(".");
    if (!client[c!]?.fields[f!]) out.push(`${p}: listed, but the UI sends no such field`);
  }
  return out;
}

/** The cmd and the field names of every frame wsWorker.ts builds itself. */
function workerFrames(src: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of src.matchAll(/\.send\(JSON\.stringify\(\{([^}]*)\}\)\)|\.send\(`\{([^`]*)\}`\)/g)) {
    const body = m[1] ?? m[2]!;
    const keys = [...body.matchAll(/"?(\w+)"?\s*:/g)].map(k => k[1]!);
    const cmd = /"?cmd"?\s*:\s*"(\w+)"/.exec(body)?.[1];
    if (!cmd) throw new Error(`a worker frame without a literal cmd: ${body}`);
    out[cmd] = [...new Set(keys.filter(k => k !== "cmd"))].sort();
  }
  return out;
}

describe("the commands the UI sends, against the gateway's schema", () => {
  const client = readClient(LCNC_TS);
  const gw = readGateway();

  it("are read: the union, the schema and the gates are there", () => {
    expect(Object.keys(client).length).toBeGreaterThanOrEqual(70);
    expect(Object.keys(gw.schema).length).toBeGreaterThanOrEqual(25);
    expect(client.mdi?.fields.vars?.type).toBe("Record<string, number>");
  });

  it("agree: every bounded field is sent, every sent field is bounded or named, every map has its contract", () => {
    expect(commandShapeFindings(client, gw)).toEqual([]);
  });

  it("the worker's own frames are exactly the inventory", () => {
    expect(workerFrames(readFileSync(WORKER_TS, "utf8"))).toEqual(
      Object.fromEntries(Object.entries(WORKER_FRAMES).map(([c, f]) => [c, [...f].sort()])));
  });

  // The mechanism, on made-up data: each class of drift is found.
  it("finds a bounded field the UI never sends, an open command, an unnamed map, an unknown command", () => {
    const c: ClientCommands = {
      renumber: { fields: { old: { optional: false, type: "number" } }, index: true },
      mdi: { fields: { text: { optional: false, type: "string" }, extra: { optional: true, type: "Record<string, number>" } }, index: false },
    };
    const g: Gateway = { schema: { renumber: { old: "Num", new: "Num" }, mdi: { text: "Text" } }, gated: ["renumber", "mdi", "invented"] };
    const f = commandShapeFindings(c, g, { SERVER_ONLY: {}, UNGATED: {}, UNBOUNDED: {}, DATA_MAPS: {}, OPAQUE: {} });
    expect(f).toEqual(expect.arrayContaining([
      "invented: the gateway knows it, the UI never sends it and no reason is named",
      "renumber: an open index signature — the command must be closed",
      "renumber.new: the schema bounds a field the UI never sends",
      "mdi.extra: a map or opaque value (Record<string, number>) without a named contract",
    ]));
  });

  it("finds a new worker frame and a frame without a literal cmd", () => {
    expect(workerFrames('ws.send(JSON.stringify({ cmd: "hello", session: s }));\nws.send(`{"cmd":"ping","t":${t}}`);'))
      .toEqual({ hello: ["session"], ping: ["t"] });
    expect(() => workerFrames("ws.send(JSON.stringify({ kind: x }));")).toThrow(/without a literal cmd/);
  });
});
