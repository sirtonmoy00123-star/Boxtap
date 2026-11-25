// Seller mode screens (Phase 2: S-01..S-10, booked tap ADR-013, jewellery fields ADR-012, low stock S-21).
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Field, Page, inputClass } from '../ui';
import { PhotoStrip } from './Photos';
import { WorkerError } from '../../core/db/client';
import { asciiDigits, type Key } from '../../i18n/i18n';
import type { Box, Item, LowStockRow, Movement, StockReason } from '../../core/repo';
import type { Db } from '../../core/db/client';

const toInt = (s: string): number | null => {
  const t = asciiDigits(s).trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : NaN;
};
/** Major units (taka/dollars, up to 2 decimals) to minor units. */
const toMinor = (s: string): number | null => {
  const t = asciiDigits(s).trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};
const fromMinor = (v: number | null) => (v == null ? '' : (v / 100).toString());

type T = (k: Key, v?: Record<string, string | number>) => string;

/** Sells or changes stock, asking "sell anyway?" when it would go below zero. Returns the movement or null. */
async function changeStock(db: Db, t: T, toast: (m: string) => void, itemId: string, reason: StockReason, qty: number): Promise<Movement | null> {
  try {
    return await db.recordStock(itemId, reason, qty);
  } catch (e) {
    if (e instanceof WorkerError && e.name === 'NotEnoughStockError') {
      const available = Number(/\((-?\d+) available\)/.exec(e.message)?.[1] ?? 0);
      if ((reason === 'sold' || reason === 'damaged') && confirm(t('stock.sellAnyway', { n: Math.max(0, available) }))) {
        return db.recordStock(itemId, reason, qty, { allowNegative: true });
      }
      if (reason !== 'sold' && reason !== 'damaged') toast(t('stock.notEnough', { n: Math.max(0, available) }));
      return null;
    }
    throw e;
  }
}

/** An undo bar that stays for 10 seconds (DATABASE_SCHEMA §4: "UI shows Undo for 10 s"). */
function useUndo() {
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(timer);
  }, [undo]);
  return [undo, setUndo] as const;
}

function UndoBar({ undo, onUndo }: { undo: { id: string; label: string } | null; onUndo: (id: string) => void }) {
  const { t } = useApp();
  if (!undo) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-center justify-between rounded-xl bg-slate-900 px-4 py-2 text-white">
      <span>{undo.label}</span>
      <button type="button" className="min-h-10 px-3 font-semibold text-amber-300" onClick={() => onUndo(undo.id)}>{t('stock.undo')}</button>
    </div>
  );
}

