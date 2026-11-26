// Booked tab (Seller mode, ADR-023): every item with stock booked for a customer, and the orders.
import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Group, Icon, Page, Row } from '../ui';
import type { Box, Item } from '../../core/repo';

export function BookedPage() {
  const { db, workspace, t } = useApp();
  const wsId = workspace!.id;
  const [rows, setRows] = useState<{ item: Item; box: Box }[] | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const boxes = await db.listBoxes(wsId);
      const all = await Promise.all(boxes.map(async (box) => (await db.listItems(box.id)).filter((i) => i.reserved > 0).map((item) => ({ item, box }))));
      if (live) setRows(all.flat());
    })();
    return () => { live = false; };
  }, [db, wsId]);
  return (
    <Page title={t('booked.title')}>
      <Group>
        <Row title={t('ord.title')} lead={<Icon as={ClipboardList} className="text-text-2" />} onClick={() => navigate('/orders')} />
      </Group>
      {rows?.length === 0 && <p className="px-4 py-10 text-center text-body text-text-2">{t('booked.empty')}</p>}
      {rows && rows.length > 0 && (
        <Group label={t('booked.title')}>
          {rows.map(({ item, box }) => (
            <Row key={item.id} title={item.variantLabel ? `${item.name} · ${item.variantLabel}` : item.name}
              detail={t('box.title', { n: box.number })} trailing={t('stock.booked', { n: item.reserved })}
              onClick={() => navigate(`/item/${item.id}`)} />
          ))}
        </Group>
      )}
    </Page>
  );
}
