import { describe, expect, it } from "vitest";
import { decideCancel, sellingPlanIds, type CancelOrder } from "../../app/lib/preorder/cancel";

// En forudbestilling før afsendelse, som felt-posts #1001 så ud efter checkout.
// Tallene er testdata, ikke målinger.
const CUSTOMER = "gid://shopify/Customer/42";
const PLAN = "gid://shopify/SellingPlan/691307512150";

function order(overrides: Partial<CancelOrder> = {}): CancelOrder {
  return {
    id: "gid://shopify/Order/1001",
    name: "#1001",
    cancelledAt: null,
    displayFulfillmentStatus: "SCHEDULED",
    customer: { id: CUSTOMER },
    totalReceivedSet: { shopMoney: { amount: "0.0", currencyCode: "DKK" } },
    paymentTerms: { id: "gid://shopify/PaymentTerms/77" },
    lineItems: { nodes: [{ sellingPlan: { sellingPlanId: PLAN } }] },
    ...overrides,
  };
}

const opts = { customerId: CUSTOMER, preorderPlanIds: new Set([PLAN]) };

describe("decideCancel", () => {
  it("annullerer en ubetalt forudbestilling uden refusion", () => {
    const d = decideCancel(order(), opts);
    expect(d).toEqual({
      ok: true,
      input: {
        orderId: "gid://shopify/Order/1001",
        reason: "CUSTOMER",
        restock: true,
        notifyCustomer: true,
        staffNote: "Annulleret af kunden i kundekontoen (Lalatoto Forudbestilling)",
      },
      refunds: false,
    });
  });

  it("giver pengene tilbage, når restbeløbet allerede er trukket", () => {
    const d = decideCancel(order({ totalReceivedSet: { shopMoney: { amount: "548.0", currencyCode: "DKK" } } }), opts);
    expect(d.ok && d.input.refundMethod).toEqual({ originalPaymentMethodsRefund: true });
    expect(d.ok && d.refunds).toBe(true);
  });

  it("nægter en anden kundes ordre", () => {
    expect(decideCancel(order(), { ...opts, customerId: "gid://shopify/Customer/99" })).toMatchObject({
      ok: false,
      reason: "NOT_OWNER",
    });
  });

  it("nægter uden kunde-id, også når ordren heller ingen kunde har", () => {
    expect(decideCancel(order({ customer: null }), { ...opts, customerId: undefined })).toMatchObject({
      ok: false,
      reason: "NOT_OWNER",
    });
  });

  it("nægter en almindelig ordre uden forudbestillingsplan", () => {
    expect(decideCancel(order({ paymentTerms: null }), opts)).toMatchObject({ ok: false, reason: "NOT_PREORDER" });
    expect(
      decideCancel(order({ lineItems: { nodes: [{ sellingPlan: null }] } }), opts),
    ).toMatchObject({ ok: false, reason: "NOT_PREORDER" });
  });

  it("nægter, når planen ikke er en PRE_ORDER-plan (fx et abonnement)", () => {
    expect(decideCancel(order(), { ...opts, preorderPlanIds: new Set() })).toMatchObject({
      ok: false,
      reason: "NOT_PREORDER",
    });
  });

  it("nægter en ordre, der allerede er annulleret", () => {
    expect(decideCancel(order({ cancelledAt: "2026-10-20T10:00:00Z" }), opts)).toMatchObject({
      ok: false,
      reason: "ALREADY_CANCELLED",
    });
  });

  it("nægter, når varen er sendt eller på vej", () => {
    for (const status of ["FULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS"]) {
      expect(decideCancel(order({ displayFulfillmentStatus: status }), opts)).toMatchObject({
        ok: false,
        reason: "FULFILLED",
      });
    }
  });

  it("tillader annullering, mens varen venter på afsendelse", () => {
    for (const status of ["SCHEDULED", "UNFULFILLED", "ON_HOLD"]) {
      expect(decideCancel(order({ displayFulfillmentStatus: status }), opts).ok).toBe(true);
    }
  });

  it("melder en ordre, der ikke findes", () => {
    expect(decideCancel(null, opts)).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });
});

describe("sellingPlanIds", () => {
  it("giver hver plan én gang og springer linjer uden plan over", () => {
    const o = order({
      lineItems: {
        nodes: [
          { sellingPlan: { sellingPlanId: PLAN } },
          { sellingPlan: null },
          { sellingPlan: { sellingPlanId: PLAN } },
          { sellingPlan: { sellingPlanId: null } },
        ],
      },
    });
    expect(sellingPlanIds(o)).toEqual([PLAN]);
  });
});
