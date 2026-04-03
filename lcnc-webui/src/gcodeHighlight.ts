export type Token = {
  type: 'gcode' | 'mcode' | 'coord' | 'param' | 'comment' | 'text';
  text: string;
};

/** Syntax highlighter for G-code lines */
export function highlightGcode(line: string): Token[] {
  const tokens: Token[] = [];

  // Check for comment (everything after semicolon or inside parentheses)
  const commentMatch = line.match(/^([^;(]*)(;.*|(\(.*\).*)?)$/);
  if (commentMatch) {
    const [, code, comment] = commentMatch;

    // Process the code part
    if (code) {
      tokenizeCode(code, tokens);
    }

    // Add comment
    if (comment) {
      tokens.push({ type: 'comment', text: comment });
    }
  } else {
    tokenizeCode(line, tokens);
  }

  return tokens;
}

function tokenizeCode(code: string, tokens: Token[]) {
  // Regex to match G-code tokens
  const pattern = /([GM]\d+(?:\.\d+)?)|([XYZIJKABC][-+]?\d+(?:\.\d+)?)|([FSTPQRHDL]\d+(?:\.\d+)?)|([N]\d+)|(\s+)|([^\s]+)/gi;

  let match;
  while ((match = pattern.exec(code)) !== null) {
    const [, gcode, coord, param, lineNum, space, other] = match;

    if (gcode) {
      const isG = gcode.toUpperCase().startsWith('G');
      tokens.push({ type: isG ? 'gcode' : 'mcode', text: gcode });
    } else if (coord) {
      tokens.push({ type: 'coord', text: coord });
    } else if (param) {
      tokens.push({ type: 'param', text: param });
    } else if (lineNum) {
      tokens.push({ type: 'comment', text: lineNum });
    } else if (space) {
      tokens.push({ type: 'text', text: space });
    } else if (other) {
      tokens.push({ type: 'text', text: other });
    }
  }
}
