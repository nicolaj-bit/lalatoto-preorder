// Dashboardet inde i Shopify admin. Bygges med Polaris' web components, så
// det ligner resten af admin. Data kommer fra Base44 (adminPreorders).
import {
  OUTCOME_TEXT, STATUS_TONE, callAdmin, chargeSummary, chargeableForProduct, filterRows, isChargeable, formatDate, formatMoney, orderLink, segmentLink, segmentQuery, totals, variantStats,
} from './dashboard.js';

const $ = (id) => document.getElementById(id);
let rows = [];

/** Laver et element. Tekst sættes altid som tekst, aldrig som HTML. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const idToken = () => window.shopify.idToken();

function stat(label, value, tone) {
  return h('s-box', { padding: 'base', border: 'base', borderRadius: 'base', background: 'base' },
    h('s-text', { color: 'subdued' }, label),
    h('s-heading', {}, h('s-text', tone ? { tone } : {}, value)));
}

function renderStats() {
  const t = totals(rows);
  $('stats').replaceChildren(
    stat('Forudbestillinger', t.count),
    stat('Venter på betaling', t.open),
    stat('Forfaldne', t.overdue, t.overdue > 0 ? 'critical' : null),
    stat('Udestående', formatMoney(t.outstanding, t.currency)),
  );
}

function row(r) {
  const c = r.customer;
  return h('s-table-row', {},
    h('s-table-cell', {},
      h('s-stack', { gap: 'small-500' },
        h('s-link', { href: orderLink(r.orderId), target: '_top' }, r.orderNumber),
        h('s-text', { color: 'subdued' }, formatDate(r.createdAt)))),
    h('s-table-cell', {},
      h('s-stack', { gap: 'small-500' },
        h('s-text', { type: 'strong' }, c.name ?? '–'),
        c.email && h('s-link', { href: `mailto:${c.email}` }, c.email),
        c.phone && h('s-text', {}, c.phone),
        r.shippingAddress && h('s-text', { color: 'subdued' }, r.shippingAddress))),
    h('s-table-cell', {}, h('s-stack', { gap: 'small-500' }, r.items.map((i) => h('s-text', {}, i)))),
    h('s-table-cell', {},
      h('s-stack', { gap: 'small-500', alignItems: 'end' },
        h('s-text', {}, formatMoney(r.outstanding, r.currency)),
        h('s-text', { color: 'subdued' }, `af ${formatMoney(r.total, r.currency)}`))),
    h('s-table-cell', {}, formatDate(r.dueAt)),
    h('s-table-cell', {}, h('s-badge', { tone: STATUS_TONE[r.status] ?? 'neutral' }, r.status)),
    h('s-table-cell', {},
      r.lastAttempt
        ? h('s-stack', { gap: 'small-500' },
          h('s-text', {}, `Forsøg ${r.lastAttempt.attempt}: ${r.lastAttempt.status}`),
          h('s-text', { color: 'subdued' }, formatDate(r.lastAttempt.createdAt)),
          r.lastAttempt.message && h('s-text', { tone: 'critical' }, r.lastAttempt.message))
        : '–'),
    h('s-table-cell', {},
      isChargeable(r) && h('s-button', { 'data-charge-order': r.orderId }, 'Træk')));
}

function shareBar(part, whole) {
  const pct = whole > 0 ? Math.round((part / whole) * 100) : 0;
  const bar = h('div', { style: 'display:flex;align-items:center;gap:8px;min-width:140px' },
    h('div', { style: 'flex:1;height:6px;border-radius:3px;background:#e3e3e3;overflow:hidden' },
      h('div', { style: `width:${pct}%;height:100%;background:#8ec5ff` })),
    h('s-text', { color: 'subdued' }, `${pct} %`));
  return bar;
}

function thumb(url, title) {
  return url
    ? h('s-box', { border: 'base', borderRadius: 'base', overflow: 'hidden', inlineSize: '40px', blockSize: '40px' },
      h('s-image', { src: url, alt: title, objectFit: 'cover' }))
    : h('s-box', { inlineSize: '40px', blockSize: '40px' });
}

async function createSegment(product, button) {
  button.setAttribute('loading', '');
  try {
    const res = await callAdmin('createSegment', idToken, { productId: product.productId, productTitle: product.title });
    window.shopify.toast.show(res.existed ? `Segmentet «${res.name}» fandtes allerede` : `Segmentet «${res.name}» er oprettet`);
    // Åbn segmentet i Shopify, så det kan bruges i Shopify Email med det samme.
    window.open(segmentLink(res.id), '_top');
  } catch (error) {
    // Uden write_customers eller ved fejl: giv forespørgslen, så den kan sættes ind i hånden.
    window.prompt(`Kunne ikke oprette segmentet (${error.message}). Kopiér forespørgslen og sæt den ind under Kunder → Segmenter:`, segmentQuery(product.productId));
  } finally {
    button.removeAttribute('loading');
  }
}

function renderVariants() {
  const stats = variantStats(rows);
  const currency = rows[0]?.currency ?? 'DKK';
  const out = [];
  for (const p of stats) {
    out.push(h('s-table-row', {},
      h('s-table-cell', {},
        h('s-stack', { direction: 'inline', gap: 'base', alignItems: 'center' },
          thumb(p.imageUrl, p.title), h('s-text', { type: 'strong' }, p.title))),
      h('s-table-cell', {}, h('s-text', { type: 'strong' }, p.orders)),
      h('s-table-cell', {}, h('s-text', { type: 'strong' }, p.units)),
      h('s-table-cell', {}, ''),
      h('s-table-cell', {}, h('s-text', { type: 'strong' }, formatMoney(p.total, currency))),
      h('s-table-cell', {},
        h('s-stack', { direction: 'inline', gap: 'small-200' },
          p.productId && chargeableForProduct(rows, p.productId).length > 0 &&
            h('s-button', { 'data-charge-product': p.productId }, 'Træk alle'),
          p.productId && h('s-button', { variant: 'tertiary', 'data-product': p.productId }, 'Opret segment')))));
    if (p.variants.length > 1 || p.variants[0]?.title) {
      for (const v of p.variants) {
        out.push(h('s-table-row', {},
          h('s-table-cell', {},
            h('s-stack', { direction: 'inline', gap: 'base', alignItems: 'center', paddingInlineStart: 'large-200' },
              thumb(v.imageUrl, v.title ?? p.title), h('s-text', {}, v.title ?? p.title))),
          h('s-table-cell', {}, v.orders),
          h('s-table-cell', {}, v.units),
          h('s-table-cell', {}, shareBar(v.units, p.units)),
          h('s-table-cell', {}, formatMoney(v.total, currency)),
          h('s-table-cell', {}, '')));
      }
    }
  }
  $('variant-rows').replaceChildren(
    ...(out.length > 0 ? out : [h('s-table-row', {}, h('s-table-cell', {}, 'Ingen forudbestillinger endnu'))]),
  );
  for (const btn of $('variant-rows').querySelectorAll('s-button[data-charge-product]')) {
    const product = stats.find((p) => p.productId === btn.dataset.chargeProduct);
    btn.addEventListener('click', () => askCharge(chargeableForProduct(rows, product.productId), product.title));
  }
  for (const btn of $('variant-rows').querySelectorAll('s-button[data-product]')) {
    const product = stats.find((p) => p.productId === btn.dataset.product);
    btn.addEventListener('click', () => createSegment(product, btn));
  }

  // Produktfilteret over ordrelisten.
  const select = $('product');
  const current = select.value || 'alle';
  select.replaceChildren(
    h('s-option', { value: 'alle' }, 'Alle produkter'),
    ...stats.filter((p) => p.productId).map((p) => h('s-option', { value: p.productId }, p.title)),
  );
  select.value = stats.some((p) => p.productId === current) ? current : 'alle';
}

function renderRows() {
  const shown = filterRows(rows, $('search').value, $('status').value, $('product').value);
  queueMicrotask(() => {
    for (const btn of $('rows').querySelectorAll('s-button[data-charge-order]')) {
      const row = rows.find((r) => r.orderId === btn.dataset.chargeOrder);
      btn.addEventListener('click', () => askCharge([row], row.orderNumber));
    }
  });
  $('rows').replaceChildren(
    ...(shown.length > 0
      ? shown.map(row)
      : [h('s-table-row', {}, h('s-table-cell', {}, 'Ingen forudbestillinger'))]),
  );
}

async function load() {
  $('table').setAttribute('loading', '');
  $('variants').setAttribute('loading', '');
  $('refresh').setAttribute('loading', '');
  $('error').hidden = true;
  try {
    rows = (await callAdmin('list', idToken)).rows;
    renderStats();
    renderVariants();
    renderRows();
  } catch (error) {
    $('error-text').textContent = error.message;
    $('error').hidden = false;
  } finally {
    $('table').removeAttribute('loading');
    $('variants').removeAttribute('loading');
    $('refresh').removeAttribute('loading');
  }
}

let pendingCharge = [];

/** Viser bekræftelsen: hvor mange ordrer og hvor meget, der trækkes. */
function askCharge(selected, label) {
  pendingCharge = selected;
  const { count, amount, currency } = chargeSummary(selected);
  $('charge-modal-body').replaceChildren(
    h('s-paragraph', {},
      count === 1
        ? `Restbeløbet på ${label} trækkes nu på kundens kort: ${formatMoney(amount, currency)}`
        : `Restbeløbet på ${count} forudbestillinger af ${label} trækkes nu på kundernes kort: i alt ${formatMoney(amount, currency)}`),
    h('s-paragraph', { color: 'subdued' }, 'Gør det først, når varen er klar til at blive sendt. Et træk kan ikke fortrydes her — det skal refunderes i ordren.'),
  );
  $('charge-modal').showOverlay();
}

async function confirmCharge() {
  const selected = pendingCharge;
  if (selected.length === 0) return;
  const button = $('charge-confirm');
  button.setAttribute('loading', '');
  try {
    const { results } = await callAdmin('charge', idToken, { orderIds: selected.map((r) => r.orderId) });
    $('charge-modal').hideOverlay();
    const charged = results.filter((r) => r.outcome === 'charged').length;
    window.shopify.toast.show(`${charged} af ${results.length} trukket`, { isError: charged < results.length });
    $('result-list').replaceChildren(...results.map((r) =>
      h('s-text', {}, h('s-text', { type: 'strong' }, r.orderName ?? r.orderId), ` — ${OUTCOME_TEXT[r.outcome] ?? r.outcome}: ${r.detail}`)));
    $('result-section').hidden = false;
    await load();
  } catch (error) {
    window.shopify.toast.show(`Kunne ikke trække: ${error.message}`, { isError: true });
  } finally {
    button.removeAttribute('loading');
    pendingCharge = [];
  }
}

$('refresh').addEventListener('click', load);
$('charge-confirm').addEventListener('click', confirmCharge);
$('search').addEventListener('input', renderRows);
$('status').addEventListener('change', renderRows);
$('product').addEventListener('change', renderRows);
load();
