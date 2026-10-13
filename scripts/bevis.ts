// Beviset for forretningslogikken, kørt trin for trin mod en udviklingsbutik.
//
//   npm run bevis -- opret --dato 2026-12-01 [--pris 499.00]
//   npm run bevis -- vis --ordre 1234567890
//   npm run bevis -- traek --ordre 1234567890 [--foer-tid] [--forsoeg 2] [--kun-autoriser]
//   npm run bevis -- annuller --ordre 1234567890 [--aarsag CUSTOMER] [--refunder]
//   npm run bevis -- ryd-op
//
// Hvert trin skriver Shopifys rå svar ud, så det kan klippes direkte ind i
// docs/forudsaetninger.md. Id'er fra "opret" gemmes i .bevis/state.json
// (ignoreres af git) — ingen tokens gemmes nogen steder.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  assertDevelopmentStore,
  configFromEnv,
  createAdminClient,
  throwOnUserErrors,
  type AdminClient,
} from "../app/lib/shopify/adminClient";
import {
  CLEANUP,
  ORDER_CANCEL,
  ORDER_CREATE_MANDATE_PAYMENT,
  ORDER_PAYMENT_STATUS,
  ORDER_QUERY,
  PRODUCT_SET,
  PUBLICATIONS_QUERY,
  PUBLISHABLE_PUBLISH,
  SELLING_PLAN_GROUP_CREATE,
} from "../app/lib/shopify/operations";
import { buildPreorderSellingPlanGroupInput } from "../app/lib/preorder/sellingPlan";
import { localDateTimeToUtc } from "../app/lib/preorder/dates";
import { decideCharge, gidTail } from "../app/lib/preorder/charge";

const STATE_DIR = ".bevis";
const STATE_FILE = `${STATE_DIR}/state.json`;

type State = {
  store: string;
  productId: string;
  productHandle: string;
  variantId: string;
  sellingPlanGroupId: string;
  sellingPlanId: string;
  chargeAt: string;
};

function print(label: string, data: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
}

function loadState(): State {
  if (!existsSync(STATE_FILE)) throw new Error(`${STATE_FILE} findes ikke — kør "opret" først`);
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

function orderGid(input: string | undefined): string {
  if (!input) throw new Error("--ordre mangler (ordre-id fra admin-URL'en eller gid://shopify/Order/…)");
  if (input.startsWith("gid://shopify/Order/")) return input;
  if (/^\d+$/.test(input)) return `gid://shopify/Order/${input}`;
  throw new Error(`Forstår ikke ordre-id "${input}". Brug tallet fra admin-URL'en, ikke #1001.`);
}

async function opret(client: AdminClient, args: { dato?: string; pris?: string }) {
  if (!args.dato) throw new Error("--dato mangler (ÅÅÅÅ-MM-DD, forfaldsdato for restbeløbet)");
  const chargeAt = localDateTimeToUtc(args.dato, 9, 0);
  const price = args.pris ?? "499.00";

  const productRes = await client.graphql(PRODUCT_SET, {
    input: {
      title: `Forudbestilling – testprodukt ${new Date().toISOString().slice(0, 10)}`,
      status: "ACTIVE",
      productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
      // CONTINUE: kan købes uden lager, som en forudbestilling typisk skal.
      variants: [{ optionValues: [{ optionName: "Title", name: "Default Title" }], price, inventoryPolicy: "CONTINUE" }],
    },
  });
  print("productSet", productRes);
  throwOnUserErrors("productSet", productRes.productSet.userErrors);
  const product = productRes.productSet.product;

  const groupInput = buildPreorderSellingPlanGroupInput({
    chargeAt,
    depositPercent: 0,
    merchantCode: `lalatoto-preorder-${Date.now()}`,
  });
  print("sellingPlanGroupCreate – input", groupInput);
  const groupRes = await client.graphql(SELLING_PLAN_GROUP_CREATE, {
    input: groupInput,
    resources: { productIds: [product.id] },
  });
  print("sellingPlanGroupCreate – svar", groupRes);
  throwOnUserErrors("sellingPlanGroupCreate", groupRes.sellingPlanGroupCreate.userErrors);
  const group = groupRes.sellingPlanGroupCreate.sellingPlanGroup;

  // Produktet skal ligge i Online Store, ellers kan det ikke købes i checkout.
  const pubs = await client.graphql(PUBLICATIONS_QUERY);
  // På felt-post er catalog null for Online Store, så kanalen findes også på navnet.
  const online = pubs.publications.nodes.find(
    (p: any) => p.catalog?.title === "Online Store" || p.name === "Online Store",
  );
  if (online) {
    const pubRes = await client.graphql(PUBLISHABLE_PUBLISH, { id: product.id, input: [{ publicationId: online.id }] });
    throwOnUserErrors("publishablePublish", pubRes.publishablePublish.userErrors);
  } else {
    console.warn("Fandt ikke salgskanalen 'Online Store' — udgiv produktet manuelt i admin.");
  }

  const state: State = {
    store: client.store,
    productId: product.id,
    productHandle: product.handle,
    variantId: product.variants.nodes[0].id,
    sellingPlanGroupId: group.id,
    sellingPlanId: group.sellingPlans.nodes[0].id,
    chargeAt: chargeAt.toISOString(),
  };
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  print("Gemt i .bevis/state.json", state);

  const variant = gidTail(state.variantId);
  const plan = gidTail(state.sellingPlanId);
  console.log(`
Næste skridt — læg testordren:
  1. Åbn https://${client.store}/products/${state.productHandle}
     (butikkens adgangskode står under Online Store → Preferences)
  2. Åbn browserens konsol på siden og kør:
       await fetch('/cart/add.js', {method:'POST', headers:{'Content-Type':'application/json'},
         body: JSON.stringify({items:[{id:${variant}, quantity:1, selling_plan:${plan}}]})}).then(r=>r.json())
     (Pre-orders virker ikke med cart permalinks, derfor Ajax-kurven.)
  3. Gå til https://${client.store}/checkout og betal med testkort 4242 4242 4242 4242.
  4. Kopiér ordrens id fra admin-URL'en og kør: npm run bevis -- vis --ordre <id>
`);
}

async function vis(client: AdminClient, args: { ordre?: string }) {
  const data = await client.graphql(ORDER_QUERY, { id: orderGid(args.ordre) });
  print("order", data);
  if (!data.order) throw new Error("Ordren findes ikke");
  const decision = decideCharge(data.order, { force: true });
  print("Hvad appen ville trække (decideCharge, force)", decision);
}

async function traek(
  client: AdminClient,
  args: { ordre?: string; "foer-tid"?: boolean; forsoeg?: string; "kun-autoriser"?: boolean },
) {
  const id = orderGid(args.ordre);
  const before = await client.graphql(ORDER_QUERY, { id });
  if (!before.order) throw new Error("Ordren findes ikke");
  const decision = decideCharge(before.order, {
    force: Boolean(args["foer-tid"]),
    attempt: args.forsoeg ? Number(args.forsoeg) : 1,
    autoCapture: !args["kun-autoriser"],
  });
  print("decideCharge", decision);
  if (!decision.ok) return;

  const res = await client.graphql(ORDER_CREATE_MANDATE_PAYMENT, decision.input);
  print("orderCreateMandatePayment", res);
  const payload = res.orderCreateMandatePayment;
  if (payload.userErrors.length > 0 || !payload.paymentReferenceId) return;

  // Betalingen behandles asynkront. Spørg indtil status ikke længere er i gang.
  const pending = new Set(["INITIATED", "PROCESSING", "PENDING"]);
  let status: any;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    status = (await client.graphql(ORDER_PAYMENT_STATUS, { orderId: id, paymentReferenceId: payload.paymentReferenceId }))
      .orderPaymentStatus;
    if (!pending.has(status?.status)) break;
  }
  print("orderPaymentStatus", status);
  const after = await client.graphql(ORDER_QUERY, { id });
  print("order efter træk", after);
}

