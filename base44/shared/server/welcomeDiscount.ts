// Nyhedsbrevets rabatkode (VELKOMMEN15) som app-rabat med appens rabatfunktion
// extensions/nyhedsbrev-rabat: 15 % på alt, der ikke er på tilbud.
//
// En rabat, der bruger en app-funktion, kan kun oprettes af appen selv — ikke
// fra Shopify admin eller af andre apps. Derfor ligger det her. Kaldet er
// idempotent: findes koden allerede, oprettes intet, og den eksisterende vises.

import type { Graphql } from "../preorder/cancelService.ts";

export const WELCOME_CODE = "VELKOMMEN15";
export const WELCOME_FUNCTION_HANDLE = "nyhedsbrev-rabat";

const FIND = `query VelkomstFind($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id
    codeDiscount {
      __typename
      ... on DiscountCodeApp { title status appliesOncePerCustomer }
      ... on DiscountCodeBasic { title status }
    }
  }
}`;

const CREATE = `mutation VelkomstOpret($discount: DiscountCodeAppInput!) {
  discountCodeAppCreate(codeAppDiscount: $discount) {
    codeAppDiscount { discountId title status }
    userErrors { field message code }
  }
}`;

export type WelcomeDiscountResult =
  | { ok: true; created: boolean; id: string; type: string; title: string; status: string }
  | { ok: false; errors: { field?: string[] | null; message: string }[] };

export async function ensureWelcomeDiscount(graphql: Graphql, now = new Date()): Promise<WelcomeDiscountResult> {
  const found = await graphql(FIND, { code: WELCOME_CODE });
  const node = found?.codeDiscountNodeByCode;
  if (node) {
    return {
      ok: true,
      created: false,
      id: node.id,
      type: node.codeDiscount?.__typename ?? "",
      title: node.codeDiscount?.title ?? "",
      status: node.codeDiscount?.status ?? "",
    };
  }

  const data = await graphql(CREATE, {
    discount: {
      title: `Nyhedsbrev: ${WELCOME_CODE}`,
      code: WELCOME_CODE,
      functionHandle: WELCOME_FUNCTION_HANDLE,
      startsAt: now.toISOString(),
      appliesOncePerCustomer: true,
      discountClasses: ["PRODUCT"],
      combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    },
  });
  const result = data?.discountCodeAppCreate;
  const errors = result?.userErrors ?? [];
  if (errors.length || !result?.codeAppDiscount) {
    return { ok: false, errors: errors.length ? errors : [{ message: "Ingen rabat i svaret" }] };
  }
  return {
    ok: true,
    created: true,
    id: result.codeAppDiscount.discountId,
    type: "DiscountCodeApp",
    title: result.codeAppDiscount.title,
    status: result.codeAppDiscount.status,
  };
}
