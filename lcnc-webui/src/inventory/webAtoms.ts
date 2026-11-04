// The web side of the function inventory (Codex R265–R268 FI265-01): the
// atoms the UI's sources declare, one adapter per source family, each with the
// forms it recognises and every site it could not resolve. "Complete with
// respect to the named sources and the recognised forms" — an adapter that
// finds nothing is an error, never a clean result.
//
// Pure: the caller hands in the source texts and a TypeScript program over
// the files the type adapters read (webAtoms.test.ts reads the tree). No line
// numbers in the result: they move with every edit, the atoms do not.
import ts from "typescript";
import { CATALOG_COMPONENTS, scanControls, templateExpressions } from "../controlScan";
import { BUTTON_TYPES, INPUT_DEFS } from "../machineControls";

export interface Atom {
  id: string;
  /** Variants: a union's members, a section's fields, a family's elements. */
  members?: string[];
  /** The `v-for` expressions a template control is rendered by. */
  family?: string[];
}

/** A site the adapter saw and could not resolve: bound to file, form and
 *  expression, never a line. */
export interface Unresolved { file: string; form: string; expr: string }

export interface Adapter {
  source: string;
  forms: string[];
  /** What the adapter does not see, named. */
  limit?: string;
  atoms: Atom[];
  /** Sites that may hide an atom: the inventory is not complete while one is
   *  listed without a reason. */
  unresolved: Unresolved[];
  /** Sites outside the declared boundary, each bound to its file, form and
   *  expression with the reason: visible, never coverage. */
  excluded?: (Unresolved & { why: string })[];
  /** Families whose elements are not derived: the atom stands, its variants
   *  are named as open (no completeness term). */
  variantsOpen?: Unresolved[];
}

export interface WebAtoms {
  adapters: Record<string, Adapter>;
  /** Files no adapter reads, with the reason. */
  excludedFiles: Record<string, string>;
}

/** Files outside the inventory's boundary (path prefix → reason). */
export const EXCLUDED_FILES: Record<string, string> = {
  "inventory/": "the inventory's own adapters — their literals name forms, not functions",
};

/** Single sites outside the boundary: file, form and the exact expression. */
export const EXCLUDED_SITES: (Unresolved & { why: string })[] = [
  { file: "gcodeReference.ts", form: "o<…> call", expr: "O<name> call", why: "the G-code reference's syntax text, not a call" },
];

export interface WebSources {
  /** `src`-relative path → text, for every `.vue` and non-test `.ts` file. */
  files: Record<string, string>;
  /** A program over the files the type adapters read. */
  program: ts.Program;
  /** `src`-relative path → absolute path, for those files. */
  abs: (rel: string) => string;
  /** The export namespaces a control family may iterate (probeFields.ts). */
  familyRoots: Record<string, unknown>;
}

const sortById = (a: Atom[]): Atom[] => a.sort((x, y) => x.id.localeCompare(y.id));

/** The script blocks of a `.vue` file, or the whole text of a `.ts` file. */
function scriptsOf(rel: string, text: string): string[] {
  if (!rel.endsWith(".vue")) return [text];
  return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
}

