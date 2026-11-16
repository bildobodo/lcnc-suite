import { describe, expect, it } from "vitest";
import { complete, parseMarks, receipts, type AttemptOrigin, type ReplayLine } from "../e2e/unloadReceipts";

// The Firefox unload's receipt (e2e/unloadReceipts.ts, Codex R386 VM-I25):
// what the browser guard (e2e/firefox-unload.guard.ts) cannot stage — a
// mark received twice, another unload's mark, the right mark under a
// foreign or absent origin. Each impostor fills no other beacon.

const A: AttemptOrigin = { run: "run-1", test: "t-1", project: "firefox-core", retry: 0 };
const N = "n-1";
const post = (beacon: string | undefined, origin: unknown = A): ReplayLine =>
  ({ kind: "http", method: "POST", ...(beacon !== undefined ? { beacon } : {}), origin });

describe("receipts", () => {
  it("every mark received once with this attempt's origin: complete", () => {
    const r = receipts([`${N}.1`, `${N}.2`], [post(`${N}.1`), post(`${N}.2`)], A, N);
    expect(r).toEqual({ received: [`${N}.1`, `${N}.2`], missing: [], foreign: [], twice: [] });
    expect(complete(r)).toBe(true);
  });

  it("an unrelated POST fills no beacon (Codex R386 counter-case)", () => {
    const r = receipts([`${N}.1`, `${N}.2`], [post(`${N}.1`), post(undefined)], A, N);
    expect(r.missing).toEqual([`${N}.2`]);
    expect(complete(r)).toBe(false);
  });

  it("the same mark twice fills no other beacon and is itself named", () => {
    const r = receipts([`${N}.1`, `${N}.2`], [post(`${N}.1`), post(`${N}.1`)], A, N);
    expect(r).toEqual({ received: [], missing: [`${N}.2`], foreign: [], twice: [`${N}.1`] });
    expect(complete(r)).toBe(false);
  });

  it("another unload's mark is not this unload's receipt", () => {
    const r = receipts([`${N}.1`], [post("n-0.1")], A, N);
    expect(r.missing).toEqual([`${N}.1`]);
    expect(r.foreign).toEqual([]);
    expect(complete(r)).toBe(false);
  });

  it("the right mark under another attempt's or no origin is foreign, not received", () => {
    for (const origin of [null, { ...A, retry: 1 }, { ...A, test: "t-2" }, { ...A, run: "run-2" },
                          { ...A, project: "chromium" }, { infra: "infra:baseline" }, "run-1"]) {
      const r = receipts([`${N}.1`], [post(`${N}.1`, origin)], A, N);
      expect(r, JSON.stringify(origin)).toEqual({ received: [], missing: [`${N}.1`], foreign: [`${N}.1`], twice: [] });
      expect(complete(r)).toBe(false);
    }
  });

  it("a mark of this unload it never handed off is foreign", () => {
    const r = receipts([`${N}.1`], [post(`${N}.1`), post(`${N}.3`)], A, N);
    expect(r.foreign).toEqual([`${N}.3`]);
    expect(complete(r)).toBe(false);
  });

  it("only a POST of the http kind is read", () => {
    const lines: ReplayLine[] = [{ kind: "http", method: "GET", beacon: `${N}.1`, origin: A },
                                 { kind: "frame", method: "POST", beacon: `${N}.1`, origin: A }];
    expect(receipts([`${N}.1`], lines, A, N).missing).toEqual([`${N}.1`]);
  });

  it("no beacon handed off: nothing to wait for", () => {
    expect(complete(receipts([], [post(undefined)], A, N))).toBe(true);
  });
});

describe("parseMarks", () => {
  it("a list of this unload's marks", () => {
    expect(parseMarks(JSON.stringify([`${N}.1`, `${N}.2`]), N)).toEqual([`${N}.1`, `${N}.2`]);
    expect(parseMarks("[]", N)).toEqual([]);
  });

  it("anything else throws — no count is no zero", () => {
    for (const raw of [null, "", "2", "{}", '["x.1"]', `["${N}.a"]`, `["${N}.1","${N}.1"]`, `[1]`])
      expect(() => parseMarks(raw, N), String(raw)).toThrow();
  });
});
