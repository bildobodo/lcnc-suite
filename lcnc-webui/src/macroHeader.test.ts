import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { descriptionLine, readHeader, titleError, withDescription, withName, withTitle } from "./macroHeader";

// The editor dialog's fields read the header in the browser; the gateway
// parses the saved file. ONE set of cases, read by both (the gateway's
// test_macro_files.HeaderParity asserts the same answers).
const REPO = resolve(__dirname, "../..");
interface Case { why: string; file?: string; text?: string; name: string | null; title: string | null; description: string | null }
const CASES: Case[] = JSON.parse(readFileSync(resolve(REPO, "scripts/test_fixtures/macro_header_cases.json"), "utf8"));
const textOf = (c: Case) => c.file ? readFileSync(resolve(REPO, c.file), "utf8") : c.text!;

describe("macroHeader", () => {
  it("reads every shared case as the gateway's parser does", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(8);
    for (const c of CASES) {
      expect(readHeader(textOf(c)), c.why).toEqual({ name: c.name, title: c.title, description: c.description });
    }
  });

  it("a field written reads back, the other two fields and the code unchanged", () => {
    for (const c of CASES) {
      const text = textOf(c);
      const code = (t: string) => t.split(/\r?\n/).filter(l => !/^\s*[(;]/.test(l));
      for (const [write, field, value] of [
        [withTitle, "title", "Renamed title"], [withTitle, "title", null],
        [withDescription, "description", "a new description"], [withDescription, "description", "CNC (spindle) warm-up"],
      ] as const) {
        const out = write(text, value ?? "");
        const want = { ...readHeader(text), [field]: value };
        expect(readHeader(out), `${c.why}: ${field} = ${value}`).toEqual(want);
        expect(code(out), `${c.why}: the code stays`).toEqual(code(text));
      }
    }
  });

  it("clearing the description removes its line: a further comment line becomes the description", () => {
    const face = readFileSync(resolve(REPO, "examples/sim_config/macros/face_top.ngc"), "utf8");
    const out = withDescription(face, "");
    expect(out.split("\n").length).toBe(face.split("\n").length - 1);
    expect(readHeader(out).description).toBe("Example macro of the lcnc-suite: edit it in the Macros tab or replace it.");
    expect(readHeader(withDescription("(MACRO A)\n(only one)\no<a> sub\no<a> endsub\n", "")).description).toBeNull();
  });

  it("a description that would read as a header word or break the comment is written with ;", () => {
    expect(descriptionLine("lifts Z first")).toBe("(lifts Z first)");
    expect(descriptionLine("CNC warm-up")).toBe("; CNC warm-up");
    expect(descriptionLine("lifts (only ever up)")).toBe("; lifts (only ever up)");
  });

  it("a new title goes first, a new description right after the header words", () => {
    const t = "(UNITS mm)\n(PARAM 1 x \"X\" length 0)\no<a> sub\no<a> endsub\n";
    expect(withTitle(t, "A")).toBe("(MACRO A)\n" + t);
    expect(withDescription(t, "moves")).toBe("(UNITS mm)\n(PARAM 1 x \"X\" length 0)\n(moves)\no<a> sub\no<a> endsub\n");
    expect(withDescription("o<a> sub\no<a> endsub\n", "moves")).toBe("(moves)\no<a> sub\no<a> endsub\n");
  });

  it("renaming rewrites every o-word that names the subroutine and nothing else; line ends stay", () => {
    const t = "(MACRO Face)\r\no<face_top> sub\r\n  o<face_lift> if [1]\r\n  o<face_top> return\r\n  o<face_lift> endif\r\nO< Face_Top > endsub (end)\r\n";
    const out = withName(t, "face_top", "face_flat");
    expect(out).toBe("(MACRO Face)\r\no<face_flat> sub\r\n  o<face_lift> if [1]\r\n  o<face_flat> return\r\n  o<face_lift> endif\r\no<face_flat> endsub (end)\r\n");
    expect(readHeader(out).name).toBe("face_flat");
    const face = readFileSync(resolve(REPO, "examples/sim_config/macros/face_top.ngc"), "utf8");
    const renamed = withName(face, "face_top", "face_flat");
    expect(readHeader(renamed).name).toBe("face_flat");
    expect(renamed.match(/o<face_top>/g)).toBeNull();
    expect(renamed.replace(/o<face_flat>/g, "o<face_top>")).toBe(face);
  });

  it("a title the MACRO line cannot hold is named", () => {
    expect(titleError("Face top")).toBeNull();
    expect(titleError("x".repeat(41))).toMatch(/40/);
    expect(titleError("Face (top)")).toMatch(/parenthes/);
  });
});
