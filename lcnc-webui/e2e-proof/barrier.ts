// The isolation harness's rendezvous (per-worker mock, Codex R262): files in
// LCNC_PROOF_DIR, written and awaited by the two participants. A participant
// that waits past its limit fails with the phase it waited for — the outer
// harness counts that as "no proof", never as a counter-proof.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.env.LCNC_PROOF_DIR ?? "";

export function mark(name: string, data: Record<string, unknown> = {}): void {
  writeFileSync(join(DIR, name), JSON.stringify({ t: Date.now(), pid: process.pid, ...data }));
}

export async function waitFor(name: string, ms = 60_000): Promise<void> {
  const t0 = Date.now();
  while (!existsSync(join(DIR, name))) {
    if (Date.now() - t0 > ms) throw new Error(`barrier: no ${name} within ${ms} ms`);
    await new Promise(r => setTimeout(r, 50));
  }
}
