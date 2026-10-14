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

export function buildPreorderSellingPlanGroupInput(opts: PreorderPlanOptions) {
  const depositPercent = opts.depositPercent ?? 0;
  assertPercent(depositPercent);
  if (depositPercent === 100) {
    // 100 % ved checkout er ikke en forudbestilling med udskudt betaling.
    throw new Error("Depositum på 100 % giver intet restbeløb at udskyde");
  }
  assertInFuture(opts.chargeAt, opts.now);
  const chargeAt = opts.chargeAt.toISOString();

  // Kunden ser planens navn og option i kurv og checkout. Restbeløbet trækkes
  // på en fast dato, så teksten siger datoen — ikke «ved afsendelse».
  const dueText = formatDanishDate(opts.chargeAt);
  return {
    name: opts.groupName ?? "Forudbestilling",
    merchantCode: opts.merchantCode ?? "lalatoto-preorder",
    appId: PREORDER_APP_ID,
    options: ["Forudbestilling"],
    sellingPlansToCreate: [
      {
        name: opts.planName ?? "Forudbestilling",
        category: "PRE_ORDER",
        options: [`${depositPercent} % nu, resten ${dueText}`],
        billingPolicy: {
          fixed: {
            checkoutCharge: {
              type: "PERCENTAGE",
              value: { percentage: depositPercent },
            },
            remainingBalanceChargeTrigger: "EXACT_TIME",
            remainingBalanceChargeExactTime: chargeAt,
          },
        },
        deliveryPolicy: {
          fixed: {
            fulfillmentTrigger: "EXACT_TIME",
            fulfillmentExactTime: chargeAt,
          },
        },
        inventoryPolicy: { reserve: "ON_SALE" },
      },
    ],
  };
}
