import { describe, expect, it } from "vitest";
import { evaluateCancel, performCancel, type Graphql } from "../../app/lib/preorder/cancelService";
import type { CancelOrder } from "../../app/lib/preorder/cancel";

const CUSTOMER = "gid://shopify/Customer/42";
const PLAN = "gid://shopify/SellingPlan/7";
const ORDER_ID = "gid://shopify/Order/1001";

const preorder: CancelOrder = {
  id: ORDER_ID,
  cancelledAt: null,
  displayFulfillmentStatus: "SCHEDULED",
  customer: { id: CUSTOMER },
  totalReceivedSet: { shopMoney: { amount: "0.0", currencyCode: "DKK" } },
  paymentTerms: { id: "gid://shopify/PaymentTerms/1" },
  lineItems: { nodes: [{ sellingPlan: { sellingPlanId: PLAN } }] },
};

/** Et falsk Shopify, der svarer ud fra forespørgslens navn og husker kaldene. */
function fakeShopify(opts: { order?: CancelOrder | null; category?: string; cancelErrors?: string[] } = {}) {
  const calls: Array<{ name: string; variables?: Record<string, unknown> }> = [];
  const graphql: Graphql = async (query, variables) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?";
    calls.push({ name, variables });
    if (name === "OrdreTilAnnullering") return { order: opts.order === undefined ? preorder : opts.order } as any;
    if (name === "PlanKategorier") return { nodes: [{ id: PLAN, category: opts.category ?? "PRE_ORDER" }] } as any;
    if (name === "AnnullerOrdre") {
      return {
        orderCancel: {
          job: { id: "gid://shopify/Job/1", done: false },
          orderCancelUserErrors: (opts.cancelErrors ?? []).map((message) => ({ message })),
        },
      } as any;
    }
    throw new Error(`Uventet kald: ${name}`);
  };
  return { graphql, calls };
}

describe("evaluateCancel", () => {
  it("afviser et ordre-id, der ikke er et Shopify-gid, uden at kalde Shopify", async () => {
    const s = fakeShopify();
    expect(await evaluateCancel(s.graphql, "1001", CUSTOMER)).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    expect(await evaluateCancel(s.graphql, "gid://shopify/Customer/1", CUSTOMER)).toMatchObject({ ok: false });
    expect(s.calls).toEqual([]);
  });

  it("slår planens category op og godkender en forudbestilling", async () => {
    const s = fakeShopify();
    expect((await evaluateCancel(s.graphql, ORDER_ID, CUSTOMER)).ok).toBe(true);
    expect(s.calls.map((c) => c.name)).toEqual(["OrdreTilAnnullering", "PlanKategorier"]);
  });

  it("afviser en plan, der ikke er PRE_ORDER", async () => {
    const s = fakeShopify({ category: "SUBSCRIPTION" });
    expect(await evaluateCancel(s.graphql, ORDER_ID, CUSTOMER)).toMatchObject({ ok: false, reason: "NOT_PREORDER" });
  });
});

describe("performCancel", () => {
  it("annullerer, når alt er i orden", async () => {
    const s = fakeShopify();
    expect(await performCancel(s.graphql, ORDER_ID, CUSTOMER)).toEqual({
      ok: true,
      refunds: false,
      jobId: "gid://shopify/Job/1",
    });
    const cancel = s.calls.find((c) => c.name === "AnnullerOrdre");
    expect(cancel?.variables).toMatchObject({ orderId: ORDER_ID, reason: "CUSTOMER", notifyCustomer: true });
  });

  it("annullerer ikke en anden kundes ordre", async () => {
    const s = fakeShopify();
    expect(await performCancel(s.graphql, ORDER_ID, "gid://shopify/Customer/99")).toMatchObject({
      ok: false,
      reason: "NOT_OWNER",
    });
    expect(s.calls.some((c) => c.name === "AnnullerOrdre")).toBe(false);
  });

  it("giver Shopifys afvisning videre", async () => {
    const s = fakeShopify({ cancelErrors: ["Order has pending authorizations"] });
    expect(await performCancel(s.graphql, ORDER_ID, CUSTOMER)).toEqual({
      ok: false,
      reason: "SHOPIFY_ERROR",
      message: "Order has pending authorizations",
    });
  });
});
