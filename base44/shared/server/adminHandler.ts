// Base44-funktionen adminPreorders: data til dashboardet inde i Shopify admin
// (admin-app/, ligger på Vercel).
//
//   POST { action: "list" | "chargePreview" }
//   Authorization: Bearer <ID token fra App Bridge>
//
// Base44-siden må ikke vises inde i Shopify (den sender X-Frame-Options:
// DENY), så dashboardet i admin er en selvstændig side. Den har intet
// Base44-login; den, der har appen åben i butikkens admin, godkendes med
// App Bridges ID token. Funktionen ændrer intet: prøvekørslen af trækket
// trækker ingen penge.

import type { PreorderRow } from "./dashboard.ts";
import type { JobResult } from "./chargeJob.ts";
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

  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action === "list") return json({ ok: true, rows: await deps.listRows() });
  if (body?.action === "chargePreview") return json({ ok: true, results: await deps.chargePreview() });
  return json({ ok: false, error: "Ukendt handling" }, 400);
}
