// The function inventory's web atoms (Codex R265–R268 FI265-01): the tree's
// atoms equal the committed scripts/inventory/atoms.web.json — a new control,
// command, key, setting or routine fails here until the file is regenerated
// (`INVENTORY_WRITE=1 npx vitest run src/inventory/webAtoms.test.ts`), and the
// backend's inventory test then demands its function. Each adapter has a
// counter-case: what it must find, and what it must report unresolved.
// Node-side: it reads the source tree.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as probeFields from "../probeFields";
import {
  commandsAdapter, controlsAdapter, familyMembers, framesAdapter, gamepadAdapter, keyboardAdapter, listenersAdapter,
  probeRoutines, routinesAdapter, unionLiterals, webAtoms, type WebSources,
} from "./webAtoms";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const OUT = fileURLToPath(new URL("../../../scripts/inventory/atoms.web.json", import.meta.url));
const TYPED = ["defaults.ts", "lcnc.ts", "ws/statusStore.ts"];
const OPTIONS: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, skipLibCheck: true };

function treeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return treeFiles(p);
    return /\.(vue|ts)$/.test(e.name) && !/\.test\.ts$|\.d\.ts$/.test(e.name) ? [p] : [];
  });
}

function treeSources(): WebSources {
  const files = Object.fromEntries(treeFiles(SRC).map((p) => [relative(SRC, p), readFileSync(p, "utf8")]));
  return { files, program: ts.createProgram(TYPED.map((r) => join(SRC, r)), OPTIONS), abs: (r) => join(SRC, r), familyRoots: probeFields };
}

/** ProbePanel's three ways of naming a routine (the counter-cases). */
const PROBE_PANEL = `<template><b @click="runCalProbe('probe_cal_round_boss')" /></template><script setup>
const ops = [{ macro: "probe_z_minus_wco" }];
function runGridProbe(op) { emit("runProbe", { vars, macro: op.macro }); }
function runCalProbe(macro) { emit("runProbe", { vars, macro }); }
function runSurfaceScan() { emit("runProbe", { vars, macro: "surface_scan" }); }
</script>`;

