import { describe, expect, it } from "vitest";
import {
  createShopifyGraphql,
  exchangeIdToken,
  needsTokenExchange,
  usableToken,
  type StoredToken,
  type TokenStore,
} from "../../base44/shared/server/shopify.ts";

const env = { store: "lalatoto.myshopify.com", clientId: "id", clientSecret: "hemmelig" };
const NOW = Date.parse("2026-11-09T12:00:00Z");
const TOKEN_URL = "https://lalatoto.myshopify.com/admin/oauth/access_token";

function parseBody(body: unknown) {
  if (typeof body !== "string") return null;
  try {
    return JSON.parse(body);
  } catch {
    return Object.fromEntries(new URLSearchParams(body));
  }
}

function fakeFetch(handler: (url: string, body: any, headers: any) => unknown, status: number | ((url: string) => number) = 200) {
  const calls: Array<{ url: string; body: any; headers: any }> = [];
  const f: any = async (url: string, init: any) => {
    const body = parseBody(init?.body);
    calls.push({ url, body, headers: init?.headers });
    const code = typeof status === "function" ? status(url) : status;
    return new Response(JSON.stringify(handler(url, body, init?.headers)), { status: code });
  };
  return { f, calls };
}

function memoryStore(initial: StoredToken | null) {
  const state = { token: initial, sets: 0, cleared: false };
  const store: TokenStore = {
    get: async () => state.token,
    set: async (_shop, token) => {
      state.token = token;
      state.sets++;
    },
    clear: async () => {
      state.token = null;
      state.cleared = true;
    },
  };
  return { store, state };
}

const EXPIRING = { access_token: "shpat_ny", scope: "read_orders", expires_in: 3600, refresh_token: "shprt_ny", refresh_token_expires_in: 7776000 };

describe("exchangeIdToken", () => {
  it("bytter ID tokenet til et offline-token med udløb", async () => {
    const { f, calls } = fakeFetch(() => EXPIRING);
    const token = await exchangeIdToken(env, "id.token.her", f);
    expect(token.accessToken).toBe("shpat_ny");
    expect(token.refreshToken).toBe("shprt_ny");
    expect(calls[0].url).toBe(TOKEN_URL);
    expect(calls[0].body).toMatchObject({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "id.token.her",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
      expiring: "1",
    });
  });

  it("melder fejl uden at vise hemmeligheden", async () => {
    const { f } = fakeFetch(() => ({ error: "invalid_subject_token" }), 400);
    await expect(exchangeIdToken(env, "x", f)).rejects.toThrow("invalid_subject_token");
    await expect(exchangeIdToken(env, "x", f)).rejects.not.toThrow("hemmelig");
  });
});

describe("needsTokenExchange", () => {
  it("henter kun nyt token, når der ikke er et brugbart", () => {
    expect(needsTokenExchange(null, NOW)).toBe(true);
    expect(needsTokenExchange({ accessToken: "gammel", scope: "" }, NOW)).toBe(true);
    const fresh = { accessToken: "a", scope: "", refreshToken: "r", refreshExpiresAt: new Date(NOW + 80 * 864e5).toISOString() };
    expect(needsTokenExchange(fresh, NOW)).toBe(false);
    expect(needsTokenExchange({ ...fresh, refreshExpiresAt: new Date(NOW + 10 * 864e5).toISOString() }, NOW)).toBe(true);
  });
});