function templateText(text: string): string {
  const start = text.search(/^<template\b/m);
  const end = text.lastIndexOf("</template>");
  return start < 0 || end < 0 ? "" : text.slice(start, end);
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

function parsed(rel: string, text: string): ts.SourceFile[] {
  return scriptsOf(rel, text).map((s, i) => ts.createSourceFile(`${rel}#${i}`, s, ts.ScriptTarget.Latest, true));
}

// ── Template controls ───────────────────────────────────────────────────

/** Components whose instance is the control, and the attribute naming it. */
export const ACTING_COMPONENTS: Record<string, string> = { ChoiceGroup: "label" };

/** Every template control (`controlScan` with `all` and the acting
 *  components). Identical keys in one file stay apart (`#2` …): two places to
 *  operate are two atoms. A catalog or acting component written in the
 *  template (either spelling) that the scan did not turn into an atom is
 *  unresolved. */
export function controlsAdapter(src: WebSources): Adapter {
  const atoms: Atom[] = [];
  const unresolved: Unresolved[] = [];
  const variantsOpen: Unresolved[] = [];
  for (const [rel, text] of Object.entries(src.files)) {
    if (!rel.endsWith(".vue")) continue;
    const seen = new Map<string, number>();
    const usages = scanControls(rel, text, { all: true, components: ACTING_COMPONENTS });
    const tpl = templateText(text).replace(/<!--[\s\S]*?-->/g, "");
    for (const tag of [...Object.keys(ACTING_COMPONENTS), ...CATALOG_COMPONENTS]) {
      // both spellings Vue accepts, each written use found by the scan
      const kebab = tag.replace(/(?<!^)([A-Z])/g, "-$1").toLowerCase();
      const written = tpl.match(new RegExp(`<(?:${tag}|${kebab})\\b`, "g"))?.length ?? 0;
      const found = usages.filter((u) => u.tag === tag).length;
      if (written !== found) unresolved.push({ file: rel, form: `<${tag}>`, expr: `${written} written, ${found} found` });
    }
    for (const u of usages) {
      const n = (seen.get(u.key) ?? 0) + 1;
      seen.set(u.key, n);
      const atom: Atom = { id: `control:${u.key}${n > 1 ? `#${n}` : ""}` };
      if (u.families.length) {
        atom.family = u.families;
        const members = familyMembers(u.families[u.families.length - 1]!, src.familyRoots);
        if (members) atom.members = members;
        else variantsOpen.push({ file: rel, form: "v-for family", expr: u.families[u.families.length - 1]! });
      }
      atoms.push(atom);
    }
  }
  return { source: "lcnc-webui/src/**/*.vue templates",
    forms: ["catalog component", "raw control", "role=button", "element with an action event",
      ...Object.entries(ACTING_COMPONENTS).map(([t, a]) => `<${t} ${a}="…">: the instance is the control`)],
    limit: "templates only — global listeners, keys and the gamepad are their own adapters", atoms: sortById(atoms), unresolved: dedupe(unresolved),
    variantsOpen: dedupe(variantsOpen) };
}

/** A family's elements when its iterable is a path into a registered export
 *  (`f in PROBE_HINT_FIELDS.boss` → the fields' keys), else null. */
export function familyMembers(vfor: string, roots: Record<string, unknown>): string[] | null {
  const m = /^\(?\s*\w+(?:\s*,\s*\w+)*\s*\)?\s+(?:in|of)\s+(.+)$/.exec(vfor);
  if (!m) return null;
  const expr = m[1]!.trim();
  const list = /^\[(\w+)\]$/.exec(expr);
  const value = list ? [roots[list[1]!]] : expr.split(".").reduce<unknown>(
    (v, k) => (v !== null && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), roots);
  if (!Array.isArray(value) || value.some((e) => e === undefined)) return null;
  return value.map((e) => (typeof e === "string" ? e : String((e as { key?: string; id?: string }).key ?? (e as { id?: string }).id)));
}

function dedupe(u: Unresolved[]): Unresolved[] {
  const out = new Map(u.map((x) => [`${x.file}|${x.form}|${x.expr}`, x]));
  return [...out.values()].sort((a, b) => `${a.file}${a.expr}`.localeCompare(`${b.file}${b.expr}`));
}

// ── The catalogs ────────────────────────────────────────────────────────

export function catalogAdapter(): Adapter {
  return { source: "machineControls.ts BUTTON_TYPES, INPUT_DEFS", forms: ["catalog key"],
    atoms: sortById([...Object.keys(BUTTON_TYPES).map((k) => ({ id: `buttonType:${k}` })),
      ...Object.keys(INPUT_DEFS).map((k) => ({ id: `inputDef:${k}` }))]), unresolved: [] };
}

// ── Types read through the checker ──────────────────────────────────────

function declaration(src: WebSources, rel: string, name: string): ts.Node {
  const sf = src.program.getSourceFile(src.abs(rel));
  if (!sf) throw new Error(`${rel} is not in the inventory's program`);
  const d = sf.statements.find((s) => (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name.text === name);
  if (!d || !(ts.isTypeAliasDeclaration(d) || ts.isInterfaceDeclaration(d))) throw new Error(`${name} not found in ${rel}`);
  return d.name;
}

/** A union's string literals; a member that is none is unresolved. */
export function unionLiterals(src: WebSources, rel: string, name: string): { values: string[]; unresolved: Unresolved[] } {
  const checker = src.program.getTypeChecker();
  const at = declaration(src, rel, name);
  const t = checker.getTypeAtLocation(at);
  const members = t.isUnion() ? t.types : [t];
  const values: string[] = [];
  const unresolved: Unresolved[] = [];
  for (const m of members) {
    if (m.isStringLiteral()) values.push(m.value);
    else unresolved.push({ file: rel, form: `${name} member`, expr: checker.typeToString(m) });
  }
  return { values: values.sort(), unresolved };
}

function propertiesOf(src: WebSources, rel: string, name: string): string[] {
  const checker = src.program.getTypeChecker();
  return checker.getPropertiesOfType(checker.getTypeAtLocation(declaration(src, rel, name))).map((p) => p.name).sort();
}

export function keyboardAdapter(src: WebSources): Adapter {
  const { values, unresolved } = unionLiterals(src, "defaults.ts", "KeyboardAction");
  return { source: "defaults.ts KeyboardAction", forms: ["union of string literals (template literals resolved by the checker)"],
    atoms: values.map((v) => ({ id: `key:${v}` })), unresolved };
}

export function gamepadAdapter(src: WebSources): Adapter {
  const { values, unresolved } = unionLiterals(src, "defaults.ts", "GamepadAction");
  return { source: "defaults.ts GamepadAction, GamepadMapping", forms: ["union of string literals", "interface properties"],
    limit: "`none` is a choice, not a command",
    atoms: [...values.map((v) => ({ id: `pad:${v}` })), ...propertiesOf(src, "defaults.ts", "GamepadMapping").map((p) => ({ id: `padButton:${p}` }))],
    unresolved };
}

/** `WsCommand`'s members by their literal `cmd`, each with its fields. */
export function commandsAdapter(src: WebSources): Adapter {
  const checker = src.program.getTypeChecker();
  const at = declaration(src, "lcnc.ts", "WsCommand");
  const t = checker.getTypeAtLocation(at);
  const atoms: Atom[] = [];
  const unresolved: Unresolved[] = [];
  for (const m of t.isUnion() ? t.types : [t]) {
    const cmd = m.getProperty("cmd");
    const ct = cmd && checker.getTypeOfSymbolAtLocation(cmd, at);
    if (!ct || !ct.isStringLiteral()) { unresolved.push({ file: "lcnc.ts", form: "WsCommand member", expr: checker.typeToString(m) }); continue; }
    atoms.push({ id: `cmd:${ct.value}`, members: checker.getPropertiesOfType(m).map((p) => p.name).filter((n) => n !== "cmd").sort() });
  }
  return { source: "lcnc.ts WsCommand", forms: ["union member with a literal cmd"], atoms: sortById(atoms), unresolved };
}

/** Every `registerSection<T>("name", …)` in defaults.ts: the fields of T. */
export function settingsAdapter(src: WebSources): Adapter {
  const checker = src.program.getTypeChecker();
  const sf = src.program.getSourceFile(src.abs("defaults.ts"))!;
  const atoms: Atom[] = [];
  const unresolved: Unresolved[] = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== "registerSection") return;
    const name = n.arguments[0];
    const arg = n.typeArguments?.[0];
    if (!name || !ts.isStringLiteral(name) || !arg) { unresolved.push({ file: "defaults.ts", form: "registerSection call", expr: n.getText(sf).slice(0, 80) }); return; }
    for (const p of checker.getPropertiesOfType(checker.getTypeFromTypeNode(arg))) atoms.push({ id: `setting:${name.text}.${p.name}` });
  });
  return { source: "defaults.ts registerSection<T>", forms: ["registerSection<T>(\"literal\", …) — the properties of T"], atoms: sortById(atoms), unresolved };
}

