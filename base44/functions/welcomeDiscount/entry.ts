import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { base44TokenStore } from '../../shared/server/base44Store.ts';
import { createShopifyGraphql, shopifyEnv } from '../../shared/server/shopify.ts';
import { ensureWelcomeDiscount } from '../../shared/server/welcomeDiscount.ts';

// Opretter nyhedsbrevets rabatkode VELKOMMEN15 som app-rabat, hvis den ikke
// findes. Kun for admin. Se shared/server/welcomeDiscount.ts.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Admin i Base44, eller den midlertidige nøgle i hemmeligheden
    // VELKOMST_NOEGLE (sættes kun, mens koden oprettes, og slettes bagefter).
    const key = Deno.env.get('VELKOMST_NOEGLE');
    const keyOk = Boolean(key) && req.headers.get('x-velkomst-noegle') === key;
    if (!keyOk) {
      const user = await base44.auth.me().catch(() => null);
      if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const env = shopifyEnv((k) => Deno.env.get(k));
    const graphql = createShopifyGraphql(env, fetch, base44TokenStore(base44.asServiceRole.entities));
    const scopes = await graphql(`{ currentAppInstallation { accessScopes { handle } } }`)
      .then((d: any) => (d?.currentAppInstallation?.accessScopes ?? []).map((s: any) => s.handle))
      .catch(() => []);
    if (!scopes.includes('write_discounts')) {
      return Response.json({ ok: false, reason: 'MANGLER_ADGANG', scopes }, { status: 409 });
    }
    const result = await ensureWelcomeDiscount(graphql);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error('[welcomeDiscount]', error);
    return Response.json({ ok: false, error: String((error as Error)?.message ?? error) }, { status: 500 });
  }
});
