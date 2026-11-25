// Shared CLI helpers for the owner tools.
import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';

export const OWNER_DIR = resolve(process.env.BOXTAP_OWNER_DIR ?? 'owner-private');
export const KEY_FILE = join(OWNER_DIR, 'owner.keys.enc');
export const CSV_FILE = join(OWNER_DIR, 'licences.csv');
export const CONFIG_SRC = join(OWNER_DIR, 'config.json');
export const CONFIG_OUT = resolve('public', 'config', 'v1.json');
export const PUBLIC_KEYS_FILE = resolve('src', 'core', 'licensing', 'publicKeys.json');

export async function passphrase(): Promise<string> {
  if (process.env.BOXTAP_OWNER_PASSPHRASE) return process.env.BOXTAP_OWNER_PASSPHRASE;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const p = await rl.question('Owner key passphrase: ');
  rl.close();
  return p;
}

export function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true';
  }
  return out;
}

export function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