// ── Script sites ────────────────────────────────────────────────────────

const GLOBAL_RECEIVERS = new Set(["window", "document", "document.documentElement", "document.body", "globalThis", "self"]);

/** `addEventListener` on the window or the document, anywhere in a script:
 *  the shortcut map, focus loss, visibility, page exit. */
export function listenersAdapter(src: WebSources): Adapter {
  const atoms = new Map<string, Atom>();
  const unresolved: Unresolved[] = [];
  for (const [rel, text] of Object.entries(src.files)) {
    for (const sf of parsed(rel, text)) walk(sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "addEventListener") return;
      const recv = n.expression.expression.getText(sf);
      if (!GLOBAL_RECEIVERS.has(recv)) return;
      const ev = n.arguments[0];
      if (ev && ts.isStringLiteralLike(ev)) atoms.set(`${rel}:${recv}.${ev.text}`, { id: `listener:${rel}:${recv}.${ev.text}` });
      else unresolved.push({ file: rel, form: "addEventListener on a global", expr: n.getText(sf).slice(0, 80) });
    });
  }
  return { source: "addEventListener on window / document in every script", forms: [...GLOBAL_RECEIVERS].map((r) => `${r}.addEventListener("literal", …)`),
    limit: "listeners on elements belong to their component's controls", atoms: sortById([...atoms.values()]), unresolved: dedupe(unresolved) };
}

