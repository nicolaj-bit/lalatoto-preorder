import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { handleWaitlistRequest, WAITLIST_CORS_HEADERS } from '../../shared/server/waitlistHandler.ts';
import { base44TokenStore } from '../../shared/server/base44Store.ts';
import { createShopifyGraphql, shopifyEnv } from '../../shared/server/shopify.ts';

// Kaldes af ventelisten på produktsiden i temaet (snippets/lalatoto-waitlist.liquid)
// — uden Base44-login. Opretter eller opdaterer kunden med ventelistens tags og
// tilmelder kun nyhedsbrevet, når kunden har sat flueben. Se
// shared/server/waitlistHandler.ts.
Deno.serve(async (req) => {
  try {
    const env = shopifyEnv((k) => Deno.env.get(k));
    const base44 = req.method === 'POST' ? createClientFromRequest(req) : null;
    return await handleWaitlistRequest(req, {
      graphql: createShopifyGraphql(env, fetch, base44 ? base44TokenStore(base44.asServiceRole.entities) : undefined),
      log: (entry) => {
        // Kun produkt og udfald i loggen, ikke e-mailen.
        console.log('[waitlistSignup]', JSON.stringify({ variantId: entry.variantId, ok: entry.ok, created: entry.created, reason: entry.reason }));
      },
    });
  } catch (error) {
    console.error('[waitlistSignup]', error);
    return new Response(JSON.stringify({ ok: false, reason: 'SERVER_ERROR' }), {
      status: 500,
      headers: { ...WAITLIST_CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
