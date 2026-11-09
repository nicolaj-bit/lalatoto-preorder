import { describe, expect, it } from "vitest";
import { handleWaitlistRequest, handleize, waitlistTags } from "../../base44/shared/server/waitlistHandler.ts";
import type { Graphql } from "../../app/lib/preorder/cancelService";

const VARIANT = "gid://shopify/ProductVariant/48447237357705";

/** Falsk Shopify: Sengetøj Sage / Baby med venteliste og evt. en eksisterende kunde. */
function fakeShopify(opts: { waitlist?: string; customer?: { id: string; state: string } | null } = {}) {
  const calls: { name: string; variables: any }[] = [];
  const graphql: Graphql = async (query, variables) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?";
    calls.push({ name, variables });
    if (name === "VentelisteVariant") {
      return {
        productVariant: {
          title: "Sage / Baby",
          selectedOptions: [
            { name: "Dit valg", value: "Sage" },
            { name: "Sengetøjsstørrelse", value: "Baby" },
          ],
          product: { handle: "sengetoj", status: "ACTIVE", waitlist: { value: opts.waitlist ?? "true" } },
        },
      } as any;
    }
    if (name === "VentelisteKunde") {
      const c = opts.customer;
      return { customerByIdentifier: c ? { id: c.id, defaultEmailAddress: { marketingState: c.state } } : null } as any;
    }
    if (name === "VentelisteOpretKunde") return { customerCreate: { customer: { id: "gid://shopify/Customer/9" }, userErrors: [] } } as any;
    if (name === "VentelisteTags") return { tagsAdd: { userErrors: [] } } as any;
    if (name === "VentelisteSamtykke") return { customerEmailMarketingConsentUpdate: { userErrors: [] } } as any;
    throw new Error(name);
  };
  return { graphql, calls };
}

