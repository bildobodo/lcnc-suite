// A Vitest reporter for the gate's unit steps (replay 5c, Codex R398 VM-I34):
// each test's RESOLVED options as the run's own artefact — above all `fails`.
// Vitest's JSON report writes an expected failure as `passed` with no mark
// (measured 2026-11-18, 4.1.8), and the source can spell it many ways
// (`it.fails(`, `it.fails (`, `it.fails.each`, `{ fails: true }`, an alias);
// the runner's task options are what it actually ran with.
//
//   npx vitest run … --reporter=<this file>   with LCNC_VITEST_OPTIONS_OUT=<path>
import { writeFileSync } from "node:fs";

export default class OptionsReporter {
  onTestRunEnd(testModules) {
    const out = process.env.LCNC_VITEST_OPTIONS_OUT;
    if (!out) return;
    const tests = [];
    for (const m of testModules) {
      for (const t of m.children.allTests()) {
        tests.push({ file: m.moduleId, fullName: t.fullName, fails: t.options.fails === true, mode: t.options.mode });
      }
    }
    writeFileSync(out, JSON.stringify(tests));
  }
}
