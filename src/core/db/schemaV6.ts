// Schema v6: Removalist mode (docs/removalist-plan.md §4). Released entries in MIGRATIONS must never be edited.
import type { MigrationDb } from './schema';

// "Live" = the workspace has not been soft-deleted. Every protection below only applies while it is live, so
// "Erase all data" (deleted_at first, then DELETE with cascade) keeps working, as for the Seller ledger.
const LIVE_JOB = (job: string) =>
  `EXISTS (SELECT 1 FROM jobs j JOIN workspaces w ON w.id = j.workspace_id WHERE j.id = ${job} AND w.deleted_at IS NULL)`;
const LIVE_WS = (ws: string) => `EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ${ws} AND w.deleted_at IS NULL)`;
const LOCKED = (job: string, stage: string) => `EXISTS (SELECT 1 FROM stage_locks s WHERE s.job_id = ${job} AND s.stage = ${stage})`;
const ANY_LOCK = (job: string) => `EXISTS (SELECT 1 FROM stage_locks s WHERE s.job_id = ${job})`;
/** A photo is lock-protected when it is a condition photo of a signed (locked) stage. Also used by the Bin purge. */
export const LOCKED_PHOTO = (photo: string) => `EXISTS (SELECT 1 FROM condition_photos cp JOIN condition_records r ON r.id = cp.record_id
    JOIN stage_locks s ON s.job_id = r.job_id AND s.stage = r.stage WHERE cp.photo_id = ${photo})`;

