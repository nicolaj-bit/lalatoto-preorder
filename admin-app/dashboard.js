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

export function filterRows(rows, search, status, productId) {
  const q = (search ?? '').trim().toLowerCase();
  return rows.filter((r) => {
    if (status && status !== 'alle' && r.status !== status) return false;
    if (!rowHasProduct(r, productId)) return false;
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

/**
 * Salg pr. produkt og variant ud fra forudbestillingslinjerne. Annullerede
 * ordrer tæller ikke med. Sorteret efter flest solgte stk.
 */
export function variantStats(rows) {
  const products = new Map();
  for (const r of rows) {
    if (r.status === 'annulleret') continue;
    for (const l of r.lines ?? []) {
      if (!l.quantity) continue;
      const pKey = l.productId ?? l.productTitle;
      let p = products.get(pKey);
      if (!p) {
        p = { productId: l.productId, title: l.productTitle, imageUrl: l.imageUrl, orders: new Set(), units: 0, total: 0, variants: new Map() };
        products.set(pKey, p);
      }
      const vKey = l.variantId ?? l.variantTitle ?? pKey;
      let v = p.variants.get(vKey);
      if (!v) {
        v = { variantId: l.variantId, title: l.variantTitle, imageUrl: l.imageUrl, orders: new Set(), units: 0, total: 0 };
        p.variants.set(vKey, v);
      }
      for (const x of [p, v]) {
        x.orders.add(r.orderId);
        x.units += l.quantity;
        x.total += Number(l.total);
      }
      p.imageUrl ??= l.imageUrl;
    }
  }
  const finish = (x) => ({ ...x, orders: x.orders.size, total: Math.round(x.total * 100) / 100 });
  const byUnits = (a, b) => b.units - a.units || b.total - a.total;
  return [...products.values()]
    .map((p) => ({ ...finish(p), variants: [...p.variants.values()].map(finish).sort(byUnits) }))
    .sort(byUnits);
}

/** Shopifys segmentforespørgsel for kunder, der har købt produktet. */
export function segmentQuery(productId) {
  return `products_purchased(id: ${String(productId).split('/').pop()}) = true`;
}

export function rowHasProduct(row, productId) {
  return !productId || productId === 'alle' || (row.lines ?? []).some((l) => l.productId === productId);
}
