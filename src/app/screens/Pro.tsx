// Seller Pro screens (Phase 3): reports, cost/profit, orders.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Field, Page, inputClass } from '../ui';
import { formatPrice } from '../../core/catalogue/layout';
import { WorkerError } from '../../core/db/client';
import { asciiDigits, type Key } from '../../i18n/i18n';
import type { CatalogueCandidate, Order, OrderStatus, SalesReport, StockValue } from '../../core/repo';

const DAY = 86_400_000;
type Period = 'today' | 'week' | 'month' | 'thisMonth';

function periodRange(p: Period, now: number): [string, string] {
  const end = new Date(now + DAY);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  if (p === 'today') start.setDate(start.getDate() - 1);
  else if (p === 'week') start.setDate(start.getDate() - 7);
  else if (p === 'month') start.setDate(start.getDate() - 30);
  else start.setTime(new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime());
  return [start.toISOString(), end.toISOString()];
}

/** Shows the upgrade screen when a Pro call is blocked; returns true when it was. */
function useBlocked() {
  const { showUpgrade } = useApp();
  return (e: unknown) => {
    if (e instanceof WorkerError && e.reason) { showUpgrade(e.reason); navigate('/', true); return true; }
    return false;
  };
}

export function ReportsPage() {
  const { db, workspace, t } = useApp();
  const ws = workspace!;
  const blocked = useBlocked();
  const [period, setPeriod] = useState<Period>('week');
  const [rep, setRep] = useState<SalesReport | null>(null);
  const [value, setValue] = useState<StockValue | null>(null);
  const money = (m: number) => formatPrice(m, ws.currency);

  useEffect(() => {
    const [from, to] = periodRange(period, Date.now());
    void db.salesReport(ws.id, from, to, -new Date().getTimezoneOffset()).then(setRep).catch((e) => { if (!blocked(e)) throw e; });
    void db.stockValue(ws.id).then(setValue).catch(() => setValue(null));
  }, [db, ws.id, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxDay = Math.max(1, ...(rep?.byDay.map((d) => d.revenueMinor) ?? [1]));
  return (
    <Page title={t('rep.title')} back={() => navigate('/')}>
      <div className="grid grid-cols-4 gap-1" role="group">
        {(['today', 'week', 'month', 'thisMonth'] as const).map((p) => (
          <Button key={p} variant={period === p ? 'primary' : 'secondary'} className="px-1 text-sm" aria-pressed={period === p} onClick={() => setPeriod(p)}>
            {t(`rep.${p}` as Key)}
          </Button>
        ))}
      </div>
      {rep && (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center" data-testid="report-totals">
            <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">{t('rep.units')}</dt><dd className="text-xl font-semibold">{rep.unitsSold}</dd></div>
            <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">{t('rep.sales')}</dt><dd className="text-xl font-semibold">{money(rep.revenueMinor)}</dd></div>
            <div className="rounded-xl bg-green-50 p-3"><dt className="text-xs text-slate-500">{t('rep.profit')}</dt><dd className="text-xl font-semibold text-green-800">{money(rep.profitMinor)}</dd></div>
          </dl>
          {rep.unitsWithoutCost > 0 && <p className="mt-2 text-sm text-amber-900">{t('rep.noCost', { n: rep.unitsWithoutCost })}</p>}
          {rep.unitsSold === 0 && <p className="py-6 text-center text-slate-500">{t('rep.none')}</p>}
          {rep.bestSellers.length > 0 && (
            <section className="mt-6">
              <h2 className="text-lg font-semibold">{t('rep.best')}</h2>
              <ol className="divide-y" aria-label="best sellers">
                {rep.bestSellers.map((b) => (
                  <li key={b.itemId} className="flex justify-between py-2">
                    <button type="button" className="text-left" onClick={() => navigate(`/item/${b.itemId}`)}>{b.name}</button>
                    <span className="text-slate-600">{b.units} · {money(b.revenueMinor)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {rep.byDay.length > 1 && (
            <section className="mt-6">
              <h2 className="text-lg font-semibold">{t('rep.byDay')}</h2>
              <ul className="mt-2 space-y-1" aria-label="sales by day">
                {rep.byDay.map((d) => (
                  <li key={d.day} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 text-slate-600">{new Date(`${d.day}T12:00:00`).toLocaleDateString(ws.language === 'bn' ? 'bn-BD' : 'en-AU', { day: 'numeric', month: 'short' })}</span>
                    <span className="h-4 rounded bg-blue-600" style={{ width: `${Math.max(2, (d.revenueMinor / maxDay) * 60)}%` }} />
                    <span>{money(d.revenueMinor)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {value && (
        <section className="mt-6 rounded-xl border p-3">
          <h2 className="font-semibold">{t('rep.stock')}: {t('rep.stockUnits', { n: value.unitsInStock })}</h2>
          <p className="text-sm">{t('rep.atCost', { v: money(value.atCostMinor) })}</p>
          <p className="text-sm">{t('rep.atPrice', { v: money(value.atPriceMinor) })}</p>
        </section>
      )}
    </Page>
  );
}

const STATUSES: (OrderStatus | 'all')[] = ['open', 'packed', 'delivered', 'cancelled', 'all'];

export function OrdersPage() {
  const { db, workspace, t } = useApp();
  const ws = workspace!;
  const blocked = useBlocked();
  const [tab, setTab] = useState<OrderStatus | 'all'>('open');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [form, setForm] = useState<{ customer: string; phone: string; note: string } | null>(null);

  useEffect(() => {
    void db.listOrders(ws.id, tab === 'all' ? undefined : tab).then(setOrders).catch((e) => { if (!blocked(e)) throw e; });
  }, [db, ws.id, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!form?.customer.trim()) return;
    const o = await db.createOrder(ws.id, form);
    navigate(`/order/${o.id}`);
  };

  return (
    <Page title={t('ord.title')} back={() => navigate('/')}>
      {form ? (
        <form className="flex flex-col" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Field label={t('ord.customer')}><input className={inputClass} maxLength={80} value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} /></Field>
          <Field label={t('ord.phone')}><input className={inputClass} inputMode="tel" maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label={t('ord.note')}><input className={inputClass} maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <Button type="submit" disabled={!form.customer.trim()}>{t('ord.create')}</Button>
          <Button variant="ghost" onClick={() => setForm(null)}>{t('box.back')}</Button>
        </form>
      ) : (
        <>
          <Button className="w-full" onClick={() => setForm({ customer: '', phone: '', note: '' })}>{t('ord.new')}</Button>
          <div className="mt-3 flex gap-1 overflow-x-auto" role="group">
            {STATUSES.map((s) => (
              <Button key={s} variant={tab === s ? 'primary' : 'secondary'} className="px-3 text-sm" aria-pressed={tab === s} onClick={() => setTab(s)}>{t(`ord.${s}` as Key)}</Button>
            ))}
          </div>
          {orders?.length === 0 && <p className="py-10 text-center text-slate-500">{t('ord.none')}</p>}
          <ul className="mt-2 divide-y" aria-label="orders">
            {orders?.map((o) => (
              <li key={o.id}>
                <button type="button" className="flex w-full justify-between py-3 text-left" onClick={() => navigate(`/order/${o.id}`)}>
                  <span><span className="font-medium">{t('ord.number', { n: o.number })} · {o.customer}</span><br /><span className="text-sm text-slate-500">{t('ord.lines', { n: o.lines.reduce((s, l) => s + l.qty, 0) })} · {t(`ord.${o.status}` as Key)}</span></span>
                  <span>{formatPrice(o.totalMinor, ws.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}

export function OrderPage({ id }: { id: string }) {
  const { db, workspace, t, toast } = useApp();
  const ws = workspace!;
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [items, setItems] = useState<CatalogueCandidate[]>([]);
  const [pick, setPick] = useState('');
  const [qty, setQty] = useState('1');

  const load = useCallback(async () => {
    setOrder((await db.getOrder(id)) ?? null);
    setItems(await db.catalogueCandidates(ws.id));
  }, [db, id, ws.id]);
  useEffect(() => { void load(); }, [load]);

  if (order === undefined) return null;
  if (order === null) return <Page title={t('ord.title')} back={() => navigate('/orders')}><p className="py-6">{t('ord.none')}</p></Page>;

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) {
      if (e instanceof WorkerError && e.name === 'NotEnoughStockError') toast(t('stock.notEnough', { n: Number(/\((-?\d+) available\)/.exec(e.message)?.[1] ?? 0) }));
      else toast(t('error.generic', { msg: (e as Error).message }));
    }
    await load();
  };
  const n = Number(asciiDigits(qty));
  const open = order.status === 'open';
  const money = (m: number) => formatPrice(m, ws.currency);
  const share = async () => {
    const text = [`${ws.name} · ${t('ord.number', { n: order.number })}`, order.customer,
      ...order.lines.map((l) => `${l.qty} × ${l.name}${l.unitPriceMinor != null ? ` · ${money(l.unitPriceMinor * l.qty)}` : ''}`),
      t('ord.total', { v: money(order.totalMinor) })].join('\n');
    if (navigator.share) await navigator.share({ text }).catch(() => {});
    else { await navigator.clipboard?.writeText(text); toast(t('box.saved')); }
  };

  return (
    <Page title={`${t('ord.number', { n: order.number })} · ${order.customer}`} back={() => navigate('/orders')}>
      <p className="text-sm text-slate-600" data-testid="order-status">{t(`ord.${order.status}` as Key)}{order.phone ? ` · ${order.phone}` : ''}{order.note ? ` · ${order.note}` : ''}</p>
      <ul className="mt-3 divide-y" aria-label="order lines">
        {order.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between py-2">
            <span>{l.qty} × {l.name}</span>
            <span className="flex items-center gap-2">
              {l.unitPriceMinor != null && <span className="text-slate-600">{money(l.unitPriceMinor * l.qty)}</span>}
              {open && <Button variant="ghost" className="min-h-12 px-2" onClick={() => void run(() => db.removeOrderLine(l.id))}>{t('ord.remove')}</Button>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-right text-lg font-semibold" data-testid="order-total">{t('ord.total', { v: money(order.totalMinor) })}</p>

      {open && (
        <section className="mt-4">
          <h2 className="font-semibold">{t('ord.addItem')}</h2>
          <div className="flex gap-2">
            <select className={inputClass} aria-label={t('ord.pickItem')} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t('ord.pickItem')}</option>
              {items.filter((i) => i.available > 0).map((i) => <option key={i.itemId} value={i.itemId}>{i.name} ({t('stock.inStock', { n: i.available })})</option>)}
            </select>
            <input className={`${inputClass} w-20`} inputMode="numeric" aria-label={t('stock.qty')} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <Button className="mt-2 w-full" disabled={!pick || !Number.isInteger(n) || n < 1} onClick={() => void run(async () => { await db.addOrderLine(order.id, pick, n); setPick(''); setQty('1'); })}>{t('ord.addItem')}</Button>
        </section>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {open && order.lines.length > 0 && <Button onClick={() => void run(() => db.packOrder(order.id))}>{t('ord.pack')}</Button>}
        {order.status === 'packed' && <Button onClick={() => void run(() => db.deliverOrder(order.id))}>{t('ord.deliver')}</Button>}
        {order.lines.length > 0 && <Button variant="secondary" onClick={() => void share()}>{t('ord.share')}</Button>}
        {open && <Button variant="danger" onClick={() => { if (confirm(t('ord.cancelConfirm'))) void run(() => db.cancelOrder(order.id)); }}>{t('ord.cancel')}</Button>}
      </div>
    </Page>
  );
}
