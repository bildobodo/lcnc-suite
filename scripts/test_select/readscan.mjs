// The read-site scanner on the TypeScript parser (Codex R258 TS256-02): every
// call of a node read or run primitive in the given files, and every use of
// the node IO modules the scanner does not admit — so a form outside its
// narrow language fails visibly instead of passing as "no read".
//
//   node scripts/test_select/readscan.mjs <repo root> <file>…  → JSON on stdout
//   {"<file>": {"calls": [{line, start, prim, text}], "refused": ["<line>: why"]}}
//
// Admitted: `import d, * as ns, { a as b } from "<io>"` in any combination and
// `import ns = require("<io>")`. Every export or member of an IO module is
// classified (Codex R259) — a READ (tracked, and it must be called), a
// NAMESPACE (promises, default: followed further, by name or as a member), a
// WRITE or a constant (admitted) — and anything unclassified is refused;
// whitespace and line breaks anywhere JavaScript allows. Refused too: any
// other use of a read binding or a namespace (an alias, a destructuring, a
// namespace taken as a value — `const p = fs.promises` —, an element access),
// require() or import() of an IO module, a re-export of one. A call's `text`
// is the source from the read's name to the call's end — what
// rules.READ_SITES binds to.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const [rootArg, ...files] = process.argv.slice(2);
const root = resolve(rootArg);
const ts = createRequire(join(root, "lcnc-webui", "package.json"))("typescript");
const IO = new Set(["fs", "fs/promises", "child_process"].flatMap(m => [m, `node:${m}`]));
// Every export or member of an IO module the scanner meets is one of three,
// or refused (Codex R259: "not a read primitive" alone proves nothing):
//   READS       a read or a run — tracked, and it must be called
//   NAMESPACES  promises, default — followed further; taken as a value: refused
//   WRITES      a write or a constant — admitted (it reads nothing)
const READS = new Set(["readFileSync", "readFile", "readdirSync", "readdir", "existsSync", "exists", "statSync",
  "stat", "lstatSync", "lstat", "accessSync", "access", "createReadStream", "openSync", "open", "opendir",
  "opendirSync", "readSync", "read", "readvSync", "readv", "readlinkSync", "readlink", "realpathSync", "realpath",
  "copyFileSync", "copyFile", "cpSync", "cp", "watch", "watchFile", "globSync", "glob",
  "execFileSync", "execFile", "execSync", "exec", "spawnSync", "spawn", "fork"]);
const NAMESPACES = new Set(["promises", "default"]);
const WRITES = new Set(["writeFileSync", "writeFile", "appendFileSync", "appendFile", "mkdirSync", "mkdir",
  "mkdtempSync", "mkdtemp", "rmSync", "rm", "rmdirSync", "rmdir", "unlinkSync", "unlink", "renameSync", "rename",
  "createWriteStream", "constants", "chmodSync", "chmod"]);

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
        if (READS.has(imported)) named.set(el.name.text, imported);
        else if (NAMESPACES.has(imported)) ns.add(el.name.text);
        else if (!WRITES.has(imported)) refused.push(`${line(el)}: ${imported} — an IO export the scanner does not classify`);
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

  // `ref` is a namespace (an IO binding, or a namespace member of one): it must
  // be the object of a member access, and that member is classified.
  const member = (ref, label) => {
    const pae = ref.parent;
    if (!(ts.isPropertyAccessExpression(pae) && pae.expression === ref)) {
      refused.push(`${line(ref)}: the IO namespace ${label} used other than as ${label}.member`);
      return;
    }
    const m = pae.name.text;
    if (READS.has(m)) {
      const call = callTo(pae);
      if (call) calls.push({ line: line(pae.name), start: pae.name.getStart(sf), prim: m,
                             text: text.slice(pae.name.getStart(sf), call.getEnd()) });
      else refused.push(`${line(pae.name)}: ${label}.${m} used other than called`);
    } else if (NAMESPACES.has(m)) {
      member(pae, `${label}.${m}`);
    } else if (!WRITES.has(m)) {
      refused.push(`${line(pae.name)}: ${label}.${m} — an IO member the scanner does not classify`);
    }
  };

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
        member(node, name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  out[rel] = { calls, refused };
}
process.stdout.write(JSON.stringify(out));
