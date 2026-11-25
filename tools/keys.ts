// npx tsx tools/keys.ts init [--year 2026]
import { readFileSync, writeFileSync } from 'node:fs';
import { createKeyFile } from './lib';
import { fail, flags, KEY_FILE, passphrase, PUBLIC_KEYS_FILE } from './cli';

const [cmd, ...rest] = process.argv.slice(2);
if (cmd !== 'init') fail('usage: npx tsx tools/keys.ts init [--year YYYY]');
const year = Number(flags(rest).year ?? new Date().getUTCFullYear());
const pub = await createKeyFile(KEY_FILE, await passphrase(), year);
const current = JSON.parse(readFileSync(PUBLIC_KEYS_FILE, 'utf8')) as { lic: Record<string, string>; cfg: Record<string, string> };
for (const [kid, hex] of Object.entries(pub)) (kid.startsWith('lic-') ? current.lic : current.cfg)[kid] = hex;
writeFileSync(PUBLIC_KEYS_FILE, JSON.stringify(current, null, 2) + '\n');
console.log(`Private keys saved (encrypted) to ${KEY_FILE}. Back this file and the passphrase up offline.`);
console.log(`Public keys added to ${PUBLIC_KEYS_FILE}:`);
console.log(pub);
