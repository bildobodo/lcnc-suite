import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePreviewOrigin, parseRunBasis, runInProgress } from "../runBasis";
import { admitRunCheck, basisFromLive, basisFromRun, checkState, sameCheckInputs, type CheckBasis, type LiveCheckInputs, type RunCheckInputs } from "./checkBasis";

// The status envelope as the gateway sends it — the gateway's tests hold its
// keys to the same file (test_command_dispatch, test_bulk_pipeline).
const REPO = resolve(__dirname, "../../..");
const WIRE = JSON.parse(readFileSync(resolve(REPO, "scripts/test_fixtures/run_check_wire.json"), "utf8"));

const AUTO = 2, MDI = 3, IDLE = 1, READING = 2;

describe("run_basis and preview_origin on the wire (plan „Prüfung im Lauf“ 1a/1b)", () => {
  it("reads every field of the gateway's run_basis", () => {
    const rb = parseRunBasis(WIRE.run_basis)!;
    expect(rb).toEqual({
      runId: 3, state: "sent", file: WIRE.run_basis.file, source: WIRE.run_basis.source, version: 12,
      ctxDigest: WIRE.run_basis.ctx_digest, toolBasisRev: 4, verified: true, why: null,
      start: {
        g5xIndex: 1, g5xOffset: [10, 20, -30, 0, 0, 0, 0, 0, 0], g92Offset: [0, 0, 1.5, 0, 0, 0, 0, 0, 0],
        rotationXy: 0, wcsTable: WIRE.run_basis.start.wcs_table,
        toolNumber: 13, toolDiameter: 8, toolLength: 48.2, toolTableZ: -48.2,
        toolOffset: [0, 0, -48.2, 0, 0, 0, 0, 0, 0], eoffsetZ: 0, eoffsetEnabled: false,
        joints: [1.5, -2, 30], jointsWhy: null,
      },
    });
    // not taken: why, never a position (parity-ef plan E5)
    const why = parseRunBasis({ ...WIRE.run_basis, start: { ...WIRE.run_basis.start, joints: undefined, joints_why: "moving" } })!;
    expect([why.start!.joints, why.start!.jointsWhy]).toEqual([null, "moving"]);
    const bad = parseRunBasis({ ...WIRE.run_basis, start: { ...WIRE.run_basis.start, joints: [1, null, 3] } })!;
    expect(bad.start!.joints).toBeNull();
  });

  it("reads every field of the gateway's preview_origin", () => {
    expect(parsePreviewOrigin(WIRE.preview_origin)).toEqual({
      version: 13, file: WIRE.preview_origin.file, source: WIRE.preview_origin.source,
      reason: "midrun:table_mtime", pinned: true,
      forRun: { runId: 3, ctxDigest: WIRE.preview_origin.for_run.ctx_digest, toolBasisRev: 4 },
      table: { mtime: 1760000000.5, rows: "a1b2c3d4e5f60718" },
      toolBasisRev: 4, toolBasisRevNow: 4,
    });
  });

  it("a malformed record is no record — never a guessed run or origin", () => {
    for (const bad of [null, 5, {}, { ...WIRE.run_basis, run_id: "3" }, { ...WIRE.run_basis, state: "running" }]) {
      expect(parseRunBasis(bad)).toBeNull();
    }
    for (const bad of [null, {}, { ...WIRE.preview_origin, version: null },
      { ...WIRE.preview_origin, tool_basis_rev_now: undefined }, { ...WIRE.preview_origin, file: 7 }]) {
      expect(parsePreviewOrigin(bad)).toBeNull();
    }
    // a for_run without its run id or revision is no run
    expect(parsePreviewOrigin({ ...WIRE.preview_origin, for_run: { run_id: 3 } })!.forRun).toBeNull();
    // a value that is not a number is unknown, never 0
    expect(parseRunBasis({ ...WIRE.run_basis, start: { ...WIRE.run_basis.start, tool_length: "48" } })!.start!.toolLength)
      .toBeNull();
  });

  it("a run is in progress only with its start written, in AUTO, the interpreter busy", () => {
    const rb = parseRunBasis(WIRE.run_basis)!;
    expect(runInProgress(rb, AUTO, READING, AUTO, IDLE)).toBe(true);
    expect(runInProgress(rb, AUTO, IDLE, AUTO, IDLE), "a refused start leaves it idle").toBe(false);
    expect(runInProgress(rb, MDI, READING, AUTO, IDLE), "an MDI after the run is the operator's").toBe(false);
    expect(runInProgress({ ...rb, state: "unsent" }, AUTO, READING, AUTO, IDLE)).toBe(false);
    expect(runInProgress({ ...rb, state: "sending" }, AUTO, READING, AUTO, IDLE)).toBe(false);
    expect(runInProgress(null, AUTO, READING, AUTO, IDLE)).toBe(false);
    expect(runInProgress(rb, AUTO, undefined, AUTO, IDLE), "no interpreter state: unknown").toBe(false);
  });
});

