// Adgang til butikkens Admin API fra Base44-funktionerne.
//
// To veje til et token:
//   1. Et gemt offline-token (entiteten ShopAccess). Det hentes med token
//      exchange, når nogen åbner dashboardet i butikkens admin. Det er sådan
//      lalatoto.dk virker: butikken ligger ikke i appens organisation, så
//      client credentials grant er ikke tilladt. Tokenet udløber efter en
//      time og fornyes her med refresh-tokenet, så en lækket nøgle hurtigt
//      bliver værdiløs (Shopifys sikkerhedskrav «Adgangstokens med udløbstid»).
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

/**
 * Et gemt offline-token. Tokenet udløber efter en time (expiresAt) og fornyes
 * med refreshToken, som selv udløber efter 90 dage (refreshExpiresAt). Et
 * gammelt token uden udløb har ingen refreshToken og byttes til et med udløb
 * første gang, det bruges.
 */
export type StoredToken = {
  accessToken: string;
  scope: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  refreshExpiresAt?: string | null;
};

/** Hvor offline-tokenet gemmes. I Base44 er det entiteten ShopAccess. */
export type TokenStore = {
  get(shop: string): Promise<StoredToken | null>;
  set(shop: string, token: StoredToken): Promise<void>;
  /** Fjerner tokenet, når Shopify har afvist det for altid. */
  clear(shop: string): Promise<void>;
};

const TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";
const OFFLINE_TOKEN = "urn:shopify:params:oauth:token-type:offline-access-token";

/** Forny tokenet, når der er mindre end fem minutter tilbage. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Hent et nyt token ved næste åbning af dashboardet, når refresh-tokenet har under 30 dage tilbage. */
const REEXCHANGE_MARGIN_MS = 30 * 24 * 60 * 60 * 1000;

type TokenResponse = {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
};

/** Shopify svarer 401: tokenet eller refresh-tokenet er afvist for altid. */
export class TokenRevokedError extends Error {}

async function requestToken(
  env: ShopifyEnv,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  what: string,
): Promise<StoredToken> {
  const res = await fetchImpl(`https://${env.store}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, ...params }).toString(),
  });
  const body = (await res.json().catch(() => null)) as TokenResponse | null;
  if (!res.ok || !body?.access_token) {
    const message = `${what} mislykkedes (HTTP ${res.status}): ${body?.error ?? "intet svar"}`;
    throw res.status === 401 ? new TokenRevokedError(message) : new Error(message);
  }
  return toStored(body);
}

function toStored(body: TokenResponse, now = Date.now()): StoredToken {
  return {
    accessToken: body.access_token!,
    scope: body.scope ?? "",
    refreshToken: body.refresh_token ?? null,
    expiresAt: body.expires_in ? new Date(now + body.expires_in * 1000).toISOString() : null,
    refreshExpiresAt: body.refresh_token_expires_in
      ? new Date(now + body.refresh_token_expires_in * 1000).toISOString()
      : null,
  };
}

/**
 * Bytter App Bridges ID token til et offline-token med udløb for butikken
 * (token exchange). ID tokenet skal være kontrolleret først.
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
 */
export function exchangeIdToken(env: ShopifyEnv, idToken: string, fetchImpl: typeof fetch = fetch): Promise<StoredToken> {
  return requestToken(
    env,
    {
      grant_type: TOKEN_EXCHANGE,
      subject_token: idToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: OFFLINE_TOKEN,
      expiring: "1",
    },
    fetchImpl,
    "Token exchange",
  );
}

/**
 * Bytter et gammelt offline-token uden udløb til et med udløb. Det gamle
 * token holder op med at virke, så snart Shopify har svaret.
 * https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
 */
export function migrateOfflineToken(env: ShopifyEnv, token: string, fetchImpl: typeof fetch = fetch): Promise<StoredToken> {
  return requestToken(
    env,
    {
      grant_type: TOKEN_EXCHANGE,
      subject_token: token,
      subject_token_type: OFFLINE_TOKEN,
      requested_token_type: OFFLINE_TOKEN,
      expiring: "1",
    },
    fetchImpl,
    "Skift til token med udløb",
  );
}

/** Henter et nyt token med refresh-tokenet. Svaret har også et nyt refresh-token. */
export function refreshOfflineToken(env: ShopifyEnv, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<StoredToken> {
  return requestToken(env, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl, "Fornyelse af token");
}

/**
 * Skal dashboardet hente et nyt token med token exchange? Kun når der ikke er
 * et brugbart token. Et nyt token gør alle tidligere refresh-tokens ugyldige,
 * så det skal ikke ske ved hver åbning, mens et baggrundsjob måske fornyer.
 */
export function needsTokenExchange(stored: StoredToken | null, now = Date.now()): boolean {
  if (!stored?.refreshToken || !stored.refreshExpiresAt) return true;
  return Date.parse(stored.refreshExpiresAt) - now < REEXCHANGE_MARGIN_MS;
}

/**
 * Et brugbart access token ud fra det gemte: fornyer det, når det er ved at
 * udløbe, og bytter et gammelt token uden udløb. Nye tokens gemmes med det
 * samme, for Shopify udsteder et nyt refresh-token hver gang.
 */
export async function usableToken(
  env: ShopifyEnv,
  store: TokenStore,
  stored: StoredToken,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<string> {
  if (!stored.refreshToken) {
    let migrated: StoredToken;
    try {
      migrated = await migrateOfflineToken(env, stored.accessToken, fetchImpl);
    } catch (error) {
      // Mislykkes skiftet, virker det gamle token stadig. Prøv igen næste gang.
      console.warn("[shopify] skift til token med udløb mislykkedes:", (error as Error).message);
      return stored.accessToken;
    }
    await store.set(env.store, migrated);
    return migrated.accessToken;
  }
  try {
    if (stored.expiresAt && Date.parse(stored.expiresAt) - now > REFRESH_MARGIN_MS) return stored.accessToken;
    const refreshed = await refreshOfflineToken(env, stored.refreshToken, fetchImpl);
    await store.set(env.store, refreshed);
    return refreshed.accessToken;
  } catch (error) {
    if (error instanceof TokenRevokedError) {
      // Tokenet kan ikke reddes. Næste gang dashboardet åbnes, hentes et nyt.
      await store.clear(env.store);
      throw new Error(`${error.message}. Åbn dashboardet i Shopify admin for at give appen adgang igen.`);
    }
    // Anden fejl: brug det gamle token, hvis det stadig gælder.
    if (stored.expiresAt && Date.parse(stored.expiresAt) > now) return stored.accessToken;
    throw error;
  }
}

export function createShopifyGraphql(
  env: ShopifyEnv,
  fetchImpl: typeof fetch = fetch,
  tokenStore?: TokenStore,
): Graphql {
  let token: Promise<string> | null = null;

  async function resolveToken(): Promise<string> {
    const stored = tokenStore ? await tokenStore.get(env.store) : null;
    return stored ? usableToken(env, tokenStore!, stored, fetchImpl) : fetchToken();
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
