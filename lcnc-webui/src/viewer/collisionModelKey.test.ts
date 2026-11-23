import { describe, expect, it } from "vitest";
import { collisionModelKey, type ModelKeyPart } from "./collisionModelKey";

const machine = { groups: [{ id: "head", parent: "root" }], kinematics: [{ group: "head", joint: 0, type: "translate", direction: "x", sign: 1 }],
  workGroup: "table", toolGroup: "head", unitScale: 1 };
const part: ModelKeyPart = { id: "vise", file: "vise.stl", collision: null, group: "table", translate: [0, 0, 1], rotate: null,
  stock: false, mesh: "uuid-a", proxy: null };

describe("the collision model's key (P2b-1)", () => {
  it("takes no tool: a tool change keeps the model", () => {
    expect(collisionModelKey.length, "machine, parts, unit scale — nothing of the tool").toBe(3);
    expect(collisionModelKey(machine, [part], 1)).toBe(collisionModelKey(structuredClone(machine), [{ ...part }], 1));
  });
  it("changes with every input that builds the model", () => {
    const k = collisionModelKey(machine, [part], 1);
    const changed: Array<[string, string]> = [
      ["kinematics", collisionModelKey({ ...machine, kinematics: [{ ...machine.kinematics[0], direction: "y" }] }, [part], 1)],
      ["the tree", collisionModelKey({ ...machine, groups: [{ id: "head", parent: "table" }] }, [part], 1)],
      ["a part's place", collisionModelKey(machine, [{ ...part, translate: [0, 0, 2] }], 1)],
      ["a part's group", collisionModelKey(machine, [{ ...part, group: "head" }], 1)],
      ["stock", collisionModelKey(machine, [{ ...part, stock: true }], 1)],
      ["a reloaded mesh", collisionModelKey(machine, [{ ...part, mesh: "uuid-b" }], 1)],
      ["a loaded proxy", collisionModelKey(machine, [{ ...part, collision: "vise.proxy.stl", proxy: "uuid-p" }], 1)],
      ["another part", collisionModelKey(machine, [part, { ...part, id: "post" }], 1)],
      ["the unit scale", collisionModelKey(machine, [part], 25.4)],
    ];
    for (const [what, other] of changed) expect(other, what).not.toBe(k);
  });
});
