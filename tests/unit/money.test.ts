import { describe, expect, it } from "vitest";
import { fromMinor, splitCheckoutCharge, toMinor } from "../../app/lib/preorder/money";

describe("toMinor / fromMinor", () => {
  it("omregner Shopifys decimal-strenge til øre og tilbage", () => {
    expect(toMinor("499.00")).toBe(49900);
    expect(toMinor("499.5")).toBe(49950);
    expect(toMinor("0.01")).toBe(1);
    expect(toMinor("0")).toBe(0);
    expect(fromMinor(49950)).toBe("499.50");
    expect(fromMinor(1)).toBe("0.01");
    expect(fromMinor(0)).toBe("0.00");
  });

  it("bevarer beløbet frem og tilbage", () => {
    for (const s of ["0.00", "0.10", "12.34", "100000.99"]) {
      expect(fromMinor(toMinor(s))).toBe(s);
    }
  });

  it("afviser beløb, der ikke kan være en pris", () => {
    for (const bad of ["", "-1.00", "1.234", "1,00", "abc", "1e3", " 1.00x"]) {
      expect(() => toMinor(bad)).toThrow();
    }
    expect(() => fromMinor(-1)).toThrow();
    expect(() => fromMinor(1.5)).toThrow();
  });
});

describe("splitCheckoutCharge", () => {
  it("0 % depositum: intet nu, alt senere (beviset)", () => {
    expect(splitCheckoutCharge(49900, 0)).toEqual({ dueNowMinor: 0, dueLaterMinor: 49900 });
  });

  it("delene summerer altid til totalen", () => {
    for (const total of [1, 99, 49900, 12345]) {
      for (const pct of [0, 1, 10, 33.33, 50, 99.99, 100]) {
        const { dueNowMinor, dueLaterMinor } = splitCheckoutCharge(total, pct);
        expect(dueNowMinor + dueLaterMinor).toBe(total);
        expect(dueNowMinor).toBeGreaterThanOrEqual(0);
        expect(dueLaterMinor).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("runder depositum ned, så kunden aldrig betaler for meget nu", () => {
    // 10 % af 9,99 kr. = 0,999 kr. → 0,99 kr. nu, 9,00 kr. senere
    expect(splitCheckoutCharge(999, 10)).toEqual({ dueNowMinor: 99, dueLaterMinor: 900 });
  });

  it("undgår kommatalsfejl ved skæve procentsatser", () => {
    // 0.1 + 0.2-agtige fejl ville give 3332 eller 3334 her.
    expect(splitCheckoutCharge(10000, 33.33).dueNowMinor).toBe(3333);
  });

  it("afviser procentsatser uden for 0–100", () => {
    expect(() => splitCheckoutCharge(100, -1)).toThrow();
    expect(() => splitCheckoutCharge(100, 101)).toThrow();
    expect(() => splitCheckoutCharge(100, Number.NaN)).toThrow();
  });
});
