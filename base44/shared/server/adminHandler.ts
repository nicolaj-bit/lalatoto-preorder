// Base44-funktionen adminPreorders: data til dashboardet inde i Shopify admin
// (admin-app/, ligger på Vercel).
//
//   POST { action: "list" | "chargePreview" }
//   POST { action: "createSegment", productId, productTitle }
//   Authorization: Bearer <ID token fra App Bridge>
//
// Base44-siden må ikke vises inde i Shopify (den sender X-Frame-Options:
// DENY), så dashboardet i admin er en selvstændig side. Den har intet
// Base44-login; den, der har appen åben i butikkens admin, godkendes med
// App Bridges ID token. Prøvekørslen af trækket trækker ingen penge; det
// eneste, funktionen opretter, er et kundesegment pr. produkt.

import type { PreorderRow } from "./dashboard.ts";
import type { JobResult } from "./chargeJob.ts";
import type { SegmentResult } from "./segment.ts";
import { verifyAdminIdToken } from "./sessionToken.ts";
import type { ShopifyEnv } from "./shopify.ts";

/** Kaldet sker med et token i headeren, ikke med cookies, så alle origins er i orden. */
export const ADMIN_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-App-Id",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...ADMIN_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export async function handleAdminRequest(
  req: Request,
  deps: {
    env: ShopifyEnv;
    listRows: () => Promise<PreorderRow[]>;
    chargePreview: () => Promise<JobResult[]>;
    createSegment: (productId: string, productTitle: string) => Promise<SegmentResult>;
    now?: Date;
  },
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ADMIN_CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Kun POST" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const verified = await verifyAdminIdToken(token, {
    secret: deps.env.clientSecret,
    clientId: deps.env.clientId,
    shop: deps.env.store,
    now: deps.now,
  });
  if (!verified.ok) return json({ ok: false, error: "Ingen adgang" }, 401);

  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; productId?: unknown; productTitle?: unknown }
    | null;
  if (body?.action === "list") return json({ ok: true, rows: await deps.listRows() });
  if (body?.action === "chargePreview") return json({ ok: true, results: await deps.chargePreview() });
  if (body?.action === "createSegment") {
    if (typeof body.productId !== "string" || typeof body.productTitle !== "string") {
      return json({ ok: false, error: "Produkt mangler" }, 400);
    }
    const result = await deps.createSegment(body.productId, body.productTitle);
    return json(result, result.ok ? 200 : 422);
  }
  return json({ ok: false, error: "Ukendt handling" }, 400);
}
