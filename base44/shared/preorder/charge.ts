// KOPI — genereret af scripts/base44-sync.ts. Ret i app/lib, ikke her.
// Afgør, om en forudbestillingsordre kan trækkes, og hvad kaldet skal indeholde.
//
// Ren logik uden netværk: den får ordren, som Shopify returnerer den fra
// ORDER_QUERY, og svarer enten med et færdigt input til
// orderCreateMandatePayment eller med en grund til, at vi ikke må trække.
// Det er her, de dyre fejl ville opstå (trække to gange, trække for meget,
// trække fra en annulleret ordre), så det er også her, testene er tættest.

import { createHash } from "node:crypto";
import { fromMinor, toMinor, type Money } from "./money.ts";
import { cardExpiresBefore, isDue } from "./dates.ts";

export type PaymentSchedule = {
  id: string;
  dueAt: string | null;
  completedAt: string | null;
  balanceDue: Money;
  totalBalance: Money;
};

export type VaultedMethod = {
  id: string;
  paymentInstrument: {
    __typename: string;
    expiryMonth?: number;
    expiryYear?: number;
    expired?: boolean;
    inactive?: boolean;
    lastDigits?: string;
    brand?: string;
  };
};

export type PreorderOrder = {
  id: string;
  name?: string;
  cancelledAt: string | null;
  totalOutstandingSet: { shopMoney: Money };
  paymentTerms: {
    id: string;
    paymentSchedules: { nodes: PaymentSchedule[] };
  } | null;
  paymentCollectionDetails: {
    vaultedPaymentMethods: VaultedMethod[] | null;
  } | null;
};

export type ChargeDecision =
  | {
      ok: true;
      input: {
        id: string;
        mandateId: string;
        paymentScheduleId: string;
        idempotencyKey: string;
        /** Kun med sendAmount. Shopify tillader feltet alene på Shopify Plus. */
        amount?: Money;
        autoCapture: boolean;
      };
      /** Det beløb, Shopify forventes at trække — til kontrol bagefter. */
      expectedAmount: Money;
      warnings: string[];
    }
  | { ok: false; reason: ChargeBlocker; message: string };

export type ChargeBlocker =
  | "CANCELLED"
  | "NO_PAYMENT_TERMS"
  | "ALREADY_PAID"
  | "NOT_DUE"
  | "NOTHING_OUTSTANDING"
  | "AMOUNT_MISMATCH"
  | "NO_MANDATE";

/** Sidste del af et Shopify-gid: "gid://shopify/Order/123" → "123". */
export function gidTail(gid: string): string {
  const tail = gid.split("/").pop();
  if (!tail) throw new Error(`Ugyldigt gid: "${gid}"`);
  return tail.split("?")[0];
}

/**
 * Idempotensnøgle: samme ordre + samme betalingsplan + samme forsøgsnummer
 * giver altid samme nøgle. Kører et job to gange, returnerer Shopify det
 * første resultat i stedet for at trække igen. Et bevidst nyt forsøg efter en
 * afvisning skal have et nyt forsøgsnummer.
 *
 * Shopify afviser nøgler over 32 tegn. Nøglen er læsbar («po-<ordre>-<plan>-<forsøg>»),
 * når den kan være det; ellers erstattes ordre og plan af en hash af dem.
 */
export const IDEMPOTENCY_KEY_MAX = 32;

export function idempotencyKey(orderId: string, scheduleId: string, attempt = 1): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`Forsøgsnummer skal være et positivt heltal, fik ${attempt}`);
  }
  const order = gidTail(orderId);
  const schedule = gidTail(scheduleId);
  const readable = `po-${order}-${schedule}-${attempt}`;
  if (readable.length <= IDEMPOTENCY_KEY_MAX) return readable;
  const suffix = `-${attempt}`;
  const hash = createHash("sha256").update(`${order}-${schedule}`).digest("hex");
  return `po-${hash.slice(0, IDEMPOTENCY_KEY_MAX - 3 - suffix.length)}${suffix}`;
}

/** Den første betalingsplan, der ikke er gennemført. */
export function openSchedule(order: PreorderOrder): PaymentSchedule | null {
  const schedules = order.paymentTerms?.paymentSchedules.nodes ?? [];
  return schedules.find((s) => !s.completedAt) ?? null;
}