const TABLES = `
CREATE TABLE business_profile (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 1 AND 30),
  email TEXT CHECK (length(email) <= 120),
  abn_or_licence TEXT CHECK (length(abn_or_licence) <= 40),
  address TEXT CHECK (length(address) <= 200),
  logo BLOB CHECK (logo IS NULL OR length(logo) <= 200000),
  logo_mime TEXT CHECK (logo_mime IN ('image/png','image/jpeg')),
  volume_unit TEXT NOT NULL DEFAULT 'm3' CHECK (volume_unit IN ('m3','ft3')),
  buffer_pct INTEGER NOT NULL DEFAULT 10 CHECK (buffer_pct BETWEEN 0 AND 100),
  label_sheet TEXT NOT NULL DEFAULT 'L7165' CHECK (length(label_sheet) <= 20),
  default_box_item_id TEXT,
  next_job_number INTEGER NOT NULL DEFAULT 1 CHECK (next_job_number > 0),
  crew_pin_hash TEXT, crew_pin_salt TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE trucks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  capacity_m3 REAL NOT NULL CHECK (capacity_m3 > 0 AND capacity_m3 <= 500),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX trucks_ws ON trucks(workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  customer_name TEXT NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 80),
  customer_label_name TEXT NOT NULL CHECK (length(customer_label_name) BETWEEN 1 AND 40),
  customer_phone TEXT CHECK (length(customer_phone) <= 30),
  customer_email TEXT CHECK (length(customer_email) <= 120),
  pickup_address TEXT CHECK (length(pickup_address) <= 200),
  delivery_address TEXT CHECK (length(delivery_address) <= 200),
  move_at TEXT,
  crew_leader TEXT CHECK (length(crew_leader) <= 80),
  notes TEXT CHECK (length(notes) <= 2000),
  truck_id TEXT REFERENCES trucks(id),
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','packing','loaded','delivered','closed')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, deleted_at TEXT,
  UNIQUE (workspace_id, number)
);
CREATE INDEX jobs_ws ON jobs(workspace_id, move_at) WHERE deleted_at IS NULL;

CREATE TABLE volume_catalogue (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name_en TEXT CHECK (length(name_en) <= 80),
  name_bn TEXT CHECK (length(name_bn) <= 80),
  kind TEXT NOT NULL DEFAULT 'furniture' CHECK (kind IN ('box','furniture')),
  volume_m3 REAL NOT NULL CHECK (volume_m3 > 0 AND volume_m3 <= 50),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  CHECK (coalesce(length(name_en), 0) > 0 OR coalesce(length(name_bn), 0) > 0)
);
CREATE INDEX volume_catalogue_ws ON volume_catalogue(workspace_id, sort_order) WHERE deleted_at IS NULL;

ALTER TABLE locations ADD COLUMN job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE locations ADD COLUMN is_piece INTEGER NOT NULL DEFAULT 0 CHECK (is_piece IN (0,1));
ALTER TABLE locations ADD COLUMN job_seq INTEGER CHECK (job_seq > 0);
ALTER TABLE locations ADD COLUMN volume_item_id TEXT REFERENCES volume_catalogue(id);
CREATE UNIQUE INDEX locations_job_seq ON locations(job_id, is_piece, job_seq) WHERE job_id IS NOT NULL;
ALTER TABLE rooms ADD COLUMN job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE;

CREATE TABLE job_volume_lines (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  volume_item_id TEXT REFERENCES volume_catalogue(id),
  custom_name TEXT CHECK (length(custom_name) <= 80),
  volume_m3_each REAL NOT NULL CHECK (volume_m3_each >= 0 AND volume_m3_each <= 50),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 9999),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX job_volume_lines_job ON job_volume_lines(job_id);

CREATE TABLE condition_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('pickup','delivery')),
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  note TEXT CHECK (length(note) <= 1000),
  is_amendment INTEGER NOT NULL DEFAULT 0 CHECK (is_amendment IN (0,1)),
  created_at TEXT NOT NULL,
  created_by TEXT CHECK (length(created_by) <= 80),
  CHECK (is_amendment = 0 OR length(trim(note)) > 0)
);
CREATE INDEX condition_records_job ON condition_records(job_id, stage);
CREATE INDEX condition_records_location ON condition_records(location_id);

CREATE TABLE condition_photos (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES condition_records(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('camera','library')),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64)
);
CREATE INDEX condition_photos_record ON condition_photos(record_id);

CREATE TABLE stage_locks (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('pickup','delivery')),
  locked_at TEXT NOT NULL,
  report_hash TEXT NOT NULL CHECK (length(report_hash) = 64),
  customer_refused INTEGER NOT NULL DEFAULT 0 CHECK (customer_refused IN (0,1)),
  PRIMARY KEY (job_id, stage)
);

CREATE TABLE signoffs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('pickup','delivery')),
  signer_role TEXT NOT NULL CHECK (signer_role IN ('customer','crew_leader')),
  signer_name TEXT NOT NULL CHECK (length(signer_name) BETWEEN 1 AND 80),
  signature_png BLOB CHECK (signature_png IS NULL OR length(signature_png) <= 100000),
  signature_sha256 TEXT CHECK (length(signature_sha256) = 64),
  signed_at TEXT NOT NULL,
  report_hash TEXT NOT NULL CHECK (length(report_hash) = 64),
  UNIQUE (job_id, stage, signer_role)
);

CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  location_id TEXT REFERENCES locations(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('loaded','unloaded','manual_loaded','manual_unloaded','missing_ack','wrong_job_scan')),
  direction TEXT NOT NULL CHECK (direction IN ('load','unload')),
  reason TEXT CHECK (reason IN ('left_on_purpose','customer_taking','not_found','other')),
  at TEXT NOT NULL,
  note TEXT CHECK (length(note) <= 200),
  CHECK ((event = 'missing_ack') = (reason IS NOT NULL))
);
CREATE INDEX job_events_job ON job_events(job_id, at);
`;

