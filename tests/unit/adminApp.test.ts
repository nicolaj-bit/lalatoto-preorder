import { describe, expect, it } from "vitest";
import { handleAdminRequest } from "../../base44/shared/server/adminHandler.ts";
import { verifyAdminIdToken } from "../../base44/shared/server/sessionToken.ts";
import { createProductSegment } from "../../base44/shared/server/segment.ts";
import { callAdmin, chargeSummary, chargeableForProduct, ENDPOINT, filterRows, orderLink, segmentLink, segmentQuery, totals, variantStats } from "../../admin-app/dashboard.js";
import { CLIENT_ID, GOOD_PAYLOAD, NOW, SECRET, SHOP, sign } from "../helpers/jwt";

const env = { store: SHOP, clientId: CLIENT_ID, clientSecret: SECRET };
const opts = { secret: SECRET, clientId: CLIENT_ID, shop: SHOP, now: NOW };
// Et ID token fra App Bridge: som kundekontoens, men med iss og en medarbejder som sub.
const ADMIN = { ...GOOD_PAYLOAD, iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, sub: "42" };

describe("verifyAdminIdToken", () => {
  it("godkender et token fra butikkens admin", async () => {
    expect((await verifyAdminIdToken(sign(ADMIN), opts)).ok).toBe(true);
  });

  it("afviser kundekontoens token, selv om det er gyldigt", async () => {
    expect(await verifyAdminIdToken(sign(GOOD_PAYLOAD), opts)).toMatchObject({ ok: false, reason: "Ikke et token fra Shopify admin" });
  });

  it("afviser iss fra en anden butik eller en anden sti", async () => {
    expect((await verifyAdminIdToken(sign({ ...ADMIN, iss: "https://anden.myshopify.com/admin" }), opts)).ok).toBe(false);
    expect((await verifyAdminIdToken(sign({ ...ADMIN, iss: `https://${SHOP}/account` }), opts)).ok).toBe(false);
  });

  it("afviser forkert signatur", async () => {
    expect((await verifyAdminIdToken(sign(ADMIN, { secret: "forkert" }), opts)).ok).toBe(false);
  });
});

