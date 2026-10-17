// Kontrol af session token fra kundekontoens udvidelse.
//
// Shopify signerer tokenet med appens client secret (HS256). `aud` er appens
// client id, `dest` butikken, og `sub` den kunde, der er logget ind — kun hvis
// appen har adgang til beskyttede kundedata.
// https://shopify.dev/docs/api/customer-account-ui-extensions/2026-07/target-apis/platform-apis/session-token-api

export type SessionTokenPayload = {
  dest: string;
  aud: string;
  exp: number;
  nbf: number;
  iat?: number;
  jti?: string;
  sub?: string;
  iss?: string;
};

export type VerifyResult = { ok: true; payload: SessionTokenPayload } | { ok: false; reason: string };

/** Tidsrum, uret hos Shopify og her må gå forkert. */
const LEEWAY_SECONDS = 10;

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeJson(part: string): any {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

export async function verifySessionToken(
  token: string,
  opts: { secret: string; clientId: string; shop: string; now?: Date },
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "Ikke et JWT" };
  const [headerPart, payloadPart, signaturePart] = parts;

  let header: any;
  let payload: SessionTokenPayload;
  try {
    header = decodeJson(headerPart);
    payload = decodeJson(payloadPart);
  } catch {
    return { ok: false, reason: "Kan ikke læse tokenet" };
  }
  if (header?.alg !== "HS256") return { ok: false, reason: `Uventet algoritme ${header?.alg}` };

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(opts.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) return { ok: false, reason: "Forkert signatur" };

  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (typeof payload.exp !== "number" || payload.exp + LEEWAY_SECONDS < now) return { ok: false, reason: "Udløbet" };
  if (typeof payload.nbf === "number" && payload.nbf - LEEWAY_SECONDS > now) return { ok: false, reason: "Ikke gyldigt endnu" };
  if (payload.aud !== opts.clientId) return { ok: false, reason: "Tokenet er til en anden app" };
  const dest = String(payload.dest ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (dest !== opts.shop.toLowerCase()) return { ok: false, reason: "Tokenet er til en anden butik" };
  return { ok: true, payload };
}

/**
 * ID token fra App Bridge, når appen er åbnet i Shopify admin.
 *
 * Samme signatur og felter som kundekontoens token, men `iss` er
 * `https://<butik>/admin`. Kundekontoens token har ingen `iss` — derfor skal
 * den være der og pege på admin, ellers kunne en kunde bruge sit eget token
 * til at hente alle forudbestillinger.
 * https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
 */
export async function verifyAdminIdToken(
  token: string,
  opts: { secret: string; clientId: string; shop: string; now?: Date },
): Promise<VerifyResult> {
  const result = await verifySessionToken(token, opts);
  if (!result.ok) return result;
  let iss: URL;
  try {
    iss = new URL(String(result.payload.iss ?? ""));
  } catch {
    return { ok: false, reason: "Ikke et token fra Shopify admin" };
  }
  if (iss.hostname.toLowerCase() !== opts.shop.toLowerCase() || !/^\/admin\/?$/.test(iss.pathname)) {
    return { ok: false, reason: "Ikke et token fra Shopify admin" };
  }
  return result;
}