const TRIGGERS = `
-- 1. Load/unload history is append-only while its job is live (not in the Bin).
CREATE TRIGGER job_events_no_update BEFORE UPDATE ON job_events BEGIN
  SELECT RAISE(ABORT, 'job_events_append_only');
END;
CREATE TRIGGER job_events_no_delete BEFORE DELETE ON job_events
  WHEN EXISTS (SELECT 1 FROM jobs j JOIN workspaces w ON w.id = j.workspace_id WHERE j.id = OLD.job_id AND j.deleted_at IS NULL AND w.deleted_at IS NULL) BEGIN
  SELECT RAISE(ABORT, 'job_events_append_only');
END;

-- 2. A sign-off and its lock are never changed or removed.
CREATE TRIGGER stage_locks_no_update BEFORE UPDATE ON stage_locks BEGIN
  SELECT RAISE(ABORT, 'stage_locked');
END;
CREATE TRIGGER stage_locks_no_delete BEFORE DELETE ON stage_locks WHEN ${LIVE_JOB('OLD.job_id')} BEGIN
  SELECT RAISE(ABORT, 'stage_locked');
END;
CREATE TRIGGER signoffs_no_update BEFORE UPDATE ON signoffs BEGIN
  SELECT RAISE(ABORT, 'stage_locked');
END;
CREATE TRIGGER signoffs_no_delete BEFORE DELETE ON signoffs WHEN ${LIVE_JOB('OLD.job_id')} BEGIN
  SELECT RAISE(ABORT, 'stage_locked');
END;

-- 3. Condition records of a locked stage can't change; only amendments (flag + note) can be added.
CREATE TRIGGER condition_records_locked_update BEFORE UPDATE ON condition_records
  WHEN ${LOCKED('OLD.job_id', 'OLD.stage')} AND ${LIVE_JOB('OLD.job_id')} BEGIN
  SELECT RAISE(ABORT, 'stage_locked');
END;
CREATE TRIGGER condition_records_locked_delete BEFORE DELETE ON condition_records
  WHEN ${LOCKED('OLD.job_id', 'OLD.stage')} AND ${LIVE_JOB('OLD.job_id')} BEGIN
  SELECT RAISE(ABORT, 'stage_locked');
END;
CREATE TRIGGER condition_records_locked_insert BEFORE INSERT ON condition_records
  WHEN ${LOCKED('NEW.job_id', 'NEW.stage')} AND (NEW.is_amendment = 0 OR NEW.note IS NULL OR length(trim(NEW.note)) = 0) BEGIN
  SELECT RAISE(ABORT, 'stage_locked_amend_only');
END;

-- 4. Condition photos of a locked stage can't change; new ones only on an amendment record.
CREATE TRIGGER condition_photos_locked_update BEFORE UPDATE ON condition_photos
  WHEN EXISTS (SELECT 1 FROM condition_records r WHERE r.id = OLD.record_id AND ${LOCKED('r.job_id', 'r.stage')}) BEGIN
  SELECT RAISE(ABORT, 'stage_locked');
END;
CREATE TRIGGER condition_photos_locked_delete BEFORE DELETE ON condition_photos
  WHEN EXISTS (SELECT 1 FROM condition_records r WHERE r.id = OLD.record_id AND ${LOCKED('r.job_id', 'r.stage')} AND ${LIVE_JOB('r.job_id')}) BEGIN
  SELECT RAISE(ABORT, 'stage_locked');
END;
CREATE TRIGGER condition_photos_locked_insert BEFORE INSERT ON condition_photos
  WHEN EXISTS (SELECT 1 FROM condition_records r WHERE r.id = NEW.record_id AND r.is_amendment = 0 AND ${LOCKED('r.job_id', 'r.stage')}) BEGIN
  SELECT RAISE(ABORT, 'stage_locked_amend_only');
END;

-- 5. The photo behind a locked condition photo can't be removed or swapped. Drive sync columns
--    (drive_ref, drive_file_id) and updated_at stay writable, or backups of locked photos would stop.
CREATE TRIGGER photos_locked_delete BEFORE DELETE ON photos
  WHEN ${LIVE_WS('OLD.workspace_id')} AND ${LOCKED_PHOTO('OLD.id')} BEGIN
  SELECT RAISE(ABORT, 'stage_locked');
END;
CREATE TRIGGER photos_locked_update BEFORE UPDATE OF deleted_at, file_name, thumb_name, sha256, bytes, mime, location_id, item_id ON photos
  WHEN (NEW.deleted_at IS NOT OLD.deleted_at OR NEW.file_name IS NOT OLD.file_name OR NEW.thumb_name IS NOT OLD.thumb_name
        OR NEW.sha256 IS NOT OLD.sha256 OR NEW.bytes IS NOT OLD.bytes OR NEW.mime IS NOT OLD.mime
        OR NEW.location_id IS NOT OLD.location_id OR NEW.item_id IS NOT OLD.item_id)
   AND ${LOCKED_PHOTO('OLD.id')} BEGIN
  SELECT RAISE(ABORT, 'stage_locked');
END;

-- 6. A job with any sign-off can only be archived, never binned; a live job is never hard-deleted.
CREATE TRIGGER jobs_locked_no_bin BEFORE UPDATE OF deleted_at ON jobs
  WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND ${ANY_LOCK('OLD.id')} BEGIN
  SELECT RAISE(ABORT, 'job_signed_archive_only');
END;
CREATE TRIGGER jobs_no_live_delete BEFORE DELETE ON jobs
  WHEN ${LIVE_WS('OLD.workspace_id')} AND (OLD.deleted_at IS NULL OR ${ANY_LOCK('OLD.id')}) BEGIN
  SELECT RAISE(ABORT, 'job_must_be_binned_first');
END;

-- 7. Boxes and pieces of a job with a sign-off can't be binned, moved to another job or deleted.
CREATE TRIGGER locations_locked_update BEFORE UPDATE OF deleted_at, job_id ON locations
  WHEN ${ANY_LOCK('OLD.job_id')} AND ((NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) OR NEW.job_id IS NOT OLD.job_id) BEGIN
  SELECT RAISE(ABORT, 'job_signed_archive_only');
END;
CREATE TRIGGER locations_locked_delete BEFORE DELETE ON locations
  WHEN ${LIVE_WS('OLD.workspace_id')} AND ${ANY_LOCK('OLD.job_id')} BEGIN
  SELECT RAISE(ABORT, 'job_signed_archive_only');
END;
`;