function request(body: unknown, method = "POST") {
  return new Request("https://example.base44.app/api/apps/x/functions/waitlistSignup", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

const SAGE_BABY_TAGS = [
  "venteliste",
  "venteliste-sengetoj",
  "venteliste-sengetoj-sage-baby",
  "venteliste-sengetoj-farve-sage",
  "venteliste-farve-sage",
  "venteliste-sengetoj-str-baby",
];

describe("handleize", () => {
  it("giver samme resultat som Liquid for butikkens navne", () => {
    expect(handleize("Sage / Baby")).toBe("sage-baby");
    expect(handleize("Voksen ekstra længe")).toBe("voksen-ekstra-laenge");
    expect(handleize("Sengetøj")).toBe("sengetoj");
    expect(handleize("Baby Blue")).toBe("baby-blue");
    expect(handleize("Größe")).toBe("grosse");
  });
});

describe("waitlistTags", () => {
  it("laver tags pr. produkt, variant, farve og størrelse", () => {
    const tags = waitlistTags(
      {
        title: "Sage / Baby",
        selectedOptions: [
          { name: "Dit valg", value: "Sage" },
          { name: "Sengetøjsstørrelse", value: "Baby" },
        ],
        productHandle: "sengetoj",
      },
      false,
    );
    expect(tags).toEqual(SAGE_BABY_TAGS);
  });

  it("tilføjer nyhedsbrev-samtykke kun ved flueben", () => {
    const tags = waitlistTags({ title: "Lille", selectedOptions: [{ name: "Størrelse", value: "Lille" }], productHandle: "lala-hvalen" }, true);
    expect(tags).toContain("nyhedsbrev-samtykke");
    expect(tags).toContain("venteliste-lala-hvalen-str-lille");
    expect(tags).not.toContain("venteliste-farve-lille");
  });

  it("springer «Default Title» over på produkter uden varianter", () => {
    const tags = waitlistTags({ title: "Default Title", selectedOptions: [{ name: "Title", value: "Default Title" }], productHandle: "e-bog" }, false);
    expect(tags).toEqual(["venteliste", "venteliste-e-bog"]);
  });
});

describe("handleWaitlistRequest", () => {
  it("svarer på browserens forhåndsforespørgsel med CORS", async () => {
    const res = await handleWaitlistRequest(new Request("https://x", { method: "OPTIONS" }), { graphql: fakeShopify().graphql });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("opretter en ny kunde uden nyhedsbrev, når der ikke er flueben", async () => {
    const shop = fakeShopify();
    const res = await handleWaitlistRequest(request({ email: "Test@Example.com ", variantId: "48447237357705", newsletter: false }), shop);
    expect(await res.json()).toEqual({ ok: true });
    const create = shop.calls.find((c) => c.name === "VentelisteOpretKunde");
    expect(create?.variables.input.email).toBe("test@example.com");
    expect(create?.variables.input.tags).toEqual(SAGE_BABY_TAGS);
    expect(create?.variables.input.emailMarketingConsent).toBeUndefined();
  });

  it("tilmelder en ny kunde nyhedsbrevet ved flueben", async () => {
    const shop = fakeShopify();
    await handleWaitlistRequest(request({ email: "a@b.dk", variantId: VARIANT, newsletter: true }), shop);
    const create = shop.calls.find((c) => c.name === "VentelisteOpretKunde");
    expect(create?.variables.input.emailMarketingConsent).toEqual({ marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" });
    expect(create?.variables.input.tags).toContain("nyhedsbrev-samtykke");
  });

  it("tilføjer tags til en eksisterende kunde uden at røre samtykket", async () => {
    const shop = fakeShopify({ customer: { id: "gid://shopify/Customer/5", state: "NOT_SUBSCRIBED" } });
    const res = await handleWaitlistRequest(request({ email: "a@b.dk", variantId: VARIANT, newsletter: false }), shop);
    expect(await res.json()).toEqual({ ok: true });
    expect(shop.calls.map((c) => c.name)).toEqual(["VentelisteVariant", "VentelisteKunde", "VentelisteTags"]);
  });

  it("afmelder aldrig en kunde, der allerede er tilmeldt", async () => {
    const shop = fakeShopify({ customer: { id: "gid://shopify/Customer/5", state: "SUBSCRIBED" } });
    await handleWaitlistRequest(request({ email: "a@b.dk", variantId: VARIANT, newsletter: true }), shop);
    expect(shop.calls.map((c) => c.name)).not.toContain("VentelisteSamtykke");
  });

  it("tilmelder en eksisterende kunde ved flueben", async () => {
    const shop = fakeShopify({ customer: { id: "gid://shopify/Customer/5", state: "NOT_SUBSCRIBED" } });
    await handleWaitlistRequest(request({ email: "a@b.dk", variantId: VARIANT, newsletter: true }), shop);
    const consent = shop.calls.find((c) => c.name === "VentelisteSamtykke");
    expect(consent?.variables.input.customerId).toBe("gid://shopify/Customer/5");
  });

  it("afviser produkter uden venteliste", async () => {
    const shop = fakeShopify({ waitlist: "false" });
    const res = await handleWaitlistRequest(request({ email: "a@b.dk", variantId: VARIANT }), shop);
    expect(res.status).toBe(400);
    expect(shop.calls.map((c) => c.name)).toEqual(["VentelisteVariant"]);
  });

  it("afviser en ugyldig e-mail uden at spørge Shopify", async () => {
    const shop = fakeShopify();
    const res = await handleWaitlistRequest(request({ email: "ikke-en-mail", variantId: VARIANT }), shop);
    expect(res.status).toBe(400);
    expect(shop.calls).toHaveLength(0);
  });

  it("svarer ok til robotter, der udfylder det skjulte felt, uden at gøre noget", async () => {
    const shop = fakeShopify();
    const res = await handleWaitlistRequest(request({ email: "a@b.dk", variantId: VARIANT, company: "Spam ApS" }), shop);
    expect(await res.json()).toEqual({ ok: true });
    expect(shop.calls).toHaveLength(0);
  });

  it("tager aldrig tags fra forespørgslen", async () => {
    const shop = fakeShopify();
    await handleWaitlistRequest(request({ email: "a@b.dk", variantId: VARIANT, tags: "vip" }), shop);
    const create = shop.calls.find((c) => c.name === "VentelisteOpretKunde");
    expect(create?.variables.input.tags).not.toContain("vip");
  });
});
