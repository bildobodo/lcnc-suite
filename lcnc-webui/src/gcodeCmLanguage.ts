/**
 * G-code language support for the CodeMirror 6 editor.
 *
 * Mirrors the read-only viewer's tokenizer (gcodeHighlight.ts) — same regexes,
 * same classification, same CSS color vars — so the editor and viewer render a
 * line identically. Update BOTH if the token grammar ever changes.
 *
 * A StreamLanguage (stateless per token) keeps this safe on huge files: CM6
 * tokenizes incrementally in small time-budgeted slices, never jamming the main
 * thread — the property the editor exists to protect (the client heartbeat).
 */
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { Tag } from "@lezer/highlight";

// Distinct tags per token type so each maps to its own color var (the stock
// lezer tag set doesn't carve up G-code semantics).
const gcodeTag = Tag.define();
const mcodeTag = Tag.define();
const coordTag = Tag.define();
const paramTag = Tag.define();
const commentTag = Tag.define();

const gcodeStream = StreamLanguage.define<{ inParen: boolean }>({
  startState: () => ({ inParen: false }),
  token(stream, state) {
    // Comments — same shapes as the viewer: `;` to end of line, `(...)` inline.
    if (state.inParen) {
      if (stream.skipTo(")")) { stream.next(); state.inParen = false; }
      else stream.skipToEnd();
      return "gComment";
    }
    if (stream.match(/^;.*/)) return "gComment";
    if (stream.peek() === "(") { stream.next(); state.inParen = true; return "gComment"; }
    // Same token regexes as gcodeHighlight.tokenizeCode (case-insensitive).
    if (stream.match(/^[GM]\d+(?:\.\d+)?/i)) {
      const isG = stream.current().toUpperCase().startsWith("G");
      return isG ? "gGcode" : "gMcode";
    }
    if (stream.match(/^[XYZIJKABC][-+]?\d+(?:\.\d+)?/i)) return "gCoord";
    if (stream.match(/^[FSTPQRHDL]\d+(?:\.\d+)?/i)) return "gParam";
    if (stream.match(/^N\d+/i)) return "gComment";  // line numbers — viewer styles them as comment
    stream.next();
    return null;  // plain text → inherits --fg
  },
  tokenTable: {
    gGcode: gcodeTag,
    gMcode: mcodeTag,
    gCoord: coordTag,
    gParam: paramTag,
    gComment: commentTag,
  },
});

// Colors come from the SAME tokens as .token-* in style.css (single source of
// truth for syntax color semantics — never hardcode).
const gcodeHighlightStyle = HighlightStyle.define([
  { tag: gcodeTag, color: "var(--syntax-gcode)", fontWeight: "var(--fw-semibold)" },
  { tag: mcodeTag, color: "var(--syntax-mcode)", fontWeight: "var(--fw-semibold)" },
  { tag: coordTag, color: "var(--syntax-coord)" },
  { tag: paramTag, color: "var(--syntax-param)" },
  { tag: commentTag, color: "var(--syntax-comment)" },
]);

/** Drop-in extensions for the editor: G-code tokenizer + viewer-matched colors. */
export const gcodeEditorLanguage = [gcodeStream, syntaxHighlighting(gcodeHighlightStyle)];