/** The worker's own frames: every `<socket>.send(arg)` in wsWorker.ts —
 *  `JSON.stringify({ cmd: "…", … })` (also through a const bound to it), a
 *  literal or template text with a literal `"cmd":"…"`, or one of the two
 *  RELAYS of a main-thread WsCommand (the commands adapter's): `msg.payload`
 *  in the `case "send":` clause, and a const bound to `preOpenQueue.shift()`
 *  — a queue only that clause fills. Anything else is unresolved. */
export function framesAdapter(src: WebSources): Adapter {
  const rel = "wsWorker.ts";
  const atoms = new Map<string, Atom>();
  const unresolved: Unresolved[] = [];
  const frame = (cmd: string) => atoms.set(cmd, { id: `frame:${cmd}` });
  for (const sf of parsed(rel, src.files[rel] ?? "")) {
    const inSendCase = (n: ts.Node) => {
      for (let p = n.parent; p; p = p.parent) if (ts.isCaseClause(p)) return ts.isStringLiteralLike(p.expression) && p.expression.text === "send";
      return false;
    };
    // the declaration that binds the identifier AT the send: the nearest
    // enclosing block, case clause or the file that declares it (Codex R272
    // FI-I03). A parameter, a loop head, a catch clause, a function or class
    // of the name, or two declarations bind nothing proven; an inner
    // function's or a left block's const is never reached; one `const` with
    // its initializer is the proven value.
    const bindingAt = (id: ts.Identifier): ts.Expression | undefined => {
      const named = (n: ts.BindingName) => ts.isIdentifier(n) && n.text === id.text;
      for (let p: ts.Node | undefined = id.parent; p; p = p.parent) {
        if (ts.isFunctionLike(p) && p.parameters.some((q) => named(q.name))) return undefined;
        if (ts.isCatchClause(p) && p.variableDeclaration && named(p.variableDeclaration.name)) return undefined;
        if ((ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isForStatement(p)) && p.initializer
            && ts.isVariableDeclarationList(p.initializer) && p.initializer.declarations.some((d) => named(d.name))) return undefined;
        const stmts = ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p) || ts.isDefaultClause(p) ? p.statements : undefined;
        if (!stmts) continue;
        const decls = stmts.flatMap((st) => ts.isVariableStatement(st)
          ? st.declarationList.declarations.filter((d) => named(d.name)).map((d) => ({ d, list: st.declarationList })) : []);
        if (stmts.some((st) => (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === id.text) || decls.length > 1) return undefined;
        if (decls.length === 1) {
          const { d, list } = decls[0]!;
          return (list.flags & ts.NodeFlags.Const) !== 0 && d.initializer ? d.initializer : undefined;
        }
      }
      return undefined;
    };
    const literalCmd = (e: ts.Expression): string | undefined => {
      const obj = ts.isCallExpression(e) && e.expression.getText(sf) === "JSON.stringify" ? e.arguments[0] : undefined;
      const cmd = obj && ts.isObjectLiteralExpression(obj)
        ? obj.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === "cmd") : undefined;
      if (cmd && ts.isStringLiteralLike(cmd.initializer)) return cmd.initializer.text;
      return ts.isStringLiteralLike(e) || ts.isTemplateExpression(e) ? /^["'`]\{"cmd":"(\w+)"/.exec(e.getText(sf))?.[1] : undefined;
    };
    walk(sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
      const arg = n.arguments[0];
      if (n.expression.getText(sf) === "preOpenQueue.push") {
        if (!(n.arguments.length === 1 && arg && arg.getText(sf) === "msg.payload" && inSendCase(n)))
          unresolved.push({ file: rel, form: "the relay queue filled from elsewhere", expr: n.getText(sf).slice(0, 80) });
        return;
      }
      if (n.expression.name.text !== "send" || !arg) return;
      if (arg.getText(sf) === "msg.payload" && inSendCase(n)) return;   // relay: the main thread's command
      const only = ts.isIdentifier(arg) ? bindingAt(arg) : undefined;
      if (only && only.getText(sf).replace(/!$/, "") === "preOpenQueue.shift()") return;   // relay: the queue of the same
      const cmd = literalCmd(only ?? arg);
      if (cmd) return void frame(cmd);
      unresolved.push({ file: rel, form: "send", expr: n.getText(sf).slice(0, 80) });
    });
  }
  return { source: "wsWorker.ts <socket>.send(…)",
    forms: ["JSON.stringify({ cmd: literal, … })", "text beginning {\"cmd\":\"literal\"", "a const bound to one of those",
      "relay: msg.payload in case \"send\"", "relay: the one const bound to preOpenQueue.shift(), the queue only case \"send\" fills with msg.payload alone"],
    atoms: sortById([...atoms.values()]), unresolved };
}