/**
 * v6. Rebuilds workspaces (type adds 'removalist') and entitlements (plan adds 'removalist_pro'): SQLite can't change
 * a CHECK with ALTER. With foreign keys ON, DROP TABLE workspaces would cascade-delete every row in the database, so
 * this runs as a rebuild step (foreign keys OFF, foreign_key_check before commit; see migrate()). Triggers whose body
 * names workspaces are dropped first and re-created from their own stored SQL, so they stay byte-for-byte the same.
 * All Removalist tables and protection triggers come now, so later Removalist phases need no new migration.
 */
export function v6(db: MigrationDb): void {
  const keep = db.selectObjects(`SELECT name, sql FROM sqlite_master WHERE type='trigger' AND (tbl_name='workspaces' OR sql LIKE '%workspaces%') ORDER BY name`);
  for (const t of keep) db.exec(`DROP TRIGGER "${String(t.name)}"`);
  db.exec(`
CREATE TABLE workspaces_v6 (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('home','seller','removalist')),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  country     TEXT NOT NULL CHECK (country IN ('AU','BD')),
  currency    TEXT NOT NULL CHECK (currency IN ('AUD','BDT')),
  language    TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','bn')),
  jewellery_fields INTEGER NOT NULL DEFAULT 0,
  next_box_number INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
INSERT INTO workspaces_v6 (id,type,name,country,currency,language,jewellery_fields,next_box_number,created_at,updated_at,deleted_at)
  SELECT id,type,name,country,currency,language,jewellery_fields,next_box_number,created_at,updated_at,deleted_at FROM workspaces;
DROP TABLE workspaces;
ALTER TABLE workspaces_v6 RENAME TO workspaces;

CREATE TABLE entitlements_v6 (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('licence_key')),
  plan TEXT NOT NULL CHECK (plan IN ('move_pass','seller_pro','removalist_pro')),
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  raw_signed TEXT NOT NULL
);
INSERT INTO entitlements_v6 (id,source,plan,starts_at,ends_at,verified_at,raw_signed)
  SELECT id,source,plan,starts_at,ends_at,verified_at,raw_signed FROM entitlements;
DROP TABLE entitlements;
ALTER TABLE entitlements_v6 RENAME TO entitlements;
`);
  for (const t of keep) db.exec(String(t.sql));
  db.exec(TABLES);
  db.exec(TRIGGERS);
}

/** Names of the v6 protection triggers (tests check each is present and that a backup without one is refused). */
export const V6_TRIGGERS = [...TRIGGERS.matchAll(/CREATE TRIGGER (\w+)/g)].map((m) => m[1]!);
