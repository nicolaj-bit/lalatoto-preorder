// Ren logik til dashboardet i Shopify admin. Ingen DOM her, så det kan
// testes (tests/unit/adminApp.test.ts).

// Base44-appen «Lalatoto Forudbestilling» (lalatoto-dashboard). Samme som i
// extensions/preorder-annuller/src/api.js.
export const BASE44_ORIGIN = 'https://lala-order-flow.base44.app';
export const BASE44_APP_ID = '6ad0540094b2b23633a4f532';
export const ENDPOINT = `${BASE44_ORIGIN}/api/apps/${BASE44_APP_ID}/functions/adminPreorders`;

export const STATUS_TONE = {
  'afventer betaling': 'warning',
  forfalden: 'critical',
  betalt: 'success',
  annulleret: 'neutral',
};

export function formatDate(iso) {
  if (!iso) return '–';
  return new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(iso));
}

export function formatMoney(amount, currency) {
  return new Intl.NumberFormat('da-DK', { style: 'currency', currency: currency || 'DKK' }).format(Number(amount));
}

/** Ordrens tal-id til et link i admin, fx shopify://admin/orders/123. */
export function orderLink(orderId) {
  return `shopify://admin/orders/${String(orderId).split('/').pop()}`;
}

export function filterRows(rows, search, status) {
  const q = (search ?? '').trim().toLowerCase();
  return rows.filter((r) => {
    if (status && status !== 'alle' && r.status !== status) return false;
    if (!q) return true;
    return [r.orderNumber, r.customer.name, r.customer.email, r.customer.phone, ...r.items]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });
}

export function totals(rows) {
  const open = rows.filter((r) => r.status === 'afventer betaling' || r.status === 'forfalden');
  return {
    count: rows.length,
    open: open.length,
    overdue: rows.filter((r) => r.status === 'forfalden').length,
    outstanding: open.reduce((sum, r) => sum + Number(r.outstanding), 0),
    currency: rows[0]?.currency ?? 'DKK',
  };
}

/**
 * Kalder Base44-funktionen adminPreorders. `getToken` er App Bridges
 * shopify.idToken — tokenet lever kun et minut, så der hentes et nyt hver gang.
 */
export async function callAdmin(action, getToken, fetchImpl = fetch) {
  const token = await getToken();
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-App-Id': BASE44_APP_ID,
    },
    body: JSON.stringify({ action }),
  });
  const body = await res.json().catch(() => null);
  if (!body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}
