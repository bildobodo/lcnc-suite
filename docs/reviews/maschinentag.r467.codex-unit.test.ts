import { describe, expect, it } from "vitest";
import { scanToolHeader, compareHeaderD } from "./programToolHeader";

describe("R466: executable comments are outside the unit proof", () => {
  for (const [name, comment] of [
    ["semicolon Python", ';py,from interpreter import this; this.execute("G20")'],
    ["Python case and leading spaces", ';  Py,from interpreter import this; this.execute("G20")'],
    ["parenthesis Python assignment", '(py,from interpreter import this; this.length_units=1)'],
    ["Python file", '(pyrun,/tmp/r466/native/inch.py)'],
    ["Python reload", '(pyreload)'],
  ]) {
    it(name!, () => {
      const source = `(T13 D=6)\nG21\n${comment}\nG0 X1\nM2\n`;
      const scan = scanToolHeader(source);
      expect({ scan, comparison: compareHeaderD(scan, 13, 6, "mm") }).toMatchObject({
        scan: { unit: null, unitWhy: "unproven" },
        comparison: { kind: "notCompared", why: "unitsNotProven" },
      });
    });
  }
  it("ordinary comments still prove mm", () => {
    expect(scanToolHeader('(T13 D=6)\nG21 (ordinary G20 text)\n; ordinary G20 text\nG0 X1').unit).toBe("mm");
  });
  it("a Python comment AFTER the bounded header does not spoil it", () => {
    expect(scanToolHeader('(T13 D=6)\nG21 G0 X1\n;py,from interpreter import this; this.execute("G20")').unit).toBe("mm");
  });
  it("the first motion line's executable comment counts too", () => {
    expect(scanToolHeader('(T13 D=6)\nG21\nG0 X1 ;py,from interpreter import this; this.execute("G20")').unitWhy).toBe("unproven");
  });
});
