// Bygger input til sellingPlanGroupCreate for en forudbestilling.
//
// Én selling plan group med én plan i kategorien PRE_ORDER:
// - checkoutCharge: procent af prisen ved checkout (i beviset 0 %)
// - restbeløbet udskydes til et fast tidspunkt (EXACT_TIME)
// - levering sker tidligst samme tidspunkt
// - lageret reserveres, når ordren lægges (ON_SALE)
//
// Shopify trækker IKKE restbeløbet selv på forfaldsdatoen. Det er appens
// ansvar (se docs/forudsaetninger.md). Datoen her er det, kunden får at vide,
// og det, der lander som forfaldsdato på ordren.

import { assertPercent } from "./money";
import { assertInFuture, formatDanishDate } from "./dates";

/**
 * Sættes som appId på gruppen, så appen (og temablokken via
 * selling_plan_group.app_id) kan kende sine egne planer fra andre apps'.
 */
export const PREORDER_APP_ID = "lalatoto-preorder";

export type PreorderPlanOptions = {
  /** Hvornår restbeløbet forfalder, og varen tidligst sendes. */
  chargeAt: Date;
  /** Andel af prisen, der betales ved checkout. 0 i beviset. */
  depositPercent?: number;
  /** Bruges til at finde gruppen igen. Skal være unik i butikken. */
  merchantCode?: string;
  groupName?: string;
  planName?: string;
  now?: Date;
};

/** Det, der afhænger af datoen og depositummet: kundens tekst og politikkerne. */
function planTerms(chargeAt: Date, depositPercent: number, now?: Date) {
  assertPercent(depositPercent);
  if (depositPercent === 100) {
    // 100 % ved checkout er ikke en forudbestilling med udskudt betaling.
    throw new Error("Depositum på 100 % giver intet restbeløb at udskyde");
  }
  assertInFuture(chargeAt, now);
  const at = chargeAt.toISOString();
  // Kunden ser planens navn og option i kurv og checkout. Restbeløbet trækkes
  // på en fast dato, så teksten siger datoen — ikke «ved afsendelse».
  return {
    options: [`${depositPercent} % nu, resten ${formatDanishDate(chargeAt)}`],
    billingPolicy: {
      fixed: {
        checkoutCharge: {
          type: "PERCENTAGE",
          value: { percentage: depositPercent },
        },
        remainingBalanceChargeTrigger: "EXACT_TIME",
        remainingBalanceChargeExactTime: at,
      },
    },
    deliveryPolicy: {
      fixed: {
        fulfillmentTrigger: "EXACT_TIME",
        fulfillmentExactTime: at,
      },
    },
  };
}

export function buildPreorderSellingPlanGroupInput(opts: PreorderPlanOptions) {
  const depositPercent = opts.depositPercent ?? 0;
  return {
    name: opts.groupName ?? "Forudbestilling",
    merchantCode: opts.merchantCode ?? "lalatoto-preorder",
    appId: PREORDER_APP_ID,
    options: ["Forudbestilling"],
    sellingPlansToCreate: [
      {
        name: opts.planName ?? "Forudbestilling",
        category: "PRE_ORDER",
        ...planTerms(opts.chargeAt, depositPercent, opts.now),
        inventoryPolicy: { reserve: "ON_SALE" },
      },
    ],
  };
}

/**
 * Input til sellingPlanGroupUpdate, når datoen flyttes. Depositummet sendes
 * med uændret, fordi Shopify kræver hele betalingspolitikken.
 */
export function buildPreorderDateUpdateInput(opts: {
  sellingPlanId: string;
  chargeAt: Date;
  depositPercent: number;
  now?: Date;
}) {
  return {
    sellingPlansToUpdate: [{ id: opts.sellingPlanId, ...planTerms(opts.chargeAt, opts.depositPercent, opts.now) }],
  };
}
