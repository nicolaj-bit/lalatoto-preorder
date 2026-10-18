// Adgang til butikkens Admin API fra Base44-funktionerne.
//
// To veje til et token:
//   1. Et gemt offline-token (entiteten ShopAccess). Det hentes med token
//      exchange, når nogen åbner dashboardet i butikkens admin. Det er sådan
//      lalatoto.dk virker: butikken ligger ikke i appens organisation, så
//      client credentials grant er ikke tilladt.
//   2. Ellers et kortlivet token med client credentials grant ved hvert kald.
//      Det virker kun, når appen og butikken ligger i samme organisation
//      (felt-post).

import type { Graphql } from "../preorder/cancelService.ts";

export const API_VERSION = "2026-04";

export type ShopifyEnv = { store: string; clientId: string; clientSecret: string };

/** Læser SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID og SHOPIFY_CLIENT_SECRET. */
export function shopifyEnv(get: (key: string) => string | undefined): ShopifyEnv {
  const store = (get("SHOPIFY_STORE_DOMAIN") ?? "").trim().toLowerCase();
  const clientId = get("SHOPIFY_CLIENT_ID") ?? "";
  const clientSecret = get("SHOPIFY_CLIENT_SECRET") ?? "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(store)) {
    throw new Error("SHOPIFY_STORE_DOMAIN skal være navn.myshopify.com");
  }
  if (!clientId || !clientSecret) throw new Error("SHOPIFY_CLIENT_ID og SHOPIFY_CLIENT_SECRET mangler");
  return { store, clientId, clientSecret };
}

/** Hvor offline-tokenet gemmes. I Base44 er det entiteten ShopAccess. */
export type TokenStore = {
  get(shop: string): Promise<string | null>;
  set(shop: string, accessToken: string, scope: string): Promise<void>;
};

/**
 * Bytter App Bridges ID token til et offline-token for butikken (token
 * exchange). ID tokenet skal være kontrolleret først.
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
 */
export async function exchangeIdToken(
  env: ShopifyEnv,
  idToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; scope: string }> {
  const res = await fetchImpl(`https://${env.store}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: idToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    }),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; scope?: string; error?: string } | null;
  if (!res.ok || !body?.access_token) {
    throw new Error(`Token exchange mislykkedes (HTTP ${res.status}): ${body?.error ?? "intet svar"}`);
  }
  return { accessToken: body.access_token, scope: body.scope ?? "" };
}

export function createShopifyGraphql(
  env: ShopifyEnv,
  fetchImpl: typeof fetch = fetch,
  tokenStore?: TokenStore,
): Graphql {
  let token: Promise<string> | null = null;

  async function resolveToken(): Promise<string> {
    const stored = tokenStore ? await tokenStore.get(env.store) : null;
    return stored ?? fetchToken();
  }

  async function fetchToken(): Promise<string> {
    const res = await fetchImpl(`https://${env.store}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: env.clientId,
        client_secret: env.clientSecret,
      }),
    });
    const body = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
    if (!res.ok || !body?.access_token) {
      throw new Error(`Kunne ikke hente token fra Shopify (HTTP ${res.status}): ${body?.error ?? "intet svar"}`);
    }
    return body.access_token;
  }

  return async (query, variables) => {
    token ??= resolveToken();
    const res = await fetchImpl(`https://${env.store}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await token },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json().catch(() => null)) as { data?: any; errors?: unknown } | null;
    if (!res.ok || !body || body.errors) {
      throw new Error(`GraphQL-fejl (HTTP ${res.status}): ${JSON.stringify(body?.errors ?? body)}`);
    }
    return body.data;
  };
}
