import { describe, expect, it, vi } from "vitest";
import {
  API_VERSION,
  assertDevelopmentStore,
  configFromEnv,
  createAdminClient,
  normalizeStore,
} from "../../app/lib/shopify/adminClient";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("normalizeStore", () => {
  it("accepterer kun *.myshopify.com", () => {
    expect(normalizeStore("https://Test-Butik.myshopify.com/admin")).toBe("test-butik.myshopify.com");
    expect(() => normalizeStore("www.lalatoto.dk")).toThrow();
    expect(() => normalizeStore("evil.com/x.myshopify.com")).toThrow();
  });
});

describe("configFromEnv", () => {
  it("kræver butik og enten token eller appnøgler", () => {
    expect(() => configFromEnv({})).toThrow(/SHOPIFY_STORE/);
    expect(() => configFromEnv({ SHOPIFY_STORE: "a.myshopify.com" })).toThrow();
    expect(configFromEnv({ SHOPIFY_STORE: "a.myshopify.com", SHOPIFY_ADMIN_TOKEN: "t" }).accessToken).toBe("t");
  });
});

describe("createAdminClient", () => {
  it("henter token med client credentials én gang og genbruger det", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/admin/oauth/access_token")) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("grant_type")).toBe("client_credentials");
        return jsonResponse({ access_token: "tok", scope: "write_products", expires_in: 86399 });
      }
      expect(u).toBe(`https://a.myshopify.com/admin/api/${API_VERSION}/graphql.json`);
      expect((init?.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("tok");
      return jsonResponse({ data: { ok: true } });
    });
    const client = createAdminClient({ store: "a.myshopify.com", clientId: "id", clientSecret: "secret", fetchImpl: fetchImpl as any });
    await client.graphql("{ shop { name } }");
    await client.graphql("{ shop { name } }");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(client.grantedScopes).toBe("write_products");
  });

  it("kaster ved GraphQL-fejl i stedet for at returnere halve data", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: [{ message: "Access denied" }] }));
    const client = createAdminClient({ store: "a.myshopify.com", accessToken: "t", fetchImpl: fetchImpl as any });
    await expect(client.graphql("{ x }")).rejects.toThrow(/GraphQL/);
  });
});

describe("assertDevelopmentStore", () => {
  it("nægter at køre mod en rigtig butik", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { shop: { name: "Lalatoto", myshopifyDomain: "x.myshopify.com", currencyCode: "DKK", plan: { partnerDevelopment: false } } } }),
    );
    const client = createAdminClient({ store: "x.myshopify.com", accessToken: "t", fetchImpl: fetchImpl as any });
    await expect(assertDevelopmentStore(client)).rejects.toThrow(/ikke en udviklingsbutik/);
  });
});
