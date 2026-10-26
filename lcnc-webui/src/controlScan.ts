// The template scan behind the control inventory (button gates BG-01, Codex
// R202–R204): every control a DISARMED client can operate, found in the
// source. Since package C there is no outer `armed` fieldset: a control is
// live while disarmed when its own gate and every `<Gate>` around it in its
// file open without arm (LIVE_GATES). Each such control must be classified
// in controlInventory.ts — what it does and why that needs no arm — so a
// protected effect can never become reachable by accident.
//
// Pure string work, no DOM and no node APIs: the test feeds it the raw
// `.vue` sources through Vite's glob. A scan per FILE: a component's controls
// are judged without the Gates of the parent that mounts it — after the
// outer fieldset's removal that is exactly what a disarmed client meets.
import { BUTTON_TYPES, INPUT_DEFS } from "./machineControls";

/** Gates open to a disarmed client: `always` and the stops (BG-08 / BG-18). */
export const LIVE_GATES: ReadonlySet<string> = new Set(["always", "abort", "pause", "spindleStop"]);

/** The catalog components and the attribute that names their catalog entry. */
const CATALOG_ATTR: Record<string, "type" | "gate"> = {
  MachineBtn: "type", MachineInput: "gate", MachineToggle: "gate", MachineSelect: "gate",
  MachineSlider: "gate", MachineRadio: "gate", MachineColor: "gate", MachineChoice: "gate",
};
const RAW_CONTROLS = new Set(["button", "input", "select", "textarea"]);
const ACTION_EVENTS = ["@click", "@pointerdown", "v-on:click"];

export interface ControlUsage {
  /** `file|tag:entry|handlers` — the inventory key (no line numbers: they move). */
  key: string;
  file: string;
  line: number;
  tag: string;
  /** The catalog entry (MachineBtn type / input gate), its literal(s) for a
   *  bound expression, or "" for a raw control. */
  entry: string;
  /** The catalog gate(s) the entry resolves to ("raw" for a raw control). */
  gates: string[];
}

interface Tag { name: string; attrs: Record<string, string>; start: number; end: number; selfClosing: boolean; closing: boolean }

/** The template part of a single-file component (first `<template` to the last `</template>`). */
function templateOf(sfc: string): { text: string; offset: number } {
  const start = sfc.search(/^<template\b/m);
  const end = sfc.lastIndexOf("</template>");
  if (start < 0 || end < 0) return { text: "", offset: 0 };
  return { text: sfc.slice(start, end), offset: start };
}

/** Tags in order, attributes parsed with quotes respected; comments skipped. */
function* tags(text: string): Generator<Tag> {
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) return;
    if (text.startsWith("<!--", lt)) { const e = text.indexOf("-->", lt); i = e < 0 ? text.length : e + 3; continue; }
    const m = /^<(\/?)([A-Za-z][\w-]*)/.exec(text.slice(lt, lt + 80));
    if (!m) { i = lt + 1; continue; }
    let j = lt + m[0].length;
    const attrs: Record<string, string> = {};
    let quote = "";
    const pushAttr = (raw: string) => {
      const a = raw.trim();
      if (!a) return;
      const eq = a.indexOf("=");
      if (eq < 0) { attrs[a] = ""; return; }
      attrs[a.slice(0, eq).trim()] = a.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    };
    let buf = "";
    for (; j < text.length; j++) {
      const c = text[j] ?? "";
      if (quote) { buf += c; if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") { quote = c; buf += c; continue; }
      if (c === ">") break;
      if (/\s/.test(c)) { pushAttr(buf); buf = ""; continue; }
      buf += c;
    }
    const selfClosing = buf.endsWith("/");
    pushAttr(selfClosing ? buf.slice(0, -1) : buf);
    yield { name: m[2] ?? "", attrs, start: lt, end: j, selfClosing, closing: m[1] === "/" };
    i = j + 1;
  }
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Every catalog gate a bound expression can name (its quoted literals). */
function literals(expr: string): string[] {
  return [...expr.matchAll(/['"`]([A-Za-z][\w]*)['"`]/g)].map((m) => m[1] ?? "");
}

function gateOf(tag: string, entry: string): string | undefined {
  const defs = (tag === "MachineBtn" ? BUTTON_TYPES : INPUT_DEFS) as Record<string, { gate: string }>;
  return defs[entry]?.gate;
}

/** A Gate's gate(s): the literal, or every literal of a bound expression. */
function gateNames(attrs: Record<string, string>): string[] {
  if (attrs.gate !== undefined) return [attrs.gate];
  if (attrs[":gate"] !== undefined) return literals(attrs[":gate"]);
  return [];
}

/** The controls of one `.vue` file a disarmed client can operate. */
export function scanControls(file: string, sfc: string): ControlUsage[] {
  const { text, offset } = templateOf(sfc);
  const out: ControlUsage[] = [];
  const gateStack: string[][] = [];
  const lineAt = (pos: number) => sfc.slice(0, offset + pos).split("\n").length;
  for (const t of tags(text)) {
    if (t.name === "Gate") {
      if (t.closing) gateStack.pop();
      else if (!t.selfClosing) gateStack.push(gateNames(t.attrs));
      continue;
    }
    if (t.closing) continue;
    // Inside a Gate that closes for a disarmed client: protected by it.
    if (gateStack.some((g) => g.length > 0 && g.every((n) => !LIVE_GATES.has(n)))) continue;
    const handlers = Object.keys(t.attrs)
      .filter((a) => a.startsWith("@") || a.startsWith("v-on:") || a.startsWith("v-model"))
      .sort().map((a) => `${a}=${norm(t.attrs[a] ?? "")}`).join(" ");
    const attr = CATALOG_ATTR[t.name];
    if (attr) {
      const bound = t.attrs[`:${attr}`];
      const entries = bound !== undefined ? literals(bound) : [t.attrs[attr] ?? ""];
      const gates = entries.map((e) => gateOf(t.name, e)).filter((g): g is string => !!g);
      // A bound entry without any catalog literal (MachineChoice's o.gate):
      // its options live in a script — listed so the inventory names them.
      if (gates.length && gates.every((g) => !LIVE_GATES.has(g))) continue;
      const entry = bound !== undefined ? `{${norm(bound)}}` : entries[0] ?? "";
      out.push({ key: `${file}|${t.name}:${entry}|${handlers}`, file, line: lineAt(t.start), tag: t.name, entry, gates: gates.length ? gates : ["dynamic"] });
      continue;
    }
    const isRaw = RAW_CONTROLS.has(t.name) || t.attrs.role === "button"
      || (/^[a-z]/.test(t.name) && ACTION_EVENTS.some((e) => t.attrs[e] !== undefined));
    if (!isRaw) continue;
    const disabled = t.attrs[":disabled"] !== undefined ? ` :disabled=${norm(t.attrs[":disabled"])}` : "";
    out.push({ key: `${file}|${t.name}|${handlers}${disabled}`, file, line: lineAt(t.start), tag: t.name, entry: "", gates: ["raw"] });
  }
  return out;
}
