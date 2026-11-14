import { describe, expect, it } from "vitest";
import { ensureWelcomeDiscount } from "../../base44/shared/server/welcomeDiscount";

describe("ensureWelcomeDiscount", () => {
  it("opretter koden som app-rabat med rabatfunktionen, når den ikke findes", async () => {
    const calls: { query: string; variables: any }[] = [];
    const graphql = async (query: string, variables?: any) => {
      calls.push({ query, variables });
      if (query.includes("VelkomstFind")) return { codeDiscountNodeByCode: null };
      return { discountCodeAppCreate: { codeAppDiscount: { discountId: "gid://shopify/DiscountCodeNode/1", title: "Nyhedsbrev: VELKOMMEN15", status: "ACTIVE" }, userErrors: [] } };
    };
    const result = await ensureWelcomeDiscount(graphql as any, new Date("2026-11-14T12:00:00Z"));
    expect(result).toMatchObject({ ok: true, created: true, status: "ACTIVE" });
    const input = calls[1].variables.discount;
    expect(input).toMatchObject({
      code: "VELKOMMEN15",
      functionHandle: "nyhedsbrev-rabat",
      appliesOncePerCustomer: true,
      discountClasses: ["PRODUCT"],
      combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    });
  });

  it("opretter intet, når koden allerede findes", async () => {
    let creates = 0;
    const graphql = async (query: string) => {
      if (query.includes("VelkomstOpret")) creates++;
      return { codeDiscountNodeByCode: { id: "gid://shopify/DiscountCodeNode/9", codeDiscount: { __typename: "DiscountCodeApp", title: "x", status: "ACTIVE" } } };
    };
    const result = await ensureWelcomeDiscount(graphql as any);
    expect(result).toMatchObject({ ok: true, created: false, id: "gid://shopify/DiscountCodeNode/9" });
    expect(creates).toBe(0);
  });

  it("melder Shopifys fejl tilbage", async () => {
    const graphql = async (query: string) =>
      query.includes("VelkomstFind")
        ? { codeDiscountNodeByCode: null }
        : { discountCodeAppCreate: { codeAppDiscount: null, userErrors: [{ field: ["x"], message: "Adgang nægtet" }] } };
    expect(await ensureWelcomeDiscount(graphql as any)).toEqual({ ok: false, errors: [{ field: ["x"], message: "Adgang nægtet" }] });
  });
});