/**
 * Vælg det betalingsmiddel, der skal trækkes på. Et kort, der ifølge Shopify
 * er udløbet, springes over; et kort, der udløber før forfald, bruges stadig,
 * men giver en advarsel — det er præcis det tilfælde, vi skal undersøge.
 */
export function pickMandate(
  order: PreorderOrder,
  dueAt: string | null,
): { mandate: VaultedMethod | null; warnings: string[] } {
  const warnings: string[] = [];
  const methods = order.paymentCollectionDetails?.vaultedPaymentMethods ?? [];
  for (const method of methods) {
    const pi = method.paymentInstrument;
    if (pi.expired || pi.inactive) {
      warnings.push(`Betalingsmiddel ${method.id} er markeret udløbet/inaktivt og springes over`);
      continue;
    }
    if (
      dueAt &&
      typeof pi.expiryMonth === "number" &&
      typeof pi.expiryYear === "number" &&
      cardExpiresBefore(pi.expiryMonth, pi.expiryYear, dueAt)
    ) {
      warnings.push(
        `Kortet (${pi.brand ?? "?"} •••• ${pi.lastDigits ?? "?"}) udløber ${pi.expiryMonth}/${pi.expiryYear}, før forfald ${dueAt}`,
      );
    }
    return { mandate: method, warnings };
  }
  return { mandate: null, warnings };
}

export function decideCharge(
  order: PreorderOrder,
  opts: { now?: Date; force?: boolean; attempt?: number; autoCapture?: boolean; sendAmount?: boolean } = {},
): ChargeDecision {
  const now = opts.now ?? new Date();

  if (order.cancelledAt) {
    return { ok: false, reason: "CANCELLED", message: `Ordren blev annulleret ${order.cancelledAt}` };
  }
  if (!order.paymentTerms) {
    return { ok: false, reason: "NO_PAYMENT_TERMS", message: "Ordren har ingen betalingsaftale (paymentTerms) — er den lagt med en forudbestillingsplan?" };
  }
  const schedule = openSchedule(order);
  if (!schedule) {
    return { ok: false, reason: "ALREADY_PAID", message: "Alle betalingsplaner på ordren er gennemført" };
  }
  // force bruges kun i beviset, hvor vi trækker før forfaldsdatoen med vilje.
  if (!opts.force && !isDue(schedule.dueAt, now)) {
    return { ok: false, reason: "NOT_DUE", message: `Restbeløbet forfalder først ${schedule.dueAt}` };
  }

  // Træk aldrig mere end det mindste af ordrens udestående og planens restbeløb.
  const outstanding = order.totalOutstandingSet.shopMoney;
  const scheduleDue = schedule.balanceDue;
  if (outstanding.currencyCode !== scheduleDue.currencyCode) {
    throw new Error(
      `Valuta passer ikke: udestående ${outstanding.currencyCode}, plan ${scheduleDue.currencyCode}`,
    );
  }
  const amountMinor = Math.min(toMinor(outstanding.amount), toMinor(scheduleDue.amount));
  if (amountMinor <= 0) {
    return { ok: false, reason: "NOTHING_OUTSTANDING", message: "Der er intet udestående at trække" };
  }
  // Uden amount trækker Shopify hele planens restbeløb. Er ordrens udestående
  // mindre (fx efter delvis refusion), kan vi ikke begrænse trækket — så stop.
  if (!opts.sendAmount && amountMinor < toMinor(scheduleDue.amount)) {
    return {
      ok: false,
      reason: "AMOUNT_MISMATCH",
      message: `Udestående (${outstanding.amount}) er mindre end planens restbeløb (${scheduleDue.amount}). Uden Shopify Plus kan beløbet ikke angives.`,
    };
  }

  const { mandate, warnings } = pickMandate(order, schedule.dueAt);
  if (!mandate) {
    return { ok: false, reason: "NO_MANDATE", message: "Ordren har intet gemt betalingsmiddel, der kan trækkes på" };
  }

  const expectedAmount = { amount: fromMinor(amountMinor), currencyCode: outstanding.currencyCode };
  return {
    ok: true,
    input: {
      id: order.id,
      mandateId: mandate.id,
      paymentScheduleId: schedule.id,
      idempotencyKey: idempotencyKey(order.id, schedule.id, opts.attempt ?? 1),
      ...(opts.sendAmount ? { amount: expectedAmount } : {}),
      autoCapture: opts.autoCapture ?? true,
    },
    expectedAmount,
    warnings,
  };
}
