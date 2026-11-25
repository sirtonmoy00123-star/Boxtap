import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Field, Page, inputClass } from '../ui';
import { WorkerError } from '../../core/db/client';
import type { Box, Item, ItemThumb, Room } from '../../core/repo';
import { ItemThumbButton, PhotoStrip } from './Photos';
import { SellerItems } from './Seller';

export function BoxPage({ id }: { id: string }) {
  const { db, workspace, t, showUpgrade, toast } = useApp();
  const [box, setBox] = useState<Box | null | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [draft, setDraft] = useState({ name: '', spot: '', notes: '' });
  const [newItem, setNewItem] = useState('');
  const [thumbs, setThumbs] = useState<Record<string, ItemThumb>>({});
  const reloadItems = useCallback(async () => {
    setItems(await db.listItems(id));
    setThumbs(await db.itemThumbs(id));
  }, [db, id]);

  // resetDraft only on first load and after Save, so tapping Fragile etc. never wipes typing (review finding 8).
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

  if (box === undefined) return null;
  if (box === null || box.workspaceId !== workspace?.id) {
    return <Page title={t('label.notMine')} back={() => navigate('/')}><p className="py-6">{t('label.notMine')}</p></Page>;
  }

  const save = async () => {
    await db.updateBox(id, { name: draft.name, spot: draft.spot, notes: draft.notes });
    toast(t('box.saved'));
    await load(true);
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
    await db.deleteItem(itemId);
    await reloadItems();
  };
  const remove = async () => {
    await db.deleteBox(id);
    navigate('/', true);
  };

  return (
    <Page title={box.name || t('box.title', { n: box.number })} back={() => navigate('/')}>
      <p className="text-sm text-slate-500">{t('box.title', { n: box.number })} · {t('box.label')} <span className="font-mono" data-testid="label-code">{box.labelCode}</span></p>

      <section className="mt-4">
        <h2 className="text-lg font-semibold">{t('box.items')}</h2>
        {workspace?.type === 'seller' ? (
          <>
            <SellerItems box={box} items={items} thumbs={thumbs} reload={reloadItems} />
            <Button variant="secondary" className="mt-2 w-full" onClick={() => navigate(`/catalogue?box=${box.id}`)}>{t('cat.shareBox')}</Button>
          </>
        ) : (
          <ul className="divide-y" aria-label="items">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 py-2">
                <ItemThumbButton workspaceId={box.workspaceId} itemId={it.id} itemName={it.name} thumb={thumbs[it.id]} onChanged={() => void reloadItems()} />
                <button type="button" className="flex-1 text-left" onClick={() => navigate(`/item/${it.id}`)}>{it.name}</button>
                <Button variant="ghost" onClick={() => removeItem(it.id)} aria-label={`${t('box.removeItem')} ${it.name}`}>×</Button>
              </li>
            ))}
          </ul>
        )}
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void addItem(); }}>
          <input className={inputClass} value={newItem} maxLength={120} onChange={(e) => setNewItem(e.target.value)}
            placeholder={t('box.itemPlaceholder')} aria-label={t('box.addItem')} />
          <Button type="submit">{t('box.addItem')}</Button>
        </form>
      </section>

      <PhotoStrip workspaceId={box.workspaceId} parent={{ locationId: box.id }} />

      <section className="mt-6">
        <Field label={t('box.name')}>
          <input className={inputClass} value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label={t('box.room')}>
          <select className={inputClass} value={box.roomId ?? ''} onChange={(e) => void setRoom(e.target.value)}>
            <option value="">{t('box.noRoom')}</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            <option value="__new">{t('box.newRoom')}</option>
          </select>
          {box.roomId && (
            <Button variant="ghost" className="mt-1" onClick={() => void renameRoom(box.roomId!)}>{t('room.rename')}</Button>
          )}
        </Field>
        <Field label={t('box.spot')}>
          <input className={inputClass} value={draft.spot} maxLength={80} onChange={(e) => setDraft({ ...draft, spot: e.target.value })} />
        </Field>
        <Field label={t('box.notes')}>
          <textarea className={`${inputClass} py-2`} rows={3} value={draft.notes} maxLength={2000} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </Field>
        <div className="flex gap-2 py-2">
          <Button variant={box.isFragile ? 'primary' : 'secondary'} aria-pressed={box.isFragile} onClick={() => toggle('isFragile')}>{t('box.fragile')}</Button>
          <Button variant={box.openFirst ? 'primary' : 'secondary'} aria-pressed={box.openFirst} onClick={() => toggle('openFirst')}>{t('box.openFirst')}</Button>
        </div>
        {workspace?.type === 'home' && (
          <fieldset className="py-2">
            <legend className="mb-1 text-sm text-slate-600">{t('move.title')}</legend>
            <div className="flex gap-2">
              {(['packed', 'moved', 'unpacked'] as const).map((s) => (
                <Button key={s} variant={box.moveStatus === s ? 'primary' : 'secondary'} aria-pressed={box.moveStatus === s} className="flex-1 px-2"
                  onClick={async () => { await db.updateBox(id, { moveStatus: box.moveStatus === s ? null : s }); await load(); }}>
                  {t(`move.${s}`)}
                </Button>
              ))}
            </div>
          </fieldset>
        )}
        <Button onClick={save} className="w-full">{t('box.save')}</Button>
      </section>

      <Button variant="danger" onClick={remove} className="mt-8 w-full">{t('box.delete')}</Button>
    </Page>
  );
}
