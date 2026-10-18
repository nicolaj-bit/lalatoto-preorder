// KOPI — genereret af scripts/base44-sync.ts. Ret i app/lib, ikke her.
// Afgør, om kunden selv må annullere en forudbestilling, og hvad orderCancel
// skal have med.
//
// Ren logik uden netværk, ligesom charge.ts. Kaldes fra endepunktet, som
// kundekontoens knap «Annuller forudbestilling» rammer. Shopify kræver, at
// kunden kan annullere inde i løsningen, og at pengene gives tilbage
// (docs/forudsaetninger.md afsnit 1.7).

import { toMinor, type Money } from "./money.ts";

export type CancelOrder = {
  id: string;
  name?: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  customer: { id: string } | null;
  totalReceivedSet: { shopMoney: Money };
  paymentTerms: { id: string } | null;
  lineItems: { nodes: Array<{ sellingPlan: { sellingPlanId: string | null } | null }> };
};

export type CancelBlocker =
  | "NOT_FOUND"
  | "NOT_OWNER"
  | "NOT_PREORDER"
  | "ALREADY_CANCELLED"
  | "FULFILLED";

export type CancelDecision =
  | {
      ok: true;
      input: {
        orderId: string;
        reason: "CUSTOMER";
        restock: true;
        notifyCustomer: true;
        staffNote: string;
        refundMethod?: { originalPaymentMethodsRefund: true };
      };
      /** Om kunden får penge tilbage (der var trukket noget). */
      refunds: boolean;
    }
  | { ok: false; reason: CancelBlocker; message: string };

/**
 * Status, hvor varen endnu ikke er sendt. SCHEDULED er en forudbestilling
 * før dens afsendelsesdato; UNFULFILLED og ON_HOLD er klar, men ikke sendt.
 */
const CANCELLABLE_FULFILLMENT = new Set(["SCHEDULED", "UNFULFILLED", "ON_HOLD"]);

/**
 * @param preorderPlanIds id'er på de selling plans på ordren, som er denne
 *   apps egne PRE_ORDER-planer. Hentes særskilt, fordi linjen kun kender
 *   planens id og navn.
 */
export function decideCancel(
  order: CancelOrder | null,
  opts: { customerId: string | null | undefined; preorderPlanIds: ReadonlySet<string> },
): CancelDecision {
  if (!order) {
    return { ok: false, reason: "NOT_FOUND", message: "Ordren findes ikke" };
  }
  // Uden kunde-id i session token ved vi ikke, hvem der spørger. Så nej.
  if (!opts.customerId || order.customer?.id !== opts.customerId) {
    return { ok: false, reason: "NOT_OWNER", message: "Ordren tilhører ikke den kunde, der er logget ind" };
  }
  const hasPreorderLine = order.lineItems.nodes.some(
    (line) => line.sellingPlan?.sellingPlanId && opts.preorderPlanIds.has(line.sellingPlan.sellingPlanId),
  );
  if (!order.paymentTerms || !hasPreorderLine) {
    return { ok: false, reason: "NOT_PREORDER", message: "Ordren er ikke en forudbestilling" };
  }
  if (order.cancelledAt) {
    return { ok: false, reason: "ALREADY_CANCELLED", message: `Ordren blev annulleret ${order.cancelledAt}` };
  }
  if (!CANCELLABLE_FULFILLMENT.has(order.displayFulfillmentStatus)) {
    return {
      ok: false,
      reason: "FULFILLED",
      message: `Ordren er sendt eller ved at blive sendt (${order.displayFulfillmentStatus})`,
    };
  }

  const refunds = toMinor(order.totalReceivedSet.shopMoney.amount) > 0;
  return {
    ok: true,
    input: {
      orderId: order.id,
      reason: "CUSTOMER",
      restock: true,
      notifyCustomer: true,
      staffNote: "Annulleret af kunden i kundekontoen (Lalatoto Forudbestilling)",
      ...(refunds ? { refundMethod: { originalPaymentMethodsRefund: true as const } } : {}),
    },
    refunds,
  };
}

/** Selling plan-id'er på ordrens linjer, til opslag af deres category. */
export function sellingPlanIds(order: CancelOrder): string[] {
  const ids = order.lineItems.nodes
    .map((line) => line.sellingPlan?.sellingPlanId)
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}
