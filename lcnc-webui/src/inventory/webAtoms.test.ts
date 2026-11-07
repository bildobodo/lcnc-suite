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

  it("controls: a ChoiceGroup instance is the control at its place, in either spelling", () => {
    const vue = `<template><div><ChoiceGroup label="Task mode" :options="o" :act="modeAct" /><choice-group label="Frame" :act="f" /></div></template>`;
    expect(controlsAdapter(memory({ "J.vue": vue })).atoms.map((x) => x.id)).toEqual([
      "control:J.vue|ChoiceGroup:Frame| :act=f", "control:J.vue|ChoiceGroup:Task mode| :act=modeAct"]);
  });

  it("controls: a catalog component in kebab-case is read (Codex R270 FI-I04); a tag the scan does not read is unresolved", () => {
    const vue = `<template><div><MachineInput gate="mdiText" v-model="a" /><machine-input gate="mdiText" v-model="b" /></div></template>`;
    const a = controlsAdapter(memory({ "M.vue": vue }));
    expect(a.atoms.map((x) => x.id)).toEqual(["control:M.vue|MachineInput:mdiText|v-model=a", "control:M.vue|MachineInput:mdiText|v-model=b"]);
    expect(a.unresolved).toEqual([]);
    // written in the template, but inside an attribute: no tag the scan reads
    const odd = controlsAdapter(memory({ "N.vue": `<template><div title="<MachineBtn type=abort>"><MachineBtn type="abort" @click="x" /></div></template>` }));
    expect(odd.unresolved).toEqual([{ file: "N.vue", form: "<MachineBtn>", expr: "2 written, 1 found" }]);
    // a commented-out one is no use
    expect(controlsAdapter(memory({ "C.vue": `<template><!-- <MachineBtn type="abort" /> --><MachineBtn type="abort" @click="x" /></template>` })).unresolved).toEqual([]);
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

  it("frames: a JSON object, a text frame, a const bound to one; the two proven relays; any other send unresolved (Codex R270 FI-I03)", () => {
    const worker = `ws.send(JSON.stringify({ cmd: "hello" })); ws.send(\`{"cmd":"heartbeat","seq":\${n}}\`);
      function flush() { while (preOpenQueue.length) { const p = preOpenQueue.shift()!; ws.send(p); } }
      function onmsg(msg) { switch (msg.type) { case "send": preOpenQueue.push(msg.payload); ws.send(msg.payload); break; } }
      function own() { const f = JSON.stringify({ cmd: "new_frame", value: 1 }); ws.send(f); }`;
    const a = framesAdapter(memory({ "wsWorker.ts": worker }));
    expect(a.atoms.map((x) => x.id)).toEqual(["frame:heartbeat", "frame:hello", "frame:new_frame"]);
    expect(a.unresolved).toEqual([]);
    const other = framesAdapter(memory({ "wsWorker.ts": worker + `\nfunction x(v) { ws.send(v); ws.send(msg.payload); preOpenQueue.push(build()); }` }));
    expect(other.unresolved.map((u) => u.expr)).toEqual(["ws.send(v)", "ws.send(msg.payload)", "preOpenQueue.push(build())"]);
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

  it("probe routines: one unknown table entry or calibration call beside known literals is unresolved (Codex R270 FI-I02)", () => {
    const table = probeRoutines("ProbePanel.vue", PROBE_PANEL.replace("{ macro: \"probe_z_minus_wco\" }", "{ macro: \"probe_z_minus_wco\" }, { macro: chooseRoutine() }"));
    expect(table.names).toContain("probe_z_minus_wco");
    expect(table.unresolved.map((u) => u.form)).toEqual(["a procedure table's macro:"]);
    const cal = probeRoutines("ProbePanel.vue", PROBE_PANEL.replace("<b @click", "<i @click=\"runCalProbe(selected)\" /><b @click"));
    expect(cal.names).toContain("probe_cal_round_boss");
    expect(cal.unresolved.map((u) => u.expr)).toEqual(["runCalProbe(selected)"]);
  });

  it("probe routines: a spaced or line-broken calibration call is read; any other argument unresolved (Codex R271 FI-I02)", () => {
    const tpl = (extra: string) => PROBE_PANEL.replace("<b @click", `${extra}<b @click`);
    const spaced = probeRoutines("ProbePanel.vue", tpl(`<i @click="runCalProbe ('probe_cal_b')" /><u @click="runCalProbe\n('probe_cal_c')" />`));
    expect(spaced.names).toEqual(expect.arrayContaining(["probe_cal_b", "probe_cal_c", "probe_cal_round_boss"]));
    expect(spaced.unresolved).toEqual([]);
    const v = probeRoutines("ProbePanel.vue", tpl(`<i @click="runCalProbe (selected)" />`));
    expect(v.unresolved.map((u) => u.expr)).toEqual(["runCalProbe (selected)"]);
    // a mention the parser does not read as a call
    const odd = probeRoutines("ProbePanel.vue", tpl(`<i title="runCalProbe" />`));
    expect(odd.unresolved.map((u) => u.form)).toEqual(["runCalProbe in the template"]);
  });

  it("frames: a let, a second binding or a multi-value push is no proven value (Codex R271 FI-I03)", () => {
    const relayCase = `function onmsg(msg) { switch (msg.type) { case "send": preOpenQueue.push(msg.payload); break; } }`;
    const a1 = framesAdapter(memory({ "wsWorker.ts": `function f() { let own = JSON.stringify({ cmd: "hello" }); own = JSON.stringify({ cmd: "new_frame" }); ws.send(own); }` }));
    expect(a1.unresolved.map((u) => u.expr)).toEqual(["ws.send(own)"]);
    const a2 = framesAdapter(memory({ "wsWorker.ts": `${relayCase} function g() { let p = preOpenQueue.shift(); p = JSON.stringify({ cmd: "new_frame" }); ws.send(p); }` }));
    expect(a2.unresolved.map((u) => u.expr)).toEqual(["ws.send(p)"]);
    const a3 = framesAdapter(memory({ "wsWorker.ts": `function onmsg(msg) { switch (msg.type) { case "send": preOpenQueue.push(msg.payload, JSON.stringify({ cmd: "new_frame" })); break; } } ws.send(JSON.stringify({ cmd: "hello" }));` }));
    expect(a3.unresolved.map((u) => u.form)).toEqual(["the relay queue filled from elsewhere"]);
  });

  it("frames: the binding is the one at the send — not a parameter's namesake in an inner function or a left block (Codex R272 FI-I03)", () => {
    const inner = `function send(own) { function otherFrame() { const own = JSON.stringify({ cmd: "hello" }); return own; } otherFrame(); ws.send(own); }`;
    expect(framesAdapter(memory({ "wsWorker.ts": inner })).unresolved.map((u) => u.expr)).toEqual(["ws.send(own)"]);
    const left = `function f(own) { { const own = JSON.stringify({ cmd: "hello" }); void own; } ws.send(own); }`;
    expect(framesAdapter(memory({ "wsWorker.ts": left })).unresolved.map((u) => u.expr)).toEqual(["ws.send(own)"]);
    const shadow = `function f(own) { if (x) { const own = JSON.stringify({ cmd: "hello" }); ws.send(own); } }`;
    const a = framesAdapter(memory({ "wsWorker.ts": shadow }));
    expect([a.atoms.map((x) => x.id), a.unresolved]).toEqual([["frame:hello"], []]);
  });

  it("frames: by the checker's symbol — a binding pattern, a function-wide var, a loop or catch binding is no proven value (Codex R273 FI-I03)", () => {
    const outer = `const own = JSON.stringify({ cmd: "hello" });\n`;
    const cases = [
      "function send({ own }) { ws.send(own); }",
      "function send([own]) { ws.send(own); }",
      "function send(x) { const { own } = x; ws.send(own); }",
      "function send() { try { f(); } catch ({ own }) { ws.send(own); } }",
      "function send(xs) { for (const { own } of xs) ws.send(own); }",
      "function send() { if (c) { var own = JSON.stringify({ cmd: \"new_frame\" }); } ws.send(own); }",
      "function send(xs) { for (var own of xs) {} ws.send(own); }",
    ];
    for (const c of cases) expect(framesAdapter(memory({ "wsWorker.ts": outer + c })).unresolved.map((u) => u.expr), c).toEqual(["ws.send(own)"]);
    // the outer const itself, seen at the send: a proven frame
    const seen = framesAdapter(memory({ "wsWorker.ts": outer + "function send() { ws.send(own); }" }));
    expect([seen.atoms.map((x) => x.id), seen.unresolved]).toEqual([["frame:hello"], []]);
    // a TypeScript program per case, CPU-bound: 1.8 s alone, past vitest's 5 s
    // under the merge gate's load (2026-11-05) — a budget, not a wait
  }, 20_000);

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
