// A radio's native `name` is its GROUP: two components that write the same
// literal name form one group whenever both are mounted — Settings' default
// Run-from-line preset and the dialog's preset shared `rflSpindleDir`, and
// mounting Settings unchecked the dialog's choice while its model kept it
// (implementation review round 4, UI-DI07). A literal radio name therefore
// lives in ONE component; a group a component can mount twice takes a
// per-instance name (`useId()`, like the dialog's).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith(".vue"));

/** Literal names on radio inputs: MachineRadio, or a plain type="radio". */
function radioNames(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/<(MachineRadio\b[^>]*|input\b[^>]*type="radio"[^>]*)>/g)) {
    const n = /\sname="([^"]+)"/.exec(m[1]!)?.[1];
    if (n) names.push(n);
  }
  return names;
}

describe("radio group names", () => {
  it("a literal radio name belongs to one component", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    let seen = 0;
    for (const f of files) {
      for (const n of new Set(radioNames(readFileSync(new URL(f, dir), "utf8")))) {
        seen++;
        const first = owner.get(n);
        if (first && first !== f) clashes.push(`"${n}": ${first} and ${f}`);
        else owner.set(n, f);
      }
    }
    expect(clashes, clashes.join("\n")).toEqual([]);
    // The scan found the groups it guards (a broken pattern must not pass empty).
    expect(seen).toBeGreaterThanOrEqual(15);
  });
});
