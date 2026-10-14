import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { listPreorderRows } from '../../shared/server/dashboard.ts';
import { latestAttemptsByOrder } from '../../shared/server/base44Store.ts';
import { createShopifyGraphql, shopifyEnv } from '../../shared/server/shopify.ts';

// Dashboardets liste over forudbestillinger og kunder. Kun for admin.
// Hentes fra Shopify ved hvert kald; kortoplysninger hentes aldrig.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const env = shopifyEnv((k) => Deno.env.get(k));
    const attempts = await latestAttemptsByOrder(base44.asServiceRole.entities);
    const rows = await listPreorderRows(createShopifyGraphql(env), {
      store: env.store,
      attempts: (orderId) => attempts.get(orderId),
    });
    return Response.json({ ok: true, rows });
  } catch (error) {
    console.error('[listPreorders]', error);
    return Response.json({ ok: false, error: String((error as Error)?.message ?? error) }, { status: 500 });
  }
});
