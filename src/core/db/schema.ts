// BoxTap on-device schema. Source of truth: boxtap-architecture/DATABASE_SCHEMA.md §3.
// No released schema exists yet, so every v2.1 column is in migration 1 (not a later migration).

export const PRAGMAS = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = DELETE;
PRAGMA trusted_schema = OFF;
`;

const V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE workspaces (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('home','seller')),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  country     TEXT NOT NULL CHECK (country IN ('AU','BD')),
  currency    TEXT NOT NULL CHECK (currency IN ('AUD','BDT')),
  language    TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','bn')),
  jewellery_fields INTEGER NOT NULL DEFAULT 0,
  next_box_number INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  colour TEXT NOT NULL DEFAULT 'blue',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  name TEXT CHECK (length(name) <= 80),
  kind TEXT NOT NULL DEFAULT 'box' CHECK (kind IN ('box','tub','drawer','shelf','bag','other')),
  room_id TEXT REFERENCES rooms(id),
  spot TEXT CHECK (length(spot) <= 80),
  colour TEXT,
  is_fragile INTEGER NOT NULL DEFAULT 0,
  open_first INTEGER NOT NULL DEFAULT 0,
  move_status TEXT CHECK (move_status IN ('packed','moved','unpacked')),
  notes TEXT CHECK (length(notes) <= 2000),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE (workspace_id, number)
);

CREATE TABLE labels (
  code TEXT PRIMARY KEY CHECK (length(code) = 10),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  location_id TEXT REFERENCES locations(id),
  created_at TEXT NOT NULL, retired_at TEXT
);
CREATE INDEX labels_location ON labels(location_id);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id),
  product_id TEXT, variant_id TEXT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  alt_name TEXT CHECK (length(alt_name) <= 120),
  notes TEXT CHECK (length(notes) <= 2000),
  value_estimate_minor INTEGER CHECK (value_estimate_minor >= 0),
  on_hand INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  low_stock_level INTEGER CHECK (low_stock_level >= 0),
  sale_price_minor INTEGER CHECK (sale_price_minor >= 0),
  cost_price_minor INTEGER CHECK (cost_price_minor >= 0),
  pricing_mode TEXT NOT NULL DEFAULT 'per_piece' CHECK (pricing_mode IN ('per_piece','by_weight')),
  weight_mg INTEGER CHECK (weight_mg > 0),
  purity TEXT CHECK (length(purity) <= 20),
  making_charge_minor INTEGER CHECK (making_charge_minor >= 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX items_location ON items(location_id) WHERE deleted_at IS NULL;

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  location_id TEXT REFERENCES locations(id),
  item_id TEXT REFERENCES items(id),
  file_name TEXT NOT NULL,
  thumb_name TEXT NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/webp','image/jpeg')),
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 600000),
  drive_ref TEXT, sha256 TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  CHECK ((location_id IS NULL) <> (item_id IS NULL))
);
CREATE INDEX photos_location ON photos(location_id) WHERE deleted_at IS NULL;
CREATE INDEX photos_item ON photos(item_id) WHERE deleted_at IS NULL;

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  on_hand_delta INTEGER NOT NULL,
  reserved_delta INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL CHECK (reason IN ('sold','restock','count','damaged','returned','moved_in','moved_out',
                                         'booked','unbooked','shipped','undo','opening')),
  reverses_id TEXT UNIQUE REFERENCES stock_movements(id),
  happened_at TEXT NOT NULL,
  note TEXT CHECK (length(note) <= 200),
  CHECK (on_hand_delta <> 0 OR reserved_delta <> 0),
  CHECK ((reason = 'undo') = (reverses_id IS NOT NULL)),
  CHECK (CASE reason
    WHEN 'sold' THEN on_hand_delta < 0 AND reserved_delta = 0
    WHEN 'damaged' THEN on_hand_delta < 0 AND reserved_delta = 0
    WHEN 'moved_out' THEN on_hand_delta < 0 AND reserved_delta = 0
    WHEN 'restock' THEN on_hand_delta > 0 AND reserved_delta = 0
    WHEN 'returned' THEN on_hand_delta > 0 AND reserved_delta = 0
    WHEN 'moved_in' THEN on_hand_delta > 0 AND reserved_delta = 0
    WHEN 'opening' THEN on_hand_delta > 0 AND reserved_delta = 0
    WHEN 'booked' THEN on_hand_delta = 0 AND reserved_delta > 0
    WHEN 'unbooked' THEN on_hand_delta = 0 AND reserved_delta < 0
    WHEN 'shipped' THEN on_hand_delta < 0 AND reserved_delta = on_hand_delta
    ELSE 1 END)
);
CREATE INDEX sm_item_time ON stock_movements(item_id, happened_at DESC);

CREATE TRIGGER sm_apply AFTER INSERT ON stock_movements BEGIN
  UPDATE items SET on_hand = on_hand + NEW.on_hand_delta,
                   reserved = reserved + NEW.reserved_delta,
                   updated_at = max(updated_at, NEW.happened_at)
   WHERE id = NEW.item_id;
END;
CREATE TRIGGER sm_no_update BEFORE UPDATE ON stock_movements BEGIN
  SELECT RAISE(ABORT, 'ledger_is_append_only');
END;
CREATE TRIGGER sm_no_delete BEFORE DELETE ON stock_movements
  WHEN EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id AND deleted_at IS NULL) BEGIN
  SELECT RAISE(ABORT, 'ledger_is_append_only');
END;

-- Ruling (build): SQLite removes the parent row before cascading, so sm_no_delete cannot see a live
-- workspace during a cascade. This guard enforces "set deleted_at first, then delete" (DATABASE_SCHEMA §3 note).
CREATE TRIGGER ws_no_live_delete BEFORE DELETE ON workspaces WHEN OLD.deleted_at IS NULL BEGIN
  SELECT RAISE(ABORT, 'workspace_must_be_soft_deleted_first');
END;

-- Search (ADR-011). One row per live item; location_label = "Box 12 Kitchen spot".
CREATE VIRTUAL TABLE item_search USING fts5(name, alt_name, notes, location_label,
  item_id UNINDEXED, workspace_id UNINDEXED, tokenize = 'trigram');

CREATE TRIGGER items_search_ai AFTER INSERT ON items WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO item_search (name, alt_name, notes, location_label, item_id, workspace_id)
  SELECT NEW.name, NEW.alt_name, NEW.notes,
         'Box ' || l.number || coalesce(' ' || l.name, '') || coalesce(' ' || l.spot, ''),
         NEW.id, NEW.workspace_id
    FROM locations l WHERE l.id = NEW.location_id;
END;
CREATE TRIGGER items_search_au AFTER UPDATE ON items BEGIN
  DELETE FROM item_search WHERE item_id = OLD.id;
  INSERT INTO item_search (name, alt_name, notes, location_label, item_id, workspace_id)
  SELECT NEW.name, NEW.alt_name, NEW.notes,
         'Box ' || l.number || coalesce(' ' || l.name, '') || coalesce(' ' || l.spot, ''),
         NEW.id, NEW.workspace_id
    FROM locations l WHERE l.id = NEW.location_id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER items_search_ad AFTER DELETE ON items BEGIN
  DELETE FROM item_search WHERE item_id = OLD.id;
END;
CREATE TRIGGER locations_search_au AFTER UPDATE OF number, name, spot ON locations BEGIN
  UPDATE item_search
     SET location_label = 'Box ' || NEW.number || coalesce(' ' || NEW.name, '') || coalesce(' ' || NEW.spot, '')
   WHERE item_id IN (SELECT id FROM items WHERE location_id = NEW.id);
END;

-- App-level tables (API_CONTRACTS §2-4)
CREATE TABLE entitlements (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('licence_key')),
  plan TEXT NOT NULL CHECK (plan IN ('move_pass','seller_pro')),
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  raw_signed TEXT NOT NULL
);
CREATE TABLE app_config (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL,
  issued_at TEXT NOT NULL, body TEXT NOT NULL, signature TEXT NOT NULL);
CREATE TABLE time_guard (id INTEGER PRIMARY KEY CHECK (id = 1), max_seen_at TEXT NOT NULL,
  trusted_at TEXT, trusted_source TEXT);
CREATE TABLE backup_state (id INTEGER PRIMARY KEY CHECK (id = 1), last_backup_at TEXT,
  has_folder INTEGER NOT NULL DEFAULT 0,
  recovery_confirmed INTEGER NOT NULL DEFAULT 0);

-- (v2.1) Google Drive sync, ADR-020 + audit B5. Never stores the access token.
CREATE TABLE drive_link (id INTEGER PRIMARY KEY CHECK (id = 1),
  google_email TEXT NOT NULL, folder_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  last_snapshot_at TEXT, last_snapshot_file_id TEXT,
  photos_wifi_only INTEGER NOT NULL DEFAULT 1, paused INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','needs_signin','quota_full','lock_lost','disconnected','folder_trashed','folder_missing')),
  generation INTEGER NOT NULL DEFAULT 0,
  last_snapshot_seq INTEGER NOT NULL DEFAULT 0,
  key_id TEXT NOT NULL,
  -- Ruling (build): v1 is unreleased, so the engine's bookkeeping columns live here, not in a migration.
  snapshots_folder_id TEXT NOT NULL, photos_folder_id TEXT NOT NULL, lock_file_id TEXT NOT NULL,
  uploaded_change_seq INTEGER NOT NULL DEFAULT 0,
  connected_at TEXT NOT NULL);
CREATE TABLE drive_outbox (
  photo_id TEXT PRIMARY KEY,
  op TEXT NOT NULL CHECK (op IN ('upload','delete','download')),
  drive_file_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, next_try_at TEXT NOT NULL, last_error TEXT);

INSERT INTO meta (key, value) VALUES ('change_seq', '0');
`;

