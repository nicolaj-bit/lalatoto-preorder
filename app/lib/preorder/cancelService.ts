// Henter ordren, spørger decideCancel og annullerer. Får GraphQL-kaldet ind
// udefra, så samme kode bruges af endepunktet (Remix' admin-klient), af
// scripts og af tests med et falsk Shopify.

import { CANCEL_ORDER_QUERY, ORDER_CANCEL, OWN_PREORDER_PLANS } from "../shopify/operations";
import { isOwnGroup } from "./catalog";
import { decideCancel, sellingPlanIds, type CancelDecision, type CancelOrder } from "./cancel";

export type Graphql = <T = any>(query: string, variables?: Record<string, unknown>) => Promise<T>;

const ORDER_GID = /^gid:\/\/shopify\/Order\/\d+$/;

export async function evaluateCancel(
  graphql: Graphql,
  orderId: string,
  customerId: string | null | undefined,
): Promise<CancelDecision> {
  if (!ORDER_GID.test(orderId)) {
    return { ok: false, reason: "NOT_FOUND", message: "Ugyldigt ordre-id" };
  }
  const { order } = await graphql<{ order: CancelOrder | null }>(CANCEL_ORDER_QUERY, { id: orderId });
  let preorderPlanIds = new Set<string>();
  if (order) {
    const ids = new Set(sellingPlanIds(order));
    if (ids.size > 0) {
      // Kun appens egne forudbestillingsplaner. Ordrer fra andre apps
      // (fx Essential Preorder) kan kunden ikke annullere her.
      const { sellingPlanGroups } = await graphql<{
        sellingPlanGroups: {
          nodes: Array<{
            appId: string | null;
            merchantCode: string;
            sellingPlans: { nodes: Array<{ id: string; category: string | null }> };
          }>;
        };
      }>(OWN_PREORDER_PLANS);
      for (const group of sellingPlanGroups.nodes.filter(isOwnGroup)) {
        for (const plan of group.sellingPlans.nodes) {
          if (plan.category === "PRE_ORDER" && ids.has(plan.id)) preorderPlanIds.add(plan.id);
        }
      }
    }
  }
  return decideCancel(order, { customerId, preorderPlanIds });
}

export type CancelResult =
  | { ok: true; refunds: boolean; jobId: string | null }
  | { ok: false; reason: string; message: string };

export async function performCancel(
  graphql: Graphql,
  orderId: string,
  customerId: string | null | undefined,
): Promise<CancelResult> {
  const decision = await evaluateCancel(graphql, orderId, customerId);
  if (!decision.ok) return decision;

  const res = await graphql<{
    orderCancel: {
      job: { id: string; done: boolean } | null;
      orderCancelUserErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>(ORDER_CANCEL, decision.input);
  const errors = res.orderCancel.orderCancelUserErrors;
  if (errors.length > 0) {
    return { ok: false, reason: "SHOPIFY_ERROR", message: errors.map((e) => e.message).join("; ") };
  }
  return { ok: true, refunds: decision.refunds, jobId: res.orderCancel.job?.id ?? null };
}
