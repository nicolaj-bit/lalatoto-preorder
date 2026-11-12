import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { handleOrderSourceRequest, SOURCE_CORS_HEADERS } from '../../shared/server/orderSourceHandler.ts';
import { base44TokenStore } from '../../shared/server/base44Store.ts';
import { createShopifyGraphql, shopifyEnv } from '../../shared/server/shopify.ts';

// Kaldes af spørgsmålet «Hvor hørte du om os første gang?» på takkesiden
// (extensions/kilde-tak). Gemmer svaret som tag på ordren. Se
// shared/server/orderSourceHandler.ts.
Deno.serve(async (req) => {
  try {
    const env = shopifyEnv((k) => Deno.env.get(k));
    const base44 = req.method === 'POST' ? createClientFromRequest(req) : null;
    return await handleOrderSourceRequest(req, {
      env,
      graphql: createShopifyGraphql(env, fetch, base44 ? base44TokenStore(base44.asServiceRole.entities) : undefined),
      log: (entry) => {
        console.log('[orderSource]', JSON.stringify(entry));
      },
    });
  } catch (error) {
    console.error('[orderSource]', error);
    return new Response(JSON.stringify({ ok: false, reason: 'SERVER_ERROR' }), {
      status: 500,
      headers: { ...SOURCE_CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