const LIVE: LiveCheckInputs = {
  g5x: [1, 2, 3, 0, 0, 0, 0, 0, 0], g92: [0, 0, 0, 0, 0, 0, 0, 0, 0], rotationXy: 0,
  toolOffset: [0, 0, 10, 0, 0, 0, 0, 0, 0], wcsTable: [{ name: "G54", x: 1, y: 2, z: 3, r: 0 }],
  toolNum: 2, toolDiam: 6, toolLen: 10, eoffsetZ: null, eoffsetEnabled: null,
};

describe("the check basis (plan 1c)", () => {
  it("idle: the live state, copied", () => {
    const pv = structuredClone(LIVE);
    const b = basisFromLive(pv, null);
    expect(b).toEqual({ kind: "idle", runId: null, g5x: LIVE.g5x, g92: LIVE.g92, rotationXy: 0,
      toolOffset: LIVE.toolOffset, wcsTable: LIVE.wcsTable, toolNum: 2, toolDiam: 6, toolLen: 10,
      eoffsetZ: null, eoffsetEnabled: null, startJoints: null });
    pv.g5x![0] = 99; pv.wcsTable![0]!.x = 99; pv.toolOffset![2] = 99;
    expect(b.g5x[0]).toBe(1);
    expect(b.wcsTable![0]!.x).toBe(1);
    expect(b.toolOffset[2]).toBe(10);
  });

  it("the payload's tool basis is the offset before its first TLO row (VP-I20)", () => {
    expect(basisFromLive(LIVE, [0, 0, 41.5]).toolOffset).toEqual([0, 0, 41.5]);
    const rb = parseRunBasis(WIRE.run_basis)!;
    expect(basisFromRun(rb, [0, 0, 41.5])!.toolOffset).toEqual([0, 0, 41.5]);
    expect(basisFromRun(rb, null)!.toolOffset).toEqual([0, 0, -48.2, 0, 0, 0, 0, 0, 0]);
  });

  it("in a run: the run's start as the gateway took it — every field from run_basis.start", () => {
    const rb = parseRunBasis(WIRE.run_basis)!;
    const s = WIRE.run_basis.start;
    expect(basisFromRun(rb, null)).toEqual({
      kind: "run", runId: 3, g5x: s.g5x_offset, g92: s.g92_offset, rotationXy: s.rotation_xy,
      toolOffset: s.tool_offset, wcsTable: s.wcs_table,
      toolNum: s.tool_number, toolDiam: s.tool_diameter, toolLen: s.tool_length,
      eoffsetZ: s.eoffset_z, eoffsetEnabled: s.eoffset_enabled, startJoints: s.joints,
    });
    // a start that was not written is no run, and no start is no basis
    expect(basisFromRun({ ...rb, state: "unsent" }, null)).toBeNull();
    expect(basisFromRun({ ...rb, state: "sending" }, null)).toBeNull();
    expect(basisFromRun({ ...rb, start: null }, null)).toBeNull();
    expect(basisFromRun(null, null)).toBeNull();
  });

  it("the same inputs are the same check, whatever the kind", () => {
    const a = basisFromLive(LIVE, null);
    expect(sameCheckInputs(a, { ...a, kind: "run", runId: 4 })).toBe(true);
    const changed: Array<Partial<CheckBasis>> = [
      { g5x: [1, 2, 3.001, 0, 0, 0, 0, 0, 0] }, { g92: [0, 0, 1, 0, 0, 0, 0, 0, 0] }, { rotationXy: 1 },
      { toolOffset: [0, 0, 11] }, { wcsTable: [{ name: "G54", x: 1, y: 2, z: 4, r: 0 }] },
      { toolNum: 3 }, { toolDiam: 7 }, { toolLen: 11 },
      // a beginning bound to another start (parity-ef plan E5)
      { startJoints: [1, 2, 3] },
    ];
    for (const c of changed) expect(sameCheckInputs(a, { ...a, ...c }), JSON.stringify(c)).toBe(false);
    const j = { ...a, startJoints: [1, 2, 3] };
    expect(sameCheckInputs(j, { ...j, startJoints: [1, 2, 3] })).toBe(true);
    expect(sameCheckInputs(j, { ...j, startJoints: [1, 2, 3.5] })).toBe(false);
  });

  it("checkState names what the shown result is", () => {
    const idle = basisFromLive(LIVE, null);
    const run = basisFromRun(parseRunBasis(WIRE.run_basis)!, null)!;
    expect(checkState({ shown: null, previous: false })).toEqual({ kind: "none" });
    expect(checkState({ shown: null, previous: true })).toEqual({ kind: "previous" });
    expect(checkState({ shown: { basis: idle, phase: "full", fromLine: null, done: false }, previous: true }))
      .toEqual({ kind: "current" });
    expect(checkState({ shown: { basis: run, phase: "provisional", fromLine: 42, done: false }, previous: false }))
      .toEqual({ kind: "run-provisional", fromLine: 42, done: false });
    expect(checkState({ shown: { basis: run, phase: "full", fromLine: null, done: true }, previous: false }))
      .toEqual({ kind: "run-full", done: true });
  });
});

