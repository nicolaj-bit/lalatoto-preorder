import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { base44TokenStore } from '../../shared/server/base44Store.ts';
import { createShopifyGraphql, shopifyEnv } from '../../shared/server/shopify.ts';
import { ensureWelcomeDiscount } from '../../shared/server/welcomeDiscount.ts';

// Opretter nyhedsbrevets rabatkode VELKOMMEN15 som app-rabat, hvis den ikke
// findes. Kun for admin. Se shared/server/welcomeDiscount.ts.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const env = shopifyEnv((k) => Deno.env.get(k));
    const graphql = createShopifyGraphql(env, fetch, base44TokenStore(base44.asServiceRole.entities));
    const result = await ensureWelcomeDiscount(graphql);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error('[welcomeDiscount]', error);
    return Response.json({ ok: false, error: String((error as Error)?.message ?? error) }, { status: 500 });
  }
});
