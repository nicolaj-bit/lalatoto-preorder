import { describe, expect, it } from "vitest";
import {
  decideCharge,
  gidTail,
  idempotencyKey,
  pickMandate,
  type PreorderOrder,
} from "../../app/lib/preorder/charge";

// En ordre, som den forventes at se ud efter checkout med 0 % depositum.
// Formen følger ORDER_QUERY; tallene er opdigtede testdata, ikke målinger.
function order(overrides: Partial<PreorderOrder> = {}): PreorderOrder {
  return {
    id: "gid://shopify/Order/1001",
    name: "#1001",
    cancelledAt: null,
    totalOutstandingSet: { shopMoney: { amount: "499.00", currencyCode: "DKK" } },
    paymentTerms: {
      id: "gid://shopify/PaymentTerms/77",
      paymentSchedules: {
        nodes: [
          {
            id: "gid://shopify/PaymentSchedule/88",
            dueAt: "2026-12-01T08:00:00Z",
            completedAt: null,
            balanceDue: { amount: "499.00", currencyCode: "DKK" },
            totalBalance: { amount: "499.00", currencyCode: "DKK" },
          },
        ],
      },
    },
    paymentCollectionDetails: {
      vaultedPaymentMethods: [
        {
          id: "gid://shopify/PaymentMandate/55",
          paymentInstrument: { __typename: "VaultCreditCard", brand: "VISA", lastDigits: "4242", expiryMonth: 12, expiryYear: 2030, expired: false },
        },
      ],
    },
    ...overrides,
  };
}

const beforeDue = new Date("2026-11-30T12:00:00Z");
const afterDue = new Date("2026-12-01T09:00:00Z");

describe("gidTail / idempotencyKey", () => {
  it("tager tallet fra et gid", () => {
    expect(gidTail("gid://shopify/Order/1001")).toBe("1001");
    expect(gidTail("gid://shopify/PaymentSchedule/88?foo=1")).toBe("88");
  });

  it("samme ordre, plan og forsøg giver samme nøgle — så et dobbelt job ikke trækker to gange", () => {
    const a = idempotencyKey("gid://shopify/Order/1001", "gid://shopify/PaymentSchedule/88");
    const b = idempotencyKey("gid://shopify/Order/1001", "gid://shopify/PaymentSchedule/88");
    expect(a).toBe(b);
    expect(a).toBe("po-1001-88-1");
  });

  it("et nyt forsøg giver en ny nøgle", () => {
    expect(idempotencyKey("gid://shopify/Order/1001", "gid://shopify/PaymentSchedule/88", 2)).toBe("po-1001-88-2");
    expect(() => idempotencyKey("gid://shopify/Order/1001", "gid://shopify/PaymentSchedule/88", 0)).toThrow();
  });

  it("holder sig under Shopifys grænse på 32 tegn, også med lange id'er", () => {
    // Id'erne fra felt-post (ordre #1001) gav 36 tegn med det gamle format.
    const kort = idempotencyKey("gid://shopify/Order/8234472341846", "gid://shopify/PaymentSchedule/90087293270");
    expect(kort).toBe("po-8234472341846-90087293270-1");
    const lang = idempotencyKey("gid://shopify/Order/823447234184612345", "gid://shopify/PaymentSchedule/9008729327012345", 12);
    expect(lang.length).toBeLessThanOrEqual(32);
    expect(lang).toMatch(/^po-[0-9a-f]+-12$/);
    expect(idempotencyKey("gid://shopify/Order/823447234184612345", "gid://shopify/PaymentSchedule/9008729327012345", 12)).toBe(lang);
    expect(idempotencyKey("gid://shopify/Order/823447234184612345", "gid://shopify/PaymentSchedule/9008729327012345", 13)).not.toBe(lang);
  });
});

