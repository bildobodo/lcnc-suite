// The macro file's header as the editor dialog's FIELDS (operator
// 2026-10-03: "eigene Felder wie im Bild"): the file name ↔ the
// subroutine's o-word label (`o<name> sub` / `endsub`, and every o-word
// that names the subroutine itself), the title ↔ the `(MACRO …)` line, the
// short description ↔ the first free comment line before the sub. A field
// writes its line into the text; an edit of the text reads the fields back.
//
// It mirrors lcnc-gateway/macro_files.py (`_strip_comments`, `_code`,
// `_header_line`) — the gateway stays the judge of a saved file, and both
// read scripts/test_fixtures/macro_header_cases.json with the same answers
// (macroHeader.test.ts, test_macro_files.HeaderParity). Pure.

/** macro_files.TITLE_MAX */
export const TITLE_MAX = 40;

/** The executable part of a line: `( … )` comments and everything after
 *  `;` removed (an unclosed `(` comments out the rest). */
export function stripComments(line: string): string {
  let out = "", depth = 0;
  for (const ch of line) {
    if (depth === 0 && ch === ";") break;
    if (ch === "(") depth++;
    else if (ch === ")" && depth) depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

/** The interpreter's view: comments and white space gone, lower case. */
export function codeOf(line: string): string {
  return stripComments(line).replace(/\s+/g, "").toLowerCase();
}

const SUB_RE = /^o<([^>]*)>sub\b/;
const OWORD_RE = /^o<([^>]*)>/;

interface Line { text: string; eol: string }

function lines(text: string): Line[] {
  return text.split("\n").map((l, i, all) => {
    const cr = l.endsWith("\r");
    return { text: cr ? l.slice(0, -1) : l, eol: i < all.length - 1 ? (cr ? "\r\n" : "\n") : (cr ? "\r" : "") };
  });
}
function join(ls: Line[]): string {
  return ls.map(l => l.text + l.eol).join("");
}
/** The line end the file uses (a new line takes it). */
function eolOf(ls: Line[]): string {
  return ls.some(l => l.eol === "\r\n") ? "\r\n" : "\n";
}

/** What a header line before the sub is: the title (`MACRO`), another
 *  header word, a description, or nothing (empty, or code). */
function classify(raw: string): { kind: "title" | "header" | "description" | "none"; value: string } {
  const stripped = raw.trim();
  if (!stripped || codeOf(raw)) return { kind: "none", value: "" };
  if (stripped.startsWith(";")) return { kind: "description", value: stripped.replace(/^;+/, "").trim() };
  if (!(stripped.startsWith("(") && stripped.endsWith(")"))) return { kind: "description", value: stripped };
  const inner = stripped.slice(1, -1).trim();
  const first = inner.split(/\s+/, 1)[0] ?? "";
  if (!/^[A-Z]+$/.test(first)) return { kind: "description", value: inner };
  return first === "MACRO" ? { kind: "title", value: inner.slice(first.length).trim() } : { kind: "header", value: "" };
}

interface Header {
  name: string | null;
  title: string | null;
  description: string | null;
  sub: number | null;
  titleAt: number | null;
  descAt: number | null;
  lastHeaderAt: number | null;
}

function scan(ls: Line[]): Header {
  const h: Header = { name: null, title: null, description: null, sub: null, titleAt: null, descAt: null, lastHeaderAt: null };
  for (let i = 0; i < ls.length; i++) {
    const m = SUB_RE.exec(codeOf(ls[i]!.text));
    if (m) { h.name = m[1]!; h.sub = i; break; }
    const c = classify(ls[i]!.text);
    if (c.kind === "title" && h.titleAt === null) {
      h.titleAt = i;
      h.title = c.value && c.value.length <= TITLE_MAX ? c.value : null;
    }
    if (c.kind === "title" || c.kind === "header") h.lastHeaderAt = i;
    if (c.kind === "description" && h.descAt === null) { h.descAt = i; h.description = c.value; }
  }
  return h;
}

/** The three fields as the text has them now. */
export function readHeader(text: string): { name: string | null; title: string | null; description: string | null } {
  const h = scan(lines(text));
  return { name: h.name, title: h.title, description: h.description };
}

/** The title line: replaced, removed (empty), or put first. */
export function withTitle(text: string, title: string): string {
  const ls = lines(text), h = scan(ls), t = title.trim();
  if (h.titleAt !== null) {
    if (t) ls[h.titleAt]!.text = `(MACRO ${t})`;
    else ls.splice(h.titleAt, 1);
  } else if (t) {
    ls.unshift({ text: `(MACRO ${t})`, eol: eolOf(ls) });
  }
  return join(ls);
}

/** A description as a comment line the gateway reads as description: in
 *  parentheses unless that would make it a header word (a first word in
 *  capitals, "CNC …") or break the comment (a parenthesis) — then `;`. */
export function descriptionLine(d: string): string {
  const first = d.split(/\s+/, 1)[0] ?? "";
  return /[()]/.test(d) || /^[A-Z]+$/.test(first) ? `; ${d}` : `(${d})`;
}

/** The first description line: replaced, removed (empty), or put right
 *  after the header words (before the sub). */
export function withDescription(text: string, description: string): string {
  const ls = lines(text), h = scan(ls), d = description.trim();
  if (h.descAt !== null) {
    if (d) ls[h.descAt]!.text = descriptionLine(d);
    else ls.splice(h.descAt, 1);
  } else if (d) {
    const at = h.lastHeaderAt !== null ? h.lastHeaderAt + 1 : h.sub ?? 0;
    ls.splice(at, 0, { text: descriptionLine(d), eol: eolOf(ls) });
  }
  return join(ls);
}

/** The subroutine renamed: every line whose o-word names it (sub, endsub,
 *  call, return …) gets the new label; other o-words stay. */
export function withName(text: string, from: string, to: string): string {
  const ls = lines(text);
  for (const l of ls) {
    const m = OWORD_RE.exec(codeOf(l.text));
    if (m && m[1] === from.toLowerCase()) l.text = l.text.replace(/[oO]\s*<[^>]*>/, `o<${to}>`);
  }
  return join(ls);
}

/** Why a title cannot stand in the `(MACRO …)` line, or null. */
export function titleError(title: string): string | null {
  const t = title.trim();
  if (t.length > TITLE_MAX) return `At most ${TITLE_MAX} characters`;
  if (/[()]/.test(t)) return "No parentheses in a title";
  return null;
}
