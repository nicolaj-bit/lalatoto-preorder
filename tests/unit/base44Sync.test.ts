import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCES, TARGET_DIR, toDeno } from "../../scripts/base44-sync";
import { toRow, isPreorderOrder } from "../../base44/shared/server/dashboard.ts";

describe("Base44-kopierne", () => {
  it("er identiske med app/lib (kør npm run base44:sync, hvis denne fejler)", () => {
    for (const src of SOURCES) {
      const copy = readFileSync(`${TARGET_DIR}/${basename(src)}`, "utf8");
      expect(copy, `${TARGET_DIR}/${basename(src)}`).toBe(toDeno(readFileSync(src, "utf8")));
    }
  });

  it("får filendelser på relative imports, som Deno kræver", () => {
    expect(toDeno('import { a } from "./money";\nimport { b } from "../shopify/operations";')).toContain(
      'from "./money.ts";\nimport { b } from "./operations.ts";',
    );
  });
});

describe("dashboardets rækker", () => {
  const order = {
    id: "gid://shopify/Order/8234472341846",
    name: "#1001",
    createdAt: "2026-10-13T18:34:10Z",
    cancelledAt: null,
    displayFulfillmentStatus: "SCHEDULED",
    totalPriceSet: { shopMoney: { amount: "548.0", currencyCode: "DKK" } },
    totalReceivedSet: { shopMoney: { amount: "0.0", currencyCode: "DKK" } },
    totalOutstandingSet: { shopMoney: { amount: "548.0", currencyCode: "DKK" } },
    customer: { id: "c", displayName: "Testkunde", email: "kunde@example.com", phone: null },
    shippingAddress: { name: "Testkunde", address1: "Vej 1", address2: null, zip: "4200", city: "Slagelse", country: "Denmark", phone: "+4512345678" },
    lineItems: { nodes: [{ title: "Bodystocking", quantity: 1, sellingPlan: { sellingPlanId: "p", name: "Forudbestilling" } }] },
    paymentTerms: { paymentSchedules: { nodes: [{ id: "s", dueAt: "2026-11-12T08:00:00Z", completedAt: null, balanceDue: { amount: "548.0", currencyCode: "DKK" } }] } },
  };

  it("viser kunde, adresse, beløb og status — og intet om kortet", () => {
    const row = toRow(order, "felt-post.myshopify.com", new Date("2026-10-20T00:00:00Z"));
    expect(row).toMatchObject({
      orderNumber: "#1001",
      adminUrl: "https://admin.shopify.com/store/felt-post/orders/8234472341846",
      status: "afventer betaling",
      customer: { name: "Testkunde", email: "kunde@example.com", phone: "+4512345678" },
      shippingAddress: "Vej 1, 4200 Slagelse, Denmark",
      items: ["1 × Bodystocking"],
      outstanding: "548.00",
    });
    expect(JSON.stringify(row)).not.toMatch(/mandate|lastDigits|vaulted/i);
  });

  it("markerer forfaldne og betalte ordrer", () => {
    expect(toRow(order, "x.myshopify.com", new Date("2026-11-13T00:00:00Z")).status).toBe("forfalden");
    const paid = { ...order, totalOutstandingSet: { shopMoney: { amount: "0.0", currencyCode: "DKK" } } };
    expect(toRow(paid, "x.myshopify.com", new Date()).status).toBe("betalt");
  });

  it("tager kun ordrer med betalingsaftale og selling plan med", () => {
    expect(isPreorderOrder(order)).toBe(true);
    expect(isPreorderOrder({ ...order, paymentTerms: null })).toBe(false);
  });
});