describe("decideCharge", () => {
  it("trækker hele restbeløbet på forfaldsdagen", () => {
    const d = decideCharge(order(), { now: afterDue });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.input).toEqual({
      id: "gid://shopify/Order/1001",
      mandateId: "gid://shopify/PaymentMandate/55",
      paymentScheduleId: "gid://shopify/PaymentSchedule/88",
      idempotencyKey: "po-1001-88-1",
      autoCapture: true,
    });
    expect(d.expectedAmount).toEqual({ amount: "499.00", currencyCode: "DKK" });
    expect(d.warnings).toEqual([]);
  });

  it("sender kun beløbet, når det er bedt om (kræver Shopify Plus)", () => {
    const d = decideCharge(order(), { now: afterDue, sendAmount: true });
    expect(d.ok && d.input.amount).toEqual({ amount: "499.00", currencyCode: "DKK" });
  });

  it("trækker ikke før forfald — medmindre beviset tvinger det", () => {
    expect(decideCharge(order(), { now: beforeDue })).toMatchObject({ ok: false, reason: "NOT_DUE" });
    expect(decideCharge(order(), { now: beforeDue, force: true }).ok).toBe(true);
  });

  it("trækker aldrig fra en annulleret ordre, heller ikke med force", () => {
    const d = decideCharge(order({ cancelledAt: "2026-11-15T10:00:00Z" }), { now: afterDue, force: true });
    expect(d).toMatchObject({ ok: false, reason: "CANCELLED" });
  });

  it("trækker ikke igen, når planen er betalt", () => {
    const o = order();
    o.paymentTerms!.paymentSchedules.nodes[0].completedAt = "2026-12-01T08:05:00Z";
    expect(decideCharge(o, { now: afterDue })).toMatchObject({ ok: false, reason: "ALREADY_PAID" });
  });

  it("afviser en almindelig ordre uden betalingsaftale", () => {
    expect(decideCharge(order({ paymentTerms: null }), { now: afterDue })).toMatchObject({ ok: false, reason: "NO_PAYMENT_TERMS" });
  });

  it("trækker højst ordrens udestående, også hvis planen siger mere (fx efter delvis refusion)", () => {
    const d = decideCharge(
      order({ totalOutstandingSet: { shopMoney: { amount: "399.00", currencyCode: "DKK" } } }),
      { now: afterDue, sendAmount: true },
    );
    expect(d.ok && d.input.amount).toEqual({ amount: "399.00", currencyCode: "DKK" });
  });

  it("stopper uden beløb, når udestående er mindre end planens restbeløb", () => {
    const d = decideCharge(
      order({ totalOutstandingSet: { shopMoney: { amount: "399.00", currencyCode: "DKK" } } }),
      { now: afterDue },
    );
    expect(d).toMatchObject({ ok: false, reason: "AMOUNT_MISMATCH" });
  });

  it("trækker intet, når intet er udestående", () => {
    const d = decideCharge(
      order({ totalOutstandingSet: { shopMoney: { amount: "0.00", currencyCode: "DKK" } } }),
      { now: afterDue },
    );
    expect(d).toMatchObject({ ok: false, reason: "NOTHING_OUTSTANDING" });
  });

  it("stopper ved forskellig valuta i stedet for at gætte", () => {
    const o = order();
    o.paymentTerms!.paymentSchedules.nodes[0].balanceDue = { amount: "66.00", currencyCode: "EUR" };
    expect(() => decideCharge(o, { now: afterDue })).toThrow(/Valuta/);
  });

  it("melder fejl, når der intet gemt betalingsmiddel er", () => {
    const d = decideCharge(order({ paymentCollectionDetails: { vaultedPaymentMethods: [] } }), { now: afterDue });
    expect(d).toMatchObject({ ok: false, reason: "NO_MANDATE" });
  });

  it("kan nøjes med at autorisere i stedet for at trække", () => {
    const d = decideCharge(order(), { now: afterDue, autoCapture: false });
    expect(d.ok && d.input.autoCapture).toBe(false);
  });
});

describe("pickMandate", () => {
  it("springer et udløbet kort over og bruger det næste", () => {
    const o = order({
      paymentCollectionDetails: {
        vaultedPaymentMethods: [
          { id: "gid://shopify/PaymentMandate/1", paymentInstrument: { __typename: "VaultCreditCard", expired: true, expiryMonth: 1, expiryYear: 2025 } },
          { id: "gid://shopify/PaymentMandate/2", paymentInstrument: { __typename: "VaultCreditCard", expired: false, expiryMonth: 1, expiryYear: 2030 } },
        ],
      },
    });
    const { mandate, warnings } = pickMandate(o, "2026-12-01T08:00:00Z");
    expect(mandate?.id).toBe("gid://shopify/PaymentMandate/2");
    expect(warnings).toHaveLength(1);
  });

  it("advarer, når kortet udløber før forfald, men forsøger stadig", () => {
    const o = order({
      paymentCollectionDetails: {
        vaultedPaymentMethods: [
          { id: "gid://shopify/PaymentMandate/3", paymentInstrument: { __typename: "VaultCreditCard", brand: "VISA", lastDigits: "4242", expired: false, expiryMonth: 11, expiryYear: 2026 } },
        ],
      },
    });
    const { mandate, warnings } = pickMandate(o, "2026-12-01T08:00:00Z");
    expect(mandate?.id).toBe("gid://shopify/PaymentMandate/3");
    expect(warnings[0]).toMatch(/udløber 11\/2026/);
  });

  it("returnerer intet, når alle betalingsmidler er udløbet", () => {
    const o = order({
      paymentCollectionDetails: {
        vaultedPaymentMethods: [
          { id: "gid://shopify/PaymentMandate/1", paymentInstrument: { __typename: "VaultPaypalBillingAgreement", inactive: true } },
        ],
      },
    });
    expect(pickMandate(o, null).mandate).toBeNull();
  });
});