// v1 was released on 2026-11-25 (first live test site). From here on, change the schema only by adding a migration.
interface MigrationDb { exec(sql: string): unknown; selectValues(sql: string): unknown[] }
export type Migration = string | ((db: MigrationDb) => void);

const hasColumn = (db: MigrationDb, table: string, col: string) =>
  db.selectValues(`SELECT name FROM pragma_table_info('${table}')`).map(String).includes(col);

/** v2: photos.drive_file_id (missing on phones set up with the first live build) + sale price and cost on each movement. */
const V2: Migration = (db) => {
  if (!hasColumn(db, 'photos', 'drive_file_id')) db.exec('ALTER TABLE photos ADD COLUMN drive_file_id TEXT');
  db.exec('ALTER TABLE stock_movements ADD COLUMN unit_price_minor INTEGER CHECK (unit_price_minor >= 0)');
  db.exec('ALTER TABLE stock_movements ADD COLUMN unit_cost_minor INTEGER CHECK (unit_cost_minor >= 0)');
};

/** v3 (Pro): customer orders. Each line books stock through the ledger; packing ships it. */
const V3 = `
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  customer TEXT NOT NULL CHECK (length(customer) BETWEEN 1 AND 80),
  phone TEXT CHECK (length(phone) <= 30),
  note TEXT CHECK (length(note) <= 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','packed','delivered','cancelled')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, number)
);
CREATE TABLE order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_minor INTEGER CHECK (unit_price_minor >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX order_lines_order ON order_lines(order_id);
`;

