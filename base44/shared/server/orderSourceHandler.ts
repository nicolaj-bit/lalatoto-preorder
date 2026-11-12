// Base44-funktionen orderSource: «Hvor hørte du om os første gang?» på
// takkesiden (extensions/kilde-tak).
//
//   POST { orderId, source, other }
//   Authorization: Bearer <kassens session token>
//
// Svaret gemmes på ordren som tagget kilde-<svar>, så ordrer kan filtreres og
// segmenteres efter kilde. Ved «Andet» gemmes kundens egen tekst også i
// ordrens metafelt lalatoto.kilde.
//
// Tokenet viser, at kaldet kommer fra butikkens egen kasse, men ikke hvilken
// ordre. Derfor tagges kun en ordre, der er under to timer gammel og ikke har
// en kilde i forvejen — så kan ingen ændre et gammelt svar eller en andens.

import type { Graphql } from "../preorder/cancelService.ts";
import { verifySessionToken } from "./sessionToken.ts";
import type { ShopifyEnv } from "./shopify.ts";

export const SOURCE_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-App-Id",
  "Access-Control-Max-Age": "86400",
};

/** Svarmulighederne. Rækkefølgen er den, kunden ser. */
export const SOURCES = [
  "instagram",
  "facebook",
  "tiktok",
  "google",
  "venner",
  "influencer",
  "club-no-sleep",
  "andet",
] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_TAG_PREFIX = "kilde-";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_OTHER_LENGTH = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SOURCE_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Takkesiden giver gid://shopify/OrderIdentity/123; Admin API'et vil have Order/123. */
export function orderGid(value: unknown): string | null {
  const m = /^gid:\/\/shopify\/(?:OrderIdentity|Order)\/(\d+)$/.exec(String(value ?? "").trim());
  return m ? `gid://shopify/Order/${m[1]}` : null;
}

const ORDER_QUERY = `query KildeOrdre($id: ID!) {
  order(id: $id) { id createdAt tags }
}`;

const TAGS_MUTATION = `mutation KildeTag($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
}`;

const METAFIELD_MUTATION = `mutation KildeTekst($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { userErrors { field message } }
}`;

export type SourceLog = (entry: { orderId: string; source: string; ok: boolean; reason?: string }) =>
  | Promise<void>
  | void;

export async function handleOrderSourceRequest(
  req: Request,
  deps: { env: ShopifyEnv; graphql: Graphql; log?: SourceLog; now?: Date },
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: SOURCE_CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, reason: "METHOD" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const verified = await verifySessionToken(token, {
    secret: deps.env.clientSecret,
    clientId: deps.env.clientId,
    shop: deps.env.store,
    now: deps.now,
  });
  if (!verified.ok) return json({ ok: false, reason: "UNAUTHORIZED" }, 401);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const orderId = orderGid(body?.orderId);
  if (!orderId) return json({ ok: false, reason: "ORDER" }, 400);
  const source = String(body?.source ?? "") as Source;
  if (!SOURCES.includes(source)) return json({ ok: false, reason: "SOURCE" }, 400);
  const other =
    source === "andet" && typeof body?.other === "string"
      ? body.other.replace(/\s+/g, " ").trim().slice(0, MAX_OTHER_LENGTH)
      : "";

  const data = await deps.graphql(ORDER_QUERY, { id: orderId });
  const order = data?.order as { id: string; createdAt: string; tags: string[] } | null;
  if (!order) return json({ ok: false, reason: "ORDER" }, 404);

  const now = (deps.now ?? new Date()).getTime();
  if (now - Date.parse(order.createdAt) > MAX_AGE_MS) {
    await deps.log?.({ orderId, source, ok: false, reason: "TOO_OLD" });
    return json({ ok: false, reason: "TOO_OLD" }, 409);
  }
  // Allerede svaret, fx fra en anden fane: svar ok, men rør ikke ordren.
  if (order.tags.some((t) => t.startsWith(SOURCE_TAG_PREFIX))) return json({ ok: true });

  const tagged = await deps.graphql(TAGS_MUTATION, { id: orderId, tags: [`${SOURCE_TAG_PREFIX}${source}`] });
  const tagErrors = tagged?.tagsAdd?.userErrors ?? [];
  if (tagErrors.length) {
    await deps.log?.({ orderId, source, ok: false, reason: JSON.stringify(tagErrors) });
    return json({ ok: false, reason: "TAG" }, 500);
  }

  if (other) {
    await deps.graphql(METAFIELD_MUTATION, {
      metafields: [{ ownerId: orderId, namespace: "lalatoto", key: "kilde", type: "single_line_text_field", value: other }],
    });
  }

  await deps.log?.({ orderId, source, ok: true });
  return json({ ok: true });
}