/** The item list of a Seller box: stock per item and one-tap Sell / Add (S-02, S-03). */
export function SellerItems({ box, items, reload }: { box: Box; items: Item[]; reload: () => Promise<void> }) {
  const { db, t, toast } = useApp();
  const [undo, setUndo] = useUndo();
  const [counting, setCounting] = useState<Record<string, string> | null>(null);

  const sell = async (it: Item) => {
    const m = await changeStock(db, t, toast, it.id, 'sold', 1);
    if (m) setUndo({ id: m.id, label: t('stock.sold', { name: it.name }) });
    await reload();
  };
  const add = async (it: Item) => { await db.recordStock(it.id, 'restock', 1); await reload(); };
  const doUndo = async (id: string) => { await db.undoStock(id); setUndo(null); toast(t('stock.undone')); await reload(); };
  const saveCount = async () => {
    if (!counting) return;
    const counts: Record<string, number> = {};
    for (const [id, v] of Object.entries(counting)) { const n = toInt(v); if (n != null && n >= 0 && !Number.isNaN(n)) counts[id] = n; }
    const changed = await db.countBox(box.id, counts);
    setCounting(null);
    toast(t('stock.counted', { n: changed }));
    await reload();
  };

  return (
    <>
      <ul className="divide-y" aria-label="items">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 py-2">
            <button type="button" className="flex-1 text-left" onClick={() => navigate(`/item/${it.id}`)}>
              <span className="block font-medium">{it.name}</span>
              <span className="text-sm text-slate-600" data-testid={`stock-${it.name}`}>
                {t('stock.inStock', { n: it.onHand - it.reserved })}{it.reserved > 0 ? ` · ${t('stock.booked', { n: it.reserved })}` : ''}
              </span>
            </button>
            {counting ? (
              <input className={`${inputClass} w-20`} inputMode="numeric" aria-label={`${t('stock.qty')} ${it.name}`}
                value={counting[it.id] ?? String(it.onHand)} onChange={(e) => setCounting({ ...counting, [it.id]: e.target.value })} />
            ) : (
              <>
                <Button variant="secondary" className="px-3" aria-label={`${t('stock.sell')} ${it.name}`} onClick={() => void sell(it)}>−1</Button>
                <Button variant="secondary" className="px-3" aria-label={`${t('stock.add')} ${it.name}`} onClick={() => void add(it)}>+1</Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {items.length > 0 && (counting
        ? <Button className="mt-2 w-full" onClick={() => void saveCount()}>{t('stock.countSave')}</Button>
        : <Button variant="ghost" className="mt-1 w-full" onClick={() => setCounting({})}>{t('stock.count')}</Button>)}
      <UndoBar undo={undo} onUndo={(id) => void doUndo(id)} />
    </>
  );
}

const ACTIONS: StockReason[] = ['sold', 'restock', 'booked', 'shipped', 'unbooked', 'damaged', 'returned'];

/** One Seller item: stock actions, details, history with Undo, move to another box, photos. */
export function ItemPage({ id }: { id: string }) {
  const { db, workspace, t, toast } = useApp();
  const [item, setItem] = useState<Item | null | undefined>(undefined);
  const [history, setHistory] = useState<Movement[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [qty, setQty] = useState('1');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [target, setTarget] = useState('');
  const [undo, setUndo] = useUndo();
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    setLoadedAt(Date.now());
    const it = await db.getItem(id);
    setItem(it && !it.deletedAt ? it : null);
    if (!it) return;
    setHistory(await db.itemHistory(id));
    setBoxes((await db.listBoxes(it.workspaceId)).filter((b) => b.id !== it.locationId));
    setDraft({
      name: it.name, altName: it.altName ?? '', price: fromMinor(it.salePriceMinor), low: it.lowStockLevel == null ? '' : String(it.lowStockLevel),
      weight: it.weightMg == null ? '' : String(it.weightMg / 1000), purity: it.purity ?? '', making: fromMinor(it.makingChargeMinor), notes: it.notes ?? '',
    });
  }, [db, id]);
  useEffect(() => { void load(); }, [load]);

  if (item === undefined) return null;
  if (item === null || item.workspaceId !== workspace?.id) return <Page title={t('label.notMine')} back={() => navigate('/')}><p className="py-6">{t('label.notMine')}</p></Page>;

  const n = toInt(qty);
  const qtyOk = n != null && !Number.isNaN(n) && n > 0;
  const act = async (reason: StockReason) => {
    if (!qtyOk) return;
    const m = await changeStock(db, t, toast, item.id, reason, n!);
    if (m) setUndo({ id: m.id, label: `${t(`stock.action.${reason}` as Key)} ${n}` });
    await load();
  };
  const save = async () => {
    const weight = draft.weight?.trim() ? Math.round(Number(asciiDigits(draft.weight)) * 1000) : null;
    try {
      await db.updateItem(item.id, {
        name: draft.name, altName: draft.altName, notes: draft.notes,
        salePriceMinor: toMinor(draft.price ?? ''), lowStockLevel: toInt(draft.low ?? ''),
        ...(workspace.jewelleryFields ? { weightMg: weight, purity: draft.purity, makingChargeMinor: toMinor(draft.making ?? '') } : {}),
      });
      toast(t('box.saved'));
      await load();
    } catch (e) {
      toast(t('error.generic', { msg: (e as Error).message }));
    }
  };
  const move = async () => {
    if (!qtyOk || !target) return;
    try {
      await db.moveStock(item.id, target, n!);
      toast(t('stock.moved', { n: n!, box: boxes.find((b) => b.id === target)?.number ?? '' }));
      await load();
    } catch (e) {
      if (e instanceof WorkerError && e.name === 'NotEnoughStockError') toast(t('stock.notEnough', { n: item.onHand - item.reserved }));
      else throw e;
    }
  };
  const doUndo = async (mid: string) => {
    try { await db.undoStock(mid); toast(t('stock.undone')); } catch (e) { toast(t('error.generic', { msg: (e as Error).message })); }
    setUndo(null);
    await load();
  };
  const canUndo = (m: Movement) => !m.undone && m.reason !== 'undo' && m.reason !== 'moved_in' && m.reason !== 'moved_out'
    && Date.parse(m.happenedAt) > loadedAt - 24 * 3600 * 1000;
  const field = (k: string, label: Key, opts: { numeric?: boolean } = {}) => (
    <Field label={t(label)}>
      <input className={inputClass} inputMode={opts.numeric ? 'decimal' : undefined} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
    </Field>
  );

  return (
    <Page title={item.name} back={() => navigate(`/box/${item.locationId}`)}>
      <p className="text-lg" data-testid="item-stock">
        {t('stock.inStock', { n: item.onHand - item.reserved })}{item.reserved > 0 ? ` · ${t('stock.booked', { n: item.reserved })}` : ''}
      </p>

      <section className="mt-4">
        <Field label={t('stock.qty')}>
          <input className={inputClass} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {ACTIONS.map((a) => (
            <Button key={a} variant={a === 'sold' || a === 'restock' ? 'primary' : 'secondary'} disabled={!qtyOk} onClick={() => void act(a)}>
              {t(`stock.action.${a}` as Key)}
            </Button>
          ))}
        </div>
      </section>

      {boxes.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">{t('stock.move')}</h2>
          <div className="flex gap-2">
            <select className={inputClass} aria-label={t('stock.moveTo')} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t('stock.moveTo')}</option>
              {boxes.map((b) => <option key={b.id} value={b.id}>{t('box.title', { n: b.number })}{b.name ? ` · ${b.name}` : ''}</option>)}
            </select>
            <Button disabled={!target || !qtyOk} onClick={() => void move()}>{t('stock.move')}</Button>
          </div>
        </section>
      )}

      <PhotoStrip workspaceId={item.workspaceId} parent={{ itemId: item.id }} />

      <section className="mt-6">
        <h2 className="text-lg font-semibold">{t('item.details')}</h2>
        {field('name', 'box.name')}
        {field('altName', 'item.altName')}
        {field('price', workspace.currency === 'BDT' ? 'item.price' : 'item.priceAud', { numeric: true })}
        {field('low', 'item.lowLevel', { numeric: true })}
        {workspace.jewelleryFields && <>
          {field('weight', 'item.weight', { numeric: true })}
          {field('purity', 'item.purity')}
          {field('making', 'item.making', { numeric: true })}
        </>}
        {field('notes', 'box.notes')}
        <Button className="w-full" onClick={() => void save()}>{t('box.save')}</Button>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">{t('stock.history')}</h2>
        <ul className="divide-y" aria-label="history">
          {history.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2 text-sm">
              <span className={m.undone ? 'text-slate-400 line-through' : ''}>
                {t(`stock.reason.${m.reason}` as Key)} {m.onHandDelta !== 0 ? (m.onHandDelta > 0 ? `+${m.onHandDelta}` : m.onHandDelta) : `(${m.reservedDelta > 0 ? '+' : ''}${m.reservedDelta})`}
                <span className="text-slate-500"> · {new Date(m.happenedAt).toLocaleString()}</span>
              </span>
              {canUndo(m) && <Button variant="ghost" className="min-h-10 px-2" onClick={() => void doUndo(m.id)}>{t('stock.undo')}</Button>}
            </li>
          ))}
        </ul>
      </section>

      <Button variant="danger" className="mt-8 w-full" onClick={async () => { await db.deleteItem(item.id); navigate(`/box/${item.locationId}`, true); }}>{t('item.delete')}</Button>
      <UndoBar undo={undo} onUndo={(mid) => void doUndo(mid)} />
    </Page>
  );
}

/** S-21: everything at or below its warning level. */
export function LowStockPage() {
  const { db, workspace, t } = useApp();
  const [rows, setRows] = useState<LowStockRow[] | null>(null);
  useEffect(() => { void db.lowStock(workspace!.id).then(setRows); }, [db, workspace]);
  return (
    <Page title={t('stock.lowTitle')} back={() => navigate('/')}>
      {rows?.length === 0 && <p className="py-10 text-center text-slate-500">{t('stock.lowNone')}</p>}
      <ul className="divide-y" aria-label="low stock">
        {rows?.map((r) => (
          <li key={r.itemId}>
            <button type="button" className="flex w-full justify-between py-3 text-left" onClick={() => navigate(`/item/${r.itemId}`)}>
              <span>{r.name}</span>
              <span className="text-slate-600">{t('stock.inStock', { n: r.available })} · {t('box.title', { n: r.boxNumber })}</span>
            </button>
          </li>
        ))}
      </ul>
    </Page>
  );
}
