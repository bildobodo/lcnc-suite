// The import scanner on the TypeScript parser (Codex R271 FI-I07): every
// relative runtime edge of the given files — the proof that graph.py's edge
// pattern misses no spelling — and every import form it does not read,
// refused so it fails visibly instead of passing as "no edge".
//
//   node scripts/test_select/importscan.mjs <src dir> <file>…  → JSON on stdout
//   {"<file>": {"imports": [...], "workers": [...], "typeImports": [...], "refused": ["<line>: why"]}}
//
// A runtime edge: an `import … from` / `export … from` that is not `import
// type` / `export type` (a `{ type A }` element keeps the edge — the build
// keeps the import), a side-effect `import "./x"`, an `import("./x")`.
// A worker: `new URL("./x", import.meta.url)`. A type position's
// `import("./x").T` is no edge — listed apart, because graph.py's pattern
// reads it as one (a harmless excess for the selection). Refused: `require()`,
// `import x = require()`, an `import()` or a `new URL(…, import.meta.url)`
// whose path is not a literal. Only relative specifiers are edges; packages
// are no module of the app's source.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [srcArg, ...files] = process.argv.slice(2);
const src = resolve(srcArg);
const ts = createRequire(join(src, "..", "package.json"))("typescript");

const scripts = (rel, text) => rel.endsWith(".vue")
  ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])
  : [text];

const out = {};
for (const rel of files) {
  const imports = [], workers = [], typeImports = [], refused = [];
  for (const body of scripts(rel, readFileSync(join(src, rel), "utf8"))) {
    const sf = ts.createSourceFile(rel, body, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const line = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const rel_ = s => s && ts.isStringLiteralLike(s) && /^\.{1,2}\//.test(s.text) ? s.text : null;
    const visit = n => {
      if (ts.isImportDeclaration(n)) {
        const spec = rel_(n.moduleSpecifier);
        if (spec && !n.importClause?.isTypeOnly) imports.push(spec);
      } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
        const spec = rel_(n.moduleSpecifier);
        if (spec && !n.isTypeOnly) imports.push(spec);
      } else if (ts.isImportTypeNode(n)) {
        const spec = ts.isLiteralTypeNode(n.argument) ? rel_(n.argument.literal) : null;
        if (spec) typeImports.push(spec);
      } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
        refused.push(`${line(n)}: import = require() — a form the graph does not read`);
      } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = rel_(n.arguments[0]);
        if (spec) imports.push(spec);
        else if (!(n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]))) refused.push(`${line(n)}: import() of a computed path`);
      } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require") {
        refused.push(`${line(n)}: require() — a form the graph does not read`);
      } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "URL"
                 && n.arguments?.[1]?.getText(sf) === "import.meta.url") {
        const spec = rel_(n.arguments[0]);
        if (spec) workers.push(spec);
        else refused.push(`${line(n)}: new URL(…, import.meta.url) of a computed path`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  out[rel] = { imports, workers, typeImports, refused };
}
process.stdout.write(JSON.stringify(out));
