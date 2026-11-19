// The replay log's reader (e2e/jsonLines.ts): a line still being written is
// left for the next read; a finished line that is no JSON still fails
// (strip-fit round gate 2026-11-19, Codex R407).
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wholeJsonLines, wholeLinesOf } from "../e2e/jsonLines";

describe("wholeJsonLines", () => {
  it("leaves a torn last line for the next read", () => {
    expect(wholeLinesOf('{"a":1}\n{"b":2}\n{"c":"hal')).toEqual(['{"a":1}', '{"b":2}']);
    expect(wholeLinesOf('{"c":"hal')).toEqual([]);
    expect(wholeLinesOf("")).toEqual([]);
  });
  it("reads every finished line, and the torn one once it is finished", () => {
    const file = join(mkdtempSync(join(tmpdir(), "jsonlines-")), "replay.jsonl");
    writeFileSync(file, '{"n":1}\n{"n":2}\n{"n":');
    expect(wholeJsonLines<{ n: number }>(file).map(l => l.n)).toEqual([1, 2]);
    appendFileSync(file, '3}\n');
    expect(wholeJsonLines<{ n: number }>(file).map(l => l.n)).toEqual([1, 2, 3]);
  });
  it("never swallows a finished line that is no JSON", () => {
    expect(() => wholeLinesOf('{"a":1}\nnot json\n').map(l => JSON.parse(l))).toThrow();
    const file = join(mkdtempSync(join(tmpdir(), "jsonlines-")), "bad.jsonl");
    writeFileSync(file, '{"a":1}\n{"b":\n');
    expect(() => wholeJsonLines(file)).toThrow(SyntaxError);
  });
});
