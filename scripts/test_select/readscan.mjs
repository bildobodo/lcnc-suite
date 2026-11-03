// The read-site scanner on the TypeScript parser (Codex R258 TS256-02): every
// call of a node read or run primitive in the given files, and every use of
// the node IO modules the scanner does not admit — so a form outside its
// narrow language fails visibly instead of passing as "no read".
//
//   node scripts/test_select/readscan.mjs <repo root> <file>…  → JSON on stdout
//   {"<file>": {"calls": [{line, start, prim, text}], "refused": ["<line>: why"]}}
//
// Admitted: `import d, * as ns, { a as b } from "<io>"` in any combination and
// `import ns = require("<io>")`; a named primitive called directly; a
// primitive called as a member of a default or namespace binding, optionally
// through `.promises`, whitespace and line breaks anywhere between. Refused:
// any other use of a primitive binding or an IO namespace (an alias, a
// destructuring, handed on as a value, an element access), require() or
// import() of an IO module, a re-export of one. A call's `text` is the source
// from the primitive's name to the call's end — what rules.READ_SITES binds to.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const [rootArg, ...files] = process.argv.slice(2);
const root = resolve(rootArg);
const ts = createRequire(join(root, "lcnc-webui", "package.json"))("typescript");
const IO = new Set(["fs", "fs/promises", "child_process"].flatMap(m => [m, `node:${m}`]));
const PRIMITIVES = new Set(["readFileSync", "readFile", "readdirSync", "readdir", "existsSync", "statSync", "stat",
  "lstatSync", "createReadStream", "openSync", "open", "execFileSync", "execFile", "execSync", "exec", "spawnSync",
  "spawn", "fork", "opendir", "opendirSync"]);

const out = {};
for (const rel of files) {
  const text = readFileSync(isAbsolute(rel) ? rel : join(root, rel), "utf8");
  const kind = rel.endsWith(".mjs") || rel.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const line = node => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const ns = new Set();          // default / namespace / import = require bindings
  const named = new Map();       // local name → primitive
  const calls = [], refused = [];
  const ioModule = n => n && ts.isStringLiteralLike(n) && IO.has(n.text);

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ioModule(st.moduleSpecifier)) {
      const c = st.importClause;
      if (!c || c.isTypeOnly) continue;
      if (c.name) ns.add(c.name.text);
      const nb = c.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) ns.add(nb.name.text);
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) {
        if (el.isTypeOnly) continue;
        const imported = (el.propertyName ?? el.name).text;
        if (PRIMITIVES.has(imported)) named.set(el.name.text, imported);
      }
    } else if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference)
               && ioModule(st.moduleReference.expression)) {
      ns.add(st.name.text);
    } else if (ts.isExportDeclaration(st) && ioModule(st.moduleSpecifier)) {
      refused.push(`${line(st)}: a re-export of an IO module`);
    }
  }

  const isDeclarationName = n => {
    const p = n.parent;
    return (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isImportEqualsDeclaration(p))
      || (ts.isPropertyAccessExpression(p) && p.name === n)
      || ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)
           || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isEnumMember(p)) && p.name === n);
  };
  const callTo = (callee) => ts.isCallExpression(callee.parent) && callee.parent.expression === callee ? callee.parent : null;

  const visit = node => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && ioModule(node.arguments[0])) {
      refused.push(`${line(node)}: ${node.expression.getText(sf)}() of an IO module`);
    }
    if (ts.isIdentifier(node) && !isDeclarationName(node)) {
      const name = node.text;
      if (named.has(name)) {
        const call = callTo(node);
        if (call) calls.push({ line: line(node), start: node.getStart(sf), prim: named.get(name),
                               text: text.slice(node.getStart(sf), call.getEnd()) });
        else refused.push(`${line(node)}: ${name} used other than called`);
      } else if (ns.has(name)) {
        let target = node.parent;
        if (!(ts.isPropertyAccessExpression(target) && target.expression === node)) {
          refused.push(`${line(node)}: the IO namespace ${name} used other than as name.member`);
        } else {
          if (target.name.text === "promises" && ts.isPropertyAccessExpression(target.parent)
              && target.parent.expression === target) target = target.parent;
          const member = target.name;
          if (PRIMITIVES.has(member.text)) {
            const call = callTo(target);
            if (call) calls.push({ line: line(member), start: member.getStart(sf), prim: member.text,
                                   text: text.slice(member.getStart(sf), call.getEnd()) });
            else refused.push(`${line(member)}: ${name}.${member.text} used other than called`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  out[rel] = { calls, refused };
}
process.stdout.write(JSON.stringify(out));
