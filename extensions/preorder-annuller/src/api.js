// Kald til appens server. Kundekontoens udvidelser kører i en sandkasse og
// kender ikke appens adresse, så den står her.
//
// Sæt APP_URL til samme adresse som SHOPIFY_APP_URL / application_url, før
// udvidelsen udgives. Under `shopify app dev` er det tunnel-adressen.
export const APP_URL = "https://lalatoto-preorder.example.com";

const ENDPOINT = `${APP_URL}/api/preorder-cancel`;

async function authHeaders() {
  // Hentes lige før hvert kald: tokenet udløber efter 5 minutter.
  const token = await shopify.sessionToken.get();
  return { Authorization: `Bearer ${token}` };
}

/** @returns {Promise<{cancellable: boolean, refunds?: boolean, reason?: string}>} */
export async function fetchEligibility(orderId) {
  const res = await fetch(`${ENDPOINT}?orderId=${encodeURIComponent(orderId)}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** @returns {Promise<{ok: boolean, refunds?: boolean, reason?: string}>} */
export async function cancelPreorder(orderId) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  return res.json().catch(() => ({ ok: false, reason: `HTTP ${res.status}` }));
}
