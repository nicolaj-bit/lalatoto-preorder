// Dashboard: forudbestillinger og kunder. Kopieres til src/pages/ i
// Base44-appen (lalatoto-dashboard) af npm run base44:sync -- --to.
// Data hentes live fra Shopify via funktionen listPreorders; kortoplysninger
// hentes aldrig.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const STATUS_STYLE = {
  'afventer betaling': 'bg-amber-50 text-amber-800 border-amber-200',
  forfalden: 'bg-red-50 text-red-800 border-red-200',
  betalt: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  annulleret: 'bg-stone-100 text-stone-500 border-stone-200',
};

const STATUSES = ['alle', 'afventer betaling', 'forfalden', 'betalt', 'annulleret'];

function formatDate(iso) {
  if (!iso) return '–';
  return new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(iso));
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('da-DK', { style: 'currency', currency: currency || 'DKK' }).format(Number(amount));
}

/** base44.functions.invoke svarer med { data } fra funktionen. */
async function invoke(name, payload) {
  const res = await base44.functions.invoke(name, payload);
  const body = res?.data ?? res;
  if (!body?.ok) throw new Error(body?.error ?? 'Ukendt fejl');
  return body;
}

export default function Forudbestillinger() {
  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => base44.auth.me(),
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 px-6">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-semibold text-stone-900">Ingen adgang</h1>
          <p className="mt-2 text-stone-500">Denne side er kun for administratorer.</p>
          <button
            onClick={() => base44.auth.logout('/login')}
            className="mt-6 text-sm text-stone-700 underline underline-offset-4"
          >
            Log ud
          </button>
        </div>
      </div>
    );
  }

  return <Dashboard />;
}

function Dashboard() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('alle');

  const preorders = useQuery({
    queryKey: ['preorders'],
    queryFn: () => invoke('listPreorders', {}).then((b) => b.rows),
  });

  const preview = useQuery({
    queryKey: ['charge-preview'],
    queryFn: () => invoke('chargeDuePreorders', { dryRun: true }).then((b) => b.results),
    enabled: false,
  });

  const rows = preorders.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'alle' && r.status !== status) return false;
      if (!q) return true;
      return [r.orderNumber, r.customer.name, r.customer.email, r.customer.phone, ...r.items]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, search, status]);

  const totals = useMemo(() => {
    const open = rows.filter((r) => r.status === 'afventer betaling' || r.status === 'forfalden');
    return {
      count: rows.length,
      open: open.length,
      overdue: rows.filter((r) => r.status === 'forfalden').length,
      outstanding: open.reduce((sum, r) => sum + Number(r.outstanding), 0),
      currency: rows[0]?.currency ?? 'DKK',
    };
  }, [rows]);

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-stone-400">LALATOTO of Denmark</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900">Forudbestillinger</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => preview.refetch()}
              className="text-sm text-stone-700 border border-stone-300 rounded-md px-3 py-1.5 hover:bg-white transition-colors"
            >
              Hvad trækkes i dag?
            </button>
            <button
              onClick={() => preorders.refetch()}
              disabled={preorders.isFetching}
              className="text-sm text-white bg-stone-900 rounded-md px-3 py-1.5 hover:bg-stone-700 disabled:opacity-50 transition-colors"
            >
              {preorders.isFetching ? 'Henter …' : 'Opdatér'}
            </button>
            <button
              onClick={() => base44.auth.logout('/login')}
              className="text-sm text-stone-500 hover:text-stone-900 transition-colors"
            >
              Log ud
            </button>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Forudbestillinger" value={totals.count} />
          <Stat label="Venter på betaling" value={totals.open} />
          <Stat label="Forfaldne" value={totals.overdue} tone={totals.overdue > 0 ? 'text-red-700' : ''} />
          <Stat label="Udestående" value={formatMoney(totals.outstanding, totals.currency)} />
        </div>

        {(preview.isFetching || preview.data || preview.error) && (
          <div className="mt-6 bg-white border border-stone-200 rounded-xl p-5 text-sm">
            <p className="font-medium text-stone-900">Prøvekørsel af dagens træk — der trækkes intet</p>
            <div className="mt-2 space-y-1 text-stone-600">
              {preview.isFetching && <p>Henter …</p>}
              {preview.error && <p className="text-red-700">{preview.error.message}</p>}
              {preview.data?.length === 0 && <p>Ingen forfaldne forudbestillinger.</p>}
              {preview.data?.map((r) => (
                <p key={r.orderId}><span className="font-medium text-stone-900">{r.orderName}</span> — {r.detail}</p>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <input
            className="h-9 w-72 rounded-md border border-stone-300 bg-white px-3 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
            placeholder="Søg på kunde, e-mail, ordre eller vare"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="h-9 rounded-md border border-stone-300 bg-white px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === 'alle' ? 'Alle' : s[0].toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>

        {preorders.error && (
          <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Kunne ikke hente forudbestillinger: {preorders.error.message}
          </p>
        )}

        <div className="mt-4 bg-white border border-stone-200 rounded-xl overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {['Ordre', 'Kunde', 'Varer', 'Restbeløb', 'Forfalder', 'Status', 'Seneste træk'].map((c) => (
                  <TableHead key={c} className="text-stone-500 font-medium">{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preorders.isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-stone-400">Henter fra Shopify …</TableCell>
                </TableRow>
              )}
              {!preorders.isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-stone-400">Ingen forudbestillinger</TableCell>
                </TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.orderId} className="align-top">
                  <TableCell>
                    <a className="font-medium text-stone-900 underline underline-offset-4" href={r.adminUrl} target="_blank" rel="noreferrer">
                      {r.orderNumber}
                    </a>
                    <div className="text-xs text-stone-400">{formatDate(r.createdAt)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-stone-900">{r.customer.name ?? '–'}</div>
                    {r.customer.email && (
                      <a className="block text-stone-600 hover:underline" href={`mailto:${r.customer.email}`}>{r.customer.email}</a>
                    )}
                    {r.customer.phone && <div className="text-stone-600">{r.customer.phone}</div>}
                    {r.shippingAddress && <div className="text-xs text-stone-400">{r.shippingAddress}</div>}
                  </TableCell>
                  <TableCell className="text-stone-700">
                    {r.items.map((i) => <div key={i}>{i}</div>)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="text-stone-900">{formatMoney(r.outstanding, r.currency)}</div>
                    <div className="text-xs text-stone-400">af {formatMoney(r.total, r.currency)}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-stone-700">{formatDate(r.dueAt)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? ''}`}>
                      {r.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-stone-600">
                    {r.lastAttempt ? (
                      <>
                        <div>Forsøg {r.lastAttempt.attempt}: {r.lastAttempt.status}</div>
                        <div className="text-stone-400">{formatDate(r.lastAttempt.createdAt)}</div>
                        {r.lastAttempt.message && <div className="text-red-700">{r.lastAttempt.message}</div>}
                      </>
                    ) : '–'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = '' }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <div className="text-xs text-stone-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone || 'text-stone-900'}`}>{value}</div>
    </div>
  );
}
