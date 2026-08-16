// Differential golden test: pin the client WCS transform to LinuxCNC's own
// interpreter. The fixtures (rs274Fixtures.gen.ts) are produced by the REAL
// rs274.interpret.Translated.rotate_and_translate — the exact offset order
// the running interp applies (g92 BEFORE the G10 R rotation, g5x after) —
// plus the joint-space TLO term. If wcsTerms/programToMachine/
// machineToProgram ever drift from RS274 semantics, this fails instead of
// the dry-run sim silently mis-posing the machine.
//
// Regenerate fixtures (LinuxCNC host only):
//   python3 scripts/gen_rs274_wcs_fixtures.py
import { describe, expect, it } from "vitest";
import { machineToProgram, programToMachine, wcsTerms } from "./partFrame";
import { RS274_WCS_CASES } from "./rs274Fixtures.gen";

// Forward: 1e-9 machine units — pure float64 noise. Round-trip doubles the
// rotations, so give the inverse one extra order of headroom.
const FWD_TOL = 1e-9;
const INV_TOL = 1e-8;

describe("client WCS transform vs rs274 interpreter (golden)", () => {
  it("has a healthy case table", () => {
    expect(RS274_WCS_CASES.length).toBeGreaterThan(40);
    // At least one case exercises the killer combo the old combined-sum
    // model got wrong: G92 and rotation simultaneously active.
    expect(RS274_WCS_CASES.some(
      c => c.rotationDeg !== 0 && (c.g92[0] !== 0 || c.g92[1] !== 0),
    )).toBe(true);
    // ...and at least one a nonzero TLO.
    expect(RS274_WCS_CASES.some(c => c.tool.some(v => v !== 0))).toBe(true);
  });

  it.each(RS274_WCS_CASES.map((c, i) => [i, c] as const))(
    "case %i: programToMachine matches the interpreter, machineToProgram inverts it",
    (_i, c) => {
      const o = wcsTerms({
        g5x: c.g5x, g92: c.g92, rotationDeg: c.rotationDeg, tool: c.tool,
      });
      const out: number[] = [];
      const [px, py, pz, pa, pb, pc] = c.program;
      programToMachine(px!, py!, pz!, pa!, pb!, pc!, o, out);
      for (let k = 0; k < 6; k++) {
        expect(Math.abs(out[k]! - c.joint[k]!),
          `axis ${"XYZABC"[k]} forward`).toBeLessThan(FWD_TOL);
      }

      const back: number[] = [];
      machineToProgram(c.joint[0]!, c.joint[1]!, c.joint[2]!,
        c.joint[3]!, c.joint[4]!, c.joint[5]!, o, back);
      for (let k = 0; k < 6; k++) {
        expect(Math.abs(back[k]! - c.program[k]!),
          `axis ${"XYZABC"[k]} inverse`).toBeLessThan(INV_TOL);
      }
    },
  );

  it("omitting wcs.tool gives tip-space (path placement) math", () => {
    const c = RS274_WCS_CASES.find(x => x.tool.some(v => v !== 0))!;
    const withTool = wcsTerms({ g5x: c.g5x, g92: c.g92, rotationDeg: c.rotationDeg, tool: c.tool });
    const without = wcsTerms({ g5x: c.g5x, g92: c.g92, rotationDeg: c.rotationDeg });
    const a: number[] = [], b: number[] = [];
    const [px, py, pz, pa, pb, pc] = c.program;
    programToMachine(px!, py!, pz!, pa!, pb!, pc!, withTool, a);
    programToMachine(px!, py!, pz!, pa!, pb!, pc!, without, b);
    for (let k = 0; k < 3; k++) {
      expect(a[k]! - b[k]!).toBeCloseTo(c.tool[k]!, 9);  // joint − tip = TLO
    }
    for (let k = 3; k < 6; k++) expect(a[k]).toBe(b[k]);  // rotary untouched
  });
});
