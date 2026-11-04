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
//
// What it reads (Codex R213 BG-30): an event by its NAME — `@click.self`,
// `v-on:click.stop` and `@click` are one event; a bound entry or Gate by
// every value it can take — closed only when each is a literal whose gate
// closes without arm, anything dynamic is listed. Its limit, named: it
// guards the LIST of controls and the gate each names, not what a handler
// does — a handler changed to write is caught only by its gate (fire(),
// the backend's admission), never by this scan.
import { BUTTON_TYPES, INPUT_DEFS } from "./machineControls";

/** Gates open to a disarmed client: `always` and the stops (BG-08 / BG-18). */
export const LIVE_GATES: ReadonlySet<string> = new Set(["always", "abort", "pause", "spindleStop"]);

/** The catalog components and the attribute that names their catalog entry. */
const CATALOG_ATTR: Record<string, "type" | "gate"> = {
  MachineBtn: "type", MachineInput: "gate", MachineToggle: "gate", MachineSelect: "gate",
  MachineSlider: "gate", MachineRadio: "gate", MachineColor: "gate", MachineChoice: "gate",
};
/** The catalog components, by their PascalCase name. */
export const CATALOG_COMPONENTS: readonly string[] = Object.keys(CATALOG_ATTR);

/** A component tag in either spelling Vue accepts: `machine-input` → `MachineInput`. */
export function pascalTag(name: string): string {
  return name.includes("-") ? name.split("-").map((p) => (p[0] ?? "").toUpperCase() + p.slice(1)).join("") : name;
}
const RAW_CONTROLS = new Set(["button", "input", "select", "textarea"]);
/** Events that make a raw element a control — matched on the event NAME:
 *  `@click.self`, `v-on:click.stop` and `@click` are one event (R213 BG-30). */
