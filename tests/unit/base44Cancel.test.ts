import { describe, expect, it } from "vitest";
import { handleCancelRequest } from "../../base44/shared/server/cancelHandler.ts";
import type { Graphql } from "../../app/lib/preorder/cancelService";
import { CLIENT_ID, GOOD_PAYLOAD, NOW, SECRET, SHOP, sign } from "../helpers/jwt";

const env = { store: SHOP, clientId: CLIENT_ID, clientSecret: SECRET };
const ORDER = "gid://shopify/Order/1001";
const PLAN = "gid://shopify/SellingPlan/7";

/** Falsk Shopify med én forudbestilling, der tilhører Customer/42. */
function fakeShopify() {
  const calls: string[] = [];
  const graphql: Graphql = async (query) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?";
    calls.push(name);
    if (name === "OrdreTilAnnullering") {
      return {
        order: {
          id: ORDER,
          cancelledAt: null,
          displayFulfillmentStatus: "SCHEDULED",
          customer: { id: "gid://shopify/Customer/42" },
          totalReceivedSet: { shopMoney: { amount: "0.0", currencyCode: "DKK" } },
          paymentTerms: { id: "gid://shopify/PaymentTerms/1" },
          lineItems: { nodes: [{ sellingPlan: { sellingPlanId: PLAN } }] },
        },
      } as any;
    }
    if (name === "AppensForudbestillingsplaner") {
      return {
        sellingPlanGroups: {
          nodes: [{ appId: "lalatoto-preorder", merchantCode: "lalatoto-preorder-1", sellingPlans: { nodes: [{ id: PLAN, category: "PRE_ORDER" }] } }],
        },
      } as any;
    }
    if (name === "AnnullerOrdre") return { orderCancel: { job: { id: "j", done: false }, orderCancelUserErrors: [] } } as any;
    throw new Error(name);
  };
  return { graphql, calls };
}

function request(body: unknown, token = sign(GOOD_PAYLOAD), method = "POST") {
  return new Request("https://example.base44.app/api/apps/x/functions/cancelPreorder", {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

describe("handleCancelRequest", () => {
  it("svarer på browserens forhåndsforespørgsel med CORS", async () => {
    const res = await handleCancelRequest(new Request("https://x", { method: "OPTIONS" }), { env, graphql: fakeShopify().graphql });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  it("siger ja til kundens egen forudbestilling", async () => {
    const res = await handleCancelRequest(request({ action: "check", orderId: ORDER }), { env, graphql: fakeShopify().graphql, now: NOW });
    expect(await res.json()).toEqual({ cancellable: true, refunds: false });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("annullerer og logger", async () => {
    const s = fakeShopify();
    const logged: unknown[] = [];
    const res = await handleCancelRequest(request({ action: "cancel", orderId: ORDER }), {
      env,
      graphql: s.graphql,
      now: NOW,
      log: (e) => void logged.push(e),
    });
    expect(await res.json()).toEqual({ ok: true, refunds: false });
    expect(s.calls).toContain("AnnullerOrdre");
    expect(logged).toEqual([{ orderId: ORDER, action: "cancel", ok: true, reason: undefined, refunds: false }]);
  });

  it("annullerer ikke en anden kundes ordre, selv med gyldigt token", async () => {
    const s = fakeShopify();
    const token = sign({ ...GOOD_PAYLOAD, sub: "gid://shopify/Customer/99" });
    const res = await handleCancelRequest(request({ action: "cancel", orderId: ORDER }, token), { env, graphql: s.graphql, now: NOW });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: "NOT_OWNER" });
    expect(s.calls).not.toContain("AnnullerOrdre");
  });

  it("afviser uden gyldigt token og kalder ikke Shopify", async () => {
    const s = fakeShopify();
    const res = await handleCancelRequest(request({ action: "cancel", orderId: ORDER }, "falsk.token.her"), { env, graphql: s.graphql, now: NOW });
    expect(res.status).toBe(401);
    expect(s.calls).toEqual([]);
  });

  it("ignorerer et kunde-id i forespørgslen", async () => {
    const s = fakeShopify();
    const token = sign({ ...GOOD_PAYLOAD, sub: undefined });
    const res = await handleCancelRequest(
      request({ action: "cancel", orderId: ORDER, customerId: "gid://shopify/Customer/42" }, token),
      { env, graphql: s.graphql, now: NOW },
    );
    expect(await res.json()).toEqual({ ok: false, reason: "NOT_OWNER" });
  });
});
