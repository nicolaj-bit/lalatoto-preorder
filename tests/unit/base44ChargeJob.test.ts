import { describe, expect, it } from "vitest";
import { runChargeJob, type AttemptStore, type ChargeAttempt } from "../../base44/shared/server/chargeJob.ts";
import type { Graphql } from "../../app/lib/preorder/cancelService";

const ORDER = "gid://shopify/Order/1001";
const PLAN = "gid://shopify/SellingPlan/7";
const SCHEDULE = "gid://shopify/PaymentSchedule/88";
const afterDue = new Date("2026-11-12T08:15:00Z");

function fullOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER,
    name: "#1001",
    cancelledAt: null,
    totalOutstandingSet: { shopMoney: { amount: "548.0", currencyCode: "DKK" } },
    paymentTerms: {
      id: "gid://shopify/PaymentTerms/1",
      paymentSchedules: {
        nodes: [{ id: SCHEDULE, dueAt: "2026-11-12T08:00:00Z", completedAt: null, balanceDue: { amount: "548.0", currencyCode: "DKK" }, totalBalance: { amount: "548.0", currencyCode: "DKK" } }],
      },
    },
    paymentCollectionDetails: {
      vaultedPaymentMethods: [{ id: "gid://shopify/PaymentMandate/5", paymentInstrument: { __typename: "VaultCreditCard", expiryMonth: 9, expiryYear: 2028, expired: false } }],
    },
    ...overrides,
  };
}

function fakeShopify(opts: { category?: string | null; paymentStatus?: string; mutationErrors?: string[]; candidates?: any[] } = {}) {
  const calls: Array<{ name: string; variables?: any }> = [];
  const graphql: Graphql = async (query, variables) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?";
    calls.push({ name, variables });
    switch (name) {
      case "ForudbestillingsOrdrer":
        return {
          orders: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: opts.candidates ?? [
              {
                id: ORDER,
                name: "#1001",
                lineItems: { nodes: [{ sellingPlan: { sellingPlanId: PLAN } }] },
                paymentTerms: { id: "t", paymentSchedules: { nodes: [{ id: SCHEDULE, dueAt: "2026-11-12T08:00:00Z", completedAt: null }] } },
              },
            ],
          },
        } as any;
      case "PlanKategorier":
        return { nodes: [opts.category === null ? null : { id: PLAN, category: opts.category ?? "PRE_ORDER" }] } as any;
      case "Ordre":
        return { order: fullOrder() } as any;
      case "TraekRestbeloeb":
        return {
          orderCreateMandatePayment: {
            job: { id: "j", done: false },
            paymentReferenceId: opts.mutationErrors ? null : "1001/po-1001-88-1",
            userErrors: (opts.mutationErrors ?? []).map((message) => ({ message })),
          },
        } as any;
      case "Betalingsstatus":
        return { orderPaymentStatus: { status: opts.paymentStatus ?? "PURCHASED", errorMessage: null } } as any;
      default:
        throw new Error(`Uventet kald: ${name}`);
    }
  };
  return { graphql, calls };
}

function memoryStore(initial: Array<ChargeAttempt & { id: string }> = []) {
  const rows = [...initial];
  const store: AttemptStore = {
    async last(orderId, scheduleId) {
      return rows.filter((r) => r.orderId === orderId && r.scheduleId === scheduleId).sort((a, b) => b.attempt - a.attempt)[0] ?? null;
    },
    async add(a) {
      rows.push({ ...a, id: `r${rows.length + 1}` });
    },
    async update(id, changes) {
      Object.assign(rows.find((r) => r.id === id)!, changes);
    },
  };
  return { store, rows };
}

const run = (s: ReturnType<typeof fakeShopify>, m: ReturnType<typeof memoryStore>, extra = {}) =>
  runChargeJob({ graphql: s.graphql, store: m.store, now: afterDue, pollWaitMs: 0, ...extra });

