import { describe, expect, it } from "vitest";
import { handleOrderSourceRequest, orderGid } from "../../base44/shared/server/orderSourceHandler.ts";
import type { Graphql } from "../../app/lib/preorder/cancelService";
import { CLIENT_ID, GOOD_PAYLOAD, NOW, SECRET, SHOP, sign } from "../helpers/jwt";

const env = { store: SHOP, clientId: CLIENT_ID, clientSecret: SECRET };
const ORDER = "gid://shopify/Order/1001";

/** Falsk Shopify med én ordre, oprettet `ageMinutes` minutter før NOW. */
function fakeShopify(opts: { ageMinutes?: number; tags?: string[]; exists?: boolean } = {}) {
  const calls: { name: string; variables: any }[] = [];
  const graphql: Graphql = async (query, variables) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?";
    calls.push({ name, variables });
    if (name === "KildeOrdre") {
      if (opts.exists === false) return { order: null } as any;
      const createdAt = new Date(NOW.getTime() - (opts.ageMinutes ?? 2) * 60_000).toISOString();
      return { order: { id: ORDER, createdAt, tags: opts.tags ?? [] } } as any;
    }
    if (name === "KildeTag") return { tagsAdd: { userErrors: [] } } as any;
    if (name === "KildeTekst") return { metafieldsSet: { userErrors: [] } } as any;
    throw new Error(name);
  };
  return { graphql, calls };
}

function request(body: unknown, token = sign(GOOD_PAYLOAD)) {
  return new Request("https://example.base44.app/api/apps/x/functions/orderSource", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const run = (body: unknown, shop = fakeShopify(), token?: string) =>
  handleOrderSourceRequest(request(body, token), { env, graphql: shop.graphql, now: NOW });

describe("orderGid", () => {
  it("omskriver takkesidens OrderIdentity til Admin API'ets Order", () => {
    expect(orderGid("gid://shopify/OrderIdentity/1001")).toBe(ORDER);
    expect(orderGid(ORDER)).toBe(ORDER);
    expect(orderGid("gid://shopify/Customer/1")).toBeNull();
    expect(orderGid("1001")).toBeNull();
  });
});

describe("handleOrderSourceRequest", () => {
  it("svarer på browserens forhåndsforespørgsel", async () => {
    const res = await handleOrderSourceRequest(new Request("https://x", { method: "OPTIONS" }), {
      env,
      graphql: fakeShopify().graphql,
    });
    expect(res.status).toBe(204);
  });

  it("tagger ordren med kilden", async () => {
    const shop = fakeShopify();
    const res = await run({ orderId: "gid://shopify/OrderIdentity/1001", source: "instagram" }, shop);
    expect(await res.json()).toEqual({ ok: true });
    expect(shop.calls.find((c) => c.name === "KildeTag")?.variables).toEqual({ id: ORDER, tags: ["kilde-instagram"] });
    expect(shop.calls.map((c) => c.name)).not.toContain("KildeTekst");
  });

  it("gemmer kundens egen tekst ved «Andet»", async () => {
    const shop = fakeShopify();
    await run({ orderId: ORDER, source: "andet", other: "  Min   jordemoder  " }, shop);
    const meta = shop.calls.find((c) => c.name === "KildeTekst")?.variables.metafields[0];
    expect(meta).toMatchObject({ ownerId: ORDER, namespace: "lalatoto", key: "kilde", value: "Min jordemoder" });
  });

  it("afviser uden gyldigt token og spørger ikke Shopify", async () => {
    const shop = fakeShopify();
    const res = await run({ orderId: ORDER, source: "google" }, shop, sign(GOOD_PAYLOAD, { secret: "forkert" }));
    expect(res.status).toBe(401);
    expect(shop.calls).toHaveLength(0);
  });

  it("afviser ukendte svar", async () => {
    const shop = fakeShopify();
    const res = await run({ orderId: ORDER, source: "vip" }, shop);
    expect(res.status).toBe(400);
    expect(shop.calls).toHaveLength(0);
  });

  it("rører ikke ordrer, der er over to timer gamle", async () => {
    const shop = fakeShopify({ ageMinutes: 121 });
    const res = await run({ orderId: ORDER, source: "google" }, shop);
    expect(res.status).toBe(409);
    expect(shop.calls.map((c) => c.name)).toEqual(["KildeOrdre"]);
  });

  it("overskriver ikke et svar, der allerede er givet", async () => {
    const shop = fakeShopify({ tags: ["kilde-facebook"] });
    const res = await run({ orderId: ORDER, source: "google" }, shop);
    expect(await res.json()).toEqual({ ok: true });
    expect(shop.calls.map((c) => c.name)).toEqual(["KildeOrdre"]);
  });

  it("svarer 404, når ordren ikke findes", async () => {
    const res = await run({ orderId: ORDER, source: "google" }, fakeShopify({ exists: false }));
    expect(res.status).toBe(404);
  });
});
