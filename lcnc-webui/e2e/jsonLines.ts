// The ONE reader of a JSON-lines log another process may still be writing
// (the mock's replay log). The mock appends each line with one write, but a
// reader in another process can see that write half done (Linux reads a
// regular file without the writer's lock): a trailing piece with no newline
// yet is a line still being written and is left for the next read — a
// Firefox core run read one torn and failed on its JSON (strip-fit round
// gate, 2026-11-19). A WHOLE line that is no JSON still throws: only the
// unfinished end is left out (Codex R407).
import { readFileSync } from "node:fs";

export function wholeJsonLines<T>(file: string): T[] {
  return wholeLinesOf(readFileSync(file, "utf8")).map(line => JSON.parse(line) as T);
}

/** The finished lines of a text: everything up to its last newline. */
export function wholeLinesOf(text: string): string[] {
  const whole = text.endsWith("\n") ? text : text.slice(0, text.lastIndexOf("\n") + 1);
  return whole.split("\n").filter(Boolean);
}
