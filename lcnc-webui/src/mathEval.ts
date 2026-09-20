// Safe recursive-descent math expression evaluator.
// Supports: integers/decimals, + − × ÷, unary ±, parentheses.
// No eval(), no Function(). Returns null on any invalid input.

type Token = number | '+' | '-' | '*' | '/' | '(' | ')';

// A number token is exactly one decimal literal. The old tokenizer swept up
// every digit and dot and let parseFloat keep the valid PREFIX — `1.2.3`
// evaluated to 1.2, `1..2+5` to 6, `0..5` to 0 — and the keypad confirmed
// those values into touch-off and offset targets (WP0, UI-11).
const NUMBER_TOKEN = /^(\d+\.?\d*|\.\d+)$/;

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i]!;
    if (c === ' ' || c === '\t') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i]!)) num += expr[i++]!;
      if (!NUMBER_TOKEN.test(num)) return null;
      const n = parseFloat(num);
      if (!Number.isFinite(n)) return null;
      tokens.push(n);
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '(' || c === ')') {
      tokens.push(c as Token);
      i++;
      continue;
    }
    return null; // unknown character
  }
  return tokens;
}

interface S { t: Token[]; pos: number }

function parseExpr(s: S): number {
  let v = parseTerm(s);
  while (s.pos < s.t.length) {
    const op = s.t[s.pos];
    if (op !== '+' && op !== '-') break;
    s.pos++;
    const r = parseTerm(s);
    v = op === '+' ? v + r : v - r;
  }
  return v;
}

function parseTerm(s: S): number {
  let v = parseFactor(s);
  while (s.pos < s.t.length) {
    const op = s.t[s.pos];
    if (op !== '*' && op !== '/') break;
    s.pos++;
    const r = parseFactor(s);
    if (op === '/') {
      if (r === 0) throw new Error('div0');
      v = v / r;
    } else {
      v = v * r;
    }
  }
  return v;
}

function parseFactor(s: S): number {
  if (s.pos >= s.t.length) throw new Error('eof');
  const tok = s.t[s.pos]!;
  if (tok === '-') { s.pos++; return -parseFactor(s); }
  if (tok === '+') { s.pos++; return parseFactor(s); }
  if (tok === '(') {
    s.pos++;
    const v = parseExpr(s);
    if (s.t[s.pos] !== ')') throw new Error('paren');
    s.pos++;
    return v;
  }
  if (typeof tok === 'number') { s.pos++; return tok; }
  throw new Error(`tok:${String(tok)}`);
}

export function evaluate(expression: string): number | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (!tokens || tokens.length === 0) return null;
  try {
    const s: S = { t: tokens, pos: 0 };
    const result = parseExpr(s);
    if (s.pos !== s.t.length) return null; // trailing junk
    return isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

/** Format a result number: integers stay whole, floats get up to 6 decimal places. */
export function fmtEval(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(6)));
}

// ── Field contract (UI-11) ─────────────────────────────────────────────────
// The keypad carries the target field's constraints and ONE admissibility
// check feeds the readout, the OK button and confirm() itself, so a disabled
// button is never the only barrier (physical Enter calls the same confirm).

export interface EntryConstraints {
  min?: number;
  max?: number;
  /** Whole numbers only (tool number, pocket, flutes). */
  integer?: boolean;
}

export interface EntryVerdict {
  /** The value to confirm, or null with a reason the operator can read. */
  value: number | null;
  reason?: string;
}

/**
 * Validate a keypad expression against its field contract. An EMPTY
 * expression is 0 by design (the value after "C"), made visible by the
 * readout; it still has to satisfy the constraints. Nothing is clamped or
 * rounded — an out-of-range value is refused, never silently corrected.
 */
export function validateEntry(expr: string, constraints?: EntryConstraints | null,
                              targetValid = true): EntryVerdict {
  if (!targetValid) return { value: null, reason: 'target no longer available' };
  const trimmed = expr.trim();
  const v = trimmed ? evaluate(trimmed) : 0;
  if (v === null) return { value: null, reason: 'invalid expression' };
  if (constraints?.integer && !Number.isInteger(v)) return { value: null, reason: 'whole number required' };
  if (constraints?.min != null && v < constraints.min) return { value: null, reason: `minimum ${fmtEval(constraints.min)}` };
  if (constraints?.max != null && v > constraints.max) return { value: null, reason: `maximum ${fmtEval(constraints.max)}` };
  return { value: v };
}
