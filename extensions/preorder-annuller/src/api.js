// Kald til appens server, som er en Base44-funktion (cancelPreorder).
// Kundekontoens udvidelser kører i en sandkasse og kender ikke adressen, så
// den står her. Sæt de to værdier, når Base44-appen er oprettet.
//
//   POST {BASE44_ORIGIN}/api/apps/{BASE44_APP_ID}/functions/cancelPreorder
//   { action: "check" | "cancel", orderId }
//
// Kunden genkendes på kundekontoens session token i Authorization-headeren.
// Funktionen bruger tokenets kunde-id, aldrig et id fra forespørgslen.
export const BASE44_ORIGIN = 'https://lalatoto-forudbestilling.base44.app';
export const BASE44_APP_ID = 'SKAL-UDFYLDES';

const ENDPOINT = `${BASE44_ORIGIN}/api/apps/${BASE44_APP_ID}/functions/cancelPreorder`;

async function call(action, orderId) {
  // Hentes lige før hvert kald: tokenet udløber efter 5 minutter.
  const token = await shopify.sessionToken.get();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-App-Id': BASE44_APP_ID,
    },
    body: JSON.stringify({action, orderId}),
  });
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`HTTP ${res.status}`);
  return body;
}

/** @returns {Promise<{cancellable: boolean, refunds?: boolean, reason?: string}>} */
export function fetchEligibility(orderId) {
  return call('check', orderId);
}

/** @returns {Promise<{ok: boolean, refunds?: boolean, reason?: string}>} */
export function cancelPreorder(orderId) {
  return call('cancel', orderId);
}
