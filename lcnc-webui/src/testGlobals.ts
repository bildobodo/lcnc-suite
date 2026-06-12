// Shared vitest globals for tests that import browser-flavored modules
// (lcncWs.ts and its dependency chain). vitest runs in a plain node
// environment (vitest.config.ts), and defaults.ts registers a
// visibilitychange listener at module top level — so `document` must exist
// BEFORE the import. Storage and rAF stubs make import-time behavior
// deterministic instead of relying on caught ReferenceErrors. Every stub is
// install-if-missing so this module stays harmless under a DOM environment.
//
// Usage: `import "./testGlobals";` as the FIRST import of the test file —
// ESM evaluates imports in order, so the stubs land before the module under
// test executes.

function _memStorage(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
} {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => { m.clear(); },
  };
}

const g = globalThis as any;

// Vue's runtime-dom probes document.createElement("template") at import
// whenever `document` is defined at all, so the stub must produce minimal
// element-shaped objects, not just the event-listener surface defaults.ts needs.
function _stubElement(): any {
  return {
    innerHTML: "",
    content: { firstChild: null, cloneNode: () => null },
    style: {},
    setAttribute: () => {},
    appendChild: () => {},
    cloneNode: () => _stubElement(),
  };
}

if (typeof g.document === "undefined") {
  g.document = {
    hidden: false,
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => _stubElement(),
    createComment: () => ({}),
    createTextNode: () => ({}),
  };
}
if (typeof g.localStorage === "undefined") g.localStorage = _memStorage();
if (typeof g.sessionStorage === "undefined") g.sessionStorage = _memStorage();
if (typeof g.requestAnimationFrame === "undefined") {
  g.requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(performance.now()), 16);
  g.cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
}
