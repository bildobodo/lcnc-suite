// A `<script setup>` binding never takes the name of one of its component's
// props: the template resolves a name to the setup binding first, so the
// prop it names is silently gone from the template. GcodePanel's local
// `subName` (the expansion's name, null without a call line) hid the prop
// `subName` (the sub the run is in) and the "in subroutine" hint vanished
// (Codex R242 FH-04). ESLint's vue/no-dupe-keys is on and stays silent on
// that shape: it skips a binding whose initializer reads `props`, taking it
// for a deliberate alias. This scan reads the props the compiler resolved
// (the runtime `props` object it emits) and every top-level setup binding.
// An alias of the prop itself — destructured from `defineProps` /
// `withDefaults` / `toRefs(props)`, or the `defineModel` that IS the prop —
// is the prop under its own name; anything else is listed below with its
// reason or fails.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { babelParse, compileScript, parse } from "vue/compiler-sfc";

const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith(".vue"));

/** Same-named bindings that are meant to hide the prop: file → name → why. */
const INTENDED: Record<string, Record<string, string>> = {
  "KeyboardTab.vue": {
    kbConfig: "the editable draft of the prop: the template edits the draft, Save sends it",
  },
};

const fs = {
  fileExists: (p: string) => { try { readFileSync(p); return true; } catch { return false; } },
  readFile: (p: string) => readFileSync(p, "utf8"),
};

/** A declaration whose value is the props themselves under their own names. */
function isPropAlias(init: any): boolean {
  if (init?.type !== "CallExpression" || init.callee.type !== "Identifier") return false;
  const callee = init.callee.name;
  if (callee === "defineProps" || callee === "withDefaults" || callee === "defineModel") return true;
  return callee === "toRefs" && init.arguments[0]?.type === "Identifier" && init.arguments[0].name === "props";
}

function collectNames(pattern: any, out: string[]): void {
  if (!pattern) return;
  if (pattern.type === "Identifier") out.push(pattern.name);
  else if (pattern.type === "ObjectPattern") for (const p of pattern.properties) collectNames(p.type === "RestElement" ? p.argument : p.value, out);
  else if (pattern.type === "ArrayPattern") for (const e of pattern.elements) collectNames(e, out);
  else if (pattern.type === "AssignmentPattern") collectNames(pattern.left, out);
  else if (pattern.type === "RestElement") collectNames(pattern.argument, out);
}

/** The prop names in the compiled component's runtime `props` option. */
function propNames(code: string): Set<string> {
  const names = new Set<string>();
  const add = (obj: any) => {
    for (const p of obj.properties) if (p.type === "ObjectProperty") names.add(p.key.name ?? p.key.value);
  };
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.type === "ObjectProperty" && node.key?.name === "props") {
      if (node.value.type === "ObjectExpression") add(node.value);
      // withDefaults on runtime props / defineModel: _mergeDefaults({...}, …), _mergeModels({...}, {...})
      else if (node.value.type === "CallExpression") for (const a of node.value.arguments) if (a.type === "ObjectExpression") add(a);
    }
    for (const k of Object.keys(node)) if (k !== "loc" && k !== "start" && k !== "end") visit(node[k]);
  };
  visit(babelParse(code, { sourceType: "module", plugins: ["typescript"] }).program.body);
  return names;
}

describe("setup bindings and props", () => {
  it("no setup binding hides a prop of the same name", () => {
    const hidden: string[] = [];
    const intendedSeen: string[] = [];
    let props = 0, components = 0;
    for (const f of files) {
      const { descriptor } = parse(readFileSync(new URL(f, dir), "utf8"), { filename: f });
      if (!descriptor.scriptSetup) continue;
      const compiled = compileScript(descriptor, { id: f, fs });
      const declared = propNames(compiled.content);
      if (declared.size === 0) continue;
      components++;
      props += declared.size;
      for (const s of compiled.scriptSetupAst ?? []) {
        const names: string[] = [];
        if (s.type === "VariableDeclaration") {
          for (const d of s.declarations) if (!isPropAlias(d.init)) collectNames(d.id, names);
        } else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) {
          names.push(s.id.name);
        } else if (s.type === "ImportDeclaration") {
          for (const sp of s.specifiers) names.push(sp.local.name);
        }
        for (const n of names.filter(n => declared.has(n))) {
          if (INTENDED[f]?.[n]) intendedSeen.push(`${f} ${n}`);
          else hidden.push(`${f}: the setup binding "${n}" hides the prop "${n}"`);
        }
      }
    }
    expect(hidden, hidden.join("\n")).toEqual([]);
    // Every listed exception still exists (a stale entry would excuse a new one).
    const listed = Object.entries(INTENDED).flatMap(([f, m]) => Object.keys(m).map(n => `${f} ${n}`));
    expect(intendedSeen.sort()).toEqual(listed.sort());
    // The scan saw the props it guards (a broken pattern must not pass empty).
    expect(components).toBeGreaterThanOrEqual(40);
    expect(props).toBeGreaterThanOrEqual(250);
  });
});
