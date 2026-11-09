// Base44-funktionen waitlistSignup: ventelisten på produktsiden i temaet.
//
//   POST { email, variantId, newsletter, company }
//
// Shopifys egen kundeformular ({% form 'customer' %}) tilmelder altid kunden
// nyhedsbrevet. Derfor opretter vi kunden her i stedet:
//
//   - Varianten slås op hos Shopify, og alle tags dannes ud fra den. Tags
//     kommer aldrig fra forespørgslen, så ingen kan sætte vilkårlige tags.
//   - Produktet skal have «Venteliste» slået til (metafeltet lalatoto.waitlist).
//   - Nyhedsbrevet tilmeldes kun, når newsletter er sand. En kunde, der
//     allerede er tilmeldt, bliver ved med at være det; vi afmelder aldrig.
//   - «company» er et skjult felt, som mennesker ikke udfylder. Er det
//     udfyldt, svarer vi ok uden at gøre noget (spam).

import type { Graphql } from "../preorder/cancelService.ts";

/** Ventelisten kaldes fra butikkens egne domæner; svaret er ikke personligt. */
export const WAITLIST_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Id",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...WAITLIST_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Samme resultat som Liquids handleize for de navne, butikken bruger:
 * små bogstaver, æ/ø/å omskrevet, alt andet end bogstaver og tal bliver «-».
 */
export function handleize(value: string): string {
  return value
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type WaitlistVariant = {
  title: string;
  selectedOptions: { name: string; value: string }[];
  productHandle: string;
};

/**
 * Tags for en tilmelding. Samme opbygning som temaets
 * snippets/lalatoto-waitlist.liquid:
 *   venteliste, venteliste-<produkt>, venteliste-<produkt>-<variant>,
 *   venteliste-<produkt>-farve-<værdi>, venteliste-<produkt>-str-<værdi>,
 *   venteliste-farve-<værdi> (på tværs af produkter)
 * plus nyhedsbrev-samtykke, når kunden har sat flueben.
 */
export function waitlistTags(variant: WaitlistVariant, newsletter: boolean): string[] {
  const product = `venteliste-${variant.productHandle}`;
  const tags = ["venteliste", product];
  const variantHandle = handleize(variant.title);
  if (variantHandle && variantHandle !== "default-title") tags.push(`${product}-${variantHandle}`);

  for (const option of variant.selectedOptions) {
    const name = option.name.toLowerCase();
    const value = handleize(option.value);
    if (!value || value === "default-title") continue;
    const kind = /størrelse|size|größe/.test(name) ? "str" : "farve";
    tags.push(`${product}-${kind}-${value}`);
    if (kind === "farve") tags.push(`venteliste-farve-${value}`);
  }

  if (newsletter) tags.push("nyhedsbrev-samtykke");
  return [...new Set(tags)];
}

function variantGid(value: unknown): string | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (/^\d+$/.test(raw)) return `gid://shopify/ProductVariant/${raw}`;
  if (/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(raw)) return raw;
  return null;
}

const VARIANT_QUERY = `query VentelisteVariant($id: ID!) {
  productVariant(id: $id) {
    title
    selectedOptions { name value }
    product {
      handle
      status
      waitlist: metafield(namespace: "lalatoto", key: "waitlist") { value }
    }
  }
}`;

const CUSTOMER_QUERY = `query VentelisteKunde($email: String!) {
  customerByIdentifier(identifier: { emailAddress: $email }) {
    id
    defaultEmailAddress { marketingState }
  }
}`;

const CREATE_MUTATION = `mutation VentelisteOpretKunde($input: CustomerInput!) {
  customerCreate(input: $input) {
    customer { id }
    userErrors { field message }
  }
}`;

const TAGS_MUTATION = `mutation VentelisteTags($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    userErrors { field message }
  }
}`;

const CONSENT_MUTATION = `mutation VentelisteSamtykke($input: CustomerEmailMarketingConsentUpdateInput!) {
  customerEmailMarketingConsentUpdate(input: $input) {
    userErrors { field message }
  }
}`;

const SUBSCRIBED = { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" };

export type WaitlistLog = (entry: { email: string; variantId: string; ok: boolean; reason?: string; created?: boolean }) =>
  | Promise<void>
  | void;

export async function handleWaitlistRequest(
  req: Request,
  deps: { graphql: Graphql; log?: WaitlistLog },
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: WAITLIST_CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, reason: "METHOD" }, 405);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, reason: "BODY" }, 400);

  // Skjult felt udfyldt: en robot. Svar ok, så den ikke prøver igen.
  if (typeof body.company === "string" && body.company.trim() !== "") return json({ ok: true });

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_RE.test(email)) return json({ ok: false, reason: "EMAIL" }, 400);

  const variantId = variantGid(body.variantId);
  if (!variantId) return json({ ok: false, reason: "VARIANT" }, 400);
  const newsletter = body.newsletter === true;

  const data = await deps.graphql(VARIANT_QUERY, { id: variantId });
  const variant = data?.productVariant;
  if (!variant || variant.product?.status !== "ACTIVE" || variant.product?.waitlist?.value !== "true") {
    return json({ ok: false, reason: "NOT_WAITLIST" }, 400);
  }

  const tags = waitlistTags(
    { title: variant.title, selectedOptions: variant.selectedOptions ?? [], productHandle: variant.product.handle },
    newsletter,
  );

  const found = await deps.graphql(CUSTOMER_QUERY, { email });
  const existing = found?.customerByIdentifier as { id: string; defaultEmailAddress?: { marketingState?: string } } | null;

  if (!existing) {
    const input: Record<string, unknown> = { email, tags };
    if (newsletter) input.emailMarketingConsent = SUBSCRIBED;
    const created = await deps.graphql(CREATE_MUTATION, { input });
    const errors = created?.customerCreate?.userErrors ?? [];
    if (errors.length || !created?.customerCreate?.customer?.id) {
      await deps.log?.({ email, variantId, ok: false, reason: JSON.stringify(errors) });
      return json({ ok: false, reason: "CREATE" }, 400);
    }
    await deps.log?.({ email, variantId, ok: true, created: true });
    return json({ ok: true });
  }

  const tagged = await deps.graphql(TAGS_MUTATION, { id: existing.id, tags });
  const tagErrors = tagged?.tagsAdd?.userErrors ?? [];
  if (tagErrors.length) {
    await deps.log?.({ email, variantId, ok: false, reason: JSON.stringify(tagErrors) });
    return json({ ok: false, reason: "TAGS" }, 400);
  }

  if (newsletter && existing.defaultEmailAddress?.marketingState !== "SUBSCRIBED") {
    await deps.graphql(CONSENT_MUTATION, {
      input: { customerId: existing.id, emailMarketingConsent: SUBSCRIBED },
    });
  }

  await deps.log?.({ email, variantId, ok: true, created: false });
  return json({ ok: true });
}
