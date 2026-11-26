// Rooms tab (Home mode, ADR-023): every room with its box count; a room opens the boxes in it.
import { useEffect, useState } from 'react';
import { DoorOpen } from 'lucide-react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Group, Icon, Page, Row } from '../ui';
import type { Box, Room } from '../../core/repo';
import { BoxRow } from './Home';

function useRoomsAndBoxes() {
  const { db, workspace } = useApp();
  const wsId = workspace!.id;
  const [data, setData] = useState<{ rooms: Room[]; boxes: Box[]; items: Record<string, number> } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [rooms, boxes] = await Promise.all([db.listRooms(wsId), db.listBoxes(wsId)]);
      const items = Object.fromEntries(await Promise.all(boxes.map(async (b) => [b.id, (await db.listItems(b.id)).length] as const)));
      if (live) setData({ rooms, boxes, items });
    })();
    return () => { live = false; };
  }, [db, wsId, version]);
  return [data, () => setVersion((v) => v + 1)] as const;
}

export function RoomsPage() {
  const { t, num } = useApp();
  const [data] = useRoomsAndBoxes();
  if (!data) return <Page title={t('rooms.title')}>{null}</Page>;
  const count = (roomId: string | null) => data.boxes.filter((b) => b.roomId === roomId).length;
  const noRoom = count(null);
  return (
    <Page title={t('rooms.title')}>
      {data.rooms.length === 0 ? (
        <p className="px-4 py-10 text-center text-body text-text-2">{t('rooms.empty')}</p>
      ) : (
        <Group label={t('rooms.title')}>
          {data.rooms.map((r) => (
            <Row key={r.id} title={r.name} lead={<Icon as={DoorOpen} className="text-text-2" />}
              trailing={<span className="num">{num(count(r.id))}</span>} aria-label={`${r.name}, ${t('rooms.boxes', { n: count(r.id) })}`}
              onClick={() => navigate(`/room/${r.id}`)} />
          ))}
        </Group>
      )}
      {noRoom > 0 && data.rooms.length > 0 && (
        <p className="mt-3 px-4 text-footnote text-text-2">{t('box.noRoom')}: {t('rooms.boxes', { n: noRoom })}</p>
      )}
    </Page>
  );
}

export function RoomPage({ id }: { id: string }) {
  const { db, t } = useApp();
  const [data, reload] = useRoomsAndBoxes();
  if (!data) return null;
  const room = data.rooms.find((r) => r.id === id);
  if (!room) return <Page title={t('rooms.title')} back={() => navigate('/rooms')}><p className="py-6">{t('label.notMine')}</p></Page>;
  const boxes = data.boxes.filter((b) => b.roomId === id);
  const rename = async () => {
    const name = prompt(t('room.renamePrompt'), room.name)?.trim();
    if (!name || name === room.name) return;
    await db.renameRoom(id, name);
    reload();
  };
  return (
    <Page title={room.name} back={() => navigate('/rooms')}>
      <p className="px-1 pt-2 text-footnote text-text-2">{t('rooms.boxes', { n: boxes.length })}</p>
      {boxes.length === 0
        ? <p className="px-4 py-10 text-center text-body text-text-2">{t('rooms.noBoxes')}</p>
        : <ul className="group-list mt-4 overflow-hidden rounded-md bg-surface" aria-label="boxes">
            {boxes.map((b) => <BoxRow key={b.id} box={b} room={null} items={data.items[b.id] ?? 0} />)}
          </ul>}
      <div className="mt-6 text-center"><Button variant="ghost" onClick={() => void rename()}>{t('room.rename')}</Button></div>
    </Page>
  );
}
