// Endepunkt for kundekontoens knap «Annuller forudbestilling»
// (extensions/preorder-annuller).
//
//   GET  /api/preorder-cancel?orderId=gid://shopify/Order/…  → må ordren annulleres?
//   POST /api/preorder-cancel  { orderId }                   → annullér den
//
// Kaldet godkendes med kundekontoens session token. Kunde-id'et kommer fra
// tokenets `sub` og aldrig fra forespørgslen, så en kunde kan kun annullere
// sine egne ordrer. Selve annulleringen sker med appens offline-adgang til
// butikken.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { evaluateCancel, performCancel, type Graphql } from "../lib/preorder/cancelService";

/** `dest` i tokenet er butikkens domæne, nogle gange med https:// foran. */
function shopFromDest(dest: string): string {
  return dest.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

async function adminGraphql(shop: string): Promise<Graphql> {
  const { admin } = await unauthenticated.admin(shop);
  return async (query, variables) => {
    const res = await admin.graphql(query, { variables });
    const body = (await res.json()) as { data?: any; errors?: unknown };
    if (body.errors) throw new Error(`GraphQL-fejl: ${JSON.stringify(body.errors)}`);
    return body.data;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);
  const orderId = new URL(request.url).searchParams.get("orderId") ?? "";
  const graphql = await adminGraphql(shopFromDest(sessionToken.dest));
  const decision = await evaluateCancel(graphql, orderId, sessionToken.sub);
  return cors(
    Response.json(
      decision.ok ? { cancellable: true, refunds: decision.refunds } : { cancellable: false, reason: decision.reason },
    ),
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);
  if (request.method !== "POST") {
    return cors(Response.json({ ok: false, reason: "METHOD" }, { status: 405 }));
  }
  const body = (await request.json().catch(() => null)) as { orderId?: unknown } | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  const shop = shopFromDest(sessionToken.dest);
  const result = await performCancel(await adminGraphql(shop), orderId, sessionToken.sub);
  if (!result.ok) {
    console.warn(`Annullering afvist på ${shop} (${orderId}): ${result.reason} — ${result.message}`);
    // Beskeden til kunden er generel; detaljen står i loggen.
    return cors(Response.json({ ok: false, reason: result.reason }, { status: 409 }));
  }
  console.log(`Forudbestilling ${orderId} annulleret af kunden på ${shop} (refusion: ${result.refunds})`);
  return cors(Response.json({ ok: true, refunds: result.refunds }));
};