describe("admitting a check during the run (plan „Prüfung im Lauf“ 3a)", () => {
  const ok = (): RunCheckInputs => ({
    origin: parsePreviewOrigin(WIRE.preview_origin), run: parseRunBasis(WIRE.run_basis),
    shownVersion: WIRE.preview_origin.version, shownFile: WIRE.run_basis.file, running: true,
  });
  it("the pinned parse made for this run, on screen, while it runs", () => {
    expect(admitRunCheck(ok())).toEqual({ ok: true });
  });
  it("every other case waits for idle — before any sweep", () => {
    const o = ok();
    const cases: Array<[string, RunCheckInputs]> = [
      ["no run", { ...o, running: false }],
      ["no run basis", { ...o, run: null }],
      ["a start not written", { ...o, run: { ...o.run!, state: "unsent" } }],
      ["the run's start not verified", { ...o, run: { ...o.run!, verified: false } }],
      ["an ordinary publication", { ...o, origin: { ...o.origin!, pinned: false } }],
      ["no origin", { ...o, origin: null }],
      ["another version on screen", { ...o, shownVersion: 12 }],
      ["nothing decoded yet", { ...o, shownVersion: null }],
      ["another file", { ...o, origin: { ...o.origin!, file: "/other.ngc" } }],
      ["another file on screen", { ...o, shownFile: "/other.ngc" }],
      // the same file and another text (R113)
      ["another text", { ...o, origin: { ...o.origin!, source: "0".repeat(64) } }],
      ["no text fingerprint", { ...o, origin: { ...o.origin!, source: null } }],
      // a parse of run 1 published after run 2 started (R113's green control)
      ["planned for another run", { ...o, origin: { ...o.origin!, forRun: { ...o.origin!.forRun!, runId: 2 } } }],
      // the same file and text from another start (R114: B's context under A's label)
      ["another start context", { ...o, origin: { ...o.origin!, forRun: { ...o.origin!.forRun!, ctxDigest: "x" } } }],
      ["another basis revision", { ...o, origin: { ...o.origin!, forRun: { ...o.origin!.forRun!, toolBasisRev: 3 } } }],
      ["planned for no run", { ...o, origin: { ...o.origin!, forRun: null } }],
      // a basis verified since without a new version
      ["the basis moved since", { ...o, origin: { ...o.origin!, toolBasisRevNow: 5 } }],
    ];
    for (const [name, inp] of cases) {
      const r = admitRunCheck(inp);
      expect(r.ok, name).toBe(false);
      expect((r as { why: string }).why, name).toBeTruthy();
    }
  });
});

describe("the external Z offset rides the basis (parity-ef F3, Codex R126 VP-I76)", () => {
  it("idle: the live value and enable, and not-read stays not-read", () => {
    expect(basisFromLive({ ...LIVE, eoffsetZ: 0, eoffsetEnabled: true }, null))
      .toMatchObject({ eoffsetZ: 0, eoffsetEnabled: true });
    expect(basisFromLive(LIVE, null)).toMatchObject({ eoffsetZ: null, eoffsetEnabled: null });
  });

  it("a run: the start's, from the wire (the fixture carries both keys)", () => {
    const rb = parseRunBasis(WIRE.run_basis)!;
    expect(rb.start).toMatchObject({ eoffsetZ: 0, eoffsetEnabled: false });
    const b = basisFromRun(rb, null)!;
    expect(b).toMatchObject({ eoffsetZ: 0, eoffsetEnabled: false });
    const off = parseRunBasis({ ...WIRE.run_basis, start: { ...WIRE.run_basis.start, eoffset_z: null, eoffset_enabled: 1 } })!;
    expect(off.start).toMatchObject({ eoffsetZ: null, eoffsetEnabled: true });
  });
});
