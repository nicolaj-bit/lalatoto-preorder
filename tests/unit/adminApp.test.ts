import { describe, expect, it } from "vitest";
import { handleAdminRequest } from "../../base44/shared/server/adminHandler.ts";
import { verifyAdminIdToken } from "../../base44/shared/server/sessionToken.ts";
import { callAdmin, ENDPOINT, filterRows, orderLink, totals } from "../../admin-app/dashboard.js";
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
    await expect(callAdmin("list", async () => "tok", fakeFetch)).rejects.toThrow("Ingen adgang");
    expect(seen[0]).toEqual({ url: ENDPOINT, auth: "Bearer tok", body: JSON.stringify({ action: "list" }) });
  });
});
