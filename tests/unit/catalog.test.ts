import { describe, expect, it } from "vitest";
import { changePreorderDate, createPreorder, isOwnGroup, preorderInfo, summarizeGroups } from "../../app/lib/preorder/catalog";
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

describe("changePreorderDate", () => {
  const PLAN = "gid://shopify/SellingPlan/9";
  const GROUP = "gid://shopify/SellingPlanGroup/1";

  function order(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id: `gid://shopify/Order/${id}`,
      name: `#${id}`,
      lineItems: { nodes: [{ sellingPlan: { sellingPlanId: PLAN } }] },
      paymentTerms: { id: `gid://shopify/PaymentTerms/${id}`, paymentSchedules: { nodes: [{ id: "s", dueAt: "2026-12-15T08:00:00Z", completedAt: null }] } },
      fulfillmentOrders: { nodes: [{ id: `gid://shopify/FulfillmentOrder/${id}`, status: "SCHEDULED", fulfillAt: "2026-12-15T08:00:00Z" }] },
      ...overrides,
    };
  }

  function fake(opts: { orders?: any[]; termsErrorFor?: string; planErrors?: string[] } = {}) {
    const calls: Array<{ name: string; variables?: any }> = [];
    const graphql: Graphql = async (query, variables) => {
      const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?";
      calls.push({ name, variables });
      switch (name) {
        case "NyDatoPaaForudbestilling":
          return { sellingPlanGroupUpdate: { sellingPlanGroup: { id: GROUP }, userErrors: (opts.planErrors ?? []).map((message) => ({ message })) } } as any;
        case "GemMetafelter":
          return { metafieldsSet: { metafields: [], userErrors: [] } } as any;
        case "AabneForudbestillinger":
          return { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: opts.orders ?? [] } } as any;
        case "FastDatoSkabelon":
          return { paymentTermsTemplates: [{ id: "gid://shopify/PaymentTermsTemplate/7" }] } as any;
        case "NyForfaldsdato": {
          const failing = opts.termsErrorFor && (variables as any)?.input.paymentTermsId.endsWith(`/${opts.termsErrorFor}`);
          return { paymentTermsUpdate: { paymentTerms: null, userErrors: failing ? [{ message: "Kan ikke ændres" }] : [] } } as any;
        }
        case "NyKlargoeringsdato":
          return { fulfillmentOrderReschedule: { fulfillmentOrder: { id: variables?.id }, userErrors: [] } } as any;
        default:
          throw new Error(`Uventet kald ${name}`);
      }
    };
    return { graphql, calls };
  }

  const base = { groupId: GROUP, sellingPlanId: PLAN, productIds: [PRODUCT], chargeDate: "2027-01-20", depositPercent: 0, now };

  it("flytter planen, produktets dato og lagte ordrer til kl. 9 dansk tid", async () => {
    const { graphql, calls } = fake({ orders: [order("1001")] });
    const result = await changePreorderDate(graphql, base);
    expect(result).toEqual({ ok: true, chargeAt: "2027-01-20T08:00:00.000Z", ordersMoved: ["#1001"], orderErrors: [] });

    const plan = calls.find((c) => c.name === "NyDatoPaaForudbestilling")!.variables;
    expect(plan.id).toBe(GROUP);
    expect(plan.input.sellingPlansToUpdate[0]).toMatchObject({
      id: PLAN,
      options: ["0 % nu, resten 20. januar 2027"],
      billingPolicy: { fixed: { checkoutCharge: { type: "PERCENTAGE", value: { percentage: 0 } }, remainingBalanceChargeExactTime: "2027-01-20T08:00:00.000Z" } },
      deliveryPolicy: { fixed: { fulfillmentExactTime: "2027-01-20T08:00:00.000Z" } },
    });
    const meta = JSON.parse(calls.find((c) => c.name === "GemMetafelter")!.variables.metafields[0].value);
    expect(meta.chargeDateText).toBe("20. januar 2027");
    expect(calls.find((c) => c.name === "NyForfaldsdato")!.variables.input).toEqual({
      paymentTermsId: "gid://shopify/PaymentTerms/1001",
      paymentTermsAttributes: { paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/7", paymentSchedules: [{ dueAt: "2027-01-20T08:00:00.000Z" }] },
    });
    expect(calls.find((c) => c.name === "NyKlargoeringsdato")!.variables).toEqual({
      id: "gid://shopify/FulfillmentOrder/1001",
      fulfillAt: "2027-01-20T08:00:00.000Z",
    });
  });

  it("rører ikke ordrer på andre planer eller med betalt restbeløb", async () => {
    const other = order("1002", { lineItems: { nodes: [{ sellingPlan: { sellingPlanId: "gid://shopify/SellingPlan/99" } }] } });
    const paid = order("1003", { paymentTerms: { id: "t", paymentSchedules: { nodes: [{ id: "s", dueAt: null, completedAt: "2026-12-15T08:05:00Z" }] } } });
    const { graphql, calls } = fake({ orders: [other, paid] });
    const result = await changePreorderDate(graphql, base);
    expect(result).toMatchObject({ ok: true, ordersMoved: [] });
    expect(calls.some((c) => c.name === "NyForfaldsdato" || c.name === "FastDatoSkabelon")).toBe(false);
  });

  it("fortsætter med de andre ordrer, når én ikke kan flyttes", async () => {
    const { graphql } = fake({ orders: [order("1001"), order("1004")], termsErrorFor: "1001" });
    const result = await changePreorderDate(graphql, base);
    expect(result).toMatchObject({ ok: true, ordersMoved: ["#1004"], orderErrors: ["#1001: forfaldsdatoen: Kan ikke ændres"] });
  });

  it("afviser en dato i fortiden uden at kalde Shopify", async () => {
    const { graphql, calls } = fake();
    const result = await changePreorderDate(graphql, { ...base, chargeDate: "2026-10-01" });
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("stopper, hvis planen ikke kan opdateres", async () => {
    const { graphql, calls } = fake({ planErrors: ["Ugyldig"] });
    expect(await changePreorderDate(graphql, base)).toEqual({ ok: false, message: "Planen kunne ikke opdateres: Ugyldig" });
    expect(calls.map((c) => c.name)).toEqual(["NyDatoPaaForudbestilling"]);
  });
});
