import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { ADMIN_CORS_HEADERS, handleAdminRequest } from '../../shared/server/adminHandler.ts';
import { chargeOrders, runChargeJob } from '../../shared/server/chargeJob.ts';
import { listPreorderRows } from '../../shared/server/dashboard.ts';
import { base44AttemptStore, base44TokenStore, latestAttemptsByOrder } from '../../shared/server/base44Store.ts';
import { createProductSegment } from '../../shared/server/segment.ts';
import { createShopifyGraphql, exchangeIdToken, shopifyEnv } from '../../shared/server/shopify.ts';

// Dashboardet inde i Shopify admin (admin-app/ på Vercel) — uden Base44-login.
// Brugeren godkendes med App Bridges ID token; se
// shared/server/adminHandler.ts.
Deno.serve(async (req) => {
  try {
    const env = shopifyEnv((k) => Deno.env.get(k));
    const base44 = req.method === 'POST' ? createClientFromRequest(req) : null;
    const tokens = base44 ? base44TokenStore(base44.asServiceRole.entities) : undefined;
    const graphql = createShopifyGraphql(env, fetch, tokens);
    return await handleAdminRequest(req, {
      env,
      // Hver gang dashboardet åbnes, hentes et frisk offline-token med
      // brugerens ID token, så de andre funktioner kan nå butikken.
      onVerified: async (idToken) => {
        if (!tokens) return;
        const { accessToken, scope } = await exchangeIdToken(env, idToken);
        await tokens.set(env.store, accessToken, scope);
      },
      listRows: async () => {
        const attempts = await latestAttemptsByOrder(base44!.asServiceRole.entities);
        return listPreorderRows(graphql, { store: env.store, attempts: (orderId) => attempts.get(orderId) });
      },
      chargePreview: () =>
        runChargeJob({ graphql, store: base44AttemptStore(base44!.asServiceRole.entities), dryRun: true }),
      createSegment: (productId, productTitle) => createProductSegment(graphql, productId, productTitle),
      charge: async (orderIds) => {
        const results = await chargeOrders(
          { graphql, store: base44AttemptStore(base44!.asServiceRole.entities) },
          orderIds,
        );
        console.log('[adminPreorders] træk', JSON.stringify(results));
        return results;
      },
    });
  } catch (error) {
    console.error('[adminPreorders]', error);
    return new Response(JSON.stringify({ ok: false, error: String((error as Error)?.message ?? error) }), {
      status: 500,
      headers: { ...ADMIN_CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
