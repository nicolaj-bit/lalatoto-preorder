// Dashboardet inde i Shopify admin. Bygges med Polaris' web components, så
// det ligner resten af admin. Data kommer fra Base44 (adminPreorders).
import {
  STATUS_TONE, callAdmin, filterRows, formatDate, formatMoney, orderLink, segmentQuery, totals, variantStats,
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
        : '–'));
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

async function copySegment(product) {
  const query = segmentQuery(product.productId);
  try {
    await navigator.clipboard.writeText(query);
    window.shopify.toast.show('Segment kopieret — sæt det ind under Kunder → Segmenter');
  } catch {
    window.prompt('Kopiér forespørgslen til segmentet:', query);
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
        p.productId && h('s-button', { variant: 'tertiary', 'data-product': p.productId }, 'Kopiér segment'))));
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
  for (const btn of $('variant-rows').querySelectorAll('s-button[data-product]')) {
    const product = stats.find((p) => p.productId === btn.dataset.product);
    btn.addEventListener('click', () => copySegment(product));
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

async function preview() {
  const section = $('preview-section');
  const list = $('preview-list');
  section.hidden = false;
  list.replaceChildren(h('s-text', { color: 'subdued' }, 'Henter …'));
  $('preview').setAttribute('loading', '');
  try {
    const { results } = await callAdmin('chargePreview', idToken);
    list.replaceChildren(
      ...(results.length === 0
        ? [h('s-text', {}, 'Ingen forfaldne forudbestillinger.')]
        : results.map((r) => h('s-text', {}, h('s-text', { type: 'strong' }, r.orderName ?? r.orderId), ` — ${r.detail}`))),
    );
  } catch (error) {
    list.replaceChildren(h('s-text', { tone: 'critical' }, error.message));
  } finally {
    $('preview').removeAttribute('loading');
  }
}

$('refresh').addEventListener('click', load);
$('preview').addEventListener('click', preview);
$('search').addEventListener('input', renderRows);
$('status').addEventListener('change', renderRows);
$('product').addEventListener('change', renderRows);
load();
