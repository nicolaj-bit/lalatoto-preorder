// Integrationstest mod udviklingsbutikken.
//
// Springes over, når SHOPIFY_STORE ikke er sat (fx i CI uden hemmeligheder).
// Testen opretter et produkt og en forudbestillingsplan, læser dem tilbage
// fra Shopify og sletter dem igen. Den lægger ikke ordrer og trækker ikke
// penge — det gør scripts/bevis.ts, fordi en testordre kræver en checkout i
// browseren.
//
// Er BEVIS_ORDRE_ID sat, læses også den ordre og tjekkes for den form,
// resten af appen bygger på (betalingsaftale, forfaldsdato, gemt kort).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertDevelopmentStore,
  configFromEnv,
  createAdminClient,
  throwOnUserErrors,
  type AdminClient,
} from "../../app/lib/shopify/adminClient";
import { CLEANUP, ORDER_QUERY, PRODUCT_SET, SELLING_PLAN_GROUP_CREATE } from "../../app/lib/shopify/operations";
import { buildPreorderSellingPlanGroupInput } from "../../app/lib/preorder/sellingPlan";
import { decideCharge } from "../../app/lib/preorder/charge";
import { toMinor } from "../../app/lib/preorder/money";

const enabled = Boolean(process.env.SHOPIFY_STORE);

describe.skipIf(!enabled)("udviklingsbutik", () => {
  let client: AdminClient;
  let productId: string | undefined;
  let groupId: string | undefined;

  beforeAll(async () => {
    client = createAdminClient(configFromEnv());
    await assertDevelopmentStore(client);
  });

  afterAll(async () => {
    if (productId && groupId) {
      await client.graphql(CLEANUP, { groupId, productId });
    }
  });

  it("opretter en PRE_ORDER-plan med 0 % ved checkout og læser den tilbage uændret", async () => {
    const product = await client.graphql(PRODUCT_SET, {
      input: {
        title: `Integrationstest ${Date.now()}`,
        status: "DRAFT",
        productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
        variants: [{ optionValues: [{ optionName: "Title", name: "Default Title" }], price: "100.00" }],
      },
    });
    throwOnUserErrors("productSet", product.productSet.userErrors);
    productId = product.productSet.product.id;

    const chargeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    chargeAt.setUTCMilliseconds(0);
    const res = await client.graphql(SELLING_PLAN_GROUP_CREATE, {
      input: buildPreorderSellingPlanGroupInput({ chargeAt, merchantCode: `integrationstest-${Date.now()}` }),
      resources: { productIds: [productId] },
    });
    throwOnUserErrors("sellingPlanGroupCreate", res.sellingPlanGroupCreate.userErrors);
    groupId = res.sellingPlanGroupCreate.sellingPlanGroup.id;

    const plan = res.sellingPlanGroupCreate.sellingPlanGroup.sellingPlans.nodes[0];
    expect(plan.category).toBe("PRE_ORDER");
    expect(plan.billingPolicy.checkoutCharge).toEqual({ type: "PERCENTAGE", value: { percentage: 0 } });
    expect(plan.billingPolicy.remainingBalanceChargeTrigger).toBe("EXACT_TIME");
    expect(Date.parse(plan.billingPolicy.remainingBalanceChargeExactTime)).toBe(chargeAt.getTime());
    expect(plan.deliveryPolicy.fulfillmentTrigger).toBe("EXACT_TIME");
    expect(plan.inventoryPolicy.reserve).toBe("ON_SALE");
  });

  it.skipIf(!process.env.BEVIS_ORDRE_ID)("testordren har betalingsaftale, forfaldsdato og gemt betalingsmiddel", async () => {
    const id = `gid://shopify/Order/${process.env.BEVIS_ORDRE_ID}`;
    const { order } = await client.graphql(ORDER_QUERY, { id });
    expect(order).toBeTruthy();

    // 0 % ved checkout: intet modtaget, hele beløbet udestående.
    const total = toMinor(order.totalPriceSet.shopMoney.amount);
    const received = toMinor(order.totalReceivedSet.shopMoney.amount);
    const outstanding = toMinor(order.totalOutstandingSet.shopMoney.amount);
    expect(order.lineItems.nodes.some((li: any) => li.sellingPlan)).toBe(true);
    expect(order.paymentTerms).toBeTruthy();
    const schedule = order.paymentTerms.paymentSchedules.nodes[0];
    expect(schedule.dueAt).toBeTruthy();

    if (!schedule.completedAt) {
      expect(received).toBe(0);
      expect(outstanding).toBe(total);
      expect(toMinor(schedule.balanceDue.amount)).toBe(total);
      expect(order.paymentCollectionDetails.vaultedPaymentMethods.length).toBeGreaterThan(0);
      const decision = decideCharge(order, { force: true });
      expect(decision.ok).toBe(true);
    } else {
      // Ordren er allerede trukket med scripts/bevis.ts.
      expect(outstanding).toBe(0);
      expect(decideCharge(order, { force: true })).toMatchObject({ ok: false, reason: "ALREADY_PAID" });
    }
  });
});
