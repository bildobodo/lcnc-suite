// The mock a worker talks to (per-worker mock, Codex R261/R262 PM261-02):
// one slot per Playwright parallel index, port BASE + index. Pure, no I/O.
//
// Outside a worker (`--list`, the runner loading the files) there is no index:
// the address is UNBOUND — a use fails visibly, it never falls back to a
// shared port.
export const MOCK_BASE_PORT = 4500;
export const MOCK_MAX_SLOTS = 16;
export const UNBOUND = "http://mock-unbound.invalid/";

/** The slot of a TEST_PARALLEL_INDEX value, or null: only a whole number in
 *  0 … MOCK_MAX_SLOTS - 1 is a slot. */
export function slotOf(index) {
  if (typeof index !== "string" || !/^\d+$/.test(index)) return null;
  const n = Number(index);
  return n < MOCK_MAX_SLOTS ? n : null;
}

export const portOf = (slot) => MOCK_BASE_PORT + slot;

/** The HTTP base of a slot's mock; UNBOUND without a slot. */
export function mockUrl(index) {
  const slot = slotOf(index);
  return slot === null ? UNBOUND : `http://localhost:${portOf(slot)}/`;
}