async function annuller(client: AdminClient, args: { ordre?: string; aarsag?: string; refunder?: boolean }) {
  const res = await client.graphql(ORDER_CANCEL, {
    orderId: orderGid(args.ordre),
    reason: args.aarsag ?? "CUSTOMER",
    restock: true,
    notifyCustomer: true,
    staffNote: "Annulleret af lalatoto-preorder-beviset",
    refundMethod: args.refunder ? { originalPaymentMethodsRefund: true } : undefined,
  });
  print("orderCancel", res);
  await new Promise((r) => setTimeout(r, 3000));
  print("order efter annullering", await client.graphql(ORDER_QUERY, { id: orderGid(args.ordre) }));
}

async function rydOp(client: AdminClient) {
  const state = loadState();
  if (state.store !== client.store) throw new Error(`state.json hører til ${state.store}, ikke ${client.store}`);
  const res = await client.graphql(CLEANUP, { groupId: state.sellingPlanGroupId, productId: state.productId });
  print("Ryd op", res);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      dato: { type: "string" },
      pris: { type: "string" },
      ordre: { type: "string" },
      forsoeg: { type: "string" },
      "foer-tid": { type: "boolean" },
      "kun-autoriser": { type: "boolean" },
      aarsag: { type: "string" },
      refunder: { type: "boolean" },
    },
  });

  const client = createAdminClient(configFromEnv());
  const shop = await assertDevelopmentStore(client);
  console.log(`Butik: ${shop.name} (${shop.myshopifyDomain}), valuta ${shop.currencyCode}, udviklingsbutik ✔`);

  switch (command) {
    case "opret": return opret(client, values);
    case "vis": return vis(client, values);
    case "traek": return traek(client, values);
    case "annuller": return annuller(client, values);
    case "ryd-op": return rydOp(client);
    default:
      throw new Error(`Ukendt kommando "${command ?? ""}". Brug opret, vis, traek, annuller eller ryd-op.`);
  }
}

main().catch((err) => {
  console.error(`\nFejl: ${err.message}`);
  if (err.details) console.error(JSON.stringify(err.details, null, 2));
  process.exit(1);
});
