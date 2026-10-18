// Træk af restbeløb. Butikken trækker selv fra dashboardet (chargeOrders, via
// adminPreorders), når varen er kommet hjem. Den planlagte kørsel
// (runChargeJob / chargeDuePreorders) er slået fra, men koden er her stadig.
//
// For hver forudbestilling med en forfalden, ubetalt betalingsplan:
//   1. er et tidligere forsøg stadig i gang, spørges Shopify om status,
//   2. ellers trækkes restbeløbet med decideCharge + orderCreateMandatePayment,
//   3. hvert forsøg gemmes, så samme træk aldrig sendes to gange.
// Et afvist træk prøves igen næste dag med et nyt forsøgsnummer, højst
// MAX_ATTEMPTS gange. Derefter skal butikken selv tage over.

import { decideCharge } from "../preorder/charge.ts";
import { sellingPlanIds } from "../preorder/cancel.ts";
import type { Graphql } from "../preorder/cancelService.ts";
import {
  ORDER_CREATE_MANDATE_PAYMENT,
  ORDER_PAYMENT_STATUS,
  ORDER_QUERY,
  SELLING_PLAN_CATEGORIES,
} from "../preorder/operations.ts";
import { FULFILLMENT_ORDER_OPEN, PREORDER_CANDIDATES_QUERY, SCHEDULED_FULFILLMENT_ORDERS_QUERY } from "./queries.ts";

export const MAX_ATTEMPTS = 3;
/** Mindst så længe mellem to forsøg på samme betalingsplan. */
export const RETRY_AFTER_HOURS = 20;
/** Hvor langt tilbage der ledes efter ordrer. Forudbestillinger kan ligge længe. */
export const LOOKBACK_DAYS = 400;
const MAX_PAGES = 20;

const IN_PROGRESS = new Set(["INITIATED", "PROCESSING", "PENDING"]);
const SUCCEEDED = new Set(["PURCHASED", "CAPTURED", "AUTHORIZED", "SUCCESS"]);

export type ChargeAttempt = {
  orderId: string;
  orderName?: string;
  scheduleId: string;
  attempt: number;
  status: string;
  paymentReferenceId?: string | null;
  message?: string | null;
  createdAt: string;
};

/** Hvor forsøgene gemmes. I Base44 er det entiteten PreorderCharge. */
export type AttemptStore = {
  last(orderId: string, scheduleId: string): Promise<(ChargeAttempt & { id: string }) | null>;
  add(attempt: ChargeAttempt): Promise<void>;
  update(id: string, changes: Partial<ChargeAttempt>): Promise<void>;
};

export type JobResult = {
  orderId: string;
  orderName?: string;
  outcome: "charged" | "failed" | "pending" | "skipped" | "needs_manual" | "dry_run";
  detail: string;
};

type Candidate = {
  id: string;
  name: string;
  lineItems: { nodes: Array<{ sellingPlan: { sellingPlanId: string | null } | null }> };
  paymentTerms: { paymentSchedules: { nodes: Array<{ id: string; dueAt: string | null; completedAt: string | null }> } } | null;
};