/** v4 (Pro): product variants. Each variant stays its own stock item (ADR-006), grouped by items.product_id. */
const V4 = `
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE items ADD COLUMN variant_label TEXT CHECK (length(variant_label) BETWEEN 1 AND 40);
CREATE INDEX items_product ON items(product_id) WHERE product_id IS NOT NULL;
DROP TRIGGER items_search_ai;
DROP TRIGGER items_search_au;
CREATE TRIGGER items_search_ai AFTER INSERT ON items WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO item_search (name, alt_name, notes, location_label, item_id, workspace_id)
  SELECT NEW.name || coalesce(' ' || NEW.variant_label, ''), NEW.alt_name, NEW.notes,
         'Box ' || l.number || coalesce(' ' || l.name, '') || coalesce(' ' || l.spot, ''),
         NEW.id, NEW.workspace_id
    FROM locations l WHERE l.id = NEW.location_id;
END;
CREATE TRIGGER items_search_au AFTER UPDATE ON items BEGIN
  DELETE FROM item_search WHERE item_id = OLD.id;
  INSERT INTO item_search (name, alt_name, notes, location_label, item_id, workspace_id)
  SELECT NEW.name || coalesce(' ' || NEW.variant_label, ''), NEW.alt_name, NEW.notes,
         'Box ' || l.number || coalesce(' ' || l.name, '') || coalesce(' ' || l.spot, ''),
         NEW.id, NEW.workspace_id
    FROM locations l WHERE l.id = NEW.location_id AND NEW.deleted_at IS NULL;
END;
`;

/** v5: movements made by an order carry its line, so they can't be undone or changed from the item page. */
const V5 = `ALTER TABLE stock_movements ADD COLUMN order_line_id TEXT;`;

/** Ordered migrations. Index i migrates user_version i -> i+1. Never edit a released entry. */
export const MIGRATIONS: readonly Migration[] = [V1, V2, V3, V4, V5];

export function applyMigration(db: MigrationDb, index: number): void {
  const m = MIGRATIONS[index]!;
  if (typeof m === 'string') db.exec(m);
  else m(db);
}
export const SCHEMA_VERSION = MIGRATIONS.length;
