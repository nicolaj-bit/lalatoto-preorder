import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { runChargeJob } from '../../shared/server/chargeJob.ts';
import { base44AttemptStore } from '../../shared/server/base44Store.ts';
import { createShopifyGraphql, shopifyEnv } from '../../shared/server/shopify.ts';

// Trækker restbeløbet på forfaldne forudbestillinger. Køres dagligt af
// workflowet «Daglig træk af restbeløb». En admin kan også kalde den med
// { dryRun: true } fra dashboardet for at se, hvad der ville blive trukket.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Planlagte kald har ingen bruger; ellers kun admin.
    if (await base44.auth.isAuthenticated()) {
      const user = await base44.auth.me();
      if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const env = shopifyEnv((k) => Deno.env.get(k));
    const results = await runChargeJob({
      graphql: createShopifyGraphql(env),
      store: base44AttemptStore(base44.asServiceRole.entities),
      dryRun: body?.dryRun === true,
    });
    console.log(`[chargeDuePreorders] ${results.length} forudbestillinger behandlet`, JSON.stringify(results));
    return Response.json({ ok: true, results });
  } catch (error) {
    console.error('[chargeDuePreorders]', error);
    return Response.json({ ok: false, error: String((error as Error)?.message ?? error) }, { status: 500 });
  }
});
