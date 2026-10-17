// KOPI — genereret af scripts/base44-sync.ts. Ret i app/lib, ikke her.
// Forudbestillinger på produkter: vis, opret og fjern. Bruges af blokken
// «Forudbestilling» på produktet i admin (extensions/preorder-produkt).
//
// En forudbestilling er én selling plan group fra appen med én PRE_ORDER-plan,
// knyttet til ét produkt. Når den oprettes, sker tre ting:
//   1. gruppen oprettes og knyttes til produktet,
//   2. produktet sættes til requiresSellingPlan, så det kun kan købes som
//      forudbestilling (ellers kan det købes til fuld pris, som ordre #1002),
//   3. datoen gemmes i produktets metafelt lalatoto_preorder.info, så
//      temablokken kan vise den — Liquid kender ikke planens datoer.

import {
  FIXED_PAYMENT_TERMS_TEMPLATE_QUERY,
  FULFILLMENT_ORDER_RESCHEDULE,
  METAFIELDS_DELETE,
  METAFIELDS_SET,
  OPEN_PREORDER_ORDERS_QUERY,
  PAYMENT_TERMS_UPDATE,
  PREORDER_GROUPS_QUERY,
  PRODUCT_PREORDER_QUERY,
  PREORDER_PRODUCT_UPDATE,
  SELLING_PLAN_GROUP_CREATE,
  SELLING_PLAN_GROUP_DELETE,
  SELLING_PLAN_GROUP_UPDATE,
} from "./operations.ts";
import { formatDanishDate, localDateTimeToUtc } from "./dates.ts";
import { buildPreorderDateUpdateInput, buildPreorderSellingPlanGroupInput, PREORDER_APP_ID } from "./sellingPlan.ts";
import type { Graphql } from "./cancelService.ts";

export const INFO_NAMESPACE = "lalatoto_preorder";
export const INFO_KEY = "info";

export type PreorderSummary = {
  groupId: string;
  sellingPlanId: string;
  chargeAt: string | null;
  depositPercent: number | null;
  products: Array<{ id: string; title: string; handle: string; requiresSellingPlan: boolean }>;
};

type GroupNode = {
  id: string;
  appId: string | null;
  merchantCode: string;
  products: { nodes: PreorderSummary["products"] };
  sellingPlans: {
    nodes: Array<{
      id: string;
      category: string | null;
      billingPolicy: {
        checkoutCharge?: { type: string; value: { percentage?: number } };
        remainingBalanceChargeExactTime?: string | null;
      } | null;
    }>;
  };
};

/** Appens egne grupper: appId fra nu af, merchantCode-præfiks for dem fra beviset. */
export function isOwnGroup(group: Pick<GroupNode, "appId" | "merchantCode">): boolean {
  return group.appId === PREORDER_APP_ID || group.merchantCode.startsWith("lalatoto-preorder");
}

export function summarizeGroups(groups: GroupNode[]): PreorderSummary[] {
  return groups.filter(isOwnGroup).flatMap((group) => {
    const plan = group.sellingPlans.nodes.find((p) => p.category === "PRE_ORDER");
    if (!plan) return [];
    const charge = plan.billingPolicy?.checkoutCharge;
    return [
      {
        groupId: group.id,
        sellingPlanId: plan.id,
        chargeAt: plan.billingPolicy?.remainingBalanceChargeExactTime ?? null,
        depositPercent: charge?.type === "PERCENTAGE" ? (charge.value.percentage ?? null) : null,
        products: group.products.nodes,
      },
    ];
  });
}

export async function listPreorders(graphql: Graphql): Promise<PreorderSummary[]> {
  const data = await graphql<{ sellingPlanGroups: { nodes: GroupNode[] } }>(PREORDER_GROUPS_QUERY);
  return summarizeGroups(data.sellingPlanGroups.nodes);
}

/** Forudbestillingen på ét produkt, eller null. */
export async function productPreorder(graphql: Graphql, productId: string): Promise<PreorderSummary | null> {
  const data = await graphql<{ product: { sellingPlanGroups: { nodes: GroupNode[] } } | null }>(
    PRODUCT_PREORDER_QUERY,
    { id: productId },
  );
  if (!data.product) return null;
  return summarizeGroups(data.product.sellingPlanGroups.nodes)[0] ?? null;
}

/** Det, temablokken læser i lalatoto_preorder.info. */
export function preorderInfo(chargeAt: Date, depositPercent: number, sellingPlanId: string) {
  return {
    sellingPlanId,
    chargeAt: chargeAt.toISOString(),
    /** Liquids date-filter kender ikke danske månedsnavne. */
    chargeDateText: formatDanishDate(chargeAt),
    depositPercent,
  };
}

function userErrorsMessage(label: string, errors: Array<{ message: string }> | undefined): string | null {
  return errors && errors.length > 0 ? `${label}: ${errors.map((e) => e.message).join("; ")}` : null;
}

