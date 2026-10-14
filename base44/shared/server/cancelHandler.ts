// Base44-funktionen cancelPreorder: kaldes af knappen «Annuller
// forudbestilling» i kundekontoen (extensions/preorder-annuller).
//
//   POST { action: "check" | "cancel", orderId }
//   Authorization: Bearer <kundekontoens session token>
//
// Kunde-id'et tages fra tokenets `sub`, aldrig fra forespørgslen.

import { evaluateCancel, performCancel, type Graphql } from "../preorder/cancelService.ts";
import { verifySessionToken } from "./sessionToken.ts";
import type { ShopifyEnv } from "./shopify.ts";

/** Kundekontoens udvidelser kører i en sandkasse uden fast origin. */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-App-Id",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export type CancelLog = (entry: {
  orderId: string;
  action: string;
  ok: boolean;
  reason?: string;
  refunds?: boolean;
}) => Promise<void> | void;

export async function handleCancelRequest(
  req: Request,
  deps: { env: ShopifyEnv; graphql: Graphql; log?: CancelLog; now?: Date },
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, reason: "METHOD" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const verified = await verifySessionToken(token, {
    secret: deps.env.clientSecret,
    clientId: deps.env.clientId,
    shop: deps.env.store,
    now: deps.now,
  });
  if (!verified.ok) return json({ ok: false, cancellable: false, reason: "UNAUTHORIZED" }, 401);

  const body = (await req.json().catch(() => null)) as { action?: unknown; orderId?: unknown } | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  const customerId = verified.payload.sub;

  if (body?.action === "check") {
    const decision = await evaluateCancel(deps.graphql, orderId, customerId);
    return json(
      decision.ok ? { cancellable: true, refunds: decision.refunds } : { cancellable: false, reason: decision.reason },
    );
  }

  if (body?.action === "cancel") {
    const result = await performCancel(deps.graphql, orderId, customerId);
    await deps.log?.({
      orderId,
      action: "cancel",
      ok: result.ok,
      reason: result.ok ? undefined : `${result.reason}: ${result.message}`,
      refunds: result.ok ? result.refunds : undefined,
    });
    // Kunden får en generel besked; detaljen ligger i loggen.
    return result.ok ? json({ ok: true, refunds: result.refunds }) : json({ ok: false, reason: result.reason }, 409);
  }

  return json({ ok: false, reason: "ACTION" }, 400);
}
