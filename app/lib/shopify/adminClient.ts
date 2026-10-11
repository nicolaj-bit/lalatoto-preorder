// Lille Admin API-klient til scripts og integrationstest.
//
// Selve Remix-appen bruger skabelonens authenticate.admin(). Scripts kører
// uden for Shopify-admin og henter i stedet et token med client credentials
// grant, som virker for apps og butikker i samme organisation i Dev
// Dashboard. Token gemmes kun i hukommelsen — aldrig på disk.

import { SHOP_QUERY } from "./operations";

export const API_VERSION = "2026-04";

type Fetch = typeof fetch;

export type AdminClientConfig = {
  store: string;
  /** Sættes enten et færdigt token … */
  accessToken?: string;
  /** … eller appens nøgler, så hentes token med client credentials. */
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: Fetch;
};

export class ShopifyGraphQLError extends Error {
  constructor(message: string, readonly details: unknown) {
    super(message);
    this.name = "ShopifyGraphQLError";
  }
}

/** Accepterer kun "navn.myshopify.com" — så kan et script ikke ramme et eget domæne ved en fejl. */
export function normalizeStore(store: string): string {
  const s = store.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) {
    throw new Error(`SHOPIFY_STORE skal være på formen navn.myshopify.com, fik "${store}"`);
  }
  return s;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): AdminClientConfig {
  const store = env.SHOPIFY_STORE;
  if (!store) throw new Error("SHOPIFY_STORE mangler (fx lalatoto-preorder-dev.myshopify.com)");
  const accessToken = env.SHOPIFY_ADMIN_TOKEN || undefined;
  const clientId = env.SHOPIFY_API_KEY || undefined;
  const clientSecret = env.SHOPIFY_API_SECRET || undefined;
  if (!accessToken && !(clientId && clientSecret)) {
    throw new Error("Sæt enten SHOPIFY_ADMIN_TOKEN eller både SHOPIFY_API_KEY og SHOPIFY_API_SECRET");
  }
  return { store, accessToken, clientId, clientSecret };
}

export async function fetchClientCredentialsToken(
  store: string,
  clientId: string,
  clientSecret: string,
  fetchImpl: Fetch = fetch,
): Promise<{ accessToken: string; scope: string }> {
  const res = await fetchImpl(`https://${normalizeStore(store)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    // Svaret kan indeholde fejlbeskeder, men aldrig vores hemmelighed — den sendes kun i body.
    throw new Error(`Kunne ikke hente token (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as { access_token?: string; scope?: string };
  if (!json.access_token) throw new Error("Svaret indeholdt intet access_token");
  return { accessToken: json.access_token, scope: json.scope ?? "" };
}

export function createAdminClient(config: AdminClientConfig) {
  const store = normalizeStore(config.store);
  const fetchImpl = config.fetchImpl ?? fetch;
  let token = config.accessToken;
  let grantedScopes: string | undefined;

  async function getToken(): Promise<string> {
    if (token) return token;
    if (!config.clientId || !config.clientSecret) throw new Error("Ingen adgangsoplysninger");
    const result = await fetchClientCredentialsToken(store, config.clientId, config.clientSecret, fetchImpl);
    token = result.accessToken;
    grantedScopes = result.scope;
    return token;
  }

  async function graphql<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetchImpl(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": await getToken(),
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json().catch(() => null)) as { data?: T; errors?: unknown } | null;
    if (!res.ok || !body || body.errors) {
      throw new ShopifyGraphQLError(`GraphQL-kald fejlede (HTTP ${res.status})`, body?.errors ?? body);
    }
    return body.data as T;
  }

  return {
    store,
    graphql,
    get grantedScopes() {
      return grantedScopes;
    },
  };
}

export type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Nægter at fortsætte, hvis butikken ikke er en udviklingsbutik.
 * Beviset opretter produkter, lægger ordrer og trækker penge — det må aldrig
 * ske i lalatoto.dk.
 */
export async function assertDevelopmentStore(client: AdminClient) {
  const data = await client.graphql<{
    shop: { name: string; myshopifyDomain: string; currencyCode: string; plan: { partnerDevelopment: boolean } };
  }>(SHOP_QUERY);
  if (!data.shop.plan.partnerDevelopment) {
    throw new Error(
      `${data.shop.myshopifyDomain} er ikke en udviklingsbutik. Beviset kører kun mod udviklingsbutikker.`,
    );
  }
  return data.shop;
}

/** Kaster, hvis et mutationssvar har userErrors. */
export function throwOnUserErrors(label: string, errors: Array<{ field?: unknown; message: string }> | undefined) {
  if (errors && errors.length > 0) {
    throw new ShopifyGraphQLError(`${label}: ${errors.map((e) => e.message).join("; ")}`, errors);
  }
}
