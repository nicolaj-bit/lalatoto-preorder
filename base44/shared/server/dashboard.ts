// Data til Base44-dashboardet (funktionen listPreorders).
//
// Hentes direkte fra Shopify, når dashboardet åbnes, så kundedata ikke ligger
// i en kopi i Base44. Kortoplysninger hentes aldrig (ingen
// vaultedPaymentMethods i forespørgslen).

import type { Graphql } from "../preorder/cancelService.ts";
import type { ChargeAttempt } from "./chargeJob.ts";
import { DASHBOARD_ORDERS_QUERY } from "./queries.ts";

const MAX_PAGES = 10;

export type PreorderRow = {
  orderId: string;
  orderNumber: string;
  adminUrl: string;
  createdAt: string;
  status: "annulleret" | "betalt" | "afventer betaling" | "forfalden";
  fulfillment: string;
  customer: { name: string | null; email: string | null; phone: string | null };
  shippingAddress: string | null;
  items: string[];
  total: string;
  received: string;
  outstanding: string;
  currency: string;
  dueAt: string | null;
  lastAttempt: { attempt: number; status: string; message: string | null; createdAt: string } | null;
};

function money(amount: string): string {
  return Number(amount).toFixed(2);
}

export function toRow(order: any, store: string, now: Date, lastAttempt?: ChargeAttempt | null): PreorderRow {
  const schedule = order.paymentTerms?.paymentSchedules.nodes.find((s: any) => !s.completedAt) ??
    order.paymentTerms?.paymentSchedules.nodes[0];
  const outstanding = Number(order.totalOutstandingSet.shopMoney.amount);
  const dueAt: string | null = schedule?.dueAt ?? null;
  let status: PreorderRow["status"];
  if (order.cancelledAt) status = "annulleret";
  else if (outstanding <= 0) status = "betalt";
  else if (dueAt && new Date(dueAt).getTime() <= now.getTime()) status = "forfalden";
  else status = "afventer betaling";
  const a = order.shippingAddress;
  return {
    orderId: order.id,
    orderNumber: order.name,
    adminUrl: `https://admin.shopify.com/store/${store.replace(/\.myshopify\.com$/, "")}/orders/${order.id.split("/").pop()}`,
    createdAt: order.createdAt,
    status,
    fulfillment: order.displayFulfillmentStatus,
    customer: {
      name: order.customer?.displayName ?? a?.name ?? null,
      email: order.customer?.email ?? null,
      phone: order.customer?.phone ?? a?.phone ?? null,
    },
    shippingAddress: a ? [a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ") : null,
    items: order.lineItems.nodes.map((l: any) => `${l.quantity} × ${l.title}`),
    total: money(order.totalPriceSet.shopMoney.amount),
    received: money(order.totalReceivedSet.shopMoney.amount),
    outstanding: money(order.totalOutstandingSet.shopMoney.amount),
    currency: order.totalPriceSet.shopMoney.currencyCode,
    dueAt,
    lastAttempt: lastAttempt
      ? { attempt: lastAttempt.attempt, status: lastAttempt.status, message: lastAttempt.message ?? null, createdAt: lastAttempt.createdAt }
      : null,
  };
}

/** Ordrer med en betalingsaftale og mindst én linje med selling plan. */
export function isPreorderOrder(order: any): boolean {
  return Boolean(order.paymentTerms) && order.lineItems.nodes.some((l: any) => l.sellingPlan?.sellingPlanId);
}

export async function listPreorderRows(
  graphql: Graphql,
  opts: { store: string; now?: Date; attempts?: (orderId: string) => ChargeAttempt | null | undefined },
): Promise<PreorderRow[]> {
  const now = opts.now ?? new Date();
  const rows: PreorderRow[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: any = await graphql(DASHBOARD_ORDERS_QUERY, { after });
    for (const order of data.orders.nodes) {
      if (isPreorderOrder(order)) rows.push(toRow(order, opts.store, now, opts.attempts?.(order.id)));
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return rows;
}
