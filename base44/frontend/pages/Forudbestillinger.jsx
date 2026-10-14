// Dashboard: forudbestillinger og kunder. Flyttes til src/pages/ i
// Base44-appen. Data hentes live fra Shopify via funktionen listPreorders;
// kortoplysninger hentes aldrig.
import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

const STATUS_STYLE = {
  'afventer betaling': 'bg-amber-100 text-amber-900',
  forfalden: 'bg-red-100 text-red-900',
  betalt: 'bg-green-100 text-green-900',
  annulleret: 'bg-gray-200 text-gray-700',
};

function formatDate(iso) {
  if (!iso) return '–';
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('da-DK', { style: 'currency', currency }).format(Number(amount));
}

export default function Forudbestillinger() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('alle');
  const [dryRun, setDryRun] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await base44.functions.invoke('listPreorders', {});
      const body = res?.data ?? res;
      if (!body?.ok) throw new Error(body?.error ?? 'Ukendt fejl');
      setRows(body.rows);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function previewCharges() {
    setDryRun({ loading: true });
    try {
      const res = await base44.functions.invoke('chargeDuePreorders', { dryRun: true });
      const body = res?.data ?? res;
      setDryRun({ results: body?.results ?? [], error: body?.ok ? null : body?.error });
    } catch (e) {
      setDryRun({ results: [], error: e.message });
    }
  }

  useEffect(() => {
    load();
  }, []);

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
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Forudbestillinger</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={previewCharges}>Hvad trækkes i dag?</Button>
          <Button onClick={load} disabled={loading}>{loading ? 'Henter …' : 'Opdatér'}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Forudbestillinger" value={totals.count} />
        <Stat label="Venter på betaling" value={totals.open} />
        <Stat label="Forfaldne" value={totals.overdue} tone={totals.overdue > 0 ? 'text-red-700' : ''} />
        <Stat label="Udestående" value={formatMoney(totals.outstanding, totals.currency)} />
      </div>

      {dryRun && (
        <Card>
          <CardHeader><CardTitle className="text-base">Prøvekørsel af dagens træk (der trækkes intet)</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {dryRun.loading && <p>Henter …</p>}
            {dryRun.error && <p className="text-red-700">{dryRun.error}</p>}
            {dryRun.results?.length === 0 && !dryRun.loading && <p>Ingen forfaldne forudbestillinger.</p>}
            {dryRun.results?.map((r) => (
              <p key={r.orderId}><strong>{r.orderName}</strong> — {r.detail}</p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Søg på kunde, e-mail, ordre eller vare" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="rounded-md border px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="alle">Alle</option>
          <option value="afventer betaling">Afventer betaling</option>
          <option value="forfalden">Forfaldne</option>
          <option value="betalt">Betalt</option>
          <option value="annulleret">Annulleret</option>
        </select>
      </div>

      {error && <p className="rounded-md bg-red-50 p-3 text-red-800">Kunne ikke hente forudbestillinger: {error}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="p-3">Ordre</th>
              <th className="p-3">Kunde</th>
              <th className="p-3">Varer</th>
              <th className="p-3">Restbeløb</th>
              <th className="p-3">Forfalder</th>
              <th className="p-3">Status</th>
              <th className="p-3">Seneste træk</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr><td className="p-3 text-gray-500" colSpan={7}>Ingen forudbestillinger.</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.orderId} className="border-t align-top">
                <td className="p-3">
                  <a className="font-medium underline" href={r.adminUrl} target="_blank" rel="noreferrer">{r.orderNumber}</a>
                  <div className="text-xs text-gray-500">{formatDate(r.createdAt)}</div>
                </td>
                <td className="p-3">
                  <div className="font-medium">{r.customer.name ?? '–'}</div>
                  {r.customer.email && <div><a className="underline" href={`mailto:${r.customer.email}`}>{r.customer.email}</a></div>}
                  {r.customer.phone && <div>{r.customer.phone}</div>}
                  {r.shippingAddress && <div className="text-xs text-gray-500">{r.shippingAddress}</div>}
                </td>
                <td className="p-3">{r.items.map((i) => <div key={i}>{i}</div>)}</td>
                <td className="p-3 whitespace-nowrap">
                  {formatMoney(r.outstanding, r.currency)}
                  <div className="text-xs text-gray-500">af {formatMoney(r.total, r.currency)}</div>
                </td>
                <td className="p-3 whitespace-nowrap">{formatDate(r.dueAt)}</td>
                <td className="p-3"><Badge className={STATUS_STYLE[r.status]}>{r.status}</Badge></td>
                <td className="p-3 text-xs">
                  {r.lastAttempt ? (
                    <>
                      <div>Forsøg {r.lastAttempt.attempt}: {r.lastAttempt.status}</div>
                      <div className="text-gray-500">{formatDate(r.lastAttempt.createdAt)}</div>
                      {r.lastAttempt.message && <div className="text-red-700">{r.lastAttempt.message}</div>}
                    </>
                  ) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = '' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-gray-500">{label}</div>
        <div className={`text-xl font-semibold ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
