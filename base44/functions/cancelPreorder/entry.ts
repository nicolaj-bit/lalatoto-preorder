import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { handleCancelRequest, CORS_HEADERS } from '../../shared/server/cancelHandler.ts';
import { base44TokenStore } from '../../shared/server/base44Store.ts';
import { createShopifyGraphql, shopifyEnv } from '../../shared/server/shopify.ts';

// Kaldes af knappen «Annuller forudbestilling» i Shopifys kundekonto — uden
// Base44-login. Kunden godkendes med kundekontoens session token; se
// shared/server/cancelHandler.ts.
Deno.serve(async (req) => {
  try {
    const env = shopifyEnv((k) => Deno.env.get(k));
    const base44 = req.method === 'POST' ? createClientFromRequest(req) : null;
    return await handleCancelRequest(req, {
      env,
      graphql: createShopifyGraphql(env, fetch, base44 ? base44TokenStore(base44.asServiceRole.entities) : undefined),
      log: async (entry) => {
        await base44?.asServiceRole.entities.PreorderCancellation.create({
          order_id: entry.orderId,
          ok: entry.ok,
          reason: entry.reason ?? null,
          refunded: entry.refunds ?? false,
          cancelled_at: new Date().toISOString(),
        });
      },
    });
  } catch (error) {
    console.error('[cancelPreorder]', error);
    return new Response(JSON.stringify({ ok: false, reason: 'SERVER_ERROR' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