const CALL_RE = /o<([^>]+)>\s*call/gi;

/** The probe procedures' routines (ProbePanel.vue → App's `O<${macro}> CALL`):
 *  every `emit("runProbe", { …, macro })`, its `macro` one of three forms —
 *  a literal; `op.macro`, the procedure tables' `macro: "…"` literals; or the
 *  parameter of `runCalProbe(macro)`, the literal arguments of its calls.
 *  Any other form, or a form whose source is empty, is unresolved. */
export function probeRoutines(rel: string, text: string): { names: string[]; unresolved: Unresolved[] } {
  const names = new Set<string>();
  const unresolved: Unresolved[] = [];
  const tables: string[] = [];
  const calArgs: string[] = [];
  let fromTables = false, fromCal = false;
  // every runCalProbe(…) the template calls, read by the parser from the
  // template's expressions: a literal, or unresolved — and every mention of
  // the name in the template must be one of those calls
  let parsedCalls = 0;
  for (const expr of templateExpressions(text)) {
    walk(ts.createSourceFile("t.ts", expr, ts.ScriptTarget.Latest, true), (n) => {
      if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== "runCalProbe") return;
      parsedCalls++;
      const a = n.arguments[0];
      if (n.arguments.length === 1 && a && ts.isStringLiteralLike(a)) calArgs.push(a.text);
      else unresolved.push({ file: rel, form: "runCalProbe(literal)", expr: n.getText() });
    });
  }
  const mentioned = templateText(text).replace(/<!--[\s\S]*?-->/g, "").match(/\brunCalProbe\b/g)?.length ?? 0;
  if (mentioned !== parsedCalls)
    unresolved.push({ file: rel, form: "runCalProbe in the template", expr: `${mentioned} mentioned, ${parsedCalls} read as calls` });
  const isRunProbe = (n: ts.Node) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "emit"
    && !!n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && n.arguments[0].text === "runProbe";
  const inRunProbe = (n: ts.Node) => { for (let p = n.parent; p; p = p.parent) if (isRunProbe(p)) return true; return false; };
  for (const sf of parsed(rel, text)) walk(sf, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "runCalProbe") {
      const a = n.arguments[0];
      if (n.arguments.length === 1 && a && ts.isStringLiteralLike(a)) calArgs.push(a.text);
      else unresolved.push({ file: rel, form: "runCalProbe(literal)", expr: n.getText(sf).slice(0, 80) });
    }
    if (!isRunProbe(n)) {
      // a procedure table's entry: every `macro:` outside the emit itself
      if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && n.name.getText(sf) === "macro" && !inRunProbe(n)) {
        if (ts.isPropertyAssignment(n) && ts.isStringLiteralLike(n.initializer)) tables.push(n.initializer.text);
        else unresolved.push({ file: rel, form: "a procedure table's macro:", expr: n.getText(sf).slice(0, 80) });
      }
      return;
    }
    const obj = (n as ts.CallExpression).arguments[1];
    const prop = obj && ts.isObjectLiteralExpression(obj) ? obj.properties.find((p) => p.name?.getText(sf) === "macro") : undefined;
    let fn: ts.Node | undefined = n.parent;
    while (fn && !ts.isFunctionDeclaration(fn)) fn = fn.parent;
    const inCal = !!fn && ts.isFunctionDeclaration(fn) && fn.name?.text === "runCalProbe";
    if (prop && ts.isPropertyAssignment(prop) && ts.isStringLiteralLike(prop.initializer)) names.add(prop.initializer.text);
    else if (prop && ts.isPropertyAssignment(prop) && prop.initializer.getText(sf) === "op.macro") fromTables = true;
    else if (prop && ts.isShorthandPropertyAssignment(prop) && inCal) fromCal = true;
    else unresolved.push({ file: rel, form: "emit(\"runProbe\", { macro })", expr: n.getText(sf).slice(0, 80) });
  });
  if (fromTables) {
    if (!tables.length) unresolved.push({ file: rel, form: "op.macro", expr: "no procedure table literal `macro:`" });
    tables.forEach((t) => names.add(t));
  }
  if (fromCal) {
    if (!calArgs.length) unresolved.push({ file: rel, form: "runCalProbe(macro)", expr: "no literal runCalProbe('…') call" });
    calArgs.forEach((t) => names.add(t));
  }
  return { names: [...names].sort(), unresolved };
}

