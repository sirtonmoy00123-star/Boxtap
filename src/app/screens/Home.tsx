import { useCallback, useEffect, useState } from 'react';
import { ChartColumn, ClipboardList, Image, Plus, Search, TriangleAlert, X } from 'lucide-react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Badge, Banner, BannerAction, Button, Group, Icon, IconButton, LabelTag, Page, Row } from '../ui';
import { WorkerError } from '../../core/db/client';
import type { Box, MoveSummary, Room, SearchHit } from '../../core/repo';
import { shouldOfferInstall } from '../../core/pwa/install';
import { InstallGuide } from './Install';

const WEEK = 7 * 24 * 3600 * 1000;

/** Box card (DESIGN_SYSTEM §5): label tag, name, room · where, item count, badges. */
export function BoxRow({ box, room, items }: { box: Box; room?: string | null; items: number }) {
  const { t, num } = useApp();
  const where = [room, box.spot].filter(Boolean).join(' · ');
  return (
    <li>
      <button type="button" className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2" onClick={() => navigate(`/box/${box.id}`)}>
        <LabelTag n={num(box.number)} />
        <span className="min-w-0 flex-1">
          <span className="block text-headline">{box.name || t('box.title', { n: box.number })}</span>
          {where && <span className="block text-subhead text-text-2">{where}</span>}
          <span className="block text-subhead text-text-2">{t('home.items', { n: items })}</span>
          {(box.isFragile || box.openFirst) && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {box.isFragile && <Badge kind="fragile">{t('box.fragile')}</Badge>}
              {box.openFirst && <Badge kind="openFirst">{t('box.openFirst')}</Badge>}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

export function Home() {
  const { db, workspace, t, date, showUpgrade } = useApp();
  const ws = workspace!;
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [guide, setGuide] = useState(false);
  const [move, setMove] = useState<MoveSummary | null>(null);
  const [low, setLow] = useState(0);
  const [persisted, setPersisted] = useState(true);
  const [backup, setBackup] = useState<{ last: string | null; drive: boolean; overAWeek: boolean } | null>(null);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
    void (async () => {
      const file = (await db.backupState())?.last_backup_at;
      const link = await db.getDriveLink();
      const times = [file ? String(file) : null, link?.lastSnapshotAt ?? null].filter((x): x is string => !!x).sort();
      const last = times.at(-1) ?? null;
      const since = Date.parse(last ?? ws.createdAt);
      setBackup({ last, drive: !!link, overAWeek: Date.now() - since > WEEK });
    })();
  }, [db, ws.createdAt]);

  const load = useCallback(async () => {
    const list = await db.listBoxes(ws.id);
    setBoxes(list);
    setRooms(await db.listRooms(ws.id));
    setMove(ws.type === 'home' ? await db.moveSummary(ws.id) : null);
    setLow(ws.type === 'seller' ? (await db.lowStock(ws.id)).length : 0);
    const entries = await Promise.all(list.map(async (b) => [b.id, (await db.listItems(b.id)).length] as const));
    setItemCounts(Object.fromEntries(entries));
  }, [db, ws.id, ws.type]);

  useEffect(() => { void load(); }, [load]);
  // A box brought back with Undo from the toast shows up again without leaving the screen.
  useEffect(() => {
    const on = () => void load();
    window.addEventListener('boxtap:boxes-changed', on);
    return () => window.removeEventListener('boxtap:boxes-changed', on);
  }, [load]);

  useEffect(() => {
    if (!q.trim()) return;
    let live = true;
    const id = setTimeout(() => { void db.search(ws.id, q).then((h) => { if (live) setHits(h); }); }, 120);
    return () => { live = false; clearTimeout(id); };
  }, [db, ws.id, q]);

  const createBox = async () => {
    try {
      const b = await db.createBox(ws.id, {});
      navigate(`/box/${b.id}`);
    } catch (e) {
      if (e instanceof WorkerError && e.reason) showUpgrade(e.reason);
      else throw e;
    }
  };
  // Ask to install before the 5th box (iPhone always; Android/desktop while storage isn't protected; B14).
  const addBox = () => {
    if (boxes && shouldOfferInstall(boxes.length, persisted)) setGuide(true);
    else void createBox();
  };
  // ADR-016: without Drive, nudge a file backup after 7 days.
  const backupDue = backup && !backup.drive && (boxes?.length ?? 0) > 0 && backup.overAWeek;
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));

  return (
    <Page title={ws.name} actions={<IconButton icon={Plus} label={t('home.addBox')} onClick={addBox} />}>
      {backupDue && (
        <div className="-mx-4 mb-3 min-[430px]:-mx-5">
          <Banner action={<BannerAction onClick={() => navigate('/settings')}>{t('home.backupAction')}</BannerAction>}>{t('home.backupDue')}</Banner>
        </div>
      )}
      <div className="relative">
        <Icon as={Search} size={18} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
        <input type="search" className="min-h-11 w-full rounded-md bg-surface-2 pl-9 pr-10 text-body text-text placeholder:text-text-2 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          placeholder={t('home.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('home.search')} />
        {q && <IconButton icon={X} label={t('home.searchClear')} className="absolute right-0 top-0 text-text-2" onClick={() => setQ('')} />}
      </div>
      {move && move.total > move.none && (
        <p className="mt-3 px-4 text-subhead text-text-2" data-testid="move-summary">{t('move.summary', { moved: move.moved + move.unpacked, total: move.total, unpacked: move.unpacked })}</p>
      )}
      {ws.type === 'seller' && !q.trim() && (
        <Group>
          <Row title={t('stock.low', { n: low })} onClick={() => navigate('/low')}
            lead={<Icon as={TriangleAlert} className={low > 0 ? 'text-warning' : 'text-text-2'} />} />
          <Row title={t('cat.share')} onClick={() => navigate('/catalogue')} lead={<Icon as={Image} className="text-text-2" />} />
          <Row title={<>{t('ord.title')} <ProBadge /></>} onClick={() => navigate('/orders')} lead={<Icon as={ClipboardList} className="text-text-2" />} />
          <Row title={<>{t('rep.title')} <ProBadge /></>} onClick={() => navigate('/reports')} lead={<Icon as={ChartColumn} className="text-text-2" />} />
        </Group>
      )}
      {q.trim() && hits ? (
        <ul className="group-list mt-4 overflow-hidden rounded-md bg-surface" aria-label="results">
          {hits.length === 0 && <li className="px-4 py-6 text-center text-text-2">{t('home.noResults')}</li>}
          {hits.map((h) => (
            <li key={h.itemId}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left active:bg-surface-2" onClick={() => navigate(ws.type === 'seller' ? `/item/${h.itemId}` : `/box/${h.boxId}`)}>
                <span className="text-body">{h.itemName}</span>
                <span className="text-subhead text-text-2">{t('box.title', { n: h.boxNumber })}{h.boxName ? ` · ${h.boxName}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : boxes?.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-body text-text-2">{t('home.empty')}</p>
          <Button className="mt-4 w-full" onClick={addBox}>{t('home.addFirst')}</Button>
        </div>
      ) : (
        <ul className="group-list mt-4 overflow-hidden rounded-md bg-surface" aria-label="boxes">
          {boxes?.map((b) => <BoxRow key={b.id} box={b} room={b.roomId ? roomName.get(b.roomId) : null} items={itemCounts[b.id] ?? 0} />)}
        </ul>
      )}
      {backup && (boxes?.length ?? 0) > 0 && (
        <p className="mt-4 text-center text-footnote text-text-2" data-testid="home-last-backup">
          {backup.last ? t('home.lastBackup', { when: date(backup.last) }) : t('home.neverBackedUp')}
        </p>
      )}
      {guide && <InstallGuide onClose={() => { setGuide(false); void createBox(); }} />}
    </Page>
  );
}

function ProBadge() {
  const { t } = useApp();
  return <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 align-middle text-caption text-text">{t('pro.badge')}</span>;
}
