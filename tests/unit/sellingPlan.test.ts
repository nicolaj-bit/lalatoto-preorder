import { describe, expect, it } from "vitest";
import { buildPreorderSellingPlanGroupInput } from "../../app/lib/preorder/sellingPlan";

const now = new Date("2026-10-11T12:00:00Z");
const chargeAt = new Date("2026-12-01T08:00:00Z");

describe("buildPreorderSellingPlanGroupInput", () => {
  it("bygger én PRE_ORDER-plan med 0 % ved checkout og restbeløb på fast dato", () => {
    const input = buildPreorderSellingPlanGroupInput({ chargeAt, now });
    expect(input.sellingPlansToCreate).toHaveLength(1);
    const plan = input.sellingPlansToCreate[0];
    expect(plan.category).toBe("PRE_ORDER");
    expect(plan.billingPolicy.fixed).toEqual({
      checkoutCharge: { type: "PERCENTAGE", value: { percentage: 0 } },
      remainingBalanceChargeTrigger: "EXACT_TIME",
      remainingBalanceChargeExactTime: "2026-12-01T08:00:00.000Z",
    });
    expect(plan.deliveryPolicy.fixed).toEqual({
      fulfillmentTrigger: "EXACT_TIME",
      fulfillmentExactTime: "2026-12-01T08:00:00.000Z",
    });
    expect(plan.inventoryPolicy).toEqual({ reserve: "ON_SALE" });
  });

  it("siger forfaldsdatoen til kunden i stedet for «ved afsendelse»", () => {
    const input = buildPreorderSellingPlanGroupInput({ chargeAt, now });
    expect(input.sellingPlansToCreate[0].name).toBe("Forudbestilling");
    expect(input.sellingPlansToCreate[0].options).toEqual(["0 % nu, resten 1. december 2026"]);
    expect(input.appId).toBe("lalatoto-preorder");
  });

  it("gruppens og planens options har samme antal værdier (Shopify kræver det)", () => {
    const input = buildPreorderSellingPlanGroupInput({ chargeAt, now });
    expect(input.sellingPlansToCreate[0].options).toHaveLength(input.options.length);
  });

  it("tager et depositum med, når det er sat", () => {
    const input = buildPreorderSellingPlanGroupInput({ chargeAt, now, depositPercent: 25 });
    expect(input.sellingPlansToCreate[0].billingPolicy.fixed.checkoutCharge.value.percentage).toBe(25);
  });

  it("afviser en forfaldsdato i fortiden", () => {
    expect(() =>
      buildPreorderSellingPlanGroupInput({ chargeAt: new Date("2026-10-01T00:00:00Z"), now }),
    ).toThrow(/fremtiden/);
  });

  it("afviser ugyldige depositummer, herunder 100 %", () => {
    expect(() => buildPreorderSellingPlanGroupInput({ chargeAt, now, depositPercent: -5 })).toThrow();
    expect(() => buildPreorderSellingPlanGroupInput({ chargeAt, now, depositPercent: 100 })).toThrow();
  });
});