export type CreatePreorderResult =
  | { ok: true; groupId: string; sellingPlanId: string; chargeAt: string }
  | { ok: false; message: string };

/**
 * @param chargeDate «ÅÅÅÅ-MM-DD». Restbeløbet trækkes kl. 9 dansk tid den dag,
 *   og varen sendes tidligst samme tidspunkt.
 */
export async function createPreorder(
  graphql: Graphql,
  opts: { productId: string; chargeDate: string; depositPercent?: number; now?: Date },
): Promise<CreatePreorderResult> {
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(opts.productId)) {
    return { ok: false, message: "Vælg et produkt" };
  }
  let chargeAt: Date;
  let input: ReturnType<typeof buildPreorderSellingPlanGroupInput>;
  const depositPercent = opts.depositPercent ?? 0;
  try {
    chargeAt = localDateTimeToUtc(opts.chargeDate, 9, 0);
    input = buildPreorderSellingPlanGroupInput({
      chargeAt,
      depositPercent,
      merchantCode: `lalatoto-preorder-${opts.productId.split("/").pop()}-${Date.now()}`,
      now: opts.now,
    });
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }

  const created = await graphql<any>(SELLING_PLAN_GROUP_CREATE, {
    input,
    resources: { productIds: [opts.productId] },
  });
  const createError = userErrorsMessage("Planen kunne ikke oprettes", created.sellingPlanGroupCreate.userErrors);
  if (createError) return { ok: false, message: createError };
  const group = created.sellingPlanGroupCreate.sellingPlanGroup;
  const sellingPlanId: string = group.sellingPlans.nodes[0].id;

  const updated = await graphql<any>(PREORDER_PRODUCT_UPDATE, {
    product: { id: opts.productId, requiresSellingPlan: true },
  });
  const meta = await graphql<any>(METAFIELDS_SET, {
    metafields: [
      {
        ownerId: opts.productId,
        namespace: INFO_NAMESPACE,
        key: INFO_KEY,
        type: "json",
        value: JSON.stringify(preorderInfo(chargeAt, depositPercent, sellingPlanId)),
      },
    ],
  });
  const followUpError =
    userErrorsMessage("Produktet kunne ikke låses til forudbestilling", updated.productUpdate.userErrors) ??
    userErrorsMessage("Datoen kunne ikke gemmes på produktet", meta.metafieldsSet.userErrors);
  if (followUpError) {
    // Planen findes nu, men produktet er ikke færdigt. Ryd op, så dashboardet
    // ikke viser en halv forudbestilling.
    await removePreorder(graphql, { groupId: group.id, productIds: [opts.productId] });
    return { ok: false, message: followUpError };
  }
  return { ok: true, groupId: group.id, sellingPlanId, chargeAt: chargeAt.toISOString() };
}

/**
 * Fjerner planen og låser produkterne op igen. Allerede lagte ordrer beholder
 * deres betalingsaftale; de skal stadig trækkes eller annulleres.
 */
export async function removePreorder(
  graphql: Graphql,
  opts: { groupId: string; productIds: string[] },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const errors: string[] = [];
  for (const id of opts.productIds) {
    const updated = await graphql<any>(PREORDER_PRODUCT_UPDATE, { product: { id, requiresSellingPlan: false } });
    const e = userErrorsMessage("Produktet kunne ikke låses op", updated.productUpdate.userErrors);
    if (e) errors.push(e);
  }
  if (opts.productIds.length > 0) {
    const deleted = await graphql<any>(METAFIELDS_DELETE, {
      metafields: opts.productIds.map((ownerId) => ({ ownerId, namespace: INFO_NAMESPACE, key: INFO_KEY })),
    });
    const e = userErrorsMessage("Datoen kunne ikke fjernes fra produktet", deleted.metafieldsDelete.userErrors);
    if (e) errors.push(e);
  }
  const res = await graphql<any>(SELLING_PLAN_GROUP_DELETE, { id: opts.groupId });
  const e = userErrorsMessage("Planen kunne ikke slettes", res.sellingPlanGroupDelete.userErrors);
  if (e) errors.push(e);
  return errors.length > 0 ? { ok: false, message: errors.join(" · ") } : { ok: true };
}

/** Hvor langt tilbage der ledes efter lagte ordrer på planen. */
const ORDER_LOOKBACK_DAYS = 400;
const MAX_ORDER_PAGES = 20;

type OpenOrder = {
  id: string;
  name: string;
  lineItems: { nodes: Array<{ sellingPlan: { sellingPlanId: string | null } | null }> };
  paymentTerms: { id: string; paymentSchedules: { nodes: Array<{ id: string; dueAt: string | null; completedAt: string | null }> } } | null;
  fulfillmentOrders: { nodes: Array<{ id: string; status: string; fulfillAt: string | null }> };
};