describe("handleAdminRequest", () => {
  const deps = {
    env,
    now: NOW,
    listRows: async () => [{ orderNumber: "#1001" }] as any,
    chargePreview: async () => [{ orderId: "o", outcome: "dry_run", detail: "Ville trække 548.00 DKK" }] as any,
    createSegment: async (productId: string, productTitle: string) =>
      ({ ok: true, id: "gid://shopify/Segment/5", name: `Forudbestilt: ${productTitle}`, existed: false }) as const,
    charge: async (orderIds: string[]) => orderIds.map((orderId) => ({ orderId, outcome: "charged" as const, detail: "548.00 DKK: PURCHASED" })),
  };
  const request = (body: unknown, token = sign(ADMIN), method = "POST") =>
    new Request("https://x.base44.app/api/apps/x/functions/adminPreorders", {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });

  it("svarer på browserens forhåndsforespørgsel med CORS", async () => {
    const res = await handleAdminRequest(request(null, "", "OPTIONS"), deps);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  it("giver listen og prøvekørslen til admin", async () => {
    expect(await (await handleAdminRequest(request({ action: "list" }), deps)).json()).toEqual({ ok: true, rows: [{ orderNumber: "#1001" }] });
    const preview = await (await handleAdminRequest(request({ action: "chargePreview" }), deps)).json();
    expect(preview.results[0].outcome).toBe("dry_run");
  });

  it("afviser kundekontoens token og kalder ikke Shopify", async () => {
    let called = false;
    const res = await handleAdminRequest(request({ action: "list" }, sign(GOOD_PAYLOAD)), {
      ...deps,
      listRows: async () => { called = true; return []; },
    });
    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });

  it("opretter segment og kræver produkt", async () => {
    const ok = await (await handleAdminRequest(request({ action: "createSegment", productId: "gid://shopify/Product/1", productTitle: "Slange" }), deps)).json();
    expect(ok).toMatchObject({ ok: true, name: "Forudbestilt: Slange" });
    expect((await handleAdminRequest(request({ action: "createSegment" }), deps)).status).toBe(400);
  });

  it("trækker kun gyldige ordre-id'er", async () => {
    const ok = await (await handleAdminRequest(request({ action: "charge", orderIds: ["gid://shopify/Order/1"] }), deps)).json();
    expect(ok.results[0].outcome).toBe("charged");
    expect((await handleAdminRequest(request({ action: "charge", orderIds: ["gid://shopify/Customer/1"] }), deps)).status).toBe(400);
    expect((await handleAdminRequest(request({ action: "charge", orderIds: [] }), deps)).status).toBe(400);
  });

  it("lader ikke kundekontoens token trække", async () => {
    const res = await handleAdminRequest(request({ action: "charge", orderIds: ["gid://shopify/Order/1"] }, sign(GOOD_PAYLOAD)), deps);
    expect(res.status).toBe(401);
  });

  it("afviser ukendte handlinger", async () => {
    expect((await handleAdminRequest(request({ action: "charge" }), deps)).status).toBe(400);
  });
});

describe("admin-app/dashboard.js", () => {
  const rows = [
    { orderNumber: "#1001", status: "afventer betaling", outstanding: "548.00", currency: "DKK", items: ["1 × Barnevogn"], customer: { name: "Anna", email: "anna@example.com", phone: null } },
    { orderNumber: "#1002", status: "forfalden", outstanding: "100.00", currency: "DKK", items: ["1 × Lift"], customer: { name: "Bo", email: null, phone: null } },
    { orderNumber: "#1003", status: "betalt", outstanding: "0.00", currency: "DKK", items: ["1 × Slange"], customer: { name: "Cy", email: null, phone: null } },
  ];

  it("filtrerer på søgning og status", () => {
    expect(filterRows(rows, "barnevogn", "alle").map((r: any) => r.orderNumber)).toEqual(["#1001"]);
    expect(filterRows(rows, "", "forfalden").map((r: any) => r.orderNumber)).toEqual(["#1002"]);
  });

  it("tæller kun åbne ordrer med i det udestående", () => {
    expect(totals(rows)).toEqual({ count: 3, open: 2, overdue: 1, outstanding: 648, currency: "DKK" });
  });

  it("linker til ordren i admin", () => {
    expect(orderLink("gid://shopify/Order/8244615872854")).toBe("shopify://admin/orders/8244615872854");
  });

  it("sender et nyt token med hvert kald og melder fejl videre", async () => {
    const seen: any[] = [];
    const fakeFetch: any = async (url: string, init: any) => {
      seen.push({ url, auth: init.headers.Authorization, body: init.body });
      return new Response(JSON.stringify({ ok: false, error: "Ingen adgang" }), { status: 401 });
    };
    await expect(callAdmin("list", async () => "tok", {}, fakeFetch)).rejects.toThrow("Ingen adgang");
    expect(seen[0]).toEqual({ url: ENDPOINT, auth: "Bearer tok", body: JSON.stringify({ action: "list" }) });
  });
});

describe("variantStats", () => {
  const P = "gid://shopify/Product/11";
  const line = (variantId: string, variantTitle: string, quantity: number, total: string) =>
    ({ productId: P, productTitle: "Luksus sengeslange", variantId, variantTitle, quantity, total, imageUrl: null });
  const rows = [
    { orderId: "o1", status: "afventer betaling", lines: [line("v1", "Sunflower", 1, "499.00"), line("v2", "Sage", 2, "998.00")] },
    { orderId: "o2", status: "betalt", lines: [line("v2", "Sage", 1, "499.00")] },
    { orderId: "o3", status: "annulleret", lines: [line("v1", "Sunflower", 5, "2495.00")] },
  ];

  it("tæller ordrer, stk. og omsætning pr. variant og springer annullerede over", () => {
    const [p] = variantStats(rows);
    expect(p).toMatchObject({ productId: P, orders: 2, units: 4, total: 1996 });
    expect(p.variants.map((v: any) => [v.title, v.orders, v.units, v.total])).toEqual([
      ["Sage", 2, 3, 1497],
      ["Sunflower", 1, 1, 499],
    ]);
  });

  it("«Træk alle» tager kun åbne ordrer med restbeløb", () => {
    const rs = [
      { ...rows[0], outstanding: "548.00", currency: "DKK" },
      { ...rows[1], outstanding: "0.00", currency: "DKK" },
      { ...rows[2], outstanding: "100.00", currency: "DKK" },
    ];
    const open = chargeableForProduct(rs, P);
    expect(open.map((r: any) => r.orderId)).toEqual(["o1"]);
    expect(chargeSummary(open)).toEqual({ count: 1, amount: 548, currency: "DKK" });
  });

  it("filtrerer ordrelisten på produkt", () => {
    expect(filterRows([{ ...rows[0], customer: {}, items: [] }], "", "alle", "gid://shopify/Product/99")).toEqual([]);
    expect(filterRows([{ ...rows[0], customer: {}, items: [] }], "", "alle", P)).toHaveLength(1);
  });

  it("laver Shopifys segmentforespørgsel med produktets tal-id", () => {
    expect(segmentQuery("gid://shopify/Product/11362090942806")).toBe("products_purchased(id: 11362090942806) = true");
  });
});

describe("createProductSegment", () => {
  it("opretter segmentet med produktets tal-id", async () => {
    const calls: any[] = [];
    const graphql: any = async (q: string, v: any) => {
      calls.push(v);
      return { segmentCreate: { segment: { id: "gid://shopify/Segment/7", name: v.name, query: v.query }, userErrors: [] } };
    };
    const r = await createProductSegment(graphql, "gid://shopify/Product/42", "Luksus sengeslange");
    expect(r).toEqual({ ok: true, id: "gid://shopify/Segment/7", name: "Forudbestilt: Luksus sengeslange", existed: false });
    expect(calls[0].query).toBe("products_purchased(id: 42) = true");
    expect(segmentLink("gid://shopify/Segment/7")).toBe("shopify://admin/customers/segments/7");
  });

  it("genbruger et segment med samme navn", async () => {
    const graphql: any = async (q: string) =>
      q.includes("segmentCreate")
        ? { segmentCreate: { segment: null, userErrors: [{ field: ["name"], message: "Name has already been taken" }] } }
        : { segments: { nodes: [{ id: "gid://shopify/Segment/8", name: "Forudbestilt: X", query: "" }] } };
    expect(await createProductSegment(graphql, "gid://shopify/Product/1", "X")).toMatchObject({ ok: true, id: "gid://shopify/Segment/8", existed: true });
  });

  it("afviser andet end et produkt-id", async () => {
    expect(await createProductSegment((async () => ({})) as any, "gid://shopify/Order/1", "X")).toEqual({ ok: false, error: "Ugyldigt produkt" });
  });
});