const ACTION_EVENTS = new Set(["click", "dblclick", "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]);

/** The event an attribute listens to (`@click.self` / `v-on:click` → "click"), or null. */
function eventOf(attr: string): string | null {
  const m = /^(?:@|v-on:)([\w-]+)/.exec(attr);
  return m ? m[1] ?? null : null;
}

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
  /** The `v-for` expressions on the control and around it, outermost first:
   *  one template node, a family of rendered controls (function inventory). */
  families: string[];
}

export interface ScanOptions {
  /** Every control, not only those a disarmed client can operate (the
   *  function inventory, Codex R265 FI265-01). */
  all?: boolean;
  /** Components whose INSTANCE is the control (tag → the attribute that names
   *  it): a ChoiceGroup acts through its `:act`, an attribute no event scan
   *  sees. Its key is `file|Tag:<name>|<handlers and :act>`. */
  components?: Record<string, string>;
}

/** Elements that never take a closing tag. */
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

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

/** A quoted name: group 1 the quote, group 2 the name. */
const ONLY_LITERAL = /^(['"`])([A-Za-z]\w*)\1$/;
/** `cond ? 'a' : 'b'`: group 1 the condition, 3 and 5 the branches. */
const LITERAL_TERNARY = /^(.*?)\?\s*(['"`])([A-Za-z]\w*)\2\s*:\s*(['"`])([A-Za-z]\w*)\4$/s;

/** Every value a bound expression can take — when each is a literal: a
 *  literal, or `cond ? 'a' : 'b'` whose condition holds no other ternary.
 *  Anything else (a variable, a nested branch) is DYNAMIC: null — never
 *  judged by the literals it happens to contain (Codex R213: a literal in
 *  the condition, or beside a variable branch, is no value it can take). */
function resultLiterals(expr: string): string[] | null {
  const e = expr.trim();
  const only = ONLY_LITERAL.exec(e);
  if (only) return [only[2] ?? ""];
  const tern = LITERAL_TERNARY.exec(e);
  if (!tern) return null;
  // the condition: `?.` and `??` are no branch; any other `?` or `:` is
  const cond = (tern[1] ?? "").replace(/(['"`]).*?\1/g, "").replace(/\?\.|\?\?/g, "");
  if (/[?:]/.test(cond)) return null;
  return [tern[3] ?? "", tern[5] ?? ""];
}

function gateOf(tag: string, entry: string): string | undefined {
  const defs = (tag === "MachineBtn" ? BUTTON_TYPES : INPUT_DEFS) as Record<string, { gate: string }>;
  return defs[entry]?.gate;
}

/** A Gate's gate(s): the literal, or every value of a bound expression —
 *  [] (protects nothing) when the expression is dynamic. */
function gateNames(attrs: Record<string, string>): string[] {
  if (attrs.gate !== undefined) return [attrs.gate];
  if (attrs[":gate"] !== undefined) return resultLiterals(attrs[":gate"]) ?? [];
  return [];
}

/** The controls of one `.vue` file a disarmed client can operate — or, with
 *  `all`, every control of it. */
export function scanControls(file: string, sfc: string, { all = false, components = {} }: ScanOptions = {}): ControlUsage[] {
  const { text, offset } = templateOf(sfc);
  const out: ControlUsage[] = [];
  const gateStack: string[][] = [];
  // the open elements with their `v-for` — a control's family
  const open: { name: string; vfor?: string }[] = [];
  const lineAt = (pos: number) => sfc.slice(0, offset + pos).split("\n").length;
  // a known component in either spelling (`machine-input`); any other
  // element keeps its name (a raw `<my-el @click>` stays a raw control)
  const known = (n: string) => n === "Gate" || n in CATALOG_ATTR || n in components;
  for (const t0 of tags(text)) {
    const t = known(pascalTag(t0.name)) ? { ...t0, name: pascalTag(t0.name) } : t0;
    if (t.closing) {
      const at = open.map((o) => o.name).lastIndexOf(t.name);
      if (at >= 0) open.length = at;
    }
    const leaf = t.selfClosing || VOID_TAGS.has(t.name);
    if (!t.closing && !leaf) open.push({ name: t.name, vfor: t.attrs["v-for"] });
    if (t.name === "Gate") {
      if (t.closing) gateStack.pop();
      else if (!t.selfClosing) gateStack.push(gateNames(t.attrs));
      continue;
    }
    if (t.closing) continue;
    // Inside a Gate that closes for a disarmed client: protected by it.
    if (!all && gateStack.some((g) => g.length > 0 && g.every((n) => !LIVE_GATES.has(n)))) continue;
    const families = [...open.map((o) => o.vfor), leaf ? t.attrs["v-for"] : undefined]
      .filter((v): v is string => !!v).map(norm);
    const handlers = Object.keys(t.attrs)
      .filter((a) => a.startsWith("@") || a.startsWith("v-on:") || a.startsWith("v-model"))
      .sort().map((a) => `${a}=${norm(t.attrs[a] ?? "")}`).join(" ");
    const named = components[t.name];
    if (named !== undefined) {
      const act = t.attrs[":act"] !== undefined ? ` :act=${norm(t.attrs[":act"])}` : "";
      out.push({ key: `${file}|${t.name}:${t.attrs[named] ?? `{${norm(t.attrs[`:${named}`] ?? "")}}`}|${handlers}${act}`,
        file, line: lineAt(t.start), tag: t.name, entry: "", gates: ["component"], families });
      continue;
    }
    const attr = CATALOG_ATTR[t.name];
    if (attr) {
      const bound = t.attrs[`:${attr}`];
      const entries = bound !== undefined ? resultLiterals(bound) ?? [] : [t.attrs[attr] ?? ""];
      const gates = entries.map((e) => gateOf(t.name, e));
      // Skipped only when EVERY value it can take is a catalog entry whose
      // gate closes without arm. A dynamic entry (MachineChoice's o.gate, a
      // variable branch) is listed so the inventory names it.
      if (!all && gates.length && gates.every((g) => g !== undefined && !LIVE_GATES.has(g))) continue;
      const entry = bound !== undefined ? `{${norm(bound)}}` : entries[0] ?? "";
      const known = gates.filter((g): g is string => !!g);
      out.push({ key: `${file}|${t.name}:${entry}|${handlers}`, file, line: lineAt(t.start), tag: t.name, entry, gates: known.length === gates.length && known.length ? known : ["dynamic"], families });
      continue;
    }
    const isRaw = RAW_CONTROLS.has(t.name) || t.attrs.role === "button"
      || (/^[a-z]/.test(t.name) && Object.keys(t.attrs).some((a) => ACTION_EVENTS.has(eventOf(a) ?? "")));
    if (!isRaw) continue;
    const disabled = t.attrs[":disabled"] !== undefined ? ` :disabled=${norm(t.attrs[":disabled"])}` : "";
    out.push({ key: `${file}|${t.name}|${handlers}${disabled}`, file, line: lineAt(t.start), tag: t.name, entry: "", gates: ["raw"], families });
  }
  return out;
}
