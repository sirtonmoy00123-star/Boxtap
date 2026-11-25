import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Field, Page, inputClass } from '../ui';
import { WorkerError } from '../../core/db/client';
import type { Box, Item, Room } from '../../core/repo';

export function BoxPage({ id }: { id: string }) {
  const { db, workspace, t, showUpgrade, toast } = useApp();
  const [box, setBox] = useState<Box | null | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [draft, setDraft] = useState({ name: '', spot: '', notes: '' });
  const [newItem, setNewItem] = useState('');

  const load = useCallback(async () => {
    const b = await db.getBox(id);
    setBox(b && !b.deletedAt ? b : null);
    if (b) {
      setDraft({ name: b.name ?? '', spot: b.spot ?? '', notes: b.notes ?? '' });
      setItems(await db.listItems(id));
      setRooms(await db.listRooms(b.workspaceId));
    }
  }, [db, id]);
  useEffect(() => { void load(); }, [load]);

  if (box === undefined) return null;
  if (box === null || box.workspaceId !== workspace?.id) {
    return <Page title={t('label.notMine')} back={() => navigate('/')}><p className="py-6">{t('label.notMine')}</p></Page>;
  }

  const save = async () => {
    await db.updateBox(id, { name: draft.name, spot: draft.spot, notes: draft.notes });
    toast(t('box.saved'));
    await load();
  };
  const toggle = async (field: 'isFragile' | 'openFirst') => {
    await db.updateBox(id, { [field]: !box[field] });
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
      setItems(await db.listItems(id));
    } catch (e) {
      if (e instanceof WorkerError && e.reason) showUpgrade(e.reason);
      else throw e;
    }
  };
  const removeItem = async (itemId: string) => {
    await db.deleteItem(itemId);
    setItems(await db.listItems(id));
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
        <ul className="divide-y" aria-label="items">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between py-2">
              <span>{it.name}</span>
              <Button variant="ghost" onClick={() => removeItem(it.id)} aria-label={`${t('box.removeItem')} ${it.name}`}>×</Button>
            </li>
          ))}
        </ul>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void addItem(); }}>
          <input className={inputClass} value={newItem} maxLength={120} onChange={(e) => setNewItem(e.target.value)}
            placeholder={t('box.itemPlaceholder')} aria-label={t('box.addItem')} />
          <Button type="submit">{t('box.addItem')}</Button>
        </form>
      </section>

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
        <Button onClick={save} className="w-full">{t('box.save')}</Button>
      </section>

      <Button variant="danger" onClick={remove} className="mt-8 w-full">{t('box.delete')}</Button>
    </Page>
  );
}
