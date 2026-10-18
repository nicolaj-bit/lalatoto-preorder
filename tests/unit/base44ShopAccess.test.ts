import { describe, expect, it } from "vitest";
import { createShopifyGraphql, exchangeIdToken, type TokenStore } from "../../base44/shared/server/shopify.ts";

const env = { store: "lalatoto.myshopify.com", clientId: "id", clientSecret: "hemmelig" };

function fakeFetch(handler: (url: string, body: any, headers: any) => unknown, status = 200) {
  const calls: Array<{ url: string; body: any; headers: any }> = [];
  const f: any = async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, headers: init?.headers });
    return new Response(JSON.stringify(handler(url, body, init?.headers)), { status });
  };
  return { f, calls };
}

describe("exchangeIdToken", () => {
  it("bytter ID tokenet til et offline-token", async () => {
    const { f, calls } = fakeFetch(() => ({ access_token: "shpat_x", scope: "read_orders" }));
    expect(await exchangeIdToken(env, "id.token.her", f)).toEqual({ accessToken: "shpat_x", scope: "read_orders" });
    expect(calls[0].url).toBe("https://lalatoto.myshopify.com/admin/oauth/access_token");
    expect(calls[0].body).toMatchObject({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "id.token.her",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    });
  });

  it("melder fejl uden at vise hemmeligheden", async () => {
    const { f } = fakeFetch(() => ({ error: "invalid_subject_token" }), 400);
    await expect(exchangeIdToken(env, "x", f)).rejects.toThrow("invalid_subject_token");
    await expect(exchangeIdToken(env, "x", f)).rejects.not.toThrow("hemmelig");
  });
});

describe("createShopifyGraphql", () => {
  it("bruger det gemte offline-token og henter ikke et nyt", async () => {
    const store: TokenStore = { get: async () => "shpat_gemt", set: async () => {} };
    const { f, calls } = fakeFetch(() => ({ data: { shop: { name: "Lalatoto" } } }));
    expect(await createShopifyGraphql(env, f, store)("{ shop { name } }")).toEqual({ shop: { name: "Lalatoto" } });
    expect(calls.map((c) => c.url)).toEqual(["https://lalatoto.myshopify.com/admin/api/2026-04/graphql.json"]);
    expect(calls[0].headers["X-Shopify-Access-Token"]).toBe("shpat_gemt");
  });

  it("falder tilbage til client credentials uden gemt token", async () => {
    const store: TokenStore = { get: async () => null, set: async () => {} };
    const { f, calls } = fakeFetch((url) => (url.endsWith("access_token") ? { access_token: "cc" } : { data: {} }));
    await createShopifyGraphql(env, f, store)("{ shop { name } }");
    expect(calls[0].body.grant_type).toBe("client_credentials");
    expect(calls[1].headers["X-Shopify-Access-Token"]).toBe("cc");
  });
});