/** A program over in-memory files (the counter-cases). */
function memory(files: Record<string, string>, roots: Record<string, unknown> = {}): WebSources {
  const host = ts.createCompilerHost(OPTIONS);
  const at = (f: string) => files[f.replace(/^\/mem\//, "")];
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, v, ...rest) => (at(f) !== undefined ? ts.createSourceFile(f, at(f)!, v) : getSourceFile(f, v, ...rest));
  host.fileExists = (f) => at(f) !== undefined || ts.sys.fileExists(f);
  host.readFile = (f) => at(f) ?? ts.sys.readFile(f);
  const typed = Object.keys(files).filter((f) => f.endsWith(".ts")).map((f) => `/mem/${f}`);
  return { files, program: ts.createProgram(typed, OPTIONS, host), abs: (r) => `/mem/${r}`, familyRoots: roots };
}

describe("the function inventory's web atoms (Codex R265–R268 FI265-01)", () => {
  it("are the committed atoms.web.json", () => {
    const atoms = webAtoms(treeSources());
    const text = JSON.stringify(atoms, null, 1) + "\n";
    if (process.env.INVENTORY_WRITE === "1") writeFileSync(OUT, text);
    expect(JSON.parse(readFileSync(OUT, "utf8")), "the web atoms changed — regenerate scripts/inventory/atoms.web.json "
      + "(INVENTORY_WRITE=1) and give each new atom its function in scripts/inventory/functions.json").toEqual(JSON.parse(text));
  });

  it("counts what Codex counted: keyboard 21, gamepad 12 actions, every WsCommand", () => {
    const src = treeSources();
    expect(keyboardAdapter(src).atoms).toHaveLength(21);
    expect(gamepadAdapter(src).atoms.filter((a) => a.id.startsWith("pad:"))).toHaveLength(12);
    expect(commandsAdapter(src).unresolved).toEqual([]);
    expect(framesAdapter(src).atoms.map((a) => a.id)).toEqual(["frame:heartbeat", "frame:hello", "frame:tab_visibility"]);
  });

  it("keyboard: a template-literal family resolves, one letter more is two actions more", () => {
    const decl = (letters: string) => `type L = ${letters}; export type KeyboardAction = \`jog_\${L}\${"+" | "-"}\` | "estop";`;
    expect(keyboardAdapter(memory({ "defaults.ts": decl('"x" | "y"') })).atoms).toHaveLength(5);
    expect(keyboardAdapter(memory({ "defaults.ts": decl('"x" | "y" | "z"') })).atoms).toHaveLength(7);
  });

  it("a union member that is no literal is unresolved, never dropped", () => {
    const r = unionLiterals(memory({ "defaults.ts": "export type GamepadAction = \"start\" | number;" }), "defaults.ts", "GamepadAction");
    expect(r.values).toEqual(["start"]);
    expect(r.unresolved.map((u) => u.expr)).toEqual(["number"]);
  });

  it("gamepad: the actions come from the type — a label taken by reference loses none", () => {
    const src = memory({ "defaults.ts": `const L = { start: "Start" };
      export type GamepadAction = "start" | "none";
      export const GAMEPAD_ACTIONS = [{ value: "start", label: L.start }];
      export interface GamepadMapping { btn_a: GamepadAction }` });
    expect(gamepadAdapter(src).atoms.map((a) => a.id)).toEqual(["pad:none", "pad:start", "padButton:btn_a"]);
  });

  it("commands: a member without a literal cmd is unresolved", () => {
    const src = memory({ "lcnc.ts": "export type WsCommand = { cmd: \"abort\" } | { cmd: string; x: 1 };" });
    const a = commandsAdapter(src);
    expect(a.atoms.map((x) => x.id)).toEqual(["cmd:abort"]);
    expect(a.unresolved).toHaveLength(1);
  });

  it("controls: two identical controls are two atoms; a registered family names its members", () => {
    const vue = `<template><div>
      <MachineBtn type="abort" @click="stop" /><MachineBtn type="abort" @click="stop" />
      <MachineInput v-for="f in FIELDS.boss" gate="probeParam" v-model="p[f.key]" />
      <MachineInput v-for="f in other" gate="probeParam" v-model="q[f.key]" />
    </div></template>`;
    const a = controlsAdapter(memory({ "P.vue": vue }, { FIELDS: { boss: [{ key: "d" }, { key: "h" }] } }));
    const ids = a.atoms.map((x) => x.id);
    expect(ids.filter((i) => i.includes("abort"))).toEqual(["control:P.vue|MachineBtn:abort|@click=stop", "control:P.vue|MachineBtn:abort|@click=stop#2"]);
    expect(a.atoms.find((x) => x.id.includes("p[f.key]"))?.members).toEqual(["d", "h"]);
    expect(a.unresolved, "a family without members hides no atom").toEqual([]);
    expect(a.variantsOpen).toEqual([{ file: "P.vue", form: "v-for family", expr: "f in other" }]);
  });

  it("controls: a family inside a v-for element is the element's, outermost first", () => {
    const vue = `<template><ul><li v-for="row in rows"><input v-for="c in row.cells" @input="set(c)"></li></ul><input @input="x"></template>`;
    const a = controlsAdapter(memory({ "T.vue": vue }));
    expect(a.atoms.map((x) => x.family ?? [])).toEqual([["row in rows", "c in row.cells"], []]);
  });

  it("family members: a list literal, a path, an unknown root", () => {
    expect(familyMembers("f in [ONE]", { ONE: { key: "k" } })).toEqual(["k"]);
    expect(familyMembers("(f, i) in A.b", { A: { b: ["x", "y"] } })).toEqual(["x", "y"]);
    expect(familyMembers("f in nope", {})).toBeNull();
  });

  it("listeners: a global listener with a literal event is an atom, a computed one unresolved, an element's not counted", () => {
    const src = memory({ "k.ts": `window.addEventListener("keydown", f); document.addEventListener(ev, g); el.addEventListener("click", h);` });
    const a = listenersAdapter(src);
    expect(a.atoms.map((x) => x.id)).toEqual(["listener:k.ts:window.keydown"]);
    expect(a.unresolved.map((u) => u.expr)).toEqual(["document.addEventListener(ev, g)"]);
  });

  it("routines: literal calls, the probe macro family, the M-codes; any other dynamic name unresolved", () => {
    const src = memory({
      "App.vue": "<template><b @click=\"fire({ cmd: 'mdi', text: 'O<go_to_g30> CALL' })\" /></template><script setup>emit(`O<${macro}> CALL`); toolsetterMdi('Load', `T${n} M600`); x(`o<${name}> call`)</script>",
      "ProbePanel.vue": PROBE_PANEL,
    });
    const a = routinesAdapter(src);
    expect(a.atoms.map((x) => x.id)).toEqual(["routine:go_to_g30", "routine:M600", "routine:probe_cal_round_boss",
      "routine:probe_z_minus_wco", "routine:surface_scan"]);
    expect(a.unresolved.map((u) => u.expr)).toEqual(["o<${name}> call"]);
  });

  it("probe routines: a literal, the tables through op.macro, runCalProbe's literal arguments; any other form unresolved", () => {
    expect(probeRoutines("ProbePanel.vue", PROBE_PANEL)).toEqual({ names: ["probe_cal_round_boss", "probe_z_minus_wco", "surface_scan"], unresolved: [] });
    const other = probeRoutines("ProbePanel.vue", PROBE_PANEL.replace("</script>", "emit(\"runProbe\", { vars, macro: pick() });</script>"));
    expect(other.unresolved.map((u) => u.form)).toEqual(["emit(\"runProbe\", { macro })"]);
    const noTables = probeRoutines("ProbePanel.vue", PROBE_PANEL.replace("{ macro: \"probe_z_minus_wco\" }", "{ id: 1 }"));
    expect(noTables.unresolved.map((u) => u.form)).toEqual(["op.macro"]);
  });

  it("frames: a JSON object, a text frame and a relay are read; any other send is unresolved", () => {
    const a = framesAdapter(memory({ "wsWorker.ts": 'ws.send(JSON.stringify({ cmd: "hello" })); ws.send(`{"cmd":"heartbeat","seq":${n}}`); ws.send(p); ws.send(msg.payload); ws.send(build());' }));
    expect(a.atoms.map((x) => x.id)).toEqual(["frame:heartbeat", "frame:hello"]);
    expect(a.unresolved.map((u) => u.expr)).toEqual(["ws.send(build())"]);
  });

  it("routines: the reference's syntax text is excluded with its reason; the same text elsewhere is not", () => {
    const a = routinesAdapter(memory({ "gcodeReference.ts": 'const r = { syntax: "O<name> call [arg1]" };', "X.ts": 'mdi(`O<${n}> CALL`); const s = "O<name> call";' }));
    expect(a.excluded?.map((e) => e.file)).toEqual(["gcodeReference.ts"]);
    expect(a.unresolved.map((u) => `${u.file} ${u.expr}`)).toEqual(["X.ts O<${n}> CALL"]);
    expect(a.atoms.map((x) => x.id)).toEqual(["routine:name"]);
  });

  it("the inventory's own files are outside the boundary, and say so", () => {
    const w = webAtoms(treeSources());
    expect(Object.keys(w.excludedFiles)).toEqual(["inventory/"]);
    expect(JSON.stringify(w.adapters)).not.toContain("inventory/webAtoms.ts");
  });

  it("routines: the macro family without its literals is unresolved", () => {
    const a = routinesAdapter(memory({ "App.vue": "<script setup>emit(`O<${macro}> CALL`)</script>" }));
    expect(a.unresolved).toHaveLength(1);
  });

  it("an adapter that finds nothing fails — no answer is never an empty inventory", () => {
    const minimal = (listener: string) => memory({
      "defaults.ts": `export type KeyboardAction = "estop"; export type GamepadAction = "start";
        export interface GamepadMapping { btn_a: GamepadAction } declare function registerSection<T>(k: string, f: T): void;
        registerSection<{ a: number }>("probe", { a: 1 });`,
      "lcnc.ts": "export type WsCommand = { cmd: \"abort\" };",
      "ws/statusStore.ts": "export interface WsStatus { estop: boolean }",
      "wsWorker.ts": "ws.send(JSON.stringify({ cmd: \"hello\" }));",
      "App.vue": `<template><button @click="go" /></template><script setup>${listener} emit("O<go_to_home> CALL")</script>`,
    });
    expect(() => webAtoms(minimal("window.addEventListener(\"keydown\", f);"))).not.toThrow();
    expect(() => webAtoms(minimal(""))).toThrow(/the listeners adapter found nothing/);
  });
});
