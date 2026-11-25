// npx tsx tools/licence.ts issue --plan move_pass --months 12 --licensee "Mia T. · mia@example.com" --ref stripe:pi_… [--starts 2026-12-01] [--amount 12.95 --currency AUD] [--note pilot]
// npx tsx tools/licence.ts revoke lk_…   (then run: npx tsx tools/config.ts sign, and deploy)
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import QRCode from 'qrcode';
import { issueLicence, openKeyFile, revoke } from './lib';
import { CONFIG_SRC, CSV_FILE, fail, flags, KEY_FILE, OWNER_DIR, passphrase } from './cli';

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'revoke') {
  const id = rest[0] ?? fail('usage: licence.ts revoke lk_…');
  revoke(CONFIG_SRC, id);
  console.log(`${id} added to revoked_keys in ${CONFIG_SRC}. Now run: npx tsx tools/config.ts sign, then deploy.`);
} else if (cmd === 'issue') {
  const f = flags(rest);
  const plan = f.plan;
  if (plan !== 'move_pass' && plan !== 'seller_pro') fail('--plan must be move_pass or seller_pro');
  if (!f.licensee || !f.ref) fail('--licensee and --ref are required');
  const keys = await openKeyFile(KEY_FILE, await passphrase());
  const key = await issueLicence(keys, {
    plan, months: Number(f.months ?? 12), licensee: f.licensee, ref: f.ref,
    startsAt: f.starts ?? new Date().toISOString().slice(0, 10),
    amount: f.amount ?? '', currency: f.currency ?? '', note: f.note ?? null, csvPath: CSV_FILE,
  });
  const png = join(OWNER_DIR, 'qr', `${key.id}.png`);
  mkdirSync(dirname(png), { recursive: true });
  await QRCode.toFile(png, key.text, { errorCorrectionLevel: 'M', margin: 2, width: 512 });
  console.log(`\n${key.text}\n`);
  console.log(`Plan ${key.payload.plan}, ${key.payload.starts_at} to ${key.payload.ends_at}, licensed to ${key.payload.licensee}`);
  console.log(`QR saved to ${png}; logged in ${CSV_FILE}`);
} else {
  fail('usage: licence.ts issue … | licence.ts revoke lk_…');
}
