import { describe, expect, it } from "vitest";
import { createPreorder, isOwnGroup, preorderInfo, summarizeGroups } from "../../app/lib/preorder/catalog";
import type { Graphql } from "../../app/lib/preorder/cancelService";

const now = new Date("2026-10-14T12:00:00Z");
const PRODUCT = "gid://shopify/Product/5";

function group(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/SellingPlanGroup/1",
    appId: "lalatoto-preorder",
    merchantCode: "lalatoto-preorder-5-1",
    products: { nodes: [{ id: PRODUCT, title: "Bodystocking", handle: "body", requiresSellingPlan: true }] },
    sellingPlans: {
      nodes: [
        {
          id: "gid://shopify/SellingPlan/9",
          category: "PRE_ORDER",
          billingPolicy: {
            checkoutCharge: { type: "PERCENTAGE", value: { percentage: 0 } },
            remainingBalanceChargeExactTime: "2026-12-15T08:00:00Z",
          },
        },
      ],
    },
    ...overrides,
  } as any;
}

describe("summarizeGroups", () => {
  it("viser appens forudbestillinger med dato og depositum", () => {
    expect(summarizeGroups([group()])).toEqual([
      {
        groupId: "gid://shopify/SellingPlanGroup/1",
        sellingPlanId: "gid://shopify/SellingPlan/9",
        chargeAt: "2026-12-15T08:00:00Z",
        depositPercent: 0,
        products: [{ id: PRODUCT, title: "Bodystocking", handle: "body", requiresSellingPlan: true }],
      },
    ]);
  });

  it("springer andre apps' grupper og grupper uden PRE_ORDER-plan over", () => {
    const other = group({ appId: "abonnement-app", merchantCode: "sub-1" });
    const subscription = group({
      sellingPlans: { nodes: [{ id: "x", category: "SUBSCRIPTION", billingPolicy: null }] },
    });
    expect(summarizeGroups([other, subscription])).toEqual([]);
  });

  it("genkender gruppen fra beviset, som ikke har appId", () => {
    expect(isOwnGroup({ appId: null, merchantCode: "lalatoto-preorder-1791902901723" })).toBe(true);
  });
});

describe("preorderInfo", () => {
  it("gemmer datoen både som tidspunkt og som dansk tekst til temaet", () => {
    expect(preorderInfo(new Date("2026-12-15T08:00:00Z"), 0, "gid://shopify/SellingPlan/9")).toEqual({
      sellingPlanId: "gid://shopify/SellingPlan/9",
      chargeAt: "2026-12-15T08:00:00.000Z",
      chargeDateText: "15. december 2026",
      depositPercent: 0,
    });
  });
});

/** Falsk Shopify: svarer ud fra operationens navn og kan få et trin til at fejle. */
function fakeShopify(failAt?: string) {
  const calls: string[] = [];
  const graphql: Graphql = async (query) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?";
    calls.push(name);
    const errors = failAt === name ? [{ message: "Shopify sagde nej" }] : [];
    switch (name) {
      case "OpretForudbestillingsplan":
        return {
          sellingPlanGroupCreate: {
            sellingPlanGroup: errors.length ? null : { id: "gid://shopify/SellingPlanGroup/1", sellingPlans: { nodes: [{ id: "gid://shopify/SellingPlan/9" }] } },
            userErrors: errors,
          },
        } as any;
      case "ForudbestillingPaaProdukt":
        return { productUpdate: { product: { id: PRODUCT }, userErrors: errors } } as any;
      case "GemMetafelter":
        return { metafieldsSet: { metafields: [], userErrors: errors } } as any;
      case "SletMetafelter":
        return { metafieldsDelete: { deletedMetafields: [], userErrors: [] } } as any;
      case "SletForudbestillingsplan":
        return { sellingPlanGroupDelete: { deletedSellingPlanGroupId: "x", userErrors: [] } } as any;
      default:
        throw new Error(`Uventet kald: ${name}`);
    }
  };
  return { graphql, calls };
}

describe("createPreorder", () => {
  it("opretter plan, låser produktet og gemmer datoen", async () => {
    const s = fakeShopify();
    const r = await createPreorder(s.graphql, { productId: PRODUCT, chargeDate: "2026-12-15", now });
    expect(r).toEqual({
      ok: true,
      groupId: "gid://shopify/SellingPlanGroup/1",
      sellingPlanId: "gid://shopify/SellingPlan/9",
      chargeAt: "2026-12-15T08:00:00.000Z",
    });
    expect(s.calls).toEqual(["OpretForudbestillingsplan", "ForudbestillingPaaProdukt", "GemMetafelter"]);
  });

  it("afviser en dato i fortiden og et manglende produkt uden at kalde Shopify", async () => {
    const s = fakeShopify();
    expect(await createPreorder(s.graphql, { productId: PRODUCT, chargeDate: "2026-10-01", now })).toMatchObject({ ok: false });
    expect(await createPreorder(s.graphql, { productId: "", chargeDate: "2026-12-15", now })).toMatchObject({ ok: false });
    expect(await createPreorder(s.graphql, { productId: PRODUCT, chargeDate: "15-12-2026", now })).toMatchObject({ ok: false });
    expect(s.calls).toEqual([]);
  });

  it("melder Shopifys fejl, når planen ikke kan oprettes", async () => {
    const s = fakeShopify("OpretForudbestillingsplan");
    expect(await createPreorder(s.graphql, { productId: PRODUCT, chargeDate: "2026-12-15", now })).toEqual({
      ok: false,
      message: "Planen kunne ikke oprettes: Shopify sagde nej",
    });
  });

  it("rydder op, hvis produktet ikke kan låses, så der ikke står en halv forudbestilling", async () => {
    const s = fakeShopify("ForudbestillingPaaProdukt");
    const r = await createPreorder(s.graphql, { productId: PRODUCT, chargeDate: "2026-12-15", now });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("låses") });
    expect(s.calls).toContain("SletForudbestillingsplan");
  });
});
