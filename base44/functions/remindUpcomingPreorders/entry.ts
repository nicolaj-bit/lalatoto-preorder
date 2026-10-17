import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { runReminderJob } from '../../shared/server/reminderJob.ts';
import { createShopifyGraphql, shopifyEnv } from '../../shared/server/shopify.ts';

// Sender én mail til appens admin-brugere med de forudbestillinger, der
// forfalder om 7 dage. Køres dagligt af workflowet «Påmindelse før forfald».
// En admin kan kalde den med { dryRun: true } for at se mailen uden at sende.
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
    const { rows, email } = await runReminderJob({ graphql: createShopifyGraphql(env), store: env.store });
    if (!email) return Response.json({ ok: true, sent: [], orders: [] });

    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    const recipients: string[] = admins.map((u: any) => u.email).filter(Boolean);
    if (body?.dryRun !== true) {
      for (const to of recipients) {
        await base44.asServiceRole.integrations.Core.SendEmail({ to, subject: email.subject, body: email.body });
      }
    }
    const orders = rows.map((r) => r.orderNumber);
    console.log(`[remindUpcomingPreorders] ${orders.join(', ')} → ${recipients.length} admin(s)${body?.dryRun ? ' (prøvekørsel)' : ''}`);
    return Response.json({ ok: true, sent: body?.dryRun === true ? [] : recipients, orders, email });
  } catch (error) {
    console.error('[remindUpcomingPreorders]', error);
    return Response.json({ ok: false, error: String((error as Error)?.message ?? error) }, { status: 500 });
  }
});
