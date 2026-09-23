import { describe, expect, it } from "vitest";
import { parseMdiFieldVariant, mdiFieldVariantMessage, MDI_FIELD_VARIANTS } from "./mdiFieldVariant";

// UX-13 diagnosis: one feature per variant, combinable, unknown names said out loud.
describe("MDI field diagnostic variant", () => {
  it("is off without the parameter", () => {
    expect(parseMdiFieldVariant("")).toBeNull();
    expect(parseMdiFieldVariant("?token=abc")).toBeNull();
  });
  it("applies one variant and says so", () => {
    const v = parseMdiFieldVariant("?mdiField=search")!;
    expect(v).toEqual({ names: ["search"], unknown: [], attrs: { type: "search" } });
    expect(mdiFieldVariantMessage(v)).toBe('MDI field diagnostic (UX-13): search (type="search")');
  });
  it("combines variants in order, removes attributes with undefined, ignores case and repeats", () => {
    const v = parseMdiFieldVariant("?mdiField=NoName, noplaceholder,noname")!;
    expect(v.names).toEqual(["noname", "noplaceholder"]);
    expect(v.attrs).toEqual({ name: undefined, placeholder: undefined });
    expect("name" in v.attrs && "placeholder" in v.attrs).toBe(true);
  });
  it("reports unknown names with the known list, never silently", () => {
    const v = parseMdiFieldVariant("?mdiField=serch,withid")!;
    expect(v.names).toEqual(["withid"]);
    expect(v.unknown).toEqual(["serch"]);
    expect(mdiFieldVariantMessage(v)).toContain("unknown: serch; known: " + Object.keys(MDI_FIELD_VARIANTS).join(", "));
    expect(mdiFieldVariantMessage(parseMdiFieldVariant("?mdiField=")!)).toBe("MDI field diagnostic (UX-13): none");
  });
  it("base changes nothing", () => {
    expect(parseMdiFieldVariant("?mdiField=base")!.attrs).toEqual({});
  });
});
