import { describe, expect, it } from "vitest";
import { danishDayKey, reminderEmail, rowsDueIn, runReminderJob } from "../../base44/shared/server/reminderJob.ts";
import type { PreorderRow } from "../../base44/shared/server/dashboard.ts";
import type { Graphql } from "../../app/lib/preorder/cancelService";

// 5. november kl. 8 dansk tid; forfald 12. november kl. 9 dansk tid.
const now = new Date("2026-11-05T07:00:00Z");
const due = "2026-11-12T08:00:00Z";

function row(overrides: Partial<PreorderRow> = {}): PreorderRow {
  return {
    orderId: "gid://shopify/Order/1",
    orderNumber: "#1001",
    adminUrl: "https://admin.shopify.com/store/felt-post/orders/1",
    createdAt: "2026-10-13T10:00:00Z",
    status: "afventer betaling",
    fulfillment: "UNFULFILLED",
    customer: { name: "Anna <A&B>", email: "anna@example.com", phone: null },
    shippingAddress: null,
    items: ["1 × Barnevogn"],
    lines: [],
    total: "548.00",
    received: "0.00",
    outstanding: "548.00",
    currency: "DKK",
    dueAt: due,
    lastAttempt: null,
    ...overrides,
  };
}

describe("danishDayKey", () => {
  it("bruger dansk kalenderdag, ikke UTC", () => {
    // 23.30 UTC den 11. er allerede den 12. i København.
    expect(danishDayKey(new Date("2026-11-11T23:30:00Z"))).toBe("2026-11-12");
  });
});

describe("rowsDueIn", () => {
  it("tager kun ubetalte ordrer, der forfalder på dagen om 7 dage", () => {
    const rows = [
      row(),
      row({ orderNumber: "#1002", dueAt: "2026-11-13T08:00:00Z" }),
      row({ orderNumber: "#1003", status: "annulleret" }),
      row({ orderNumber: "#1004", status: "betalt" }),
      row({ orderNumber: "#1005", dueAt: null }),
    ];
    expect(rowsDueIn(rows, now, 7).map((r) => r.orderNumber)).toEqual(["#1001"]);
  });
});

describe("reminderEmail", () => {
  it("giver null, når der ingen ordrer er", () => {
    expect(reminderEmail([], 7)).toBeNull();
  });

  it("samler ordrerne i én mail med link, beløb og escapet kundenavn", () => {
    const email = reminderEmail([row(), row({ orderNumber: "#1002", outstanding: "100.00" })], 7)!;
    expect(email.subject).toBe("2 forudbestillinger forfalder 12. november 2026");
    expect(email.body).toContain("i alt 648.00 DKK");
    expect(email.body).toContain('href="https://admin.shopify.com/store/felt-post/orders/1"');
    expect(email.body).toContain("Anna &lt;A&amp;B&gt;");
    expect(email.body).not.toContain("<A&B>");
  });

  it("nævner ordrenummeret i emnet, når der kun er én", () => {
    expect(reminderEmail([row()], 7)!.subject).toBe("Forudbestilling #1001 forfalder 12. november 2026");
  });
});

describe("runReminderJob", () => {
  it("henter forudbestillingerne fra Shopify og bygger mailen", async () => {
    const graphql: Graphql = async () =>
      ({
        orders: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "gid://shopify/Order/1",
              name: "#1001",
              createdAt: "2026-10-13T10:00:00Z",
              cancelledAt: null,
              displayFinancialStatus: "PENDING",
              displayFulfillmentStatus: "UNFULFILLED",
              totalPriceSet: { shopMoney: { amount: "548.0", currencyCode: "DKK" } },
              totalReceivedSet: { shopMoney: { amount: "0.0", currencyCode: "DKK" } },
              totalOutstandingSet: { shopMoney: { amount: "548.0", currencyCode: "DKK" } },
              customer: { id: "c", displayName: "Anna", email: "anna@example.com", phone: null },
              shippingAddress: null,
              lineItems: { nodes: [{ title: "Barnevogn", quantity: 1, sellingPlan: { sellingPlanId: "p", name: "Forudbestilling" } }] },
              paymentTerms: { paymentSchedules: { nodes: [{ id: "s", dueAt: due, completedAt: null, balanceDue: { amount: "548.0", currencyCode: "DKK" } }] } },
            },
          ],
        },
      }) as any;
    const { rows, email } = await runReminderJob({ graphql, store: "felt-post.myshopify.com", now });
    expect(rows.map((r) => r.orderNumber)).toEqual(["#1001"]);
    expect(email?.subject).toBe("Forudbestilling #1001 forfalder 12. november 2026");
  });
});
