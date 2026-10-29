/**
 * This tab's WebSocket CONNECTION key (button gates BG-14, Codex R204).
 *
 * The gateway mints it per connection and sends it with the hello reply. A
 * protected HTTP write — a program, a macro, the tool table, a protected
 * settings section, the reset — names it (`X-Conn-Key`, or `conn_key` in
 * the page-hide beacon's body), and the gateway admits the write only while
 * that connection is open and armed. A closed connection's key is gone: it
 * is cleared here on close, and the next hello brings a new one.
 *
 * No imports: lcncWs sets it, lcncApi and defaults read it — the module sits
 * below both, so neither import cycle (defaults ↔ lcncWs) comes back.
 */
let current: string | null = null;

export function setConnKey(key: string | null): void {
  current = key;
}

export function connKey(): string | null {
  return current;
}

/** Headers for a protected HTTP write. */
export function connHeaders(): Record<string, string> {
  return current ? { "X-Conn-Key": current } : {};
}