/** The routines the UI names: `O<name> CALL` in any script literal or
 *  template, the probe procedures behind App's `O<${macro}> CALL`
 *  (`probeRoutines`), and the M-codes it sends through `toolsetterMdi`. */
export function routinesAdapter(src: WebSources): Adapter {
  const atoms = new Map<string, Atom>();
  const unresolved: Unresolved[] = [];
  const add = (name: string, via: string) => {
    const a = atoms.get(name) ?? { id: `routine:${name}`, members: [] };
    if (!a.members!.includes(via)) a.members!.push(via);
    a.members!.sort();
    atoms.set(name, a);
  };
  const excluded: (Unresolved & { why: string })[] = [];
  const unknown = (u: Unresolved) => {
    const ex = EXCLUDED_SITES.find((e) => e.file === u.file && e.form === u.form && e.expr === u.expr);
    if (ex) excluded.push(ex); else unresolved.push(u);
  };
  let macroCalls = 0;
  for (const [rel, text] of Object.entries(src.files)) {
    for (const sf of parsed(rel, text)) walk(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "toolsetterMdi") {
        const t = n.arguments[1]?.getText(sf) ?? "";
        for (const m of t.matchAll(/\bM(\d{3,})\b/g)) add(`M${m[1]}`, rel);
      }
      if (!ts.isStringLiteralLike(n) && !ts.isTemplateExpression(n)) return;
      const t = n.getText(sf);
      for (const m of t.matchAll(CALL_RE)) {
        if (EXCLUDED_SITES.some((e) => e.file === rel && e.expr === m[0])) unknown({ file: rel, form: "o<…> call", expr: m[0] });
        else if (/^[\w-]+$/.test(m[1]!)) add(m[1]!.toLowerCase(), rel);
        else if (rel === "App.vue" && m[1] === "${macro}") macroCalls++;
        else unknown({ file: rel, form: "o<…> call", expr: m[0] });
      }
    });
    for (const m of templateText(text).matchAll(CALL_RE)) {
      if (/^[\w-]+$/.test(m[1]!)) add(m[1]!.toLowerCase(), rel);
      else unknown({ file: rel, form: "o<…> call in a template", expr: m[0] });
    }
  }
  // App's `O<${macro}> CALL`: the probe procedures' family — one without the
  // other is a form this adapter no longer understands
  const probe = probeRoutines("ProbePanel.vue", src.files["ProbePanel.vue"] ?? "");
  unresolved.push(...probe.unresolved);
  if (macroCalls > 0 && !probe.names.length)
    unresolved.push({ file: "App.vue", form: "o<…> call", expr: "O<${macro}> CALL without ProbePanel.vue's routines" });
  for (const name of macroCalls > 0 ? probe.names : []) add(name, "App.vue O<${macro}> CALL ← ProbePanel.vue runProbe");
  return { source: "every script literal and template in src",
    forms: ["O<name> CALL literal", "App.vue O<${macro}> CALL ← ProbePanel.vue emit(\"runProbe\"): a literal, op.macro (the tables' macro: literals), runCalProbe('…')", "toolsetterMdi(label, text) M-codes"],
    limit: "routines the gateway starts itself (→ Zero, run from line, macros) are the gateway's adapter", atoms: sortById([...atoms.values()]), unresolved: dedupe(unresolved),
    excluded: excluded.filter((e, i) => excluded.indexOf(e) === i) };
}

/** Every web adapter, by name — over the files inside the boundary. */
export function webAtoms(all: WebSources): WebAtoms {
  const inside = Object.fromEntries(Object.entries(all.files).filter(([rel]) => !Object.keys(EXCLUDED_FILES).some((p) => rel.startsWith(p))));
  const src = { ...all, files: inside };
  const out: Record<string, Adapter> = {
    controls: controlsAdapter(src),
    catalogs: catalogAdapter(),
    keyboard: keyboardAdapter(src),
    gamepad: gamepadAdapter(src),
    commands: commandsAdapter(src),
    frames: framesAdapter(src),
    settings: settingsAdapter(src),
    listeners: listenersAdapter(src),
    routines: routinesAdapter(src),
  };
  for (const [name, a] of Object.entries(out)) if (!a.atoms.length) throw new Error(`the ${name} adapter found nothing — no answer is never "no atoms"`);
  return { adapters: out, excludedFiles: EXCLUDED_FILES };
}
