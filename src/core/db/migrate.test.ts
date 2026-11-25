import { describe, it, expect } from 'vitest';
import { rawTestDb } from './testDb';
import { migrate, type SqlDb } from './migrate';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';
import { FutureSchemaError } from './migrate';

const cols = (db: Awaited<ReturnType<typeof rawTestDb>>, table: string) =>
  db.selectValues(`SELECT name FROM pragma_table_info('${table}')`).map(String);

describe('migrations from every past version (TEST_STRATEGY: migrations)', () => {
  it('a database made by the first live build (v1 without photos.drive_file_id) upgrades', async () => {
    const db = await rawTestDb();
    const v1 = MIGRATIONS[0] as string;
    db.exec(v1);
    db.exec('PRAGMA user_version = 1');
    expect(cols(db, 'photos')).not.toContain('drive_file_id');
    migrate(db as unknown as SqlDb);
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(SCHEMA_VERSION);
    expect(cols(db, 'photos')).toContain('drive_file_id');
    expect(cols(db, 'stock_movements')).toEqual(expect.arrayContaining(['unit_price_minor', 'unit_cost_minor']));
  });

  it('a v1 database that already had photos.drive_file_id (built in between) upgrades too', async () => {
    const db = await rawTestDb();
    db.exec(MIGRATIONS[0] as string);
    db.exec('ALTER TABLE photos ADD COLUMN drive_file_id TEXT');
    db.exec('PRAGMA user_version = 1');
    migrate(db as unknown as SqlDb);
    expect(cols(db, 'photos').filter((c) => c === 'drive_file_id')).toHaveLength(1);
  });

  it('a fresh database and an upgraded one end with the same schema', async () => {
    const fresh = await rawTestDb();
    migrate(fresh as unknown as SqlDb);
    const old = await rawTestDb();
    old.exec(MIGRATIONS[0] as string);
    old.exec('PRAGMA user_version = 1');
    migrate(old as unknown as SqlDb);
    const schema = (d: typeof fresh) => d.selectValues(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name`).map(String);
    expect(schema(old)).toEqual(schema(fresh));
  });

  it('refuses a database from a newer app', async () => {
    const db = await rawTestDb();
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db as unknown as SqlDb)).toThrow(FutureSchemaError);
  });
});
