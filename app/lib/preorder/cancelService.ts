// Henter ordren, spørger decideCancel og annullerer. Får GraphQL-kaldet ind
// udefra, så samme kode bruges af endepunktet (Remix' admin-klient), af
// scripts og af tests med et falsk Shopify.

import { CANCEL_ORDER_QUERY, ORDER_CANCEL, SELLING_PLAN_CATEGORIES } from "../shopify/operations";
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
    const ids = sellingPlanIds(order);
    if (ids.length > 0) {
      const { nodes } = await graphql<{ nodes: Array<{ id: string; category: string } | null> }>(
        SELLING_PLAN_CATEGORIES,
        { ids },
      );
      preorderPlanIds = new Set(nodes.filter((n) => n?.category === "PRE_ORDER").map((n) => n!.id));
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