/** Forfaldne, ubetalte betalingsplaner på ordrer med en selling plan. */
export async function findDueCandidates(graphql: Graphql, now: Date): Promise<Candidate[]> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const query = `created_at:>=${since} -status:cancelled -financial_status:paid -financial_status:refunded -financial_status:voided`;
  const due: Candidate[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: any = await graphql(PREORDER_CANDIDATES_QUERY, { after, query });
    for (const order of data.orders.nodes as Candidate[]) {
      const hasPlanLine = order.lineItems.nodes.some((l) => l.sellingPlan?.sellingPlanId);
      const isDue = order.paymentTerms?.paymentSchedules.nodes.some(
        (s) => !s.completedAt && s.dueAt && new Date(s.dueAt).getTime() <= now.getTime(),
      );
      if (hasPlanLine && isDue) due.push(order);
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return due;
}

/**
 * Kun forudbestillinger. Er planen slettet siden købet (node = null), regnes
 * den stadig med — ordren skal trækkes, selv om forudbestillingen er fjernet.
 */
async function isPreorder(graphql: Graphql, order: Candidate): Promise<boolean> {
  const ids = sellingPlanIds(order as any);
  if (ids.length === 0) return false;
  const { nodes } = await graphql<{ nodes: Array<{ id: string; category: string } | null> }>(SELLING_PLAN_CATEGORIES, { ids });
  return nodes.every((n) => n === null || n.category === "PRE_ORDER");
}

async function pollStatus(graphql: Graphql, orderId: string, paymentReferenceId: string, waitMs: number, tries: number) {
  let status: any = null;
  for (let i = 0; i < tries; i++) {
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    status = (await graphql<any>(ORDER_PAYMENT_STATUS, { orderId, paymentReferenceId })).orderPaymentStatus;
    if (!IN_PROGRESS.has(status?.status)) break;
  }
  return status as { status: string; errorMessage?: string | null } | null;
}

type ChargeDeps = {
  graphql: Graphql;
  store: AttemptStore;
  now?: Date;
  dryRun?: boolean;
  /** Ventetid mellem statuskald. 0 i tests. */
  pollWaitMs?: number;
};

/**
 * Trækker restbeløbet på én ordre. `manual` er butikkens knap i dashboardet:
 * så trækkes der, selv om forfaldsdatoen ikke er nået, og et afvist forsøg kan
 * prøves igen med det samme.
 */
async function chargeCandidate(deps: ChargeDeps, candidate: Candidate, opts: { manual: boolean }): Promise<JobResult> {
  const now = deps.now ?? new Date();
  const waitMs = deps.pollWaitMs ?? 1500;
  const base = { orderId: candidate.id, orderName: candidate.name };
  try {
    if (!(await isPreorder(deps.graphql, candidate))) {
      return { ...base, outcome: "skipped", detail: "Ikke en forudbestilling" };
    }
    const { order } = await deps.graphql<any>(ORDER_QUERY, { id: candidate.id });
    const firstDecision = decideCharge(order, { now, force: opts.manual });
    if (!firstDecision.ok) {
      return { ...base, outcome: "skipped", detail: firstDecision.message };
    }
    const scheduleId = firstDecision.input.paymentScheduleId;
    const last = await deps.store.last(candidate.id, scheduleId);

    // Et tidligere forsøg er stadig i gang: spørg Shopify, træk ikke igen.
    if (last && IN_PROGRESS.has(last.status) && last.paymentReferenceId) {
      const status = await pollStatus(deps.graphql, candidate.id, last.paymentReferenceId, 0, 1);
      if (status) await deps.store.update(last.id, { status: status.status, message: status.errorMessage ?? null });
      return { ...base, outcome: "pending", detail: `Forsøg ${last.attempt} har status ${status?.status ?? "ukendt"}` };
    }
    if (last && SUCCEEDED.has(last.status)) {
      return { ...base, outcome: "skipped", detail: `Forsøg ${last.attempt} lykkedes allerede` };
    }
    const attempt = last ? last.attempt + 1 : 1;
    if (last && attempt > MAX_ATTEMPTS) {
      return { ...base, outcome: "needs_manual", detail: `${MAX_ATTEMPTS} forsøg afvist — træk manuelt eller kontakt kunden` };
    }
    // Den planlagte kørsel venter mellem forsøg; trykker butikken selv, prøves der med det samme.
    if (!opts.manual && last && now.getTime() - new Date(last.createdAt).getTime() < RETRY_AFTER_HOURS * 3_600_000) {
      return { ...base, outcome: "skipped", detail: `Forsøg ${last.attempt} blev afvist for nylig; prøver igen senere` };
    }

    const decision = decideCharge(order, { now, attempt, force: opts.manual });
    if (!decision.ok) {
      return { ...base, outcome: "skipped", detail: decision.message };
    }
    if (deps.dryRun) {
      return { ...base, outcome: "dry_run", detail: `Ville trække ${decision.expectedAmount.amount} ${decision.expectedAmount.currencyCode} (forsøg ${attempt})` };
    }

    const res = await deps.graphql<any>(ORDER_CREATE_MANDATE_PAYMENT, decision.input);
    const payload = res.orderCreateMandatePayment;
    if (payload.userErrors.length > 0 || !payload.paymentReferenceId) {
      const message = payload.userErrors.map((e: any) => e.message).join("; ") || "Intet paymentReferenceId";
      await deps.store.add({ ...base, scheduleId, attempt, status: "ERROR", message, createdAt: now.toISOString() });
      return { ...base, outcome: "failed", detail: message };
    }
    // Gem forsøget, før der ventes på status, så et nyt kørsel ikke trækker igen.
    await deps.store.add({
      ...base,
      scheduleId,
      attempt,
      status: "INITIATED",
      paymentReferenceId: payload.paymentReferenceId,
      createdAt: now.toISOString(),
    });
    const saved = await deps.store.last(candidate.id, scheduleId);
    const status = await pollStatus(deps.graphql, candidate.id, payload.paymentReferenceId, waitMs, 8);
    if (saved && status) await deps.store.update(saved.id, { status: status.status, message: status.errorMessage ?? null });
    const outcome = status && SUCCEEDED.has(status.status) ? "charged" : status && IN_PROGRESS.has(status.status) ? "pending" : "failed";
    return {
      ...base,
      outcome,
      detail: `${decision.expectedAmount.amount} ${decision.expectedAmount.currencyCode}: ${status?.status ?? "ukendt"}${status?.errorMessage ? ` (${status.errorMessage})` : ""}`,
    };
  } catch (error) {
    return { ...base, outcome: "failed", detail: (error as Error).message };
  }
}

/** Den planlagte kørsel: alle forfaldne forudbestillinger. Slået fra i Base44 — se README. */
export async function runChargeJob(deps: ChargeDeps): Promise<JobResult[]> {
  const now = deps.now ?? new Date();
  const results: JobResult[] = [];
  for (const candidate of await findDueCandidates(deps.graphql, now)) {
    results.push(await chargeCandidate({ ...deps, now }, candidate, { manual: false }));
  }
  return results;
}

/** Butikkens knap «Træk restbeløb»: de valgte ordrer, en ad gangen. */
export async function chargeOrders(deps: ChargeDeps, orderIds: string[]): Promise<JobResult[]> {
  const now = deps.now ?? new Date();
  const results: JobResult[] = [];
  for (const id of [...new Set(orderIds)]) {
    const { order } = await deps.graphql<any>(ORDER_QUERY, { id });
    if (!order) {
      results.push({ orderId: id, outcome: "failed", detail: "Ordren findes ikke" });
      continue;
    }
    const result = await chargeCandidate({ ...deps, now }, order as Candidate, { manual: true });
    if (result.outcome === "charged") result.detail += await openScheduledFulfillments(deps.graphql, id);
    results.push(result);
  }
  return results;
}

/**
 * Forsendelsen er planlagt til forfaldsdatoen og kan ikke sendes før.
 * Trækker butikken tidligere, fordi varen er kommet, åbnes den, så ordren kan
 * sendes med det samme (også fra fragtmodulet). Svarer med en tekst til resultatet.
 */
export async function openScheduledFulfillments(graphql: Graphql, orderId: string): Promise<string> {
  try {
    const data: any = await graphql(SCHEDULED_FULFILLMENT_ORDERS_QUERY, { id: orderId });
    const scheduled = (data.order?.fulfillmentOrders.nodes ?? []).filter((f: any) => f.status === "SCHEDULED");
    for (const fo of scheduled) {
      const res: any = await graphql(FULFILLMENT_ORDER_OPEN, { id: fo.id });
      const errors = res.fulfillmentOrderOpen.userErrors;
      if (errors.length > 0) return ` — forsendelsen kunne ikke åbnes: ${errors.map((e: any) => e.message).join("; ")}`;
    }
    return scheduled.length > 0 ? " — klar til afsendelse" : "";
  } catch (error) {
    return ` — forsendelsen kunne ikke åbnes: ${(error as Error).message}`;
  }
}
