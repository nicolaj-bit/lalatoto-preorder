import { describe, expect, it } from "vitest";
import { verifySessionToken } from "../../base44/shared/server/sessionToken.ts";
import { b64url, CLIENT_ID, GOOD_PAYLOAD as good, NOW as now, SECRET, SHOP, sign } from "../helpers/jwt";

const t = Math.floor(now.getTime() / 1000);

const opts = { secret: SECRET, clientId: CLIENT_ID, shop: SHOP, now };

describe("verifySessionToken", () => {
  it("godkender et gyldigt token og giver kunde-id'et", async () => {
    const r = await verifySessionToken(sign(good), opts);
    expect(r).toMatchObject({ ok: true, payload: { sub: "gid://shopify/Customer/42" } });
  });

  it("godtager dest med https:// foran", async () => {
    expect((await verifySessionToken(sign({ ...good, dest: `https://${SHOP}` }), opts)).ok).toBe(true);
  });

  it("afviser forkert signatur, udløbet token, anden app og anden butik", async () => {
    expect(await verifySessionToken(sign(good, { secret: "forkert" }), opts)).toMatchObject({ ok: false, reason: "Forkert signatur" });
    expect(await verifySessionToken(sign({ ...good, exp: t - 60 }), opts)).toMatchObject({ ok: false, reason: "Udløbet" });
    expect(await verifySessionToken(sign({ ...good, aud: "anden" }), opts)).toMatchObject({ ok: false });
    expect(await verifySessionToken(sign({ ...good, dest: "lalatoto.myshopify.com" }), opts)).toMatchObject({ ok: false });
  });

  it("afviser alg none og andet end et JWT", async () => {
    const [h, b] = sign(good).split(".");
    const none = `${b64url(JSON.stringify({ alg: "none" }))}.${b}.`;
    expect((await verifySessionToken(none, opts)).ok).toBe(false);
    expect((await verifySessionToken(`${h}.${b}`, opts)).ok).toBe(false);
    expect((await verifySessionToken("", opts)).ok).toBe(false);
  });
});

