// Laver session tokens, som Shopify gør: HS256 med appens client secret.
import { createHmac } from "node:crypto";

export const SECRET = "hemmelig-test-nøgle";
export const CLIENT_ID = "app-client-id";
export const SHOP = "felt-post.myshopify.com";
export const NOW = new Date("2026-10-14T12:00:00Z");
const t = Math.floor(NOW.getTime() / 1000);

export const GOOD_PAYLOAD = { dest: SHOP, aud: CLIENT_ID, exp: t + 300, nbf: t - 5, iat: t - 5, sub: "gid://shopify/Customer/42" };

export function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

export function sign(payload: Record<string, unknown>, opts: { secret?: string; alg?: string } = {}) {
  const header = b64url(JSON.stringify({ alg: opts.alg ?? "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", opts.secret ?? SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}