describe("runChargeJob", () => {
  it("trækker en forfalden forudbestilling og gemmer forsøget", async () => {
    const s = fakeShopify();
    const m = memoryStore();
    const results = await run(s, m);
    expect(results).toEqual([{ orderId: ORDER, orderName: "#1001", outcome: "charged", detail: "548.00 DKK: PURCHASED" }]);
    expect(m.rows).toMatchObject([{ attempt: 1, status: "PURCHASED", paymentReferenceId: "1001/po-1001-88-1" }]);
    const charge = s.calls.find((c) => c.name === "TraekRestbeloeb");
    expect(charge?.variables).toMatchObject({ idempotencyKey: "po-1001-88-1", paymentScheduleId: SCHEDULE });
    expect(charge?.variables.amount).toBeUndefined();
  });

  it("trækker ikke i en prøvekørsel", async () => {
    const s = fakeShopify();
    const m = memoryStore();
    expect(await run(s, m, { dryRun: true })).toMatchObject([{ outcome: "dry_run" }]);
    expect(s.calls.some((c) => c.name === "TraekRestbeloeb")).toBe(false);
    expect(m.rows).toEqual([]);
  });

  it("trækker ikke igen, mens et forsøg er i gang", async () => {
    const s = fakeShopify({ paymentStatus: "PROCESSING" });
    const m = memoryStore([{ id: "r1", orderId: ORDER, scheduleId: SCHEDULE, attempt: 1, status: "INITIATED", paymentReferenceId: "ref", createdAt: afterDue.toISOString() }]);
    expect(await run(s, m)).toMatchObject([{ outcome: "pending" }]);
    expect(s.calls.some((c) => c.name === "TraekRestbeloeb")).toBe(false);
    expect(m.rows[0].status).toBe("PROCESSING");
  });

  it("prøver igen med nyt forsøgsnummer dagen efter en afvisning", async () => {
    const s = fakeShopify();
    const yesterday = new Date(afterDue.getTime() - 24 * 3_600_000).toISOString();
    const m = memoryStore([{ id: "r1", orderId: ORDER, scheduleId: SCHEDULE, attempt: 1, status: "ERROR", createdAt: yesterday }]);
    expect(await run(s, m)).toMatchObject([{ outcome: "charged" }]);
    expect(s.calls.find((c) => c.name === "TraekRestbeloeb")?.variables.idempotencyKey).toBe("po-1001-88-2");
  });

  it("venter med nyt forsøg, når afvisningen er fra i dag", async () => {
    const s = fakeShopify();
    const m = memoryStore([{ id: "r1", orderId: ORDER, scheduleId: SCHEDULE, attempt: 1, status: "ERROR", createdAt: afterDue.toISOString() }]);
    expect(await run(s, m)).toMatchObject([{ outcome: "skipped" }]);
    expect(s.calls.some((c) => c.name === "TraekRestbeloeb")).toBe(false);
  });

  it("giver op efter tre afvisninger og beder butikken tage over", async () => {
    const s = fakeShopify();
    const old = new Date(afterDue.getTime() - 48 * 3_600_000).toISOString();
    const m = memoryStore([{ id: "r3", orderId: ORDER, scheduleId: SCHEDULE, attempt: 3, status: "ERROR", createdAt: old }]);
    expect(await run(s, m)).toMatchObject([{ outcome: "needs_manual" }]);
    expect(s.calls.some((c) => c.name === "TraekRestbeloeb")).toBe(false);
  });

  it("springer abonnementer og prøv-før-køb fra andre apps over", async () => {
    const s = fakeShopify({ category: "TRY_BEFORE_YOU_BUY" });
    expect(await run(s, memoryStore())).toMatchObject([{ outcome: "skipped", detail: "Ikke en forudbestilling" }]);
  });

  it("trækker stadig, når forudbestillingen er fjernet efter købet", async () => {
    const s = fakeShopify({ category: null });
    expect(await run(s, memoryStore())).toMatchObject([{ outcome: "charged" }]);
  });

  it("gemmer Shopifys afvisning af kaldet", async () => {
    const s = fakeShopify({ mutationErrors: ["Mandate expired"] });
    const m = memoryStore();
    expect(await run(s, m)).toMatchObject([{ outcome: "failed", detail: "Mandate expired" }]);
    expect(m.rows).toMatchObject([{ attempt: 1, status: "ERROR", message: "Mandate expired" }]);
  });

  it("finder ikke ordrer, der ikke er forfaldne, og ikke ordrer uden selling plan", async () => {
    const s = fakeShopify({
      candidates: [
        { id: "a", name: "#1", lineItems: { nodes: [{ sellingPlan: { sellingPlanId: PLAN } }] }, paymentTerms: { paymentSchedules: { nodes: [{ id: "s", dueAt: "2026-12-01T08:00:00Z", completedAt: null }] } } },
        { id: "b", name: "#2", lineItems: { nodes: [{ sellingPlan: null }] }, paymentTerms: { paymentSchedules: { nodes: [{ id: "s", dueAt: "2026-11-01T08:00:00Z", completedAt: null }] } } },
      ],
    });
    expect(await run(s, memoryStore())).toEqual([]);
  });
});
