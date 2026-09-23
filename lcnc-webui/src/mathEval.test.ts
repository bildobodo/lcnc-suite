import { describe, expect, it } from "vitest";
import { evaluate, validateEntry } from "./mathEval";

// WP0 / UI-11: a number token is exactly one decimal literal. The previous
// tokenizer kept parseFloat's valid PREFIX of a run like `1.2.3`, so the
// keypad confirmed 1.2 into a touch-off target.
describe("evaluate — number tokens", () => {
  it("refuses multi-dot runs instead of taking a prefix", () => {
    expect(evaluate("1.2.3")).toBeNull();
    expect(evaluate("0..5")).toBeNull();
    expect(evaluate("1..2+5")).toBeNull();
    expect(evaluate("5..")).toBeNull();
  });
  it("accepts ordinary decimals and expressions", () => {
    expect(evaluate("1.2+3")).toBeCloseTo(4.2, 9);
    expect(evaluate(".5")).toBe(0.5);
    expect(evaluate("5.")).toBe(5);
    expect(evaluate("-(2+3)*4")).toBe(-20);
    expect(evaluate("10/4")).toBe(2.5);
  });
  it("refuses division by zero, unbalanced parens and junk", () => {
    expect(evaluate("1/0")).toBeNull();
    expect(evaluate("(1+")).toBeNull();
    expect(evaluate("1+")).toBeNull();
    expect(evaluate("abc")).toBeNull();
    expect(evaluate("")).toBeNull();
  });
});

describe("validateEntry — field contract", () => {
  it("empty is 0, visibly, and still subject to constraints", () => {
    expect(validateEntry("")).toEqual({ value: 0 });
    expect(validateEntry("", { min: 1 })).toEqual({ value: null, reason: "minimum 1" });
  });
  it("min / max refuse without clamping", () => {
    expect(validateEntry("0", { min: 1 })).toEqual({ value: null, reason: "minimum 1" });
    expect(validateEntry("12", { max: 10 })).toEqual({ value: null, reason: "maximum 10" });
    expect(validateEntry("-5")).toEqual({ value: -5 });      // negative allowed without min
    expect(validateEntry("-5", { min: 0 }).value).toBeNull();
  });
  it("integer fields refuse fractions", () => {
    expect(validateEntry("2.5", { integer: true })).toEqual({ value: null, reason: "whole number required" });
    expect(validateEntry("3*2", { integer: true })).toEqual({ value: 6 });
  });
  it("an invalid expression and a lost target are refused with a reason", () => {
    expect(validateEntry("1.2.3").value).toBeNull();
    expect(validateEntry("1.2.3").reason).toBe("invalid expression");
    expect(validateEntry("1", undefined, false)).toEqual({ value: null, reason: "target no longer available" });
  });
});