describe("usableToken", () => {
  const valid: StoredToken = {
    accessToken: "shpat_gyldig",
    scope: "",
    refreshToken: "shprt_gammel",
    expiresAt: new Date(NOW + 30 * 60e3).toISOString(),
    refreshExpiresAt: new Date(NOW + 80 * 864e5).toISOString(),
  };

  it("bruger et token, der stadig gælder, uden at spørge Shopify", async () => {
    const { store } = memoryStore(valid);
    const { f, calls } = fakeFetch(() => ({}));
    expect(await usableToken(env, store, valid, f, NOW)).toBe("shpat_gyldig");
    expect(calls).toHaveLength(0);
  });

  it("fornyer et token, der er ved at udløbe, og gemmer det nye refresh-token", async () => {
    const expiring = { ...valid, expiresAt: new Date(NOW + 60e3).toISOString() };
    const { store, state } = memoryStore(expiring);
    const { f, calls } = fakeFetch(() => EXPIRING);
    expect(await usableToken(env, store, expiring, f, NOW)).toBe("shpat_ny");
    expect(calls[0].body).toMatchObject({ grant_type: "refresh_token", refresh_token: "shprt_gammel" });
    expect(state.token?.refreshToken).toBe("shprt_ny");
  });

  it("bytter et gammelt token uden udløb til et med udløb", async () => {
    const old = { accessToken: "shpat_gammel", scope: "read_orders" };
    const { store, state } = memoryStore(old);
    const { f, calls } = fakeFetch(() => EXPIRING);
    expect(await usableToken(env, store, old, f, NOW)).toBe("shpat_ny");
    expect(calls[0].body).toMatchObject({
      subject_token: "shpat_gammel",
      subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
      expiring: "1",
    });
    expect(state.token?.refreshToken).toBe("shprt_ny");
  });

  it("beholder det gamle token, hvis skiftet mislykkes", async () => {
    const old = { accessToken: "shpat_gammel", scope: "" };
    const { store, state } = memoryStore(old);
    const { f } = fakeFetch(() => ({ error: "server" }), 500);
    expect(await usableToken(env, store, old, f, NOW)).toBe("shpat_gammel");
    expect(state.token).toBe(old);
  });

  it("sletter tokenet og beder om at åbne dashboardet, når Shopify afviser refresh-tokenet", async () => {
    const expired = { ...valid, expiresAt: new Date(NOW - 60e3).toISOString() };
    const { store, state } = memoryStore(expired);
    const { f } = fakeFetch(() => ({ error: "invalid_grant" }), 401);
    await expect(usableToken(env, store, expired, f, NOW)).rejects.toThrow("Åbn dashboardet");
    expect(state.cleared).toBe(true);
  });

  it("bruger det gamle token ved en midlertidig fejl, så længe det gælder", async () => {
    const soon = { ...valid, expiresAt: new Date(NOW + 60e3).toISOString() };
    const { store, state } = memoryStore(soon);
    const { f } = fakeFetch(() => ({ error: "server" }), 503);
    expect(await usableToken(env, store, soon, f, NOW)).toBe("shpat_gyldig");
    expect(state.cleared).toBe(false);
  });
});

describe("createShopifyGraphql", () => {
  it("bruger det gemte offline-token og henter ikke et nyt", async () => {
    const { store } = memoryStore({
      accessToken: "shpat_gemt",
      scope: "",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 3600e3).toISOString(),
    });
    const { f, calls } = fakeFetch(() => ({ data: { shop: { name: "Lalatoto" } } }));
    expect(await createShopifyGraphql(env, f, store)("{ shop { name } }")).toEqual({ shop: { name: "Lalatoto" } });
    expect(calls.map((c) => c.url)).toEqual(["https://lalatoto.myshopify.com/admin/api/2026-04/graphql.json"]);
    expect(calls[0].headers["X-Shopify-Access-Token"]).toBe("shpat_gemt");
  });

  it("falder tilbage til client credentials uden gemt token", async () => {
    const { store } = memoryStore(null);
    const { f, calls } = fakeFetch((url) => (url.endsWith("access_token") ? { access_token: "cc" } : { data: {} }));
    await createShopifyGraphql(env, f, store)("{ shop { name } }");
    expect(calls[0].body.grant_type).toBe("client_credentials");
    expect(calls[1].headers["X-Shopify-Access-Token"]).toBe("cc");
  });
});