/** Ikke-annullerede, ikke-betalte ordrer med en linje på planen og en åben betalingsplan. */
export async function openOrdersOnPlan(graphql: Graphql, sellingPlanId: string, now: Date = new Date()): Promise<OpenOrder[]> {
  const since = new Date(now.getTime() - ORDER_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const query = `created_at:>=${since} -status:cancelled -financial_status:paid -financial_status:refunded -financial_status:voided`;
  const found: OpenOrder[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    const data: any = await graphql(OPEN_PREORDER_ORDERS_QUERY, { after, query });
    for (const order of data.orders.nodes as OpenOrder[]) {
      const onPlan = order.lineItems.nodes.some((l) => l.sellingPlan?.sellingPlanId === sellingPlanId);
      const open = order.paymentTerms?.paymentSchedules.nodes.some((s) => !s.completedAt);
      if (onPlan && open) found.push(order);
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return found;
}

export type ChangeDateResult =
  | { ok: true; chargeAt: string; ordersMoved: string[]; orderErrors: string[] }
  | { ok: false; message: string };

/**
 * Flytter forudbestillingens dato: planen (nye køb), datoen på produkterne
 * (temablokken) og forfalds- og klargøringsdatoen på allerede lagte ordrer.
 * Fejler en ordre, flyttes de andre stadig; fejlene kommer med i svaret.
 *
 * @param chargeDate «ÅÅÅÅ-MM-DD». Restbeløbet trækkes kl. 9 dansk tid den dag.
 */
export async function changePreorderDate(
  graphql: Graphql,
  opts: {
    groupId: string;
    sellingPlanId: string;
    productIds: string[];
    chargeDate: string;
    depositPercent: number;
    now?: Date;
  },
): Promise<ChangeDateResult> {
  let chargeAt: Date;
  let input: ReturnType<typeof buildPreorderDateUpdateInput>;
  try {
    chargeAt = localDateTimeToUtc(opts.chargeDate, 9, 0);
    input = buildPreorderDateUpdateInput({
      sellingPlanId: opts.sellingPlanId,
      chargeAt,
      depositPercent: opts.depositPercent,
      now: opts.now,
    });
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }

  const updated = await graphql<any>(SELLING_PLAN_GROUP_UPDATE, { id: opts.groupId, input });
  const planError = userErrorsMessage("Planen kunne ikke opdateres", updated.sellingPlanGroupUpdate.userErrors);
  if (planError) return { ok: false, message: planError };

  if (opts.productIds.length > 0) {
    const meta = await graphql<any>(METAFIELDS_SET, {
      metafields: opts.productIds.map((ownerId) => ({
        ownerId,
        namespace: INFO_NAMESPACE,
        key: INFO_KEY,
        type: "json",
        value: JSON.stringify(preorderInfo(chargeAt, opts.depositPercent, opts.sellingPlanId)),
      })),
    });
    const metaError = userErrorsMessage("Datoen kunne ikke gemmes på produktet", meta.metafieldsSet.userErrors);
    if (metaError) return { ok: false, message: metaError };
  }

  const at = chargeAt.toISOString();
  const ordersMoved: string[] = [];
  const orderErrors: string[] = [];
  const orders = await openOrdersOnPlan(graphql, opts.sellingPlanId, opts.now);
  let templateId: string | undefined;
  if (orders.length > 0) {
    const templates = await graphql<any>(FIXED_PAYMENT_TERMS_TEMPLATE_QUERY);
    templateId = templates.paymentTermsTemplates[0]?.id;
  }
  for (const order of orders) {
    try {
      const terms = await graphql<any>(PAYMENT_TERMS_UPDATE, {
        input: {
          paymentTermsId: order.paymentTerms!.id,
          paymentTermsAttributes: { ...(templateId ? { paymentTermsTemplateId: templateId } : {}), paymentSchedules: [{ dueAt: at }] },
        },
      });
      const termsError = userErrorsMessage(`${order.name}: forfaldsdatoen`, terms.paymentTermsUpdate.userErrors);
      if (termsError) {
        orderErrors.push(termsError);
        continue;
      }
      for (const fo of order.fulfillmentOrders.nodes.filter((f) => f.status === "SCHEDULED")) {
        const moved = await graphql<any>(FULFILLMENT_ORDER_RESCHEDULE, { id: fo.id, fulfillAt: at });
        const e = userErrorsMessage(`${order.name}: klargøringsdatoen`, moved.fulfillmentOrderReschedule.userErrors);
        if (e) orderErrors.push(e);
      }
      ordersMoved.push(order.name);
    } catch (err) {
      orderErrors.push(`${order.name}: ${(err as Error).message}`);
    }
  }
  return { ok: true, chargeAt: at, ordersMoved, orderErrors };
}
