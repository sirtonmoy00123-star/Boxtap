import { useCallback, useEffect, useRef, useState } from 'react';
import { PackageOpen, TriangleAlert, X } from 'lucide-react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Field, Icon, IconButton, LabelTag, Page, inputClass } from '../ui';
import { WorkerError } from '../../core/db/client';
import type { Box, Item, ItemThumb, Room } from '../../core/repo';
import { ItemThumbButton, PhotoStrip } from './Photos';
import { SellerItems } from './Seller';

type Draft = { name: string; spot: string; notes: string };

/**
 * Box screen. Name, where and notes save themselves 500 ms after typing stops (ADR-023: no Save button), and
 * right away when leaving the screen or the app, so nothing typed is lost.
 */
export function BoxPage({ id }: { id: string }) {
  const { db, workspace, t, num, showUpgrade, toast } = useApp();
  const [box, setBox] = useState<Box | null | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [draft, setDraft] = useState<Draft>({ name: '', spot: '', notes: '' });
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [newItem, setNewItem] = useState('');
  const [thumbs, setThumbs] = useState<Record<string, ItemThumb>>({});
  const pending = useRef<Draft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef(true);

  const reloadItems = useCallback(async () => {
    setItems(await db.listItems(id));
    setThumbs(await db.itemThumbs(id));
  }, [db, id]);

  // resetDraft only on first load, so tapping Fragile etc. never wipes typing (review finding 8).
  const load = useCallback(async (resetDraft = false) => {
    const b = await db.getBox(id);
    setBox(b && !b.deletedAt ? b : null);
    if (b) {
      if (resetDraft) setDraft({ name: b.name ?? '', spot: b.spot ?? '', notes: b.notes ?? '' });
      await reloadItems();
      setRooms(await db.listRooms(b.workspaceId));
    }
  }, [db, id, reloadItems]);
  useEffect(() => { void load(true); }, [load]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const d = pending.current;
    if (!d) return;
    pending.current = null;
    try {
      await db.updateBox(id, { name: d.name, spot: d.spot, notes: d.notes });
      if (live.current && !pending.current) setSaveState('saved');
    } catch (e) {
      toast(t('error.generic', { msg: (e as Error).message }));
    }
  }, [db, id, toast, t]);
  // Leaving the screen, hiding the app or closing the tab saves at once.
  useEffect(() => {
    live.current = true;
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    const onVis = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      live.current = false;
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
      void flush();
    };
  }, [flush]);

  if (box === undefined) return null;
  if (box === null || box.workspaceId !== workspace?.id) {
    return <Page title={t('label.notMine')} back={() => navigate('/')}><p className="py-6">{t('label.notMine')}</p></Page>;
  }

  const edit = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    pending.current = next;
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  };
  const toggle = async (field: 'isFragile' | 'openFirst') => {
    await db.updateBox(id, { [field]: !box[field] });
    await load();
  };
  const renameRoom = async (roomId: string) => {
    const current = rooms.find((r) => r.id === roomId)?.name ?? '';
    const name = prompt(t('room.renamePrompt'), current)?.trim();
    if (!name || name === current) return;
    await db.renameRoom(roomId, name);
    await load();
  };
  const setRoom = async (value: string) => {
    let roomId: string | null = value || null;
    if (value === '__new') {
      const name = prompt(t('box.newRoomName'))?.trim();
      if (!name) return;
      roomId = (await db.createRoom(box.workspaceId, name)).id;
    }
    await db.updateBox(id, { roomId });
    await load();
  };
  const addItem = async () => {
    if (!newItem.trim()) return;
    try {
      await db.addItem({ workspaceId: box.workspaceId, locationId: id, name: newItem });
      setNewItem('');
      await reloadItems();
    } catch (e) {
      if (e instanceof WorkerError && e.reason) showUpgrade(e.reason);
      else throw e;
    }
  };
  const removeItem = async (itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    if (!confirm(t('confirm.deleteItem', { name: it?.name ?? '' }))) return;
    await db.deleteItem(itemId);
    await reloadItems();
  };
  // Destructive action: no confirm dialog; a 5 s Undo toast instead (DESIGN_SYSTEM §5). The bin keeps it 30 days.
  const remove = async () => {
    try {
      await flush();
      await db.deleteBox(id);
      navigate('/', true);
      toast(t('box.binned', { n: box.number }), {
        label: t('stock.undo'),
        run: async () => {
          await db.restoreBox(id);
          window.dispatchEvent(new Event('boxtap:boxes-changed'));
          toast(t('box.restored', { n: box.number }));
        },
      });
    } catch (e) {
      toast(t('error.generic', { msg: (e as Error).message }));
    }
  };

  const toggleClass = (on: boolean) => `inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-subhead ${on ? 'border-accent bg-accent-fill text-on-accent' : 'border-separator bg-surface text-text'}`;

  return (
    <Page title={draft.name || t('box.title', { n: box.number })} lead={<LabelTag n={num(box.number)} />} back={() => navigate('/')}>
      <p className="px-1 pt-2 text-footnote text-text-2">{t('box.title', { n: box.number })} · {t('box.label')} <span className="font-mono" data-testid="label-code">{box.labelCode}</span></p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" aria-pressed={box.isFragile} className={toggleClass(box.isFragile)} onClick={() => void toggle('isFragile')}>
          <Icon as={TriangleAlert} size={18} />{t('box.fragile')}
        </button>
        <button type="button" aria-pressed={box.openFirst} className={toggleClass(box.openFirst)} onClick={() => void toggle('openFirst')}>
          <Icon as={PackageOpen} size={18} />{t('box.openFirst')}
        </button>
      </div>

      <section className="mt-6">
        <h2 className="px-4 pb-1.5 text-footnote text-text-2">{t('box.items')}</h2>
        {workspace?.type === 'seller' ? (
          <>
            <SellerItems box={box} items={items} thumbs={thumbs} reload={reloadItems} />
            <Button variant="secondary" className="mt-2 w-full" onClick={() => navigate(`/catalogue?box=${box.id}`)}>{t('cat.shareBox')}</Button>
          </>
        ) : (
          items.length > 0 && (
            <ul className="group-list overflow-hidden rounded-md bg-surface" aria-label="items">
              {items.map((it) => (
                <li key={it.id} className="flex min-h-11 items-center gap-3 px-4 py-1.5">
                  <ItemThumbButton workspaceId={box.workspaceId} itemId={it.id} itemName={it.name} thumb={thumbs[it.id]} onChanged={() => void reloadItems()} />
                  <button type="button" className="min-h-11 flex-1 text-left text-body" onClick={() => navigate(`/item/${it.id}`)}>{it.name}</button>
                  <IconButton icon={X} label={`${t('box.removeItem')} ${it.name}`} className="text-text-2" onClick={() => void removeItem(it.id)} />
                </li>
              ))}
            </ul>
          )
        )}
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void addItem(); }}>
          <input className={`${inputClass} min-w-0`} value={newItem} maxLength={120} onChange={(e) => setNewItem(e.target.value)}
            placeholder={t('box.itemPlaceholder')} aria-label={t('box.addItem')} />
          <Button type="submit" variant="secondary" className="shrink-0 whitespace-nowrap">{t('box.addItem')}</Button>
        </form>
      </section>

      <PhotoStrip workspaceId={box.workspaceId} parent={{ locationId: box.id }} />

      <section className="mt-6">
        <h2 className="px-4 pb-1.5 text-footnote text-text-2">{t('box.details')}</h2>
        <div className="rounded-md bg-surface px-4 py-1">
          <Field label={t('box.name')}>
            <input className={inputClass} value={draft.name} maxLength={80} onChange={(e) => edit({ name: e.target.value })} />
          </Field>
          <Field label={t('box.room')}>
            <select className={inputClass} value={box.roomId ?? ''} onChange={(e) => void setRoom(e.target.value)}>
              <option value="">{t('box.noRoom')}</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              <option value="__new">{t('box.newRoom')}</option>
            </select>
            {box.roomId && (
              <Button variant="ghost" className="mt-1 px-0" onClick={() => void renameRoom(box.roomId!)}>{t('room.rename')}</Button>
            )}
          </Field>
          <Field label={t('box.spot')}>
            <input className={inputClass} value={draft.spot} maxLength={80} onChange={(e) => edit({ spot: e.target.value })} />
          </Field>
          <Field label={t('box.notes')}>
            <textarea className={`${inputClass} py-2`} rows={3} value={draft.notes} maxLength={2000} onChange={(e) => edit({ notes: e.target.value })} />
          </Field>
        </div>
        <p role="status" aria-live="polite" data-testid="autosave" className="min-h-[1.125rem] px-4 pt-1.5 text-footnote text-text-2">
          {saveState === 'saving' ? t('box.saving') : saveState === 'saved' ? t('box.saved') : ''}
        </p>
      </section>

      {workspace?.type === 'home' && (
        <fieldset className="mt-4">
          <legend className="px-4 pb-1.5 text-footnote text-text-2">{t('move.title')}</legend>
          <div className="flex gap-1 rounded-md bg-surface-2 p-1">
            {(['packed', 'moved', 'unpacked'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={box.moveStatus === s}
                className={`min-h-11 flex-1 rounded-md px-2 text-subhead ${box.moveStatus === s ? 'bg-surface font-semibold text-text shadow-sm' : 'text-text'}`}
                onClick={async () => { await db.updateBox(id, { moveStatus: box.moveStatus === s ? null : s }); await load(); }}>
                {t(`move.${s}`)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="mt-10 text-center">
        <Button variant="danger" onClick={remove}>{t('box.delete')}</Button>
      </div>
    </Page>
  );
}
